const { DistributionAPI } = require("helios-core/common");

const ConfigManager = require("./configmanager");
const https = require('https')
const { URL } = require('url')

// Old WesterosCraft url.
// exports.REMOTE_DISTRO_URL = 'http://mc.westeroscraft.com/WesterosCraftLauncher/distribution.json'
exports.REMOTE_DISTRO_URL = 'https://multigames-studio.fr/distribution.json'

const api = new DistributionAPI(
  ConfigManager.getLauncherDirectory(),
  null, // Injected forcefully by the preloader.
  null, // Injected forcefully by the preloader.
  exports.REMOTE_DISTRO_URL,
  false
);

/**
 * Check whether the remote distro URL is reachable (quick HEAD request).
 * Returns true if reachable, false otherwise.
 */
async function isOnline(timeout = 3000){
  return new Promise((resolve) => {
    try{
      const url = new URL(exports.REMOTE_DISTRO_URL)
      const options = {
        method: 'HEAD',
        hostname: url.hostname,
        path: url.pathname + (url.search || ''),
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        timeout: timeout
      }

      const req = https.request(options, (res) => {
        // Any 2xx/3xx/4xx/5xx is considered reachable; we only care about network connectivity
        resolve(true)
      })

      req.on('error', () => resolve(false))
      req.on('timeout', () => { try{ req.destroy() }catch(e){}; resolve(false) })
      req.end()
    } catch(e){
      resolve(false)
    }
  })
}

/**
 * Force a distro refresh if online; otherwise return cached/local distribution.
 * Exposed on the DistroAPI instance so callers can use it instead of getDistribution().
 */
api.forceRefreshIfOnline = async function(){
  const online = await isOnline()
  if(online){
    // Try to refresh from remote; fall back to cached copy if refresh fails.
    if(typeof api.refreshDistributionOrFallback === 'function'){
      return api.refreshDistributionOrFallback()
    }
    // If the DistributionAPI does not expose refreshDistributionOrFallback, try refreshDistribution
    if(typeof api.refreshDistribution === 'function'){
      try{
        await api.refreshDistribution()
        return api.getDistribution()
      }catch(e){
        return api.getDistribution()
      }
    }
  }

  // Offline or refresh not available -> return cached distribution
  return api.getDistribution()
}

exports.DistroAPI = api;
