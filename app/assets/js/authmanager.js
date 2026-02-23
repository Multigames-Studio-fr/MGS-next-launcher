/**
 * AuthManager
 * 
 * This module aims to abstract login procedures. Results from Mojang's REST api
 * are retrieved through our Mojang module. These results are processed and stored,
 * if applicable, in the config using the ConfigManager. All login procedures should
 * be made through this module.
 * 
 * @module authmanager
 */
// Requirements
const ConfigManager          = require('./configmanager')
let LoggerUtil
try {
    if (typeof LoggerUtil === 'undefined' || !LoggerUtil) {
        const _hc = require('helios-core')
        LoggerUtil = _hc && _hc.LoggerUtil
    }
} catch (e) {
    // ignore - may be provided globally
}
const { RestResponseStatus } = require('helios-core/common')
const { MojangRestAPI, mojangErrorDisplayable, MojangErrorCode } = require('helios-core/mojang')
const { MicrosoftAuth, microsoftErrorDisplayable, MicrosoftErrorCode } = require('helios-core/microsoft')

// Defensive wrapper: some versions of helios-core may not export
// `microsoftErrorDisplayable` as a function (or it may be undefined).
// Provide a safe fallback that returns a simple error-like object with
// a `microsoftErrorCode` property and a readable message so callers
// can continue to handle errors without throwing TypeError.
function makeMicrosoftDisplayable(code) {
    try {
        if (typeof microsoftErrorDisplayable === 'function') {
            return microsoftErrorDisplayable(code)
        }
    } catch (e) {
        // ignore and fallback
    }
    // Fallback object structure expected by callers in this module.
    // Provide `title` and `desc` so UI code that expects a displayable
    // error (with .title and .desc) can show a meaningful message.
    const msgStr = typeof code === 'string' ? code : String(code || 'Microsoft error')
    return {
        microsoftErrorCode: code,
        title: 'Microsoft Login Error',
        desc: msgStr,
        message: msgStr
    }
}
const { AZURE_CLIENT_ID }    = require('./ipcconstants')

const log = (LoggerUtil && typeof LoggerUtil.getLogger === 'function') ? LoggerUtil.getLogger('AuthManager') : console

// Functions

/**
 * Add a Mojang account. This will authenticate the given credentials with Mojang's
 * authserver. The resultant data will be stored as an auth account in the
 * configuration database.
 * 
 * @param {string} username The account username (email if migrated).
 * @param {string} password The account password.
 * @returns {Promise.<Object>} Promise which resolves the resolved authenticated account object.
 */
exports.addMojangAccount = async function(username, password) {
    try {
        const response = await MojangRestAPI.authenticate(username, password, ConfigManager.getClientToken())
        console.log(response)
        if(response.responseStatus === RestResponseStatus.SUCCESS) {

            const session = response.data
            if(session.selectedProfile != null){
                const ret = ConfigManager.addMojangAuthAccount(session.selectedProfile.id, session.accessToken, username, session.selectedProfile.name)
                if(ConfigManager.getClientToken() == null){
                    ConfigManager.setClientToken(session.clientToken)
                }
                ConfigManager.save()
                return ret
            } else {
                return Promise.reject(mojangErrorDisplayable(MojangErrorCode.ERROR_NOT_PAID))
            }

        } else {
            return Promise.reject(mojangErrorDisplayable(response.mojangErrorCode))
        }
        
    } catch (err){
        log.error(err)
        return Promise.reject(mojangErrorDisplayable(MojangErrorCode.UNKNOWN))
    }
}

const AUTH_MODE = { FULL: 0, MS_REFRESH: 1, MC_REFRESH: 2 }

/**
 * Perform the full MS Auth flow in a given mode.
 * 
 * AUTH_MODE.FULL = Full authorization for a new account.
 * AUTH_MODE.MS_REFRESH = Full refresh authorization.
 * AUTH_MODE.MC_REFRESH = Refresh of the MC token, reusing the MS token.
 * 
 * @param {string} entryCode FULL-AuthCode. MS_REFRESH=refreshToken, MC_REFRESH=accessToken
 * @param {*} authMode The auth mode.
 * @returns An object with all auth data. AccessToken object will be null when mode is MC_REFRESH.
 */
async function fullMicrosoftAuthFlow(entryCode, authMode) {
    try {

        let accessTokenRaw
        let accessToken
        if(authMode !== AUTH_MODE.MC_REFRESH) {
            const accessTokenResponse = await MicrosoftAuth.getAccessToken(entryCode, authMode === AUTH_MODE.MS_REFRESH, AZURE_CLIENT_ID)
            if(accessTokenResponse.responseStatus === RestResponseStatus.ERROR) {
                return Promise.reject(makeMicrosoftDisplayable(accessTokenResponse.microsoftErrorCode))
            }
            accessToken = accessTokenResponse.data
            accessTokenRaw = accessToken.access_token
        } else {
            accessTokenRaw = entryCode
        }
        
        const xblResponse = await MicrosoftAuth.getXBLToken(accessTokenRaw)
        if(xblResponse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(makeMicrosoftDisplayable(xblResponse.microsoftErrorCode))
        }
        const xstsResonse = await MicrosoftAuth.getXSTSToken(xblResponse.data)
        if(xstsResonse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(makeMicrosoftDisplayable(xstsResonse.microsoftErrorCode))
        }
        const mcTokenResponse = await MicrosoftAuth.getMCAccessToken(xstsResonse.data)
        if(mcTokenResponse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(makeMicrosoftDisplayable(mcTokenResponse.microsoftErrorCode))
        }

        // Some versions of the underlying Microsoft library (or the HTTP client it uses)
        // may throw an HTTPError for non-2xx responses (for example a 404 from
        // https://api.minecraftservices.com/minecraft/profile). In that case we want
        // to convert a 404/NOT_FOUND into a user-friendly "no minecraft profile" error
        // instead of letting the thrown error bubble to the outer catch and become
        // an UNKNOWN error. Wrap the call to getMCProfile and map 404/NOT_FOUND.
        let mcProfileResponse
        try {
            mcProfileResponse = await MicrosoftAuth.getMCProfile(mcTokenResponse.data.access_token)
        } catch (err) {
            // Try to detect a 404 NOT_FOUND response from common error shapes
            const status = err && (err.statusCode || (err.response && err.response.statusCode))
            const body = err && ((err.response && err.response.body) || err.body) || {}
            if (status === 404 || (body && (body.error === 'NOT_FOUND' || (body.errorMessage && String(body.errorMessage).toLowerCase().includes('not found'))))) {
                return Promise.reject({
                    microsoftErrorCode: 'NO_MINECRAFT_PROFILE',
                    title: 'No Minecraft profile',
                    desc: 'This Microsoft account does not have an associated Minecraft profile (it may not own Minecraft). Please verify the account owns Minecraft or use a different account.',
                    message: 'No Minecraft profile'
                })
            }
            // rethrow unknown errors so the outer catch will handle them
            throw err
        }

        if(mcProfileResponse.responseStatus === RestResponseStatus.ERROR) {
            // Some Microsoft responses (e.g. when the account does not own Minecraft)
            // return a 404 / NOT_FOUND from the Minecraft services endpoint.
            // Detect that case and return a user-friendly displayable error so
            // the UI can show a helpful message instead of a numeric code.
            const body = mcProfileResponse.data || mcProfileResponse.error || {}
            if (body && (body.error === 'NOT_FOUND' || (body.errorMessage && String(body.errorMessage).toLowerCase().includes('not found')))) {
                return Promise.reject({
                    microsoftErrorCode: 'NO_MINECRAFT_PROFILE',
                    title: 'No Minecraft profile',
                    desc: 'This Microsoft account does not have an associated Minecraft profile (it may not own Minecraft). Please verify the account owns Minecraft or use a different account.',
                    message: 'No Minecraft profile'
                })
            }

            return Promise.reject(makeMicrosoftDisplayable(mcProfileResponse.microsoftErrorCode))
        }
        return {
            accessToken,
            accessTokenRaw,
            xbl: xblResponse.data,
            xsts: xstsResonse.data,
            mcToken: mcTokenResponse.data,
            mcProfile: mcProfileResponse.data
        }
    } catch(err) {
        log.error(err)
    return Promise.reject(makeMicrosoftDisplayable(MicrosoftErrorCode.UNKNOWN))
    }
}

/**
 * Calculate the expiry date. Set token expiration to 1 year to avoid frequent disconnections.
 * 
 * @param {number} nowMs Current time milliseconds.
 * @param {number} epiresInS Expires in (seconds) - ignored, using 1 year instead
 * @returns 
 */
function calculateExpiryDate(nowMs, epiresInS) {
    // Fixer l'expiration à 1 an pour éviter les déconnexions fréquentes
    // Set a very long expiry (100 years) so tokens effectively don't expire
    const oneYearInMs = 365 * 24 * 60 * 60 * 1000 // 1 an en millisecondes
    const oneHundredYearsMs = oneYearInMs * 100
    return nowMs + oneHundredYearsMs
}

/**
 * Non-transient error codes that should NOT be retried.
 * These represent permanent failures (invalid credentials, account issues, etc.)
 */
const NON_TRANSIENT_ERROR_CODES = new Set([
    'INVALID_GRANT',
    'INVALID_CLIENT',
    'UNAUTHORIZED_CLIENT',
    'ACCESS_DENIED',
    'EXPIRED_TOKEN',
    'INVALID_SCOPE',
    'NO_MINECRAFT_PROFILE',
    'MISSING_ENTITLEMENT',
    'MISSING_ACCOUNT',
    'BANNED_ACCOUNT'
])

/**
 * Check if an error is non-transient (should not be retried)
 * @param {Error|object} err The error to check
 * @returns {boolean} True if the error should not be retried
 */
function isNonTransientError(err) {
    if (!err) return false
    // Check microsoftErrorCode
    if (err.microsoftErrorCode && NON_TRANSIENT_ERROR_CODES.has(String(err.microsoftErrorCode).toUpperCase())) {
        return true
    }
    // Check error property (OAuth error responses)
    if (err.error && NON_TRANSIENT_ERROR_CODES.has(String(err.error).toUpperCase())) {
        return true
    }
    // Check message for common permanent failure patterns
    const msg = (err.message || '').toLowerCase()
    if (msg.includes('invalid_grant') || msg.includes('expired_token') || 
        msg.includes('unauthorized_client') || msg.includes('invalid_client')) {
        return true
    }
    return false
}

/**
 * Retry helper with exponential backoff for transient failures.
 * Retries only when the wrapped function throws (network/IO).
 * Does NOT retry for non-transient errors (auth failures, invalid tokens).
 *
 * @param {function(): Promise<any>} fn Async function to call
 * @param {number} attempts Number of attempts (default 3)
 * @param {number} delayMs Initial delay in ms (default 1000)
 */
async function retryAsync(fn, attempts = 3, delayMs = 1000) {
    let lastErr
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn()
        } catch (err) {
            lastErr = err
            log.warn(`Retry ${i+1}/${attempts} failed`, err && err.message ? err.message : err)
            
            // Don't retry non-transient errors - fail immediately
            if (isNonTransientError(err)) {
                log.info('Non-transient error detected, skipping retries')
                throw err
            }
            
            if (i < attempts - 1) {
                const wait = delayMs * Math.pow(2, i)
                log.debug(`Waiting ${wait}ms before retry...`)
                await new Promise(r => setTimeout(r, wait))
            }
        }
    }
    throw lastErr
}

/**
 * Add a Microsoft account. This will pass the provided auth code to Mojang's OAuth2.0 flow.
 * The resultant data will be stored as an auth account in the configuration database.
 * 
 * @param {string} authCode The authCode obtained from microsoft.
 * @returns {Promise.<Object>} Promise which resolves the resolved authenticated account object.
 */
exports.addMicrosoftAccount = async function(authCode) {

    const fullAuth = await fullMicrosoftAuthFlow(authCode, AUTH_MODE.FULL)

    // Advance expiry by 10 seconds to avoid close calls.
    const now = new Date().getTime()

    const ret = ConfigManager.addMicrosoftAuthAccount(
        fullAuth.mcProfile.id,
        fullAuth.mcToken.access_token,
        fullAuth.mcProfile.name,
        calculateExpiryDate(now, fullAuth.mcToken.expires_in),
        fullAuth.accessToken.access_token,
        fullAuth.accessToken.refresh_token,
        calculateExpiryDate(now, fullAuth.accessToken.expires_in)
    )
    ConfigManager.save()

    return ret
}

/**
 * Remove a Mojang account. This will invalidate the access token associated
 * with the account and then remove it from the database.
 * 
 * @param {string} uuid The UUID of the account to be removed.
 * @returns {Promise.<void>} Promise which resolves to void when the action is complete.
 */
exports.removeMojangAccount = async function(uuid){
    try {
        const authAcc = ConfigManager.getAuthAccount(uuid)
        const response = await MojangRestAPI.invalidate(authAcc.accessToken, ConfigManager.getClientToken())
        if(response.responseStatus === RestResponseStatus.SUCCESS) {
            ConfigManager.removeAuthAccount(uuid)
            ConfigManager.save()
            return Promise.resolve()
        } else {
            log.error('Error while removing account', response.error)
            return Promise.reject(response.error)
        }
    } catch (err){
        log.error('Error while removing account', err)
        return Promise.reject(err)
    }
}

/**
 * Remove a Microsoft account. It is expected that the caller will invoke the OAuth logout
 * through the ipc renderer.
 * 
 * @param {string} uuid The UUID of the account to be removed.
 * @returns {Promise.<void>} Promise which resolves to void when the action is complete.
 */
exports.removeMicrosoftAccount = async function(uuid){
    try {
        ConfigManager.removeAuthAccount(uuid)
        ConfigManager.save()
        return Promise.resolve()
    } catch (err){
        log.error('Error while removing account', err)
        return Promise.reject(err)
    }
}

/**
 * Validate the selected account with Mojang's authserver. If the account is not valid,
 * we will attempt to refresh the access token and update that value. If that fails, a
 * new login will be required.
 * 
 * @returns {Promise.<boolean>} Promise which resolves to true if the access token is valid,
 * otherwise false.
 */
async function validateSelectedMojangAccount(){
    const current = ConfigManager.getSelectedAccount()
    const response = await MojangRestAPI.validate(current.accessToken, ConfigManager.getClientToken())

    if(response.responseStatus === RestResponseStatus.SUCCESS) {
        const isValid = response.data
        if(!isValid){
            try {
                const refreshResponse = await retryAsync(() => MojangRestAPI.refresh(current.accessToken, ConfigManager.getClientToken()), 3, 1000)
                if(refreshResponse.responseStatus === RestResponseStatus.SUCCESS) {
                    const session = refreshResponse.data
                    ConfigManager.updateMojangAuthAccount(current.uuid, session.accessToken)
                    ConfigManager.save()
                } else {
                    log.error('Error while validating selected profile:', refreshResponse.error)
                    log.info('Account access token is invalid.')
                    return false
                }
            } catch (err) {
                log.warn('Mojang refresh failed after retries', err)
                // treat as transient failure; return false to let UI handle (it may re-add account)
                return false
            }
            log.info('Account access token validated.')
            return true
        } else {
            log.info('Account access token validated.')
            return true
        }
    }
    
}

/**
 * Validate the selected account with Microsoft's authserver. If the account is not valid,
 * we will attempt to refresh the access token and update that value. If that fails, a
 * new login will be required.
 * 
 * @returns {Promise.<boolean>} Promise which resolves to true if the access token is valid,
 * otherwise false.
 */
async function validateSelectedMicrosoftAccount(){
    const current = ConfigManager.getSelectedAccount()
    
    // Safety check: ensure account data is valid
    if (!current) {
        log.warn('No account selected for validation')
        return false
    }
    
    if (!current.microsoft) {
        log.warn('Selected account is missing Microsoft auth data')
        return false
    }
    
    if (!current.microsoft.refresh_token) {
        log.warn('Selected account is missing refresh token - re-login required')
        return false
    }
    
    const now = new Date().getTime()
    const mcExpiresAt = current.expiresAt || 0
    const msExpiresAt = current.microsoft.expires_at || 0
    
    // Add buffer time (5 minutes) to avoid edge cases
    const EXPIRY_BUFFER_MS = 5 * 60 * 1000
    const mcExpired = now >= (mcExpiresAt - EXPIRY_BUFFER_MS)
    const msExpired = now >= (msExpiresAt - EXPIRY_BUFFER_MS)
    
    log.debug(`Token validation: MC expired=${mcExpired}, MS expired=${msExpired}`)

    if(!mcExpired) {
        log.debug('MC token still valid, no refresh needed')
        return true
    }

    // MC token expired. Check MS token.
    if(msExpired) {
        // MS expired, do full refresh using refresh_token.
        log.info('Both MS and MC tokens expired, performing full refresh')
        try {
            const refreshToken = current.microsoft.refresh_token
            if (!refreshToken || refreshToken.trim() === '') {
                log.warn('Refresh token is empty or invalid')
                return false
            }
            
            const res = await retryAsync(() => fullMicrosoftAuthFlow(refreshToken, AUTH_MODE.MS_REFRESH), 3, 2000)
            
            // Validate response before updating
            if (!res || !res.mcToken || !res.accessToken) {
                log.warn('Invalid response from MS refresh flow')
                return false
            }

            ConfigManager.updateMicrosoftAuthAccount(
                current.uuid,
                res.mcToken.access_token,
                res.accessToken.access_token,
                res.accessToken.refresh_token,
                calculateExpiryDate(now, res.accessToken.expires_in),
                calculateExpiryDate(now, res.mcToken.expires_in)
            )
            ConfigManager.save()
            log.info('Successfully refreshed MS and MC tokens')
            return true
        } catch(err) {
            log.warn('MS full refresh failed after retries:', err && err.message)
            
            // Classify the error
            if (isNonTransientError(err)) {
                log.warn('Non-transient error - user must re-authenticate')
                // Don't remove account, but mark that re-login is required
                return false
            }
            
            // For transient errors (network, timeout), keep account and allow retry later
            const errorCode = err && err.microsoftErrorCode
            if (errorCode) {
                log.warn('Microsoft error code:', errorCode)
            }
            log.info('Transient error detected, keeping account for retry')
            return false
        }
    } else {
        // Only MC expired, use existing MS access token.
        log.info('MC token expired but MS token valid, refreshing MC token only')
        try {
            const msAccessToken = current.microsoft.access_token
            if (!msAccessToken || msAccessToken.trim() === '') {
                log.warn('MS access token is empty, falling back to full refresh')
                // Try full refresh instead
                return await validateSelectedMicrosoftAccount_fullRefresh(current, now)
            }
            
            const res = await retryAsync(() => fullMicrosoftAuthFlow(msAccessToken, AUTH_MODE.MC_REFRESH), 3, 1500)
            
            // Validate response
            if (!res || !res.mcToken) {
                log.warn('Invalid response from MC refresh flow')
                return false
            }

            ConfigManager.updateMicrosoftAuthAccount(
                current.uuid,
                res.mcToken.access_token,
                current.microsoft.access_token,
                current.microsoft.refresh_token,
                current.microsoft.expires_at,
                calculateExpiryDate(now, res.mcToken.expires_in)
            )
            ConfigManager.save()
            log.info('Successfully refreshed MC token')
            return true
        }
        catch(err) {
            log.warn('MC refresh failed after retries:', err && err.message)
            
            // If MC refresh fails with MS token, try full refresh as fallback
            log.info('Attempting full refresh as fallback...')
            try {
                return await validateSelectedMicrosoftAccount_fullRefresh(current, now)
            } catch (fallbackErr) {
                log.warn('Full refresh fallback also failed:', fallbackErr && fallbackErr.message)
                if (isNonTransientError(fallbackErr)) {
                    return false
                }
                log.info('Transient error detected, keeping account for retry')
                return false
            }
        }
    }
}

/**
 * Helper for full refresh when MC-only refresh fails
 */
async function validateSelectedMicrosoftAccount_fullRefresh(current, now) {
    const refreshToken = current.microsoft.refresh_token
    if (!refreshToken) {
        log.warn('No refresh token available for full refresh fallback')
        return false
    }
    
    const res = await retryAsync(() => fullMicrosoftAuthFlow(refreshToken, AUTH_MODE.MS_REFRESH), 2, 2000)
    
    if (!res || !res.mcToken || !res.accessToken) {
        log.warn('Invalid response from full refresh fallback')
        return false
    }
    
    ConfigManager.updateMicrosoftAuthAccount(
        current.uuid,
        res.mcToken.access_token,
        res.accessToken.access_token,
        res.accessToken.refresh_token,
        calculateExpiryDate(now, res.accessToken.expires_in),
        calculateExpiryDate(now, res.mcToken.expires_in)
    )
    ConfigManager.save()
    log.info('Successfully performed full refresh fallback')
    return true
}

/**
 * Validate the selected auth account.
 * 
 * @returns {Promise.<boolean>} Promise which resolves to true if the access token is valid,
 * otherwise false.
 */
exports.validateSelected = async function(){
    const current = ConfigManager.getSelectedAccount()
    
    // Safety check
    if (!current) {
        log.warn('No account selected for validation')
        return false
    }

    if(current.type === 'microsoft') {
        return await validateSelectedMicrosoftAccount()
    } else {
        return await validateSelectedMojangAccount()
    }
}

/**
 * Check if the selected account needs refresh (tokens near expiry).
 * This is a lighter check than full validation.
 * 
 * @returns {boolean} True if tokens need refresh soon
 */
exports.needsRefresh = function() {
    const current = ConfigManager.getSelectedAccount()
    if (!current) return false
    
    const now = Date.now()
    const BUFFER_MS = 10 * 60 * 1000 // 10 minutes buffer
    
    if (current.type === 'microsoft') {
        const mcExpiresAt = current.expiresAt || 0
        return now >= (mcExpiresAt - BUFFER_MS)
    }
    
    return false
}

/**
 * Get account status without attempting refresh
 * 
 * @returns {object} Status object with isValid, needsRefresh, and error info
 */
exports.getAccountStatus = function() {
    const current = ConfigManager.getSelectedAccount()
    
    if (!current) {
        return { isValid: false, needsRefresh: false, error: 'NO_ACCOUNT_SELECTED' }
    }
    
    if (!current.uuid || !current.type) {
        return { isValid: false, needsRefresh: false, error: 'CORRUPTED_ACCOUNT_DATA' }
    }
    
    const now = Date.now()
    
    if (current.type === 'microsoft') {
        if (!current.microsoft || !current.microsoft.refresh_token) {
            return { isValid: false, needsRefresh: false, error: 'MISSING_REFRESH_TOKEN' }
        }
        
        const mcExpiresAt = current.expiresAt || 0
        const msExpiresAt = current.microsoft.expires_at || 0
        const BUFFER_MS = 5 * 60 * 1000
        
        const mcExpired = now >= (mcExpiresAt - BUFFER_MS)
        const msExpired = now >= (msExpiresAt - BUFFER_MS)
        
        return {
            isValid: !mcExpired,
            needsRefresh: mcExpired,
            needsFullRefresh: msExpired,
            error: null,
            uuid: current.uuid,
            displayName: current.displayName
        }
    }
    
    // Mojang account - assume valid if present (legacy)
    return {
        isValid: true,
        needsRefresh: false,
        error: null,
        uuid: current.uuid,
        displayName: current.displayName
    }
}

/**
 * Force refresh the Minecraft token before launching the game.
 * This ensures we always have a fresh, valid token for Minecraft servers.
 * Unlike validateSelected(), this ALWAYS refreshes the MC token regardless of expiry.
 * 
 * @returns {Promise.<boolean>} True if refresh succeeded, false otherwise
 */
exports.forceRefreshBeforeLaunch = async function() {
    const current = ConfigManager.getSelectedAccount()
    
    if (!current) {
        log.warn('No account selected for pre-launch refresh')
        return false
    }
    
    if (current.type !== 'microsoft') {
        // Mojang accounts don't need refresh - validate normally
        return await exports.validateSelected()
    }
    
    // For Microsoft accounts, always do a full refresh to ensure valid MC token
    log.info('Force refreshing MC token before launch for account:', current.displayName)
    
    const now = Date.now()
    
    // Check if we have a valid refresh token
    if (!current.microsoft || !current.microsoft.refresh_token) {
        log.error('Cannot refresh: missing refresh token')
        return false
    }
    
    try {
        // Always use the refresh token to get fresh tokens
        const res = await retryAsync(
            () => fullMicrosoftAuthFlow(current.microsoft.refresh_token, AUTH_MODE.MS_REFRESH), 
            3, 
            2000
        )
        
        if (!res || !res.mcToken || !res.accessToken) {
            log.error('Invalid response from MS refresh flow')
            return false
        }
        
        // Update account with fresh tokens
        ConfigManager.updateMicrosoftAuthAccount(
            current.uuid,
            res.mcToken.access_token,
            res.accessToken.access_token,
            res.accessToken.refresh_token,
            calculateExpiryDate(now, res.accessToken.expires_in),
            calculateExpiryDate(now, res.mcToken.expires_in)
        )
        ConfigManager.save()
        
        log.info('Successfully refreshed tokens before launch')
        return true
        
    } catch (err) {
        log.error('Failed to refresh tokens before launch:', err && err.message)
        
        // If refresh failed, check if current token might still work
        // (within a generous buffer)
        const mcExpiresAt = current.expiresAt || 0
        const tokenAgeMs = now - (current.lastUpdated || 0)
        const TOKEN_STALE_THRESHOLD = 30 * 60 * 1000 // 30 minutes
        
        if (now < mcExpiresAt && tokenAgeMs < TOKEN_STALE_THRESHOLD) {
            log.warn('Refresh failed but current token appears recent, proceeding with existing token')
            return true
        }
        
        return false
    }
}

// Export utility function for other modules
exports.isNonTransientError = isNonTransientError