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
                <li class="server-instance-item group  glass-sidebar transition-all duration-200  p-4  rounded-l-2xl  ${isSelected ? 'bg-[#F8BA59] text-black' : 'bg-gray-900/10 text-white'}" title="${serverName}${disabledTitle ? ' — ' + disabledTitle : ''}">
                    <button ${disabledAttr} class="py-2 pl-3 server-instance-btn glass-sidebar ${isSelected ? 'w-64' : 'w-20'} ${disabledClasses}" 
                        data-server-id="${serverId}"
                        title="${serverName}${disabledTitle ? ' — ' + disabledTitle : ''}">
                        
                        <!-- Icon -->
                        <img src="${iconUrl}" 
                             alt="${serverName}"
                             class="w-14 h-14 rounded-xl"
                             onerror="this.src='assets/images/SealCircle.png'" />
                        
                        <!-- Content -->
                        <div class="flex flex-col justify-center pl-2 min-w-0">
                            <!-- Label: let CSS handle visibility/animation via .block/.hidden classes -->
                            <span class="${isSelected ? 'block animate-slide-right' : 'hidden'} server-instance-label font-semibold text-xl leading-tight max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap" title="${serverName}">
                                ${serverName}
                            </span>
                        </div>
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
                toggleOverlay(true)
                return
            }
            btn.blur()

            // No JS micro-animations here; we rely on CSS width/opacity/transform transitions.
            
            // JS-driven animations (Web Animations API) to show the width change clearly
            try {
                const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
                const toPxForW64 = 16 * rootFontSize // 16rem -> px
                const toPxForW20 = 5 * rootFontSize  // 5rem -> px

                function animateWidth(elem, toPx, duration = 300) {
                    return new Promise((resolve) => {
                        if (!elem) return resolve()
                        const from = parseFloat(getComputedStyle(elem).width)
                        // create animation
                        const anim = elem.animate([
                            { width: from + 'px' },
                            { width: toPx + 'px' }
                        ], {
                            duration,
                            easing: 'cubic-bezier(.2,.9,.2,1)',
                            fill: 'forwards'
                        })
                        anim.onfinish = () => {
                            // ensure final width is applied inline so re-renders keep it stable
                            elem.style.width = toPx + 'px'
                            resolve()
                        }
                        // safety fallback
                        setTimeout(() => { if (anim.playState !== 'finished') { anim.cancel(); elem.style.width = toPx + 'px'; resolve() } }, duration + 80)
                    })
                }

                function animateLabel(elem, show = true, duration = 260, setHiddenOnFinish = false) {
                    return new Promise((resolve) => {
                        if (!elem) return resolve()
                        // ensure visible for animation
                        try { elem.style.display = 'inline-block' } catch (e) {}
                        // If showing, remove hidden class
                        if (show) {
                            try { elem.classList.remove('hidden') } catch (e) {}
                        }

                        const computed = getComputedStyle(elem)
                        const currentOpacity = parseFloat(computed.opacity || 0)
                        const toOpacity = show ? 1 : 0
                        const fromX = show ? -6 : 0
                        const toX = show ? 0 : -6
                        // compute target max-width: prefer inline max-width or computed max-width, fall back to 160px
                        const targetMax = show ? (elem.style.maxWidth || computed.maxWidth || '160px') : '0px'
                        const fromMax = show ? (elem.style.maxWidth || computed.maxWidth === 'none' ? '0px' : '0px') : (elem.style.maxWidth || computed.maxWidth || '160px')

                        const keyframes = [
                            { opacity: currentOpacity, transform: `translateX(${fromX}px)`, maxWidth: fromMax },
                            { opacity: toOpacity, transform: `translateX(${toX}px)`, maxWidth: targetMax }
                        ]

                        const anim = elem.animate(keyframes, { duration, easing: 'cubic-bezier(.2,.9,.2,1)', fill: 'forwards' })
                        anim.onfinish = () => {
                            try {
                                elem.style.opacity = toOpacity
                                elem.style.transform = `translateX(${toX}px)`
                                elem.style.maxWidth = targetMax
                                if (!show && setHiddenOnFinish) elem.classList.add('hidden')
                            } catch (e) {}
                            resolve()
                        }
                        setTimeout(() => { if (anim.playState !== 'finished') { anim.cancel(); try { elem.style.opacity = toOpacity; elem.style.transform = `translateX(${toX}px)`; elem.style.maxWidth = targetMax; if (!show && setHiddenOnFinish) elem.classList.add('hidden') } catch (e) {}; resolve() } }, duration + 60)
                    })
                }

                function animateImgScale(img, toScale = 1.04, duration = 260) {
                    return new Promise((resolve) => {
                        if (!img) return resolve()
                        const anim = img.animate([
                            { transform: 'scale(1)' },
                            { transform: `scale(${toScale})` }
                        ], { duration, easing: 'cubic-bezier(.2,.9,.2,1)', fill: 'forwards' })
                        anim.onfinish = () => { img.style.transform = `scale(${toScale})`; resolve() }
                        setTimeout(() => { if (anim.playState !== 'finished') { anim.cancel(); img.style.transform = `scale(${toScale})`; resolve() } }, duration + 40)
                    })
                }

                // Animate background and text colors to avoid instant white/black jumps
                function animateBg(elem, toColor, duration = 300) {
                    return new Promise((resolve) => {
                        if (!elem) return resolve()
                        const from = getComputedStyle(elem).backgroundColor
                        const anim = elem.animate([
                            { backgroundColor: from },
                            { backgroundColor: toColor }
                        ], { duration, easing: 'ease-out', fill: 'forwards' })
                        anim.onfinish = () => { try { elem.style.backgroundColor = toColor } catch (e) {} ; resolve() }
                        setTimeout(() => { if (anim.playState !== 'finished') { anim.cancel(); try { elem.style.backgroundColor = toColor } catch (e) {}; resolve() } }, duration + 60)
                    })
                }

                function animateColor(elem, toColor, duration = 300) {
                    return new Promise((resolve) => {
                        if (!elem) return resolve()
                        const from = getComputedStyle(elem).color
                        // ensure starting color is inline to avoid flash
                        try { elem.style.color = from } catch (e) {}
                        const anim = elem.animate([
                            { color: from },
                            { color: toColor }
                        ], { duration, easing: 'ease-out', fill: 'forwards' })
                        anim.onfinish = () => { try { elem.style.color = toColor } catch (e) {}; resolve() }
                        setTimeout(() => { if (anim.playState !== 'finished') { anim.cancel(); try { elem.style.color = toColor } catch (e) {}; resolve() } }, duration + 60)
                    })
                }

                const prevBtn = document.querySelector('.server-instance-btn.w-64')
                const prevLabel = prevBtn && prevBtn.querySelector('span.font-semibold.text-xl')
                const prevImg = prevBtn && prevBtn.querySelector('img')
                const tgtLabel = btn.querySelector('span.font-semibold.text-xl')
                const tgtImg = btn.querySelector('img')

                // Determine elements for background/text animation
                const prevLi = prevBtn && prevBtn.closest('li.server-instance-item')
                const tgtLi = btn.closest('li.server-instance-item')

                const selectionBg = 'rgb(248, 186, 89)' // #F8BA59
                const selectionText = 'rgb(0, 0, 0)'

                const tasks = []

                // Animate previous selected's bg/text back to default
                if (prevLi && prevLi !== tgtLi) {
                    const defaultBg = getComputedStyle(tgtLi || prevLi).backgroundColor || 'rgba(17,24,39,0.1)'
                    const defaultText = getComputedStyle(tgtLi || prevLi).color || 'rgb(255,255,255)'
                    tasks.push(animateBg(prevLi, defaultBg, 260))
                    tasks.push(animateColor(prevLi, defaultText, 260))
                    // label fade out + image scale back
                    tasks.push(animateLabel(prevLabel, false, 180, true))
                    tasks.push(animateImgScale(prevImg, 1))
                    tasks.push(animateWidth(prevBtn, toPxForW20))
                    // update width classes after animation so Tailwind styles don't jump in the middle
                    tasks.push(new Promise(res => setTimeout(() => { prevBtn.classList.remove('w-64'); prevBtn.classList.add('w-20'); res() }, 360)))
                }

                // Animate target element's bg/text to selection colors
                if (tgtLi && btn && !btn.classList.contains('w-64')) {
                    const defaultBg = getComputedStyle(tgtLi).backgroundColor || 'rgba(17,24,39,0.1)'
                    const defaultText = getComputedStyle(tgtLi).color || 'rgb(255,255,255)'
                    // ensure label unhidden and starting styles prepared
                    if (tgtLabel && tgtLabel.classList.contains('hidden')) {
                        tgtLabel.classList.remove('hidden')
                        tgtLabel.style.opacity = '0'
                        tgtLabel.style.transform = 'translateX(-6px)'
                    }
                    // JS 'pop' animation for the label to guarantee it appears even if CSS class animations fail
                    try {
                        if (tgtLabel) {
                            tgtLabel.style.display = 'inline-block'
                            // remove any lingering inline maxWidth to compute correctly
                            tgtLabel.style.maxWidth = tgtLabel.style.maxWidth || '0px'
                            const popAnim = tgtLabel.animate([
                                { opacity: 0, transform: 'translateX(-6px) scale(.98)', maxWidth: '0px' },
                                { opacity: 1, transform: 'translateX(0) scale(1)', maxWidth: '160px' }
                            ], { duration: 220, easing: 'cubic-bezier(.2,.9,.2,1)', fill: 'forwards' })
                            popAnim.onfinish = () => {
                                try {
                                    tgtLabel.style.opacity = '1'
                                    tgtLabel.style.transform = 'translateX(0)'
                                    tgtLabel.style.maxWidth = '160px'
                                    tgtLabel.classList.add('block')
                                } catch (e) {}
                            }
                        }
                    } catch (e) {
                        console.warn('[UIBINDER] label pop animation failed', e)
                    }
                    tasks.push(animateBg(tgtLi, selectionBg, 260))
                    tasks.push(animateColor(tgtLi, selectionText, 260))
                    tasks.push(animateWidth(btn, toPxForW64))
                    tasks.push(animateLabel(tgtLabel, true))
                    tasks.push(animateImgScale(tgtImg, 1.04))
                    tasks.push(new Promise(res => setTimeout(() => { btn.classList.remove('w-20'); btn.classList.add('w-64'); res() }, 360)))
                }

                await Promise.all(tasks)
            } catch (tcErr) {
                console.warn('[UIBINDER] Width transition helper failed', tcErr)
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
        await onCurrentFade()
        $(`${next}`).fadeIn(nextFadeTime, async () => {
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

    await prepareSettings(true)
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

async function validateSelectedAccount(){
    const selectedAcc = ConfigManager.getSelectedAccount()
    if(selectedAcc != null){
        const val = await AuthManager.validateSelected()
        if(!val){
            ConfigManager.removeAuthAccount(selectedAcc.uuid)
            ConfigManager.save()
            const accLen = Object.keys(ConfigManager.getAuthAccounts()).length
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

// When the app regains focus or becomes visible again, validate tokens immediately.
try {
    window.addEventListener('focus', () => {
        try {
            console.debug('[UIBINDER] window.focus -> validateSelectedAccount')
            validateSelectedAccount()
            if (typeof scheduleValidationBasedOnExpiry === 'function') scheduleValidationBasedOnExpiry()
        } catch (e) {
            console.warn('Focus handler validation failed', e)
        }
    })

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            try {
                console.debug('[UIBINDER] visibilitychange visible -> validateSelectedAccount')
                validateSelectedAccount()
                if (typeof scheduleValidationBasedOnExpiry === 'function') scheduleValidationBasedOnExpiry()
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
