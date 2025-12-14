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

// Configure updater cache directory to avoid permission issues
if (process.platform === 'win32') {
    // Fix for EPERM error: electron-updater creates a directory with invalid characters
    // We need to ensure the app name is sanitized for Windows directory names
    const sanitizedAppName = 'MultiGamesStudioLauncher'
    app.setName(sanitizedAppName)
    
    // Pre-create common updater directories to avoid permission/ENONENT issues
    try {
        const os = require('os')
        // electron-updater / nsis may use different updater folder names on Windows
        const candidateBases = [
            path.join(os.homedir(), 'AppData', 'Local', 'multigames-studio-launcher-updater'), // observed path (lowercase, hyphens)
            path.join(os.homedir(), 'AppData', 'Local', sanitizedAppName + ' updater'), // fallback: sanitized appname style
            path.join(os.homedir(), '.multigames-studio-launcher-updater') // legacy dot-folder fallback
        ]

        for (const base of candidateBases) {
            try {
                const pending = path.join(base, 'pending')
                if (!fs.existsSync(pending)) {
                    fs.mkdirSync(pending, { recursive: true })
                    log.info('[AutoUpdater] Pre-created updater pending directory:', pending)
                }
            } catch (e) {
                // best-effort per-path: continue trying other candidates
                try { log.debug('[AutoUpdater] could not create candidate pending dir', base, e && e.message) } catch (e2) { }
            }
        }
    } catch (e) {
        log.warn('[AutoUpdater] Failed to pre-create updater candidate directories:', e && e.message)
    }
}
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

// Load ConfigManager early in main so config is available to main process code.
try {
    const ConfigManager = require('./app/assets/js/configmanager')
    try { ConfigManager.load() } catch (e) { try { log && log.warn && log.warn('[Startup] ConfigManager.load() failed', e && e.message) } catch (ee) {} }
} catch (e) {
    try { log && log.warn && log.warn('[Startup] failed to require ConfigManager in main', e && e.message) } catch (ee) {}
}

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

// Safe wrapper for quitting and installing updates.
// The built-in quitAndInstall() can throw when no valid installer is present
// (e.g. "No valid update available, can't quit and install"). Use this
// wrapper to centralize checks and error handling so the main process won't
// crash from an uncaught exception.
function safeQuitAndInstall(caller) {
    try {
        if (global.__autoUpdaterDownloaded) {
            try {
                log.info('[AutoUpdater] safeQuitAndInstall called by', caller || 'unknown')
            } catch (e) { /* ignore logging errors */ }

            try {
                        // Before calling quitAndInstall, attempt a safer fallback: look for the
                        // installer in the pending updater directory and execute it directly.
                        // This helps when electron-updater's internal path differs or the
                        // rename/move operation previously failed and quitAndInstall would
                        // throw "No valid update available".
                        try {
                            const os = require('os')
                            const child = require('child_process')
                            // Use the sanitized app name for the updater directory path
                            const pendingBase = process.platform === 'win32' 
                                ? path.join(os.homedir(), 'AppData', 'Local', 'multigames-studio-launcher-updater', 'pending')
                                : path.join(os.homedir(), '.multigames-studio-launcher-updater', 'pending')
                            let installerPath = null
                            try {
                                if (fs.existsSync(pendingBase)) {
                                    const files = fs.readdirSync(pendingBase)
                                    // prefer exact setup file name if present, else pick newest candidate
                                    const candidates = files.filter(f => /multigames-studio-launcher-Setup-.*\.exe$/i.test(f))
                                    if (candidates.length > 0) {
                                        // pick newest
                                        candidates.sort((a, b) => {
                                            try {
                                                const sa = fs.statSync(path.join(pendingBase, a)).mtimeMs
                                                const sb = fs.statSync(path.join(pendingBase, b)).mtimeMs
                                                return sb - sa
                                            } catch (e) { return 0 }
                                        })
                                        installerPath = path.join(pendingBase, candidates[0])
                                    }
                                }
                            } catch (e) {
                                // ignore scanning errors
                                installerPath = null
                            }

                            if (installerPath && fs.existsSync(installerPath)) {
                                try {
                                    log.info('[AutoUpdater] Found installer, launching directly:', installerPath)
                                } catch (e) {}

                                // Ensure update UI shows a persistent "installing" popup before quitting
                                try { createUpdateWindow() } catch (e) { }
                                try { sendAutoUpdateNotification(undefined, 'installing', { installerPath }) } catch (e) { }

                                // Launch installer via a small detached wrapper so we can relaunch
                                // the launcher after the installer completes. This avoids leaving
                                // the user without the launcher once installation finishes.
                                try {
                                    const spawnOpts = { detached: true, stdio: 'ignore' }
                                    if (process.platform === 'win32') {
                                        try {
                                            const tmp = require('os').tmpdir()
                                            const batchPath = path.join(tmp, `mgs_apply_update_${Date.now()}.cmd`)
                                            const launcherExe = process.execPath
                                            // Use start /wait to wait for installer to finish, then restart launcher
                                            const batchContent = `@echo off\r\nstart /wait "" "${installerPath}"\r\nstart "" "${launcherExe}"\r\nexit\r\n`
                                            try { fs.writeFileSync(batchPath, batchContent, { encoding: 'utf8' }) } catch (e) { /* ignore write errors */ }
                                            const childProc = child.spawn('cmd.exe', ['/c', batchPath], spawnOpts)
                                            try { childProc.unref && childProc.unref() } catch (e) {}
                                            try { app.quit() } catch (e) { process.exit(0) }
                                            return true
                                        } catch (e) {
                                            try { log.warn('[AutoUpdater] failed to spawn installer wrapper', e && e.message) } catch (le) {}
                                        }
                                    }

                                    // Fallback for non-Windows: spawn installer directly detached
                                    const childProc = child.spawn(installerPath, [], spawnOpts)
                                    try { childProc.unref && childProc.unref() } catch (e) {}
                                    try { app.quit() } catch (e) { process.exit(0) }
                                    return true
                                } catch (e) {
                                    try { log.warn('[AutoUpdater] failed to spawn installer directly', e && e.message) } catch (le) {}
                                    // fallthrough to calling quitAndInstall
                                }
                            }

                        } catch (e) {
                            // ignore fallback errors and continue to autoUpdater.quitAndInstall
                        }

                        // final attempt: use the electron-updater helper
                        autoUpdater.quitAndInstall()
                        return true
            } catch (e) {
                try { log.error('[AutoUpdater] quitAndInstall failed', e && e.message) } catch (le) { }
                // Notify renderers that installation failed
                try { sendAutoUpdateNotification(undefined, 'realerror', e) } catch (ne) { }
                return false
            }
        } else {
            try { log.warn('[AutoUpdater] safeQuitAndInstall called but no downloaded update present (caller=' + (caller || 'unknown') + ')') } catch (e) { }
            try { sendAutoUpdateNotification(undefined, 'realerror', { message: 'No downloaded update available' }) } catch (e) { }
            return false
        }
    } catch (e) {
        try { log.error('[AutoUpdater] safeQuitAndInstall unexpected error', e && e.message) } catch (le) { }
        return false
    }
}

// Relay for instance state changes from renderer to all renderers (useful when a process is spawned)
ipcMain.on('instance-state', (event, state) => {
    try {
        const { BrowserWindow } = require('electron')
        const wins = BrowserWindow.getAllWindows()
        for (const w of wins) {
            try { w.webContents.send('instance-state', state) } catch (e) { /* ignore per-window send errors */ }
        }
    } catch (e) {
        try { log.warn('[IPC] failed to broadcast instance-state', e && e.message) } catch (err) { /* noop */ }
    }
})

// Gestionnaire pour redémarrer le launcher (utilisé après suppression de mods en double)
ipcMain.on('relaunchApplication', (event) => {
    try {
        log.info('[IPC] relaunchApplication called - restarting app')
        app.relaunch()
        app.quit()
    } catch (err) {
        try {
            log.error('[IPC] relaunchApplication failed:', err && err.message)
        } catch (e) { /* ignore */ }
    }
})

// Setup auto updater.
function initAutoUpdater(event, data) {
    // Prevent multiple initializations (listeners added multiple times)
    if (global.__autoUpdaterInitialized) {
        log.info('Auto updater already initialized, skipping re-init.')
        return
    }
    global.__autoUpdaterInitialized = true

    log.info('Initializing autoUpdater, allowPrerelease=', !!data, 'isDev=', !!isDev, 'platform=', process.platform)

    // Ensure updater pending directories exist to avoid ENOENT rename errors on Windows
    try {
        const os = require('os')
        const candidateBases = [
            path.join(os.homedir(), 'AppData', 'Local', 'multigames-studio-launcher-updater'),
            path.join(os.homedir(), 'AppData', 'Local', 'MultiGamesStudioLauncher updater'),
            path.join(os.homedir(), '.multigames-studio-launcher-updater')
        ]
        for (const base of candidateBases) {
            try {
                const pendingDir = path.join(base, 'pending')
                try { fs.mkdirSync(pendingDir, { recursive: true }) } catch (e) { /* best-effort per-path */ }
            } catch (e) { /* ignore per-path */ }
        }
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
        try { createUpdateWindow() } catch (e) { /* best-effort */ }
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
        // Ensure update window exists and broadcast to all renderer windows if event not present in closure.
        try { createUpdateWindow() } catch (e) { /* best-effort */ }
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
        // Instead of closing the update window immediately, defer closing it
        // until the main launcher window is started so the user isn't left
        // looking at an empty splash if the launcher hasn't opened yet.
        try {
            if (win && !win.isDestroyed()) {
                try { if (updateWindow && !updateWindow.isDestroyed()) { updateWindow.close(); updateWindow = null } } catch (e) { }
            } else {
                // Mark pending close - will be flushed when createWindow shows the main window
                global.__closeUpdateWindowWhenLauncherStarted = true
            }
        } catch (e) { /* ignore */ }
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
        try {
            if (win && !win.isDestroyed()) {
                try { if (updateWindow && !updateWindow.isDestroyed()) { updateWindow.close(); updateWindow = null } } catch (e) { }
            } else {
                // Defer closing the update window until launcher main window starts
                global.__closeUpdateWindowWhenLauncherStarted = true
            }
        } catch (e) { }
    })

    autoUpdater.on('checking-for-update', () => {
        log.info('[AutoUpdater] checking-for-update')
        // Reset any previously stored downloaded state when we start a new check
        try { global.__autoUpdaterDownloaded = false } catch (e) { }
        try { createUpdateWindow() } catch (e) { /* best-effort */ }
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
                    const candidateBases = [
                        path.join(os.homedir(), 'AppData', 'Local', 'multigames-studio-launcher-updater'),
                        path.join(os.homedir(), 'AppData', 'Local', 'MultiGamesStudioLauncher updater'),
                        path.join(os.homedir(), '.multigames-studio-launcher-updater')
                    ]
                    const pendingDirs = candidateBases.map(b => path.join(b, 'pending'))

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
                                // If temp path not present, scan all known pending dirs for likely candidate files
                                try {
                                    let allCandidates = []
                                    for (const pendingDir of pendingDirs) {
                                        try {
                                            if (!fs.existsSync(pendingDir)) continue
                                            const files = fs.readdirSync(pendingDir)
                                            const candidates = files.filter(f => /multigames-studio-launcher-Setup-.*\\.exe$/i.test(f) || /^temp-.*multigames-studio-launcher-Setup-.*\\.exe$/i.test(f))
                                            if (candidates && candidates.length > 0) {
                                                for (const c of candidates) allCandidates.push({ pendingDir, name: c })
                                            }
                                        } catch (e) {
                                            // ignore per-dir read failures
                                        }
                                    }

                                    if (allCandidates.length > 0) {
                                        // Prefer newest candidate across all pending dirs
                                        allCandidates.sort((A, B) => {
                                            try {
                                                const sa = fs.statSync(path.join(A.pendingDir, A.name)).mtimeMs
                                                const sb = fs.statSync(path.join(B.pendingDir, B.name)).mtimeMs
                                                return sb - sa
                                            } catch (e) { return 0 }
                                        })
                                        const chosenObj = allCandidates[0]
                                        const chosen = path.join(chosenObj.pendingDir, chosenObj.name)
                                        try {
                                            const targetDir = path.dirname(finalPath || path.join(chosenObj.pendingDir, chosenObj.name.replace(/^temp-/, '')))
                                            const target = finalPath || path.join(targetDir, path.basename(chosenObj.name).replace(/^temp-/, ''))
                                            fs.renameSync(chosen, target)
                                            log.info('[AutoUpdater] fallback recovery: renamed', chosen, '->', target)
                                        } catch (e) {
                                            log.warn('[AutoUpdater] fallback recovery rename failed', e && e.message)
                                        }
                                    } else {
                                        try { log.info('[AutoUpdater] pending directories scan found no candidate installer files:', pendingDirs.join(', ')) } catch (e) {}
                                    }
                                } catch (e) {
                                    log.warn('[AutoUpdater] failed to scan pending directories for recovery', e && e.message)
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
                // Use safeQuitAndInstall to avoid uncaught exceptions from electron-updater.
                if (!safeQuitAndInstall('ipc-installUpdateNow')) {
                    log.warn('[AutoUpdater] installUpdateNow requested but installation failed or no update present')
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

// Single instance lock: only allow one instance of the launcher to run at a time
// In development we allow multiple instances to simplify testing.
const gotTheLock = isDev ? true : app.requestSingleInstanceLock()
if (isDev) {
    try { log && log.info && log.info('[Startup] isDev=true, bypassing single-instance lock for development') } catch (e) {}
}

if (!gotTheLock) {
    // If we don't have the lock, another instance is already running
    // Close this instance and focus the existing one
    try {
        log && log.info && log.info('[Startup] Another instance is already running, exiting')
    } catch (e) {}
    app.quit()
} else {
    // Handle second instance attempt
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        try {
            log && log.info && log.info('[Startup] Second instance attempt detected, focusing existing window')
        } catch (e) {}
        
        // If a window exists, bring it to focus
        if (win && !win.isDestroyed()) {
            try {
                if (win.isMinimized()) win.restore()
                win.focus()
            } catch (e) {
                try { log && log.warn && log.warn('[Startup] Failed to focus existing window', e && e.message) } catch (ee) {}
            }
        }
    })
}


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
let mcLogWindow
let updateWindow
const mcLogger = require(path.join(__dirname, 'mc-logger'))

// Setup broadcaster so mc-logger can forward lines to renderer windows
mcLogger.setBroadcaster((line) => {
    try {
        const { BrowserWindow } = require('electron')
        const wins = BrowserWindow.getAllWindows() || []
        for (const w of wins) {
            try { w.webContents.send('mc-log-line', line) } catch (e) { /* ignore per-window send errors */ }
        }
        if (mcLogWindow && mcLogWindow.webContents) {
            try { mcLogWindow.webContents.send('mc-log-line', line) } catch (e) { /* ignore */ }
        }
    } catch (e) {
        try { log.warn('[mc-logger] broadcaster failed', e && e.message) } catch (er) {}
    }
})

function createWindow() {
    const ConfigManager = require('./app/assets/js/configmanager')

    // Use game resolution as minimum launcher window size when possible.
    let cfgGameWidth = parseInt((ConfigManager.getGameWidth && ConfigManager.getGameWidth()) || 0, 10) || 1280
    let cfgGameHeight = parseInt((ConfigManager.getGameHeight && ConfigManager.getGameHeight()) || 0, 10) || 752
    // Ensure minimum sensible bounds
    cfgGameWidth = Math.max(220, cfgGameWidth)
    cfgGameHeight = Math.max(120, cfgGameHeight)

    win = new BrowserWindow({
        width: Math.max(1280, cfgGameWidth),
        height: Math.max(752, cfgGameHeight),
        icon: getPlatformIcon('multigames-logo'),
        minWidth: cfgGameWidth,
        minHeight: cfgGameHeight,
        frame: false,
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

    // Do not show immediately - we'll display the main window after a short
    // delay so the splash/update window has time to be visible.
    win.once('ready-to-show', () => {
        try {
            // Show after 4 seconds to match requested behavior
            setTimeout(() => {
                try { win.show() } catch (e) { /* ignore show errors */ }
                // If an update status window is waiting to be closed, close it now
                try { flushPendingUpdateWindowClose() } catch (e) { }
            }, 4000)
        } catch (e) { try { win.show() } catch (e) { } }
    })

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

function createMcLogWindow() {
    try {
        if (mcLogWindow && !mcLogWindow.isDestroyed()) {
            try { mcLogWindow.focus() } catch (e) { }
            return
        }

        mcLogWindow = new BrowserWindow({
            width: 900,
            height: 420,
            title: LangLoader.queryJS && typeof LangLoader.queryJS === 'function' ? LangLoader.queryJS('logs.title') : 'Minecraft Logs',
            backgroundColor: '#111111',
            frame: true,
            icon: getPlatformIcon('multigames-logo'),
            webPreferences: {
                preload: path.join(__dirname, 'app', 'assets', 'js', 'preloader.js'),
                nodeIntegration: true,
                contextIsolation: false,
                autoplayPolicy: 'no-user-gesture-required'
            }
        })

        remoteMain.enable(mcLogWindow.webContents)

        // Ensure ejse data (lang helper) is available to the logs window as well
        mcLogWindow.loadURL(pathToFileURL(path.join(__dirname, 'app', 'logs.ejs')).toString())

        mcLogWindow.removeMenu()

        mcLogWindow.on('closed', () => {
            mcLogWindow = null
        })
    } catch (e) {
        try { log.warn('[LogsWindow] failed to create logs window', e && e.message) } catch (er) { }
    }
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

// Simple, silent updater flow for startup.
// Behavior: on app ready, check for updates; if an update is available,
// download it and install immediately without asking the user. If the
// update process doesn't complete within a short timeout, continue startup
// so the launcher is usable.
function ensureSimpleAutoUpdateThenStart() {
    const MAX_WAIT = 10 * 1000 // 10s - small window to avoid blocking startup

    try {
        if (global.__autoUpdaterDownloaded) {
            try { log.info('[AutoUpdater:simple] installer already present - quitting to install') } catch (e) {}
            try { safeQuitAndInstall('simple-early-install') } catch (e) { log.warn('[AutoUpdater:simple] quitAndInstall failed', e && e.message) }
            return
        }
    } catch (e) { /* ignore */ }

    // Initialize updater (this sets up shared listeners used elsewhere)
    try { initAutoUpdater(undefined, false) } catch (e) { log.warn('[AutoUpdater:simple] init failed', e && e.message) }

    // Ensure silent behavior
    try {
        autoUpdater.autoDownload = true
        autoUpdater.autoInstallOnAppQuit = true
    } catch (e) { /* ignore */ }

    let settled = false

    function startUI() {
        if (settled) return
        settled = true
        try { createWindow() } catch (e) { log.warn('[Startup] createWindow failed', e && e.message) }
        try { createMenu() } catch (e) { log.warn('[Startup] createMenu failed', e && e.message) }
    }

    function onDownloaded(info) {
        if (settled) return
        settled = true
        try { log.info('[AutoUpdater:simple] update downloaded - installing now', info && info.version) } catch (e) {}
        try {
            global.__autoUpdaterDownloaded = info || true
            // silent install: attempt quit+install immediately
            if (!safeQuitAndInstall('simple-startup-onDownloaded')) {
                // If quitting/installing failed, continue to UI
                startUI()
            }
        } catch (e) {
            log.error('[AutoUpdater:simple] quitAndInstall failed during startup', e && e.message)
            startUI()
        }
    }

    function onNotAvailable() {
        if (settled) return
        try { log.info('[AutoUpdater:simple] no update available - proceeding to UI') } catch (e) {}
        startUI()
    }

    function onError(err) {
        if (settled) return
        try { log.warn('[AutoUpdater:simple] error during startup update check', err && (err.message || err)) } catch (e) {}
        startUI()
    }

    try {
        autoUpdater.once && autoUpdater.once('update-downloaded', onDownloaded)
        autoUpdater.once && autoUpdater.once('update-not-available', onNotAvailable)
        autoUpdater.once && autoUpdater.once('error', onError)
    } catch (e) {
        log.warn('[AutoUpdater:simple] failed to attach one-time listeners', e && e.message)
    }

    try {
        autoUpdater.checkForUpdates()
            .then((res) => {
                try { log.info('[AutoUpdater:simple] checkForUpdates result', res && res.updateInfo && res.updateInfo.version) } catch (e) {}
            })
            .catch((err) => onError(err))
    } catch (e) {
        onError(e)
    }

    // Timeout fallback
    setTimeout(() => {
        if (!settled) {
            try { log.warn('[AutoUpdater:simple] startup wait timeout reached - proceeding to UI') } catch (e) {}
            settled = true
            try { createWindow() } catch (e) { log.warn('[Startup] createWindow failed (timeout)', e && e.message) }
            try { createMenu() } catch (e) { log.warn('[Startup] createMenu failed (timeout)', e && e.message) }
        }
    }, MAX_WAIT)
}

// Start the app by attempting to apply updates before creating windows
// If the app is launched with an installer path argument, run it silently and exit.
// Supported arguments: `--apply-update=<path>` or `--installer=<path>`
function tryApplyInstallerArg() {
    try {
        const prefixes = ['--apply-update=', '--installer=']
        let found = null
        for (const p of prefixes) {
            const arg = process.argv.find(a => typeof a === 'string' && a.startsWith(p))
            if (arg) { found = arg; break }
        }
        if (!found) return false
        const installerPath = path.resolve(found.split('=')[1])
        if (!installerPath) return false
        if (!fs.existsSync(installerPath)) {
            try { log.warn('[AutoUpdater:arg] installer arg provided but file not found', installerPath) } catch (e) {}
            // Create update UI and notify renderers so user sees an error popup
            try { createUpdateWindow() } catch (e) {}
            try { sendAutoUpdateNotification(undefined, 'realerror', { message: 'Installer not found', path: installerPath }) } catch (e) {}
            return false
        }

        try {
            const child = require('child_process')
            const spawnOpts = { detached: true, stdio: 'ignore' }
            // On Windows create a small batch wrapper to relaunch the launcher after install
            if (process.platform === 'win32') {
                try {
                    const tmp = require('os').tmpdir()
                    const batchPath = path.join(tmp, `mgs_apply_update_arg_${Date.now()}.cmd`)
                    const launcherExe = process.execPath
                    const batchContent = `@echo off\r\nstart /wait "" "${installerPath}"\r\nstart "" "${launcherExe}"\r\nexit\r\n`
                    try { fs.writeFileSync(batchPath, batchContent, { encoding: 'utf8' }) } catch (e) { /* ignore write errors */ }
                    const proc = child.spawn('cmd.exe', ['/c', batchPath], spawnOpts)
                    try { proc.unref && proc.unref() } catch (e) {}
                    try { log.info('[AutoUpdater:arg] Launched installer wrapper:', batchPath) } catch (e) {}
                    try { app.quit() } catch (e) { process.exit(0) }
                    return true
                } catch (e) {
                    try { log.error('[AutoUpdater:arg] failed to spawn installer wrapper', e && e.message) } catch (le) {}
                }
            }

            const proc = child.spawn(installerPath, [], spawnOpts)
            try { proc.unref && proc.unref() } catch (e) {}
            try { log.info('[AutoUpdater:arg] Launched installer:', installerPath) } catch (e) {}
            try { app.quit() } catch (e) { process.exit(0) }
            return true
        } catch (e) {
            try { log.error('[AutoUpdater:arg] failed to spawn installer', e && e.message) } catch (le) {}
            return false
        }
    } catch (e) {
        try { log.warn('[AutoUpdater:arg] unexpected error parsing installer arg', e && e.message) } catch (le) {}
        return false
    }
}

// Attempt to apply installer from argument before normal ready flow
try {
    if (!tryApplyInstallerArg()) {
        app.on('ready', ensureSimpleAutoUpdateThenStart)
        app.on('ready', createMenu)
    }
} catch (e) {
    // Fallback to normal ready handlers if anything goes wrong
    try { app.on('ready', ensureSimpleAutoUpdateThenStart) } catch (ee) {}
    try { app.on('ready', createMenu) } catch (ee) {}
}

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

// Open the Minecraft logs window on request
ipcMain.on('open-mc-logs-window', (event) => {
    try {
        createMcLogWindow()
    } catch (e) {
        try { log.warn('[IPC] open-mc-logs-window failed', e && e.message) } catch (er) { }
    }
})

// Allow renderer windows (like the update status window) to request the
// update window be closed explicitly. This is a safe no-op if the
// updateWindow doesn't exist or is already destroyed.
ipcMain.on('closeUpdateWindow', (event) => {
    try {
        if (updateWindow && !updateWindow.isDestroyed()) {
            try { updateWindow.close() } catch (e) {}
            updateWindow = null
        }
    } catch (e) {
        try { log.warn('[IPC] closeUpdateWindow failed', e && e.message) } catch (er) { }
    }
})

// Provide recent log history to renderers on demand
ipcMain.handle('request-mc-log-history', async (event) => {
    try {
        const hist = mcLogger.getHistory()
        try { log.debug('[request-mc-log-history] returning ' + (hist && hist.bufferLen != null ? hist.bufferLen : (hist && hist.lines ? hist.lines.length : 0)) + ' lines') } catch (e) {}
        try { event && event.sender && event.sender.send && event.sender.send('mc-log-history-ack', { bufferLen: hist && hist.bufferLen != null ? hist.bufferLen : (hist && hist.lines ? hist.lines.length : 0) }) } catch (e) { /* best-effort */ }
        return hist
    } catch (e) {
        try { log.warn('[IPC] request-mc-log-history failed', e && e.message) } catch (er) { }
        return { lines: [], bufferLen: 0 }
    }
})

// Forward log lines to the logs window (create it if needed)
ipcMain.on('mc-log-line', (event, line) => {
    try {
        // Delegate to centralized logger which buffers, writes file, and broadcasts via broadcaster
        try { mcLogger.addLine(line) } catch (e) { try { log.warn('[IPC] mc-log-line addLine failed', e && e.message) } catch (er) {} }
    } catch (e) {
        try { log.warn('[IPC] mc-log-line broadcast failed', e && e.message) } catch (er) { }
    }
})

/**
 * Create a small update status window used to show checking/downloading state.
 * This window listens to the same `autoUpdateNotification` IPC events as the
 * main renderer, so we only need to ensure it exists early in the flow.
 */
function createUpdateWindow() {
    try {
        if (updateWindow && !updateWindow.isDestroyed()) {
            try { updateWindow.focus() } catch (e) { }
            return
        }

        updateWindow = new BrowserWindow({
            width: 720,    // avant: 420
            height: 920, 
            resizable: false,
            alwaysOnTop: true,
            frame: false,
            transparent: false,
            modal: false,
            show: true,
            icon: getPlatformIcon('multigames-logo'),
            webPreferences: {
                preload: path.join(__dirname, 'app', 'assets', 'js', 'preloader.js'),
                nodeIntegration: true,
                contextIsolation: false
            },
            backgroundColor: '#111111'
        })

        remoteMain.enable(updateWindow.webContents)

        // Provide language helper and random background id same as main window
        const data = {
            lang: (str, placeHolders) => LangLoader.queryEJS(str, placeHolders)
        }
        Object.entries(data).forEach(([key, val]) => ejse.data(key, val))

        updateWindow.loadURL(pathToFileURL(path.join(__dirname, 'app', 'update.ejs')).toString())
        updateWindow.removeMenu()

        updateWindow.on('closed', () => {
            updateWindow = null
        })
    } catch (e) {
        try { log.warn('[UpdateWindow] failed to create update window', e && e.message) } catch (er) { }
    }
}

// Helper: close the update status window if the main launcher window has
// started; otherwise mark a pending flag so it closes as soon as the launcher
// is shown. This keeps the splash/update window visible until the main UI
// appears, per requested behavior.
function flushPendingUpdateWindowClose() {
    try {
        if (updateWindow && !updateWindow.isDestroyed()) {
            // Only close when the main launcher window exists (we want the
            // update window to remain visible until after launcher is shown).
            if (win && !win.isDestroyed()) {
                try { updateWindow.close() } catch (e) { }
                updateWindow = null
                global.__closeUpdateWindowWhenLauncherStarted = false
                return true
            }
            // No main window yet
            global.__closeUpdateWindowWhenLauncherStarted = true
            return false
        }
        // No update window present - clear the pending flag
        global.__closeUpdateWindowWhenLauncherStarted = false
        return true
    } catch (e) {
        try { log.warn('[UpdateWindow] flushPendingUpdateWindowClose failed', e && e.message) } catch (er) { }
        return false
    }
}

// Global error handlers to prevent main-process crashes from uncaught exceptions
// (particularly around electron-updater/NSIS install race conditions).
process.on('uncaughtException', (err) => {
    try {
        log.error('[Main] uncaughtException:', err && (err.stack || err.message || err))
    } catch (e) { /* ignore logging errors */ }

    // Common electron-updater NSIS installer message when quitAndInstall is invoked
    // without a valid downloaded installer. Handle it gracefully instead of letting
    // the main process crash.
    try {
        const msg = err && (err.message || '')
        if (msg && (msg.indexOf('No valid update available') !== -1 || msg.indexOf("can't quit and install") !== -1)) {
            try { sendAutoUpdateNotification(undefined, 'realerror', { message: msg }) } catch (e) {}
            // swallow this specific error - it's non-fatal and expected in some race conditions
            return
        }
    } catch (e) {
        // fallthrough to default behaviour below
    }

    // For other uncaught exceptions, try to notify renderers and keep process alive
    try { sendAutoUpdateNotification(undefined, 'realerror', { message: err && (err.message || String(err)) }) } catch (e) {}
    // Do not rethrow to avoid crashing the app in production; allow graceful degradation.
})

process.on('unhandledRejection', (reason, p) => {
    try { log.warn('[Main] unhandledRejection:', reason) } catch (e) {}
    try { sendAutoUpdateNotification(undefined, 'realerror', { message: reason && (reason.message || String(reason)) }) } catch (e) {}
})
// IPC helper: fetch RSS (used as fallback when renderer fetch is blocked by CORS)
ipcMain.handle('fetch-rss', async (event, url) => {
    const https = require('https')
    const http = require('http')
    const { URL } = require('url')
    return new Promise((resolve, reject) => {
        try {
            const u = new URL(url)
            const lib = u.protocol === 'https:' ? https : http
            const req = lib.get(u, { timeout: 15000 }, (res) => {
                const status = res.statusCode || 0
                if (status >= 400) {
                    reject(new Error('HTTP error ' + status))
                    return
                }
                let body = ''
                res.setEncoding('utf8')
                res.on('data', (chunk) => { body += chunk })
                res.on('end', () => resolve({ ok: true, text: body }))
            })
            req.on('error', (err) => reject(err))
            req.on('timeout', () => {
                try { req.abort() } catch (e) {}
                reject(new Error('Request timed out'))
            })
        } catch (e) {
            reject(e)
        }
    })
})

// IPC handlers for Resource Pack management
ipcMain.handle('clean-resource-cache', async (event) => {
    const path = require('path')
    const ConfigManager = require('./app/assets/js/configmanager')
    const fs = require('fs-extra')
    try {
        const instancePath = path.join(ConfigManager.getDataDirectory(), 'instances')
        const downloadsPath = path.join(instancePath, 'downloads')
        let cleaned = false
        if (await fs.pathExists(downloadsPath)) {
            await fs.remove(downloadsPath)
            cleaned = true
        }
        return { success: true, cacheCleared: cleaned }
    } catch (error) {
        return { success: false, error: error.message }
    }
})

ipcMain.handle('check-resource-errors', async (event) => {
    const fs = require('fs-extra')
    const path = require('path')
    const ConfigManager = require('./app/assets/js/configmanager')
    
    try {
        // Cette fonction simule une vérification des erreurs
        // En pratique, elle pourrait analyser les logs existants
        const logPath = path.join(ConfigManager.getDataDirectory(), 'instances')
        
        // Simulation d'une vérification - à remplacer par une vraie logique
        const errors = []
        
        // Check for common resource pack issues
        const instanceDirs = fs.existsSync(logPath) ? await fs.readdir(logPath) : []
        
        for (const instanceDir of instanceDirs) {
            const downloadPath = path.join(logPath, instanceDir, 'downloads')
            if (await fs.pathExists(downloadPath)) {
                // Simulate finding some potential issues
                // In reality, this would parse log files or check for corrupted resources
                const dirs = await fs.readdir(downloadPath).catch(() => [])
                if (dirs.length > 0) {
                    // Add simulated error for demonstration
                    errors.push({
                        type: 'resource_pack_cache',
                        details: `Cache trouvé dans ${instanceDir}`,
                        path: downloadPath
                    })
                }
            }
        }
        
        return {
            success: true,
            errors: errors
        }
    } catch (error) {
        return {
            success: false,
            error: error.message,
            errors: []
        }
    }
})

ipcMain.handle('auto-fix-resources', async (event) => {
    const path = require('path')
    const ConfigManager = require('./app/assets/js/configmanager')
    const fs = require('fs-extra')
    try {
        const instancePath = path.join(ConfigManager.getDataDirectory(), 'instances')
        const downloadsPath = path.join(instancePath, 'downloads')
        let cacheCleared = false
        if (await fs.pathExists(downloadsPath)) {
            await fs.remove(downloadsPath)
            cacheCleared = true
        }
        // Full auto-repair removed; return informative response
        return {
            success: true,
            cacheCleared,
            modelsRepaired: 0,
            errors: [],
            note: 'resourcepack auto-fix removed; only downloads cleaned'
        }
    } catch (error) {
        return { success: false, error: error.message }
    }
})

// Handler: clear application caches and common cache folders used by Electron
ipcMain.handle('clear-app-cache', async (event) => {
    try {
        const { session, app } = require('electron')
        const fs = require('fs')
        const path = require('path')

        // Clear chromium session caches
        try {
            if (session && session.defaultSession && typeof session.defaultSession.clearCache === 'function') {
                await session.defaultSession.clearCache()
            }
            if (session && session.defaultSession && typeof session.defaultSession.clearStorageData === 'function') {
                await session.defaultSession.clearStorageData()
            }
        } catch (e) {
            try { log && log.warn && log.warn('[IPC] clear-app-cache: session clear failed', e && e.message) } catch (ee) {}
        }

        // Remove common cache folders under app paths when present (best-effort)
        try {
            const candidates = []
            try { candidates.push(app.getPath('cache')) } catch (e) {}
            try { candidates.push(path.join(app.getPath('userData'), 'Cache')) } catch (e) {}
            try { candidates.push(path.join(app.getPath('userData'), 'GPUCache')) } catch (e) {}
            try { candidates.push(path.join(app.getPath('userData'), 'Service Worker', 'CacheStorage')) } catch (e) {}

            for (const c of candidates) {
                if (!c) continue
                try {
                    if (fs.existsSync(c)) {
                        // Use rmSync with force/recursive if available
                        try {
                            fs.rmSync(c, { recursive: true, force: true })
                        } catch (e) {
                            // fallback to rmdirSync
                            try { fs.rmdirSync(c, { recursive: true }) } catch (er) {}
                        }
                    }
                } catch (e) {
                    try { log && log.debug && log.debug('[IPC] clear-app-cache: failed to remove', c, e && e.message) } catch (ee) {}
                }
            }
        } catch (e) {
            try { log && log.warn && log.warn('[IPC] clear-app-cache: remove candidates failed', e && e.message) } catch (ee) {}
        }

        return { success: true }
    } catch (error) {
        try { log && log.error && log.error('[IPC] clear-app-cache unexpected error', error && error.message) } catch (e) {}
        return { success: false, error: (error && error.message) || String(error) }
    }
})