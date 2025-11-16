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

    // Open links in the external system browser when possible (Electron shell),
    // otherwise fall back to window.open. Keeps behaviour consistent across
    // renderer/main contexts.
    function openExternalLink(url) {
        if (!url) return
        try {
            if (typeof require === 'function') {
                const electron = require('electron')
                if (electron && electron.shell && typeof electron.shell.openExternal === 'function') {
                    electron.shell.openExternal(url)
                    return
                }
            }
        } catch (e) {
            // ignore and fallback
        }
        try { window.open(url, '_blank') } catch (e) {}
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
                
                // Set background image - FIX: Properly set as inline style
                if (imgEl) {
                    if (data.thumb) {
                        imgEl.style.backgroundImage = `url("${data.thumb}")`
                    } else {
                        // Default gradient if no image
                        imgEl.style.background = 'linear-gradient(135deg, rgb(75, 85, 99), rgb(55, 65, 81))'
                    }
                }
                
                // Set content
                if (data.title && title) title.textContent = data.title
                if (data.excerpt && excerpt) excerpt.textContent = data.excerpt
                if (data.link) el.setAttribute('data-link', data.link)
                
                // Add click handlers
                if (openBtn) {
                    openBtn.addEventListener('click', (e) => {
                        e.stopPropagation()
                        if (data.link) openExternalLink(data.link)
                    })
                }
                
                // Make entire card clickable
                el.addEventListener('click', () => {
                    if (data.link) openExternalLink(data.link)
                })
                
                // Add keyboard navigation
                el.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        if (data.link) openExternalLink(data.link)
                    }
                })
                
                // Set date
                if (data.date && dateDay && dateMonth) {
                    try {
                        const d = new Date(data.date)
                        if (!isNaN(d)) {
                            dateDay.textContent = d.getDate()
                            dateMonth.textContent = d.toLocaleString('fr-FR', { month: 'short' })
                        }
                    } catch (e) {
                        dateDay.textContent = '--'
                        dateMonth.textContent = '---'
                    }
                }
                
            } catch (e) { 
                console.warn('renderCard: template wiring failed', e) 
            }
            return el
        }
        
        // fallback minimal card with Tailwind classes
        const card = document.createElement('article')
        card.className = `news-card group relative overflow-hidden rounded-xl cursor-pointer transform transition-all duration-300 hover:scale-105 hover:shadow-2xl bg-gradient-to-br from-gray-900/40 to-gray-900/60 backdrop-blur-sm border border-white/10 p-6 ${sizeClass || 'bento-small'}`
        card.setAttribute('tabindex', '0')
        card.setAttribute('role', 'button')
        
        // Background gradient for fallback
        const bg = document.createElement('div')
        bg.className = 'absolute inset-0 bg-gradient-to-br from-gray-700 to-gray-800'
        card.appendChild(bg)
        
        // Overlay
        const overlay = document.createElement('div')
        overlay.className = 'absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent'
        card.appendChild(overlay)
        
        // Content container
        const content = document.createElement('div')
        content.className = 'relative z-10 h-full flex flex-col justify-end text-white'
        
        const title = document.createElement('h3')
        title.className = 'font-bold text-lg mb-2 group-hover:text-amber-400 transition-colors duration-200'
        title.textContent = data.title || '(sans titre)'
        
        const excerpt = document.createElement('p')
        excerpt.className = 'text-sm text-white/80 line-clamp-2 mb-3'
        excerpt.textContent = data.excerpt || ''
        
        const footer = document.createElement('div')
        footer.className = 'flex items-center justify-between pt-2 border-t border-white/10'
        
        const dateEl = document.createElement('div')
        dateEl.className = 'text-xs text-white/70'
        try {
            const d = new Date(data.date)
            if (!isNaN(d)) {
                dateEl.textContent = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
            } else {
                dateEl.textContent = 'Date inconnue'
            }
        } catch (e) {
            dateEl.textContent = 'Date inconnue'
        }
        
        const btn = document.createElement('button')
        btn.className = 'px-3 py-1 rounded-lg bg-amber-400/20 hover:bg-amber-400 text-amber-400 hover:text-gray-900 border border-amber-400/30 hover:border-amber-400 text-xs font-semibold transition-all duration-200'
        btn.textContent = 'Lire plus'
        
        footer.appendChild(dateEl)
        footer.appendChild(btn)
        
        content.appendChild(title)
        content.appendChild(excerpt)
        content.appendChild(footer)
        
        card.appendChild(content)
        
        // Add click handlers
        const openLink = () => {
            if (data.link) openExternalLink(data.link)
        }
        
        card.addEventListener('click', openLink)
        btn.addEventListener('click', (e) => {
            e.stopPropagation()
            openLink()
        })
        
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                openLink()
            }
        })
        
        return card
    }

    function renderFeaturedCard(data) {
        const tpl = document.getElementById('news-featured-template')
        if (tpl && tpl.content && tpl.content.firstElementChild) {
            const el = tpl.content.firstElementChild.cloneNode(true)
            try {
                const title = el.querySelector('.news-featured-title')
                const summary = el.querySelector('.news-featured-summary')
                const category = el.querySelector('.news-featured-category')
                
                // Set background image
                if (data.thumb) {
                    el.style.backgroundImage = `url("${data.thumb}")`
                } else {
                    el.style.background = 'linear-gradient(135deg, rgb(75, 85, 99), rgb(55, 65, 81))'
                }
                
                // Set content
                if (data.title && title) title.textContent = data.title
                if (data.excerpt && summary) {
                    summary.textContent = data.excerpt
                    summary.classList.remove('hidden')
                }
                if (category) category.textContent = 'Actualité'
                
                // Set link and make sure it opens externally
                if (data.link) {
                    try {
                        if (el.tagName === 'A') {
                            el.setAttribute('href', data.link)
                            el.setAttribute('target', '_blank')
                            el.setAttribute('rel', 'noopener noreferrer')
                            el.addEventListener('click', (ev) => { ev.preventDefault(); openExternalLink(data.link) })
                        } else {
                            el.setAttribute('data-link', data.link)
                            el.addEventListener('click', () => openExternalLink(data.link))
                        }
                    } catch (e) {}
                }

                // Add keyboard navigation
                el.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        if (data.link) openExternalLink(data.link)
                    }
                })
                
            } catch (e) { 
                console.warn('renderFeaturedCard: template wiring failed', e) 
            }
            return el
        }
        return null
    }

    function clearGrid() {
        const grid = document.querySelector('.news-grid')
        if (grid) grid.innerHTML = ''
    }

    function showLoadingSkeletons(count = 6) {
        const grid = document.querySelector('#newsGrid')
        if (!grid) return
        grid.innerHTML = ''
        
        for (let i = 0; i < count; i++) {
            const article = document.createElement('article')
            let sizeClass = 'bento-small'
            if (i === 0) sizeClass = 'bento-large'
            else if (i === 1 || i === 2) sizeClass = 'bento-medium'
            
            article.className = `news-card skeleton ${sizeClass} relative overflow-hidden rounded-xl bg-gray-800/30 backdrop-blur-sm border border-white/5`
            
            // Create skeleton content structure
            article.innerHTML = `
                <div class="absolute inset-0 bg-gradient-to-br from-gray-700/20 to-gray-800/20"></div>
                <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent"></div>
                <div class="relative z-10 h-full flex flex-col justify-end p-4 sm:p-6 space-y-2">
                    <div class="h-5 bg-white/10 rounded-md w-3/4 animate-pulse"></div>
                    <div class="h-4 bg-white/8 rounded-md w-full animate-pulse"></div>
                    <div class="h-4 bg-white/8 rounded-md w-2/3 animate-pulse"></div>
                    <div class="flex items-center justify-between pt-2 mt-2 border-t border-white/10">
                        <div class="h-3 bg-white/6 rounded w-16 animate-pulse"></div>
                        <div class="h-6 bg-amber-400/20 rounded-lg w-16 animate-pulse"></div>
                    </div>
                </div>
            `
            
            grid.appendChild(article)
        }
    }

    function clearGrid() {
        const grid = document.querySelector('#newsGrid')
        if (grid) grid.innerHTML = ''
    }

    function showGrid(items) {
        const grid = document.querySelector('#newsGrid')
        if (!grid) return
        
        grid.innerHTML = ''
        
        if (!items || items.length === 0) {
            // Show empty state with Tailwind classes
            const emptyState = document.createElement('div')
            emptyState.className = 'col-span-full flex flex-col items-center justify-center py-12 px-6 text-center'
            emptyState.innerHTML = `
                <div class="w-16 h-16 mb-4 rounded-full bg-gray-500/20 flex items-center justify-center">
                    <svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                    </svg>
                </div>
                <p class="text-white/70 text-lg">Aucune actualité trouvée</p>
                <p class="text-white/50 text-sm mt-2">Essayez de rafraîchir la page ou revenez plus tard</p>
            `
            grid.appendChild(emptyState)
            return
        }
        
        // Assign bento sizes in a pleasant pattern: first large, then a couple medium, then small
        for (let i = 0; i < items.length; i++) {
            const item = items[i]
            try {
                let size = 'bento-small'
                // Pattern: Large, Medium, Medium, Small, Small, Medium, Small, Small...
                if (i === 0) size = 'bento-large'
                else if (i === 1 || i === 2) size = 'bento-medium'
                else if (i === 5 || i === 8 || i === 11) size = 'bento-medium'
                else if (i % 10 === 0 && i > 0) size = 'bento-large'
                
                const card = renderCard(item, size)
                if (card) {
                    grid.appendChild(card)
                }
            } catch (e) { 
                console.warn('showGrid item failed', e) 
            }
        }
    }

    function showNewsMode() {
        try {
            const container = document.getElementById('newsContainer')
            const backdrop = document.getElementById('newsBackdrop')
            const landing = document.getElementById('landingContainer')
            
            if (landing) landing.classList.add('in-news-mode')
            
            if (backdrop) {
                backdrop.classList.remove('hidden')
                backdrop.classList.add('visible')
            }
            
            if (container) {
                container.classList.remove('hidden')
                container.style.display = 'block'
                container.classList.add('news-fullscreen')
            }
            
            const closeBtn = document.getElementById('newsCloseButton')
            if (closeBtn) closeBtn.classList.remove('hidden')
            
            // Initialize news if not already done
            const grid = document.querySelector('#newsGrid')
            if (grid && grid.children.length === 0) {
                initNews()
            }
            
        } catch (e) { 
            console.warn('showNewsMode failed', e) 
        }
    }

    function hideNewsMode() {
        try {
            const container = document.getElementById('newsContainer')
            const backdrop = document.getElementById('newsBackdrop')
            const landing = document.getElementById('landingContainer')
            
            if (landing) landing.classList.remove('in-news-mode')
            
            if (backdrop) {
                backdrop.classList.remove('visible')
                backdrop.classList.add('hidden')
            }
            
            if (container) {
                container.classList.remove('news-fullscreen')
                container.classList.add('hidden')
                container.style.display = 'none'
            }
            
            const content = document.getElementById('newsContent')
            if (content) content.classList.add('hidden')
            
            const closeBtn = document.getElementById('newsCloseButton')
            if (closeBtn) closeBtn.classList.add('hidden')
            
            try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch (e) {}
            
        } catch (e) { 
            console.warn('hideNewsMode failed', e) 
        }
    }

    async function initNews() {
        try {
            const grid = document.querySelector('#newsGrid')
            const errorContainer = document.getElementById('newsErrorContainer')
            const loadingState = document.getElementById('newsErrorLoading')
            const failedState = document.getElementById('newsErrorFailed')
            const noneState = document.getElementById('newsErrorNone')
            const newsContent = document.getElementById('newsContent')
            
            // Show loading state
            if (errorContainer) {
                errorContainer.classList.remove('hidden')
                if (loadingState) loadingState.classList.remove('hidden')
                if (failedState) failedState.classList.add('hidden')
                if (noneState) noneState.classList.add('hidden')
            }
            
            // Hide content during loading
            if (newsContent) newsContent.classList.add('hidden')
            
            if (grid) {
                showLoadingSkeletons(6)
            }

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
            
            // Hide loading and show content
            if (errorContainer) errorContainer.classList.add('hidden')
            if (newsContent) newsContent.classList.remove('hidden')
            
            if (grid) {
                showGrid(items)
            }
            
            // If no items, show no content state
            if (!items || items.length === 0) {
                if (newsContent) newsContent.classList.add('hidden')
                if (errorContainer) {
                    errorContainer.classList.remove('hidden')
                    if (noneState) noneState.classList.remove('hidden')
                    if (loadingState) loadingState.classList.add('hidden')
                    if (failedState) failedState.classList.add('hidden')
                }
            }
            
        } catch (e) {
            console.warn('initNews failed', e)
            
            // Show error state
            const errorContainer = document.getElementById('newsErrorContainer')
            const loadingState = document.getElementById('newsErrorLoading')
            const failedState = document.getElementById('newsErrorFailed')
            const noneState = document.getElementById('newsErrorNone')
            const newsContent = document.getElementById('newsContent')
            
            if (newsContent) newsContent.classList.add('hidden')
            
            if (errorContainer) {
                errorContainer.classList.remove('hidden')
                if (failedState) failedState.classList.remove('hidden')
                if (loadingState) loadingState.classList.add('hidden')
                if (noneState) noneState.classList.add('hidden')
            }
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
                try { 
                    refreshBtn.disabled = true
                    refreshBtn.classList.add('opacity-60')
                    // Add rotation animation
                    const icon = refreshBtn.querySelector('svg')
                    if (icon) icon.style.animation = 'rotate 0.5s ease-in-out'
                } catch (e) {}
                
                try { 
                    await initNews() 
                } catch (e) { 
                    console.warn(e) 
                }
                
                try { 
                    refreshBtn.disabled = false
                    refreshBtn.classList.remove('opacity-60')
                    // Remove rotation animation
                    const icon = refreshBtn.querySelector('svg')
                    if (icon) icon.style.animation = ''
                } catch (e) {}
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
                const grid = document.querySelector('#newsGrid')
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
