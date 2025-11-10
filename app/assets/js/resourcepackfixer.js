const fs = require('fs-extra')
const path = require('path')
const { LoggerUtil } = require('helios-core')

const logger = LoggerUtil.getLogger('ResourcePackFixer')

/**
 * ResourcePackFixer - Détecte et corrige automatiquement les problèmes
 * de packs de ressources corrompus ou mal formatés
 */
class ResourcePackFixer {

    /**
     * Patterns d'erreurs communes à détecter dans les logs
     */
    static ERROR_PATTERNS = [
        /Failed to load model (.+\.json)/,
        /Missing from, expected to find a JsonArray/,
        /JsonSyntaxException.*cosmetics:models/,
        /Couldn't parse item model '(.+)'/,
        /Missing sprite: (.+)/
    ]

    /**
     * Analyse une ligne de log pour détecter des erreurs de pack de ressources
     * @param {string} logLine - Ligne de log à analyser
     * @returns {Object|null} - Informations sur l'erreur détectée ou null
     */
    static analyzeLogLine(logLine) {
        for (const pattern of this.ERROR_PATTERNS) {
            const match = logLine.match(pattern)
            if (match) {
                return {
                    type: 'resource_pack_error',
                    pattern: pattern.source,
                    match: match[0],
                    details: match[1] || null,
                    line: logLine
                }
            }
        }
        return null
    }

    /**
     * Nettoie le cache des packs de ressources corrompus
     * @param {string} instancePath - Chemin vers l'instance Minecraft
     * @returns {Promise<boolean>} - True si le nettoyage a réussi
     */
    static async cleanResourcePackCache(instancePath) {
        try {
            const cachePaths = [
                path.join(instancePath, 'downloads'),
                path.join(instancePath, 'resourcepacks'),
                path.join(instancePath, 'server-resource-packs')
            ]

            let cleaned = false
            for (const cachePath of cachePaths) {
                if (await fs.pathExists(cachePath)) {
                    logger.info(`Nettoyage du cache: ${cachePath}`)
                    await fs.remove(cachePath)
                    cleaned = true
                }
            }

            if (cleaned) {
                logger.info('Cache des packs de ressources nettoyé avec succès')
                return true
            } else {
                logger.info('Aucun cache à nettoyer trouvé')
                return false
            }
        } catch (error) {
            logger.error('Erreur lors du nettoyage du cache:', error)
            return false
        }
    }

    /**
     * Crée un fichier de modèle JSON correct pour remplacer les fichiers corrompus
     * @param {string} modelPath - Chemin vers le fichier de modèle
     * @returns {Object} - Modèle JSON correct
     */
    static createValidModelJson(modelPath) {
        const modelName = path.basename(modelPath, '.json')
        
        return {
            "parent": "item/generated",
            "textures": {
                "layer0": `cosmetics:item/${modelName}`
            },
            "elements": [
                {
                    "from": [0, 0, 0],
                    "to": [16, 16, 16],
                    "faces": {
                        "north": {"texture": "#layer0"},
                        "south": {"texture": "#layer0"},
                        "east": {"texture": "#layer0"},
                        "west": {"texture": "#layer0"},
                        "up": {"texture": "#layer0"},
                        "down": {"texture": "#layer0"}
                    }
                }
            ],
            "display": {
                "head": {
                    "rotation": [0, 0, 0],
                    "translation": [0, 0, 0],
                    "scale": [1, 1, 1]
                }
            }
        }
    }

    /**
     * Tente de réparer automatiquement les fichiers de modèles corrompus
     * @param {string} instancePath - Chemin vers l'instance Minecraft
     * @param {Array<string>} corruptedModels - Liste des modèles corrompus
     * @returns {Promise<number>} - Nombre de fichiers réparés
     */
    static async repairCorruptedModels(instancePath, corruptedModels) {
        let repairedCount = 0

        for (const modelPath of corruptedModels) {
            try {
                // Chercher le fichier dans le cache des packs de ressources
                const downloadPath = path.join(instancePath, 'downloads')
                if (await fs.pathExists(downloadPath)) {
                    const directories = await fs.readdir(downloadPath)
                    
                    for (const dir of directories) {
                        const fullPath = path.join(downloadPath, dir, modelPath)
                        if (await fs.pathExists(fullPath)) {
                            const validModel = this.createValidModelJson(modelPath)
                            await fs.writeJson(fullPath, validModel, { spaces: 2 })
                            logger.info(`Modèle réparé: ${fullPath}`)
                            repairedCount++
                        }
                    }
                }
            } catch (error) {
                logger.error(`Erreur lors de la réparation de ${modelPath}:`, error)
            }
        }

        return repairedCount
    }

    /**
     * Surveillance en temps réel des logs pour détecter les erreurs
     * @param {Function} onErrorDetected - Callback appelé quand une erreur est détectée
     * @returns {Function} - Fonction pour analyser une ligne de log
     */
    static createLogMonitor(onErrorDetected) {
        const detectedErrors = new Set()
        
        return (logLine) => {
            const error = this.analyzeLogLine(logLine)
            if (error && !detectedErrors.has(error.match)) {
                detectedErrors.add(error.match)
                logger.warn(`Erreur de pack de ressources détectée: ${error.match}`)
                
                if (onErrorDetected) {
                    onErrorDetected(error)
                }
            }
        }
    }

    /**
     * Action corrective complète pour résoudre les problèmes de packs de ressources
     * @param {string} instancePath - Chemin vers l'instance Minecraft
     * @param {Array<Object>} detectedErrors - Erreurs détectées
     * @returns {Promise<Object>} - Résultat des actions correctives
     */
    static async performCorrectiveActions(instancePath, detectedErrors) {
        const result = {
            cacheCleared: false,
            modelsRepaired: 0,
            errors: []
        }

        try {
            // 1. Nettoyer le cache
            result.cacheCleared = await this.cleanResourcePackCache(instancePath)

            // 2. Extraire les modèles corrompus
            const corruptedModels = detectedErrors
                .filter(error => error.details && error.details.includes('.json'))
                .map(error => error.details)
                .filter((model, index, array) => array.indexOf(model) === index) // Dédupliquer

            // 3. Réparer les modèles si possible
            if (corruptedModels.length > 0) {
                result.modelsRepaired = await this.repairCorruptedModels(instancePath, corruptedModels)
            }

            logger.info(`Actions correctives terminées: Cache nettoyé: ${result.cacheCleared}, Modèles réparés: ${result.modelsRepaired}`)
            
        } catch (error) {
            logger.error('Erreur lors des actions correctives:', error)
            result.errors.push(error.message)
        }

        return result
    }

    /**
     * Vérifie si les erreurs détectées nécessitent une intervention
     * @param {Array<Object>} detectedErrors - Erreurs détectées
     * @returns {boolean} - True si une intervention est nécessaire
     */
    static shouldTriggerCorrection(detectedErrors) {
        // Déclencher une correction si on a plus de 2 erreurs de modèles
        const modelErrors = detectedErrors.filter(error => 
            error.pattern.includes('Failed to load model') || 
            error.pattern.includes('JsonSyntaxException')
        )
        
        return modelErrors.length >= 2
    }

}

module.exports = ResourcePackFixer