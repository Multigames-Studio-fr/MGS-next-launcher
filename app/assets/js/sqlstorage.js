// SQLite storage using sql.js (WASM) for portability (no native rebuild)
const fs = require('fs')
const path = require('path')
let LoggerUtil
try {
    if (typeof LoggerUtil === 'undefined' || !LoggerUtil) {
        const _hc = require('helios-core')
        LoggerUtil = _hc && _hc.LoggerUtil
    }
} catch (e) {
    // ignore - may be provided globally
}
const { getSqlJsConfig } = require('./wasm-config')
const log = LoggerUtil.getLogger('SqlStorage')

let SQL = null
let db = null
let DB_PATH = null
let DB_BACKUP_PATH = null
let ready = false
let initPromise = null
let lastPersistTime = 0
const PERSIST_DEBOUNCE_MS = 1000 // Minimum time between persists

/**
 * Create a backup of the database file
 */
function createBackup() {
    try {
        if (DB_PATH && fs.existsSync(DB_PATH) && DB_BACKUP_PATH) {
            fs.copyFileSync(DB_PATH, DB_BACKUP_PATH)
            log.debug('Created database backup at', DB_BACKUP_PATH)
            return true
        }
    } catch (err) {
        log.warn('Failed to create database backup:', err && err.message)
    }
    return false
}

/**
 * Restore database from backup
 */
function restoreFromBackup() {
    try {
        if (DB_BACKUP_PATH && fs.existsSync(DB_BACKUP_PATH)) {
            const backupData = fs.readFileSync(DB_BACKUP_PATH)
            if (backupData && backupData.length > 0) {
                fs.writeFileSync(DB_PATH, backupData)
                log.info('Restored database from backup')
                return true
            }
        }
    } catch (err) {
        log.warn('Failed to restore from backup:', err && err.message)
    }
    return false
}

/**
 * Validate database integrity
 */
function validateDatabase() {
    try {
        if (!db) return false
        // Run integrity check
        const result = db.exec('PRAGMA integrity_check;')
        if (result && result.length > 0 && result[0].values) {
            const status = result[0].values[0][0]
            return status === 'ok'
        }
    } catch (err) {
        log.warn('Database integrity check failed:', err && err.message)
    }
    return false
}

async function init(dbPath) {
    // Prevent multiple concurrent initializations
    if (initPromise) {
        return initPromise
    }
    
    initPromise = (async () => {
        DB_PATH = dbPath
        DB_BACKUP_PATH = dbPath + '.backup'
        
        try {
            const initSqlJs = require('sql.js')
            // Utilise la configuration WASM
            const SQLmod = await initSqlJs(getSqlJsConfig())
            SQL = SQLmod

            let loadedFromBackup = false
            
            if (fs.existsSync(DB_PATH)) {
                try {
                    const filebuf = fs.readFileSync(DB_PATH)
                    if (filebuf && filebuf.length > 0) {
                        db = new SQL.Database(new Uint8Array(filebuf))
                        
                        // Validate database integrity
                        if (!validateDatabase()) {
                            log.warn('Database integrity check failed, attempting restore from backup')
                            db.close()
                            db = null
                            
                            if (restoreFromBackup()) {
                                const backupBuf = fs.readFileSync(DB_PATH)
                                db = new SQL.Database(new Uint8Array(backupBuf))
                                loadedFromBackup = true
                            }
                        }
                    } else {
                        log.warn('Database file is empty, creating new database')
                    }
                } catch (readErr) {
                    log.warn('Failed to read database file:', readErr && readErr.message)
                    // Try to restore from backup
                    if (restoreFromBackup()) {
                        try {
                            const backupBuf = fs.readFileSync(DB_PATH)
                            db = new SQL.Database(new Uint8Array(backupBuf))
                            loadedFromBackup = true
                        } catch (e) {
                            log.warn('Failed to load restored backup:', e && e.message)
                        }
                    }
                }
            }
            
            if (!db) {
                db = new SQL.Database()
                log.info('Created new SQLite database')
            }
            
            // ensure table exists in case db loaded from file
            db.run(`CREATE TABLE IF NOT EXISTS auth_accounts (uuid TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER DEFAULT 0);`)
            
            // Migrate old table if needed (add updated_at column)
            try {
                db.run(`ALTER TABLE auth_accounts ADD COLUMN updated_at INTEGER DEFAULT 0;`)
            } catch (e) {
                // Column might already exist, ignore error
            }
            
            persistDb()
            
            // Create backup after successful init
            if (!loadedFromBackup) {
                createBackup()
            }
            
            ready = true
            log.info('SqlStorage initialized successfully')
            return getAllAuthAccounts()
        } catch (err) {
            log.warn('Failed to initialize sql.js storage:', err && err.message)
            ready = false
            initPromise = null
            return {}
        }
    })()
    
    return initPromise
}

function persistDb() {
    try {
        if (!db) return false
        
        // Debounce persists to avoid excessive writes
        const now = Date.now()
        if (now - lastPersistTime < PERSIST_DEBOUNCE_MS) {
            log.debug('Persist debounced, skipping')
            return true
        }
        lastPersistTime = now
        
        const data = db.export()
        
        // Write to temp file first, then rename for atomicity
        const tempPath = DB_PATH + '.tmp'
        fs.writeFileSync(tempPath, Buffer.from(data))
        
        // Rename temp to actual (atomic on most filesystems)
        fs.renameSync(tempPath, DB_PATH)
        
        log.debug('Database persisted successfully')
        return true
    } catch (err) {
        log.warn('Failed to persist sqlite db file:', err && err.message)
        
        // Fallback: try direct write if rename failed
        try {
            const data = db.export()
            fs.writeFileSync(DB_PATH, Buffer.from(data))
            return true
        } catch (fallbackErr) {
            log.error('Fallback persist also failed:', fallbackErr && fallbackErr.message)
        }
        return false
    }
}

/**
 * Force immediate persist (bypasses debounce)
 */
function forcePersist() {
    lastPersistTime = 0
    return persistDb()
}

function getAllAuthAccounts() {
    try {
        if (!ready || !db) return {}
        const res = {}
        const stmt = db.prepare('SELECT uuid, data FROM auth_accounts ORDER BY updated_at DESC')
        while (stmt.step()) {
            const row = stmt.get()
            try { 
                const parsed = JSON.parse(row[1])
                if (parsed && typeof parsed === 'object') {
                    res[row[0]] = parsed 
                }
            } catch (e) { 
                log.warn('Failed to parse account data for uuid', row[0], e && e.message)
            }
        }
        stmt.free()
        return res
    } catch (err) {
        log.warn('Failed to read auth accounts from sql.js:', err && err.message)
        return {}
    }
}

/**
 * Get a single auth account by UUID
 */
function getAuthAccount(uuid) {
    try {
        if (!ready || !db || !uuid) return null
        const stmt = db.prepare('SELECT data FROM auth_accounts WHERE uuid = ?')
        stmt.bind([uuid])
        if (stmt.step()) {
            const row = stmt.get()
            stmt.free()
            try {
                return JSON.parse(row[0])
            } catch (e) {
                return null
            }
        }
        stmt.free()
        return null
    } catch (err) {
        log.warn('Failed to get auth account:', err && err.message)
        return null
    }
}

/**
 * Add or update a single auth account
 */
function setAuthAccount(uuid, accountData) {
    try {
        if (!ready || !db || !uuid) return false
        const now = Date.now()
        const stmt = db.prepare('INSERT OR REPLACE INTO auth_accounts (uuid, data, updated_at) VALUES (?, ?, ?)')
        stmt.run([uuid, JSON.stringify(accountData), now])
        stmt.free()
        persistDb()
        return true
    } catch (err) {
        log.warn('Failed to set auth account:', err && err.message)
        return false
    }
}

/**
 * Remove an auth account by UUID
 */
function removeAuthAccount(uuid) {
    try {
        if (!ready || !db || !uuid) return false
        const stmt = db.prepare('DELETE FROM auth_accounts WHERE uuid = ?')
        stmt.run([uuid])
        stmt.free()
        persistDb()
        
        // Update backup after removal
        createBackup()
        return true
    } catch (err) {
        log.warn('Failed to remove auth account:', err && err.message)
        return false
    }
}

function setAuthAccounts(obj) {
    try {
        if (!ready || !db) return false
        
        const now = Date.now()
        
        // Start transaction
        db.run('BEGIN TRANSACTION;')
        
        try {
            // Clear existing accounts
            db.run('DELETE FROM auth_accounts;')
            
            // Insert all accounts
            const stmt = db.prepare('INSERT INTO auth_accounts (uuid, data, updated_at) VALUES (?, ?, ?)')
            for (const k of Object.keys(obj)) {
                if (obj[k] && typeof obj[k] === 'object') {
                    stmt.run([k, JSON.stringify(obj[k]), now])
                }
            }
            stmt.free()
            
            // Commit transaction
            db.run('COMMIT;')
            
            forcePersist()
            
            // Update backup after successful write
            createBackup()
            
            log.info('Successfully saved', Object.keys(obj).length, 'auth accounts')
            return true
        } catch (txErr) {
            // Rollback on error
            try { db.run('ROLLBACK;') } catch (e) { }
            throw txErr
        }
    } catch (err) {
        log.warn('Failed to write auth accounts to sql.js:', err && err.message)
        return false
    }
}

/**
 * Get the count of stored accounts
 */
function getAccountCount() {
    try {
        if (!ready || !db) return 0
        const result = db.exec('SELECT COUNT(*) FROM auth_accounts;')
        if (result && result.length > 0 && result[0].values) {
            return result[0].values[0][0] || 0
        }
        return 0
    } catch (err) {
        return 0
    }
}

module.exports = {
    init,
    getAllAuthAccounts,
    getAuthAccount,
    setAuthAccount,
    removeAuthAccount,
    setAuthAccounts,
    getAccountCount,
    forcePersist,
    createBackup,
    // helper for callers that want to know readiness
    isReady: () => ready
}
