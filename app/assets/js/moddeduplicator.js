const fs = require('fs-extra')
const path = require('path')
const { LoggerUtil } = require('helios-core')

const logger = LoggerUtil.getLogger('ModDeduplicator')

// Liste des mods de triche connus (noms partiels, insensibles à la casse)
const CHEAT_MODS = [
    'wurst',
    'meteor',
    'liquidbounce',
    'aristois',
    'impact',
    'sigma',
    'lambda',
    'phobos',
    'pyro',
    'rusherhack',
    'konas',
    'kami',
    'creepy',
    'salhack',
    'future',
    'inertia',
    'wolfram',
    'bleach',
    'atomic',
    'thunderhack',
    'venus',
    'vape',
    'xray',
    'killaura',
    'freecam',
    'flyhack',
    'nodus',
    'huzuni',
    'weepcraft',
    'cheater',
    'hack',
    'cheat',
    'xaero-cheat',
    'baritone', // peut être utilisé pour du cheating
    'schematica' // peut être considéré comme triche sur certains serveurs
]

// Patterns de détection dans les logs du jeu (comportements suspects)
const CHEAT_LOG_PATTERNS = [
    // Patterns généraux de clients de triche
    /wurst.*client/i,
    /meteor.*client/i,
    /liquidbounce/i,
    /aristois/i,
    /impact.*client/i,
    /sigma.*client/i,
    
    // Modules de triche spécifiques
    /killaura/i,
    /criticals/i,
    /velocity/i,
    /antiknockback/i,
    /anti.*knockback/i,
    /noslowdown/i,
    /no.*slow/i,
    /flight.*enabled/i,
    /fly.*hack/i,
    /speed.*hack/i,
    /bhop/i,
    /bunnyhop/i,
    /jesus.*hack/i,
    /scaffold/i,
    /tower/i,
    /fastplace/i,
    /autoclick/i,
    /triggerbot/i,
    /aimbot/i,
    /x-?ray.*enabled/i,
    /wallhack/i,
    /esp.*enabled/i,
    /tracers/i,
    /freecam.*enabled/i,
    /nuker/i,
    /fastbreak/i,
    /reach.*hack/i,
    
    // Messages de chargement de mods de triche
    /loading.*cheat/i,
    /loading.*hack/i,
    /initializing.*wurst/i,
    /initializing.*meteor/i,
    /initializing.*liquid/i,
    
    // Commandes de triche
    /\.bind/i,
    /\.friend/i,
    /\.enemy/i,
    /\.t\s/i,
    /hack.*command/i,
    
    // Détection de modifications suspectes
    /modified.*reach/i,
    /modified.*speed/i,
    /bypassing.*anticheat/i,
    /disabled.*anticheat/i
]

// Regex pour parser les noms de mods (nom-version.jar)
const MOD_VERSION_REGEX = /^(.+?)[-_](\d+(?:\.\d+)*(?:[-+][a-zA-Z0-9\-._]+)?)\.(jar|zip|litemod)$/

/**
 * Vérifier si un mod est un mod de triche
 * 
 * @param {string} modName - Le nom du mod (sans extension)
 * @returns {boolean} - True si c'est un mod de triche
 */
function isCheatMod(modName) {
    const lowerName = modName.toLowerCase()
    
    // Vérifier si le nom contient un des mots-clés de triche
    return CHEAT_MODS.some(cheatKeyword => {
        return lowerName.includes(cheatKeyword.toLowerCase())
    })
}

/**
 * Analyser une ligne de log pour détecter un comportement de triche
 * 
 * @param {string} logLine - La ligne de log à analyser
 * @returns {boolean} - True si un comportement suspect est détecté
 */
function detectCheatBehaviorInLog(logLine) {
    if (!logLine || typeof logLine !== 'string') {
        return false
    }
    
    // Vérifier chaque pattern de triche
    for (const pattern of CHEAT_LOG_PATTERNS) {
        if (pattern.test(logLine)) {
            logger.warn(`Cheat behavior detected in log: ${logLine.substring(0, 200)}`)
            return true
        }
    }
    
    return false
}

/**
 * Parse le nom d'un fichier mod pour extraire le nom de base et la version
 * 
 * @param {string} fileName - Le nom du fichier mod (ex: "jei-1.19.2-11.6.0.1013.jar")
 * @returns {Object|null} - {baseName: string, version: string, ext: string} ou null si pas parsable
 */
function parseModFileName(fileName) {
    // Ignorer les fichiers .disabled
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
    
    // Fallback: fichier sans version détectable
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

/**
 * Comparer deux versions sémantiques
 * Retourne un nombre positif si v1 > v2, négatif si v1 < v2, 0 si égales
 * 
 * @param {string} v1 - Première version
 * @param {string} v2 - Deuxième version
 * @returns {number}
 */
function compareVersions(v1, v2) {
    if (v1 === v2) return 0
    
    // Séparer la version principale des tags (beta, alpha, etc.)
    const parseVersion = (version) => {
        const [main, prerelease] = version.split(/[-+]/)
        const parts = main.split('.').map(x => parseInt(x, 10) || 0)
        return { parts, prerelease: prerelease || '' }
    }
    
    const parsed1 = parseVersion(v1)
    const parsed2 = parseVersion(v2)
    
    // Comparer les parties numériques
    const maxLength = Math.max(parsed1.parts.length, parsed2.parts.length)
    for (let i = 0; i < maxLength; i++) {
        const part1 = parsed1.parts[i] || 0
        const part2 = parsed2.parts[i] || 0
        
        if (part1 !== part2) {
            return part1 - part2
        }
    }
    
    // Si versions principales égales, comparer les pre-release
    if (!parsed1.prerelease && parsed2.prerelease) return 1
    if (parsed1.prerelease && !parsed2.prerelease) return -1
    
    if (parsed1.prerelease !== parsed2.prerelease) {
        return parsed1.prerelease.localeCompare(parsed2.prerelease)
    }
    
    return 0
}

/**
 * Scanner un répertoire de mods et détecter les mods de triche
 * 
 * @param {string} modsDir - Chemin vers le dossier des mods
 * @returns {Promise<{cheatMods: Array, toDelete: Array}>}
 */
async function scanForCheatMods(modsDir) {
    if (!fs.existsSync(modsDir)) {
        logger.warn(`Mods directory does not exist: ${modsDir}`)
        return { cheatMods: [], toDelete: [] }
    }
    
    const files = await fs.readdir(modsDir)
    const cheatMods = []
    const toDelete = []
    
    // Scanner tous les fichiers
    for (const file of files) {
        const filePath = path.join(modsDir, file)
        const stats = await fs.stat(filePath)
        
        // Ignorer les dossiers
        if (stats.isDirectory()) {
            continue
        }
        
        const parsed = parseModFileName(file)
        if (!parsed) {
            continue
        }
        
        // Vérifier si c'est un mod de triche
        if (isCheatMod(parsed.baseName)) {
            cheatMods.push({
                fileName: file,
                path: filePath,
                baseName: parsed.baseName,
                isDisabled: parsed.isDisabled
            })
            toDelete.push(filePath)
            
            logger.warn(`Mod de triche détecté: ${file}`)
        }
    }
    
    return { cheatMods, toDelete }
}

/**
 * Supprimer les fichiers de mods de triche
 * 
 * @param {Array<string>} filesToDelete - Liste des chemins de fichiers à supprimer
 * @returns {Promise<{success: number, failed: number, errors: Array}>}
 */
async function deleteCheatMods(filesToDelete) {
    const results = {
        success: 0,
        failed: 0,
        errors: []
    }
    
    for (const filePath of filesToDelete) {
        try {
            await fs.remove(filePath)
            logger.info(`Mod de triche supprimé: ${path.basename(filePath)}`)
            results.success++
        } catch (err) {
            logger.error(`Échec de suppression de ${path.basename(filePath)}:`, err)
            results.failed++
            results.errors.push({
                file: filePath,
                error: err.message
            })
        }
    }
    
    return results
}

/**
 * Scanner et nettoyer automatiquement les mods de triche
 * 
 * @param {string} modsDir - Chemin vers le dossier des mods
 * @returns {Promise<{found: number, deleted: number, failed: number}>}
 */
async function scanAndCleanCheatMods(modsDir) {
    logger.info(`Scanning for cheat mods in: ${modsDir}`)
    
    const { cheatMods, toDelete } = await scanForCheatMods(modsDir)
    
    if (toDelete.length === 0) {
        logger.info('No cheat mods found')
        return { found: 0, deleted: 0, failed: 0 }
    }
    
    logger.warn(`Found ${cheatMods.length} cheat mod(s) (${toDelete.length} file(s) to remove)`)
    
    const deleteResults = await deleteCheatMods(toDelete)
    
    return {
        found: cheatMods.length,
        deleted: deleteResults.success,
        failed: deleteResults.failed
    }
}

/**
 * Surveiller un dossier de mods pour détecter l'ajout de mods de triche en temps réel
 * 
 * @param {string} modsDir - Chemin vers le dossier des mods
 * @param {Function} onCheatModFound - Callback appelé quand un mod de triche est détecté
 * @returns {fs.FSWatcher|null} - Le watcher ou null si le dossier n'existe pas
 */
function watchForCheatMods(modsDir, onCheatModFound) {
    if (!fs.existsSync(modsDir)) {
        logger.warn(`Cannot watch non-existent directory: ${modsDir}`)
        return null
    }
    
    logger.info(`Starting cheat mod watcher on: ${modsDir}`)
    
    const watcher = fs.watch(modsDir, async (eventType, filename) => {
        if (!filename || eventType !== 'rename') {
            return
        }
        
        const filePath = path.join(modsDir, filename)
        
        // Vérifier si le fichier existe (ajout) ou a été supprimé
        try {
            await fs.access(filePath)
            // Fichier ajouté, vérifier si c'est un mod de triche
            logger.debug(`New file detected: ${filename}`)
            
            const parsed = parseModFileName(filename)
            if (!parsed) {
                return
            }
            
            // Vérifier si c'est un mod de triche
            if (isCheatMod(parsed.baseName)) {
                logger.warn(`Cheat mod detected: ${filename}`)
                if (onCheatModFound) {
                    onCheatModFound({
                        fileName: filename,
                        path: filePath,
                        baseName: parsed.baseName,
                        isDisabled: parsed.isDisabled
                    })
                }
            }
        } catch (err) {
            // Fichier supprimé ou erreur d'accès
            logger.debug(`File removed or access error: ${filename}`)
        }
    })
    
    return watcher
}

module.exports = {
    parseModFileName,
    compareVersions,
    isCheatMod,
    detectCheatBehaviorInLog,
    scanForCheatMods,
    deleteCheatMods,
    scanAndCleanCheatMods,
    watchForCheatMods,
    CHEAT_MODS,
    CHEAT_LOG_PATTERNS
}
