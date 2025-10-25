// init-news-stub.js
// Provide a no-op initNews stub early so modules that run before the full implementation
// don't fail. The real implementation in landing.js or landing-inline.js will overwrite this.
(function(){
    try {
        if (typeof window !== 'undefined' && typeof window.initNews !== 'function') {
            window.initNews = async function() {
                // stub: no-op
                return Promise.resolve()
            }
            // mark stub for debugging
            window.__initNews_stub__ = true
            console.debug('[INIT-STUB] initNews stub installed')
        }
    } catch (e) {
        // ignore
    }
})();
