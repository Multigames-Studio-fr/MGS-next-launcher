// Simple SQLite storage layer for authentication database
const path = require('path')
const { LoggerUtil } = require('helios-core')
const log = LoggerUtil.getLogger('SqlStorage')

let db = null
let DB_PATH = null

function init(dbPath) {
    try {
        DB_PATH = dbPath
        const Database = require('better-sqlite3')
        db = new Database(DB_PATH)
        db.pragma('journal_mode = WAL')
        db.prepare(`CREATE TABLE IF NOT EXISTS auth_accounts (
            uuid TEXT PRIMARY KEY,
            data TEXT NOT NULL
        )`).run()
        return true
    } catch (err) {
        log.warn('Failed to initialize SQLite storage:', err && err.message)
        db = null
        return false
    }
}

function getAllAuthAccounts() {
    try {
        if (!db) return {}
        const rows = db.prepare('SELECT uuid, data FROM auth_accounts').all()
        const out = {}
        for (const r of rows) {
            try { out[r.uuid] = JSON.parse(r.data) } catch (e) { out[r.uuid] = null }
        }
        return out
    } catch (err) {
        log.warn('Failed to read auth accounts from sqlite:', err && err.message)
        return {}
    }
}

function setAuthAccounts(obj) {
    try {
        if (!db) return false
        const del = db.prepare('DELETE FROM auth_accounts')
        const insert = db.prepare('INSERT INTO auth_accounts (uuid, data) VALUES (?,?)')
        const tx = db.transaction((accounts) => {
            del.run()
            for (const k of Object.keys(accounts)) {
                insert.run(k, JSON.stringify(accounts[k]))
            }
        })
        tx(obj)
        return true
    } catch (err) {
        log.warn('Failed to write auth accounts to sqlite:', err && err.message)
        return false
    }
}

module.exports = {
    init,
    getAllAuthAccounts,
    setAuthAccounts
}
