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
const ModDeduplicator         = require('./assets/js/moddeduplicator')

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

const loggerLanding = LoggerUtil.getLogger('Landing')

// News Variables - Initialize early to prevent reference errors
let newsArr = null
let newsLoadingListener = null
let newsActive = false

// Per-instance runtime state map: { serverId: { started: boolean, pid: number|null, timestamp: number } }
const instanceStateMap = {}
// Transition counter to cancel in-flight instance-change animations when a new change arrives
let instanceTransitionCounter = 0
// Per-element tokens for text swap cancellation
const textAnimationTokens = new WeakMap()
// Per-element tokens for button selection animation cancellation
const buttonAnimationTokens = new WeakMap()

/**
 * Animate swapping selection between two sidebar buttons.
 * Handles cancellation via per-element tokens and updates 'selected' class and image borders.
 */
async function animateButtonSwap(prevBtn, nextBtn){
    // simple helper to wait for animationend (with fallback)
    const waitAnim = (el, cls, fallback = 260) => new Promise(resolve => {
        if(!el) return resolve()
        let done = false
        const onEnd = () => { if(done) return; done = true; try{ el.removeEventListener('animationend', onEnd) }catch(e){}; resolve() }
        try{ el.addEventListener('animationend', onEnd) }catch(e){}
        el.classList.add(cls)
        setTimeout(() => { if(!done){ done = true; try{ el.removeEventListener('animationend', onEnd) }catch(e){}; resolve() } }, fallback + 40)
    })

    // tokens
    const tokenPrev = prevBtn ? (buttonAnimationTokens.get(prevBtn) || 0) + 1 : null
    const tokenNext = nextBtn ? (buttonAnimationTokens.get(nextBtn) || 0) + 1 : null
    if(prevBtn) buttonAnimationTokens.set(prevBtn, tokenPrev)
    if(nextBtn) buttonAnimationTokens.set(nextBtn, tokenNext)

    try {
        // exit previous
        if(prevBtn){
            // animate label out if present (slide-label style)
            try {
                const labelPrev = prevBtn.querySelector('.font-semibold.text-xl.leading-tight')
                if(labelPrev) labelPrev.classList.add('label-slide-out')
            } catch (e) { /* ignore */ }

            await waitAnim(prevBtn, 'instance-btn-exit', 220)
            // cancelled?
            if(buttonAnimationTokens.get(prevBtn) !== tokenPrev) {
                prevBtn.classList.remove('instance-btn-exit')
            } else {
                // remove selected state
                prevBtn.classList.remove('selected')
                const img = prevBtn.querySelector('img')
                if(img){ img.classList.remove('border-[#F8BA59]'); img.classList.add('border-white/20') }
                // cleanup label animation classes
                try {
                    const labelPrev = prevBtn.querySelector('.font-semibold.text-xl.leading-tight')
                    if(labelPrev) labelPrev.classList.remove('label-slide-out','label-slide-in')
                } catch (e) {}
                prevBtn.classList.remove('instance-btn-exit')
            }
        }

        // prepare next: add selected then enter animation
        if(nextBtn){
            // If token changed meanwhile, abort
            if(buttonAnimationTokens.get(nextBtn) !== tokenNext) return
            // prepare label state
            try {
                const labelNext = nextBtn.querySelector('.font-semibold.text-xl.leading-tight')
                if(labelNext) labelNext.classList.remove('label-slide-out','label-slide-in')
            } catch (e) {}
            // mark selected state before enter so CSS selectors apply
            nextBtn.classList.add('selected')
            const img = nextBtn.querySelector('img')
            if(img){ img.classList.remove('border-white/20'); img.classList.add('border-[#F8BA59]') }

            // animate label in if present
            try {
                const labelNext = nextBtn.querySelector('.font-semibold.text-xl.leading-tight')
                if(labelNext) labelNext.classList.add('label-slide-in')
            } catch (e) {}

            await waitAnim(nextBtn, 'instance-btn-enter', 260)
            // cleanup
            if(buttonAnimationTokens.get(nextBtn) === tokenNext){
                nextBtn.classList.remove('instance-btn-enter')
                try { const labelNext = nextBtn.querySelector('.font-semibold.text-xl.leading-tight'); if(labelNext) labelNext.classList.remove('label-slide-in') } catch (e) {}
            } else {
                nextBtn.classList.remove('instance-btn-enter')
                nextBtn.classList.remove('selected')
                try { const labelNext = nextBtn.querySelector('.font-semibold.text-xl.leading-tight'); if(labelNext) labelNext.classList.remove('label-slide-in') } catch (e) {}
            }
        }
    } catch (e) {
        // best-effort cleanup
        try { if(prevBtn) prevBtn.classList.remove('instance-btn-exit') } catch (err) {}
        try { if(nextBtn) nextBtn.classList.remove('instance-btn-enter') } catch (err) {}
    } finally {
        if(prevBtn) buttonAnimationTokens.delete(prevBtn)
        if(nextBtn) buttonAnimationTokens.delete(nextBtn)
    }
}

/**
 * Animate swapping the HTML/text of an element with exit -> content swap -> enter.
 * Uses per-element token to cancel in-flight swaps if a new swap is requested.
 * @param {Element} el DOM element
 * @param {string} newHTML sanitized HTML to insert
 * @param {object} opts options: exitClass, enterClass, exitFallback, enterFallback
 */
function animateTextSwap(el, newHTML, opts = {}){
    const {
        exitClass = 'text-exit',
        enterClass = 'text-enter',
        exitFallback = 260,
        enterFallback = 300
    } = opts

    if(!el) return Promise.resolve()

    const prev = textAnimationTokens.get(el) || 0
    const token = prev + 1
    textAnimationTokens.set(el, token)

    const waitAnimation = (element, className, fallback) => {
        return new Promise(resolve => {
            let called = false
            const onEnd = (e) => {
                if(called) return
                called = true
                try { element.removeEventListener('animationend', onEnd) } catch (e) {}
                resolve()
            }
            try { element.addEventListener('animationend', onEnd) } catch (e) {}
            // ensure class is applied
            element.classList.add(className)
            setTimeout(() => {
                if(!called) {
                    called = true
                    try { element.removeEventListener('animationend', onEnd) } catch (e) {}
                    resolve()
                }
            }, fallback + 40)
        })
    }

    return (async () => {
        // exit
        await waitAnimation(el, exitClass, exitFallback)
        // cancelled?
        if(textAnimationTokens.get(el) !== token) {
            // cleanup classes
            try { el.classList.remove(exitClass, enterClass) } catch (e) {}
            return
        }

        // swap content
        try { el.innerHTML = newHTML } catch (e) { el.textContent = newHTML }

        // remove exit and force reflow
        try { el.classList.remove(exitClass) } catch (e) {}
        void el.offsetHeight

        // enter
        await waitAnimation(el, enterClass, enterFallback)

        // final cleanup
        if(textAnimationTokens.get(el) === token) {
            try { el.classList.remove(enterClass) } catch (e) {}
            textAnimationTokens.delete(el)
        } else {
            try { el.classList.remove(exitClass, enterClass) } catch (e) {}
        }
    })()
}

/**
 * Update the landing UI for a given server id based on instanceStateMap
 * - updates launch button label and styling to reflect Running / Starting / Play
 */
function updateLaunchUIForServer(serverId){
    try {
        const launchBtn = document.getElementById('launch_button')
        const details = document.getElementById('launch_details')
        const state = serverId && instanceStateMap[serverId] ? instanceStateMap[serverId] : null

        if (!launchBtn) return

        if(state && state.started){
            // Running
            launchBtn.textContent = ''
            // add icon + label
            launchBtn.innerHTML = `<svg class="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7" fill="currentColor" viewBox="0 0 20 20"><path d="M6 4l12 6-12 6V4z" /></svg> Relancer`
            launchBtn.classList.remove('bg-[#FF6A1A]')
            launchBtn.classList.add('bg-green-600')
            launchBtn.disabled = false
            // show small running indicator
            if(details) setLaunchDetails(Lang.queryJS('landing.dlAsync.doneEnjoyServer'))
            // Show stop and launch-other buttons, hide primary launch
            try { document.getElementById('stop_button').style.display = '' } catch (e) {}
            try { launchBtn.style.display = 'none' } catch (e) {}
        } else if(state && state.starting){
            // Starting
            launchBtn.textContent = ''
            launchBtn.innerHTML = `<svg class="animate-spin w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" stroke-opacity=".2"></circle><path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="4"></path></svg> Démarrage...`
            launchBtn.classList.remove('bg-[#FF6A1A]')
            launchBtn.classList.add('bg-yellow-600')
            launchBtn.disabled = true
            // Hide other action buttons while starting
            try { document.getElementById('stop_button').style.display = 'none' } catch (e) {}
            try { launchBtn.style.display = '' } catch (e) {}
        } else {
            // Not running
            launchBtn.innerHTML = `<svg class="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7" fill="currentColor" viewBox="0 0 20 20"><path d="M6 4l12 6-12 6V4z" /></svg> ${Lang.queryJS('landing.launchButton')}`
            launchBtn.classList.remove('bg-green-600','bg-yellow-600')
            launchBtn.classList.add('bg-[#FF6A1A]')
            launchBtn.disabled = false
            if(details) setLaunchDetails(Lang.queryJS('landing.tabLaunchReady') || '')
            // Ensure primary launch visible, others hidden
            try { document.getElementById('stop_button').style.display = 'none' } catch (e) {}
            try { launchBtn.style.display = '' } catch (e) {}
        }
    } catch(e){ console.debug('[Landing] updateLaunchUIForServer error', e) }
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
    const playInstance = document.querySelector('.play-instance')
    const launchDetails = document.getElementById('launch_details')
    const launchBtn = document.getElementById('launch_button')
    
    if(loading){
        // Animate play buttons out
        if (playInstance) {
            playInstance.style.opacity = '0'
            playInstance.style.transform = 'translateY(-10px)'
            playInstance.style.transition = 'all 0.3s ease'
            setTimeout(() => {
                playInstance.style.display = 'none'
            }, 300)
        }
        
        // Animate launch details in
        if (launchDetails) {
            launchDetails.style.display = 'flex'
            launchDetails.classList.remove('hidden')
            setTimeout(() => {
                launchDetails.classList.add('show')
                launchDetails.style.opacity = '1'
                launchDetails.style.transform = 'translateY(0)'
            }, 50)
        }
        
        // Add pulse animation to launch button
        if (launchBtn) {
            launchBtn.classList.add('launch-pulse')
        }
    } else {
        // Animate launch details out
        if (launchDetails) {
            launchDetails.style.opacity = '0'
            launchDetails.style.transform = 'translateY(-10px)'
            setTimeout(() => {
                launchDetails.style.display = 'none'
                launchDetails.classList.add('hidden')
                launchDetails.classList.remove('show', 'shown')
            }, 300)
        }
        
        // Animate play buttons in
        if (playInstance) {
            playInstance.style.display = 'flex'
            setTimeout(() => {
                playInstance.style.opacity = '1'
                playInstance.style.transform = 'translateY(0)'
            }, 50)
        }
        
        // Remove pulse animation
        if (launchBtn) {
            launchBtn.classList.remove('launch-pulse')
        }
    }
}

/**
 * Set the details text of the loading area.
 * 
 * @param {string} details The new text for the loading details.
 */
function setLaunchDetails(details){
    const newDetailsText = document.getElementById('launch_details_text')
    const detailsContainer = document.getElementById('launch_details')
    
    // Add entrance animation if showing for first time
    if (detailsContainer && !detailsContainer.classList.contains('shown')) {
        detailsContainer.classList.remove('hidden')
        detailsContainer.classList.add('show', 'shown')
        
        // Add pulse animation to launch button
        const launchBtn = document.getElementById('launch_button')
        if (launchBtn && !launchBtn.classList.contains('launch-pulse')) {
            launchBtn.classList.add('launch-pulse')
        }
    }
    
    // Animate text change with fade
    if (newDetailsText) {
        newDetailsText.style.opacity = '0'
        setTimeout(() => {
            newDetailsText.innerHTML = details
            newDetailsText.style.transition = 'opacity 0.3s ease'
            newDetailsText.style.opacity = '1'
        }, 150)
    }
    
    // Keep old functionality for compatibility
    if (launch_details_text) launch_details_text.innerHTML = details
}

/**
 * Set the value of the loading progress bar and display that value.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setLaunchPercentage(percent){
    const progressBar = document.getElementById('launch_progress_bar')
    const progressLabel = document.getElementById('launch_progress_label')
    
    // Update new UI with smooth transition
    if (progressBar) {
        progressBar.style.transition = 'width 0.3s ease-out'
        progressBar.style.width = percent + '%'
        
        // Add glow effect when reaching milestones
        if (percent >= 100) {
            progressBar.classList.add('glow-pulse')
            setTimeout(() => {
                progressBar.classList.remove('glow-pulse')
            }, 2000)
        }
    }
    
    if (progressLabel) {
        progressLabel.style.transition = 'opacity 0.2s ease'
        progressLabel.style.opacity = '0'
        setTimeout(() => {
            progressLabel.innerHTML = percent + '%'
            progressLabel.style.opacity = '1'
        }, 100)
    }
    
    // Keep old progress bar for compatibility
    if (launch_progress) {
        launch_progress.setAttribute('max', 100)
        launch_progress.setAttribute('value', percent)
    }
    if (launch_progress_label) {
        launch_progress_label.innerHTML = percent + '%'
    }
}

/**
 * Set the value of the OS progress bar and display that on the UI.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setDownloadPercentage(percent){
    remote.getCurrentWindow().setProgressBar(percent/100)
    setLaunchPercentage(percent)
}

/**
 * Enable or disable the launch button.
 * 
 * @param {boolean} val True to enable, false to disable.
 */
function setLaunchEnabled(val){
    document.getElementById('launch_button').disabled = !val
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
document.getElementById('launch_button').addEventListener('click', async e => {
    loggerLanding.info('Launching game..')
    // Immediate UI feedback: show starting state right away to avoid perceived latency
    try {
        const launchBtn = document.getElementById('launch_button')
        setLaunchDetails(Lang.queryJS && Lang.queryJS('landing.launch.starting') || 'Démarrage...')
        toggleLaunchArea(true)
        setLaunchPercentage(0)
        if (launchBtn) {
            try {
                launchBtn.innerHTML = `<svg class="animate-spin w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" stroke-opacity=".2"></circle><path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="4"></path></svg> Démarrage...`
                launchBtn.classList.remove('bg-[#FF6A1A]')
                launchBtn.classList.add('bg-yellow-600')
                launchBtn.disabled = true
            } catch (e) { /* ignore UI update errors */ }
        }
    } catch (e) { /* non-critical */ }
    try {
        // Vérifier l'état des mises à jour avant de lancer
        const updateStatus = await checkUpdateStatus()
        if (updateStatus.hasUpdate || updateStatus.downloading) {
            loggerLanding.warn('Update in progress or available, preventing launch')
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

            const details = await validateSelectedJvm(ensureJavaDirIsRoot(jExe), server.effectiveJavaOptions.supported)
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

// Bind stop button
try {
    const stopBtn = document.getElementById('stop_button')
    if (stopBtn) {
        stopBtn.addEventListener('click', async () => {
            loggerLanding.info('Stop button clicked')
            try {
                // Attempt graceful shutdown of proc if present
                if (proc && typeof proc.kill === 'function') {
                    try {
                        proc.kill()
                    } catch (e) {
                        loggerLanding.warn('Failed to kill process directly', e)
                        try { proc.kill('SIGKILL') } catch (e2) {}
                    }
                } else {
                    // If no local proc, still notify main to stop by serverId
                    try {
                        const { ipcRenderer } = require('electron')
                        const payload = { request: 'stop', serverId: ConfigManager.getSelectedServer() }
                        ipcRenderer.send('request-instance-action', payload)
                    } catch (e) { /* ignore */ }
                }

                // Notify UI and other windows
                const payload = { started: false, serverId: ConfigManager.getSelectedServer() }
                if (typeof window !== 'undefined' && typeof window.onInstanceStateChanged === 'function') {
                    window.onInstanceStateChanged(payload)
                }
                try {
                    const { ipcRenderer } = require('electron')
                    ipcRenderer.send('instance-state', payload)
                } catch (e) { loggerLanding.debug && loggerLanding.debug('ipcRenderer not available to send instance-state stop (from stop button)', e) }

            } catch (e) {
                loggerLanding.error('Error handling stop button click', e)
            }
        })
    }
} catch (e) { /* ignore binding errors */ }

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
}

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

// Bind selected server
async function updateSelectedServer(serv, instant = false){
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()
    
    // Update server info in the new UI. If `instant` is true, apply changes
    // immediately without running the animated transition sequence.
    const serverTitle = document.querySelector('.server-title')
    const serverDesc = document.querySelector('.server-desc')
    const serverVersion = document.querySelector('.server-version')
    const serverLoader = document.querySelector('.server-loader')
    const serverStatusName = document.querySelector('.server-status-name')
    const playInstance = document.querySelector('.play-instance')

    if (instant) {
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
    } else {
        // Token for cancelling outdated transitions
        const myTransitionToken = ++instanceTransitionCounter
        
        // Helper: add animation class and wait for animationend on elements (with a fallback timeout)
        const animateAndWait = (els, addClass, fallback = 360) => {
            return new Promise(resolve => {
                if (!els || els.length === 0) return resolve()
                let remaining = els.length
                const onEnd = (e) => {
                    try { e.currentTarget.removeEventListener('animationend', onEnd) } catch (e) {}
                    remaining--
                    if (remaining <= 0) resolve()
                }
                els.forEach(el => {
                    try {
                        el.addEventListener('animationend', onEnd)
                    } catch (e) {}
                    // trigger animation
                    el.classList.add(addClass)
                })
                // fallback in case animationend doesn't fire
                setTimeout(() => resolve(), fallback)
            })
        }

        // Apply slide-out for title/desc and fade-out for meta, then update, then slide-in/fade-in
        const textEls = [serverTitle, serverDesc].filter(el => el)
        const metaEls = [serverVersion, serverLoader].filter(el => el)

        try {
            // Start animations in parallel: meta fades out first. Text uses per-element layered animation.
            const outPromises = []
            if (metaEls.length) outPromises.push(animateAndWait(metaEls, 'instance-fade-out', 260))
            await Promise.all(outPromises)

            // If a newer transition started, abort and cleanup
            if (myTransitionToken !== instanceTransitionCounter) {
                // remove any out classes left behind
                textEls.forEach(el => { try { el.classList.remove('instance-slide-out','instance-slide-in') } catch (e) {} })
                metaEls.forEach(el => { try { el.classList.remove('instance-fade-out','instance-fade-in') } catch (e) {} })
                return
            }

            // Update content while out of view (use two-layer swap if available)
            if (serv != null) {
                const titleHtml = DOMPurify.sanitize(serv.rawServer.name || '')
                const descHtml = DOMPurify.sanitize(serv.rawServer.description || '')
                // Use layered swap when possible
                if (serverTitle) await animateTextLayerSwap(serverTitle, titleHtml)
                if (serverDesc) await animateTextLayerSwap(serverDesc, descHtml)
                if (serverVersion) serverVersion.textContent = serv.rawServer.minecraftVersion || '--'
                if (serverLoader) serverLoader.textContent = serv.rawServer.loader || '--'
                if (serverStatusName) serverStatusName.textContent = serv.rawServer.name
            } else {
                if (serverTitle) await animateTextLayerSwap(serverTitle, 'Veuillez sélectionner une instance')
                if (serverDesc) await animateTextLayerSwap(serverDesc, 'Aucune instance sélectionnée.<br>Choisissez une instance pour voir ses informations.')
                if (serverVersion) serverVersion.textContent = '--'
                if (serverLoader) serverLoader.textContent = '--'
                if (serverStatusName) serverStatusName.textContent = 'Multigames-Studio.fr'
            }

            // Trigger meta elements fade-in
            metaEls.forEach(el => {
                el.classList.remove('instance-fade-out')
                void el.offsetHeight
                el.classList.add('instance-fade-in')
            })

            // Add glow/slide to play button if server selected
            if (playInstance && serv != null) {
                playInstance.classList.add('slide-up-anim')
            }

            // Wait for meta fade-in to complete
            const inPromises = []
            if (metaEls.length) inPromises.push(animateAndWait(metaEls, 'instance-fade-in', 300))
            await Promise.all(inPromises)

            // If a newer transition started while animating in, stop and cleanup
            if (myTransitionToken !== instanceTransitionCounter) {
                textEls.forEach(el => { try { el.classList.remove('instance-slide-in','instance-slide-out') } catch (e) {} })
                metaEls.forEach(el => { try { el.classList.remove('instance-fade-in','instance-fade-out') } catch (e) {} })
                return
            }
        } catch (e) {
            // Ensure classes are cleaned up
            textEls.forEach(el => { try { el.classList.remove('instance-slide-out','instance-slide-in') } catch (e) {} })
            metaEls.forEach(el => { try { el.classList.remove('instance-fade-out','instance-fade-in') } catch (e) {} })
        } finally {
            textEls.forEach(el => { try { el.classList.remove('instance-slide-in') } catch (e) {} })
            metaEls.forEach(el => { try { el.classList.remove('instance-fade-in') } catch (e) {} })
            if (playInstance) {
                playInstance.classList.remove('slide-up-anim')
            }
        }
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

    try {
        const servStat = await getServerStatus(47, serv.hostname, serv.port)
        console.log(servStat)
        pLabel = Lang.queryJS('landing.serverStatus.players')
        pVal = servStat.players.online + '/' + servStat.players.max
    } catch (err) {
        loggerLanding.warn('Unable to refresh server status, assuming offline.')
        loggerLanding.debug(err)
    }
    
    // Update new UI elements
    const playerCountNew = document.querySelector('.player-count')
    const serverStatusDot = document.querySelector('.server-status-dot')
    const serverStatusText = document.querySelector('.server-status-text')
    
    if (playerCountNew) playerCountNew.textContent = pVal.split('/')[0] || '0'
    
    // Update server status dot color based on online/offline
    if (serverStatusDot) {
        if (pVal === Lang.queryJS('landing.serverStatus.offline')) {
            serverStatusDot.className = 'server-status-dot w-3 h-3 rounded-full bg-red-400'
        } else {
            serverStatusDot.className = 'server-status-dot w-3 h-3 rounded-full bg-green-400'
        }
    }
    
    if (serverStatusText) {
        const status = pVal === Lang.queryJS('landing.serverStatus.offline') ? 'Hors ligne' : 'Opérationnel'
        serverStatusText.innerHTML = `${status} • <span class="font-bold text-[#F8BA59] player-count">${pVal.split('/')[0] || '0'}</span> joueurs`
    }
    
    // Update old UI for compatibility
    if(fade && typeof $ !== 'undefined'){
        $('#server_status_wrapper').fadeOut(250, () => {
            const landingPlayerLabel = document.getElementById('landingPlayerLabel')
            const playerCount = document.getElementById('player_count')
            if (landingPlayerLabel) landingPlayerLabel.innerHTML = pLabel
            if (playerCount) playerCount.innerHTML = pVal
            $('#server_status_wrapper').fadeIn(500)
        })
    } else {
        const landingPlayerLabel = document.getElementById('landingPlayerLabel')
        const playerCount = document.getElementById('player_count')
        if (landingPlayerLabel) landingPlayerLabel.innerHTML = pLabel
        if (playerCount) playerCount.innerHTML = pVal
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

    const jvmDetails = await discoverBestJvmInstallation(
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.supported
    )

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
    await downloadFile(asset.url, asset.path, ({ transferred }) => {
        received = transferred
        setDownloadPercentage(Math.trunc((transferred/asset.size)*100))
    })
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

async function dlAsync(login = true) {

    // Login parameter is temporary for debug purposes. Allows testing the validation/downloads without
    // launching the game.

    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))

    // Let the renderer paint the updated launch UI before starting heavy work.
    // Small non-blocking yield to the event loop so the progress bar becomes visible.
    try { await new Promise(resolve => setTimeout(resolve, 50)) } catch (e) { /* ignore */ }

    let distro

    try {
        distro = await DistroAPI.refreshDistributionOrFallback()
        onDistroRefresh(distro)
    } catch(err) {
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }

    const serv = distro.getServerById(ConfigManager.getSelectedServer())

    // login can be: true (online), false (no auth, debug), or 'offline' (use local account in offline mode)
    if(login) {
        if(ConfigManager.getSelectedAccount() == null){
            loggerLanding.error('You must be logged into an account.')
            return
        }
    }

    setLaunchDetails(Lang.queryJS('landing.dlAsync.pleaseWait'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const fullRepairModule = new FullRepair(
        ConfigManager.getCommonDirectory(),
        ConfigManager.getInstanceDirectory(),
        ConfigManager.getLauncherDirectory(),
        ConfigManager.getSelectedServer(),
        DistroAPI.isDevMode()
    )

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

    // Always delete and redownload FancyMenu config on launch
    // This ensures FancyMenu is always fresh and up-to-date
    // This must be done BEFORE file verification so FancyMenu files are included in the verification
    try {
        loggerLaunchSuite.info('Auto-cleaning FancyMenu config on launch...')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.forcingFancyMenuRedownload') || 'Suppression de la configuration FancyMenu...')
        try { await new Promise(resolve => setTimeout(resolve, 40)) } catch (e) { /* ignore */ }
        
        // Remove FancyMenu config directory to force re-download from distribution
        const instancePath = ConfigManager.getInstanceDirectory()
        const fancymenuPath = path.join(instancePath, serv.rawServer.id, 'config', 'fancymenu')
        
        // Delete FancyMenu directory if it exists
        if (fs.existsSync(fancymenuPath)) {
            loggerLaunchSuite.info('Removing FancyMenu config at: ' + fancymenuPath)
            fs.removeSync(fancymenuPath)
            loggerLaunchSuite.info('FancyMenu config directory deleted. Will be re-downloaded from distribution.')
        } else {
            loggerLaunchSuite.info('FancyMenu config directory not found, will be downloaded fresh from distribution.')
        }
        
        loggerLaunchSuite.info('FancyMenu will be re-downloaded from distribution during file verification.')
    } catch (err) {
        loggerLaunchSuite.error('Error clearing FancyMenu config:', err)
        // Continue anyway - don't block launch on FancyMenu deletion error
    }

    // If the UI reports offline, skip validation and downloads to avoid
    // network-related validation errors (Transmitter errors) while offline.
    const offlineDetectedForValidation = (typeof navigator !== 'undefined' && !navigator.onLine)

    if (offlineDetectedForValidation) {
        loggerLaunchSuite.info('Offline detected — skipping file validation and downloads.')
        // Update UI to reflect offline skipping
        try{
            setLaunchDetails(Lang.queryJS('landing.dlAsync.offlineSkippingValidation') || 'Mode hors-ligne détecté — validation et téléchargement ignorés.')
        } catch(e){ /* ignore */ }
        var invalidFileCount = 0
    } else {
        loggerLaunchSuite.info('Validating files.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
        // Yield briefly to ensure UI updates before starting potentially expensive file I/O/CPU work
        try { await new Promise(resolve => setTimeout(resolve, 40)) } catch (e) { /* ignore */ }
        let invalidFileCount = 0
        try {
            invalidFileCount = await fullRepairModule.verifyFiles(percent => {
                setLaunchPercentage(percent)
            })
            setLaunchPercentage(100)
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
    }

    // Remove download bar.
    remote.getCurrentWindow().setProgressBar(-1)

    fullRepairModule.destroyReceiver()

    // Vérification des mods de triche avant le lancement
    setLaunchDetails('Vérification des mods de triche...')
    try {
        const modsDir = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id, 'mods')
        // yield briefly before starting filesystem-heavy scan so the renderer can paint
        try { await new Promise(resolve => setTimeout(resolve, 30)) } catch (e) { /* ignore */ }
        const cleanResult = await ModDeduplicator.scanAndCleanCheatMods(modsDir)
        
        if (cleanResult.deleted > 0) {
            loggerLaunchSuite.warn(`Supprimé ${cleanResult.deleted} mod(s) de triche détecté(s)`)
            setLaunchDetails(`${cleanResult.deleted} mod(s) de triche supprimé(s). Redémarrage du launcher...`)
            
            // Attendre 3 secondes pour que l'utilisateur voie le message
            await new Promise(resolve => setTimeout(resolve, 3000))
            
            // Redémarrer le launcher
            const { ipcRenderer } = require('electron')
            ipcRenderer.send('relaunchApplication')
            return
        } else {
            loggerLaunchSuite.info('Aucun mod de triche trouvé')
        }
    } catch (err) {
        loggerLaunchSuite.error('Erreur lors de la vérification des mods de triche:', err)
        // Continuer le lancement même en cas d'erreur
    }

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
    const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
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
            // Refresh token before launching to prevent authentication errors
            await validateSelectedAccount()
            authUser = ConfigManager.getSelectedAccount()
        }
        loggerLaunchSuite.info(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)
        let pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, remote.app.getVersion())
        setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingGame'))

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

            // Variable pour tracker les détections de triche
            let cheatDetected = false
            let detectedCheatMod = null

            // Démarrer la surveillance des mods de triche pendant le jeu
            let modWatcher = null
            try {
                const modsDir = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id, 'mods')
                modWatcher = ModDeduplicator.watchForCheatMods(modsDir, async (cheatMod) => {
                    loggerLaunchSuite.warn(`Mod de triche détecté pendant le jeu: ${cheatMod.baseName}`)
                    
                    if (cheatDetected) return // Éviter les détections multiples
                    cheatDetected = true
                    detectedCheatMod = cheatMod
                    
                    // Fermer le jeu
                    try {
                        if (proc && typeof proc.kill === 'function') {
                            proc.kill()
                        }
                    } catch (err) {
                        loggerLaunchSuite.error('Erreur lors de la fermeture du jeu:', err)
                    }
                })
            } catch (err) {
                loggerLaunchSuite.error('Erreur lors du démarrage de la surveillance des mods:', err)
            }

            // Listener pour détecter les comportements de triche dans les logs
            const cheatDetectionListener = async (data) => {
                if (cheatDetected) return // Éviter les détections multiples
                
                const logLine = ('' + data).trim()
                
                // Analyser chaque ligne pour détecter un comportement de triche
                if (ModDeduplicator.detectCheatBehaviorInLog(logLine)) {
                    loggerLaunchSuite.warn(`Comportement de triche détecté dans les logs: ${logLine.substring(0, 200)}`)
                    cheatDetected = true
                    
                    // Afficher une notification
                    setLaunchDetails('⚠️ Mod de triche détecté ! Fermeture du jeu...')
                    
                    // Fermer le jeu
                    try {
                        if (proc && typeof proc.kill === 'function') {
                            proc.kill()
                            loggerLaunchSuite.info('Jeu fermé suite à la détection de triche')
                        }
                    } catch (err) {
                        loggerLaunchSuite.error('Erreur lors de la fermeture du jeu:', err)
                    }
                    
                    // Attendre que le jeu se ferme
                    await new Promise(resolve => setTimeout(resolve, 2000))
                    
                    // Scanner et supprimer les mods de triche
                    try {
                        const modsDir = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id, 'mods')
                        const cleanResult = await ModDeduplicator.scanAndCleanCheatMods(modsDir)
                        
                        if (cleanResult.deleted > 0) {
                            loggerLaunchSuite.info(`${cleanResult.deleted} mod(s) de triche supprimé(s)`)
                            setLaunchDetails(`${cleanResult.deleted} mod(s) de triche supprimé(s). Redémarrage du launcher...`)
                            
                            await new Promise(resolve => setTimeout(resolve, 2000))
                            
                            // Redémarrer le launcher
                            const { ipcRenderer } = require('electron')
                            ipcRenderer.send('relaunchApplication')
                        }
                    } catch (err) {
                        loggerLaunchSuite.error('Erreur lors de la suppression des mods de triche:', err)
                    }
                }
            }

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
                const payload = { started: true, pid: proc && proc.pid ? proc.pid : null, serverId: ConfigManager.getSelectedServer() }
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
            proc.stdout.on('data', cheatDetectionListener) // Ajouter le listener de détection de triche
            proc.stderr.on('data', gameErrorListener)
            proc.stderr.on('data', cheatDetectionListener) // Vérifier aussi stderr

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
                        if (modWatcher) {
                            try {
                                modWatcher.close()
                                loggerLaunchSuite.info('Surveillance des mods arrêtée')
                            } catch (err) {
                                loggerLaunchSuite.error('Erreur lors de l\'arrêt de la surveillance des mods:', err)
                            }
                        }
                        
                        // Si un mod de triche a été détecté, supprimer et redémarrer
                        if (cheatDetected && !detectedCheatMod) {
                            loggerLaunchSuite.warn('Jeu fermé suite à détection de triche dans les logs')
                            
                            // Le nettoyage et le redémarrage sont déjà gérés dans cheatDetectionListener
                            // Pas besoin de dupliquer ici
                        } else if (detectedCheatMod) {
                            loggerLaunchSuite.warn(`Jeu fermé suite à détection du mod de triche: ${detectedCheatMod.baseName}`)
                            
                            setLaunchDetails(`Mod de triche détecté: ${detectedCheatMod.baseName}. Suppression...`)
                            
                            // Supprimer le mod détecté
                            try {
                                await ModDeduplicator.deleteCheatMods([detectedCheatMod.path])
                                loggerLaunchSuite.info(`Mod de triche supprimé: ${detectedCheatMod.fileName}`)
                                
                                setLaunchDetails('Mod de triche supprimé. Redémarrage du launcher...')
                                await new Promise(resolve => setTimeout(resolve, 2000))
                                
                                // Redémarrer le launcher
                                const { ipcRenderer } = require('electron')
                                ipcRenderer.send('relaunchApplication')
                                return
                            } catch (err) {
                                loggerLaunchSuite.error('Erreur lors de la suppression du mod de triche:', err)
                            }
                        }
                        
                        const payload = { started: false, serverId: ConfigManager.getSelectedServer() }
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
 * Populate fallback sidebar with old system
 */
function populateFallbackSidebar(instances, selectedServerId) {
    const sidebarContainer = document.getElementById('sidebar-instances')
    if (!sidebarContainer) {
        console.error('[SIDEBAR] Sidebar container not found!')
        return
    }
    
    let htmlString = ''
    
    for (let i = 0; i < instances.length; i++) {
        const instance = instances[i]
        const isSelected = instance.id === selectedServerId
        
        htmlString += `

<li class="server-instance-item group relative">
    <div class="server-instance-card relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-800/80 to-gray-900/90 backdrop-blur-sm border border-gray-700/50 hover:border-[#F8BA59]/50 transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-[#F8BA59]/20">
        <!-- Background gradient overlay -->
        <div class="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/30"></div>
        
        <!-- Glow effect on hover -->
        <div class="absolute inset-0 bg-gradient-to-r from-[#F8BA59]/0 via-[#F8BA59]/5 to-[#F8BA59]/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
        
        <button class="server-instance-btn w-full h-full p-4 relative z-10 ${isSelected ? 'selected' : ''}" 
                data-server-id="${instance.id}"
                title="${instance.name}">
            
            <!-- Status indicator -->
            <div class="absolute top-3 right-3 w-3 h-3 rounded-full ${isSelected ? 'bg-[#F8BA59] shadow-lg shadow-[#F8BA59]/50' : 'bg-gray-500'} transition-all duration-300"></div>
            
            <!-- Main content container -->
            <div class="flex flex-col items-center space-y-3">
                <!-- Icon container with enhanced styling -->
                <div class="relative group-hover:scale-110 transition-transform duration-300">
                    <div class="absolute inset-0 bg-[#F8BA59] rounded-2xl blur-lg opacity-0 group-hover:opacity-30 transition-opacity duration-300"></div>
                    <img src="${instance.icon}" 
                         alt="${instance.name}"
                         class="relative w-16 h-16 rounded-2xl object-cover border-2 ${isSelected ? 'border-[#F8BA59] shadow-lg shadow-[#F8BA59]/30' : 'border-gray-600 group-hover:border-[#F8BA59]/70'} transition-all duration-300" 
                         onerror="this.src='./assets/images/minecraft.ico'" />
                    
                    <!-- Shine effect -->
                    <div class="absolute inset-0 rounded-2xl bg-gradient-to-tr from-white/0 via-white/20 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                </div>
                
                <!-- Instance info -->
                <div class="text-center space-y-1">
                    <h3 class="server-instance-name text-white font-semibold text-sm leading-tight group-hover:text-[#F8BA59] transition-colors duration-300 max-w-full overflow-hidden text-ellipsis whitespace-nowrap" title="${instance.name}">
                        ${instance.name}
                    </h3>
                    
                    <!-- Version/Type badge -->
                    <div class="flex items-center justify-center space-x-2">
                        <span class="px-2 py-1 text-xs rounded-full bg-gray-700/80 text-gray-300 border border-gray-600/50 max-w-20 overflow-hidden text-ellipsis whitespace-nowrap" title="${instance.version || 'Unknown'}">
                            ${instance.version || 'Unknown'}
                        </span>
                        ${instance.type ? `
                        <span class="px-2 py-1 text-xs rounded-full ${instance.type === 'STAFF' ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'} max-w-16 overflow-hidden text-ellipsis whitespace-nowrap" title="${instance.type}">
                            ${instance.type}
                        </span>
                        ` : ''}
                    </div>
                </div>
               
            </div>
            
            <!-- Selection indicator -->
            ${isSelected ? `
            <div class="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-[#F8BA59] to-yellow-400"></div>
            ` : ''}
        </button>
        
        <!-- Animated border on hover -->
        <div class="absolute inset-0 rounded-2xl bg-gradient-to-r from-[#F8BA59]/0 via-[#F8BA59]/50 to-[#F8BA59]/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style="padding: 1px;">
            <div class="w-full h-full rounded-2xl bg-gray-800/90"></div>
        </div>
    </div>
</li>
// ...existing code...
        `
    }
    
    sidebarContainer.innerHTML = htmlString
    bindSidebarInstanceEvents()
    console.log('[SIDEBAR] Fallback sidebar populated')
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
 * Bind events to sidebar instance buttons
 */
function bindSidebarInstanceEvents() {
    const instanceButtons = document.querySelectorAll('.server-instance-btn')
    
    instanceButtons.forEach(button => {
        button.addEventListener('click', async (e) => {
            e.preventDefault()
            e.target.closest('button').blur()
            
            const serverId = button.getAttribute('data-server-id')
            
            try {
                const distro = await DistroAPI.getDistribution()
                const server = distro.getServerById(serverId)
                
                if (server) {
                    // Update selected server
                    updateSelectedServer(server)
                    
                    // Refresh server status for the new server
                    await refreshServerStatus(true)
                }
            } catch (error) {
                console.error('Error selecting server:', error)
            }
        })
    })
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
    
    // Setup avatar overlay click handler for new interface
    const avatarContainer = document.getElementById('avatarContainer')
    if (avatarContainer && !avatarContainer.onclick) {
        avatarContainer.onclick = async (e) => {
            await prepareSettings()
            switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
                settingsNavItemListener(document.getElementById('settingsNavAccount'), false)
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
        sidebarContainer.innerHTML = '<li class="text-white/50 text-xs text-center animate-pulse">En attente de la distribution...</li>'
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
}

/**
 * Global instance state handler used by launch code and IPC.
 * Accepts payloads like { started: boolean, pid?: number, serverId?: string, starting?: boolean }
 */
window.onInstanceStateChanged = function(payload){
    try {
        if(!payload || typeof payload !== 'object') return
        const serverId = payload.serverId || ConfigManager.getSelectedServer()
        if(!serverId) return

        instanceStateMap[serverId] = instanceStateMap[serverId] || {}
        instanceStateMap[serverId].started = !!payload.started
        instanceStateMap[serverId].pid = payload.pid || null
        instanceStateMap[serverId].starting = !!payload.starting
        instanceStateMap[serverId].timestamp = Date.now()

        // Update UI for selected server and for this serverId
        updateLaunchUIForServer(serverId)
        const selected = ConfigManager.getSelectedServer()
        if(selected && selected !== serverId) updateLaunchUIForServer(selected)
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

/**
 * Animate swapping using two-layer approach. Requires the element to contain
 * two child spans with classes `text-layer current` and `text-layer next`.
 */
function animateTextLayerSwap(containerEl, newHTML, opts = {}){
    if(!containerEl) return Promise.resolve()
    // find layers
    const current = containerEl.querySelector('.text-layer.current')
    const next = containerEl.querySelector('.text-layer.next')
    if(!current || !next) {
        // fallback to single-element swap
        return animateTextSwap(containerEl, newHTML, opts)
    }

    const tokenPrev = textAnimationTokens.get(containerEl) || 0
    const token = tokenPrev + 1
    textAnimationTokens.set(containerEl, token)

    const exitClass = opts.exitClass || 'text-exit'
    const enterClass = opts.enterClass || 'text-enter'
    const exitFallback = opts.exitFallback || 220
    const enterFallback = opts.enterFallback || 260

    const waitAnim = (el, cls, fallback) => new Promise(resolve => {
        let called = false
        const onEnd = () => {
            if(called) return
            called = true
            try { el.removeEventListener('animationend', onEnd) } catch (e) {}
            resolve()
        }
        try { el.addEventListener('animationend', onEnd) } catch(e) {}
        el.style.display = ''
        // apply class
        el.classList.add(cls)
        setTimeout(() => {
            if(!called){ called = true; try{ el.removeEventListener('animationend', onEnd) }catch(e){}; resolve() }
        }, fallback + 40)
    })

    return (async () => {
        // Start exit on current and prepare next content
        const sanitized = DOMPurify.sanitize(newHTML || '')
        next.innerHTML = sanitized

        // start exit animation
        await waitAnim(current, exitClass, exitFallback)

        if(textAnimationTokens.get(containerEl) !== token){
            // cancelled
            try { current.classList.remove(exitClass); next.classList.remove(enterClass) } catch(e) {}
            return
        }

        // switch classes: make next enter, current hidden
        current.style.display = 'none'
        current.classList.remove('current')
        current.classList.remove('text-exit')
        next.classList.add('current')
        next.classList.remove('next')
        next.classList.remove('text-enter')

        // ensure next animates
        await waitAnim(next, enterClass, enterFallback)

        if(textAnimationTokens.get(containerEl) === token){
            // cleanup and rotate DOM roles: swap roles to keep structure stable
            try {
                // Make former current into next for future swaps
                current.classList.add('next')
                current.classList.remove('current')
                next.classList.add('current')
                next.classList.remove('next')
                // swap content positions: move former current after next
                try { containerEl.appendChild(current) } catch(e) {}
                current.style.display = 'none'
                next.style.display = ''
                // remove animation classes
                current.classList.remove(exitClass)
                next.classList.remove(enterClass)
            } catch (e) {}
            textAnimationTokens.delete(containerEl)
        } else {
            // cancelled while entering
            try { current.classList.remove(exitClass); next.classList.remove(enterClass) } catch(e) {}
        }
    })()
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