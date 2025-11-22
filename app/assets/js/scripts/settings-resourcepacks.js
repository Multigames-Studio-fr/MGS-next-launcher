// Resource pack settings system removed.
// This file is intentionally a harmless stub to satisfy any requires
// from other modules. All UI and runtime logic were removed.

// Export an empty interface. If other modules attempt to call
// `initResourcePackSettings`, this stub provides a no-op function
// to avoid runtime errors.
module.exports = {
  initResourcePackSettings: function () {
    // no-op
  }
};
function attachResourcePackEvents() {
    const _get = (id) => document.getElementById(id)

    // Bouton de nettoyage du cache
    const cleanBtn = _get('cleanResourceCacheBtn')
    if (cleanBtn) cleanBtn.addEventListener('click', async () => {
        const btn = cleanBtn
        const originalText = btn.innerHTML
        
        try {
            btn.innerHTML = '<i class="bi-loading-spin mr-2"></i>Nettoyage...'
            btn.disabled = true
            
            const result = await ipcRenderer.invoke('clean-resource-cache')
            
            if (result.success) {
                showResourcePackNotification('Cache nettoyé avec succès', 'success')
                updateResourcePackStatus('Cache nettoyé', 'success')
            } else {
                showResourcePackNotification('Erreur lors du nettoyage: ' + result.error, 'error')
            }
        } catch (error) {
            showResourcePackNotification('Erreur: ' + error.message, 'error')
        } finally {
            btn.innerHTML = originalText
            btn.disabled = false
        }
    })
    
    // Bouton de vérification des erreurs
    const checkBtn = _get('checkResourceErrorsBtn')
    if (checkBtn) checkBtn.addEventListener('click', async () => {
        const btn = checkBtn
        const originalText = btn.innerHTML
        
        try {
            btn.innerHTML = '<i class="bi-loading-spin mr-2"></i>Vérification...'
            btn.disabled = true
            
            const result = await ipcRenderer.invoke('check-resource-errors')
            
            resourcePackState.errors = result.errors || []
            resourcePackState.lastCheck = new Date()
            
            updateResourcePackUI()
            
            if (resourcePackState.errors.length > 0) {
                showResourcePackNotification(`${resourcePackState.errors.length} erreur(s) détectée(s)`, 'warning')
            } else {
                showResourcePackNotification('Aucune erreur détectée', 'success')
            }
        } catch (error) {
            showResourcePackNotification('Erreur lors de la vérification: ' + error.message, 'error')
        } finally {
            btn.innerHTML = originalText
            btn.disabled = false
        }
    })
    
    // Bouton de réparation automatique
    const fixBtn = _get('autoFixResourcesBtn')
    if (fixBtn) fixBtn.addEventListener('click', async () => {
        const btn = fixBtn
        const originalText = btn.innerHTML
        
        try {
            btn.innerHTML = '<i class="bi-loading-spin mr-2"></i>Réparation...'
            btn.disabled = true
            
            const result = await ipcRenderer.invoke('auto-fix-resources')
            
            if (result.success) {
                showResourcePackNotification(`Réparation terminée: ${result.modelsRepaired} modèles réparés, cache nettoyé: ${result.cacheCleared}`, 'success')
                resourcePackState.errors = [] // Clear errors after fix
                updateResourcePackUI()
            } else {
                showResourcePackNotification('Erreur lors de la réparation: ' + (result.error || 'Erreur inconnue'), 'error')
            }
        } catch (error) {
            showResourcePackNotification('Erreur: ' + error.message, 'error')
        } finally {
            btn.innerHTML = originalText
            btn.disabled = false
        }
    })
    
    // Toggle de correction automatique
    const autoToggle = _get('autoFixEnabled')
    if (autoToggle) autoToggle.addEventListener('change', (e) => {
        resourcePackState.autoFixEnabled = e.target.checked
        saveResourcePackSettings()
        
        if (e.target.checked) {
            showResourcePackNotification('Correction automatique activée', 'info')
        } else {
            showResourcePackNotification('Correction automatique désactivée', 'info')
        }
    })
    
    // Toggle des notifications
    const notifToggle = _get('errorNotificationsEnabled')
    if (notifToggle) notifToggle.addEventListener('change', (e) => {
        resourcePackState.notificationsEnabled = e.target.checked
        saveResourcePackSettings()
        
        if (e.target.checked) {
            showResourcePackNotification('Notifications activées', 'info')
        } else {
            showResourcePackNotification('Notifications désactivées', 'info')
        }
    })
}

/**
 * Met à jour l'interface utilisateur
 */
function updateResourcePackUI() {
    // Mettre à jour le statut
    const statusText = document.getElementById('resourcePackStatusText')
    if (resourcePackState.errors.length > 0) {
        statusText.textContent = `${resourcePackState.errors.length} erreur(s) détectée(s)`
        statusText.className = 'text-red-400'
    } else {
        statusText.textContent = 'Aucun problème détecté'
        statusText.className = 'text-green-400'
    }
    
    // Mettre à jour l'heure de la dernière vérification
    const lastCheck = document.getElementById('lastCheckTime')
    if (resourcePackState.lastCheck) {
        lastCheck.textContent = resourcePackState.lastCheck.toLocaleTimeString()
        lastCheck.className = 'text-gray-400'
    } else {
        lastCheck.textContent = '-'
        lastCheck.className = 'text-gray-400'
    }
    
    // Mettre à jour la liste des erreurs
    updateRecentErrorsList()
}

/**
 * Met à jour la liste des erreurs récentes
 */
function updateRecentErrorsList() {
    const recentErrorsContainer = document.getElementById('recentErrors')
    
    if (resourcePackState.errors.length === 0) {
        recentErrorsContainer.innerHTML = '<p class="text-gray-400 text-sm italic">Aucune erreur récente</p>'
        return
    }
    
    const errorsList = resourcePackState.errors.slice(0, 5).map(error => {
        const errorType = error.type || 'unknown'
        const errorDetails = error.details || 'Aucun détail'
        
        return `
            <div class="bg-red-900/20 border border-red-700 rounded p-2 mb-2">
                <div class="flex items-center justify-between">
                    <span class="text-red-400 font-medium text-xs">${errorType.toUpperCase()}</span>
                    <span class="text-gray-500 text-xs">${new Date().toLocaleTimeString()}</span>
                </div>
                <p class="text-gray-300 text-sm mt-1 break-all">${errorDetails}</p>
            </div>
        `
    }).join('')
    
    recentErrorsContainer.innerHTML = errorsList
}

/**
 * Affiche une notification pour les opérations de packs de ressources
 * @param {string} message 
 * @param {string} type - 'success', 'error', 'warning', 'info'
 */
function showResourcePackNotification(message, type = 'info') {
    if (!resourcePackState.notificationsEnabled && type !== 'success') {
        return // Skip notifications if disabled, except for success messages
    }
    
    // Utiliser le système de notifications existant si disponible
    if (typeof showNotification === 'function') {
        showNotification(message, type)
    } else {
        console.log(`[ResourcePack ${type.toUpperCase()}] ${message}`)
    }
}

/**
 * Met à jour le statut des packs de ressources
 * @param {string} message 
 * @param {string} type 
 */
function updateResourcePackStatus(message, type = 'info') {
    const statusText = document.getElementById('resourcePackStatusText')
    statusText.textContent = message
    
    switch (type) {
        case 'success':
            statusText.className = 'text-green-400'
            break
        case 'error':
            statusText.className = 'text-red-400'
            break
        case 'warning':
            statusText.className = 'text-yellow-400'
            break
        default:
            statusText.className = 'text-blue-400'
    }
    
    // Mettre à jour l'heure
    document.getElementById('lastCheckTime').textContent = new Date().toLocaleTimeString()
}

// Gestionnaire d'événements pour les erreurs détectées en temps réel
if (typeof ipcRenderer !== 'undefined') {
    ipcRenderer.on('resource-pack-error-detected', (event, error) => {
        resourcePackState.errors.push(error)
        resourcePackState.lastCheck = new Date()
        
        if (resourcePackState.notificationsEnabled) {
            showResourcePackNotification('Erreur de pack de ressources détectée', 'warning')
        }
        
        updateResourcePackUI()
    })
    
    ipcRenderer.on('resource-pack-auto-fixed', (event, result) => {
        if (resourcePackState.notificationsEnabled) {
            showResourcePackNotification('Correction automatique appliquée', 'success')
        }
        
        // Clear some errors since they were fixed
        resourcePackState.errors = resourcePackState.errors.slice(-2) // Keep last 2 errors for reference
        updateResourcePackUI()
    })
}

// Exporter pour utilisation globale
window.initResourcePackSettings = initResourcePackSettings