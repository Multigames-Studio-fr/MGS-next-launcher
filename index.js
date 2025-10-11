const remoteMain = require('@electron/remote/main')
remoteMain.initialize()

// Requirements
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron')
const autoUpdater                       = require('electron-updater').autoUpdater
// Logging for auto-updater events
const log = require('electron-log')
autoUpdater.logger = log
// Use debug level for more diagnostic information about updater behavior.
autoUpdater.logger.transports.file.level = 'debug'
const ejse                              = require('ejs-electron')
const fs                                = require('fs')
const isDev                             = require('./app/assets/js/isdev')
const path                              = require('path')
const semver                            = require('semver')
const { pathToFileURL }                 = require('url')
const { AZURE_CLIENT_ID, MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR, SHELL_OPCODE } = require('./app/assets/js/ipcconstants')
const LangLoader                        = require('./app/assets/js/langloader')

// Setup Lang
LangLoader.setupLanguage()

// Setup auto updater.
function initAutoUpdater(event, data) {
    // Prevent multiple initializations (listeners added multiple times)
    if (global.__autoUpdaterInitialized) {
        log.info('Auto updater already initialized, skipping re-init.')
        return
    }
    global.__autoUpdaterInitialized = true

    log.info('Initializing autoUpdater, allowPrerelease=', !!data, 'isDev=', !!isDev, 'platform=', process.platform)

    if(data){
        autoUpdater.allowPrerelease = true
    } else {
        // Defaults to true if application version contains prerelease components (e.g. 0.12.1-alpha.1)
        // autoUpdater.allowPrerelease = true
    }
    
    if(isDev){
        autoUpdater.autoInstallOnAppQuit = false
        autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml')
    }
    if(process.platform === 'darwin'){
        autoUpdater.autoDownload = false
    }
    autoUpdater.on('update-available', (info) => {
        log.info('[AutoUpdater] update-available:', info && info.version)
        event.sender.send('autoUpdateNotification', 'update-available', info)

        // If autoDownload is disabled (or if we haven't started download yet),
        // start download and forward download progress to renderer.
        try {
                if (!global.__autoUpdaterDownloading) {
                // If autoDownload is false, explicitly call downloadUpdate(). If true,
                // electron-updater will already be downloading; calling downloadUpdate()
                // again is unnecessary but safe-guarded by the flag.
                global.__autoUpdaterDownloading = true
                log.info('[AutoUpdater] initiating downloadUpdate()')
                    // Start a watchdog timer in case download stalls without emitting progress
                    try {
                        if (global.__autoUpdaterDownloadWatchdog) {
                            clearTimeout(global.__autoUpdaterDownloadWatchdog)
                        }
                        // 5 minutes watchdog
                        global.__autoUpdaterDownloadWatchdog = setTimeout(() => {
                            try {
                                if (global.__autoUpdaterDownloading) {
                                    log.warn('[AutoUpdater] download watchdog triggered - download appears stalled')
                                    // Notify renderer so UI doesn't stay stuck in 'downloading' state.
                                    try { event.sender.send('autoUpdateNotification', 'realerror', { message: 'Download timed out' }) } catch (e) { /* best-effort */ }
                                    global.__autoUpdaterDownloading = false
                                }
                            } catch (e) {
                                // ignore watchdog errors
                            }
                        }, 5 * 60 * 1000)
                    } catch (e) {
                        // ignore
                    }
                autoUpdater.downloadUpdate()
                    .then(() => {
                        log.info('[AutoUpdater] downloadUpdate() completed')
                            try { if (global.__autoUpdaterDownloadWatchdog) { clearTimeout(global.__autoUpdaterDownloadWatchdog); global.__autoUpdaterDownloadWatchdog = null } } catch (e) { }
                    })
                    .catch((err) => {
                        log.error('[AutoUpdater] downloadUpdate() failed', err && err.message)
                        event.sender.send('autoUpdateNotification', 'realerror', err)
                        global.__autoUpdaterDownloading = false
                            try { if (global.__autoUpdaterDownloadWatchdog) { clearTimeout(global.__autoUpdaterDownloadWatchdog); global.__autoUpdaterDownloadWatchdog = null } } catch (e) { }
                    })
            } else {
                log.info('[AutoUpdater] download already in progress, skipping downloadUpdate()')
            }
        } catch (e) {
            log.error('[AutoUpdater] error while starting download', e && e.message)
            event.sender.send('autoUpdateNotification', 'realerror', e)
            global.__autoUpdaterDownloading = false
        }
    })
    // Forward download progress to renderer and log it.
    autoUpdater.on('download-progress', (progress) => {
        try {
            log.info('[AutoUpdater] download-progress', JSON.stringify(progress))
        } catch (e) {
            log.info('[AutoUpdater] download-progress')
        }
        // Reset watchdog when progress is observed
        try {
            if (global.__autoUpdaterDownloadWatchdog) {
                clearTimeout(global.__autoUpdaterDownloadWatchdog)
                global.__autoUpdaterDownloadWatchdog = setTimeout(() => {
                    try {
                        if (global.__autoUpdaterDownloading) {
                            log.warn('[AutoUpdater] download watchdog triggered after progress reset - download appears stalled')
                            try { event.sender.send('autoUpdateNotification', 'realerror', { message: 'Download timed out' }) } catch (e) { }
                            global.__autoUpdaterDownloading = false
                        }
                    } catch (e) { }
                }, 5 * 60 * 1000)
            }
        } catch (e) {
            // ignore watchdog errors
        }
        // Broadcast to all renderer windows if event not present in closure.
        try {
            // Attempt to send using the last event sender if available in scope; fallback: send to all windows.
            const { BrowserWindow } = require('electron')
            const wins = BrowserWindow.getAllWindows()
            for (const w of wins) {
                try { w.webContents.send('autoUpdateNotification', 'download-progress', progress) } catch (e) { /* ignore */ }
            }
        } catch (e) {
            log.warn('[AutoUpdater] failed to forward download-progress to renderer', e && e.message)
        }
    })
    autoUpdater.on('update-downloaded', (info) => {
        log.info('[AutoUpdater] update-downloaded:', info && info.version)
        event.sender.send('autoUpdateNotification', 'update-downloaded', info)
        // Download finished, clear downloading flag
        try {
            global.__autoUpdaterDownloading = false
        } catch (e) {
            // ignore
        }
    })
    autoUpdater.on('update-not-available', (info) => {
        log.info('[AutoUpdater] update-not-available')
        event.sender.send('autoUpdateNotification', 'update-not-available', info)
    })
    autoUpdater.on('checking-for-update', () => {
        log.info('[AutoUpdater] checking-for-update')
        event.sender.send('autoUpdateNotification', 'checking-for-update')
    })
    autoUpdater.on('error', (err) => {
        log.error('[AutoUpdater] error', err && err.message ? err.message : err)
        // Include stack if available for debugging
        if (err && err.stack) log.debug(err.stack)
        event.sender.send('autoUpdateNotification', 'realerror', err)
        // Clear downloading flag on any error to allow retry
        try {
            global.__autoUpdaterDownloading = false
        } catch (e) {
            // ignore
        }
    }) 
}

// Open channel to listen for update actions.
ipcMain.on('autoUpdateAction', (event, arg, data) => {
    // Log incoming IPC call for update actions (helps track which renderer triggered it)
    try {
        const senderId = event && event.sender ? (event.sender.id || event.sender.webContentsId || 'unknown') : 'unknown'
        log.info('[IPC:autoUpdateAction] received from sender=', senderId, 'action=', arg, 'data=', data)
    } catch (e) {
        log.warn('[IPC:autoUpdateAction] failed to log sender info', e && e.message)
    }

    switch(arg){
        case 'initAutoUpdater':
            console.log('Initializing auto updater.')
            log.info('[IPC] initAutoUpdater called')
            initAutoUpdater(event, data)
            event.sender.send('autoUpdateNotification', 'ready')
            break
        case 'checkForUpdate':
            // Throttle repeated checks from renderer: ignore if last check was within 30s
            try {
                const now = Date.now()
                const last = global.__autoUpdaterLastCheck || 0
                const THROTTLE_MS = 30 * 1000
                if (now - last < THROTTLE_MS) {
                    log.info('[IPC] checkForUpdate throttled (last check at', new Date(last).toISOString(), ')')
                    break
                }
                global.__autoUpdaterLastCheck = now
            } catch (e) {
                // ignore
            }

            log.info('[IPC] checkForUpdate invoked - calling autoUpdater.checkForUpdates()')
            autoUpdater.checkForUpdates()
                .then((res) => {
                    log.info('[AutoUpdater] checkForUpdates result', res && res.updateInfo ? res.updateInfo.version : res)
                    return res
                })
                .catch(err => {
                    log.error('[AutoUpdater] checkForUpdates error', err && err.message)
                    event.sender.send('autoUpdateNotification', 'realerror', err)
                })
            break
        case 'allowPrereleaseChange':
            if(!data){
                const preRelComp = semver.prerelease(app.getVersion())
                if(preRelComp != null && preRelComp.length > 0){
                    autoUpdater.allowPrerelease = true
                } else {
                    autoUpdater.allowPrerelease = data
                }
            } else {
                autoUpdater.allowPrerelease = data
            }
            log.info('[IPC] allowPrereleaseChange =>', autoUpdater.allowPrerelease)
            break
        case 'installUpdateNow':
            log.info('[IPC] installUpdateNow invoked - calling quitAndInstall()')
            try {
                autoUpdater.quitAndInstall()
            } catch (e) {
                log.error('[AutoUpdater] quitAndInstall failed', e && e.message)
            }
            break
        default:
            console.log('Unknown argument', arg)
            log.warn('[IPC] Unknown autoUpdateAction argument', arg)
            break
    }
})
// Redirect distribution index event from preloader to renderer.
ipcMain.on('distributionIndexDone', (event, res) => {
    event.sender.send('distributionIndexDone', res)
})

// Handle trash item.
ipcMain.handle(SHELL_OPCODE.TRASH_ITEM, async (event, ...args) => {
    try {
        await shell.trashItem(args[0])
        return {
            result: true
        }
    } catch(error) {
        return {
            result: false,
            error: error
        }
    }
})

// Disable hardware acceleration.
// https://electronjs.org/docs/tutorial/offscreen-rendering
app.disableHardwareAcceleration()


const REDIRECT_URI_PREFIX = 'https://login.microsoftonline.com/common/oauth2/nativeclient?'

// Microsoft Auth Login
let msftAuthWindow
let msftAuthSuccess
let msftAuthViewSuccess
let msftAuthViewOnClose
ipcMain.on(MSFT_OPCODE.OPEN_LOGIN, (ipcEvent, ...arguments_) => {
    if (msftAuthWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN, msftAuthViewOnClose)
        return
    }
    msftAuthSuccess = false
    msftAuthViewSuccess = arguments_[0]
    msftAuthViewOnClose = arguments_[1]
    msftAuthWindow = new BrowserWindow({
        title: LangLoader.queryJS('index.microsoftLoginTitle'),
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('multigames-logo')
    })

    msftAuthWindow.on('closed', () => {
        msftAuthWindow = undefined
    })

    msftAuthWindow.on('close', () => {
        if(!msftAuthSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED, msftAuthViewOnClose)
        }
    })

    msftAuthWindow.webContents.on('did-navigate', (_, uri) => {
        if (uri.startsWith(REDIRECT_URI_PREFIX)) {
            let queries = uri.substring(REDIRECT_URI_PREFIX.length).split('#', 1).toString().split('&')
            let queryMap = {}

            queries.forEach(query => {
                const [name, value] = query.split('=')
                queryMap[name] = decodeURI(value)
            })

            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.SUCCESS, queryMap, msftAuthViewSuccess)

            msftAuthSuccess = true
            msftAuthWindow.close()
            msftAuthWindow = null
        }
    })

    msftAuthWindow.removeMenu()
    msftAuthWindow.loadURL(`https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?prompt=select_account&client_id=${AZURE_CLIENT_ID}&response_type=code&scope=XboxLive.signin%20offline_access&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient`)
})

// Microsoft Auth Logout
let msftLogoutWindow
let msftLogoutSuccess
let msftLogoutSuccessSent
ipcMain.on(MSFT_OPCODE.OPEN_LOGOUT, (ipcEvent, uuid, isLastAccount) => {
    if (msftLogoutWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN)
        return
    }

    msftLogoutSuccess = false
    msftLogoutSuccessSent = false
    msftLogoutWindow = new BrowserWindow({
        title: LangLoader.queryJS('index.microsoftLogoutTitle'),
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('multigames-logo')
    })

    msftLogoutWindow.on('closed', () => {
        msftLogoutWindow = undefined
    })

    msftLogoutWindow.on('close', () => {
        if(!msftLogoutSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED)
        } else if(!msftLogoutSuccessSent) {
            msftLogoutSuccessSent = true
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
        }
    })
    
    msftLogoutWindow.webContents.on('did-navigate', (_, uri) => {
        if(uri.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/logoutsession')) {
            msftLogoutSuccess = true
            setTimeout(() => {
                if(!msftLogoutSuccessSent) {
                    msftLogoutSuccessSent = true
                    ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
                }

                if(msftLogoutWindow) {
                    msftLogoutWindow.close()
                    msftLogoutWindow = null
                }
            }, 5000)
        }
    })
    
    msftLogoutWindow.removeMenu()
    msftLogoutWindow.loadURL('https://login.microsoftonline.com/common/oauth2/v2.0/logout')
})

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win

function createWindow() {

    win = new BrowserWindow({
        width: 1280,
        height: 752,
        icon: getPlatformIcon('multigames-logo'),
        minWidth: 1280,
        minHeight: 752,

        webPreferences: {
            preload: path.join(__dirname, 'app', 'assets', 'js', 'preloader.js'),
            nodeIntegration: true,
            contextIsolation: false
        },
        backgroundColor: '#171614'
    })
    remoteMain.enable(win.webContents)

    const data = {
        bkid: Math.floor((Math.random() * fs.readdirSync(path.join(__dirname, 'app', 'assets', 'images', 'backgrounds')).length)),
        lang: (str, placeHolders) => LangLoader.queryEJS(str, placeHolders)
    }
    Object.entries(data).forEach(([key, val]) => ejse.data(key, val))

    win.loadURL(pathToFileURL(path.join(__dirname, 'app', 'app.ejs')).toString())

    /*win.once('ready-to-show', () => {
        win.show()
    })*/

    win.removeMenu()

    win.on('closed', () => {
        win = null
    })

    // Restore original bounds after unminimize if we changed them during animation
    win.on('restore', () => {
        try {
            if (win && win._originalBounds) {
                win.setBounds(win._originalBounds)
                delete win._originalBounds
            }
        } catch (e) {
            // ignore
        }
    })
}

// Animate a small "shrink" effect then minimize the window.
// Trigger from renderer with: ipcRenderer.send('animate-minimize', { duration: 250 })
ipcMain.on('animate-minimize', (event, options = {}) => {
    if (!win || win.isDestroyed()) return

    // Prevent concurrent animations
    if (win._isAnimatingMinimize) return
    win._isAnimatingMinimize = true

    const duration = typeof options.duration === 'number' ? options.duration : 220 // ms
    const fps = 60
    const steps = Math.max(4, Math.round((duration / 1000) * fps))

    const startBounds = win.getBounds()
    const startWidth = startBounds.width
    const startHeight = startBounds.height

    // Target shrink to 20% of original but not smaller than reasonable limits
    const targetWidth = Math.max(220, Math.round(startWidth * 0.2))
    const targetHeight = Math.max(120, Math.round(startHeight * 0.2))

    const deltaW = startWidth - targetWidth
    const deltaH = startHeight - targetHeight
    const center = { x: startBounds.x + Math.floor(startWidth / 2), y: startBounds.y + Math.floor(startHeight / 2) }

    let step = 0
    const interval = Math.max(8, Math.round(duration / steps))

    // Keep original bounds so we can restore after unminimize
    win._originalBounds = startBounds

    const anim = setInterval(() => {
        if (!win || win.isDestroyed()) {
            clearInterval(anim)
            win && (win._isAnimatingMinimize = false)
            return
        }

        step++
        const progress = Math.min(1, step / steps)
        // ease-out cubic
        const ease = 1 - Math.pow(1 - progress, 3)

        const w = Math.round(startWidth - deltaW * ease)
        const h = Math.round(startHeight - deltaH * ease)
        const x = Math.round(center.x - w / 2)
        const y = Math.round(center.y - h / 2)

        try {
            win.setBounds({ x, y, width: w, height: h }, true)
        } catch (e) {
            // ignore errors during animation
        }

        if (progress >= 1) {
            clearInterval(anim)
            try {
                // minimize after animation
                win.minimize()
            } catch (e) {
                // ignore
            }
            win._isAnimatingMinimize = false
        }
    }, interval)
})

function createMenu() {
    
    if(process.platform === 'darwin') {

        // Extend default included application menu to continue support for quit keyboard shortcut
        let applicationSubMenu = {
            label: 'Application',
            submenu: [{
                label: 'About Application',
                selector: 'orderFrontStandardAboutPanel:'
            }, {
                type: 'separator'
            }, {
                label: 'Quit',
                accelerator: 'Command+Q',
                click: () => {
                    app.quit()
                }
            }]
        }

        // New edit menu adds support for text-editing keyboard shortcuts
        let editSubMenu = {
            label: 'Edit',
            submenu: [{
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                selector: 'undo:'
            }, {
                label: 'Redo',
                accelerator: 'Shift+CmdOrCtrl+Z',
                selector: 'redo:'
            }, {
                type: 'separator'
            }, {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                selector: 'cut:'
            }, {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                selector: 'copy:'
            }, {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                selector: 'paste:'
            }, {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                selector: 'selectAll:'
            }]
        }

        // Bundle submenus into a single template and build a menu object with it
        let menuTemplate = [applicationSubMenu, editSubMenu]
        let menuObject = Menu.buildFromTemplate(menuTemplate)

        // Assign it to the application
        Menu.setApplicationMenu(menuObject)

    }

}

function getPlatformIcon(filename){
    let ext
    switch(process.platform) {
        case 'win32':
            ext = 'ico'
            break
        case 'darwin':
        case 'linux':
        default:
            ext = 'png'
            break
    }

    return path.join(__dirname, 'app', 'assets', 'images', `${filename}.${ext}`)
}

app.on('ready', createWindow)
app.on('ready', createMenu)

app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
        createWindow()
    }
})