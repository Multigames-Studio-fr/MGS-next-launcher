(function(){
  // settings-logs.js - Refactored embedded logs panel wiring
  // Responsibilities:
  // - handle incoming 'mc-log-line' messages
  // - request history via 'request-mc-log-history'
  // - support pause/resume (queues while paused)
  // - support filter with debounce and safe regex handling
  // - provide save/copy/open actions via ipcRenderer where available
  // - expose minimal globals only when necessary

  'use strict'

  // Safe guard if not running in Electron
  const isElectron = (typeof require === 'function' && typeof module !== 'undefined')
  let ipcRenderer = null
  try { if (isElectron) ipcRenderer = require('electron').ipcRenderer } catch (e) { ipcRenderer = null }

  // DOM references (resolved lazily to allow early script load)
  function $(id) { return document.getElementById(id) }

  const state = {
    paused: false,
    queued: [],
    bufferSizeLimit: 20000, // characters
    lastFilter: '',
    filterDebounceMs: 250,
    filterTimeout: null
  }

  function getEls() {
    return {
      logsWrapper: $('settingsMcLogsWrapper'),
      logsEl: $('settingsMcLogs'),
      clearBtn: $('settingsMcLogsClear'),
      openBtn: $('settingsMcLogsOpenWindow'),
      pauseBtn: $('settingsMcLogsPause'),
      saveBtn: $('settingsMcLogsSave'),
      copyBtn: $('settingsMcLogsCopy'),
      filterInput: $('settingsMcLogsFilter'),
      statsEl: $('settingsMcLogsStats'),
      noteEl: $('settingsMcLogsNote'),
      checkBtn: $('settingsMcLogsCheck')
    }
  }

  function safe(fn){
    try { fn() } catch(e) { console.debug('[SettingsLogs] safe handler error', e) }
  }

  function setVisible(visible){
    safe(() => { const el = $('settingsMcLogsWrapper'); if(el) el.style.display = visible ? 'block' : 'none' })
  }

  function updateStats() {
    safe(() => {
      const { logsEl, statsEl } = getEls()
      const lines = logsEl && logsEl.textContent ? logsEl.textContent.split('\n').filter(Boolean).length : 0
      if (statsEl) statsEl.textContent = lines + ' lines'
    })
  }

  function truncateIfNeeded(logsEl){
    if(!logsEl) return
    if(logsEl.textContent && logsEl.textContent.length > state.bufferSizeLimit){
      logsEl.textContent = logsEl.textContent.slice(-state.bufferSizeLimit)
    }
  }

  function appendLine(line){
    safe(() => {
      const { logsEl, filterInput } = getEls()
      if (!logsEl) return
      const filter = filterInput && filterInput.value ? filterInput.value : ''
      if (filter) {
        try {
          const re = new RegExp(filter, 'i')
          if (!re.test(line)) return
        } catch (e) {
          // invalid regex - ignore filtering
        }
      }
      logsEl.textContent += line + '\n'
      truncateIfNeeded(logsEl)
      logsEl.scrollTop = logsEl.scrollHeight
      updateStats()
    })
  }

  function flushQueue(){
    safe(() => {
      if (!state.queued || state.queued.length === 0) return
      for(const l of state.queued) appendLine(l)
      state.queued = []
    })
  }

  function onLogLine(_, line){
    safe(() => {
      const { logsWrapper, noteEl } = getEls()
      if(!line) return
      if(logsWrapper) logsWrapper.style.display = 'block'
      if(noteEl){ noteEl.style.display = 'block'; noteEl.textContent = 'Streaming live logs.' }
      if (state.paused) {
        state.queued.push(line)
      } else {
        appendLine(line)
      }
    })
  }

  async function requestHistory(){
    safe(async () => {
      if (!ipcRenderer) return
      try {
        const hist = await ipcRenderer.invoke('request-mc-log-history')
        const { logsWrapper, logsEl, noteEl } = getEls()
        let lines = []
        let bufferLen = 0
        if (Array.isArray(hist)) {
          lines = hist
          bufferLen = hist.length
        } else if (hist && Array.isArray(hist.lines)) {
          lines = hist.lines
          bufferLen = typeof hist.bufferLen === 'number' ? hist.bufferLen : hist.lines.length
        } else {
          if(noteEl){ noteEl.style.display = 'block'; noteEl.textContent = 'No log history available.' }
          if(logsWrapper) logsWrapper.style.display = 'block'
          return
        }

        if (lines.length === 0) {
          if(logsWrapper) logsWrapper.style.display = 'block'
          if(noteEl){ noteEl.style.display = 'block'; noteEl.textContent = 'No logs yet. (bufferLen=' + bufferLen + ')' }
          return
        }

        const joined = lines.join('\n')
        if (joined.length > 0) {
          if(logsWrapper) logsWrapper.style.display = 'block'
          if(noteEl){ noteEl.style.display = 'block'; noteEl.textContent = 'Showing ' + lines.length + ' buffered log lines. (bufferLen=' + bufferLen + ')' }
          if (state.paused) {
            state.queued = state.queued.concat(lines)
          } else {
            if (logsEl) logsEl.textContent += (logsEl.textContent && logsEl.textContent.length > 0 ? '\n' : '') + joined + '\n'
            truncateIfNeeded(logsEl)
            if (logsEl) logsEl.scrollTop = logsEl.scrollHeight
            updateStats()
          }
        }
      } catch (e) {
        console.debug('[SettingsLogs] requestHistory error', e)
      }
    })
  }

  function wireControls(){
    safe(() => {
      const { clearBtn, openBtn, pauseBtn, saveBtn, copyBtn, filterInput, checkBtn, logsEl, noteEl } = getEls()
      if (clearBtn) clearBtn.addEventListener('click', () => { if(getEls().logsEl) { getEls().logsEl.textContent = ''; updateStats() } })
      if (openBtn) openBtn.addEventListener('click', () => { try{ ipcRenderer && ipcRenderer.send && ipcRenderer.send('open-mc-logs-window') } catch(e){} })
      if (pauseBtn) pauseBtn.addEventListener('click', () => {
        state.paused = !state.paused
        pauseBtn.textContent = state.paused ? 'Resume' : 'Pause'
        if(noteEl){ noteEl.style.display = 'block'; noteEl.textContent = state.paused ? 'Paused — incoming lines are queued.' : 'Resumed — queued lines appended.' }
        if(!state.paused) flushQueue()
      })

      if (saveBtn) saveBtn.addEventListener('click', async () => {
        try {
          const content = getEls().logsEl ? getEls().logsEl.textContent : ''
          if (ipcRenderer && ipcRenderer.invoke) {
            const res = await ipcRenderer.invoke('save-mc-log', content)
            if(noteEl){ noteEl.style.display = 'block'; noteEl.textContent = res && res.path ? ('Saved to ' + res.path) : (res && res.result === true ? 'Saved' : 'Save failed') }
          } else {
            // fallback: download as file in browser context
            downloadAsFile('mc-logs.txt', content)
            if(noteEl){ noteEl.style.display = 'block'; noteEl.textContent = 'Saved (browser)'}
          }
        } catch(e) { console.debug('[SettingsLogs] save error', e) }
      })

      if (copyBtn) copyBtn.addEventListener('click', async () => {
        try {
          const content = getEls().logsEl ? getEls().logsEl.textContent : ''
          if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(content)
          else try { document.execCommand('copy') } catch(e){}
          if(noteEl){ noteEl.style.display = 'block'; noteEl.textContent = 'Copied to clipboard.' }
        } catch(e) { console.debug('[SettingsLogs] copy error', e) }
      })

      if (filterInput) filterInput.addEventListener('input', () => {
        // debounce re-filter
        state.lastFilter = filterInput.value
        if (state.filterTimeout) clearTimeout(state.filterTimeout)
        state.filterTimeout = setTimeout(() => {
          // simpler approach: clear view and request history to rebuild filtered view
          if (getEls().logsEl) getEls().logsEl.textContent = ''
          updateStats()
          try { requestHistory() } catch(e){}
        }, state.filterDebounceMs)
      })

      if (checkBtn) checkBtn.addEventListener('click', async () => {
        try {
          if (!ipcRenderer) return
          const res = await ipcRenderer.invoke('request-mc-log-history')
          if(noteEl){ noteEl.style.display = 'block'; noteEl.textContent = 'Buffer response: ' + (res && res.bufferLen != null ? ('bufferLen=' + res.bufferLen) : (Array.isArray(res) ? 'legacy array len=' + res.length : JSON.stringify(res))) }
        } catch(e) { console.debug('[SettingsLogs] manual check buffer error', e) }
      })

      // listen for ack
      if (ipcRenderer && ipcRenderer.on) {
        try { ipcRenderer.on('mc-log-history-ack', (_, info) => { safe(() => { if(getEls().noteEl) getEls().noteEl.style.display = 'block'; if(getEls().noteEl) getEls().noteEl.textContent = 'History ack received (bufferLen=' + (info && typeof info.bufferLen === 'number' ? info.bufferLen : 'unknown') + ')' }) }) } catch(e){}
      }

    })
  }

  function downloadAsFile(filename, content){
    try {
      const blob = new Blob([content || ''], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) { console.debug('[SettingsLogs] downloadAsFile error', e) }
  }

  function init(){
    safe(() => {
      wireControls()

      // Initialize visibility from ConfigManager if available
      try{
        if(window.ConfigManager && typeof ConfigManager.getShowMinecraftLogs === 'function'){
          setVisible(ConfigManager.getShowMinecraftLogs())
        }
      } catch(e){}

      // Listen for setting changes
      window.addEventListener('settings-updated', () => {
        try{ setVisible(ConfigManager.getShowMinecraftLogs && ConfigManager.getShowMinecraftLogs()) } catch(e){}
      })

      // Bind to tab activation event
      window.addEventListener('settings-tab-activated', (ev) => {
        try { if(ev && ev.detail && ev.detail.tabId === 'settingsTabLogs') requestHistory() } catch(e){}
      })

      // Fallback delegated click listener for nav
      document.addEventListener('click', (ev) => {
        try {
          const t = ev.target || ev.srcElement
          const btn = t.closest && t.closest('.settingsNavItem[ rSc="settingsTabLogs" ], .settingsNavItem[rSc="settingsTabLogs"]')
          const alt = t.closest && t.closest('[rSc="settingsTabLogs"]')
          if (btn || alt) { if(getEls().logsWrapper) getEls().logsWrapper.style.display = 'block'; requestHistory() }
        } catch(e){}
      }, { capture: true })

      // Request history immediately (safe no-op)
      try { requestHistory() } catch(e){}

      // Listen for live lines
      if (ipcRenderer && ipcRenderer.on) {
        try { ipcRenderer.on('mc-log-line', onLogLine) } catch(e){}
      }

    })
  }

  // Auto-init when DOM ready
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()

  // Expose for testing/debug if needed
  window.__SettingsLogs = {
    requestHistory,
    appendLine: (l) => appendLine(l),
    _state: state
  }

})()
