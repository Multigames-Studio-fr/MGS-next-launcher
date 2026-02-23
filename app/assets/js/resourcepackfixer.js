const fs = require('fs-extra')
const path = require('path')
let LoggerUtil
try {
    if (typeof LoggerUtil === 'undefined' || !LoggerUtil) {
        const _hc = require('helios-core')
        LoggerUtil = _hc && _hc.LoggerUtil
    }
} catch (e) {
    // ignore - may be provided globally
}

const logger = (LoggerUtil && typeof LoggerUtil.getLogger === 'function') ? LoggerUtil.getLogger('ResourcePackFixer') : console

// Stubbed ResourcePackFixer: module removed by request. This minimal
// implementation provides no-op functions to keep any existing imports
// from failing while ensuring the launcher does not attempt repairs.
const ResourcePackFixer = {
    ERROR_PATTERNS: [],
    analyzeLogLine: () => null,
    cleanResourcePackCache: async () => false,
    createValidModelJson: () => null,
    repairCorruptedModels: async () => 0,
    createLogMonitor: () => (/* line */) => {},
    performCorrectiveActions: async () => ({ cacheCleared: false, modelsRepaired: 0, errors: [] }),
    shouldTriggerCorrection: () => false
}

module.exports = ResourcePackFixer