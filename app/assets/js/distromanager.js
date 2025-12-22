const { DistributionAPI } = require("helios-core/common");

const ConfigManager = require("./configmanager");
const https = require('https')
const { URL } = require('url')
const fs = require('fs-extra')
const path = require('path')
const crypto = require('crypto')

// Old WesterosCraft url.
// exports.REMOTE_DISTRO_URL = 'http://mc.westeroscraft.com/WesterosCraftLauncher/distribution.json'
exports.REMOTE_DISTRO_URL = 'https://multigames-studio.fr/distribution.json'

const api = new DistributionAPI(
  ConfigManager.getLauncherDirectory(),
  null, // Injected forcefully by the preloader.
  null, // Injected forcefully by the preloader.
  exports.REMOTE_DISTRO_URL,
  false
);

/**
 * Check whether the remote distro URL is reachable (quick HEAD request).
 * Returns true if reachable, false otherwise.
 */
async function isOnline(timeout = 3000){
  return new Promise((resolve) => {
    try{
      const url = new URL(exports.REMOTE_DISTRO_URL)
      const options = {
        method: 'HEAD',
        hostname: url.hostname,
        path: url.pathname + (url.search || ''),
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        timeout: timeout
      }

      const req = https.request(options, (res) => {
        // Any 2xx/3xx/4xx/5xx is considered reachable; we only care about network connectivity
        resolve(true)
      })

      req.on('error', () => resolve(false))
      req.on('timeout', () => { try{ req.destroy() }catch(e){}; resolve(false) })
      req.end()
    } catch(e){
      resolve(false)
    }
  })
}

/**
 * Force a distro refresh if online; otherwise return cached/local distribution.
 * Exposed on the DistroAPI instance so callers can use it instead of getDistribution().
 */
api.forceRefreshIfOnline = async function(){
  const online = await isOnline()
  if(online){
    // Try to refresh from remote; fall back to cached copy if refresh fails.
    if(typeof api.refreshDistributionOrFallback === 'function'){
      return api.refreshDistributionOrFallback()
    }
    // If the DistributionAPI does not expose refreshDistributionOrFallback, try refreshDistribution
    if(typeof api.refreshDistribution === 'function'){
      try{
        await api.refreshDistribution()
        return api.getDistribution()
      }catch(e){
        return api.getDistribution()
      }
    }
  }

  // Offline or refresh not available -> return cached distribution
  return api.getDistribution()
}

exports.DistroAPI = api;

/**
 * Synchronise les mods d'une instance serveur avec la distribution:
 * - supprime les fichiers mods qui ne figurent pas dans la distribution
 * - supprime les fichiers dont le checksum diffère afin de forcer la réinstallation
 * Retourne un objet de résumé { removed: [], reinstalled: [], errors: [] }
 */
api.syncServerMods = async function(serverId){
  const result = { removed: [], reinstalled: [], errors: [] }
  try{
    // Ensure we have latest distribution when possible
    await api.forceRefreshIfOnline()
    const distro = api.getDistribution()
    if(!distro) return result

    // distribution object exposes getServerById in other codepaths
    const server = (typeof distro.getServerById === 'function') ? distro.getServerById(serverId) : (distro.servers || []).find(s=>s.id===serverId)
    if(!server) return result

    const modsDir = path.join(ConfigManager.getInstanceDirectory(), serverId, 'mods')
    // Build expected filenames from distribution modules (modules and subModules)
    const expected = new Set()
    const pushModule = (mdl) => {
      if(!mdl || !mdl.artifact || !mdl.artifact.url) return
      // Consider modules with type containing 'Mod' as files that live in mods folder
      if(typeof mdl.type === 'string' && mdl.type.toLowerCase().includes('mod')){
        expected.add(path.basename(mdl.artifact.url))
      }
    }

    if(Array.isArray(server.modules)){
      for(const m of server.modules){
        pushModule(m)
        if(Array.isArray(m.subModules)){
          for(const sm of m.subModules) pushModule(sm)
        }
      }
    }

    // If mods directory doesn't exist, nothing to do
    if(!fs.existsSync(modsDir)) return result

    const files = await fs.readdir(modsDir)
    for(const f of files){
      try{
        const full = path.join(modsDir, f)
        const stat = await fs.stat(full)
        if(!stat.isFile()) continue

        if(!expected.has(f)){
          await fs.remove(full)
          result.removed.push(f)
          continue
        }

        // Find corresponding module to get checksum
        // Search in server.modules and submodules
        let found = null
        const findFor = (mdl) => {
          if(mdl && mdl.artifact && mdl.artifact.url && path.basename(mdl.artifact.url) === f) return mdl
          return null
        }
        if(Array.isArray(server.modules)){
          for(const m of server.modules){
            if(findFor(m)) { found = findFor(m); break }
            if(Array.isArray(m.subModules)){
              for(const sm of m.subModules){ if(findFor(sm)){ found = findFor(sm); break } }
            }
            if(found) break
          }
        }

        if(found && found.artifact && found.artifact.MD5){
          const data = await fs.readFile(full)
          const md5 = crypto.createHash('md5').update(data).digest('hex')
          if(md5.toLowerCase() !== String(found.artifact.MD5).toLowerCase()){
            await fs.remove(full)
            result.reinstalled.push(f)
          }
        }
      }catch(e){ result.errors.push({ file: f, error: e && e.message ? e.message : String(e) }) }
    }

    return result
  }catch(e){ result.errors.push({ global: e && e.message ? e.message : String(e) }); return result }
}

/**
 * Remove common MCEF-related caches/libraries for the given instance and common dir.
 * Returns { removed: [], errors: [] }
 */
api.ensureCleanMcef = async function(serverId){
  const result = { removed: [], errors: [] }
  try{
    const instanceMods = path.join(ConfigManager.getInstanceDirectory(), serverId, 'mods')
    const instanceCache = path.join(ConfigManager.getInstanceDirectory(), serverId, 'mcef-cache')
    const commonLibs = path.join(ConfigManager.getCommonDirectory(), 'mcef-libraries')
    const commonCache = path.join(ConfigManager.getCommonDirectory(), 'mcef-cache')

    const toCheck = [
      path.join(instanceMods, 'mcef-libraries'),
      instanceCache,
      commonLibs,
      commonCache
    ]

    for(const p of toCheck){
      try{
        if(fs.existsSync(p)){
          await fs.remove(p)
          result.removed.push(p)
        }
      }catch(e){ result.errors.push({ path: p, error: e && e.message ? e.message : String(e) }) }
    }

    return result
  }catch(e){ result.errors.push({ global: e && e.message ? e.message : String(e) }); return result }
}
