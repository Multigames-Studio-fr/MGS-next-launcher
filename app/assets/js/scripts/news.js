// news.js
// New, self-contained news system for the launcher.
// Responsibilities:
// - Expose window.initNews()
// - Fetch RSS (renderer fetch, fallback to main-process via ipcRenderer)
// - Render news cards into #newsContent .news-grid using #news-card-template
// - Provide showNewsMode() / hideNewsMode() and wire UI buttons

(function(){
    'use strict'

    const DEFAULT_RSS = 'https://multigames-studio.fr/api/news/rss.xml'
    const USE_IPC = (() => {
        try { return typeof require === 'function' && !!require('electron').ipcRenderer } catch (e) { return false }
    })()

    async function fetchViaRenderer(url, timeout = 10000) {
        try {
            const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
            if (ctrl) setTimeout(() => ctrl.abort && ctrl.abort(), timeout)
            const res = await fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
            if (!res.ok) throw new Error('Network response not ok: ' + res.status)
            return await res.text()
        } catch (e) {
            throw e
        }
    }

    async function fetchRSS(url) {
        const results = []
        let text = null
        try {
            text = await fetchViaRenderer(url)
        } catch (err) {
            // try IPC fallback
            try {
                if (USE_IPC) {
                    const { ipcRenderer } = require('electron')
                    const resp = await ipcRenderer.invoke('fetch-rss', url)
                    if (resp && resp.ok && resp.text) text = resp.text
                    else throw new Error('IPC fetch failed')
                } else {
                    throw err
                }
            } catch (ipcErr) {
                throw err
            }
        }

        if (!text) return results

        try {
            const doc = new DOMParser().parseFromString(text, 'text/xml')
            const items = Array.from(doc.querySelectorAll('item'))
            const channel = doc.querySelector('channel')
            const origin = (() => {
                try {
                    const link = channel && channel.querySelector && channel.querySelector('link')
                    if (link && link.textContent) {
                        const u = new URL(link.textContent)
                        return u.origin + '/'
                    }
                } catch (e) {}
                try { const u2 = new URL(url); return u2.origin + '/' } catch (e) { return '' }
            })()

            for (const it of items.slice(0, 30)) {
                try {
                    const title = it.querySelector('title') && it.querySelector('title').textContent || '(sans titre)'
                    const link = (it.querySelector('link') && it.querySelector('link').textContent) || (it.querySelector('guid') && it.querySelector('guid').textContent) || ''
                    const pubDate = it.querySelector('pubDate') ? it.querySelector('pubDate').textContent : ''
                    const descEl = it.querySelector('description') || it.querySelector('content\:encoded')
                    const desc = descEl ? stripTags(descEl.textContent).slice(0, 600) : ''
                    let thumb = null
                    try {
                        const enc = it.querySelector('enclosure')
                        if (enc && enc.getAttribute && enc.getAttribute('url')) thumb = enc.getAttribute('url')
                        if (!thumb) {
                            const mt = it.querySelector('media\:thumbnail') || it.querySelector('media\:content')
                            if (mt && mt.getAttribute && mt.getAttribute('url')) thumb = mt.getAttribute('url')
                        }
                        if (!thumb && descEl && descEl.textContent) {
                            const m = descEl.textContent.match(/<img[^>]+src=["']?([^>"']+)["']?[^>]*>/i)
                            if (m && m[1]) thumb = m[1]
                        }
                        // If thumb is relative, make absolute
                        if (thumb && thumb.indexOf('http') !== 0 && origin) thumb = origin + thumb.replace(/^\//, '')
                    } catch (e) {}

                    results.push({ title, link, date: pubDate, excerpt: desc, thumb })
                } catch (e) { /* ignore item errors */ }
            }
        } catch (e) {
            throw e
        }

        return results
    }

    function stripTags(html) {
        if (!html) return ''
        return String(html).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    }

    function renderCard(data, sizeClass) {
        const tpl = document.getElementById('news-card-template')
        if (tpl && tpl.content && tpl.content.firstElementChild) {
            const el = tpl.content.firstElementChild.cloneNode(true)
            try {
                // add bento size class
                el.classList.add(sizeClass || 'bento-small')
                const imgEl = el.querySelector('.news-image')
                const title = el.querySelector('.news-title-stacked')
                const excerpt = el.querySelector('.news-excerpt-stacked')
                const openBtn = el.querySelector('.news-open-button')
                const dateDay = el.querySelector('.news-date-day')
                const dateMonth = el.querySelector('.news-date-month')
                if (data.thumb && imgEl) imgEl.style.backgroundImage = `url('${data.thumb}')`
                if (data.title && title) title.textContent = data.title
                if (data.excerpt && excerpt) excerpt.textContent = data.excerpt
                if (data.link) el.setAttribute('data-link', data.link)
                if (openBtn) openBtn.addEventListener('click', () => { if (data.link) window.open(data.link, '_blank') })
                if (data.date && dateDay && dateMonth) {
                    try {
                        const d = new Date(data.date)
                        if (!isNaN(d)) {
                            dateDay.textContent = d.getDate()
                            dateMonth.textContent = d.toLocaleString('default', { month: 'short' })
                        }
                    } catch (e) {}
                }
            } catch (e) { console.warn('renderCard: template wiring failed', e) }
            return el
        }
        // fallback minimal card
        const card = document.createElement('article')
        card.className = `news-card bento-small glass-global relative overflow-hidden p-4`
        const t = document.createElement('div')
        t.className = 'font-extrabold text-lg text-white'
        t.textContent = data.title || '(sans titre)'
        const ex = document.createElement('div')
        ex.className = 'text-white/80 mt-2 text-sm'
        ex.textContent = data.excerpt || ''
        const btn = document.createElement('button')
        btn.className = 'news-open-button glass-btn px-3 py-1 mt-3 font-semibold'
        btn.textContent = 'Voir'
        btn.addEventListener('click', () => { if (data.link) window.open(data.link, '_blank') })
        card.appendChild(t); card.appendChild(ex); card.appendChild(btn)
        return card
    }

    function clearGrid() {
        const grid = document.querySelector('.news-grid')
        if (grid) grid.innerHTML = ''
    }

    function showLoadingSkeletons(count = 6) {
        const grid = document.querySelector('.news-grid')
        if (!grid) return
        grid.innerHTML = ''
        for (let i = 0; i < count; i++) {
            const art = document.createElement('article')
            art.className = `news-card skeleton ${i===0? 'bento-large' : (i===1||i===2? 'bento-medium' : 'bento-small')}`
            art.innerHTML = `
                <div class="news-image"></div>
                <div class="news-overlay"></div>
                <div class="news-content" style="position:relative; z-index:2; padding:12px;">
                    <div class="skeleton-title"></div>
                    <div class="skeleton-line" style="width:80%"></div>
                    <div class="skeleton-sub"></div>
                </div>
            `
            grid.appendChild(art)
        }
    }

    function showGrid(items) {
        const grid = document.querySelector('.news-grid')
        if (!grid) return
        grid.innerHTML = ''
        if (!items || items.length === 0) {
            grid.innerHTML = '<div class="text-white/70 p-6">Aucune actualité trouvée.</div>'
            return
        }
        // assign bento sizes in a pleasant pattern: first large, then a couple medium, then small
        for (let i = 0; i < items.length; i++) {
            const it = items[i]
            try {
                let size = 'bento-small'
                if (i === 0) size = 'bento-large'
                else if (i === 1 || i === 2) size = 'bento-medium'
                else if (i % 7 === 0) size = 'bento-medium'
                const card = renderCard(it, size)
                if (card) grid.appendChild(card)
            } catch (e) { console.warn('showGrid item failed', e) }
        }
    }

    function showNewsMode() {
        try {
            const container = document.getElementById('newsContainer')
            const landing = document.getElementById('landingContainer')
            if (landing) landing.classList.add('in-news-mode')
            if (container) {
                container.style.display = 'block'
                container.classList.add('news-fullscreen')
            }
            const content = document.getElementById('newsContent')
            if (content) content.style.display = 'block'
            const closeBtn = document.getElementById('newsCloseButton')
            if (closeBtn) closeBtn.style.display = 'inline-flex'
        } catch (e) { console.warn('showNewsMode failed', e) }
    }

    function hideNewsMode() {
        try {
            const container = document.getElementById('newsContainer')
            const landing = document.getElementById('landingContainer')
            if (landing) landing.classList.remove('in-news-mode')
            if (container) {
                container.classList.remove('news-fullscreen')
                container.style.display = 'none'
            }
            const content = document.getElementById('newsContent')
            if (content) content.style.display = 'none'
            const closeBtn = document.getElementById('newsCloseButton')
            if (closeBtn) closeBtn.style.display = 'none'
            try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch (e) {}
        } catch (e) { console.warn('hideNewsMode failed', e) }
    }

    async function initNews() {
        try {
            const grid = document.querySelector('.news-grid')
            if (grid) showLoadingSkeletons(6)

            // Try to prefer the distribution-provided RSS url when available
            let url = DEFAULT_RSS
            try {
                if (typeof require === 'function') {
                    const DistroAPI = require('./distromanager').DistroAPI || (window && window.DistroAPI)
                    if (DistroAPI && typeof DistroAPI.getDistribution === 'function') {
                        try {
                            const dist = await DistroAPI.getDistribution()
                            if (dist && dist.rawDistribution && dist.rawDistribution.rss) url = dist.rawDistribution.rss
                        } catch (e) {}
                    }
                }
            } catch (e) {}

            const items = await fetchRSS(url)
            showGrid(items)
        } catch (e) {
            console.warn('initNews failed', e)
            const grid = document.querySelector('.news-grid')
            if (grid) grid.innerHTML = `<div class="text-white/70 p-6">Erreur lors du chargement des actualités: ${String(e && (e.message || e))}</div>`
        }
    }

    // Expose public API
    window.initNews = initNews
    window.showNewsMode = showNewsMode
    window.hideNewsMode = hideNewsMode

    // Wire UI and auto-init news. Use a setup function so it runs whether this
    // script is executed before or after DOMContentLoaded.
    function setupNewsUI() {
        try {
            const openBtn = document.getElementById('openNewsButton')
            if (openBtn) openBtn.addEventListener('click', () => { showNewsMode(); initNews() })

            const closeBtn = document.getElementById('newsCloseButton')
            if (closeBtn) closeBtn.addEventListener('click', () => { hideNewsMode() })

            const refreshBtn = document.querySelector('.refresh-news')
            if (refreshBtn) refreshBtn.addEventListener('click', async (e) => {
                try { refreshBtn.disabled = true; refreshBtn.classList.add('opacity-60') } catch (e) {}
                try { await initNews() } catch (e) { console.warn(e) }
                try { refreshBtn.disabled = false; refreshBtn.classList.remove('opacity-60') } catch (e) {}
            })

            const retryBtn = document.getElementById('newsErrorRetry')
            if (retryBtn) retryBtn.addEventListener('click', async () => { initNews() })

            // Keyboard navigation shortcuts
            document.addEventListener('keydown', (e) => {
                if (document.getElementById('landingContainer') && document.getElementById('landingContainer').classList.contains('in-news-mode')) {
                    if (e.key === 'Escape') hideNewsMode()
                }
            })

            // Auto-initialize news grid when present so the interface is visible
            try {
                const grid = document.querySelector('.news-grid')
                if (grid) initNews()
            } catch (e) { /* ignore init errors */ }

        } catch (e) { console.warn('news DOMContentLoaded wiring failed', e) }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupNewsUI)
    } else {
        // If DOM already ready, run immediately
        setupNewsUI()
    }

})();
