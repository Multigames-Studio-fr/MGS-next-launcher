// Import IPC constants if not already loaded
if (typeof MSFT_OPCODE === 'undefined') {
    var { MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR } = require('./assets/js/ipcconstants')
}

const { LoggerUtil } = require('helios-core')
const { isDisplayableError } = require('helios-core/common')
const AuthManager = require('./assets/js/authmanager')

const msftLoginLogger = LoggerUtil.getLogger('Microsoft Login')

const loginOptionsCancelContainer = document.getElementById('loginOptionCancelContainer')
const loginOptionMicrosoft = document.getElementById('loginOptionMicrosoft')
const loginOptionsCancelButton = document.getElementById('loginOptionCancelButton')

let loginOptionsCancellable = false
let loginInProgress = false
let loginAttemptCount = 0
const MAX_LOGIN_ATTEMPTS = 3
const LOGIN_COOLDOWN_MS = 2000

let loginOptionsViewOnLoginSuccess
let loginOptionsViewOnLoginCancel
let loginOptionsViewOnCancel
let loginOptionsViewCancelHandler

function loginOptionsCancelEnabled(val){
    if(val){
        $(loginOptionsCancelContainer).show()
    } else {
        $(loginOptionsCancelContainer).hide()
    }
}

/**
 * Show a user-friendly error message
 */
function showLoginError(title, message, duration = 5000) {
    const errorEl = $('#loginError')
    const errorText = $('#loginErrorText')
    const errorTitle = $('#loginErrorTitle')
    
    if (errorTitle && errorTitle.length) {
        errorTitle.text(title)
    }
    if (errorText && errorText.length) {
        errorText.text(message)
    }
    
    errorEl.removeClass('hidden')
    
    if (duration > 0) {
        setTimeout(() => {
            errorEl.addClass('hidden')
        }, duration)
    }
}

/**
 * Reset login UI to initial state
 */
function resetLoginUI() {
    loginInProgress = false
    $('#loginStatusMicrosoft').addClass('hidden')
    $('#loginOptionMicrosoft').prop('disabled', false).removeClass('opacity-50 cursor-not-allowed')
}

loginOptionMicrosoft.onclick = (e) => {
    // Prevent double-clicks and rapid retries
    if (loginInProgress) {
        console.log('Login already in progress, ignoring click')
        return
    }
    
    // Check cooldown
    if (loginAttemptCount >= MAX_LOGIN_ATTEMPTS) {
        showLoginError('Trop de tentatives', 'Veuillez patienter quelques secondes avant de réessayer.')
        setTimeout(() => {
            loginAttemptCount = 0
        }, LOGIN_COOLDOWN_MS * 3)
        return
    }
    
    loginInProgress = true
    loginAttemptCount++
    
    // Afficher le statut de connexion
    $('#loginStatusMicrosoft').removeClass('hidden')
    $('#loginOptionMicrosoft').prop('disabled', true).addClass('opacity-50 cursor-not-allowed')
    
    // Lancer la connexion Microsoft sans changer de vue
    try {
        ipcRenderer.send(
            MSFT_OPCODE.OPEN_LOGIN,
            loginOptionsViewOnLoginSuccess,
            loginOptionsViewOnLoginCancel
        )
    } catch (err) {
        console.error('Failed to send login request:', err)
        resetLoginUI()
        showLoginError('Erreur de connexion', 'Impossible de démarrer le processus de connexion. Veuillez réessayer.')
    }
}

loginOptionsCancelButton.onclick = (e) => {
    // Reset state on cancel
    resetLoginUI()
    loginAttemptCount = 0
    
    switchView(getCurrentView(), loginOptionsViewOnCancel, 500, 500, () => {
        // No cleanup needed for Microsoft.
        if(loginOptionsViewCancelHandler != null){
            loginOptionsViewCancelHandler()
            loginOptionsViewCancelHandler = null
        }
    })
}

// Gérer les réponses de l'authentification Microsoft
ipcRenderer.on(MSFT_OPCODE.REPLY_LOGIN, (_, ...arguments_) => {
    if (arguments_[0] === MSFT_REPLY_TYPE.ERROR) {
        // Masquer le statut de connexion et réactiver le bouton en cas d'erreur
        resetLoginUI()
        
        const viewOnClose = arguments_[2]
        const errorType = arguments_[1]
        
        if (errorType === MSFT_ERROR.NOT_FINISHED) {
            // L'utilisateur a annulé - rester sur la page loginOptions
            console.log('Connexion Microsoft annulée par l\'utilisateur')
            loginAttemptCount = 0 // Reset attempt count on user cancel
            return
        }
        
        if (errorType === MSFT_ERROR.ALREADY_OPEN) {
            console.log('Une fenêtre de connexion Microsoft est déjà ouverte')
            showLoginError('Connexion en cours', 'Une fenêtre de connexion est déjà ouverte. Veuillez la fermer et réessayer.')
            return
        }
        
        // Erreur inattendue - afficher un message d'erreur
        console.error('Microsoft auth error:', errorType)
        showLoginError('Erreur de connexion', 'Une erreur inattendue s\'est produite lors de la connexion Microsoft. Veuillez réessayer.')
        
    } else if (arguments_[0] === MSFT_REPLY_TYPE.SUCCESS) {
        const queryMap = arguments_[1]
        const viewOnClose = arguments_[2]
        
        // Erreur dans la réponse de Microsoft
        if (Object.prototype.hasOwnProperty.call(queryMap, 'error')) {
            resetLoginUI()
            
            const error = queryMap.error
            const errorDesc = queryMap.error_description || 'Erreur d\'authentification Microsoft'
            
            console.error('Microsoft Auth Error:', error, errorDesc)
            
            // Map common errors to user-friendly messages
            let userMessage = errorDesc
            if (error === 'access_denied') {
                userMessage = 'Accès refusé. Veuillez autoriser l\'application à accéder à votre compte Microsoft.'
            } else if (error === 'invalid_grant') {
                userMessage = 'Session expirée. Veuillez vous reconnecter.'
            } else if (error === 'invalid_client') {
                userMessage = 'Erreur de configuration. Veuillez contacter le support.'
            }
            
            showLoginError('Erreur d\'authentification', userMessage)
            
        } else if (Object.prototype.hasOwnProperty.call(queryMap, 'code')) {
            // Succès - nous avons reçu le code d'autorisation
            msftLoginLogger.info('Acquired authCode, proceeding with authentication.')
            loginAttemptCount = 0 // Reset on success
            
            const authCode = queryMap.code
            
            // Afficher un indicateur de chargement pendant l'authentification
            $('#loginStatusMicrosoft').removeClass('hidden')
            $('#loginOptionMicrosoft').prop('disabled', true).addClass('opacity-50 cursor-not-allowed')
            
            AuthManager.addMicrosoftAccount(authCode)
                .then((value) => {
                    msftLoginLogger.info('Microsoft account added successfully.')
                    // Mettre à jour le compte sélectionné
                    if (typeof updateSelectedAccount === 'function') {
                        updateSelectedAccount(value)
                    }
                    resetLoginUI()
                    switchView(getCurrentView(), loginOptionsViewOnLoginSuccess, 500, 500)
                })
                .catch((displayableError) => {
                    resetLoginUI()
                    let actualDisplayableError
                    if (isDisplayableError(displayableError)) {
                        msftLoginLogger.error('Error while logging in.', displayableError)
                        actualDisplayableError = displayableError
                    } else {
                        // Unexpected error
                        msftLoginLogger.error('Unhandled error during login.', displayableError)
                        actualDisplayableError = {
                            title: 'Erreur de connexion',
                            desc: displayableError.message || 'Une erreur inattendue s\'est produite.',
                            message: displayableError.message || 'Une erreur inattendue s\'est produite.'
                        }
                    }
                    
                    showLoginError(actualDisplayableError.title, actualDisplayableError.desc, 10000)
                })
        } else {
            // Réponse inattendue sans code ni erreur
            resetLoginUI()
            console.error('Unexpected Microsoft auth response:', queryMap)
            showLoginError('Erreur inattendue', 'La réponse de Microsoft est invalide. Veuillez réessayer.')
        }
    }
})