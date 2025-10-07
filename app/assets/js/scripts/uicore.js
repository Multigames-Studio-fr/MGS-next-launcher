/**
 * Core UI functions are initialized in this file. This prevents
 * unexpected errors from breaking the core features. Specifically,
 * actions in this file should not require the usage of any internal
 * modules, excluding dependencies.
 */
// Requirements
const $                              = require('jquery')
const {ipcRenderer, shell, webFrame} = require('electron')
const remote                         = require('@electron/remote')
const isDev                          = require('./assets/js/isdev')
const { LoggerUtil }                 = require('helios-core')
const Lang                           = require('./assets/js/langloader')

const loggerUICore             = LoggerUtil.getLogger('UICore')
const loggerAutoUpdater        = LoggerUtil.getLogger('AutoUpdater')

// Log deprecation and process warnings.
process.traceProcessWarnings = true
process.traceDeprecation = true

// Disable eval function.
// eslint-disable-next-line
window.eval = global.eval = function () {
    throw new Error('Sorry, this app does not support window.eval().')
}

// Display warning when devtools window is opened.
remote.getCurrentWebContents().on('devtools-opened', () => {
    console.log('%cThe console is dark and full of terrors.', 'color: white; -webkit-text-stroke: 4px #a02d2a; font-size: 60px; font-weight: bold')
    console.log('%cIf you\'ve been told to paste something here, you\'re being scammed.', 'font-size: 16px')
    console.log('%cUnless you know exactly what you\'re doing, close this window.', 'font-size: 16px')
})

// Disable zoom, needed for darwin.
webFrame.setZoomLevel(0)
webFrame.setVisualZoomLevelLimits(1, 1)

// Initialize auto updates in production environments.
let updateCheckListener
if(!isDev){
    ipcRenderer.on('autoUpdateNotification', (event, arg, info) => {
        switch(arg){
            case 'checking-for-update':
                loggerAutoUpdater.info('Checking for update..')
                settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.checkingForUpdateButton'), true)
                break
            case 'update-available':
                loggerAutoUpdater.info('New update available', info.version)
                
                if(process.platform === 'darwin'){
                    info.darwindownload = `https://github.com/dscalzi/HeliosLauncher/releases/download/v${info.version}/Helios-Launcher-setup-${info.version}${process.arch === 'arm64' ? '-arm64' : '-x64'}.dmg`
                    showUpdateUI(info)
                }
                
                populateSettingsUpdateInformation(info)
                break
            case 'update-downloaded':
                loggerAutoUpdater.info('Update ' + info.version + ' ready to be installed.')
                settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.installNowButton'), false, () => {
                    if(!isDev){
                        ipcRenderer.send('autoUpdateAction', 'installUpdateNow')
                    }
                })
                showUpdateUI(info)
                break
            case 'update-not-available':
                loggerAutoUpdater.info('No new update found.')
                settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.checkForUpdatesButton'))
                break
            case 'ready':
                updateCheckListener = setInterval(() => {
                    ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
                }, 1800000)
                ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
                break
            case 'realerror':
                if(info != null && info.code != null){
                    if(info.code === 'ERR_UPDATER_INVALID_RELEASE_FEED'){
                        loggerAutoUpdater.info('No suitable releases found.')
                    } else if(info.code === 'ERR_XML_MISSED_ELEMENT'){
                        loggerAutoUpdater.info('No releases found.')
                    } else {
                        loggerAutoUpdater.error('Error during update check..', info)
                        loggerAutoUpdater.debug('Error Code:', info.code)
                    }
                }
                break
            default:
                loggerAutoUpdater.info('Unknown argument', arg)
                break
        }
    })
}

/**
 * Send a notification to the main process changing the value of
 * allowPrerelease. If we are running a prerelease version, then
 * this will always be set to true, regardless of the current value
 * of val.
 * 
 * @param {boolean} val The new allow prerelease value.
 */
function changeAllowPrerelease(val){
    ipcRenderer.send('autoUpdateAction', 'allowPrereleaseChange', val)
}

function showUpdateUI(info){
    //TODO Make this message a bit more informative `${info.version}`
    document.getElementById('image_seal_container').setAttribute('update', true)
    document.getElementById('image_seal_container').onclick = () => {
        /*setOverlayContent('Update Available', 'A new update for the launcher is available. Would you like to install now?', 'Install', 'Later')
        setOverlayHandler(() => {
            if(!isDev){
                ipcRenderer.send('autoUpdateAction', 'installUpdateNow')
            } else {
                console.error('Cannot install updates in development environment.')
                toggleOverlay(false)
            }
        })
        setDismissHandler(() => {
            toggleOverlay(false)
        })
        toggleOverlay(true, true)*/
        switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
            settingsNavItemListener(document.getElementById('settingsNavUpdate'), false)
        })
    }
}

/* jQuery Example
$(function(){
    loggerUICore.info('UICore Initialized');
})*/

document.addEventListener('readystatechange', function () {
    if (document.readyState === 'interactive'){
        loggerUICore.info('UICore Initializing..')

        // Bind close button.
        Array.from(document.getElementsByClassName('fCb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                window.close()
            })
        })

        // Bind restore down button.
        Array.from(document.getElementsByClassName('fRb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                if(window.isMaximized()){
                    window.unmaximize()
                } else {
                    window.maximize()
                }
                document.activeElement.blur()
            })
        })

        // Bind minimize button.
        Array.from(document.getElementsByClassName('fMb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                window.minimize()
                document.activeElement.blur()
            })
        })

        // Remove focus from social media buttons once they're clicked.
        Array.from(document.getElementsByClassName('mediaURL')).map(val => {
            val.addEventListener('click', e => {
                document.activeElement.blur()
            })
        })

    } else if(document.readyState === 'complete'){

        //266.01
        //170.8
        //53.21
        // Bind progress bar length to length of bot wrapper
        //const targetWidth = document.getElementById("launch_content").getBoundingClientRect().width
        //const targetWidth2 = document.getElementById("server_selection").getBoundingClientRect().width
        //const targetWidth3 = document.getElementById("launch_button").getBoundingClientRect().width

        const launchDetails = document.getElementById('launch_details')
        const launchProgress = document.getElementById('launch_progress')
        const launchDetailsRight = document.getElementById('launch_details_right')
        const launchProgressLabel = document.getElementById('launch_progress_label')
        
        if (launchDetails) launchDetails.style.maxWidth = 266.01
        if (launchProgress) launchProgress.style.width = 170.8
        if (launchDetailsRight) launchDetailsRight.style.maxWidth = 170.8
        if (launchProgressLabel) launchProgressLabel.style.width = 53.21
        
    }

}, false)

/**
 * Open web links in the user's default browser.
 */
$(document).on('click', 'a[href^="http"]', function(event) {
    event.preventDefault()
    shell.openExternal(this.href)
})

/**
 * Opens DevTools window if you hold (ctrl + shift + i).
 * This will crash the program if you are using multiple
 * DevTools, for example the chrome debugger in VS Code. 
 */
document.addEventListener('keydown', function (e) {
    if((e.key === 'I' || e.key === 'i') && e.ctrlKey && e.shiftKey){
        let window = remote.getCurrentWindow()
        window.toggleDevTools()
    }
    // Open logs modal with Ctrl+Shift+L
    if((e.key === 'L' || e.key === 'l') && e.ctrlKey && e.shiftKey){
        showLogsModal()
    }
})

/**
 * Discord Webhook Configuration
 * Load configuration from bug-reporter.json
 */
let bugReporterConfig = null

/**
 * Load bug reporter configuration
 */
function loadBugReporterConfig() {
    try {
        const path = require('path')
        const fs = require('fs')
        const configPath = path.join(__dirname, '..', 'config', 'bug-reporter.json')
        const configData = fs.readFileSync(configPath, 'utf8')
        bugReporterConfig = JSON.parse(configData)
    } catch (error) {
        console.error('Erreur lors du chargement de la configuration bug reporter:', error)
        bugReporterConfig = {
            discord: {
                webhookUrl: 'https://discord.com/api/webhooks/1425202414314586227/oy-Q5BiSmN10jFmvcDZW2fyPAzx8pBfUccMNOG_7BtuD-RCsNqHyrspXyzQ02H9fk47R',
                enabled: false
            },
            logs: {
                maxLogLength: 1024,
                includeSystemInfo: true,
                includeLauncherVersion: true
            }
        }
    }
}

/**
 * Show logs modal for bug reporting
 */
function showLogsModal() {
    // Load configuration if not already loaded
    if (!bugReporterConfig) {
        loadBugReporterConfig()
    }
    // Create modal overlay
    const modalOverlay = document.createElement('div')
    modalOverlay.id = 'logsModalOverlay'
    modalOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.8);
        z-index: 9999;
        display: flex;
        justify-content: center;
        align-items: center;
    `

    // Create modal content
    const modalContent = document.createElement('div')
    modalContent.style.cssText = `
        background-color: #2d2d2d;
        border-radius: 10px;
        padding: 20px;
        width: 600px;
        max-width: 90%;
        max-height: 80%;
        overflow-y: auto;
        color: white;
        font-family: 'Avenir', sans-serif;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    `

    modalContent.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="margin: 0; color: #fff;">Rapport de Bug</h2>
            <button id="closeLogsModal" style="background: none; border: none; color: #fff; font-size: 24px; cursor: pointer; padding: 0;">✕</button>
        </div>
        
        <div style="margin-bottom: 15px;">
            <label for="userPseudo" style="display: block; margin-bottom: 5px; color: #ccc;">Pseudo:</label>
            <input type="text" id="userPseudo" placeholder="Votre pseudo" style="width: 100%; padding: 10px; border: 1px solid #555; border-radius: 5px; background-color: #3d3d3d; color: white;">
        </div>
        
        <div style="margin-bottom: 15px;">
            <label for="bugTitle" style="display: block; margin-bottom: 5px; color: #ccc;">Titre du problème:</label>
            <input type="text" id="bugTitle" placeholder="Décrivez brièvement le problème" style="width: 100%; padding: 10px; border: 1px solid #555; border-radius: 5px; background-color: #3d3d3d; color: white;">
        </div>
        
        <div style="margin-bottom: 15px;">
            <label for="bugDescription" style="display: block; margin-bottom: 5px; color: #ccc;">Description détaillée:</label>
            <textarea id="bugDescription" placeholder="Décrivez en détail le problème rencontré..." rows="4" style="width: 100%; padding: 10px; border: 1px solid #555; border-radius: 5px; background-color: #3d3d3d; color: white; resize: vertical;"></textarea>
        </div>
        
        <div style="margin-bottom: 20px;">
            <h4 style="margin-bottom: 10px; color: #fff;">Informations système automatiques:</h4>
            <div id="systemInfo" style="background-color: #1e1e1e; padding: 10px; border-radius: 5px; font-size: 12px; color: #ccc;">
                <div>OS: ${process.platform} ${process.arch}</div>
                <div>Version du launcher: ${remote.app.getVersion()}</div>
                <div>Node.js: ${process.version}</div>
                <div>Electron: ${process.versions.electron}</div>
            </div>
        </div>
        
        <div style="margin-bottom: 20px;">
            <h4 style="margin-bottom: 10px; color: #fff;">Logs de la console:</h4>
            <div id="consoleLogs" style="background-color: #1e1e1e; padding: 10px; border-radius: 5px; font-size: 11px; color: #ccc; max-height: 200px; overflow-y: auto; white-space: pre-wrap;"></div>
        </div>
        
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
            <button id="cancelLogsModal" style="padding: 10px 20px; background-color: #555; color: white; border: none; border-radius: 5px; cursor: pointer;">Annuler</button>
            <button id="sendLogsReport" style="padding: 10px 20px; background-color: #5865F2; color: white; border: none; border-radius: 5px; cursor: pointer;">Envoyer le rapport</button>
        </div>
    `

    modalOverlay.appendChild(modalContent)
    document.body.appendChild(modalOverlay)

    // Collect console logs
    collectConsoleLogs()

    // Event listeners
    document.getElementById('closeLogsModal').addEventListener('click', closeLogsModal)
    document.getElementById('cancelLogsModal').addEventListener('click', closeLogsModal)
    document.getElementById('sendLogsReport').addEventListener('click', sendLogsReport)

    // Close modal when clicking outside
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
            closeLogsModal()
        }
    })

    // Focus on first input
    document.getElementById('userPseudo').focus()
}

/**
 * Close logs modal
 */
function closeLogsModal() {
    const modal = document.getElementById('logsModalOverlay')
    if (modal) {
        modal.remove()
    }
}

/**
 * Collect console logs
 */
function collectConsoleLogs() {
    const logsContainer = document.getElementById('consoleLogs')
    if (!logsContainer) return

    // Get logs from console
    const logs = []
    
    // Basic launcher information
    logs.push(`[${new Date().toISOString()}] INFO: Rapport de logs généré`)
    logs.push(`[${new Date().toISOString()}] INFO: Version du launcher: ${remote.app.getVersion()}`)
    logs.push(`[${new Date().toISOString()}] INFO: Plateforme: ${process.platform} ${process.arch}`)
    logs.push(`[${new Date().toISOString()}] INFO: Node.js: ${process.version}`)
    logs.push(`[${new Date().toISOString()}] INFO: Electron: ${process.versions.electron}`)
    
    // Try to get actual console logs from the devtools console
    // This is a basic implementation - in a real scenario you might want to implement
    // a proper logging system that stores logs in memory
    
    try {
        // Check if there are any errors in the console
        const errorEntries = []
        
        // Get performance entries that might indicate issues
        if (typeof performance !== 'undefined' && performance.getEntries) {
            const entries = performance.getEntries()
            entries.forEach(entry => {
                if (entry.name && (entry.name.includes('error') || entry.name.includes('failed'))) {
                    logs.push(`[${new Date(entry.startTime).toISOString()}] PERF: ${entry.name} - ${entry.duration}ms`)
                }
            })
        }
        
        // Add memory usage information
        if (typeof performance !== 'undefined' && performance.memory) {
            logs.push(`[${new Date().toISOString()}] MEMORY: Used: ${Math.round(performance.memory.usedJSHeapSize / 1024 / 1024)}MB, Total: ${Math.round(performance.memory.totalJSHeapSize / 1024 / 1024)}MB, Limit: ${Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)}MB`)
        }
        
        // Get current URL and page information
        logs.push(`[${new Date().toISOString()}] PAGE: Current URL: ${window.location.href}`)
        logs.push(`[${new Date().toISOString()}] PAGE: User Agent: ${navigator.userAgent}`)
        
        // Check for specific launcher components
        const launcherElements = ['launch_button', 'server_selection_button', 'launch_progress']
        launcherElements.forEach(elementId => {
            const element = document.getElementById(elementId)
            if (element) {
                logs.push(`[${new Date().toISOString()}] DOM: Element '${elementId}' présent`)
            } else {
                logs.push(`[${new Date().toISOString()}] DOM: Element '${elementId}' manquant`)
            }
        })
        
    } catch (error) {
        logs.push(`[${new Date().toISOString()}] ERROR: Erreur lors de la collecte des logs: ${error.message}`)
    }
    
    logsContainer.textContent = logs.join('\n')
}

/**
 * Send logs report to Discord webhook
 */
async function sendLogsReport() {
    const pseudo = document.getElementById('userPseudo').value.trim()
    const title = document.getElementById('bugTitle').value.trim()
    const description = document.getElementById('bugDescription').value.trim()
    const systemInfo = document.getElementById('systemInfo').innerText
    const consoleLogs = document.getElementById('consoleLogs').textContent

    // Validation
    if (!pseudo || !title || !description) {
        alert('Veuillez remplir tous les champs obligatoires (pseudo, titre, description)')
        return
    }

    if (!bugReporterConfig || !bugReporterConfig.discord.enabled || bugReporterConfig.discord.webhookUrl === 'https://discord.com/api/webhooks/1425202414314586227/oy-Q5BiSmN10jFmvcDZW2fyPAzx8pBfUccMNOG_7BtuD-RCsNqHyrspXyzQ02H9fk47R') {
        alert('Configuration du webhook Discord manquante ou désactivée. Contactez un administrateur.')
        return
    }

    const sendButton = document.getElementById('sendLogsReport')
    const originalText = sendButton.textContent
    sendButton.textContent = 'Envoi en cours...'
    sendButton.disabled = true

    try {
        const embed = {
            title: `🐛 ${title}`,
            color: 0xff0000, // Red color
            timestamp: new Date().toISOString(),
            fields: [
                {
                    name: '👤 Utilisateur',
                    value: pseudo,
                    inline: true
                },
                {
                    name: '📝 Description',
                    value: description.length > 1024 ? description.substring(0, 1021) + '...' : description,
                    inline: false
                },
                {
                    name: '🖥️ Informations système',
                    value: '```\n' + systemInfo + '\n```',
                    inline: false
                },
                {
                    name: '📊 Logs console',
                    value: consoleLogs.length > 1024 ? '```\n' + consoleLogs.substring(0, 1021) + '...\n```' : '```\n' + consoleLogs + '\n```',
                    inline: false
                }
            ],
            footer: {
                text: 'MultiGames Studio Launcher - Rapport automatique'
            }
        }

        const response = await fetch(bugReporterConfig.discord.webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: 'Bug Reporter',
                avatar_url: 'https://cdn.discordapp.com/embed/avatars/0.png',
                embeds: [embed]
            })
        })

        if (response.ok) {
            alert('Rapport envoyé avec succès ! Merci pour votre contribution.')
            closeLogsModal()
        } else {
            throw new Error('Erreur HTTP: ' + response.status)
        }
    } catch (error) {
        console.error('Erreur lors de l\'envoi du rapport:', error)
        alert('Erreur lors de l\'envoi du rapport. Veuillez réessayer ou contacter un administrateur.')
    } finally {
        sendButton.textContent = originalText
        sendButton.disabled = false
    }
}