const fs = require('fs-extra')
const path = require('path')
const { LoggerUtil } = require('helios-core')

const fs = require('fs-extra')
const { LoggerUtil } = require('helios-core')

const logger = LoggerUtil.getLogger('ResourcePackFixer')

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