// Simplified ModDeduplicator: anti-cheat functionality removed.
// Export only safe utilities and no-op stubs to preserve API compatibility.
const MOD_VERSION_REGEX = /^(.+?)[-_](\d+(?:\.\d+)*(?:[-+][a-zA-Z0-9\-._]+)?)\.(jar|zip|litemod)$/

/**
 * Parse le nom d'un fichier mod pour extraire le nom de base et la version
 */
function parseModFileName(fileName) {
    let cleanName = fileName
    if (fileName.endsWith('.disabled')) {
        cleanName = fileName.substring(0, fileName.length - 9)
    }
    const match = MOD_VERSION_REGEX.exec(cleanName)
    if (match) {
        return {
            baseName: match[1],
            version: match[2],
            ext: match[3],
            isDisabled: fileName.endsWith('.disabled'),
            originalName: fileName
        }
    }
    const extMatch = cleanName.match(/^(.+)\.(jar|zip|litemod)$/)
    if (extMatch) {
        return {
            baseName: extMatch[1],
            version: '0.0.0',
            ext: extMatch[2],
            isDisabled: fileName.endsWith('.disabled'),
            originalName: fileName
        }
    }
    return null
}

function compareVersions(v1, v2) {
    if (v1 === v2) return 0
    const parseVersion = (version) => {
        const [main, prerelease] = version.split(/[-+]/)
        const parts = main.split('.').map(x => parseInt(x, 10) || 0)
        return { parts, prerelease: prerelease || '' }
    }
    const parsed1 = parseVersion(v1)
    const parsed2 = parseVersion(v2)
    const maxLength = Math.max(parsed1.parts.length, parsed2.parts.length)
    for (let i = 0; i < maxLength; i++) {
        const part1 = parsed1.parts[i] || 0
        const part2 = parsed2.parts[i] || 0
        if (part1 !== part2) return part1 - part2
    }
    if (!parsed1.prerelease && parsed2.prerelease) return 1
    if (parsed1.prerelease && !parsed2.prerelease) return -1
    if (parsed1.prerelease !== parsed2.prerelease) return parsed1.prerelease.localeCompare(parsed2.prerelease)
    return 0
}

// No-op / safe stubs for former anti-cheat API (keep for compatibility)
function isCheatMod(/* modName */) { return false }
function detectCheatBehaviorInLog(/* logLine */) { return false }
async function scanForCheatMods(/* modsDir */) { return { cheatMods: [], toDelete: [] } }
async function deleteCheatMods(/* filesToDelete */) { return { success: 0, failed: 0, errors: [] } }
async function scanAndCleanCheatMods(/* modsDir */) { return { found: 0, deleted: 0, failed: 0 } }
function watchForCheatMods(/* modsDir, onCheatModFound */) { return null }

module.exports = {
    parseModFileName,
    compareVersions,
    isCheatMod,
    detectCheatBehaviorInLog,
    scanForCheatMods,
    deleteCheatMods,
    scanAndCleanCheatMods,
    watchForCheatMods,
    CHEAT_MODS: [],
    CHEAT_LOG_PATTERNS: []
}
