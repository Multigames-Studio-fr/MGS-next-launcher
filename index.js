// Ensure Chromium has a writable disk cache directory to avoid "Unable to move the cache" / "Unable to create cache" errors
// This must run before the app initializes Chromium (i.e. before creating BrowserWindow or calling app.whenReady())
try {
    const os = require('os')
    const path = require('path')
    const fs = require('fs')
    // Use a cache directory inside the userData folder (per-user, writable)
    const appDataPath = path.join(os.homedir(), '.multigames-cache')
    try { fs.mkdirSync(appDataPath, { recursive: true }) } catch (e) { /* best-effort */ }
    // Set Chromium switches early so Electron/Chromium uses our cache folder
    try {
        const electron = require('electron')
        // Prefer the per-user cache path; this avoids permission issues when running from Program Files
        electron.app && electron.app.setPath && electron.app.setPath('userData', appDataPath)
    } catch (e) {
        // If electron isn't available yet, fall back to commandLine switches
        try {
            const { app } = require('electron')
            if (app && app.commandLine) {
                app.commandLine.appendSwitch('disk-cache-dir', appDataPath)
            }
        } catch (ee) {
            // Last resort: append via process argv for Chromium. This is best-effort and may be ignored.
            try { process.argv.push(`--disk-cache-dir=${appDataPath}`) } catch (eee) { }
        }
    }
    // Additional safe switches to reduce disk cache usage / permission issues
    try {
        const { app: _app } = require('electron')
        if (_app && _app.commandLine) {
            // Use a small, local cache and disable GPU cache which sometimes tries to create files elsewhere
            _app.commandLine.appendSwitch('disk-cache-size', '1048576') // 1MB
            _app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
            _app.commandLine.appendSwitch('disable-application-cache')
        }
    } catch (e) { /* best-effort */ }
} catch (e) {
    // ignore any errors during cache setup - we made best-effort attempts
}

const remoteMain = require('@electron/remote/main')
remoteMain.initialize()

// Ensure Chromium allows autoplay where possible (best-effort).
try {
    const { app: _app } = require('electron')
    if (_app && _app.commandLine) {
        // Allow autoplay without user gesture
        _app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
        // Enable some experimental platform features which may improve media handling
        _app.commandLine.appendSwitch('enable-experimental-web-platform-features')
    }
} catch (e) { /* best-effort */ }

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

// --- Ajout: utilitaire sûr pour notifier les renderers ---
function sendAutoUpdateNotification(preferEvent /* may be undefined */, type, payload) {
	// prefer sending to the original ipc sender when available
	try {
		if (preferEvent && preferEvent.sender) {
			try { preferEvent.sender.send('autoUpdateNotification', type, payload); return; } catch (e) { /* fall through to broadcast */ }
		}
	} catch (e) {
		// ignore
	}

	// fallback: broadcast to all renderer windows
    // Ensure payload is JSON-safe (Errors and complex objects can break IPC)
    try {
        if (payload instanceof Error) {
            payload = { message: payload.message, stack: payload.stack, code: payload.code }
        } else if (payload && typeof payload === 'object') {
            // Attempt shallow copy of enumerable properties to avoid circular structures
            try {
                payload = JSON.parse(JSON.stringify(payload))
            } catch (e) {
                // Fallback: pick common error-like props if JSON.stringify fails
                const copy = {}
                if (payload.message) copy.message = payload.message
                if (payload.stack) copy.stack = payload.stack
                if (payload.code) copy.code = payload.code
                if (payload.version) copy.version = payload.version
                if (payload.url) copy.url = payload.url
                payload = copy
            }
        }
    } catch (e) { /* best-effort; continue with original payload */ }

    try {
		const { BrowserWindow } = require('electron')
		const wins = BrowserWindow.getAllWindows()
		for (const w of wins) {
			try { w.webContents.send('autoUpdateNotification', type, payload) } catch (e) { /* ignore per-window send errors */ }
		}
	} catch (e) {
		try { log.warn('[AutoUpdater] failed to broadcast autoUpdateNotification', e && e.message) } catch (err) { /* noop */ }
	}
}

// Setup auto updater.
function initAutoUpdater(event, data) {
    // Prevent multiple initializations (listeners added multiple times)
    if (global.__autoUpdaterInitialized) {
        log.info('Auto updater already initialized, skipping re-init.')
        return
    }
    global.__autoUpdaterInitialized = true

    log.info('Initializing autoUpdater, allowPrerelease=', !!data, 'isDev=', !!isDev, 'platform=', process.platform)

    // Ensure updater pending directory exists to avoid ENOENT rename errors on Windows
    try {
        const os = require('os')
        const updaterBase = path.join(os.homedir(), '.multigames-studio-launcher-updater')
        const pendingDir = path.join(updaterBase, 'pending')
        try { fs.mkdirSync(pendingDir, { recursive: true }) } catch (e) { /* best-effort */ }
    } catch (e) {
        // ignore
    }

    if(data){
        autoUpdater.allowPrerelease = true
    } else {
        // Defaults to true if application version contains prerelease components (e.g. 0.12.1-alpha.1)
        // autoUpdater.allowPrerelease = true
    }
    
    // Explicit autoDownload default: disable auto-download on macOS, enable elsewhere
    autoUpdater.autoDownload = process.platform !== 'darwin'

    if(isDev){
        // In dev mode we don't want the updater to auto-install or auto-download
        autoUpdater.autoInstallOnAppQuit = false
        autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml')
        autoUpdater.autoDownload = false
    }

    autoUpdater.on('update-available', (info) => {
        log.info('[AutoUpdater] update-available:', info && info.version)
        sendAutoUpdateNotification(event, 'update-available', info)

        // If autoDownload is disabled (or if we haven't started download yet),
        // start download and forward download progress to renderer.
        try {
            if (!global.__autoUpdaterDownloading) {
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
                                try { sendAutoUpdateNotification(event, 'realerror', { message: 'Download timed out' }) } catch (e) { /* best-effort */ }
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
                        sendAutoUpdateNotification(event, 'realerror', err)
                        global.__autoUpdaterDownloading = false
                        try { if (global.__autoUpdaterDownloadWatchdog) { clearTimeout(global.__autoUpdaterDownloadWatchdog); global.__autoUpdaterDownloadWatchdog = null } } catch (e) { }
                    })
            } else {
                log.info('[AutoUpdater] download already in progress, skipping downloadUpdate()')
            }
        } catch (e) {
            log.error('[AutoUpdater] error while starting download', e && e.message)
            sendAutoUpdateNotification(event, 'realerror', e)
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
                            try { sendAutoUpdateNotification(event, 'realerror', { message: 'Download timed out' }) } catch (e) { }
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
        // Mark that a downloaded update is available. This prevents calls to
        // quitAndInstall() when no installer is present which otherwise raises
        // "No valid update available, can't quit and install" in some cases.
        try {
            global.__autoUpdaterDownloaded = info || true
        } catch (e) { /* noop */ }
        sendAutoUpdateNotification(event, 'update-downloaded', info)
        // Download finished, clear downloading flag
        try {
            global.__autoUpdaterDownloading = false
            if (global.__autoUpdaterDownloadWatchdog) { clearTimeout(global.__autoUpdaterDownloadWatchdog); global.__autoUpdaterDownloadWatchdog = null }
        } catch (e) {
            // ignore
        }
    })

    autoUpdater.on('update-not-available', (info) => {
        log.info('[AutoUpdater] update-not-available')
        sendAutoUpdateNotification(event, 'update-not-available', info)
    })

    autoUpdater.on('checking-for-update', () => {
        log.info('[AutoUpdater] checking-for-update')
        // Reset any previously stored downloaded state when we start a new check
        try { global.__autoUpdaterDownloaded = false } catch (e) { }
        sendAutoUpdateNotification(event, 'checking-for-update')
    })

    autoUpdater.on('error', (err) => {
        log.error('[AutoUpdater] error', err && err.message ? err.message : err)
        // Include stack if available for debugging
        if (err && err.stack) log.debug(err.stack)

        // Defensive fallback for common Windows rename ENOENT introduced by
        // electron-updater moving a temp download to the final pending location.
        // If the rename failed because the temp file wasn't found, attempt a
        // safe scan of the pending directory and try to recover a matching
        // downloaded installer (common causes: antivirus removed temp file,
        // download saved under different name, or transient FS issue).
        try {
            if (err && typeof err.message === 'string' && err.message.indexOf('ENOENT') !== -1 && err.message.indexOf('rename') !== -1) {
                try {
                    const os = require('os')
                    const updaterBase = path.join(os.homedir(), '.multigames-studio-launcher-updater')
                    const pendingDir = path.join(updaterBase, 'pending')

                    // Attempt to extract paths from the error message in the form: rename '...temp...' -> '...final...'
                    const m = err.message.match(/rename '\\?(.+?)' -> '\\?(.+?)'/)
                    let tempPath = null
                    let finalPath = null
                    if (m && m.length >= 3) {
                        tempPath = m[1]
                        finalPath = m[2]
                    }

                    if (tempPath) {
                        try {
                            if (fs.existsSync(tempPath)) {
                                // Try to complete the rename ourselves
                                try {
                                    fs.renameSync(tempPath, finalPath)
                                    log.info('[AutoUpdater] recovered missing rename by moving', tempPath, '->', finalPath)
                                } catch (renameErr) {
                                    log.warn('[AutoUpdater] fallback rename attempt failed', renameErr && renameErr.message)
                                }
                            } else {
                                // If temp path not present, scan pending dir for likely candidate files
                                try {
                                    const files = fs.readdirSync(pendingDir)
                                    const candidates = files.filter(f => /multigames-studio-launcher-Setup-.*\\.exe$/i.test(f) || /^temp-.*multigames-studio-launcher-Setup-.*\\.exe$/i.test(f))
                                    if (candidates.length > 0) {
                                        // Prefer the newest candidate
                                        candidates.sort((a, b) => {
                                            try {
                                                const sa = fs.statSync(path.join(pendingDir, a)).mtimeMs
                                                const sb = fs.statSync(path.join(pendingDir, b)).mtimeMs
                                                return sb - sa
                                            } catch (e) { return 0 }
                                        })
                                        const chosen = path.join(pendingDir, candidates[0])
                                        try {
                                            const target = finalPath || path.join(pendingDir, path.basename(candidates[0]).replace(/^temp-/, ''))
                                            fs.renameSync(chosen, target)
                                            log.info('[AutoUpdater] fallback recovery: renamed', chosen, '->', target)
                                        } catch (e) {
                                            log.warn('[AutoUpdater] fallback recovery rename failed', e && e.message)
                                        }
                                    } else {
                                        log.info('[AutoUpdater] pending directory scan found no candidate installer files:', pendingDir)
                                    }
                                } catch (e) {
                                    log.warn('[AutoUpdater] failed to scan pending directory for recovery', e && e.message)
                                }
                            }
                        } catch (e) {
                            log.warn('[AutoUpdater] error during fallback recovery attempt', e && e.message)
                        }
                    } else {
                        // If we couldn't parse paths, still try scanning pending dir
                        try {
                            const files = fs.readdirSync(pendingDir)
                            if (files && files.length > 0) {
                                log.info('[AutoUpdater] pending directory contains files:', files.join(', '))
                            } else {
                                log.info('[AutoUpdater] pending directory is empty:', pendingDir)
                            }
                        } catch (e) {
                            // ignore
                        }
                    }
                } catch (e) {
                    log.warn('[AutoUpdater] defensive recovery logic failed', e && e.message)
                }
            }
        } catch (e) {
            // ensure any bug in recovery logic doesn't crash the app
            log.warn('[AutoUpdater] recovery logic threw', e && e.message)
        }

    // Notify renderer and keep previous behavior: clear downloading flag on any error to allow retry
    try { global.__autoUpdaterDownloaded = false } catch (e) { }
    sendAutoUpdateNotification(event, 'realerror', err)
        try {
            global.__autoUpdaterDownloading = false
            if (global.__autoUpdaterDownloadWatchdog) { clearTimeout(global.__autoUpdaterDownloadWatchdog); global.__autoUpdaterDownloadWatchdog = null }
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
            sendAutoUpdateNotification(event, 'ready')
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
            initAutoUpdater(event, false) // ensure initialized
            autoUpdater.checkForUpdates()
                .then((res) => {
                    log.info('[AutoUpdater] checkForUpdates result', res && res.updateInfo ? res.updateInfo.version : res)
                    return res
                })
                .catch(err => {
                    log.error('[AutoUpdater] checkForUpdates error', err && err.message)
                    sendAutoUpdateNotification(event, 'realerror', err)
                })
            break

        // --- Ajout: action explicite pour démarrer le download (utile si autoDownload=false) ---
        case 'downloadUpdate':
            try {
                initAutoUpdater(event, false) // ensure listeners present
                if (!global.__autoUpdaterDownloading) {
                    log.info('[IPC] downloadUpdate invoked - calling autoUpdater.downloadUpdate()')
                    global.__autoUpdaterDownloading = true
                    // start watchdog
                    try {
                        if (global.__autoUpdaterDownloadWatchdog) { clearTimeout(global.__autoUpdaterDownloadWatchdog) }
                        global.__autoUpdaterDownloadWatchdog = setTimeout(() => {
                            try {
                                if (global.__autoUpdaterDownloading) {
                                    log.warn('[AutoUpdater] download watchdog triggered - download appears stalled (manual start)')
                                    sendAutoUpdateNotification(event, 'realerror', { message: 'Download timed out' })
                                    global.__autoUpdaterDownloading = false
                                }
                            } catch (e) {}
                        }, 5 * 60 * 1000)
                    } catch (e) {}
                    autoUpdater.downloadUpdate()
                        .then(() => {
                            log.info('[AutoUpdater] downloadUpdate() completed (manual)')
                            try { if (global.__autoUpdaterDownloadWatchdog) { clearTimeout(global.__autoUpdaterDownloadWatchdog); global.__autoUpdaterDownloadWatchdog = null } } catch (e) { }
                            global.__autoUpdaterDownloading = false
                        })
                        .catch((err) => {
                            log.error('[AutoUpdater] downloadUpdate() failed (manual)', err && err.message)
                            sendAutoUpdateNotification(event, 'realerror', err)
                            global.__autoUpdaterDownloading = false
                            try { if (global.__autoUpdaterDownloadWatchdog) { clearTimeout(global.__autoUpdaterDownloadWatchdog); global.__autoUpdaterDownloadWatchdog = null } } catch (e) { }
                        })
                } else {
                    log.info('[IPC] downloadUpdate skipped - already downloading')
                }
            } catch (e) {
                log.error('[IPC] downloadUpdate error', e && e.message)
                sendAutoUpdateNotification(event, 'realerror', e)
                global.__autoUpdaterDownloading = false
            }
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
                // Only attempt to quit and install if we actually have a downloaded update.
                // Calling quitAndInstall() without a downloaded update can throw an exception
                // like "No valid update available, can't quit and install".
                if (global.__autoUpdaterDownloaded) {
                    autoUpdater.quitAndInstall()
                } else {
                    log.warn('[AutoUpdater] installUpdateNow requested but no downloaded update present')
                    sendAutoUpdateNotification(event, 'realerror', { message: 'No downloaded update available' })
                }
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
            contextIsolation: false,
            // Prefer an autoplay policy that does not require a user gesture
            autoplayPolicy: 'no-user-gesture-required'
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

// Cleanup watchdog/listeners before quit so timers don't hang
app.on('before-quit', () => {
    try {
        if (global.__autoUpdaterDownloadWatchdog) {
            clearTimeout(global.__autoUpdaterDownloadWatchdog)
            global.__autoUpdaterDownloadWatchdog = null
        }
        global.__autoUpdaterDownloading = false
        // remove autoUpdater listeners to avoid leaks on restart (safe-guard)
        try { autoUpdater.removeAllListeners() } catch (e) {}
    } catch (e) {
        // ignore
    }
})