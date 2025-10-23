const fs = require('fs')
const path = require('path')
const os = require('os')
const log = require('electron-log')

// Simple, focused Minecraft log manager for main process
// Responsibilities:
// - maintain an in-memory ring buffer of recent lines
// - optionally append to a file when enabled via env or dev
// - allow a broadcaster function to be set by the host (index.js)

const MC_LOG_BUFFER_MAX = 2000
let mcLogBuffer = []
let mcFileStream = null
const enableMcFileLog = (() => {
  try {
    if (process.env && (process.env.MGS_ENABLE_MC_FILE_LOG === '1' || process.env.MGS_ENABLE_MC_FILE_LOG === 'true')) return true
    // allow in dev
    if (process.env.NODE_ENV === 'development') return true
  } catch (e) {}
  return false
})()

if (enableMcFileLog) {
  try {
    const logDir = path.join(os.homedir(), '.multigames-logs')
    try { fs.mkdirSync(logDir, { recursive: true }) } catch (e) { }
    const mcLogPath = path.join(logDir, 'mc.log')
    mcFileStream = fs.createWriteStream(mcLogPath, { flags: 'a', encoding: 'utf8' })
    try { log.info('[MCFileLog] enabled, writing to', mcLogPath) } catch (e) {}
  } catch (e) {
    try { log.warn('[MCFileLog] failed to initialize file stream', e && e.message) } catch (er) {}
    mcFileStream = null
  }
}

// broadcaster: function(line) -> void. Set by host (index.js) so we don't depend on BrowserWindow here.
let broadcaster = null
function setBroadcaster(fn) {
  broadcaster = typeof fn === 'function' ? fn : null
}

function pushToBuffer(line) {
  try {
    if (typeof line === 'string') {
      mcLogBuffer.push(line)
      if (mcLogBuffer.length > MC_LOG_BUFFER_MAX) {
        mcLogBuffer.splice(0, mcLogBuffer.length - MC_LOG_BUFFER_MAX)
      }
    }
  } catch (e) {
    try { log.warn('[mc-logger] buffer push failed', e && e.message) } catch (er) {}
  }
}

function writeToFile(line) {
  try {
    if (mcFileStream && typeof line === 'string') {
      mcFileStream.write(line.replace(/\r/g, '') + '\n')
    }
  } catch (e) {
    try { log.warn('[MCFileLog] write failed', e && e.message) } catch (er) {}
  }
}

function addLine(line) {
  try {
    pushToBuffer(line)
    writeToFile(line)
    try { log.debug('[mc-logger] buffered, bufferLen=' + mcLogBuffer.length) } catch (e) {}
    // broadcast via host-provided broadcaster
    try { if (broadcaster) broadcaster(line) } catch (e) { try { log.warn('[mc-logger] broadcaster errored', e && e.message) } catch (er) {} }
  } catch (e) {
    try { log.warn('[mc-logger] addLine failed', e && e.message) } catch (er) {}
  }
}

function getHistory() {
  return { lines: mcLogBuffer.slice(), bufferLen: mcLogBuffer.length }
}

module.exports = {
  setBroadcaster,
  addLine,
  getHistory,
  enableFileLog: enableMcFileLog
}
