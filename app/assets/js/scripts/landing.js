/**
 * Script for landing.ejs
 */
// Requirements
const { URL }                 = require('url')
const {
    MojangRestAPI,
    getServerStatus
}                             = require('helios-core/mojang')
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

/* Launch Progress Wrapper Functions */

/**
 * Show/hide the loading area.
 * 
 * @param {boolean} loading True if the loading area should be shown, otherwise false.
 */
function toggleLaunchArea(loading){
    const playInstance = document.querySelector('.play-instance')
    const launchDetails = document.getElementById('launch_details')
    
    if(loading){
        if (playInstance) playInstance.style.display = 'none'
        if (launchDetails) {
            launchDetails.style.display = 'flex'
            launchDetails.classList.remove('hidden')
        }
    } else {
        if (playInstance) playInstance.style.display = 'flex'
        if (launchDetails) {
            launchDetails.style.display = 'none'
            launchDetails.classList.add('hidden')
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
    
    // Update new UI
    if (newDetailsText) newDetailsText.innerHTML = details
    
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
    
    // Update new UI
    if (progressBar) progressBar.style.width = percent + '%'
    if (progressLabel) progressLabel.innerHTML = percent + '%'
    
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

// Bind launch button
document.getElementById('launch_button').addEventListener('click', async e => {
    loggerLanding.info('Launching game..')
    try {
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
                await dlAsync()

            } else {
                await asyncSystemScan(server.effectiveJavaOptions)
            }
        }
    } catch(err) {
        loggerLanding.error('Unhandled error in during launch process.', err)
        showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
    }
})

// Bind settings button
document.getElementById('settingsMediaButton').onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings)
}

// Bind avatar overlay button.
document.getElementById('avatarOverlay').onclick = async e => {
    await prepareSettings()
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
    const instanceButtons = document.querySelectorAll('.server-instance-btn')
    
    instanceButtons.forEach(button => {
        const serverId = button.getAttribute('data-server-id')
        const img = button.querySelector('img')
        
        if (serverId === selectedServerId) {
            button.classList.add('selected')
            if (img) {
                img.classList.remove('border-white/20')
                img.classList.add('border-[#F8BA59]')
            }
        } else {
            button.classList.remove('selected')
            if (img) {
                img.classList.remove('border-[#F8BA59]')
                img.classList.add('border-white/20')
            }
        }
    })
}

// Make function globally accessible
window.updateSidebarSelection = updateSidebarSelection

// Bind selected server
function updateSelectedServer(serv){
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()
    
    // Update server info in the new UI
    const serverTitle = document.querySelector('.server-title')
    const serverDesc = document.querySelector('.server-desc')
    const serverVersion = document.querySelector('.server-version')
    const serverLoader = document.querySelector('.server-loader')
    const serverStatusName = document.querySelector('.server-status-name')
    
    if (serv != null) {
        if (serverTitle) serverTitle.textContent = serv.rawServer.name
        if (serverDesc) serverDesc.innerHTML = serv.rawServer.description || 'Serveur Minecraft'
        if (serverVersion) serverVersion.textContent = serv.rawServer.minecraftVersion || '--'
        if (serverLoader) serverLoader.textContent = serv.rawServer.loader || '--'
        if (serverStatusName) serverStatusName.textContent = serv.rawServer.name
    } else {
        if (serverTitle) serverTitle.textContent = 'Veuillez sélectionner une instance'
        if (serverDesc) serverDesc.innerHTML = 'Aucune instance sélectionnée.<br>Choisissez une instance pour voir ses informations.'
        if (serverVersion) serverVersion.textContent = '--'
        if (serverLoader) serverLoader.textContent = '--'
        if (serverStatusName) serverStatusName.textContent = 'Multigames-Studio.fr'
    }
    
    // Update sidebar visual selection
    updateSidebarSelection(serv != null ? serv.rawServer.id : null)
    
    // Update old UI for compatibility
    const serverSelectionButton = document.getElementById('server_selection_button')
    if (serverSelectionButton) {
        serverSelectionButton.innerHTML = '&#8226; ' + (serv != null ? serv.rawServer.name : Lang.queryJS('landing.noSelection'))
    }
    
    if(getCurrentView() === VIEWS.settings){
        animateSettingsTabRefresh()
    }
    setLaunchEnabled(serv != null)
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
    
    document.getElementById('mojangStatusEssentialContainer').innerHTML = tooltipEssentialHTML
    document.getElementById('mojangStatusNonEssentialContainer').innerHTML = tooltipNonEssentialHTML
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
        // Just incase the settings UI is already open.
        settingsJavaExecVal.value = javaExec
        await populateJavaExecDetails(settingsJavaExecVal.value)

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

async function dlAsync(login = true) {

    // Login parameter is temporary for debug purposes. Allows testing the validation/downloads without
    // launching the game.

    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))

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

    loggerLaunchSuite.info('Validating files.')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
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
    

    if(invalidFileCount > 0) {
        loggerLaunchSuite.info('Downloading files.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
        setLaunchPercentage(0)
        try {
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

    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))

    const mojangIndexProcessor = new MojangIndexProcessor(
        ConfigManager.getCommonDirectory(),
        serv.rawServer.minecraftVersion)
    const distributionIndexProcessor = new DistributionIndexProcessor(
        ConfigManager.getCommonDirectory(),
        distro,
        serv.rawServer.id
    )

    const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
    const versionData = await mojangIndexProcessor.getVersionJson()

    if(login) {
        const authUser = ConfigManager.getSelectedAccount()
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

            // Bind listeners to stdout.
            proc.stdout.on('data', tempListener)
            proc.stderr.on('data', gameErrorListener)

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
    newsArticleTitle.innerHTML = articleObject.title
    newsArticleTitle.href = articleObject.link
    newsArticleAuthor.innerHTML = 'by ' + articleObject.author
    newsArticleDate.innerHTML = articleObject.date
    newsArticleComments.innerHTML = articleObject.comments
    newsArticleComments.href = articleObject.commentsLink
    newsArticleContentScrollable.innerHTML = '<div id="newsArticleContentWrapper"><div class="newsArticleSpacerTop"></div>' + articleObject.content + '<div class="newsArticleSpacerBot"></div></div>'
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
                    // Pas d'utilisateur sélectionné => ne pas afficher
                    if (!selectedUUID) {
                        console.log('[SIDEBAR] Server', serv.rawServer.id, 'has an active whitelist but no account is selected; hiding')
                        return null
                    }

                    const players = Array.isArray(wl.players) ? wl.players : []
                    const matched = players.some(p => {
                        if (!p) return false
                        // comparer par uuid si disponible, sinon par nom
                        if (p.uuid) {
                            return p.uuid.toLowerCase() === selectedUUID
                        }
                        if (p.name && selectedAcc.displayName) {
                            return p.name === selectedAcc.displayName
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
// ...existing code...
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