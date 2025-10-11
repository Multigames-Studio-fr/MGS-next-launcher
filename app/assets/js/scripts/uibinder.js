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
            
               
            // If whitelist disallows the selected account, skip the server (don't show it)
            if (!whitelistAllowed) {
                console.log('[UIBINDER] Skipping server', serverId, 'because whitelist disallows current account')
                continue
            }

            htmlString += `
                <li class="server-instance-item group  transition-all duration-200  p-4  rounded-l-2xl  ${isSelected ? 'bg-[#F8BA59] text-black' : 'bg-gray-900/10 text-white'}" title="${serverName}">
                    <button class="py-2 pl-3 server-instance-btn ${isSelected ? 'w-64' : 'w-20'}" 
                        data-server-id="${serverId}"
                        title="${serverName}">
                        
                        <!-- Icon -->
                        <img src="${iconUrl}" 
                             alt="${serverName}"
                             class="w-14 h-14 rounded-xl"
                             onerror="this.src='assets/images/SealCircle.png'" />
                        
                        <!-- Content -->
                        <div class="flex flex-col justify-center pl-2 min-w-0">
                            <!-- Badge STAFF -->
                            <span class="${isSelected ? 'block' : 'hidden'}  font-semibold text-xl leading-tight max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap" title="${serverName}">
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
    welcome: '#welcomeContainer',
    waiting: '#waitingContainer'
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
        document.getElementById('frameBar').style.backgroundColor = 'rgba(0, 0, 0, 0.5)'
        document.body.style.backgroundImage = `url('assets/images/backgrounds/${document.body.getAttribute('bkid')}.jpg')`
        $('#main').show()

        const isLoggedIn = Object.keys(ConfigManager.getAuthAccounts()).length > 0

        // If this is enabled in a development environment we'll get ratelimited.
        // The relaunch frequency is usually far too high.
        if(!isDev && isLoggedIn){
            validateSelectedAccount()
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
        console.warn('[UIBINDER] initNews is not yet available')
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
        console.warn('[UIBINDER] initNews is not yet available')
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
