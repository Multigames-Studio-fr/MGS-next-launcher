/**
 * Initialize UI functions which depend on internal modules.
 * Loaded after core UI functions are initialized in uicore.js.
 */
// Requirements
const path          = require('path')
const { Type }      = require('helios-distribution-types')

const AuthManager   = require('./assets/js/authmanager')
const ConfigManager = require('./assets/js/configmanager')
const { DistroAPI } = require('./assets/js/distromanager')

let rscShouldLoad = false
let fatalStartupError = false

/**
 * Populate the sidebar with server instances
 */
async function populateSidebarInstances() {
    console.log('[UIBINDER] populateSidebarInstances() called')
    
    const sidebarContainer = document.getElementById('sidebar-instances')
    if (!sidebarContainer) {
        console.error('[UIBINDER] Sidebar container not found!')
        return
    }
    
    try {
        console.log('[UIBINDER] Fetching distribution...')
        const distro = await DistroAPI.getDistribution()
        
        if (!distro) {
            console.error('[UIBINDER] Distribution is null or undefined!')
            sidebarContainer.innerHTML = '<li class="text-white/50 text-xs text-center">Erreur: distribution non chargée</li>'
            return
        }
        
        console.log('[UIBINDER] Distribution loaded:', distro)
        
        const selectedServerId = ConfigManager.getSelectedServer()
        console.log('[UIBINDER] Selected server ID:', selectedServerId)
        
        const servers = distro.servers
        console.log('[UIBINDER] Number of servers:', servers ? servers.length : 0)
        
        if (!servers || servers.length === 0) {
            console.warn('[UIBINDER] No servers found in distribution')
            sidebarContainer.innerHTML = '<li class="text-white/50 text-xs text-center">Aucune instance disponible</li>'
            return
        }
        
        let htmlString = ''
        
    const selectedAcc = ConfigManager.getSelectedAccount()
    const selectedUUID = selectedAcc && selectedAcc.uuid ? selectedAcc.uuid.toLowerCase() : null
    const selectedUUIDNoDash = selectedUUID ? selectedUUID.replace(/-/g, '') : null

        for (let i = 0; i < servers.length; i++) {
            const serv = servers[i]
            
            if (!serv || !serv.rawServer) {
                console.warn('[UIBINDER] Server #' + i + ' has invalid structure, skipping')
                continue
            }
            
            const serverId = serv.rawServer.id
            const serverName = serv.rawServer.name || 'Instance ' + (i + 1)
            const isSelected = serverId === selectedServerId
            const iconUrl = serv.rawServer.icon || 'assets/images/SealCircle.png'
            // Whitelist handling: if whitelist active, mark allowed or not (show but disabled if not allowed)
            let whitelistAllowed = true
            let whitelistTooltip = ''
            try {
                const wl = serv.rawServer.whitelist
                if (wl && wl.active) {
                    const players = Array.isArray(wl.players) ? wl.players : []
                    console.debug('[UIBINDER] Whitelist active for server', serverId, 'playersCount=', players.length, 'selectedUUID=', selectedUUID)
                    if (!selectedUUID) {
                        whitelistAllowed = false
                        whitelistTooltip = 'Whitelist active — connectez-vous pour vérifier si vous êtes autorisé.'
                        console.log('[UIBINDER] Server', serverId, 'has an active whitelist but no account selected; marking restricted')
                    } else {
                        const matched = players.some(p => {
                            if (!p) return false
                            if (p.uuid) {
                                const pUuid = String(p.uuid).toLowerCase()
                                const pUuidNoDash = pUuid.replace(/-/g, '')
                                if (pUuid === selectedUUID) return true
                                if (pUuidNoDash === selectedUUIDNoDash) return true
                                return false
                            }
                            if (p.name && selectedAcc && selectedAcc.displayName) {
                                return String(p.name).toLowerCase() === String(selectedAcc.displayName).toLowerCase()
                            }
                            return false
                        })
                        console.debug('[UIBINDER] Whitelist match for server', serverId, matched)
                        if (!matched) {
                            whitelistAllowed = false
                            whitelistTooltip = 'Whitelist active — votre compte n\'est pas autorisé.'
                            console.log('[UIBINDER] Selected account not in whitelist for server', serverId, '; marking restricted')
                        }
                    }
                }
            } catch (e) {
                console.warn('[UIBINDER] Error checking whitelist for server', serv && serv.rawServer && serv.rawServer.id, e)
            }
            
               
            // If whitelist disallows the selected account, show the server but mark it disabled
            // so the user still sees the instance but cannot select it.
            let disabledAttr = ''
            let disabledClasses = ''
            let disabledTitle = ''
            if (!whitelistAllowed) {
                console.log('[UIBINDER] Server', serverId, 'is restricted by whitelist; showing as disabled')
                disabledAttr = 'disabled'
                disabledClasses = ' opacity-40 cursor-not-allowed '
                disabledTitle = whitelistTooltip || 'Accès restreint'
            }

            htmlString += `
                <li class="server-instance-item group transition-all duration-300 ease-out p-1 mb-2" title="${serverName}${disabledTitle ? ' — ' + disabledTitle : ''}">
                    <button ${disabledAttr} class="server-instance-btn relative overflow-hidden ${isSelected ? 'w-64' : 'w-22'} ${disabledClasses} 
                        py-3 px-4 rounded-l-2xl transition-all duration-300 ease-out
                        flex items-center gap-3
                        ${isSelected 
                            ? 'bg-white/6 backdrop-blur-md  ' 
                            : 'bg-white/5 backdrop-blur-md border border-white/10 hover:bg-white/10 hover:border-white/20'
                        }
                        ${isSelected ? 'text-white' : 'text-white/80 hover:text-white'}"
                        data-server-id="${serverId}"
                        title="${serverName}${disabledTitle ? ' — ' + disabledTitle : ''}">
                        
                        <!-- Glassmorphism overlay effect -->
                        <div class="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none "></div>
                        
                        <!-- Icon container with glow effect -->
                        <div class="relative flex-shrink-0 transition-transform duration-300 ${isSelected ? 'scale-110' : 'scale-100 group-hover:scale-105'}">
                            <div class="${isSelected ? 'absolute inset-0 bg-[#F8BA59]/30 blur-xl rounded-full animate-pulse' : ''}"></div>
                            <img src="${iconUrl}" 
                                 alt="${serverName}"
                                 class="relative w-14 h-14 rounded-xl shadow-lg transition-all duration-300 ${isSelected ? 'ring-2 ring-[#F8BA59]/50' : ''}"
                                 onerror="this.src='assets/images/SealCircle.png'" />
                        </div>
                        
                        <!-- Content with slide animation -->
                        <div class="flex flex-col justify-center min-w-0 flex-1 transition-all duration-300" style="max-width: ${isSelected ? '180px' : '0px'};">
                            <span class="${isSelected ? 'opacity-100 translate-x-0 text-[#F8BA59]' : 'opacity-0 -translate-x-4'} 
                                server-instance-label font-bold text-lg leading-tight 
                                transition-all duration-300 ease-out whitespace-nowrap overflow-hidden text-ellipsis
                                ${isSelected ? 'block' : 'hidden'}" 
                                title="${serverName}">
                                ${serverName}
                            </span>
                        </div>
                        
                        <!-- Selected indicator glow -->
                        ${isSelected ? '<div class="absolute inset-0 rounded-2xl bg-gradient-to-r from-transparent via-[#F8BA59]/20 to-transparent animate-shimmer pointer-events-none"></div>' : ''}
                    </button>
                </li>
            `
               
        }
        
        sidebarContainer.innerHTML = htmlString
        
        // Bind click events to server instance buttons
        bindSidebarInstanceEvents()
        
        // No JS animation post-render; CSS handles entry/exit transitions.

        console.log('[UIBINDER] Populated sidebar with ' + servers.length + ' server instances')
        
    } catch (error) {
        console.error('[UIBINDER] Error populating sidebar instances:', error)
        sidebarContainer.innerHTML = '<li class="text-white/50 text-xs text-center">Erreur: ' + error.message + '</li>'
    }
}

/**
 * Bind events to sidebar instance buttons
 */
function bindSidebarInstanceEvents() {
    const instanceButtons = document.querySelectorAll('.server-instance-btn')
    
    instanceButtons.forEach(button => {
        button.addEventListener('click', async (e) => {
            e.preventDefault()
            const btn = e.target.closest('button')
            if (!btn) return
            // If button is disabled (whitelist restricted), ignore click
            if (btn.disabled) {
                // Optionally show an overlay explaining whitelist
                const title = btn.getAttribute('title') || ''
                setOverlayContent('Accès restreint', title, 'OK')
                setOverlayHandler(() => { toggleOverlay(false) })
                // Make this overlay dismissable so the user can use the
                // dismiss button or Escape to close it if they prefer not to
                // reconnect immediately.
                toggleOverlay(true, true)
                return
            }
            btn.blur()

            // Glassmorphism animations with smooth transitions
            try {
                const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
                const toPxForW64 = 16 * rootFontSize // 16rem -> px
                const toPxForW20 = 5 * rootFontSize  // 5rem -> px

                function animateWidth(elem, toPx, duration = 400) {
                    return new Promise((resolve) => {
                        if (!elem) return resolve()
                        const from = parseFloat(getComputedStyle(elem).width)
                        const anim = elem.animate([
                            { width: from + 'px' },
                            { width: toPx + 'px' }
                        ], {
                            duration,
                            easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', // Elastic ease-out
                            fill: 'forwards'
                        })
                        anim.onfinish = () => {
                            elem.style.width = toPx + 'px'
                            resolve()
                        }
                        setTimeout(() => { if (anim.playState !== 'finished') { anim.cancel(); elem.style.width = toPx + 'px'; resolve() } }, duration + 80)
                    })
                }

                function animateGlassEffect(elem, selected = true, duration = 400) {
                    return new Promise((resolve) => {
                        if (!elem) return resolve()
                        
                        const fromBg = getComputedStyle(elem).background
                        const toBg = selected 
                            ? 'linear-gradient(135deg, rgba(248, 186, 89, 0.3) 0%, rgba(248, 186, 89, 0.2) 50%, rgba(248, 186, 89, 0.1) 100%)'
                            : 'rgba(255, 255, 255, 0.05)'
                        
                        const fromShadow = getComputedStyle(elem).boxShadow
                        const toShadow = selected
                            ? '0 8px 32px 0 rgba(248, 186, 89, 0.25)'
                            : '0 4px 16px 0 rgba(0, 0, 0, 0.1)'
                        
                        const fromBorder = getComputedStyle(elem).borderColor
                        const toBorder = selected
                            ? 'rgba(248, 186, 89, 0.4)'
                            : 'rgba(255, 255, 255, 0.1)'

                        const anim = elem.animate([
                            { 
                                background: fromBg,
                                boxShadow: fromShadow,
                                borderColor: fromBorder
                            },
                            { 
                                background: toBg,
                                boxShadow: toShadow,
                                borderColor: toBorder
                            }
                        ], { 
                            duration, 
                            easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                            fill: 'forwards' 
                        })
                        
                        anim.onfinish = () => {
                            try {
                                elem.style.background = toBg
                                elem.style.boxShadow = toShadow
                                elem.style.borderColor = toBorder
                            } catch (e) {}
                            resolve()
                        }
                        setTimeout(() => { 
                            if (anim.playState !== 'finished') { 
                                anim.cancel()
                                try {
                                    elem.style.background = toBg
                                    elem.style.boxShadow = toShadow
                                    elem.style.borderColor = toBorder
                                } catch (e) {}
                                resolve()
                            }
                        }, duration + 80)
                    })
                }

                function animateLabel(elem, show = true, duration = 350) {
                    return new Promise((resolve) => {
                        if (!elem) return resolve()

                        const parentDiv = elem.parentElement
                        const fromOpacity = show ? 0 : 1
                        const toOpacity = show ? 1 : 0
                        const fromTransform = show ? 'translateX(-16px)' : 'translateX(0)'
                        const toTransform = show ? 'translateX(0)' : 'translateX(-16px)'
                        const fromMaxWidth = show ? '0px' : '180px'
                        const toMaxWidth = show ? '180px' : '0px'

                        if (show) {
                            elem.classList.remove('opacity-0', '-translate-x-4', 'hidden')
                            elem.classList.add('opacity-100', 'translate-x-0', 'block')
                            if (parentDiv) {
                                parentDiv.style.maxWidth = '0px'
                            }
                        }

                        // Animate parent container width
                        const parentAnim = parentDiv ? parentDiv.animate([
                            { maxWidth: fromMaxWidth },
                            { maxWidth: toMaxWidth }
                        ], { 
                            duration, 
                            easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                            fill: 'forwards' 
                        }) : null

                        // Animate label itself
                        const anim = elem.animate([
                            { 
                                opacity: fromOpacity, 
                                transform: fromTransform,
                                filter: 'blur(4px)'
                            },
                            { 
                                opacity: toOpacity, 
                                transform: toTransform,
                                filter: 'blur(0px)'
                            }
                        ], { 
                            duration, 
                            easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                            fill: 'forwards' 
                        })
                        
                        anim.onfinish = () => {
                            try {
                                elem.style.opacity = toOpacity
                                elem.style.transform = toTransform
                                elem.style.filter = 'blur(0px)'
                                if (parentDiv) {
                                    parentDiv.style.maxWidth = toMaxWidth
                                }
                                if (!show) {
                                    elem.classList.add('opacity-0', '-translate-x-4', 'hidden')
                                    elem.classList.remove('opacity-100', 'translate-x-0', 'block')
                                }
                            } catch (e) {}
                            resolve()
                        }
                        
                        setTimeout(() => { 
                            if (anim.playState !== 'finished') { 
                                anim.cancel()
                                if (parentAnim && parentAnim.playState !== 'finished') {
                                    parentAnim.cancel()
                                }
                                try {
                                    elem.style.opacity = toOpacity
                                    elem.style.transform = toTransform
                                    elem.style.filter = 'blur(0px)'
                                    if (parentDiv) {
                                        parentDiv.style.maxWidth = toMaxWidth
                                    }
                                } catch (e) {}
                                resolve()
                            }
                        }, duration + 80)
                    })
                }

                function animateIcon(container, selected = true, duration = 400) {
                    return new Promise((resolve) => {
                        if (!container) return resolve()
                        
                        const fromScale = selected ? 1 : 1.1
                        const toScale = selected ? 1.1 : 1

                        const anim = container.animate([
                            { 
                                transform: `scale(${fromScale})`,
                                filter: selected ? 'drop-shadow(0 0 0px rgba(248, 186, 89, 0))' : 'drop-shadow(0 0 0px rgba(248, 186, 89, 0))'
                            },
                            { 
                                transform: `scale(${toScale})`,
                                filter: selected ? 'drop-shadow(0 0 10px rgba(248, 186, 89, 0.6))' : 'drop-shadow(0 0 0px rgba(248, 186, 89, 0))'
                            }
                        ], { 
                            duration, 
                            easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                            fill: 'forwards' 
                        })
                        
                        anim.onfinish = () => {
                            try {
                                container.style.transform = `scale(${toScale})`
                                container.style.filter = selected ? 'drop-shadow(0 0 10px rgba(248, 186, 89, 0.6))' : 'drop-shadow(0 0 0px rgba(248, 186, 89, 0))'
                            } catch (e) {}
                            resolve()
                        }
                        setTimeout(() => { 
                            if (anim.playState !== 'finished') { 
                                anim.cancel()
                                try {
                                    container.style.transform = `scale(${toScale})`
                                    container.style.filter = selected ? 'drop-shadow(0 0 10px rgba(248, 186, 89, 0.6))' : 'drop-shadow(0 0 0px rgba(248, 186, 89, 0))'
                                } catch (e) {}
                                resolve()
                            }
                        }, duration + 80)
                    })
                }

                const prevBtn = document.querySelector('.server-instance-btn.w-64')
                const prevLabel = prevBtn && prevBtn.querySelector('.server-instance-label')
                const prevIconContainer = prevBtn && prevBtn.querySelector('div.flex-shrink-0')
                const tgtLabel = btn.querySelector('.server-instance-label')
                const tgtIconContainer = btn.querySelector('div.flex-shrink-0')

                const tasks = []

                // Animate previous selected back to normal
                if (prevBtn && prevBtn !== btn) {
                    tasks.push(animateGlassEffect(prevBtn, false))
                    tasks.push(animateLabel(prevLabel, false))
                    tasks.push(animateIcon(prevIconContainer, false))
                    tasks.push(animateWidth(prevBtn, toPxForW20))
                    tasks.push(new Promise(res => setTimeout(() => { 
                        prevBtn.classList.remove('w-64')
                        prevBtn.classList.add('w-20')
                        res()
                    }, 450)))
                }

                // Animate new selection
                if (btn && !btn.classList.contains('w-64')) {
                    tasks.push(animateGlassEffect(btn, true))
                    tasks.push(animateLabel(tgtLabel, true))
                    tasks.push(animateIcon(tgtIconContainer, true))
                    tasks.push(animateWidth(btn, toPxForW64))
                    tasks.push(new Promise(res => setTimeout(() => { 
                        btn.classList.remove('w-20')
                        btn.classList.add('w-64')
                        res()
                    }, 450)))
                }

                await Promise.all(tasks)
            } catch (tcErr) {
                console.warn('[UIBINDER] Glass animation failed', tcErr)
            }

            const serverId = button.getAttribute('data-server-id')
            
            try {
                const distro = await DistroAPI.getDistribution()
                const server = distro.getServerById(serverId)
                
                if (server) {
                    // Update selected server
                    updateSelectedServer(server)
                    
                    // Refresh server status for the new server
                    await refreshServerStatus(true)
                    
                    // Repopulate sidebar to update selection state
                    await populateSidebarInstances()
                }
            } catch (error) {
                console.error('[UIBINDER] Error selecting server:', error)
            }
        })
    })
}

// Make function globally accessible
window.populateSidebarInstances = populateSidebarInstances

// Mapping of each view to their container IDs.
const VIEWS = {
    landing: '#landingContainer',
    loginOptions: '#loginOptionsContainer',
    settings: '#settingsContainer',
    news: '#newsContainer',
    welcome: '#welcomeContainer',
    waiting: '#waitingContainer'
}

/**
 * Try to call window.initNews() when it becomes available.
 * This helps in situations where other renderer scripts are loaded later
 * and `initNews` isn't defined yet at the time we initialize the UI.
 */
function scheduleInitNewsCall(maxRetries = 15, delayMs = 200, onReady = null) {
    try {
        if (typeof window.initNews === 'function') {
            // already available, call immediately and run callback
            try {
                const ret = window.initNews()
                if (ret && typeof ret.then === 'function') ret.then(() => { if (typeof onReady === 'function') onReady() })
                else if (typeof onReady === 'function') onReady()
            } catch (e) { console.warn('[UIBINDER] initNews threw', e) }
            return
        }
        let attempts = 0
        const iv = setInterval(() => {
            attempts++
            try {
                if (typeof window.initNews === 'function') {
                    clearInterval(iv)
                    try {
                        const ret = window.initNews()
                        if (ret && typeof ret.then === 'function') ret.then(() => { if (typeof onReady === 'function') onReady() })
                        else if (typeof onReady === 'function') onReady()
                    } catch (e) { console.warn('[UIBINDER] initNews threw', e) }
                    return
                }
            } catch (e) {
                // ignore and keep retrying until max
            }
            if (attempts >= maxRetries) {
                clearInterval(iv)
                console.warn('[UIBINDER] initNews not available after retries')
            }
        }, delayMs)
    } catch (e) {
        console.warn('[UIBINDER] scheduleInitNewsCall failed', e)
    }
}

// The currently shown view container.
let currentView

/**
 * Switch launcher views.
 * 
 * @param {string} current The ID of the current view container. 
 * @param {*} next The ID of the next view container.
 * @param {*} currentFadeTime Optional. The fade out time for the current view.
 * @param {*} nextFadeTime Optional. The fade in time for the next view.
 * @param {*} onCurrentFade Optional. Callback function to execute when the current
 * view fades out.
 * @param {*} onNextFade Optional. Callback function to execute when the next view
 * fades in.
 */
function switchView(current, next, currentFadeTime = 500, nextFadeTime = 500, onCurrentFade = () => {}, onNextFade = () => {}){
    currentView = next
    $(`${current}`).fadeOut(currentFadeTime, async () => {
        $(current).addClass('hidden')
        await onCurrentFade()
        $(`${next}`).removeClass('hidden').fadeIn(nextFadeTime, async () => {
            await onNextFade()
        })
    })
}

/**
 * Get the currently shown view container.
 * 
 * @returns {string} The currently shown view container.
 */
function getCurrentView(){
    return currentView
}

async function showMainUI(data){

    if(!isDev){
        loggerAutoUpdater.info('Initializing..')
        ipcRenderer.send('autoUpdateAction', 'initAutoUpdater', ConfigManager.getAllowPrerelease())
    }

    try {
        if (typeof prepareSettings === 'function') {
            await prepareSettings(true);
        } else if (typeof window !== 'undefined' && typeof window.prepareSettings === 'function') {
            await window.prepareSettings(true);
        } else {
            console.warn('[UIBINDER] prepareSettings not available at showMainUI time');
        }
    } catch (err) {
        console.warn('[UIBINDER] prepareSettings threw', err);
    }
    updateSelectedServer(data.getServerById(ConfigManager.getSelectedServer()))
    refreshServerStatus()
    
    // Populate sidebar instances for the new interface
    console.log('[UIBINDER] Calling populateSidebarInstances()...')
    populateSidebarInstances()
    
    setTimeout(() => {
        document.getElementById('frameBar').style.backgroundColor = ''
        document.body.style.backgroundImage = `url('assets/images/backgrounds/${document.body.getAttribute('bkid')}.jpg')`
        $('#main').show()

        const isLoggedIn = Object.keys(ConfigManager.getAuthAccounts()).length > 0

        // If this is enabled in a development environment we'll get ratelimited.
        // The relaunch frequency is usually far too high.
        if(!isDev && isLoggedIn){
            validateSelectedAccount()
            // Start periodic validation and schedule based on token expiry
            try {
                if (typeof schedulePeriodicValidation === 'function') schedulePeriodicValidation()
                if (typeof scheduleValidationBasedOnExpiry === 'function') scheduleValidationBasedOnExpiry()
            } catch (e) {
                console.warn('Failed to start session validation schedulers', e)
            }
        }

        if(ConfigManager.isFirstLaunch()){
            currentView = VIEWS.welcome
            $(VIEWS.welcome).fadeIn(1000)
        } else {
            if(isLoggedIn){
                currentView = VIEWS.landing
                $(VIEWS.landing).fadeIn(1000)
            } else {
                loginOptionsCancelEnabled(false)
                loginOptionsViewOnLoginSuccess = VIEWS.landing
                loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                currentView = VIEWS.loginOptions
                $(VIEWS.loginOptions).fadeIn(1000)
            }
        }

        setTimeout(() => {
            $('#loadingContainer').fadeOut(500, () => {
                $('#loadSpinnerImage').removeClass('rotating')
            })
        }, 250)
        
    }, 750)
    // Disable tabbing to the news container.
    if (typeof window.initNews === 'function') {
        initNews().then(() => {
            $('#newsContainer *').attr('tabindex', '-1')
        })
    } else {
        // initNews may be defined by a script loaded later; schedule retries and when ready
        scheduleInitNewsCall(15, 200, () => { try { $('#newsContainer *').attr('tabindex', '-1') } catch (e) {} })
    }
}

function showFatalStartupError(){
    setTimeout(() => {
        $('#loadingContainer').fadeOut(250, () => {
            document.getElementById('overlayContainer').style.background = 'none'
            setOverlayContent(
                Lang.queryJS('uibinder.startup.fatalErrorTitle'),
                Lang.queryJS('uibinder.startup.fatalErrorMessage'),
                Lang.queryJS('uibinder.startup.closeButton')
            )
            setOverlayHandler(() => {
                const window = remote.getCurrentWindow()
                window.close()
            })
            toggleOverlay(true)
        })
    }, 750)
}

/**
 * Common functions to perform after refreshing the distro index.
 * 
 * @param {Object} data The distro index object.
 */
function onDistroRefresh(data){
    updateSelectedServer(data.getServerById(ConfigManager.getSelectedServer()))
    refreshServerStatus()
    
    // Call initNews if it's available
    if (typeof window.initNews === 'function') {
        initNews()
    } else {
        // If initNews arrives shortly after distro refresh, try again a few times
        scheduleInitNewsCall(15, 200)
    }
    
    syncModConfigurations(data)
    ensureJavaSettings(data)
    
    // Populate sidebar instances for the new interface
    console.log('[UIBINDER] onDistroRefresh - calling populateSidebarInstances()...')
    populateSidebarInstances()
}

/**
 * Sync the mod configurations with the distro index.
 * 
 * @param {Object} data The distro index object.
 */
function syncModConfigurations(data){

    const syncedCfgs = []

    for(let serv of data.servers){

        const id = serv.rawServer.id
        const mdls = serv.modules
        const cfg = ConfigManager.getModConfiguration(id)

        if(cfg != null){

            const modsOld = cfg.mods
            const mods = {}

            for(let mdl of mdls){
                const type = mdl.rawModule.type

                if(type === Type.ForgeMod || type === Type.LiteMod || type === Type.LiteLoader || type === Type.FabricMod){
                    if(!mdl.getRequired().value){
                        const mdlID = mdl.getVersionlessMavenIdentifier()
                        if(modsOld[mdlID] == null){
                            mods[mdlID] = scanOptionalSubModules(mdl.subModules, mdl)
                        } else {
                            mods[mdlID] = mergeModConfiguration(modsOld[mdlID], scanOptionalSubModules(mdl.subModules, mdl), false)
                        }
                    } else {
                        if(mdl.subModules.length > 0){
                            const mdlID = mdl.getVersionlessMavenIdentifier()
                            const v = scanOptionalSubModules(mdl.subModules, mdl)
                            if(typeof v === 'object'){
                                if(modsOld[mdlID] == null){
                                    mods[mdlID] = v
                                } else {
                                    mods[mdlID] = mergeModConfiguration(modsOld[mdlID], v, true)
                                }
                            }
                        }
                    }
                }
            }

            syncedCfgs.push({
                id,
                mods
            })

        } else {

            const mods = {}

            for(let mdl of mdls){
                const type = mdl.rawModule.type
                if(type === Type.ForgeMod || type === Type.LiteMod || type === Type.LiteLoader || type === Type.FabricMod){
                    if(!mdl.getRequired().value){
                        mods[mdl.getVersionlessMavenIdentifier()] = scanOptionalSubModules(mdl.subModules, mdl)
                    } else {
                        if(mdl.subModules.length > 0){
                            const v = scanOptionalSubModules(mdl.subModules, mdl)
                            if(typeof v === 'object'){
                                mods[mdl.getVersionlessMavenIdentifier()] = v
                            }
                        }
                    }
                }
            }

            syncedCfgs.push({
                id,
                mods
            })

        }
    }

    ConfigManager.setModConfigurations(syncedCfgs)
    ConfigManager.save()
}

/**
 * Ensure java configurations are present for the available servers.
 * 
 * @param {Object} data The distro index object.
 */
function ensureJavaSettings(data) {

    // Nothing too fancy for now.
    for(const serv of data.servers){
        ConfigManager.ensureJavaConfig(serv.rawServer.id, serv.effectiveJavaOptions, serv.rawServer.javaOptions?.ram)
    }

    ConfigManager.save()
}

/**
 * Recursively scan for optional sub modules. If none are found,
 * this function returns a boolean. If optional sub modules do exist,
 * a recursive configuration object is returned.
 * 
 * @returns {boolean | Object} The resolved mod configuration.
 */
function scanOptionalSubModules(mdls, origin){
    if(mdls != null){
        const mods = {}

        for(let mdl of mdls){
            const type = mdl.rawModule.type
            // Optional types.
            if(type === Type.ForgeMod || type === Type.LiteMod || type === Type.LiteLoader || type === Type.FabricMod){
                // It is optional.
                if(!mdl.getRequired().value){
                    mods[mdl.getVersionlessMavenIdentifier()] = scanOptionalSubModules(mdl.subModules, mdl)
                } else {
                    if(mdl.hasSubModules()){
                        const v = scanOptionalSubModules(mdl.subModules, mdl)
                        if(typeof v === 'object'){
                            mods[mdl.getVersionlessMavenIdentifier()] = v
                        }
                    }
                }
            }
        }

        if(Object.keys(mods).length > 0){
            const ret = {
                mods
            }
            if(!origin.getRequired().value){
                ret.value = origin.getRequired().def
            }
            return ret
        }
    }
    return origin.getRequired().def
}

/**
 * Recursively merge an old configuration into a new configuration.
 * 
 * @param {boolean | Object} o The old configuration value.
 * @param {boolean | Object} n The new configuration value.
 * @param {boolean} nReq If the new value is a required mod.
 * 
 * @returns {boolean | Object} The merged configuration.
 */
function mergeModConfiguration(o, n, nReq = false){
    if(typeof o === 'boolean'){
        if(typeof n === 'boolean') return o
        else if(typeof n === 'object'){
            if(!nReq){
                n.value = o
            }
            return n
        }
    } else if(typeof o === 'object'){
        if(typeof n === 'boolean') return typeof o.value !== 'undefined' ? o.value : true
        else if(typeof n === 'object'){
            if(!nReq){
                n.value = typeof o.value !== 'undefined' ? o.value : true
            }

            const newMods = Object.keys(n.mods)
            for(let i=0; i<newMods.length; i++){

                const mod = newMods[i]
                if(o.mods[mod] != null){
                    n.mods[mod] = mergeModConfiguration(o.mods[mod], n.mods[mod])
                }
            }

            return n
        }
    }
    // If for some reason we haven't been able to merge,
    // wipe the old value and use the new one. Just to be safe
    return n
}

// Cache pour éviter les validations trop fréquentes
let lastValidationTime = 0
const VALIDATION_COOLDOWN = 30000 // 30 secondes

async function validateSelectedAccount(){
    const now = Date.now()
    
    // Éviter les validations trop fréquentes
    if (now - lastValidationTime < VALIDATION_COOLDOWN) {
        console.debug('[UIBINDER] Validation skipped (cooldown active)')
        return
    }
    
    const selectedAcc = ConfigManager.getSelectedAccount()
    if(selectedAcc != null){
        lastValidationTime = now
        console.debug('[UIBINDER] Starting account validation for', selectedAcc.displayName)
        
        const val = await AuthManager.validateSelected()
        if(!val){
            console.warn('[UIBINDER] Account validation failed for', selectedAcc.displayName)
            
            // Donner une chance de reconnecter avant de supprimer le compte
            const accLen = Object.keys(ConfigManager.getAuthAccounts()).length
            
            // Pour les comptes Microsoft, proposer une reconnexion au lieu de supprimer immédiatement
            if (selectedAcc.type === 'microsoft') {
                setOverlayContent(
                    Lang.queryJS('uibinder.validateAccount.failedMessageTitle'),
                    `Votre session Microsoft a expiré. Veuillez vous reconnecter pour continuer.`,
                    'Se reconnecter',
                    accLen > 1 ? Lang.queryJS('uibinder.validateAccount.selectAnotherAccountButton') : 'Annuler'
                )
                setOverlayHandler(() => {
                    // Close overlay then redirect to Microsoft login
                    try { toggleOverlay(false) } catch (e) { console.warn('toggleOverlay failed in overlayHandler', e) }
                    loginOptionsViewOnLoginSuccess = getCurrentView()
                    loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                    switchView(getCurrentView(), VIEWS.loginOptions, 500, 500)
                })
                setDismissHandler(() => {
                    try {
                        if (accLen > 1) {
                            // Sélectionner un autre compte s'il y en a
                            const accounts = ConfigManager.getAuthAccounts()
                            const accountKeys = Object.keys(accounts).filter(key => key !== selectedAcc.uuid)
                            if (accountKeys.length > 0) {
                                ConfigManager.setSelectedAccount(accountKeys[0])
                                ConfigManager.save()
                            }
                        }
                    } catch (e) {
                        console.warn('dismiss handler failed', e)
                    }
                    // Always close the overlay after dismiss action
                    try { toggleOverlay(false) } catch (e) { console.warn('toggleOverlay failed in dismissHandler', e) }
                })
                toggleOverlay(true)
                return
            } else {
                // Pour les comptes Mojang, garder l'ancien comportement
                ConfigManager.removeAuthAccount(selectedAcc.uuid)
                ConfigManager.save()
            }
            
            setOverlayContent(
                Lang.queryJS('uibinder.validateAccount.failedMessageTitle'),
                accLen > 0
                    ? Lang.queryJS('uibinder.validateAccount.failedMessage', { 'account': selectedAcc.displayName })
                    : Lang.queryJS('uibinder.validateAccount.failedMessageSelectAnotherAccount', { 'account': selectedAcc.displayName }),
                Lang.queryJS('uibinder.validateAccount.loginButton'),
                Lang.queryJS('uibinder.validateAccount.selectAnotherAccountButton')
            )
            setOverlayHandler(() => {

                const isMicrosoft = selectedAcc.type === 'microsoft'

                if(isMicrosoft) {
                    // Empty for now
                } else {
                    // Mojang
                    // For convenience, pre-populate the username of the account.
                    document.getElementById('loginUsername').value = selectedAcc.username
                    validateEmail(selectedAcc.username)
                }
                
                loginOptionsViewOnLoginSuccess = getCurrentView()
                loginOptionsViewOnLoginCancel = VIEWS.loginOptions

                if(accLen > 0) {
                    loginOptionsViewOnCancel = getCurrentView()
                    loginOptionsViewCancelHandler = () => {
                        if(isMicrosoft) {
                            ConfigManager.addMicrosoftAuthAccount(
                                selectedAcc.uuid,
                                selectedAcc.accessToken,
                                selectedAcc.username,
                                selectedAcc.expiresAt,
                                selectedAcc.microsoft.access_token,
                                selectedAcc.microsoft.refresh_token,
                                selectedAcc.microsoft.expires_at
                            )
                        } else {
                            ConfigManager.addMojangAuthAccount(selectedAcc.uuid, selectedAcc.accessToken, selectedAcc.username, selectedAcc.displayName)
                        }
                        ConfigManager.save()
                        validateSelectedAccount()
                    }
                    loginOptionsCancelEnabled(true)
                } else {
                    loginOptionsCancelEnabled(false)
                }
                toggleOverlay(false)
                switchView(getCurrentView(), VIEWS.loginOptions)
            })
            setDismissHandler(() => {
                if(accLen > 1){
                    prepareAccountSelectionList()
                    $('#overlayContent').fadeOut(250, () => {
                        bindOverlayKeys(true, 'accountSelectContent', true)
                        $('#accountSelectContent').fadeIn(250)
                    })
                } else {
                    const accountsObj = ConfigManager.getAuthAccounts()
                    const accounts = Array.from(Object.keys(accountsObj), v => accountsObj[v])
                    // This function validates the account switch.
                    setSelectedAccount(accounts[0].uuid)
                    toggleOverlay(false)
                }
            })
            toggleOverlay(true, accLen > 0)
        } else {
            return true
        }
    } else {
        return true
    }
}

/**
 * Temporary function to update the selected account along
 * with the relevent UI elements.
 * 
 * @param {string} uuid The UUID of the account.
 */
function setSelectedAccount(uuid){
    const authAcc = ConfigManager.setSelectedAccount(uuid)
    ConfigManager.save()
    updateSelectedAccount(authAcc)
    validateSelectedAccount()
    try {
        if (typeof scheduleValidationBasedOnExpiry === 'function') scheduleValidationBasedOnExpiry()
    } catch (e) {
        console.warn('Failed to reschedule validation after setSelectedAccount', e)
    }
}

// Validation automatique avec contrôle de fréquence
let lastFocusValidation = 0
const FOCUS_VALIDATION_COOLDOWN = 300000 // 5 minutes

// When the app regains focus or becomes visible again, validate tokens with cooldown.
try {
    window.addEventListener('focus', () => {
        try {
            const now = Date.now()
            if (now - lastFocusValidation > FOCUS_VALIDATION_COOLDOWN) {
                console.debug('[UIBINDER] window.focus -> validateSelectedAccount (after cooldown)')
                lastFocusValidation = now
                validateSelectedAccount()
                if (typeof scheduleValidationBasedOnExpiry === 'function') scheduleValidationBasedOnExpiry()
            } else {
                console.debug('[UIBINDER] window.focus validation skipped (cooldown active)')
            }
        } catch (e) {
            console.warn('Focus handler validation failed', e)
        }
    })

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            try {
                const now = Date.now()
                if (now - lastFocusValidation > FOCUS_VALIDATION_COOLDOWN) {
                    console.debug('[UIBINDER] visibilitychange visible -> validateSelectedAccount (after cooldown)')
                    lastFocusValidation = now
                    validateSelectedAccount()
                    if (typeof scheduleValidationBasedOnExpiry === 'function') scheduleValidationBasedOnExpiry()
                } else {
                    console.debug('[UIBINDER] visibilitychange validation skipped (cooldown active)')
                }
            } catch (e) {
                console.warn('Visibility handler validation failed', e)
            }
        }
    })
} catch (e) {
    // ignoring errors attaching handlers in weird environments
}

// Synchronous Listener
document.addEventListener('readystatechange', async () => {

    if (document.readyState === 'interactive' || document.readyState === 'complete'){
        if(rscShouldLoad){
            rscShouldLoad = false
            if(!fatalStartupError){
                const data = await DistroAPI.getDistribution()
                await showMainUI(data)
            } else {
                showFatalStartupError()
            }
        } 
    }

}, false)

// Actions that must be performed after the distribution index is downloaded.
ipcRenderer.on('distributionIndexDone', async (event, res) => {
    if(res) {
        const data = await DistroAPI.getDistribution()
        syncModConfigurations(data)
        ensureJavaSettings(data)
        if(document.readyState === 'interactive' || document.readyState === 'complete'){
            await showMainUI(data)
        } else {
            rscShouldLoad = true
        }
    } else {
        fatalStartupError = true
        if(document.readyState === 'interactive' || document.readyState === 'complete'){
            showFatalStartupError()
        } else {
            rscShouldLoad = true
        }
    }
})

// Util for development
async function devModeToggle() {
    DistroAPI.toggleDevMode(true)
    const data = await DistroAPI.refreshDistributionOrFallback()
    ensureJavaSettings(data)
    updateSelectedServer(data.servers[0])
    syncModConfigurations(data)
}
