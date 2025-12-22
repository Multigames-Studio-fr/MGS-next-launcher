// Update window UI logic extracted from `app/update.ejs` to comply with CSP
// Version améliorée - fenêtre de mise à jour silencieuse
const { ipcRenderer } = require('electron')

const statusEl = document.getElementById('status')
const statusTitle = document.getElementById('statusTitle')
const statusDesc = document.getElementById('statusDesc')
const progressWrap = document.getElementById('progressWrap')
const progressBar = document.getElementById('progressBar')
const percentEl = document.getElementById('percent')
const actionRow = document.getElementById('actionRow')
const installBtn = document.getElementById('installBtn')
const closeBtn = document.getElementById('closeBtn')

// Auto-close timer - ferme la fenêtre automatiquement après le téléchargement
let autoCloseTimer = null

function showStatus(visible = true) {
  if (!statusEl) return
  statusEl.style.display = visible ? 'flex' : 'none'
  statusEl.setAttribute('aria-hidden', visible ? 'false' : 'true')
}

function showChecking() {
  if (!statusTitle || !statusDesc) return
  showStatus(true)
  statusTitle.innerText = 'Recherche des mises à jour...'
  statusDesc.innerText = 'Veuillez patienter pendant que le lanceur vérifie la disponibilité d\'une nouvelle version.'
  if (progressWrap) progressWrap.style.display = 'none'
  if (actionRow) actionRow.style.display = 'none'
}

function showNoUpdate() {
  showStatus(true)
  statusTitle.innerText = 'Aucune mise à jour disponible'
  statusDesc.innerText = 'Vous utilisez la dernière version.'
  if (progressWrap) progressWrap.style.display = 'none'
  if (actionRow) actionRow.style.display = 'none'
  // Fermer automatiquement après 1.5s
  setTimeout(() => { try { window.close && window.close() } catch (e) {} }, 1500)
}

function showUpdateAvailable(info) {
  const ver = (info && info.version) ? info.version : ''
  showStatus(true)
  statusTitle.innerText = 'Mise à jour disponible' + (ver ? (': ' + ver) : '')
  statusDesc.innerText = 'Téléchargement en arrière-plan...'
  if (progressWrap) progressWrap.style.display = 'block'
  if (actionRow) actionRow.style.display = 'none'
}

function showProgress(progress) {
  const p = progress && (progress.percent || progress.percent === 0) ? Math.round(progress.percent) : null
  if (p !== null) {
    if (progressBar) progressBar.style.width = Math.min(100, Math.max(0, p)) + '%'
    if (percentEl) percentEl.innerText = p + '%'
    
    // Mettre à jour le texte de statut avec plus d'infos
    if (statusDesc && progress.bytesPerSecond) {
      const speed = formatBytes(progress.bytesPerSecond) + '/s'
      statusDesc.innerText = `Téléchargement: ${speed}`
    }
  } else {
    if (progressBar) progressBar.style.width = '0%'
    if (percentEl) percentEl.innerText = '...'
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function showDownloaded() {
  if (statusTitle) statusTitle.innerText = 'Téléchargement terminé !'
  if (statusDesc) statusDesc.innerText = 'La mise à jour s\'installera à la fermeture du launcher.'
  if (progressWrap) progressWrap.style.display = 'none'
  if (actionRow) actionRow.style.display = 'flex'
  
  // Fermer automatiquement après 3s - l'utilisateur peut continuer à utiliser le launcher
  autoCloseTimer = setTimeout(() => { 
    try { window.close && window.close() } catch (e) {} 
  }, 3000)
}

function showError(err) {
  if (statusTitle) statusTitle.innerText = 'Erreur lors de la mise à jour'
  if (statusDesc) statusDesc.innerText = err && err.message ? err.message : String(err || 'Erreur inconnue')
  if (progressWrap) progressWrap.style.display = 'none'
  if (actionRow) actionRow.style.display = 'none'
  // Fermer après 3s
  setTimeout(() => { try { window.close && window.close() } catch (e) {} }, 3000)
}

ipcRenderer.on('autoUpdateNotification', (ev, type, payload) => {
  try {
    switch(type) {
      case 'checking-for-update':
        showChecking(); break;
      case 'update-available':
        showUpdateAvailable(payload); break;
      case 'download-progress':
        showProgress(payload); break;
      case 'update-downloaded':
        showDownloaded(); break;
      case 'update-not-available':
        showNoUpdate(); break;
      case 'realerror':
        showError(payload); break;
      default: break;
    }
  } catch (e) {
    // ignore UI errors
  }
})

if (installBtn) installBtn.addEventListener('click', () => {
  // Annuler l'auto-close
  if (autoCloseTimer) clearTimeout(autoCloseTimer)
  try { ipcRenderer.send('autoUpdateAction', 'installUpdateNow') } catch (e) {}
  setTimeout(() => { try { window.close() } catch (e) {} }, 200)
})

if (closeBtn) closeBtn.addEventListener('click', () => {
  // L'update s'installera à la fermeture du launcher principal
  try { window.close() } catch (e) {}
  try { ipcRenderer.send('closeUpdateWindow') } catch (e) {}
})

// Allow Escape key to dismiss
document.addEventListener('keydown', (ev) => {
  try {
    if (ev.key === 'Escape') {
      try { window.close() } catch (e) {}
      try { ipcRenderer.send('closeUpdateWindow') } catch (e) {}
    }
  } catch (e) {
    // ignore
  }
})

// initial minimal status
showStatus(false)
