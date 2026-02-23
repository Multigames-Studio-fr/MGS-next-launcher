/**
 * Microsoft Auth helper module
 * Extracted from authmanager to centralize Microsoft auth flow.
 */
const { RestResponseStatus } = require('helios-core/common')
const { MicrosoftAuth, microsoftErrorDisplayable, MicrosoftErrorCode } = require('helios-core/microsoft')
const { AZURE_CLIENT_ID } = require('./ipcconstants')
const _LoggerUtil = (typeof window !== 'undefined' && window.LoggerUtil) || (function(){
    try { const _hc = require('helios-core'); if(_hc && _hc.LoggerUtil){ if(typeof window !== 'undefined') window.LoggerUtil = _hc.LoggerUtil; return _hc.LoggerUtil } } catch(e) {}
    return null
})()

const log = (_LoggerUtil && typeof _LoggerUtil.getLogger === 'function') ? _LoggerUtil.getLogger('MSAuth') : console

function makeMicrosoftDisplayable(code) {
    try {
        if (typeof microsoftErrorDisplayable === 'function') {
            return microsoftErrorDisplayable(code)
        }
    } catch (e) {
        // ignore and fallback
    }
    const msgStr = typeof code === 'string' ? code : String(code || 'Microsoft error')
    return {
        microsoftErrorCode: code,
        title: 'Microsoft Login Error',
        desc: msgStr,
        message: msgStr
    }
}

/**
 * Calculate expiry date helper
 */
function calculateExpiryDate(nowMs, expiresInS) {
    if (typeof expiresInS === 'number' && expiresInS > 0) {
        return nowMs + (expiresInS * 1000)
    }
    // fallback 2 years (730 days)
    return nowMs + (730 * 24 * 60 * 60 * 1000)
}

const AUTH_MODE = { FULL: 0, MS_REFRESH: 1, MC_REFRESH: 2 }

async function fullMicrosoftAuthFlow(entryCode, authMode) {
    try {
        let accessTokenRaw
        let accessToken
        if (authMode !== AUTH_MODE.MC_REFRESH) {
            const accessTokenResponse = await MicrosoftAuth.getAccessToken(entryCode, authMode === AUTH_MODE.MS_REFRESH, AZURE_CLIENT_ID)
            if (accessTokenResponse.responseStatus === RestResponseStatus.ERROR) {
                return Promise.reject(makeMicrosoftDisplayable(accessTokenResponse.microsoftErrorCode))
            }
            accessToken = accessTokenResponse.data
            accessTokenRaw = accessToken.access_token
        } else {
            accessTokenRaw = entryCode
        }

        const xblResponse = await MicrosoftAuth.getXBLToken(accessTokenRaw)
        if (xblResponse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(makeMicrosoftDisplayable(xblResponse.microsoftErrorCode))
        }
        const xstsResonse = await MicrosoftAuth.getXSTSToken(xblResponse.data)
        if (xstsResonse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(makeMicrosoftDisplayable(xstsResonse.microsoftErrorCode))
        }
        const mcTokenResponse = await MicrosoftAuth.getMCAccessToken(xstsResonse.data)
        if (mcTokenResponse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(makeMicrosoftDisplayable(mcTokenResponse.microsoftErrorCode))
        }

        let mcProfileResponse
        try {
            mcProfileResponse = await MicrosoftAuth.getMCProfile(mcTokenResponse.data.access_token)
        } catch (err) {
            const status = err && (err.statusCode || (err.response && err.response.statusCode))
            const body = err && ((err.response && err.response.body) || err.body) || {}
            if (status === 404 || (body && (body.error === 'NOT_FOUND' || (body.errorMessage && String(body.errorMessage).toLowerCase().includes('not found'))))) {
                return Promise.reject({
                    microsoftErrorCode: 'NO_MINECRAFT_PROFILE',
                    title: 'No Minecraft profile',
                    desc: 'This Microsoft account does not have an associated Minecraft profile (it may not own Minecraft).',
                    message: 'No Minecraft profile'
                })
            }
            throw err
        }

        if (mcProfileResponse.responseStatus === RestResponseStatus.ERROR) {
            const body = mcProfileResponse.data || mcProfileResponse.error || {}
            if (body && (body.error === 'NOT_FOUND' || (body.errorMessage && String(body.errorMessage).toLowerCase().includes('not found')))) {
                return Promise.reject({
                    microsoftErrorCode: 'NO_MINECRAFT_PROFILE',
                    title: 'No Minecraft profile',
                    desc: 'This Microsoft account does not have an associated Minecraft profile (it may not own Minecraft).',
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
    } catch (err) {
        log.error(err)
        return Promise.reject(makeMicrosoftDisplayable(MicrosoftErrorCode.UNKNOWN))
    }
}

module.exports = {
    fullMicrosoftAuthFlow,
    calculateExpiryDate,
    AUTH_MODE
}
