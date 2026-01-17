/**
 * Script for landing.ejs
 */
// Requirements
const { URL }                 = require('url')
const fs                      = require('fs-extra')
// path is already declared in preloader.js
const {
    MojangRestAPI,
    getServerStatus
}                             = require('helios-core/mojang')
const cryptoNode              = require('crypto')
const {
    RestResponseStatus,
    isDisplayableError,
    validateLocalFile
}                             = require('helios-core/common')
const {
    FullRepair,
    DistributionIndexProcessor,
    MojangIndexProcessor,
    downloadFile
}                             = require('helios-core/dl')
const {
    validateSelectedJvm,
    ensureJavaDirIsRoot,
    javaExecFromRoot,
    discoverBestJvmInstallation,
    latestOpenJDK,
    extractJdk
}                             = require('helios-core/java')

// Internal Requirements
const DiscordWrapper          = require('./assets/js/discordwrapper')
const ProcessBuilder          = require('./assets/js/processbuilder')
// AuthManager is declared globally in uibinder.js which loads before landing.js
// ModDeduplicator (anti-cheat) removed — keep module out

// DOM sanitization to avoid injecting untrusted HTML into the renderer
let DOMPurify = { sanitize: (s) => s }
try {
    const createDOMPurify = require('dompurify')
    DOMPurify = createDOMPurify(window)
} catch (e) {
    // If DOMPurify isn't available, fallback to identity function (best-effort)
}

// Launch Elements
const launch_content          = document.getElementById('launch_content')
const launch_details          = document.getElementById('launch_details')
const launch_progress         = document.getElementById('launch_progress')
const launch_progress_label   = document.getElementById('launch_progress_label')
const launch_details_text     = document.getElementById('launch_details_text')
const server_selection_button = document.getElementById('server_selection_button')
const user_text               = document.getElementById('user_text')

// If not already set by another script, default to false. Use window flag to avoid
// duplicate top-level const declarations across multiple scripts.
if (typeof window.DISABLE_LAUNCH === 'undefined') window.DISABLE_LAUNCH = false

const loggerLanding = LoggerUtil.getLogger('Landing')

// News Variables - Initialize early to prevent reference errors
let newsArr = null
let newsLoadingListener = null
let newsActive = false

// Per-instance runtime state map: { serverId: { started: boolean, pid: number|null, timestamp: number } }
const instanceStateMap = {}
// Track all running instances (max 3) with their PIDs
const runningInstances = []
const MAX_INSTANCES = 3
// Transition counter to cancel in-flight instance-change animations when a new change arrives
let instanceTransitionCounter = 0
// Map serverId -> last log timestamp and timer
const lastLogTimestamps = {}
const lastLogTimers = {}
const LOG_INACTIVITY_MS = 30 * 1000 // 30s of no logs => consider stopped
// Per-element tokens for text swap cancellation
const textAnimationTokens = new WeakMap()
// Per-element tokens for button selection animation cancellation
const buttonAnimationTokens = new WeakMap()

/**
 * Animate swapping selection between two sidebar buttons.
 * Handles cancellation via per-element tokens and updates 'selected' class and image borders.
 */
/**
 * Swap selection entre deux boutons de sidebar (mode instantané pour performance)
 */
async function animateButtonSwap(prevBtn, nextBtn){
    // Mode instantané - pas d'animations pour améliorer les performances
    try {
        // Retirer la sélection du bouton précédent
        if(prevBtn){
            prevBtn.classList.remove('selected')
            const img = prevBtn.querySelector('img')
            if(img){ 
                img.classList.remove('border-[#F8BA59]') 
                img.classList.add('border-white/20') 
            }
            // Nettoyage des classes d'animation existantes
            try {
                const labelPrev = prevBtn.querySelector('.font-semibold.text-xl.leading-tight')
                if(labelPrev) labelPrev.classList.remove('label-slide-out','label-slide-in')
            } catch (e) {}
            prevBtn.classList.remove('instance-btn-exit', 'instance-btn-enter')
        }

        // Appliquer la sélection au nouveau bouton immédiatement
        if(nextBtn){
            nextBtn.classList.add('selected')
            const img = nextBtn.querySelector('img')
            if(img){ 
                img.classList.remove('border-white/20') 
                img.classList.add('border-[#F8BA59]') 
            }
            // Nettoyage des classes d'animation existantes
            try {
                const labelNext = nextBtn.querySelector('.font-semibold.text-xl.leading-tight')
                if(labelNext) labelNext.classList.remove('label-slide-out','label-slide-in')
            } catch (e) {}
            nextBtn.classList.remove('instance-btn-exit', 'instance-btn-enter')
        }
    } catch (e) {
        console.debug('[Landing] animateButtonSwap error', e)
    }
}

/**
 * Fonction de changement de texte instantanée (optimisée pour performance)
 */
function animateTextSwap(el, newHTML, opts = {}){
    if(!el) return Promise.resolve()
    
    // Mode instantané - change directement le contenu
    try {
        el.innerHTML = newHTML
    } catch (e) {
        console.debug('[Landing] animateTextSwap error', e)
    }
    
    return Promise.resolve()
}

/**
 * Get the count of currently running instances
 */
function getRunningInstanceCount() {
    return runningInstances.filter(i => i && i.started).length
}

/**
 * Add a running instance to the tracker
 */
function addRunningInstance(serverId, pid) {
    // Remove any existing entry for this serverId first
    removeRunningInstance(serverId)
    
    if (getRunningInstanceCount() < MAX_INSTANCES) {
        runningInstances.push({ serverId, pid, started: true, timestamp: Date.now() })
        updateInstanceUI()
        return true
    }
    return false
}

/**
 * Remove a running instance from the tracker
 */
function removeRunningInstance(serverId) {
    const idx = runningInstances.findIndex(i => i && i.serverId === serverId)
    if (idx !== -1) {
        runningInstances.splice(idx, 1)
        updateInstanceUI()
    }
}

/**
 * Update the UI to reflect running instances
 */
function updateInstanceUI() {
    const launchBtn = document.getElementById('launch_button')
    const runningControls = document.getElementById('running_controls')
    const addInstanceBtn = document.getElementById('add_instance_button')
    const instanceCounter = document.getElementById('instance_counter')
    const instanceCounterText = document.getElementById('instance_counter_text')
    const launchStatus = document.getElementById('launch_status')
    
    const count = getRunningInstanceCount()
    
    console.log('[Landing] updateInstanceUI - running instances:', count)
    
    if (count > 0) {
        // Au moins une instance tourne - afficher les contrôles
        if (launchBtn) launchBtn.classList.add('hidden')
        if (runningControls) runningControls.classList.add('visible')
        if (instanceCounter) instanceCounter.classList.add('visible')
        
        // Mettre à jour le compteur
        if (instanceCounterText) {
            instanceCounterText.textContent = `${count}/${MAX_INSTANCES} instance${count > 1 ? 's' : ''} active${count > 1 ? 's' : ''}`
        }
        
        // Désactiver le bouton + si on a atteint le max
        if (addInstanceBtn) {
            if (count >= MAX_INSTANCES) {
                addInstanceBtn.disabled = true
                addInstanceBtn.title = 'Maximum 3 instances atteint'
            } else {
                addInstanceBtn.disabled = false
                addInstanceBtn.title = 'Lancer une instance supplémentaire (max 3)'
            }
        }
        
        // Cacher le statut de téléchargement
        if (launchStatus) launchStatus.classList.add('hidden')
        
    } else {
        // Aucune instance - afficher le bouton Lancer
        if (launchBtn) {
            launchBtn.classList.remove('hidden')
            launchBtn.disabled = false
        }
        if (runningControls) runningControls.classList.remove('visible')
        if (instanceCounter) instanceCounter.classList.remove('visible')
    }
}

// Expose functions globally
window.getRunningInstanceCount = getRunningInstanceCount
window.addRunningInstance = addRunningInstance
window.removeRunningInstance = removeRunningInstance
window.updateInstanceUI = updateInstanceUI

/**
 * Update the landing UI for a given server id based on instanceStateMap
 * - updates launch button label and styling to reflect Running / Starting / Play
 */
function updateLaunchUIForServer(serverId){
    if (window.DISABLE_LAUNCH) return;
    try {
        const state = serverId && instanceStateMap[serverId] ? instanceStateMap[serverId] : null
        
        console.log('[Landing] updateLaunchUIForServer called', { serverId, state, runningCount: getRunningInstanceCount() });

        const launchBtn = document.getElementById('launch_button')
        const launchStatus = document.getElementById('launch_status')

        if(state && state.started){
            // === JEU EN COURS ===
            console.log('[Landing] Game is RUNNING');
            
            // Ajouter cette instance au tracker si pas déjà présente
            addRunningInstance(serverId, state.pid)
            
            // Cacher le statut de téléchargement
            if (launchStatus) {
                launchStatus.classList.add('hidden');
            }
            
        } else if(state && state.starting){
            // === DÉMARRAGE EN COURS ===
            console.log('[Landing] Game is STARTING');
            
            if (launchBtn && getRunningInstanceCount() === 0) {
                launchBtn.disabled = true;
                launchBtn.classList.remove('hidden');
            }
            
            if (window.LaunchUI) {
                window.LaunchUI.showDownloading('Démarrage en cours...', 0);
            }
            
        } else {
            // === JEU ARRÊTÉ ===
            console.log('[Landing] Game is STOPPED for server:', serverId);
            
            // Retirer cette instance du tracker
            removeRunningInstance(serverId)
            
            // Cacher le statut
            if (launchStatus) {
                launchStatus.classList.add('hidden');
            }
            
            if (window.LaunchUI && getRunningInstanceCount() === 0) {
                window.LaunchUI.showReady();
            }
        }
        
        // Toujours mettre à jour l'UI des instances
        updateInstanceUI()
        
    } catch(e){ console.error('[Landing] updateLaunchUIForServer error', e) }
}

// Expose for other modules
window.updateLaunchUIForServer = updateLaunchUIForServer

/* Launch Progress Wrapper Functions */

/**
 * Show/hide the loading area.
 * 
 * @param {boolean} loading True if the loading area should be shown, otherwise false.
 */
function toggleLaunchArea(loading){
    if (window.DISABLE_LAUNCH) return;
    
    console.log('[Landing] toggleLaunchArea called with:', loading);
    
    // Utiliser le nouveau LaunchUI
    if (window.LaunchUI) {
        if (loading) {
            // Mode chargement déjà géré par showDownloading
            return;
        } else {
            window.LaunchUI.showReady();
            return;
        }
    }
}

/**
 * Set the details text of the loading area.
 * 
 * @param {string} details The new text for the loading details.
 */
function setLaunchDetails(details){
    console.log('[Landing] setLaunchDetails called with:', details)
    if (window.DISABLE_LAUNCH) return;
    
    // Utiliser le nouveau LaunchUI si disponible
    if (window.LaunchUI && window.LaunchUI.state.isLaunching) {
        window.LaunchUI.updateProgress(window.LaunchUI.state.progress, details);
        return;
    }
    
    // Fallback: mettre à jour les anciens éléments si présents
    const statusText = document.getElementById('launch_status_text');
    if (statusText) {
        statusText.textContent = details || 'Préparation...';
    }
}

/**
 * Update launch button text, icon, and progress based on current launch step
 * 
 * @param {string} step The current launch step text
 * @param {number} progress Progress percentage (0-100), optional
 */
function updateLaunchButton(step, progress = 0) {
    if (window.DISABLE_LAUNCH) return;
    
    // Utiliser le nouveau LaunchUI
    if (window.LaunchUI) {
        window.LaunchUI.showDownloading(step, progress);
        return;
    }
}

/**
 * Set the value of the loading progress bar and display that value.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setLaunchPercentage(percent){
    console.log('[Landing] setLaunchPercentage called with:', percent)
    if (window.DISABLE_LAUNCH) return;
    
    // Utiliser le nouveau LaunchUI si disponible
    if (window.LaunchUI) {
        if (percent > 0) {
            window.LaunchUI.showDownloading(null, percent);
        }
        window.LaunchUI.updateProgress(percent);
        return;
    }
    
    // Fallback: mise à jour des anciens éléments
    const statusBar = document.getElementById('launch_status_bar');
    const statusPercent = document.getElementById('launch_status_percent');
    
    if (statusBar) {
        statusBar.style.width = percent + '%';
    }
    if (statusPercent) {
        statusPercent.textContent = Math.round(percent) + '%';
    }
}

/**
 * Set the value of the OS progress bar and display that on the UI.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setDownloadPercentage(percent){
    if (window.DISABLE_LAUNCH) return;
    try { remote.getCurrentWindow().setProgressBar(percent/100) } catch(e){}
    setLaunchPercentage(percent)
}

/**
 * Enable or disable the launch button.
 * 
 * @param {boolean} val True to enable, false to disable.
 */
function setLaunchEnabled(val){
    if (window.DISABLE_LAUNCH) return;
    const lb = document.getElementById('launch_button')
    if (lb) lb.disabled = !val
}

// Function to check update status
async function checkUpdateStatus() {
    return new Promise((resolve) => {
        try {
            const { ipcRenderer } = require('electron')
            ipcRenderer.send('checkUpdateStatus')
            ipcRenderer.once('updateStatusResponse', (event, status) => {
                resolve(status)
            })
            // Timeout after 5 seconds
            setTimeout(() => {
                resolve({ hasUpdate: false, downloading: false })
            }, 5000)
        } catch (e) {
            loggerLanding.warn('Failed to check update status, assuming no update', e)
            resolve({ hasUpdate: false, downloading: false })
        }
    })
}

// Bind launch button
const _launch_button_el = document.getElementById('launch_button')
if (_launch_button_el) _launch_button_el.addEventListener('click', async e => {
    loggerLanding.info('Launching game..')
    
    // Feedback UI immédiat avec le nouveau système
    try {
        if (window.LaunchUI) {
            window.LaunchUI.showDownloading('Démarrage...', 0);
        }
        
        // Notify that the instance is starting
        const payload = { starting: true, serverId: ConfigManager.getSelectedServer() }
        if (typeof window.onInstanceStateChanged === 'function') {
            window.onInstanceStateChanged(payload)
        }
        try {
            const { ipcRenderer } = require('electron')
            ipcRenderer.send('instance-state', payload)
        } catch (e) { /* ignore */ }
    } catch (e) { console.error('[Landing] Error setting initial UI state', e) }
    
    try {
        // Vérifier l'état des mises à jour avant de lancer
        const updateStatus = await checkUpdateStatus()
        if (updateStatus.hasUpdate || updateStatus.downloading) {
            loggerLanding.warn('Update in progress or available, preventing launch')
            if (window.LaunchUI) window.LaunchUI.showReady();
            showLaunchFailure(
                'Mise à jour en cours',
                updateStatus.downloading 
                    ? 'Une mise à jour est en cours de téléchargement. Veuillez attendre la fin du téléchargement avant de lancer le jeu.'
                    : 'Une mise à jour est disponible. Veuillez installer la mise à jour avant de lancer le jeu.'
            )
            return
        }

        const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
        const jExe = ConfigManager.getJavaExecutable(ConfigManager.getSelectedServer())
        if(jExe == null){
            await asyncSystemScan(server.effectiveJavaOptions)
        } else {

            setLaunchDetails(Lang.queryJS('landing.launch.pleaseWait'))
            toggleLaunchArea(true)
            setLaunchPercentage(0, 100)

            let details = null
            try {
                details = await validateSelectedJvm(ensureJavaDirIsRoot(jExe), server.effectiveJavaOptions.supported)
            } catch (jvmErr) {
                loggerLanding.error('Error validating JVM:', jvmErr)
                details = null
            }
            if(details != null){
                loggerLanding.info('Jvm Details', details)
                // If we appear to be offline but a local account is selected, use offline mode
                try {
                    const offlineDetected = (typeof navigator !== 'undefined' && !navigator.onLine)
                    if (offlineDetected) {
                        // Prevent launching when offline. Show an informative modal/message.
                        try {
                            // Prefer a UI modal if present
                            const offlineModal = document.getElementById('offlineModal')
                            if (offlineModal) {
                                offlineModal.classList.remove('hidden')
                            } else {
                                // Fallback: show existing launch failure UI
                                showLaunchFailure('Connexion requise', 'Vous êtes hors-ligne. Veuillez vous connecter à Internet pour lancer le jeu.')
                            }
                        } catch (err) {
                            // Fallback to launch failure if modal manipulation fails
                            showLaunchFailure('Connexion requise', 'Vous êtes hors-ligne. Veuillez vous connecter à Internet pour lancer le jeu.')
                        }
                        return
                    }

                    // Online: proceed with normal launch flow
                    await dlAsync()
                } catch (e) {
                    // If any unexpected error occurs, attempt normal launch as best-effort
                    try { await dlAsync() } catch (err) { loggerLanding.error('Launch failed after fallback', err) }
                }

            } else {
                await asyncSystemScan(server.effectiveJavaOptions)
            }
        }
    } catch(err) {
        loggerLanding.error('Unhandled error in during launch process.', err)
        showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
    }
})

// Bind stop button - arrête TOUTES les instances
try {
    const stopBtn = document.getElementById('stop_button')
    if (stopBtn) {
        stopBtn.addEventListener('click', async () => {
            loggerLanding.info('Stop button clicked - stopping all instances')
            
            // Feedback UI immédiat
            if (window.LaunchUI) {
                window.LaunchUI.showStopping();
            }
            
            try {
                // Arrêter toutes les instances en cours
                const instancesToStop = [...runningInstances]
                
                for (const instance of instancesToStop) {
                    try {
                        const { ipcRenderer } = require('electron')
                        // Send serverId and pid to main so it can attempt to kill the process if renderer can't
                        const payload = { request: 'stop', serverId: instance.serverId, pid: instance.pid || null }
                        console.info('[Landing] sending request-instance-action to main', payload)
                        ipcRenderer.send('request-instance-action', payload)
                    } catch (e) { /* ignore */ }
                    
                    // Notify UI
                    const payload = { started: false, serverId: instance.serverId }
                    if (typeof window.onInstanceStateChanged === 'function') {
                        window.onInstanceStateChanged(payload)
                    }
                    try {
                        const { ipcRenderer } = require('electron')
                        ipcRenderer.send('instance-state', payload)
                    } catch (e) { /* ignore */ }
                }
                
                // Attempt graceful shutdown of proc if present (pour le processus local)
                if (proc && typeof proc.kill === 'function') {
                    try {
                        proc.kill()
                    } catch (e) {
                        loggerLanding.warn('Failed to kill process directly', e)
                        try { proc.kill('SIGKILL') } catch (e2) {}
                    }
                }

                // Vider la liste des instances
                runningInstances.length = 0
                updateInstanceUI()

                // Restaurer l'UI après un court délai
                setTimeout(() => {
                    if (window.LaunchUI) {
                        window.LaunchUI.showReady();
                    }
                }, 500)

            } catch (e) {
                loggerLanding.error('Error handling stop button click', e)
                if (window.LaunchUI) {
                    window.LaunchUI.showReady();
                }
            }
        })
        console.log('[Landing] Stop button event listener bound successfully')
    } else {
        console.warn('[Landing] Stop button not found in DOM')
    }
} catch (e) { console.error('[Landing] Error binding stop button:', e) }

// Bind add instance button - lancer une instance supplémentaire
try {
    const addInstanceBtn = document.getElementById('add_instance_button')
    if (addInstanceBtn) {
        addInstanceBtn.addEventListener('click', async () => {
            loggerLanding.info('Add instance button clicked')
            
            // Vérifier qu'on peut encore lancer une instance
            if (getRunningInstanceCount() >= MAX_INSTANCES) {
                loggerLanding.warn('Max instances reached')
                return
            }
            
            // Déclencher le même processus de lancement que le bouton principal
            const launchBtn = document.getElementById('launch_button')
            if (launchBtn) {
                // Simuler un clic sur le bouton de lancement
                launchBtn.click()
            }
        })
        console.log('[Landing] Add instance button event listener bound successfully')
    }
} catch (e) { console.error('[Landing] Error binding add instance button:', e) }

// launch_other_button removed — logic consolidated to primary launch flow

// Bind settings button
document.getElementById('settingsMediaButton').onclick = async e => {
    try {
        if (typeof prepareSettings === 'function') await prepareSettings();
        else if (typeof window !== 'undefined' && typeof window.prepareSettings === 'function') await window.prepareSettings();
        else console.warn('[LANDING] prepareSettings not available on settings button click');
    } catch (err) {
        console.warn('[LANDING] prepareSettings threw', err);
    }
    switchView(getCurrentView(), VIEWS.settings)
}

// Bind avatar overlay button.
document.getElementById('avatarOverlay').onclick = async e => {
    try {
        if (typeof prepareSettings === 'function') await prepareSettings();
        else if (typeof window !== 'undefined' && typeof window.prepareSettings === 'function') await window.prepareSettings();
        else console.warn('[LANDING] prepareSettings not available on avatar overlay click');
    } catch (err) {
        console.warn('[LANDING] prepareSettings threw', err);
    }
    switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
        settingsNavItemListener(document.getElementById('settingsNavAccount'), false)
    })
            // Populate accounts list when opening settings
            try { populateSettingsAccounts() } catch (e) { console.warn('[LANDING] populateSettingsAccounts error', e) }
}

// NOTE: The quick switch-account button is now handled by the in-page
// account menu (landing.ejs). Do not auto-open Settings when the
// sidebar `#switchAccountButton` is clicked to allow the inline burger
// menu to manage account selection UX.

// Bind selected account
function updateSelectedAccount(authUser){
    let username = Lang.queryJS('landing.selectedAccount.noAccountSelected')
    const userTextElement = document.getElementById('user_text')
    const avatarContainer = document.getElementById('avatarContainer')
    const visibleUsername = document.getElementById('username') // visible in landing.ejs sidebar
    
    if(authUser != null){
        if(authUser.displayName != null){
            username = authUser.displayName
        }
        if(authUser.uuid != null){
            if (avatarContainer) {
                avatarContainer.style.backgroundImage = `url('https://mc-heads.net/avatar/${authUser.uuid}/40')`
                avatarContainer.style.backgroundSize = 'cover'
                avatarContainer.style.backgroundPosition = 'center'
            }
        }
    }
    if (userTextElement) userTextElement.innerHTML = username
    // Also set the visible sidebar username element (landing.ejs uses #username)
    if (visibleUsername) visibleUsername.innerHTML = username
}
updateSelectedAccount(ConfigManager.getSelectedAccount())

// Populate the accounts list in settings and bind select/remove actions
function populateSettingsAccounts() {
    try {
        const container = document.getElementById('settingsCurrentMicrosoftAccounts')
        if (!container) return
        const accounts = ConfigManager.getAuthAccounts() || {}
        container.innerHTML = ''
        const keys = Object.keys(accounts)
        if (keys.length === 0) {
            container.innerHTML = '<div class="text-sm text-gray-400">' + Lang.queryJS('settings.noAccounts') + '</div>'
            return
        }
        keys.forEach(uuid => {
            const acc = accounts[uuid]
            const wrap = document.createElement('div')
            wrap.className = 'flex items-center justify-between py-2'
            wrap.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded overflow-hidden" style="background-image:url(https://mc-heads.net/avatar/${uuid}/40);background-size:cover;background-position:center"></div>
                    <div>
                        <div class="text-white font-medium">${acc.displayName || acc.username || uuid}</div>
                        <div class="text-xs text-gray-400">${acc.type || ''}</div>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button class="btn btn-ghost select-account" data-uuid="${uuid}">${Lang.queryJS('settings.selectAccount') || 'Sélectionner'}</button>
                    <button class="btn btn-danger remove-account" data-uuid="${uuid}">${Lang.queryJS('settings.removeAccount') || 'Supprimer'}</button>
                </div>
            `
            container.appendChild(wrap)
        })

        // bind actions
        container.querySelectorAll('.select-account').forEach(b => {
            b.onclick = (e) => {
                const uuid = b.getAttribute('data-uuid')
                ConfigManager.setSelectedAccount(uuid)
                ConfigManager.save()
                updateSelectedAccount(ConfigManager.getSelectedAccount())
            }
        })
        container.querySelectorAll('.remove-account').forEach(b => {
            b.onclick = (e) => {
                const uuid = b.getAttribute('data-uuid')
                if (!confirm(Lang.queryJS('settings.removeAccountConfirm') || 'Supprimer ce compte ?')) return
                ConfigManager.removeAuthAccount(uuid)
                ConfigManager.save()
                populateSettingsAccounts()
                updateSelectedAccount(ConfigManager.getSelectedAccount())
            }
        })
    } catch (e) {
        console.warn('[LANDING] populateSettingsAccounts failed', e)
    }
}

/**
 * Update the visual selection in the sidebar
 */
function updateSidebarSelection(selectedServerId) {
    const prevBtn = document.querySelector('.server-instance-btn.selected')
    const nextBtn = document.querySelector('.server-instance-btn[data-server-id="' + (selectedServerId || '') + '"]')

    // If neither buttons found fallback to basic loop
    if(!prevBtn && !nextBtn){
        const instanceButtons = document.querySelectorAll('.server-instance-btn')
        instanceButtons.forEach(button => {
            const serverId = button.getAttribute('data-server-id')
            const img = button.querySelector('img')
            if (serverId === selectedServerId) {
                button.classList.add('selected')
                if (img) { img.classList.remove('border-white/20'); img.classList.add('border-[#F8BA59]') }
            } else {
                button.classList.remove('selected')
                if (img) { img.classList.remove('border-[#F8BA59]'); img.classList.add('border-white/20') }
            }
        })
        return
    }

    // If same button selected, do nothing
    if(prevBtn === nextBtn) return

    // Animate swap with cancellation support
    animateButtonSwap(prevBtn, nextBtn).catch(e => { console.debug('animateButtonSwap error', e) })
}

// Make function globally accessible
window.updateSidebarSelection = updateSidebarSelection

/**
 * Update server technical information (mods, RAM allocation, update status)
 */
function updateServerTechnicalInfo(serv) {
    const modsCard = document.getElementById('modsCard')
    const modsCount = document.getElementById('modsCount')
    const ramAllocation = document.getElementById('ramAllocation')
    const updateStatusEl = document.getElementById('updateStatus')
    const updateStatusTitle = document.getElementById('updateStatusTitle')
    const updateStatusDesc = document.getElementById('updateStatusDesc')
    const updateStatusIcon = document.getElementById('updateStatusIcon')
    
    if (serv != null) {
        // Count mods
        let modCount = 0
        try {
            const modules = serv.modules
            if (modules && Array.isArray(modules)) {
                modCount = modules.filter(m => m.rawModule && m.rawModule.type === 'ForgeMod').length
            }
        } catch (e) {
            console.debug('[Landing] Failed to count mods', e)
        }
        
        // Update mods card
        if (modsCard && modsCount) {
            if (modCount > 0) {
                modsCard.style.display = 'block'
                modsCount.textContent = `${modCount} actifs`
            } else {
                modsCard.style.display = 'none'
            }
        }
        
        // Update RAM allocation
        if (ramAllocation) {
            try {
                const selectedServer = ConfigManager.getSelectedServer()
                const javaOptions = ConfigManager.getServerJavaOptions(selectedServer)
                if (javaOptions && javaOptions.maxRAM) {
                    const ramGB = Math.round(javaOptions.maxRAM / 1024)
                    ramAllocation.textContent = `${ramGB} GB`
                } else {
                    ramAllocation.textContent = 'Auto'
                }
            } catch (e) {
                ramAllocation.textContent = 'Auto'
            }
        }
        
        // Update status info
        if (updateStatusEl && updateStatusTitle && updateStatusDesc && updateStatusIcon) {
            updateStatusEl.style.display = 'flex'
            updateStatusTitle.textContent = 'Prêt à jouer'
            updateStatusDesc.textContent = 'Aucune mise à jour'
            updateStatusIcon.className = 'w-12 h-12 rounded-xl bg-gradient-to-br from-green-500/20 to-green-600/20 border border-green-500/30 flex items-center justify-center'
            updateStatusIcon.innerHTML = '<i class="bi bi-check-circle-fill text-green-400 text-xl"></i>'
        }
    } else {
        // Hide all when no server selected
        if (modsCard) modsCard.style.display = 'none'
        if (ramAllocation) ramAllocation.textContent = 'Auto'
        if (updateStatusEl) updateStatusEl.style.display = 'none'
    }
}

// Bind selected server
async function updateSelectedServer(serv, instant = true){
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()
    
    // Update server info in the new UI. Force instant updates for performance
    const serverTitle = document.querySelector('.server-title')
    const serverDesc = document.querySelector('.server-desc')
    const serverVersion = document.querySelector('.server-version')
    const serverLoader = document.querySelector('.server-loader')
    const serverStatusName = document.querySelector('.server-status-name')
    const playInstance = document.querySelector('.play-instance')

    // Always use instant updates for better performance
    try {
        if (serv != null) {
            const titleHtml = DOMPurify.sanitize(serv.rawServer.name || '')
            const descHtml = DOMPurify.sanitize(serv.rawServer.description || '')
            if (serverTitle) serverTitle.innerHTML = titleHtml
            if (serverDesc) serverDesc.innerHTML = descHtml
            if (serverVersion) serverVersion.textContent = serv.rawServer.minecraftVersion || '--'
            if (serverLoader) serverLoader.textContent = serv.rawServer.loader || '--'
            if (serverStatusName) serverStatusName.textContent = serv.rawServer.name
        } else {
            if (serverTitle) serverTitle.innerHTML = 'Veuillez sélectionner une instance'
            if (serverDesc) serverDesc.innerHTML = 'Aucune instance sélectionnée.<br>Choisissez une instance pour voir ses informations.'
            if (serverVersion) serverVersion.textContent = '--'
            if (serverLoader) serverLoader.textContent = '--'
            if (serverStatusName) serverStatusName.textContent = 'Multigames-Studio.fr'
        }
    } catch (e) {
        console.debug('[Landing] instant updateSelectedServer failed', e)
    }
    
    // Update server technical info (mods count, RAM allocation)
    try {
        updateServerTechnicalInfo(serv)
    } catch (e) {
        console.debug('[Landing] updateServerTechnicalInfo failed', e)
    }
    
    // Update sidebar visual selection
    updateSidebarSelection(serv != null ? serv.rawServer.id : null)
    
    // Update old UI for compatibility
    const serverSelectionButton = document.getElementById('server_selection_button')
    if (serverSelectionButton) {
        const selName = serv != null ? (serv.rawServer.name || '') : Lang.queryJS('landing.noSelection')
        serverSelectionButton.innerHTML = '&#8226; ' + DOMPurify.sanitize(selName)
    }
    
    if(getCurrentView() === VIEWS.settings){
        animateSettingsTabRefresh()
    }
    setLaunchEnabled(serv != null)
    // Refresh launch button UI based on per-instance state
    try {
        const selectedId = serv != null ? serv.rawServer.id : null
        if (typeof window.updateLaunchUIForServer === 'function') window.updateLaunchUIForServer(selectedId)
    } catch (e) { console.debug('[Landing] update launch UI failed', e) }
}

// Make function globally accessible
window.updateSelectedServer = updateSelectedServer

/**
 * Set the selected instance (for modpack card compatibility)
 */
function setSelectedInstance(instance) {
    console.log('[INSTANCE] setSelectedInstance called with:', instance)
    
    if (!instance || !instance.server) {
        console.error('[INSTANCE] Invalid instance or missing server reference')
        return
    }
    
    // Use the existing updateSelectedServer function
    updateSelectedServer(instance.server)
}

// Make function globally accessible
window.setSelectedInstance = setSelectedInstance
// Real text is set in uibinder.js on distributionIndexDone.
server_selection_button.innerHTML = '&#8226; ' + Lang.queryJS('landing.selectedServer.loading')
server_selection_button.onclick = async e => {
    e.target.blur()
    await toggleServerSelection(true)
}

// Update Mojang Status Color
const refreshMojangStatuses = async function(){
    loggerLanding.info('Refreshing Mojang Statuses..')

    let status = 'grey'
    let tooltipEssentialHTML = ''
    let tooltipNonEssentialHTML = ''

    const response = await MojangRestAPI.status()
    let statuses
    if(response.responseStatus === RestResponseStatus.SUCCESS) {
        statuses = response.data
    } else {
        loggerLanding.warn('Unable to refresh Mojang service status.')
        statuses = MojangRestAPI.getDefaultStatuses()
    }

    greenCount = 0
    greyCount = 0

    for(let i=0; i<statuses.length; i++){
        const service = statuses[i]

        const tooltipHTML = `<div class="mojangStatusContainer">
            <span class="mojangStatusIcon" style="color: ${MojangRestAPI.statusToHex(service.status)};">&#8226;</span>
            <span class="mojangStatusName">${service.name}</span>
        </div>`
        if(service.essential){
            tooltipEssentialHTML += tooltipHTML
        } else {
            tooltipNonEssentialHTML += tooltipHTML
        }

        if(service.status === 'yellow' && status !== 'red'){
            status = 'yellow'
        } else if(service.status === 'red'){
            status = 'red'
        } else {
            if(service.status === 'grey'){
                ++greyCount
            }
            ++greenCount
        }

    }

    if(greenCount === statuses.length){
        if(greyCount === statuses.length){
            status = 'grey'
        } else {
            status = 'green'
        }
    }
    
    const mojangEssEl = document.getElementById('mojangStatusEssentialContainer')
    const mojangNonEssEl = document.getElementById('mojangStatusNonEssentialContainer')
    if (mojangEssEl) mojangEssEl.innerHTML = DOMPurify.sanitize(tooltipEssentialHTML)
    if (mojangNonEssEl) mojangNonEssEl.innerHTML = DOMPurify.sanitize(tooltipNonEssentialHTML)
    document.getElementById('mojang_status_icon').style.color = MojangRestAPI.statusToHex(status)
}

const refreshServerStatus = async (fade = false) => {
    loggerLanding.info('Refreshing Server Status')
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())

    let pLabel = Lang.queryJS('landing.serverStatus.server')
    let pVal = Lang.queryJS('landing.serverStatus.offline')
    let isOnline = false
    let currentPlayers = 0
    let maxPlayers = 0

    try {
        const servStat = await getServerStatus(47, serv.hostname, serv.port)
        console.log(servStat)
        pLabel = Lang.queryJS('landing.serverStatus.players')
        pVal = servStat.players.online + '/' + servStat.players.max
        isOnline = true
        currentPlayers = servStat.players.online
        maxPlayers = servStat.players.max
    } catch (err) {
        loggerLanding.warn('Unable to refresh server status, assuming offline.')
        loggerLanding.debug(err)
    }
    
    // Update new modern UI elements
    const playerCountCard = document.getElementById('playerCountCard')
    const playerCount = document.getElementById('playerCount')
    const serverStatusCard = document.getElementById('serverStatusCard')
    const serverStatusDot = document.getElementById('serverStatusDot')
    const serverStatusText = document.getElementById('serverStatusText')
    const statusBadge = document.getElementById('statusBadge')
    const statusBadgeDot = document.getElementById('statusBadgeDot')
    const statusBadgePing = document.getElementById('statusBadgePing')
    const statusBadgeText = document.getElementById('statusBadgeText')
    
    if (isOnline) {
        // Show and update player count card
        if (playerCountCard) {
            playerCountCard.style.display = 'block'
            playerCountCard.className = 'glass-card px-4 py-3 rounded-xl border border-[#F8BA59]/20 hover:border-[#F8BA59]/50 transition-all duration-300 group cursor-pointer'
        }
        if (playerCount) playerCount.textContent = currentPlayers
        
        // Update server status card - online
        if (serverStatusCard) {
            serverStatusCard.className = 'glass-card px-4 py-3 rounded-xl border border-green-500/20 hover:border-green-500/50 transition-all duration-300 group cursor-pointer'
        }
        if (serverStatusDot) {
            serverStatusDot.className = 'w-3 h-3 rounded-full bg-green-400 animate-pulse'
        }
        if (serverStatusText) {
            serverStatusText.textContent = 'En ligne'
        }
        
        // Update status badge

        if (statusBadgeDot) {
            statusBadgeDot.className = 'w-2.5 h-2.5 rounded-full bg-green-400'
        }
        if (statusBadgePing) {
            statusBadgePing.style.display = 'block'
            statusBadgePing.className = 'absolute inset-0 w-2.5 h-2.5 rounded-full bg-green-400 animate-ping'
        }
        if (statusBadgeText) {
            statusBadgeText.textContent = 'Serveur opérationnel'
            statusBadgeText.className = 'text-green-400 text-xs font-bold uppercase tracking-widest'
        }
    } else {
        // Hide player count card when offline
        if (playerCountCard) playerCountCard.style.display = 'none'
        
        // Update server status card - offline
        if (serverStatusCard) {
            serverStatusCard.className = 'glass-card px-4 py-3 rounded-xl border border-red-500/20 hover:border-red-500/50 transition-all duration-300 group cursor-pointer'
        }
        if (serverStatusDot) {
            serverStatusDot.className = 'w-3 h-3 rounded-full bg-red-400'
        }
        if (serverStatusText) {
            serverStatusText.textContent = 'Hors ligne'
        }
        
        // Update status badge
        if (statusBadge) {
            statusBadge.style.display = 'inline-flex'
            statusBadge.className = 'inline-flex items-center gap-3 glass-card px-5 py-2.5 rounded-full w-fit border border-red-500/30 shadow-lg shadow-red-500/10'
        }
        if (statusBadgeDot) {
            statusBadgeDot.className = 'w-2.5 h-2.5 rounded-full bg-red-400'
        }
        if (statusBadgePing) {
            statusBadgePing.style.display = 'none'
        }
        if (statusBadgeText) {
            statusBadgeText.textContent = 'Serveur hors ligne'
            statusBadgeText.className = 'text-red-400 text-xs font-bold uppercase tracking-widest'
        }
    }
    
    // Update old UI for compatibility
    const playerCountNew = document.querySelector('.player-count')
    const serverStatusDotOld = document.querySelector('.server-status-dot')
    const serverStatusTextOld = document.querySelector('.server-status-text')
    
    if (playerCountNew) playerCountNew.textContent = currentPlayers || '0'
    
    // Update server status dot color based on online/offline
    if (serverStatusDotOld) {
        if (!isOnline) {
            serverStatusDotOld.className = 'server-status-dot w-3 h-3 rounded-full bg-red-400'
        } else {
            serverStatusDotOld.className = 'server-status-dot w-3 h-3 rounded-full bg-green-400'
        }
    }
    
    if (serverStatusTextOld) {
        const status = !isOnline ? 'Hors ligne' : 'Opérationnel'
        serverStatusTextOld.innerHTML = `${status} • <span class="font-bold text-[#F8BA59] player-count">${currentPlayers || '0'}</span> joueurs`
    }
    
    if(fade && typeof $ !== 'undefined'){
        $('#server_status_wrapper').fadeOut(250, () => {
            const landingPlayerLabel = document.getElementById('landingPlayerLabel')
            const playerCountEl = document.getElementById('player_count')
            if (landingPlayerLabel) landingPlayerLabel.innerHTML = pLabel
            if (playerCountEl) playerCountEl.innerHTML = pVal
            $('#server_status_wrapper').fadeIn(500)
        })
    } else {
        const landingPlayerLabel = document.getElementById('landingPlayerLabel')
        const playerCountEl = document.getElementById('player_count')
        if (landingPlayerLabel) landingPlayerLabel.innerHTML = pLabel
        if (playerCountEl) playerCountEl.innerHTML = pVal
    }
}

refreshMojangStatuses()
// Server Status is refreshed in uibinder.js on distributionIndexDone.

// Refresh statuses every hour. The status page itself refreshes every day so...
let mojangStatusListener = setInterval(() => refreshMojangStatuses(true), 60*60*1000)
// Set refresh rate to once every 5 minutes.
let serverStatusListener = setInterval(() => refreshServerStatus(true), 300000)

/**
 * Shows an error overlay, toggles off the launch area.
 * 
 * @param {string} title The overlay title.
 * @param {string} desc The overlay description.
 */
function showLaunchFailure(title, desc){
    setOverlayContent(
        title,
        desc,
        Lang.queryJS('landing.launch.okay')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
}

/* System (Java) Scan */

/**
 * Asynchronously scan the system for valid Java installations.
 * 
 * @param {boolean} launchAfter Whether we should begin to launch after scanning. 
 */
async function asyncSystemScan(effectiveJavaOptions, launchAfter = true){

    setLaunchDetails(Lang.queryJS('landing.systemScan.checking'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    let jvmDetails = null
    try {
        jvmDetails = await discoverBestJvmInstallation(
            ConfigManager.getDataDirectory(),
            effectiveJavaOptions.supported
        )
    } catch (jvmScanErr) {
        // Handle errors from helios-core JavaGuard (e.g., null registry values on Windows)
        loggerLanding.error('Error during JVM discovery, treating as no Java found:', jvmScanErr)
        jvmDetails = null
    }

    if(jvmDetails == null) {
        // If the result is null, no valid Java installation was found.
        // Show this information to the user.
        setOverlayContent(
            Lang.queryJS('landing.systemScan.noCompatibleJava'),
            Lang.queryJS('landing.systemScan.installJavaMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
            Lang.queryJS('landing.systemScan.installJava'),
            Lang.queryJS('landing.systemScan.installJavaManually')
        )
        setOverlayHandler(() => {
            setLaunchDetails(Lang.queryJS('landing.systemScan.javaDownloadPrepare'))
            toggleOverlay(false)
            
            try {
                downloadJava(effectiveJavaOptions, launchAfter)
            } catch(err) {
                loggerLanding.error('Unhandled error in Java Download', err)
                showLaunchFailure(Lang.queryJS('landing.systemScan.javaDownloadFailureTitle'), Lang.queryJS('landing.systemScan.javaDownloadFailureText'))
            }
        })
        setDismissHandler(() => {
            $('#overlayContent').fadeOut(250, () => {
                //$('#overlayDismiss').toggle(false)
                setOverlayContent(
                    Lang.queryJS('landing.systemScan.javaRequired', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredDismiss'),
                    Lang.queryJS('landing.systemScan.javaRequiredCancel')
                )
                setOverlayHandler(() => {
                    toggleLaunchArea(false)
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    toggleOverlay(false, true)

                    asyncSystemScan(effectiveJavaOptions, launchAfter)
                })
                $('#overlayContent').fadeIn(250)
            })
        })
        toggleOverlay(true, true)
    } else {
        // Java installation found, use this to launch the game.
        const javaExec = javaExecFromRoot(jvmDetails.path)
        ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), javaExec)
        ConfigManager.save()

        // We need to make sure that the updated value is on the settings UI.
        // The settings DOM may not be mounted when this runs, so query
        // the element at runtime and guard against null.
        try {
            const sj = document.getElementById('settingsJavaExecVal')
            if (sj) {
                sj.value = javaExec
                if (typeof populateJavaExecDetails === 'function') await populateJavaExecDetails(sj.value)
            } else {
                // If the settings input is not present, still attempt to
                // update the details UI if the function is available.
                if (typeof populateJavaExecDetails === 'function') await populateJavaExecDetails(javaExec)
            }
        } catch (e) {
            // Defensive: don't let a UI update break the launch flow.
            console.debug('[Landing] Failed to update settings Java exec UI', e)
        }

        // TODO Callback hell, refactor
        // TODO Move this out, separate concerns.
        if(launchAfter){
            await dlAsync()
        }
    }

}

async function downloadJava(effectiveJavaOptions, launchAfter = true) {

    // TODO Error handling.
    // asset can be null.
    const asset = await latestOpenJDK(
        effectiveJavaOptions.suggestedMajor,
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.distribution)

    if(asset == null) {
        throw new Error(Lang.queryJS('landing.downloadJava.findJdkFailure'))
    }

    let received = 0
    try {
        await fs.ensureDir(path.dirname(asset.path))
    } catch (e) {
        console.warn('[Landing] Failed to ensure Java download directory exists:', path.dirname(asset.path), e)
    }
    console.log('[Landing] Downloading Java asset:', asset.url, '->', asset.path)
    await safeDownload(asset.url, asset.path, ({ transferred }) => {
        received = transferred
        setDownloadPercentage(Math.trunc((transferred/asset.size)*100))
    })
    console.log('[Landing] Java download finished, received bytes:', received)
    setDownloadPercentage(100)

    if(received != asset.size) {
        loggerLanding.warn(`Java Download: Expected ${asset.size} bytes but received ${received}`)
        if(!await validateLocalFile(asset.path, asset.algo, asset.hash)) {
            log.error(`Hashes do not match, ${asset.id} may be corrupted.`)
            // Don't know how this could happen, but report it.
            throw new Error(Lang.queryJS('landing.downloadJava.javaDownloadCorruptedError'))
        }
    }

    // Extract
    // Show installing progress bar.
    remote.getCurrentWindow().setProgressBar(2)

    // Wait for extration to complete.
    const eLStr = Lang.queryJS('landing.downloadJava.extractingJava')
    let dotStr = ''
    setLaunchDetails(eLStr)
    const extractListener = setInterval(() => {
        if(dotStr.length >= 3){
            dotStr = ''
        } else {
            dotStr += '.'
        }
        setLaunchDetails(eLStr + dotStr)
    }, 750)

    const newJavaExec = await extractJdk(asset.path)

    // Extraction complete, remove the loading from the OS progress bar.
    remote.getCurrentWindow().setProgressBar(-1)

    // Extraction completed successfully.
    ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), newJavaExec)
    ConfigManager.save()

    clearInterval(extractListener)
    setLaunchDetails(Lang.queryJS('landing.downloadJava.javaInstalled'))

    // TODO Callback hell
    // Refactor the launch functions
    asyncSystemScan(effectiveJavaOptions, launchAfter)

}

// Keep reference to Minecraft Process
let proc
// Is DiscordRPC enabled
let hasRPC = false
// Joined server regex
// Change this if your server uses something different.
const GAME_JOINED_REGEX = /\[.+\]: Sound engine started/
const GAME_LAUNCH_REGEX = /^\[.+\]: (?:MinecraftForge .+ Initialized|ModLauncher .+ starting: .+|Loading Minecraft .+ with Fabric Loader .+)$/
const MIN_LINGER = 5000

/**
 * Generate a deterministic offline-style UUID from a player name.
 * Uses MD5('OfflinePlayer:' + name) and formats as UUID.
 */
function generateOfflineUUID(name){
    try {
        const h = cryptoNode.createHash('md5').update('OfflinePlayer:' + name).digest('hex')
        return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`
    } catch (e) {
        // fallback simple uuid-like string
        return '00000000-0000-0000-0000-000000000000'
    }
}

function createOfflineAuth(selectedAccount){
    const name = selectedAccount && selectedAccount.displayName ? selectedAccount.displayName : 'Player'
    const uuid = selectedAccount && selectedAccount.uuid ? selectedAccount.uuid : generateOfflineUUID(name)
    return {
        displayName: name,
        uuid: uuid,
        accessToken: '0',
        type: 'mojang'
    }
}

/**
 * Compute MD5 of a file
 * @param {string} filePath
 * @returns {Promise<string>} hex md5
 */
async function computeFileMD5(filePath) {
    try {
        const buf = await fs.readFile(filePath)
        return cryptoNode.createHash('md5').update(buf).digest('hex')
    } catch (e) {
        return null
    }
}


/**
 * Ensure distribution 'File' modules (config files) exist in the instance.
 * If missing or MD5 mismatches, download and install the artifact into the instance.
 * @param {Object} serv - distribution server wrapper
 */
async function checkAndRestoreFileModules(serv) {
    const logger = LoggerUtil.getLogger('FileInstaller')
    console.log('[FileInstaller] checkAndRestoreFileModules called for server:', serv && serv.rawServer && serv.rawServer.id)
    if (!serv || !serv.rawServer || !Array.isArray(serv.modules)) return

    const instanceBase = ConfigManager.getInstanceDirectory()
    if (!instanceBase) return

    for (const mod of serv.modules) {
        try {
            if (!mod || !mod.rawModule) continue
            if (mod.rawModule.type !== 'File') continue

            // Get artifact object
            const artifact = (typeof mod.getArtifact === 'function') ? mod.getArtifact() : (mod.rawModule && mod.rawModule.artifact ? mod.rawModule.artifact : null)
            if (!artifact) {
                logger.warn && logger.warn('File module has no artifact', mod.rawModule && mod.rawModule.id)
                continue
            }

            // Determine relative target path inside instance (e.g., config/foo/bar.txt)
            const targetRel = (artifact.path) || (mod.rawModule && mod.rawModule.artifact && mod.rawModule.artifact.path)
            if (!targetRel) {
                logger.warn && logger.warn('File module artifact missing path', mod.rawModule && mod.rawModule.id)
                continue
            }

            // Only handle config/ paths
            if (!/^config[\\\/]/i.test(targetRel)) continue

            const dest = path.join(instanceBase, serv.rawServer.id, targetRel)

            let needsInstall = false
            if (!fs.existsSync(dest)) {
                needsInstall = true
                logger.info && logger.info('Missing config file, will install:', targetRel)
            } else if (artifact.MD5 || artifact.md5 || artifact.Md5) {
                const expected = (artifact.MD5 || artifact.md5 || artifact.Md5 || '').toString().toLowerCase()
                const actual = await computeFileMD5(dest)
                if (!actual || actual.toLowerCase() !== expected) {
                    needsInstall = true
                    logger.info && logger.info('Config file MD5 mismatch, will reinstall:', targetRel)
                }
            }

            if (!needsInstall) {
                console.log('[FileInstaller] OK:', targetRel, 'exists and matches')
                continue
            }

            // Download artifact to temp location then copy to destination
            const tmpDir = path.join(ConfigManager.getCommonDirectory(), 'file-cache')
            await fs.ensureDir(tmpDir)
            const tmpPath = path.join(tmpDir, path.basename(targetRel))

            try {
                if (!artifact.url) {
                    logger.warn && logger.warn('Artifact URL missing for', targetRel)
                    console.warn('[FileInstaller] Artifact URL missing for', targetRel, 'artifact=', artifact)
                    continue
                }

                console.log('[FileInstaller] Downloading', artifact.url, 'to', tmpPath)
                // downloadFile is available in this module
                await safeDownload(artifact.url, tmpPath)

                // validate MD5 if available
                if (artifact.MD5 || artifact.md5 || artifact.Md5) {
                    const expected = (artifact.MD5 || artifact.md5 || artifact.Md5 || '').toString().toLowerCase()
                    const actual = await computeFileMD5(tmpPath)
                    if (!actual || actual.toLowerCase() !== expected) {
                        logger.error && logger.error('Downloaded file MD5 does not match expected for', targetRel)
                        console.error('[FileInstaller] MD5 mismatch for downloaded file', tmpPath, 'expected=', expected, 'actual=', actual)
                        continue
                    }
                }

                await fs.ensureDir(path.dirname(dest))
                await fs.copy(tmpPath, dest, { overwrite: true })
                logger.info && logger.info('Installed config file:', dest)
                console.log('[FileInstaller] Installed config file:', dest)
            } catch (e) {
                logger.error && logger.error('Failed to download/install config file', targetRel, e)
                console.error('[FileInstaller] Failed to download/install config file', targetRel, e)
            }
        } catch (e) {
            LoggerUtil.getLogger('FileInstaller').debug && LoggerUtil.getLogger('FileInstaller').debug('Error processing file module', e)
        }
    }
}

/**
 * Backup user-provided resourcepacks before aggressive repair runs.
 * Copies the entire 'resourcepacks' folder to a backup location.
 * @param {Object} serv
 * @returns {string|null} backupDir or null
 */
async function backupResourcePacks(serv) {
    try {
        const instanceBase = ConfigManager.getInstanceDirectory()
        if (!instanceBase) return null
        const rpDir = path.join(instanceBase, serv.rawServer.id, 'resourcepacks')
        if (!fs.existsSync(rpDir)) return null

        const backupDir = path.join(ConfigManager.getCommonDirectory(), 'backups', serv.rawServer.id, `resourcepacks-${Date.now()}`)
        await fs.ensureDir(path.dirname(backupDir))
        console.log('[ResourcePackBackup] Backing up resourcepacks', rpDir, '->', backupDir)
        // Use copy to avoid removing originals in case of failures
        await fs.copy(rpDir, backupDir)
        return backupDir
    } catch (e) {
        console.error('[ResourcePackBackup] Failed to backup resourcepacks', e)
        return null
    }
}

/**
 * Restore backed-up resourcepacks after repair. Will not overwrite existing files.
 * @param {Object} serv
 * @param {string} backupDir
 */
async function restoreResourcePacks(serv, backupDir) {
    try {
        if (!backupDir || !fs.existsSync(backupDir)) return
        const instanceBase = ConfigManager.getInstanceDirectory()
        if (!instanceBase) return
        const rpDir = path.join(instanceBase, serv.rawServer.id, 'resourcepacks')
        await fs.ensureDir(rpDir)
        console.log('[ResourcePackBackup] Restoring resourcepacks from', backupDir, '->', rpDir)
        // Copy with overwrite = false to preserve any files placed by FullRepair (distribution-provided)
        await fs.copy(backupDir, rpDir, { overwrite: false, errorOnExist: false })
        // Optionally remove backup (keep for diagnostics)
        try { await fs.remove(backupDir) } catch (e) { /* ignore */ }
    } catch (e) {
        console.error('[ResourcePackBackup] Failed to restore resourcepacks', e)
    }
}


/**
 * Safely obtain the artifact object from a module wrapper or raw module.
 * @param {Object} mod
 */
function getModuleArtifact(mod) {
    if (!mod) return null
    try {
        if (typeof mod.getArtifact === 'function') return mod.getArtifact()
    } catch (e) {}
    if (mod.artifact) return mod.artifact
    if (mod.rawModule && mod.rawModule.artifact) return mod.rawModule.artifact
    return null
}


/**
 * Resolve a local filesystem path for an artifact. Uses artifact.getPath() if available,
 * otherwise falls back to common directory + basename(url) or artifact.path.
 * @param {Object} artifact
 */
function resolveArtifactLocalPath(artifact) {
    if (!artifact) return null
    try {
        if (typeof artifact.getPath === 'function') return artifact.getPath()
    } catch (e) {}
    if (artifact.path && fs.existsSync(artifact.path)) return artifact.path
    if (artifact.url) return path.join(ConfigManager.getCommonDirectory(), path.basename(artifact.url))
    if (artifact.path) return path.join(ConfigManager.getCommonDirectory(), path.basename(artifact.path))
    return null
}

/**
 * Wrapper around downloadFile to add logging and better error context.
 * @param {string} url
 * @param {string} dest
 * @param {function} progressCb
 */
async function safeDownload(url, dest, progressCb) {
    const lg = LoggerUtil.getLogger('Downloader')
    try {
        if (!url) throw new Error('safeDownload: missing url')
        if (!dest) throw new Error('safeDownload: missing destination path')
        try { await fs.ensureDir(path.dirname(dest)) } catch (e) { lg && lg.warn && lg.warn('safeDownload: ensureDir failed', path.dirname(dest), e) }
        console.log('[Downloader] Starting', url, '->', dest)
        await downloadFile(url, dest, progressCb)
        console.log('[Downloader] Completed', url, '->', dest)
        return dest
    } catch (e) {
        lg && lg.error && lg.error('safeDownload failed for', url, '->', dest, e)
        console.error('[Downloader] failed for', url, '->', dest, e)
        throw e
    }
}

/**
 * Comprehensive recovery function for missing mod loader files
 * Attempts to identify and download all missing components needed for mod loading
 * @param {Object} serv - Server configuration
 * @param {Error} originalError - The original error that triggered the recovery
 * @returns {Promise<{success: boolean, modLoaderData?: Object, error?: string}>}
 */
async function comprehensiveModLoaderRecovery(serv, originalError) {
    const logger = LoggerUtil.getLogger('ModLoaderRecovery')
    logger.info('Starting comprehensive mod loader recovery...')
    
    try {
        // Step 1: Find and recover VersionManifest files
        setLaunchDetails('Téléchargement des fichiers de version manquants...')
        await recoverVersionManifestFiles(serv)
        
        // Step 2: Verify and recover Fabric loader artifacts
        setLaunchDetails('Vérification du Fabric loader...')
        await recoverFabricLoaderFiles(serv)
        
        // Step 3: Verify and recover any missing libraries
        setLaunchDetails('Vérification des bibliothèques...')
        await recoverMissingLibraries(serv)
        
        // Step 4: Try to load the mod loader version JSON again
        setLaunchDetails('Rechargement des données de mod loader...')
        const distributionIndexProcessor = new DistributionIndexProcessor(
            ConfigManager.getCommonDirectory(),
            await DistroAPI.getDistribution(),
            serv.rawServer.id
        )
        
        const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
        
        logger.info('Mod loader recovery completed successfully')
        return { success: true, modLoaderData }
        
    } catch (error) {
        logger.error('Comprehensive mod loader recovery failed:', error)
        return { success: false, error: error.message }
    }
}

/**
 * Recover missing VersionManifest files for all mod loaders
 * @param {Object} serv - Server configuration
 */
async function recoverVersionManifestFiles(serv) {
    const logger = LoggerUtil.getLogger('VersionManifestRecovery')
    
    // Find all mod loader modules (Fabric, Forge, etc.)
    const modLoaderModules = serv.modules.filter(m => 
        ['Fabric', 'Forge', 'ForgeHosted'].includes(m.rawModule.type)
    )
    
    for (const modLoaderModule of modLoaderModules) {
        if (modLoaderModule.subModules) {
            const versionManifests = modLoaderModule.subModules.filter(sm => 
                sm.rawModule.type === 'VersionManifest'
            )
            
            for (const versionManifest of versionManifests) {
                try {
                    const artifact = getModuleArtifact(versionManifest)
                    if (!artifact || !artifact.url) {
                        logger.warn(`No artifact or URL for VersionManifest: ${versionManifest.rawModule.id}`)
                        continue
                    }
                    
                    const targetPath = resolveVersionManifestPath(artifact, versionManifest.rawModule.id)
                    
                    // Check if file exists and has correct MD5
                    if (await validateFileIntegrity(targetPath, artifact)) {
                        logger.info(`VersionManifest OK: ${versionManifest.rawModule.id}`)
                        continue
                    }
                    
                    logger.info(`Downloading VersionManifest: ${versionManifest.rawModule.id} from ${artifact.url}`)
                    await safeDownload(artifact.url, targetPath)
                    
                    // Validate the downloaded file
                    if (!(await validateFileIntegrity(targetPath, artifact))) {
                        throw new Error(`Downloaded VersionManifest failed integrity check: ${targetPath}`)
                    }
                    
                    logger.info(`VersionManifest recovered: ${versionManifest.rawModule.id}`)
                    
                } catch (error) {
                    logger.error(`Failed to recover VersionManifest ${versionManifest.rawModule.id}:`, error)
                    throw error
                }
            }
        }
    }
}

/**
 * Recover missing Fabric loader files
 * @param {Object} serv - Server configuration
 */
async function recoverFabricLoaderFiles(serv) {
    const logger = LoggerUtil.getLogger('FabricRecovery')
    
    const fabricModules = serv.modules.filter(m => m.rawModule.type === 'Fabric')
    
    for (const fabricModule of fabricModules) {
        try {
            const artifact = getModuleArtifact(fabricModule)
            if (!artifact || !artifact.url) {
                logger.warn(`No artifact or URL for Fabric module: ${fabricModule.rawModule.id}`)
                continue
            }
            
            const targetPath = resolveFabricLoaderPath(artifact, fabricModule.rawModule.id)
            
            // Check if file exists and has correct MD5
            if (await validateFileIntegrity(targetPath, artifact)) {
                logger.info(`Fabric loader OK: ${fabricModule.rawModule.id}`)
                continue
            }
            
            logger.info(`Downloading Fabric loader: ${fabricModule.rawModule.id} from ${artifact.url}`)
            await safeDownload(artifact.url, targetPath)
            
            // Validate the downloaded file
            if (!(await validateFileIntegrity(targetPath, artifact))) {
                throw new Error(`Downloaded Fabric loader failed integrity check: ${targetPath}`)
            }
            
            logger.info(`Fabric loader recovered: ${fabricModule.rawModule.id}`)
            
        } catch (error) {
            logger.error(`Failed to recover Fabric loader ${fabricModule.rawModule.id}:`, error)
            throw error
        }
    }
}

/**
 * Recover missing library files
 * @param {Object} serv - Server configuration  
 */
async function recoverMissingLibraries(serv) {
    const logger = LoggerUtil.getLogger('LibraryRecovery')
    
    // Find all library modules
    const libraryModules = []
    
    function collectLibraries(modules) {
        for (const module of modules) {
            if (module.rawModule.type === 'Library') {
                libraryModules.push(module)
            }
            if (module.subModules) {
                collectLibraries(module.subModules)
            }
        }
    }
    
    collectLibraries(serv.modules)
    
    for (const libraryModule of libraryModules) {
        try {
            const artifact = getModuleArtifact(libraryModule)
            if (!artifact || !artifact.url) {
                logger.warn(`No artifact or URL for library: ${libraryModule.rawModule.id}`)
                continue
            }
            
            const targetPath = resolveLibraryPath(artifact, libraryModule.rawModule.id)
            
            // Check if file exists and has correct MD5
            if (await validateFileIntegrity(targetPath, artifact)) {
                continue // File is OK
            }
            
            logger.info(`Downloading library: ${libraryModule.rawModule.id} from ${artifact.url}`)
            await safeDownload(artifact.url, targetPath)
            
            // Validate the downloaded file
            if (!(await validateFileIntegrity(targetPath, artifact))) {
                throw new Error(`Downloaded library failed integrity check: ${targetPath}`)
            }
            
        } catch (error) {
            // Non-critical error - log but continue
            logger.warn(`Failed to recover library ${libraryModule.rawModule.id}: ${error.message}`)
        }
    }
}

/**
 * Resolve the correct path for a VersionManifest file
 * @param {Object} artifact - Artifact object
 * @param {string} moduleId - Module ID
 * @returns {string} - Full path to the VersionManifest file
 */
function resolveVersionManifestPath(artifact, moduleId) {
    const commonDir = ConfigManager.getCommonDirectory()
    
    // If artifact has a path property, use it
    if (artifact && artifact.path) {
        return path.join(commonDir, artifact.path)
    }
    
    // Otherwise, construct the path based on moduleId
    // moduleId format: "1.21.4-fabric-0.17.2"
    // expected path: "versions/1.21.4-fabric-0.17.2/1.21.4-fabric-0.17.2.json"
    return path.join(commonDir, 'versions', moduleId, `${moduleId}.json`)
}

/**
 * Resolve the correct path for a Fabric loader file
 * @param {Object} artifact - Artifact object
 * @param {string} moduleId - Module ID
 * @returns {string} - Full path to the Fabric loader file
 */
function resolveFabricLoaderPath(artifact, moduleId) {
    const commonDir = ConfigManager.getCommonDirectory()
    
    if (artifact.path) {
        return path.join(commonDir, 'libraries', artifact.path)
    }
    
    // Parse maven coordinates to build path
    const parts = moduleId.split(':')
    if (parts.length >= 3) {
        const [groupId, artifactId, version] = parts
        const groupPath = groupId.replace(/\./g, '/')
        const filename = `${artifactId}-${version}.jar`
        return path.join(commonDir, 'libraries', groupPath, artifactId, version, filename)
    }
    
    // Fallback
    return path.join(commonDir, 'libraries', path.basename(artifact.url || `${moduleId}.jar`))
}

/**
 * Resolve the correct path for a library file
 * @param {Object} artifact - Artifact object
 * @param {string} moduleId - Module ID
 * @returns {string} - Full path to the library file
 */
function resolveLibraryPath(artifact, moduleId) {
    const commonDir = ConfigManager.getCommonDirectory()
    
    if (artifact.path) {
        return path.join(commonDir, 'libraries', artifact.path)
    }
    
    // Parse maven coordinates to build path
    const parts = moduleId.split(':')
    if (parts.length >= 3) {
        const [groupId, artifactId, version] = parts
        const groupPath = groupId.replace(/\./g, '/')
        const extension = parts[3] ? parts[3].split('@')[1] || 'jar' : 'jar'
        const filename = `${artifactId}-${version}.${extension}`
        return path.join(commonDir, 'libraries', groupPath, artifactId, version, filename)
    }
    
    // Fallback
    return path.join(commonDir, 'libraries', path.basename(artifact.url || `${moduleId}.jar`))
}

/**
 * Validate file integrity by checking existence and MD5 hash if available
 * @param {string} filePath - Path to the file
 * @param {Object} artifact - Artifact object with potential MD5 hash
 * @returns {Promise<boolean>} - True if file is valid, false otherwise
 */
async function validateFileIntegrity(filePath, artifact) {
    try {
        if (!fs.existsSync(filePath)) {
            return false
        }
        
        // If no MD5 is specified, just check existence
        const expectedMD5 = artifact.MD5 || artifact.md5 || artifact.Md5
        if (!expectedMD5) {
            return true
        }
        
        const actualMD5 = await computeFileMD5(filePath)
        return actualMD5.toLowerCase() === expectedMD5.toLowerCase()
        
    } catch (error) {
        return false
    }
}

async function dlAsync(login = true) {

    // Login parameter is temporary for debug purposes. Allows testing the validation/downloads without
    // launching the game.

    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    // Initialize progress bar
    console.log('[Landing] Starting launch process...')
    setLaunchPercentage(0)
    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))

    // Let the renderer paint the updated launch UI before starting heavy work.
    // Small non-blocking yield to the event loop so the progress bar becomes visible.
    try { await new Promise(resolve => setTimeout(resolve, 100)) } catch (e) { /* ignore */ }

    let distro

    try {
        distro = await DistroAPI.refreshDistributionOrFallback()
        onDistroRefresh(distro)
    } catch(err) {
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }

    // Before heavy validation/download, ensure distribution-provided "File" modules
    // (typically entries with artifact.path starting with "config/") are present
    // in the instance directory. If missing or modified (MD5 mismatch) they will
    // be re-downloaded and installed.
    try {
        const servForCheck = distro.getServerById(ConfigManager.getSelectedServer())
        if (servForCheck) {
            try { await checkAndRestoreFileModules(servForCheck) } catch (e) { loggerLanding && loggerLanding.warn && loggerLanding.warn('checkAndRestoreFileModules failed', e) }
        }
    } catch (e) {
        loggerLanding && loggerLanding.debug && loggerLanding.debug('Error during pre-launch file module check', e)
    }

    const serv = distro.getServerById(ConfigManager.getSelectedServer())

    // login can be: true (online), false (no auth, debug), or 'offline' (use local account in offline mode)
    if(login) {
        if(ConfigManager.getSelectedAccount() == null){
            loggerLanding.error('You must be logged into an account.')
            return
        }
    }

    // Progress: 10% - Starting validation
    setLaunchPercentage(10)
    setLaunchDetails(Lang.queryJS('landing.dlAsync.pleaseWait'))
    toggleLaunchArea(true)

    // CRITICAL: Download critical mod loader files BEFORE FullRepair validation
    // FullRepair needs these files (especially VersionManifest) to validate all dependencies
    setLaunchDetails('Préparation des fichiers du mod loader...')
    try {
        // Check for Fabric VersionManifest
        const fabricModule = serv.modules.find(m => m.rawModule.type === 'Fabric')
        if (fabricModule && fabricModule.subModules) {
            const versionManifestModule = fabricModule.subModules.find(m => m.rawModule.type === 'VersionManifest')
            if (versionManifestModule) {
                const artifactObj = getModuleArtifact(versionManifestModule)
                const versionManifestPath = resolveArtifactLocalPath(artifactObj)
                if (!versionManifestPath || !fs.existsSync(versionManifestPath)) {
                    loggerLaunchSuite.warn(`VersionManifest not found at ${versionManifestPath || '<unresolved>'}, downloading...`)
                    
                    const artifact = artifactObj
                    try {
                        const targetPath = versionManifestPath || (artifact && artifact.url ? path.join(ConfigManager.getCommonDirectory(), path.basename(artifact.url)) : null)
                        if (!artifact || !artifact.url || !targetPath) throw new Error('Missing artifact URL or target path')
                        try { await fs.ensureDir(path.dirname(targetPath)) } catch (e) { console.warn('[Landing] ensureDir failed for', path.dirname(targetPath), e) }
                        console.log('[Landing] Downloading VersionManifest BEFORE FullRepair:', artifact.url, '->', targetPath)
                        await safeDownload(artifact.url, targetPath)
                        loggerLaunchSuite.info('VersionManifest downloaded successfully before FullRepair')
                        console.log('[Landing] VersionManifest download complete:', targetPath)
                    } catch (downloadErr) {
                        loggerLaunchSuite.error('Failed to download VersionManifest:', downloadErr)
                        showLaunchFailure(
                            Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'),
                            `Impossible de télécharger le fichier de version Fabric. Veuillez vérifier votre connexion Internet. (${downloadErr.message})`
                        )
                        return
                    }
                }
            }
        }
    } catch (err) {
        loggerLaunchSuite.error('Error during pre-repair mod loader file verification:', err)
        // Don't fail here, FullRepair will handle it
    }

    setLaunchPercentage(15)
    setLaunchDetails(Lang.queryJS('landing.dlAsync.pleaseWait'))

    const fullRepairModule = new FullRepair(
        ConfigManager.getCommonDirectory(),
        ConfigManager.getInstanceDirectory(),
        ConfigManager.getLauncherDirectory(),
        ConfigManager.getSelectedServer(),
        DistroAPI.isDevMode()
    )

    // Progress: 20% - Spawning receiver
    setLaunchPercentage(20)
    fullRepairModule.spawnReceiver()

    fullRepairModule.childProcess.on('error', (err) => {
        loggerLaunchSuite.error('Error during launch', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.errorDuringLaunchText'))
    })
    fullRepairModule.childProcess.on('close', (code, _signal) => {
        if(code !== 0){
            loggerLaunchSuite.error(`Full Repair Module exited with code ${code}, assuming error.`)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        }
    })

    // Check if forced validation of mods is required
    const modConfig = ConfigManager.getModConfiguration(serv.rawServer.id)
    let forceModValidation = false
    if (modConfig && modConfig.forceValidation) {
        forceModValidation = true
        loggerLaunchSuite.info('Force validation flag detected, will re-download all mods.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.forcingModValidation') || 'Vérification forcée des mods en cours...')
        try { await new Promise(resolve => setTimeout(resolve, 40)) } catch (e) { /* ignore */ }
        
        try {
            // Remove mod files to force re-download
            const modsPath = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id, 'mods')
            const modStorePath = path.join(ConfigManager.getCommonDirectory(), 'modstore')
            
            // Delete mod directories if they exist
            if (fs.existsSync(modsPath)) {
                loggerLaunchSuite.info('Removing mod cache at: ' + modsPath)
                fs.removeSync(modsPath)
            }
            if (fs.existsSync(modStorePath)) {
                loggerLaunchSuite.info('Removing modstore cache at: ' + modStorePath)
                fs.removeSync(modStorePath)
            }
            
            // Clear the flag
            modConfig.forceValidation = false
            ConfigManager.setModConfiguration(serv.rawServer.id, modConfig)
            ConfigManager.save()
            
            loggerLaunchSuite.info('Mod cache cleared, mods will be re-downloaded.')
        } catch (err) {
            loggerLaunchSuite.error('Error clearing mod cache:', err)
            // Continue anyway
        }
    }

    // If the UI reports offline, skip validation and downloads to avoid
    // network-related validation errors (Transmitter errors) while offline.
    const offlineDetectedForValidation = (typeof navigator !== 'undefined' && !navigator.onLine)

    let _resourcePackBackup = null
    if (offlineDetectedForValidation) {
        loggerLaunchSuite.info('Offline detected — skipping file validation and downloads.')
        // Update UI to reflect offline skipping
        try{
            setLaunchDetails(Lang.queryJS('landing.dlAsync.offlineSkippingValidation') || 'Mode hors-ligne détecté — validation et téléchargement ignorés.')
            setLaunchPercentage(50) // Progress: 50% for offline mode
        } catch(e){ /* ignore */ }
        var invalidFileCount = 0
    } else {
        loggerLaunchSuite.info('Validating files.')
        setLaunchPercentage(30) // Progress: 30% - Starting validation
        setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
        // Yield briefly to ensure UI updates before starting potentially expensive file I/O/CPU work
        try { await new Promise(resolve => setTimeout(resolve, 40)) } catch (e) { /* ignore */ }
        let invalidFileCount = 0
        try {
            try {
                _resourcePackBackup = await backupResourcePacks(serv)
                if (_resourcePackBackup) loggerLaunchSuite.info('Resourcepacks backed up to ' + _resourcePackBackup)
                setLaunchPercentage(35) // Progress: 35% - Backup complete
            } catch (e) { loggerLaunchSuite.warn('Failed to backup resourcepacks, continuing', e) }
            invalidFileCount = await fullRepairModule.verifyFiles(percent => {
                // Map verification progress from 35% to 75%
                const mappedPercent = 35 + (percent * 0.4)
                setLaunchPercentage(Math.round(mappedPercent))
            })
            setLaunchPercentage(75) // Progress: 75% - Validation complete
        } catch (err) {
            loggerLaunchSuite.error('Error during file validation.')
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileVerificationTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
            return
        }
    }
    

    if(invalidFileCount > 0) {
        loggerLaunchSuite.info('Downloading files.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
        setLaunchPercentage(0)
        try {
            // yield briefly so the UI can render the progress UI before starting download
            try { await new Promise(resolve => setTimeout(resolve, 40)) } catch (e) { /* ignore */ }
            await fullRepairModule.download(percent => {
                setDownloadPercentage(percent)
            })
            setDownloadPercentage(100)
        } catch(err) {
            loggerLaunchSuite.error('Error during file download.')
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
            return
        }
    } else {
        loggerLaunchSuite.info('No invalid files, skipping download.')
        setLaunchPercentage(75) // Progress: 75% - No downloads needed
    }

    // Remove download bar.
    remote.getCurrentWindow().setProgressBar(-1)

    setLaunchPercentage(80) // Progress: 80% - Cleanup
    fullRepairModule.destroyReceiver()
    try {
        if (_resourcePackBackup) {
            await restoreResourcePacks(serv, _resourcePackBackup)
            loggerLaunchSuite.info('Resourcepacks restored from backup')
        }
    } catch (e) {
        loggerLaunchSuite.warn('Failed to restore resourcepacks from backup', e)
    }

    // CRITICAL: Verify essential Minecraft vanilla files exist before proceeding
    // FullRepair's "No invalid files" may not catch missing vanilla downloads
    loggerLaunchSuite.info('Verifying essential Minecraft vanilla files...')
    setLaunchDetails('Vérification des fichiers Minecraft...')
    try {
        const minecraftJarPath = path.join(ConfigManager.getCommonDirectory(), 'versions', serv.rawServer.minecraftVersion, `${serv.rawServer.minecraftVersion}.jar`)
        const librariesDir = path.join(ConfigManager.getCommonDirectory(), 'libraries')
        
        if (!fs.existsSync(minecraftJarPath)) {
            loggerLaunchSuite.error(`CRITICAL: Minecraft ${serv.rawServer.minecraftVersion}.jar not found at ${minecraftJarPath}`)
            loggerLaunchSuite.warn('FullRepair failed to download vanilla files. Attempting manual recovery...')
            
            // Attempt to re-run repair with forced validation
            setLaunchDetails('Téléchargement des fichiers Minecraft manquants...')
            setLaunchPercentage(75)
            
            const recoveryRepair = new FullRepair(
                ConfigManager.getCommonDirectory(),
                ConfigManager.getInstanceDirectory(),
                ConfigManager.getLauncherDirectory(),
                ConfigManager.getSelectedServer(),
                DistroAPI.isDevMode()
            )
            
            recoveryRepair.spawnReceiver()
            
            // Wait for error events
            let repairError = null
            const repairPromise = new Promise((resolve, reject) => {
                recoveryRepair.childProcess.on('error', (err) => {
                    repairError = err
                    reject(err)
                })
                recoveryRepair.childProcess.on('close', (code) => {
                    if (code !== 0) {
                        repairError = new Error(`Recovery repair failed with code ${code}`)
                        reject(repairError)
                    } else {
                        resolve()
                    }
                })
            })
            
            try {
                const invalidCount = await recoveryRepair.verifyFiles(percent => {
                    setLaunchPercentage(75 + (percent * 0.15))
                })
                
                if (invalidCount > 0) {
                    loggerLaunchSuite.info(`Recovery validation found ${invalidCount} invalid files, downloading...`)
                    setLaunchPercentage(80)
                    await recoveryRepair.download(percent => {
                        setLaunchPercentage(80 + (percent * 0.15))
                    })
                    loggerLaunchSuite.info('Recovery download completed')
                }
                
                await repairPromise
            } catch (e) {
                loggerLaunchSuite.error('Recovery repair failed:', e)
            } finally {
                recoveryRepair.destroyReceiver()
            }
            
            // Verify again
            if (!fs.existsSync(minecraftJarPath)) {
                loggerLaunchSuite.error(`Still missing: ${minecraftJarPath}`)
                showLaunchFailure(
                    Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'),
                    `Impossible de télécharger les fichiers Minecraft ${serv.rawServer.minecraftVersion}. Vérifiez votre connexion Internet.`
                )
                return
            }
        }
        
        loggerLaunchSuite.info('Essential Minecraft files verified')
    } catch (err) {
        loggerLaunchSuite.error('Error during vanilla file verification:', err)
        // Don't fail - let it try to launch anyway
    }

    // Vérification des mods de triche avant le lancement (désactivée)
    setLaunchPercentage(85) // Progress: 85% - Mod check
    setLaunchDetails('Vérification des mods de triche désactivée')
    // Anti-cheat / suppression automatique des mods de triche désactivée - continuer le lancement

    setLaunchPercentage(90) // Progress: 90% - Preparing to launch
    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))

    const mojangIndexProcessor = new MojangIndexProcessor(
        ConfigManager.getCommonDirectory(),
        serv.rawServer.minecraftVersion)
    const distributionIndexProcessor = new DistributionIndexProcessor(
        ConfigManager.getCommonDirectory(),
        distro,
        serv.rawServer.id
    )

    // Give the renderer a tick before starting index/network operations
    try { await new Promise(resolve => setTimeout(resolve, 30)) } catch (e) { /* ignore */ }
    
    let modLoaderData
    try {
        modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
    } catch (err) {
        loggerLaunchSuite.error('Failed to load mod loader version JSON, attempting comprehensive recovery...', err)
        
        // Attempt comprehensive recovery of all missing mod loader files
        try {
            setLaunchDetails('Récupération des fichiers de mod loader manquants...')
            
            const recoveryResult = await comprehensiveModLoaderRecovery(serv, err)
            if (recoveryResult.success) {
                loggerLaunchSuite.info('Mod loader recovery completed successfully')
                modLoaderData = recoveryResult.modLoaderData
            } else {
                throw new Error(recoveryResult.error)
            }
        } catch (recoveryErr) {
            loggerLaunchSuite.error('Failed to recover missing mod loader files', recoveryErr)
            showLaunchFailure(
                Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'),
                `Impossible de charger le fichier de version du mod loader. Veuillez vérifier votre connexion Internet et réessayer. (${recoveryErr.message})`
            )
            return
        }
    }
    
    // allow a small tick before the potentially heavy version JSON parsing
    try { await new Promise(resolve => setTimeout(resolve, 20)) } catch (e) { /* ignore */ }
    const versionData = await mojangIndexProcessor.getVersionJson()

        if(login) {
        // If requested, support an explicit offline mode when there is no network but
        // a local selected account exists. In that case build a lightweight offline
        // auth object so the game can be launched without contacting Mojang/MS.
        let authUser = null
        if(login === 'offline'){
            const sa = ConfigManager.getSelectedAccount()
            authUser = createOfflineAuth(sa)
        } else {
            // CRITICAL: Force refresh tokens before launching to prevent "Invalid session" errors
            // This ensures we always have a fresh MC access token for Minecraft servers
            setLaunchDetails('Validation du compte...')
            updateLaunchButton('Validation du compte...', 2)
            
            try {
                const refreshSuccess = await AuthManager.forceRefreshBeforeLaunch()
                if (!refreshSuccess) {
                    loggerLaunchSuite.error('Failed to refresh tokens before launch')
                    showLaunchFailure(
                        'Session expirée',
                        'Impossible de valider votre session. Veuillez vous reconnecter à votre compte Microsoft.'
                    )
                    return
                }
                loggerLaunchSuite.info('Token refresh successful before launch')
            } catch (refreshErr) {
                loggerLaunchSuite.error('Token refresh threw error:', refreshErr)
                showLaunchFailure(
                    'Erreur d\'authentification',
                    'Une erreur est survenue lors de la validation de votre compte. Veuillez vous reconnecter.'
                )
                return
            }
            
            authUser = ConfigManager.getSelectedAccount()
            
            // Final validation: ensure we have a valid access token
            if (!authUser || !authUser.accessToken) {
                loggerLaunchSuite.error('No valid access token after refresh')
                showLaunchFailure(
                    'Session invalide',
                    'Votre session est invalide. Veuillez vous reconnecter à votre compte Microsoft.'
                )
                return
            }
        }
                loggerLaunchSuite.info(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)
        
        // Step 1: Sync mods with distribution (5% progress)
        setLaunchDetails('Synchronisation des mods...')
        updateLaunchButton('Synchronisation des mods...', 5)
        try{
          if(typeof DistroAPI.syncServerMods === 'function'){
            const syncRes = await DistroAPI.syncServerMods(serv.rawServer.id)
            loggerLaunchSuite.info('Mod sync result', syncRes)
            if(syncRes.removed && syncRes.removed.length > 0) {
              setLaunchDetails(`${syncRes.removed.length} mod(s) supprimé(s)`)
              updateLaunchButton(`${syncRes.removed.length} mod(s) supprimé(s)`, 8)
            }
            if(syncRes.reinstalled && syncRes.reinstalled.length > 0) {
              setLaunchDetails(`${syncRes.reinstalled.length} mod(s) marqué(s) pour réinstallation`)
              updateLaunchButton(`${syncRes.reinstalled.length} mod(s) marqué(s) pour réinstallation`, 10)
            }
          }
        }catch(e){ loggerLaunchSuite.warn('Error while syncing mods prior to launch', e) }

        // Step 2: Clean MCEF caches (12% progress)
        setLaunchDetails('Nettoyage des caches MCEF...')
        updateLaunchButton('Nettoyage des caches MCEF...', 12)
        try{
          if(typeof DistroAPI.ensureCleanMcef === 'function'){
            const cleanRes = await DistroAPI.ensureCleanMcef(serv.rawServer.id)
            loggerLaunchSuite.info('MCEF clean result', cleanRes)
            if(cleanRes.removed && cleanRes.removed.length > 0) {
              setLaunchDetails(`${cleanRes.removed.length} cache(s) MCEF nettoyé(s)`)
              updateLaunchButton(`${cleanRes.removed.length} cache(s) MCEF nettoyé(s)`, 15)
            }
          }
        }catch(e){ loggerLaunchSuite.warn('Error while cleaning MCEF dirs prior to launch', e) }

        setLaunchPercentage(95) // Progress: 95% - Launching game
        setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingGame'))
        updateLaunchButton('Préparation du lancement...', 95)
        
        // Initialize ProcessBuilder
        const pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, remote.app.getVersion())
        
        setLaunchPercentage(100) // Progress: 100% - Game starting
        
        // const SERVER_JOINED_REGEX = /\[.+\]: \[CHAT\] [a-zA-Z0-9_]{1,16} joined the game/
        const SERVER_JOINED_REGEX = new RegExp(`\\[.+\\]: \\[CHAT\\] ${authUser.displayName} joined the game`)

        const onLoadComplete = () => {
            toggleLaunchArea(false)
            if(hasRPC){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.loading'))
                proc.stdout.on('data', gameStateChange)
            }
            proc.stdout.removeListener('data', tempListener)
            proc.stderr.removeListener('data', gameErrorListener)
        }
        const start = Date.now()

        // Attach a temporary listener to the client output.
        // Will wait for a certain bit of text meaning that
        // the client application has started, and we can hide
        // the progress bar stuff.
        const tempListener = function(data){
            if(GAME_LAUNCH_REGEX.test(data.trim())){
                const diff = Date.now()-start
                if(diff < MIN_LINGER) {
                    setTimeout(onLoadComplete, MIN_LINGER-diff)
                } else {
                    onLoadComplete()
                }
            }
        }

        // Listener for Discord RPC.
        const gameStateChange = function(data){
            data = data.trim()
            if(SERVER_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joined'))
            } else if(GAME_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joining'))
            }
        }

        const gameErrorListener = function(data){
            data = data.trim()
            if(data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){
                loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
            }
        }


        try {
            // Build Minecraft process.
            proc = pb.build()
            // Capture the server id at launch time so we can reliably
            // notify instance stop for the same server even if the
            // user changes the selected server while the game runs.
            const launchedServerId = ConfigManager.getSelectedServer()

            // Anti-cheat entièrement désactivé dans cette build — aucune surveillance ou suppression.

            // Ensure log panel functions exist
            window.appendMinecraftLog = function (txt) {
                try {
                    const el = document.getElementById('mc_logs_content')
                    if (!el) return
                    // Append with newline and trim to reasonable size
                    const cleaned = ('' + txt).replace(/\r/g, '')
                    el.textContent += cleaned + '\n'
                    // Keep content size bounded (e.g., last 20000 chars)
                    if (el.textContent.length > 20000) {
                        el.textContent = el.textContent.slice(-20000)
                    }
                    const panel = document.getElementById('mc_logs_panel')
                    if (panel && panel.style.display !== 'none') panel.scrollTop = panel.scrollHeight
                } catch (e) { /* ignore */ }
            }

            window.toggleMinecraftLogsPanel = function (show) {
                const panel = document.getElementById('mc_logs_panel')
                if (!panel) return
                if (typeof show === 'boolean') {
                    panel.style.display = show ? 'block' : 'none'
                } else {
                    panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
                }
            }

            // Wire mcLogsButton click
            try {
                const mcBtn = document.getElementById('mcLogsButton')
                if (mcBtn && !mcBtn._bound) {
                    mcBtn.addEventListener('click', () => {
                        window.toggleMinecraftLogsPanel()
                    })
                    mcBtn._bound = true
                }
            } catch (e) { /* ignore */ }

            // Notify UI that the instance has started (so landing-inline watcher updates the launch overlay)
            try {
                const payload = { started: true, pid: proc && proc.pid ? proc.pid : null, serverId: launchedServerId }
                if (typeof window !== 'undefined' && typeof window.onInstanceStateChanged === 'function') {
                    console.info('[Landing] calling window.onInstanceStateChanged', payload)
                    window.onInstanceStateChanged(payload)
                }
                // Also explicitly send to main so it can broadcast to other renderers
                try {
                    const { ipcRenderer } = require('electron')
                    console.info('[Landing] ipcRenderer.send instance-state', payload)
                    ipcRenderer.send('instance-state', payload)
                } catch (e) {
                    loggerLaunchSuite && loggerLaunchSuite.debug && loggerLaunchSuite.debug('ipcRenderer not available to send instance-state', e)
                }
            } catch (e) {
                loggerLaunchSuite && loggerLaunchSuite.warn && loggerLaunchSuite.warn('Failed to notify instance started', e)
            }

            // Bind listeners to stdout.
            proc.stdout.on('data', tempListener)
            proc.stderr.on('data', gameErrorListener)

            // If configured, stream stdout/stderr to the logs panel
            try {
                const showLogs = ConfigManager.getShowMinecraftLogs && ConfigManager.getShowMinecraftLogs()
                const streamListener = (data) => {
                    try {
                        const txt = ('' + data).trim()
                        // Append to UI
                        if (txt.length > 0 && typeof window.appendMinecraftLog === 'function') {
                            window.appendMinecraftLog(txt)
                            // Forward to main so other windows (settings/logs window) can receive it
                            try {
                                const { ipcRenderer } = require('electron')
                                ipcRenderer.send('mc-log-line', txt)
                            } catch (e) { /* ignore */ }
                        }
                    } catch (e) { /* ignore */ }
                }
                proc.stdout.on('data', streamListener)
                proc.stderr.on('data', streamListener)

                // Auto-open panel if config enabled
                if (showLogs) {
                    try { window.toggleMinecraftLogsPanel(true) } catch (e) { /* ignore */ }
                }
            } catch (e) {
                // ignore if ConfigManager not available
            }

            setLaunchDetails(Lang.queryJS('landing.dlAsync.doneEnjoyServer'))

            // Init Discord Hook
            if(distro.rawDistribution.discord != null && serv.rawServer.discord != null){
                DiscordWrapper.initRPC(distro.rawDistribution.discord, serv.rawServer.discord)
                hasRPC = true
                proc.on('close', (code, signal) => {
                    loggerLaunchSuite.info('Shutting down Discord Rich Presence..')
                    DiscordWrapper.shutdownRPC()
                    hasRPC = false
                    proc = null
                })
            }

            // Always listen for process close to notify UI watcher
            try {
                proc.on('close', async (code, signal) => {
                    try {
                        // Arrêter la surveillance des mods
                        if (typeof modWatcher !== 'undefined' && modWatcher) {
                            try {
                                modWatcher.close()
                                loggerLaunchSuite.info('Surveillance des mods arrêtée')
                            } catch (err) {
                                loggerLaunchSuite.error('Erreur lors de l\'arrêt de la surveillance des mods:', err)
                            }
                        }
                        
                        // Anti-cheat disabled — no action on process close
                        
                        const payload = { started: false, serverId: launchedServerId }
                        console.info('[Landing] process closed, notifying instance stopped', { code, signal })
                        if (typeof window !== 'undefined' && typeof window.onInstanceStateChanged === 'function') {
                            window.onInstanceStateChanged(payload)
                        }
                        try {
                            const { ipcRenderer } = require('electron')
                            ipcRenderer.send('instance-state', payload)
                        } catch (e) {
                            loggerLaunchSuite && loggerLaunchSuite.debug && loggerLaunchSuite.debug('ipcRenderer not available to send instance-state stop', e)
                        }
                    } catch (e) {
                        loggerLaunchSuite && loggerLaunchSuite.warn && loggerLaunchSuite.warn('Failed to notify instance stopped', e)
                    }
                })
            } catch (e) {
                // silently ignore if proc not present or listener fails
            }

        } catch(err) {

            loggerLaunchSuite.error('Error during launch', err)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.checkConsoleForDetails'))

        }
    }

}

/**
 * News Loading Functions
 */

// DOM Cache - With null checks for missing elements
const newsContent                   = document.getElementById('newsContent')
const newsArticleTitle              = document.getElementById('newsArticleTitle')
const newsArticleDate               = document.getElementById('newsArticleDate')
const newsArticleAuthor             = document.getElementById('newsArticleAuthor')
const newsArticleComments           = document.getElementById('newsArticleComments')
const newsNavigationStatus          = document.getElementById('newsNavigationStatus')
const newsArticleContentScrollable  = document.getElementById('newsArticleContentScrollable')
const nELoadSpan                    = document.getElementById('nELoadSpan')
const newsErrorRetry                = document.getElementById('newsErrorRetry')

// News slide caches.
let newsGlideCount = 0

/**
 * Show the news UI (adapted for new interface).
 * 
 * @param {boolean} up True to show news, otherwise false. 
 */
function slide_(up){
    const newsContainer = document.querySelector('#newsContainer')
    
    // For the new interface, simply show/hide the news section
    if (newsContainer) {
        if (up) {
            newsContainer.style.display = 'block'
        } else {
            newsContainer.style.display = 'none'
        }
    }
    
    // Keep old animation code commented for reference
    /*
    const lCUpper = document.querySelector('#landingContainer > #upper')
    const lCLLeft = document.querySelector('#landingContainer > #lower > #left')
    const lCLCenter = document.querySelector('#landingContainer > #lower > #center')
    const lCLRight = document.querySelector('#landingContainer > #lower > #right')
    const newsBtn = document.querySelector('#landingContainer > #lower > #center #content')
    const landingContainer = document.getElementById('landingContainer')
    */

    newsGlideCount++
    setTimeout(() => {
        newsGlideCount--
    }, 500)
}
// Bind news button (only if it exists)
const newsButton = document.getElementById('newsButton')
if (newsButton) {
    newsButton.onclick = () => {
        // Simple toggle for the new interface
        if(newsActive){
            // Hide news
            const newsContainer = document.querySelector('#newsContainer')
            if (newsContainer) newsContainer.style.display = 'none'
            
            // Reset tabbing if needed
        if (typeof $ !== 'undefined') {
            $('#landingContainer *').removeAttr('tabindex')
            $('#newsContainer *').attr('tabindex', '-1')
        }
    } else {
        // Show news
        const newsContainer = document.querySelector('#newsContainer')
        if (newsContainer) newsContainer.style.display = 'block'
        
        // Reset tabbing if needed
        if (typeof $ !== 'undefined') {
            $('#landingContainer *').attr('tabindex', '-1')
            $('#newsContainer, #newsContainer *').removeAttr('tabindex')
        }
        
        if(newsAlertShown){
            const newsButtonAlert = document.getElementById('newsButtonAlert')
            if (newsButtonAlert && typeof $ !== 'undefined') {
                $('#newsButtonAlert').fadeOut(2000)
            }
            newsAlertShown = false
            ConfigManager.setNewsCacheDismissed(true)
            ConfigManager.save()
        }
    }
    
    newsActive = !newsActive
}

// Bind legacy news button (newsButtonl) for compatibility
const newsButtonl = document.getElementById('newsButtonl')
if (newsButtonl) {
    newsButtonl.onclick = () => {
        // Use the same logic as the main news button
        document.getElementById('newsButton').onclick()
    }
}

/**
 * Set the news loading animation.
 * 
 * @param {boolean} val True to set loading animation, otherwise false.
 */
function setNewsLoading(val){
    if(val){
        if (!nELoadSpan) return; // Early return if element doesn't exist
        
        const nLStr = Lang.queryJS('landing.news.checking')
        let dotStr = '..'
        nELoadSpan.innerHTML = nLStr + dotStr
        newsLoadingListener = setInterval(() => {
            if(dotStr.length >= 3){
                dotStr = ''
            } else {
                dotStr += '.'
            }
            if (nELoadSpan) nELoadSpan.innerHTML = nLStr + dotStr
        }, 750)
    } else {
        if(newsLoadingListener != null){
            clearInterval(newsLoadingListener)
            newsLoadingListener = null
        }
    }
}

// Bind retry button (only if it exists).
if (newsErrorRetry) {
    newsErrorRetry.onclick = () => {
        $('#newsErrorFailed').fadeOut(250, () => {
            initNews()
            $('#newsErrorLoading').fadeIn(250)
        })
    }
}

if (newsArticleContentScrollable) {
    newsArticleContentScrollable.onscroll = (e) => {
        if(e.target.scrollTop > Number.parseFloat($('.newsArticleSpacerTop').css('height'))){
            if (newsContent) newsContent.setAttribute('scrolled', '')
        } else {
            if (newsContent) newsContent.removeAttribute('scrolled')
        }
    }
}

/**
 * Reload the news without restarting.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
function reloadNews(){
    return new Promise((resolve, reject) => {
        $('#newsContent').fadeOut(250, () => {
            $('#newsErrorLoading').fadeIn(250)
            initNews().then(() => {
                resolve()
            })
        })
    })
}

let newsAlertShown = false

/**
 * Show the news alert indicating there is new news.
 */
function showNewsAlert(){
    newsAlertShown = true
    $(newsButtonAlert).fadeIn(250)
}

async function digestMessage(str) {
    const msgUint8 = new TextEncoder().encode(str)
    const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return hashHex
}

/**
 * Initialize News UI. This will load the news and prepare
 * the UI accordingly.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
async function initNews(){

    setNewsLoading(true)

    const news = await loadNews()

    newsArr = news?.articles || null

    if(newsArr == null){
        // News Loading Failed
        setNewsLoading(false)

        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorFailed').fadeIn(250).promise()

    } else if(newsArr.length === 0) {
        // No News Articles
        setNewsLoading(false)

        ConfigManager.setNewsCache({
            date: null,
            content: null,
            dismissed: false
        })
        ConfigManager.save()

        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorNone').fadeIn(250).promise()
    } else {
        // Success
        setNewsLoading(false)

        const lN = newsArr[0]
        const cached = ConfigManager.getNewsCache()
        let newHash = await digestMessage(lN.content)
        let newDate = new Date(lN.date)
        let isNew = false

        if(cached.date != null && cached.content != null){

            if(new Date(cached.date) >= newDate){

                // Compare Content
                if(cached.content !== newHash){
                    isNew = true
                    showNewsAlert()
                } else {
                    if(!cached.dismissed){
                        isNew = true
                        showNewsAlert()
                    }
                }

            } else {
                isNew = true
                showNewsAlert()
            }

        } else {
            isNew = true
            showNewsAlert()
        }

        if(isNew){
            ConfigManager.setNewsCache({
                date: newDate.getTime(),
                content: newHash,
                dismissed: false
            })
            ConfigManager.save()
        }

        const switchHandler = (forward) => {
            let cArt = parseInt(newsContent.getAttribute('article'))
            let nxtArt = forward ? (cArt >= newsArr.length-1 ? 0 : cArt + 1) : (cArt <= 0 ? newsArr.length-1 : cArt - 1)
    
            displayArticle(newsArr[nxtArt], nxtArt+1)
        }

        document.getElementById('newsNavigateRight').onclick = () => { switchHandler(true) }
        document.getElementById('newsNavigateLeft').onclick = () => { switchHandler(false) }
        await $('#newsErrorContainer').fadeOut(250).promise()
        displayArticle(newsArr[0], 1)
        await $('#newsContent').fadeIn(250).promise()
    }


}

// Make function globally accessible
window.initNews = initNews

/**
 * Add keyboard controls to the news UI. Left and right arrows toggle
 * between articles. If you are on the landing page, the up arrow will
 * open the news UI.
 */
document.addEventListener('keydown', (e) => {
    if(newsActive){
        if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
            document.getElementById(e.key === 'ArrowRight' ? 'newsNavigateRight' : 'newsNavigateLeft').click()
        }
        // Interferes with scrolling an article using the down arrow.
        // Not sure of a straight forward solution at this point.
        // if(e.key === 'ArrowDown'){
        //     document.getElementById('newsButton').click()
        // }
    } else {
        if(getCurrentView() === VIEWS.landing){
            if(e.key === 'ArrowUp'){
                document.getElementById('newsButton').click()
            }
        }
    }
})

/**
 * Display a news article on the UI.
 * 
 * @param {Object} articleObject The article meta object.
 * @param {number} index The article index.
 */
function displayArticle(articleObject, index){
    // Set textual fields using textContent to avoid accidental HTML injection
    if (newsArticleTitle) newsArticleTitle.textContent = articleObject.title || ''
    newsArticleTitle.href = articleObject.link
    if (newsArticleAuthor) newsArticleAuthor.textContent = 'by ' + (articleObject.author || '')
    if (newsArticleDate) newsArticleDate.textContent = articleObject.date || ''
    if (newsArticleComments) {
        newsArticleComments.textContent = articleObject.comments || ''
        newsArticleComments.href = articleObject.commentsLink || '#'
    }

    // Sanitize HTML content for article body before injecting
    const safeContent = DOMPurify.sanitize(articleObject.content || '')
    if (newsArticleContentScrollable) newsArticleContentScrollable.innerHTML = '<div id="newsArticleContentWrapper"><div class="newsArticleSpacerTop"></div>' + safeContent + '<div class="newsArticleSpacerBot"></div></div>'
    Array.from(newsArticleContentScrollable.getElementsByClassName('bbCodeSpoilerButton')).forEach(v => {
        v.onclick = () => {
            const text = v.parentElement.getElementsByClassName('bbCodeSpoilerText')[0]
            text.style.display = text.style.display === 'block' ? 'none' : 'block'
        }
    })
    newsNavigationStatus.innerHTML = Lang.query('ejs.landing.newsNavigationStatus', {currentPage: index, totalPages: newsArr.length})
    newsContent.setAttribute('article', index-1)
}

/**
 * Load news information from the RSS feed specified in the
 * distribution index.
 */
async function loadNews(){

    const distroData = await DistroAPI.getDistribution()
    if(!distroData.rawDistribution.rss) {
        loggerLanding.debug('No RSS feed provided.')
        return null
    }

    const promise = new Promise((resolve, reject) => {
        
        const newsFeed = distroData.rawDistribution.rss
        const newsHost = new URL(newsFeed).origin + '/'
        $.ajax({
            url: newsFeed,
            success: (data) => {
                const items = $(data).find('item')
                const articles = []

                for(let i=0; i<items.length; i++){
                // JQuery Element
                    const el = $(items[i])

                    // Resolve date.
                    const date = new Date(el.find('pubDate').text()).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric'})

                    // Resolve comments.
                    let comments = el.find('slash\\:comments').text() || '0'
                    comments = comments + ' Comment' + (comments === '1' ? '' : 's')

                    // Fix relative links in content.
                    let content = el.find('content\\:encoded').text()
                    let regex = /src="(?!http:\/\/|https:\/\/)(.+?)"/g
                    let matches
                    while((matches = regex.exec(content))){
                        content = content.replace(`"${matches[1]}"`, `"${newsHost + matches[1]}"`)
                    }

                    let link   = el.find('link').text()
                    let title  = el.find('title').text()
                    let author = el.find('dc\\:creator').text()

                    // Generate article.
                    articles.push(
                        {
                            link,
                            title,
                            date,
                            author,
                            content,
                            comments,
                            commentsLink: link + '#comments'
                        }
                    )
                }
                resolve({
                    articles
                })
            },
            timeout: 2500
        }).catch(err => {
            resolve({
                articles: null
            })
        })
    })

    return await promise
}

/**
 * Populate the sidebar with server instances using modpack cards
 */

async function populateSidebarInstances() {
    console.log('[SIDEBAR] populateSidebarInstances() called')
    
    try {
        console.log('[SIDEBAR] Fetching distribution...')
        const distro = await DistroAPI.getDistribution()
        
        if (!distro) {
            console.error('[SIDEBAR] Distribution is null or undefined!')
            // Fallback pour l'ancien système
            const sidebarContainer = document.getElementById('sidebar-instances')
            if (sidebarContainer) {
                sidebarContainer.innerHTML = '<li class="text-white/50 text-xs text-center">Erreur: distribution non chargée</li>'
            }
            return
        }
        
        console.log('[SIDEBAR] Distribution loaded:', distro)
        
        const selectedServerId = ConfigManager.getSelectedServer()
        console.log('[SIDEBAR] Selected server ID:', selectedServerId)
        
        const servers = distro.servers
        console.log('[SIDEBAR] Servers array:', servers)
        console.log('[SIDEBAR] Number of servers:', servers ? servers.length : 0)
        
        if (!servers || servers.length === 0) {
            console.warn('[SIDEBAR] No servers found in distribution')
            // Fallback pour l'ancien système
            const sidebarContainer = document.getElementById('sidebar-instances')
            if (sidebarContainer) {
                sidebarContainer.innerHTML = '<li class="text-white/50 text-xs text-center">Aucune instance disponible</li>'
            }
            return
        }
        
        // Convertir les serveurs en instances pour les cartes modpack
        // Si un serveur a une whitelist active, n'afficher que s'il contient l'utilisateur sélectionné
        const selectedAcc = ConfigManager.getSelectedAccount()
        const selectedUUID = selectedAcc && selectedAcc.uuid ? selectedAcc.uuid.toLowerCase() : null

        const instances = servers.map(serv => {
            if (!serv || !serv.rawServer) return null

            // Si whitelist active, vérifier la présence de l'utilisateur sélectionné
            try {
                const wl = serv.rawServer.whitelist
                if (wl && wl.active) {
                    // If no selected account, hide the server when whitelist is active
                    if (!selectedAcc) {
                        console.log('[SIDEBAR] Server', serv.rawServer.id, 'has an active whitelist but no account is selected; hiding')
                        return null
                    }

                    const players = Array.isArray(wl.players) ? wl.players : []

                    // Normalize selected identifiers
                    const selUuidNorm = selectedAcc.uuid ? selectedAcc.uuid.replace(/-/g, '').toLowerCase() : null
                    const selNameNorm = selectedAcc.displayName ? selectedAcc.displayName.toLowerCase() : null

                    const matched = players.some(p => {
                        if (!p) return false

                        // Player entry can be a string (uuid or name) or an object {uuid,name}
                        if (typeof p === 'string') {
                            const val = p.trim()
                            // treat as UUID if it contains hex and optional dashes
                            const valUuid = val.replace(/-/g, '').toLowerCase()
                            if (selUuidNorm && /^[0-9a-f]{32}$/.test(valUuid) && valUuid === selUuidNorm) return true
                            // otherwise compare as name (case-insensitive)
                            if (selNameNorm && val.toLowerCase() === selNameNorm) return true
                            return false
                        }

                        // object case
                        if (p.uuid && selUuidNorm) {
                            if (p.uuid.replace(/-/g, '').toLowerCase() === selUuidNorm) return true
                        }
                        if (p.name && selNameNorm) {
                            if (p.name.toLowerCase() === selNameNorm) return true
                        }

                        return false
                    })

                    if (!matched) {
                        console.log('[SIDEBAR] Selected account not in whitelist for server', serv.rawServer.id, '; hiding')
                        return null
                    }
                }
            } catch (e) {
                console.warn('[SIDEBAR] Error while checking whitelist for server', serv && serv.rawServer && serv.rawServer.id, e)
            }

            return {
                id: serv.rawServer.id,
                rawServerId: serv.rawServer.id,
                name: serv.rawServer.name || 'Instance',
                displayName: serv.rawServer.name || 'Instance',
                type: serv.rawServer.type || 'MODPACK',
                icon: serv.rawServer.icon || './assets/images/minecraft.ico',
                version: serv.rawServer.minecraftVersion,
                loader: serv.rawServer.loader,
                description: serv.rawServer.description,
                server: serv // Référence au serveur complet
            }
        }).filter(instance => instance !== null)
        
        console.log('[SIDEBAR] Converted instances:', instances)
        
        // Vérifier si le conteneur modpack existe
        const modpackContainer = document.getElementById('sidebar-instances-cards') || document.getElementById('modpack-instances-container')
        console.log('[SIDEBAR] Modpack container found:', !!modpackContainer)
        
        // Utiliser la nouvelle fonction de création de cartes modpack si disponible
        if (typeof window.populateModpackInstances === 'function' && modpackContainer) {
            console.log('[SIDEBAR] Using new modpack card system')
            try {
                window.populateModpackInstances(instances, selectedServerId)
                console.log('[SIDEBAR] Modpack cards populated successfully')
            } catch (error) {
                console.error('[SIDEBAR] Error populating modpack cards:', error)
                // Fallback vers l'ancien système en cas d'erreur
                populateFallbackSidebar(instances, selectedServerId)
            }
        } else {
            console.warn('[SIDEBAR] Modpack card system not available, using fallback')
            populateFallbackSidebar(instances, selectedServerId)
        }
        
        console.log('[SIDEBAR] Populated sidebar with ' + instances.length + ' server instances')
        
    } catch (error) {
        console.error('[SIDEBAR] Error populating sidebar instances:', error)
        const sidebarContainer = document.getElementById('sidebar-instances')
        if (sidebarContainer) {
            sidebarContainer.innerHTML = '<li class="text-white/50 text-xs text-center">Erreur: ' + error.message + '</li>'
        }
    }
}

/**
 * Populate sidebar with new settings-style interface
 * Completely redesigned for the new modern UI
 */
function populateFallbackSidebar(instances, selectedServerId) {
    const sidebarContainer = document.getElementById('sidebar-instances')
    if (!sidebarContainer) {
        console.error('[SIDEBAR] Sidebar container not found!')
        return
    }
    
    // Handle empty instances
    if (!instances || instances.length === 0) {
        sidebarContainer.innerHTML = `
            <div class="text-center py-8">
                <div class="glass-card rounded-lg p-6 inline-block">
                    <i class="bi bi-inbox text-gray-500 text-4xl mb-3 block"></i>
                    <p class="text-gray-400 text-sm">Aucune instance disponible</p>
                </div>
            </div>
        `
        return
    }
    
    // Build simple instance cards
    const instanceCards = instances.map((instance) => {
        const isSelected = instance.id === selectedServerId
        const instanceName = DOMPurify.sanitize(instance.name || 'Instance')
        const instanceIcon = instance.icon || './assets/images/minecraft.ico'
        const instanceVersion = DOMPurify.sanitize(instance.version || 'Version inconnue')
        const instanceLoader = instance.loader || ''
        
        return `
            <button class="instance-item glass-card rounded-lg p-3 w-full text-left transition-all group ${isSelected ? 'selected' : ''}"
                    data-server-id="${instance.id}"
                    title="${instanceName}">
                <div class="flex items-center gap-3">
                    <!-- Instance Icon -->
                    <div class="flex-shrink-0">
                        <img src="${instanceIcon}" 
                             alt="${instanceName}"
                             class="w-10 h-10 rounded-lg object-cover"
                             onerror="this.src='./assets/images/minecraft.ico'" />
                        ${isSelected ? `
                        <div class="absolute -top-1 -right-1 w-3 h-3 bg-[#F8BA59] rounded-full border-2 border-[#181818]"></div>
                        ` : ''}
                    </div>
                    
                    <!-- Instance Info -->
                    <div class="flex-1 min-w-0">
                        <div class="text-white font-semibold text-sm truncate">
                            ${instanceName}
                        </div>
                        <div class="flex items-center gap-2 mt-0.5">
                            <span class="text-gray-400 text-xs truncate">${instanceVersion}</span>
                            ${instanceLoader ? `
                            <span class="px-1.5 py-0.5 text-[10px] rounded bg-gray-700/50 text-gray-300 uppercase font-medium">
                                ${instanceLoader}
                            </span>
                            ` : ''}
                        </div>
                    </div>
                    
                    <!-- Selection Indicator -->
                    ${isSelected ? `
                    <div class="flex-shrink-0">
                        <i class="bi bi-check-circle-fill text-[#F8BA59] text-lg"></i>
                    </div>
                    ` : `
                    <div class="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <i class="bi bi-arrow-right-circle text-gray-500 text-lg"></i>
                    </div>
                    `}
                </div>
            </button>
        `
    }).join('')
    
    // Set the HTML
    sidebarContainer.innerHTML = instanceCards
    
    // Bind events after rendering
    bindSidebarInstanceEvents()
    
    console.log('[SIDEBAR] Populated sidebar with ' + instances.length + ' instance cards')
}



// Make function globally accessible
window.populateSidebarInstances = populateSidebarInstances

// Notify uibinder that the function is now available
console.log('[LANDING] populateSidebarInstances is now globally available')
if (typeof window.triggerSidebarPopulation === 'function') {
    console.log('[LANDING] Triggering sidebar population via uibinder...')
    window.triggerSidebarPopulation()
}

/**
 * Bind events to sidebar instance buttons with modern interactions
 */
function bindSidebarInstanceEvents() {
    const instanceButtons = document.querySelectorAll('.instance-item, .server-instance-btn')
    
    if (instanceButtons.length === 0) {
        console.warn('[SIDEBAR] No instance buttons found to bind events')
        return
    }
    
    instanceButtons.forEach((button, index) => {
        // Remove any existing listeners to prevent duplicates
        const newButton = button.cloneNode(true)
        button.parentNode.replaceChild(newButton, button)
        
        // Click handler
        newButton.addEventListener('click', async (e) => {
            e.preventDefault()
            e.stopPropagation()
            
            const btn = e.currentTarget
            btn.blur()
            
            const serverId = btn.getAttribute('data-server-id')
            
            if (!serverId) {
                console.warn('[SIDEBAR] No server ID found on button')
                return
            }
            
            // Don't reselect if already selected
            if (btn.classList.contains('selected')) {
                console.log('[SIDEBAR] Instance already selected:', serverId)
                return
            }
            
            try {
                console.log('[SIDEBAR] Selecting instance:', serverId)
                
                const distro = await DistroAPI.getDistribution()
                const server = distro.getServerById(serverId)
                
                if (!server) {
                    console.error('[SIDEBAR] Server not found:', serverId)
                    return
                }
                
                // Update selected server
                await updateSelectedServer(server, false)
                
                // Refresh server status
                await refreshServerStatus(true)
                
                // Re-populate sidebar to update selection state
                setTimeout(() => {
                    populateSidebarInstances()
                }, 100)
                
                console.log('[SIDEBAR] Instance selected successfully:', serverId)
                
            } catch (error) {
                console.error('[SIDEBAR] Error selecting server:', error)
            }
        })
        
        // Keyboard navigation
        newButton.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                newButton.click()
            } else if (e.key === 'ArrowDown' && index < instanceButtons.length - 1) {
                e.preventDefault()
                instanceButtons[index + 1].focus()
            } else if (e.key === 'ArrowUp' && index > 0) {
                e.preventDefault()
                instanceButtons[index - 1].focus()
            }
        })
        
        // Make keyboard focusable
        newButton.setAttribute('tabindex', '0')
    })
    
    console.log('[SIDEBAR] Bound events for ' + instanceButtons.length + ' instance buttons')
}


/**
 * Initialize the new interface compatibility
 */
function initNewInterface() {
    console.log('initNewInterface() called')
    
    // Hide news section initially
    const newsContainer = document.querySelector('#newsContainer')
    if (newsContainer) {
        newsContainer.style.display = 'none'
    }
    
    // Initialize instance UI state
    updateInstanceUI()
    
    // Setup avatar overlay click handler for new interface
    const avatarContainer = document.getElementById('avatarContainer')
    if (avatarContainer && !avatarContainer.onclick) {
        avatarContainer.onclick = async (e) => {
            await prepareSettings()
            switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
                settingsNavItemListener(document.getElementById('settingsNavAccount'), false)
                try { populateSettingsAccounts() } catch (e) { console.warn('[LANDING] populateSettingsAccounts error', e) }
            })
        }
    }
    
    // Initialize server status display
    const serverStatusWrapper = document.getElementById('server_status_wrapper')
    if (serverStatusWrapper) {
        serverStatusWrapper.style.display = 'flex'
    }
    
    // Make sure launch button is properly bound
    const launchButton = document.getElementById('launch_button')
    if (launchButton && !launchButton.hasAttribute('data-bound')) {
        launchButton.setAttribute('data-bound', 'true')
        // Button event is already bound above, just mark it
    }
    
    // Setup progress bar compatibility
    const progressBar = document.getElementById('launch_progress_bar')
    const progressLabel = document.getElementById('launch_progress_label')
    if (progressBar && progressLabel) {
        // Initial state
        progressBar.style.width = '0%'
        progressLabel.textContent = '0%'
    }
    
    // Set initial loading message in sidebar
    const sidebarContainer = document.getElementById('sidebar-instances')
    if (sidebarContainer) {
        sidebarContainer.innerHTML = '<div class="text-gray-500 text-sm text-center py-4 animate-pulse">Chargement des instances...</div>'
    }
    
    // Check if modpack container exists and functions are available
    const modpackContainer = document.getElementById('sidebar-instances-cards') || document.getElementById('modpack-instances-container')
    if (modpackContainer) {
        console.log('[INIT] Modpack container found:', modpackContainer.id)
        modpackContainer.innerHTML = '<div class="text-white/50 text-sm text-center py-4">Chargement des instances...</div>'
        
        // Try to populate sidebar with retry mechanism
        setTimeout(() => {
            populateSidebarInstancesWithRetry(3)
        }, 1000)
    } else {
        console.warn('[INIT] Modpack container not found, will use fallback')
    }
    
    console.log('[INIT] New interface initialized')
    // Reflect any known instance state for selected server
    try { updateLaunchUIForServer(ConfigManager.getSelectedServer()) } catch(e){}
}

/**
 * Populate sidebar with retry mechanism
 */
async function populateSidebarInstancesWithRetry(maxRetries = 3) {
    let retries = 0
    
    const tryPopulate = async () => {
        try {
            await populateSidebarInstances()
            console.log('[RETRY] Sidebar population succeeded')
        } catch (error) {
            retries++
            console.error(`[RETRY] Attempt ${retries} failed:`, error)
            
            if (retries < maxRetries) {
                console.log(`[RETRY] Retrying in ${retries * 500}ms...`)
                setTimeout(tryPopulate, retries * 500)
            } else {
                console.error('[RETRY] Max retries reached, using fallback')
                // Force fallback population
                const sidebarContainer = document.getElementById('sidebar-instances')
                if (sidebarContainer) {
                    sidebarContainer.innerHTML = '<li class="text-white/50 text-xs text-center">Erreur de chargement</li>'
                }
            }
        }
    }
    
    tryPopulate()
}

// Initialize new interface when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing in 100ms...')
    setTimeout(initNewInterface, 100)
    
    // Add debug click handler to sidebar for testing
    setTimeout(() => {
        const sidebarContainer = document.getElementById('sidebar-instances')
        if (sidebarContainer) {
            sidebarContainer.addEventListener('click', () => {
                console.log('Sidebar clicked - forcing population...')
                populateSidebarInstancesWithRetry(1)
            })
            console.log('Debug click handler added to sidebar')
        }
        
        // Add debug click handler to modpack container
        const modpackContainer = document.getElementById('sidebar-instances-cards') || document.getElementById('modpack-instances-container')
        if (modpackContainer) {
            modpackContainer.addEventListener('click', () => {
                console.log('Modpack container clicked - forcing population...')
                populateSidebarInstancesWithRetry(1)
            })
            console.log('Debug click handler added to modpack container:', modpackContainer.id)
        }
        
        // Trigger sidebar population if uibinder is waiting
        if (typeof window.triggerSidebarPopulation === 'function') {
            console.log('[LANDING] Triggering sidebar population...')
            window.triggerSidebarPopulation()
        }
        
        // Force population after some delay
        setTimeout(() => {
            console.log('[LANDING] Force triggering sidebar population...')
            populateSidebarInstancesWithRetry(3)
        }, 2000)
    }, 500)
})

// Also initialize immediately if DOM is already loaded
if (document.readyState === 'loading') {
    console.log('DOM is still loading...')
} else {
    console.log('DOM is ready, initializing immediately...')
    setTimeout(initNewInterface, 100)
}

// Make functions globally accessible for debugging
window.populateSidebarInstancesDebug = populateSidebarInstances
window.populateSidebarInstancesWithRetry = populateSidebarInstancesWithRetry

// Add a simple test function
window.testModpackCards = function() {
    console.log('Testing modpack card system...')
    console.log('populateModpackInstances available:', typeof window.populateModpackInstances)
    console.log('createModpackCard available:', typeof window.createModpackCard)
    console.log('sidebar-instances-cards exists:', !!document.getElementById('sidebar-instances-cards'))
    console.log('modpack-instances-container exists:', !!document.getElementById('modpack-instances-container'))
    
    // Test with dummy data
    if (typeof window.populateModpackInstances === 'function') {
        const testInstances = [
            { id: 'test1', name: 'Test Modpack 1', type: 'STAFF', icon: './assets/images/minecraft.ico' },
            { id: 'test2', name: 'Test Modpack 2', type: 'PUBLIC', icon: './assets/images/minecraft.ico' }
        ]
        window.populateModpackInstances(testInstances, 'test1')
        console.log('Test data populated')
    } else {
        console.error('populateModpackInstances not available')
    }
}

/**
 * Clear launch progress and reset UI to default state
 */
function clearLaunchProgress() {
    console.log('[Landing] Clearing launch progress')
    
    // Utiliser le nouveau LaunchUI si disponible
    if (window.LaunchUI) {
        window.LaunchUI.showReady();
    }
    
    // Mettre à jour l'UI des instances
    updateInstanceUI()
    
    console.log('[Landing] Launch progress cleared')
}

/**
 * Global instance state handler used by launch code and IPC.
 * Accepts payloads like { started: boolean, pid?: number, serverId?: string, starting?: boolean }
 */
window.onInstanceStateChanged = function(payload){
    try {
        console.info('[Landing] onInstanceStateChanged received', payload)
        if(!payload || typeof payload !== 'object') return
        const serverId = payload.serverId || ConfigManager.getSelectedServer()
        if(!serverId) return

        instanceStateMap[serverId] = instanceStateMap[serverId] || {}
        const prevStarted = !!instanceStateMap[serverId].started
        instanceStateMap[serverId].started = !!payload.started
        instanceStateMap[serverId].pid = payload.pid || null
        instanceStateMap[serverId].starting = !!payload.starting
        instanceStateMap[serverId].timestamp = Date.now()

        // Clear progress when game stops, but only if it was previously marked started
        if (payload.started === false && prevStarted === true) {
            setTimeout(() => {
                clearLaunchProgress()
            }, 1000) // Small delay to see final state
        }

        // Update UI for selected server and for this serverId
        if (typeof updateLaunchUIForServer === 'function') {
            updateLaunchUIForServer(serverId)
        }
        const selected = ConfigManager.getSelectedServer()
        if(selected && selected !== serverId && typeof updateLaunchUIForServer === 'function') {
            updateLaunchUIForServer(selected)
        }
    } catch(e){ console.debug('[Landing] onInstanceStateChanged error', e) }
}

// Listen for IPC-relayed instance-state messages
try {
    const { ipcRenderer } = require('electron')
    if(ipcRenderer && typeof ipcRenderer.on === 'function'){
        ipcRenderer.on('instance-state', (_, state) => {
            try {
                // Ensure serverId presence if possible
                if(state && !state.serverId){
                    state.serverId = ConfigManager.getSelectedServer()
                }
                window.onInstanceStateChanged(state)
            } catch(e){ console.debug('[Landing] ipc instance-state handler failed', e) }
        })
    }
} catch(e) {
    // ignore if not running in electron.
}
}

/**
 * Fonction optimisée pour changement instantané de texte avec layers (mode performance)
 */
function animateTextLayerSwap(containerEl, newHTML, opts = {}){
    if(!containerEl) return Promise.resolve()
    
    // Mode instantané pour améliorer les performances
    try {
        // Trouve les layers ou fait un fallback
        const current = containerEl.querySelector('.text-layer.current')
        const next = containerEl.querySelector('.text-layer.next')
        
        if(!current || !next) {
            // Fallback - change directement le contenu
            containerEl.innerHTML = DOMPurify.sanitize(newHTML || '')
            return Promise.resolve()
        }

        // Swap instantané des layers
        const sanitized = DOMPurify.sanitize(newHTML || '')
        
        // Cache l'élément actuel et affiche le nouveau
        current.style.display = 'none'
        current.classList.remove('current')
        
        next.innerHTML = sanitized
        next.style.display = ''
        next.classList.add('current')
        next.classList.remove('next')
        
        // Prépare le prochain swap en renommant les layers
        current.classList.add('next')
        
        // Nettoyage des classes d'animation
        current.classList.remove('text-exit', 'text-enter')
        next.classList.remove('text-exit', 'text-enter')
        
    } catch (e) {
        console.debug('[Landing] animateTextLayerSwap error', e)
        // Fallback en cas d'erreur
        try {
            containerEl.innerHTML = DOMPurify.sanitize(newHTML || '')
        } catch (ee) {}
    }
    
    return Promise.resolve()
}

// Bind clear cache button
try {
    const clearBtn = document.getElementById('clearCacheButton')
    if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
            try {
                // Confirmation to avoid accidental data loss
                if (!confirm(Lang.queryJS ? Lang.queryJS('landing.clearCacheConfirm') || 'Vider le cache du launcher ?' : 'Vider le cache du launcher ?')) return

                setLaunchDetails('Vider le cache...')
                toggleLaunchArea(true)

                const { ipcRenderer } = require('electron')
                const res = await ipcRenderer.invoke('clear-app-cache')

                if (res && res.success) {
                    setLaunchDetails('Cache vidé avec succès.')
                    setTimeout(() => {
                        toggleLaunchArea(false)
                    }, 1500)
                } else {
                    setLaunchDetails('Échec du nettoyage du cache: ' + (res && res.error ? res.error : 'Erreur inconnue'))
                    setTimeout(() => {
                        toggleLaunchArea(false)
                    }, 3000)
                }
            } catch (err) {
                console.error('Erreur clear cache', err)
                setLaunchDetails('Erreur lors du nettoyage: ' + (err && err.message ? err.message : String(err)))
                setTimeout(() => { toggleLaunchArea(false) }, 3000)
            }
        })
    }
} catch (e) { /* ignore if DOM not ready */ }