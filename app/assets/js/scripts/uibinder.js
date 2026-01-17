/**
 * Initialize UI functions which depend on internal modules.
 * Loaded after core UI functions are initialized in uicore.js.
 */
// Requirements
const path = require('path')
const { Type } = require('helios-distribution-types')

const AuthManager = require('./assets/js/authmanager')
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
                <button ${disabledAttr} role="button" aria-pressed="${isSelected ? 'true' : 'false'}" aria-disabled="${!whitelistAllowed ? 'true' : 'false'}"
                        class="instance-item btn btn-ghost w-full group text-left transition-all mb-2 ${isSelected ? 'selected' : ''} ${disabledClasses}"
                        data-server-id="${serverId}"
                        title="${serverName}${disabledTitle ? ' — ' + disabledTitle : ''}">
                    <div class="flex items-center justify-between gap-3">
                     <!-- Selection Indicator -->
                       

                    <!-- Left: small icon + title -->
                        <div class="flex-1 min-w-0 flex items-center gap-3">
                             ${isSelected ? `
                        <div class="flex-shrink-0">
                            <i class="bi bi-check-circle-fill text-[#F8BA59] text-lg"></i>
                        </div>
                        ` : `
                        <div class="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <i class="bi bi-arrow-right-circle text-gray-500 text-lg"></i>
                        </div>
                        `}
                            <div class="min-w-0">
                                <div class="text-white font-semibold text-sm truncate ${isSelected ? 'text-[#F8BA59]' : ''}">
                                    ${serverName}
                                </div>
                            </div>
                        </div>

                    <!-- Right: larger image -->
                        <div class=" flex-shrink-0 ml-auto">
                            <img src="${iconUrl}"
                                 alt="${serverName}"
                                 class="w-12 h-12 rounded-lg object-cover"
                                 onerror="this.src='assets/images/SealCircle.png'" />
                            
                        </div>
                    </div>
                </button>
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
    const instanceButtons = document.querySelectorAll('.instance-item, .server-instance-btn')

    instanceButtons.forEach((button, index) => {
        // Remove existing listeners
        const newButton = button.cloneNode(true)
        button.parentNode.replaceChild(newButton, button)

        // Click handler
        newButton.addEventListener('click', async (e) => {
            e.preventDefault()
            const btn = e.currentTarget
            btn.blur()

            // Check if disabled (whitelist)
            if (btn.disabled) {
                const title = btn.getAttribute('title') || ''
                setOverlayContent('Accès restreint', title, 'OK')
                setOverlayHandler(() => { toggleOverlay(false) })
                toggleOverlay(true, true)
                return
            }

            // Don't reselect if already selected
            if (btn.classList.contains('selected')) {
                return
            }

            const serverId = btn.getAttribute('data-server-id')

            try {
                const distro = await DistroAPI.getDistribution()
                const server = distro.getServerById(serverId)

                if (server) {
                    // Update selected server
                    if (typeof window.updateSelectedServer === 'function') {
                        window.updateSelectedServer(server)
                    }

                    // Refresh server status
                    if (typeof refreshServerStatus === 'function') {
                        await refreshServerStatus(true)
                    }

                    // Repopulate sidebar
                    await populateSidebarInstances()
                }
            } catch (error) {
                console.error('[UIBINDER] Error selecting server:', error)
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

        // Make keyboard focusable (skip focus for disabled)
        if (newButton.disabled) {
            newButton.setAttribute('tabindex', '-1')
        } else {
            newButton.setAttribute('tabindex', '0')
        }
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

// Disable view transition animations to avoid layout/display bugs during view switches.
// Set `window.__disableViewAnimations = false` elsewhere to re-enable if desired.
const DISABLE_VIEW_ANIMATIONS = (typeof window !== 'undefined' && window.__disableViewAnimations === false) ? false : true

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
function switchView(current, next, currentFadeTime = 500, nextFadeTime = 500, onCurrentFade = () => { }, onNextFade = () => { }) {
    currentView = next
    // If animations are disabled, perform immediate hide/show to avoid visual glitches.
    if (DISABLE_VIEW_ANIMATIONS || currentFadeTime === 0 || nextFadeTime === 0) {
        try {
            $(`${current}`).hide()
        } catch (e) { try { document.querySelector(current).style.display = 'none' } catch (err) { } }
        try { $(current).addClass('hidden') } catch (e) { }
        Promise.resolve().then(async () => {
            try { await onCurrentFade() } catch (e) { console.warn('onCurrentFade error', e) }
            try { $(`${next}`).removeClass('hidden') } catch (e) { }
            try { $(`${next}`).show() } catch (e) { try { document.querySelector(next).style.display = '' } catch (err) { } }
            try { await onNextFade() } catch (e) { console.warn('onNextFade error', e) }
        })
        return
    }

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
function getCurrentView() {
    return currentView
}

async function showMainUI(data) {

    if (!isDev) {
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
    if (typeof window.updateSelectedServer === 'function') {
        window.updateSelectedServer(data.getServerById(ConfigManager.getSelectedServer()))
    }
    if (typeof refreshServerStatus === 'function') {
        refreshServerStatus()
    }

    // Populate sidebar instances for the new interface
    console.log('[UIBINDER] Calling populateSidebarInstances()...')
    populateSidebarInstances()

    setTimeout(() => {
        document.getElementById('frameBar').style.backgroundColor = ''
        document.body.style.backgroundImage = `'none')`
        $('#main').show()

        const isLoggedIn = Object.keys(ConfigManager.getAuthAccounts()).length > 0

        // If this is enabled in a development environment we'll get ratelimited.
        // The relaunch frequency is usually far too high.
        if (!isDev && isLoggedIn) {
            validateSelectedAccount()
            // Start periodic validation and schedule based on token expiry
            try {
                if (typeof schedulePeriodicValidation === 'function') schedulePeriodicValidation()
                if (typeof scheduleValidationBasedOnExpiry === 'function') scheduleValidationBasedOnExpiry()
            } catch (e) {
                console.warn('Failed to start session validation schedulers', e)
            }
        }

        if (ConfigManager.isFirstLaunch()) {
            currentView = VIEWS.welcome
            if (DISABLE_VIEW_ANIMATIONS) $(VIEWS.welcome).show(); else $(VIEWS.welcome).fadeIn(1000)
        } else {
            if (isLoggedIn) {
                currentView = VIEWS.landing
                if (DISABLE_VIEW_ANIMATIONS) $(VIEWS.landing).show(); else $(VIEWS.landing).fadeIn(1000)
            } else {
                loginOptionsCancelEnabled(false)
                loginOptionsViewOnLoginSuccess = VIEWS.landing
                loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                currentView = VIEWS.loginOptions
                if (DISABLE_VIEW_ANIMATIONS) $(VIEWS.loginOptions).show(); else $(VIEWS.loginOptions).fadeIn(1000)
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
        scheduleInitNewsCall(15, 200, () => { try { $('#newsContainer *').attr('tabindex', '-1') } catch (e) { } })
    }
}

function showFatalStartupError() {
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
function onDistroRefresh(data) {
    if (typeof window.updateSelectedServer === 'function') {
        window.updateSelectedServer(data.getServerById(ConfigManager.getSelectedServer()))
    }
    if (typeof refreshServerStatus === 'function') {
        refreshServerStatus()
    }

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
function syncModConfigurations(data) {

    const syncedCfgs = []

    for (let serv of data.servers) {

        const id = serv.rawServer.id
        const mdls = serv.modules
        const cfg = ConfigManager.getModConfiguration(id)

        if (cfg != null) {

            const modsOld = cfg.mods
            const mods = {}

            for (let mdl of mdls) {
                const type = mdl.rawModule.type

                if (type === Type.ForgeMod || type === Type.LiteMod || type === Type.LiteLoader || type === Type.FabricMod) {
                    if (!mdl.getRequired().value) {
                        const mdlID = mdl.getVersionlessMavenIdentifier()
                        if (modsOld[mdlID] == null) {
                            mods[mdlID] = scanOptionalSubModules(mdl.subModules, mdl)
                        } else {
                            mods[mdlID] = mergeModConfiguration(modsOld[mdlID], scanOptionalSubModules(mdl.subModules, mdl), false)
                        }
                    } else {
                        if (mdl.subModules.length > 0) {
                            const mdlID = mdl.getVersionlessMavenIdentifier()
                            const v = scanOptionalSubModules(mdl.subModules, mdl)
                            if (typeof v === 'object') {
                                if (modsOld[mdlID] == null) {
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

            for (let mdl of mdls) {
                const type = mdl.rawModule.type
                if (type === Type.ForgeMod || type === Type.LiteMod || type === Type.LiteLoader || type === Type.FabricMod) {
                    if (!mdl.getRequired().value) {
                        mods[mdl.getVersionlessMavenIdentifier()] = scanOptionalSubModules(mdl.subModules, mdl)
                    } else {
                        if (mdl.subModules.length > 0) {
                            const v = scanOptionalSubModules(mdl.subModules, mdl)
                            if (typeof v === 'object') {
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
    for (const serv of data.servers) {
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
function scanOptionalSubModules(mdls, origin) {
    if (mdls != null) {
        const mods = {}

        for (let mdl of mdls) {
            const type = mdl.rawModule.type
            // Optional types.
            if (type === Type.ForgeMod || type === Type.LiteMod || type === Type.LiteLoader || type === Type.FabricMod) {
                // It is optional.
                if (!mdl.getRequired().value) {
                    mods[mdl.getVersionlessMavenIdentifier()] = scanOptionalSubModules(mdl.subModules, mdl)
                } else {
                    if (mdl.hasSubModules()) {
                        const v = scanOptionalSubModules(mdl.subModules, mdl)
                        if (typeof v === 'object') {
                            mods[mdl.getVersionlessMavenIdentifier()] = v
                        }
                    }
                }
            }
        }

        if (Object.keys(mods).length > 0) {
            const ret = {
                mods
            }
            if (!origin.getRequired().value) {
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
function mergeModConfiguration(o, n, nReq = false) {
    if (typeof o === 'boolean') {
        if (typeof n === 'boolean') return o
        else if (typeof n === 'object') {
            if (!nReq) {
                n.value = o
            }
            return n
        }
    } else if (typeof o === 'object') {
        if (typeof n === 'boolean') return typeof o.value !== 'undefined' ? o.value : true
        else if (typeof n === 'object') {
            if (!nReq) {
                n.value = typeof o.value !== 'undefined' ? o.value : true
            }

            const newMods = Object.keys(n.mods)
            for (let i = 0; i < newMods.length; i++) {

                const mod = newMods[i]
                if (o.mods[mod] != null) {
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
let validationInProgress = false

/**
 * Validate the currently selected account.
 * Returns true if account is valid, false otherwise.
 * @param {boolean} force If true, bypass cooldown and force validation.
 * @returns {Promise<boolean>} Whether the account is valid
 */
async function validateSelectedAccount(force = false) {
    const now = Date.now()

    // Prevent concurrent validations
    if (validationInProgress && !force) {
        console.debug('[UIBINDER] Validation already in progress, skipping')
        return true // Assume valid while checking
    }

    // Éviter les validations trop fréquentes sauf si forcé
    if (!force && (now - lastValidationTime < VALIDATION_COOLDOWN)) {
        console.debug('[UIBINDER] Validation skipped (cooldown active)')
        return true
    }

    const selectedAcc = ConfigManager.getSelectedAccount()
    if (selectedAcc == null) {
        console.warn('[UIBINDER] No account selected, redirecting to login')
        // No account selected, show login
        switchView(getCurrentView(), VIEWS.loginOptions)
        return false
    }
    
    // Validate account data integrity before attempting validation
    if (!selectedAcc.uuid || !selectedAcc.type) {
        console.error('[UIBINDER] Selected account has corrupted data')
        // Remove corrupted account
        try {
            ConfigManager.removeAuthAccount(selectedAcc.uuid || 'unknown')
            ConfigManager.save()
        } catch (e) { /* ignore */ }
        switchView(getCurrentView(), VIEWS.loginOptions)
        return false
    }
    
    validationInProgress = true
    lastValidationTime = now
    console.debug('[UIBINDER] Starting account validation for', selectedAcc.displayName)

    let val = false
    try {
        val = await AuthManager.validateSelected()
    } catch (validationError) {
        console.error('[UIBINDER] Account validation threw error:', validationError)
        val = false
    } finally {
        validationInProgress = false
    }
    
    if (!val) {
        console.warn('[UIBINDER] Account validation failed for', selectedAcc.displayName)

        // Donner une chance de reconnecter avant de supprimer le compte
        const allAccounts = ConfigManager.getAuthAccounts() || {}
        const accLen = Object.keys(allAccounts).length

        // Pour les comptes Microsoft, proposer une reconnexion au lieu de supprimer immédiatement
        if (selectedAcc.type === 'microsoft') {
            // Check if this is likely a temporary failure (network issue)
            const isLikelyTemporary = !navigator.onLine
            
            const message = isLikelyTemporary 
                ? 'Impossible de valider votre compte car vous êtes hors-ligne. Connectez-vous à Internet pour continuer.'
                : 'Votre session Microsoft a expiré. Veuillez vous reconnecter pour continuer.'
            
            const buttonText = isLikelyTemporary ? 'Réessayer' : 'Se reconnecter'
            
            setOverlayContent(
                Lang.queryJS('uibinder.validateAccount.failedMessageTitle'),
                message,
                buttonText,
                accLen > 1 ? Lang.queryJS('uibinder.validateAccount.selectAnotherAccountButton') : 'Annuler'
            )
            setOverlayHandler(() => {
                try { toggleOverlay(false) } catch (e) { console.warn('toggleOverlay failed in overlayHandler', e) }
                
                if (isLikelyTemporary) {
                    // Retry validation after a delay
                    setTimeout(() => {
                        validateSelectedAccount(true)
                    }, 2000)
                } else {
                    // Redirect to Microsoft login
                    loginOptionsViewOnLoginSuccess = getCurrentView()
                    loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                    switchView(getCurrentView(), VIEWS.loginOptions, 500, 500)
                }
            })
            setDismissHandler(() => {
                try {
                    if (accLen > 1) {
                        // Sélectionner un autre compte s'il y en a
                        const accountKeys = Object.keys(allAccounts).filter(key => key !== selectedAcc.uuid)
                        if (accountKeys.length > 0) {
                            ConfigManager.setSelectedAccount(accountKeys[0])
                            ConfigManager.save()
                            // Revalidate with new account
                            setTimeout(() => validateSelectedAccount(true), 500)
                        }
                    }
                } catch (e) {
                    console.warn('dismiss handler failed', e)
                }
                // Always close the overlay after dismiss action
                try { toggleOverlay(false) } catch (e) { console.warn('toggleOverlay failed in dismissHandler', e) }
            })
            toggleOverlay(true)
            return false
        } else {
            // Pour les comptes Mojang, garder l'ancien comportement
            ConfigManager.removeAuthAccount(selectedAcc.uuid)
            ConfigManager.save()
            
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

                if (isMicrosoft) {
                    // Empty for now
                } else {
                    // Mojang
                    // For convenience, pre-populate the username of the account.
                    document.getElementById('loginUsername').value = selectedAcc.username
                    validateEmail(selectedAcc.username)
                }

                loginOptionsViewOnLoginSuccess = getCurrentView()
                loginOptionsViewOnLoginCancel = VIEWS.loginOptions

                if (accLen > 0) {
                    loginOptionsViewOnCancel = getCurrentView()
                    loginOptionsViewCancelHandler = () => {
                        if (isMicrosoft) {
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
                if (accLen > 1) {
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
            return false
        }
    }
    
    return true
}

// Expose a helper to force validation from other scripts (bypasses cooldown)
window.forceValidateSelectedAccount = function () {
    try {
        return validateSelectedAccount(true)
    } catch (e) {
        console.warn('[UIBINDER] forceValidateSelectedAccount failed', e)
    }
}

/**
 * Temporary function to update the selected account along
 * with the relevent UI elements.
 * 
 * @param {string} uuid The UUID of the account.
 */
function setSelectedAccount(uuid) {
    const authAcc = ConfigManager.setSelectedAccount(uuid)
    ConfigManager.save()
    updateSelectedAccount(authAcc)
    validateSelectedAccount()
    try {
        if (typeof window.refreshAuthAccountSelected === 'function' && authAcc && authAcc.uuid) {
            window.refreshAuthAccountSelected(authAcc.uuid)
        }
    } catch (e) {
        console.warn('Failed to call refreshAuthAccountSelected after setSelectedAccount', e)
    }
    try {
        if (typeof scheduleValidationBasedOnExpiry === 'function') scheduleValidationBasedOnExpiry()
    } catch (e) {
        console.warn('Failed to reschedule validation after setSelectedAccount', e)
    }
}

// Validation automatique avec contrôle de fréquence
let lastFocusValidation = 0
const FOCUS_VALIDATION_COOLDOWN = 365 * 24 * 60 * 60 * 1000 // 1 an

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

    if (document.readyState === 'interactive' || document.readyState === 'complete') {
        if (rscShouldLoad) {
            rscShouldLoad = false
            if (!fatalStartupError) {
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
    if (res) {
        const data = await DistroAPI.getDistribution()
        syncModConfigurations(data)
        ensureJavaSettings(data)
        if (document.readyState === 'interactive' || document.readyState === 'complete') {
            await showMainUI(data)
        } else {
            rscShouldLoad = true
        }
    } else {
        fatalStartupError = true
        if (document.readyState === 'interactive' || document.readyState === 'complete') {
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
    if (typeof window.updateSelectedServer === 'function') {
        window.updateSelectedServer(data.servers[0])
    }
    syncModConfigurations(data)
}
