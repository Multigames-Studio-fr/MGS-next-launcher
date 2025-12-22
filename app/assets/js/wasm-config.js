// Configuration pour les fichiers WASM
const path = require('path')
const fs = require('fs')

/**
 * Trouve le chemin correct vers un fichier WASM
 * @param {string} filename - Nom du fichier WASM
 * @returns {string} Chemin vers le fichier WASM
 */
function locateWasmFile(filename) {
    // Chemins possibles pour les fichiers WASM
    const possiblePaths = [
        // Dans le dossier assets de l'app
        path.join(__dirname, '..', '..', 'assets', filename),
        // Dans node_modules/sql.js/dist
        path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', filename),
        // Chemin relatif depuis le renderer
        path.join('.', 'assets', filename),
        // Chemin absolu de fallback
        path.resolve(__dirname, '..', '..', 'assets', filename)
    ]

    // Teste chaque chemin et retourne le premier qui existe
    for (const wasmPath of possiblePaths) {
        try {
            if (fs.existsSync(wasmPath)) {
                console.log(`[WASM] Found ${filename} at: ${wasmPath}`)
                return wasmPath
            }
        } catch (e) {
            // Ignore les erreurs de lecture et continue
            continue
        }
    }

    // Si aucun chemin ne fonctionne, retourne le chemin par défaut
    const defaultPath = possiblePaths[0]
    console.warn(`[WASM] Could not locate ${filename}, using default path: ${defaultPath}`)
    return defaultPath
}

/**
 * Configuration pour sql.js avec gestion des chemins WASM
 */
function getSqlJsConfig() {
    return {
        locateFile: function(file) {
            if (file.endsWith('.wasm')) {
                return locateWasmFile(file)
            }
            return file
        }
    }
}

module.exports = {
    locateWasmFile,
    getSqlJsConfig
}