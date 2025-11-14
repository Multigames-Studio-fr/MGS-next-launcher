const { ipcRenderer } = require('electron')
const logbox = document.getElementById('logbox')
const clearBtn = document.getElementById('clearBtn')
const pauseBtn = document.getElementById('pauseBtn')
const saveBtn = document.getElementById('saveBtn')
let paused = false

function appendLine(line){
    try{
        if(paused) return
        logbox.textContent += line + '\n'
        // keep last ~50000 chars
        if(logbox.textContent.length > 50000){
            logbox.textContent = logbox.textContent.slice(-50000)
        }
        logbox.scrollTop = logbox.scrollHeight
    }catch(e){ }
}

ipcRenderer.on('mc-log-line', (_, line) => {
    appendLine(line)
})

clearBtn.addEventListener('click', () => { logbox.textContent = '' })
pauseBtn.addEventListener('click', () => { paused = !paused; pauseBtn.textContent = paused ? "Resume" : "Pause" })
saveBtn.addEventListener('click', async () => {
    const { dialog } = require('electron').remote || require('@electron/remote')
    const fs = require('fs')
    try{
        const { filePath } = await dialog.showSaveDialog({ defaultPath: 'minecraft-logs.txt' })
        if(filePath){
            fs.writeFileSync(filePath, logbox.textContent, 'utf8')
        }
    }catch(e){ }
})
