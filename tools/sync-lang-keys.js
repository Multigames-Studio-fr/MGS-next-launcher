const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const langDir = path.join(repoRoot, 'app', 'assets', 'lang')
const enFile = path.join(langDir, 'en_US.toml')

function readAllFiles(dir, exts = ['.js', '.ejs']){
  const results = []
  const files = fs.readdirSync(dir)
  for(const f of files){
    const p = path.join(dir, f)
    const stat = fs.statSync(p)
    if(stat.isDirectory()){
      results.push(...readAllFiles(p, exts))
    } else {
      if(exts.includes(path.extname(f))) results.push(p)
    }
  }
  return results
}

function collectRefs(root){
  const filesToScan = []
  files = fs.readdirSync(root)
  for(const f of files){
    const p = path.join(root, f)
    if(fs.statSync(p).isDirectory()){
      filesToScan.push(...readAllFiles(p))
    }
  }
  // also include top-level app templates
  const appDir = path.join(root, 'app')
  if(fs.existsSync(appDir)) filesToScan.push(...readAllFiles(appDir))
  return filesToScan
}

function extractIdsFromFile(content){
  const ids = new Set()
  const reQueryJS = /Lang\.queryJS\(\s*['"]([^'"]+)['"]/g
  const reQuery = /Lang\.query\(\s*['"]([^'"]+)['"]/g
  const reLangEJS = /lang\(\s*['"]([^'"]+)['"]/g
  let m
  while((m = reQueryJS.exec(content))){ ids.add({id:m[1], type: 'js'}) }
  while((m = reQuery.exec(content))){ ids.add({id:m[1], type: 'raw'}) }
  while((m = reLangEJS.exec(content))){ ids.add({id:m[1], type: 'ejs'}) }
  // convert set-like
  const out = []
  ids.forEach(v => out.push(v))
  return out
}

function parseTomlKeys(tomlText){
  const lines = tomlText.split(/\r?\n/)
  const keys = new Set()
  let currentSection = null
  for(const raw of lines){
    const line = raw.trim()
    if(!line || line.startsWith('#') || line.startsWith('//')) continue
    const sec = line.match(/^\[([^\]]+)\]$/)
    if(sec){ currentSection = sec[1].trim(); continue }
    const kv = line.match(/^([A-Za-z0-9_\-\.]+)\s*=\s*(?:"|').*(?:"|')\s*$/)
    if(kv && currentSection){
      keys.add(currentSection + '.' + kv[1])
    }
  }
  return keys
}

function ensureSection(obj, section){
  if(!obj[section]) obj[section] = {}
}

function addMissingKeysToToml(tomlText, missing){
  // missing: array of {section, key}
  // We'll split toml into blocks by sections, keep trailing newline
  const lines = tomlText.split(/\r?\n/)
  const sections = {}
  let current = ''
  sections['__preamble__'] = []
  let curArr = sections['__preamble__']
  for(const raw of lines){
    const line = raw
    const sec = line.match(/^\[([^\]]+)\]$/)
    if(sec){
      current = sec[1].trim()
      curArr = sections[current] = sections[current] || []
      curArr.push(line)
    } else {
      curArr.push(line)
    }
  }

  // group missing by section
  const bySection = {}
  for(const m of missing){
    bySection[m.section] = bySection[m.section] || []
    bySection[m.section].push(m.key)
  }

  // insert missing keys into sections, create sections if needed at end
  for(const sec of Object.keys(bySection)){
    if(sections[sec]){
      // append keys at end of section (before next section)
      const arr = sections[sec]
      for(const k of bySection[sec]){
        arr.push(`${k} = "${k}"`)
      }
    } else {
      // create new section
      sections[sec] = []
      sections[sec].push('')
      sections[sec].push(`[${sec}]`)
      for(const k of bySection[sec]){
        sections[sec].push(`${k} = "${k}"`)
      }
    }
  }

  // rebuild toml: preamble then sections in original order plus any new ones
  const out = []
  if(sections['__preamble__']) out.push(...sections['__preamble__'])
  // collect existing section order
  const order = Object.keys(sections).filter(s => s !== '__preamble__')
  for(const s of order){
    out.push(...sections[s])
  }
  return out.join('\n') + '\n'
}

(async function(){
  try{
    if(!fs.existsSync(enFile)){
      console.error('en_US.toml not found at', enFile)
      process.exit(1)
    }
    const tomlText = fs.readFileSync(enFile,'utf8')
    const existingKeys = parseTomlKeys(tomlText)

    // scan repository for usages
    const scanRoots = [path.join(repoRoot, 'app'), path.join(repoRoot, 'app', 'assets', 'js')]
    const files = []
    for(const r of scanRoots){
      if(fs.existsSync(r)){
        const walk = (d) => {
          for(const f of fs.readdirSync(d)){
            const p = path.join(d,f)
            const st = fs.statSync(p)
            if(st.isDirectory()) walk(p)
            else if(['.js', '.ejs'].includes(path.extname(f))) files.push(p)
          }
        }
        walk(r)
      }
    }

    const refs = []
    for(const f of files){
      const txt = fs.readFileSync(f,'utf8')
      const reQueryJS = /Lang\.queryJS\(\s*['"]([^'"]+)['"]/g
      const reQuery = /Lang\.query\(\s*['"]([^'"]+)['"]/g
      const reLangEJS = /lang\(\s*['"]([^'"]+)['"]/g
      let m
      while((m = reQueryJS.exec(txt))){ refs.push({id:m[1], kind:'js'}) }
      while((m = reQuery.exec(txt))){ refs.push({id:m[1], kind:'raw'}) }
      while((m = reLangEJS.exec(txt))){ refs.push({id:m[1], kind:'ejs'}) }
    }

    // dedupe
    const uniq = {}
    refs.forEach(r => { uniq[`${r.kind}||${r.id}`] = r })
    const uniqueRefs = Object.values(uniq)

    const missing = []
    for(const r of uniqueRefs){
      let candidates = []
      if(r.kind === 'js') candidates.push('js.' + r.id)
      else if(r.kind === 'ejs') candidates.push('ejs.' + r.id)
      else candidates.push(r.id, 'js.'+r.id, 'ejs.'+r.id)

      let found = false
      for(const c of candidates){
        // check any key that starts exactly with c + '.' or equals c + '.' + key
        // We just check presence of prefix in existingKeys by checking if any key starts with c + '.' or equals c
        for(const ek of existingKeys){
          if(ek === c || ek.startsWith(c + '.')){ found = true; break }
        }
        if(found) break
      }
      if(!found){
        // convert expected to section + key
        // for typical case c = 'js.landing.dlAsync.doneEnjoyServer' -> section = 'js.landing.dlAsync', key = 'doneEnjoyServer'
        const c = (r.kind === 'js') ? ('js.' + r.id) : (r.kind === 'ejs') ? ('ejs.' + r.id) : r.id
        const parts = c.split('.')
        if(parts.length >= 2){
          const key = parts.pop()
          const section = parts.join('.')
          missing.push({section, key, original: r})
        } else {
          missing.push({section: parts[0] || 'misc', key: r.id, original: r})
        }
      }
    }

    if(missing.length === 0){
      console.log('No missing language keys detected.')
      process.exit(0)
    }

    console.log('Missing keys found:', missing.length)
    missing.forEach(m => console.log(`- [${m.original.kind}] ${m.original.id} => [${m.section}] ${m.key}`))

    // Update toml
    const newToml = addMissingKeysToToml(tomlText, missing)
    fs.writeFileSync(enFile, newToml, 'utf8')
    console.log('Updated', enFile, 'with missing keys.')
  } catch(err){
    console.error(err)
    process.exit(2)
  }
})()
