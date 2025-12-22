// SQLite storage using sql.js (WASM) for portability (no native rebuild)
const fs = require('fs')
const path = require('path')
const { LoggerUtil } = require('helios-core')
const { getSqlJsConfig } = require('./wasm-config')
const log = LoggerUtil.getLogger('SqlStorage')

let SQL = null
let db = null
let DB_PATH = null
let ready = false

async function init(dbPath) {
    DB_PATH = dbPath
    try {
        const initSqlJs = require('sql.js')
        // Utilise la configuration WASM
        const SQLmod = await initSqlJs(getSqlJsConfig())
        SQL = SQLmod

        if (fs.existsSync(DB_PATH)) {
            const filebuf = fs.readFileSync(DB_PATH)
            db = new SQL.Database(new Uint8Array(filebuf))
        } else {
            db = new SQL.Database()
            // create table
            db.run(`CREATE TABLE IF NOT EXISTS auth_accounts (uuid TEXT PRIMARY KEY, data TEXT NOT NULL);`)
            persistDb()
        }
        // ensure table exists in case db loaded from file
        db.run(`CREATE TABLE IF NOT EXISTS auth_accounts (uuid TEXT PRIMARY KEY, data TEXT NOT NULL);`)
        ready = true
        return getAllAuthAccounts()
    } catch (err) {
        log.warn('Failed to initialize sql.js storage:', err && err.message)
        ready = false
        return {}
    }
}

function persistDb() {
    try {
        if (!db) return false
        const data = db.export()
        fs.writeFileSync(DB_PATH, Buffer.from(data))
        return true
    } catch (err) {
        log.warn('Failed to persist sqlite db file:', err && err.message)
        return false
    }
}

function getAllAuthAccounts() {
    try {
        if (!ready || !db) return {}
        const res = {}
        const stmt = db.prepare('SELECT uuid, data FROM auth_accounts')
        while (stmt.step()) {
            const row = stmt.get()
            try { res[row[0]] = JSON.parse(row[1]) } catch (e) { res[row[0]] = null }
        }
        stmt.free()
        return res
    } catch (err) {
        log.warn('Failed to read auth accounts from sql.js:', err && err.message)
        return {}
    }
}

function setAuthAccounts(obj) {
    try {
        if (!ready || !db) return false
        const del = db.prepare('DELETE FROM auth_accounts')
        del.run()
        const insert = db.prepare('INSERT OR REPLACE INTO auth_accounts (uuid, data) VALUES (?,?)')
        const tx = db.transaction((accounts) => {
            for (const k of Object.keys(accounts)) {
                insert.run(k, JSON.stringify(accounts[k]))
            }
        })
        tx(obj)
        persistDb()
        return true
    } catch (err) {
        log.warn('Failed to write auth accounts to sql.js:', err && err.message)
        return false
    }
}

module.exports = {
    init,
    getAllAuthAccounts,
    setAuthAccounts,
    // helper for callers that want to know readiness
    isReady: () => ready
}
