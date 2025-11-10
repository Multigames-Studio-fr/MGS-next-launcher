// Import IPC constants if not already loaded
if (typeof MSFT_OPCODE === 'undefined') {
    var { MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR } = require('./assets/js/ipcconstants')
}

const loginOptionsCancelContainer = document.getElementById('loginOptionCancelContainer')
const loginOptionMicrosoft = document.getElementById('loginOptionMicrosoft')
const loginOptionsCancelButton = document.getElementById('loginOptionCancelButton')

let loginOptionsCancellable = false

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

loginOptionMicrosoft.onclick = (e) => {
    // Afficher le statut de connexion
    $('#loginStatusMicrosoft').removeClass('hidden')
    $('#loginOptionMicrosoft').prop('disabled', true).addClass('opacity-50 cursor-not-allowed')
    
    // Lancer la connexion Microsoft sans changer de vue
    ipcRenderer.send(
        MSFT_OPCODE.OPEN_LOGIN,
        loginOptionsViewOnLoginSuccess,
        loginOptionsViewOnLoginCancel
    )
}

loginOptionsCancelButton.onclick = (e) => {
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
    // Masquer le statut de connexion et réactiver le bouton
    $('#loginStatusMicrosoft').addClass('hidden')
    $('#loginOptionMicrosoft').prop('disabled', false).removeClass('opacity-50 cursor-not-allowed')

    if (arguments_[0] === MSFT_REPLY_TYPE.ERROR) {
        const viewOnClose = arguments_[2]
        const errorType = arguments_[1]
        
        if (errorType === MSFT_ERROR.NOT_FINISHED) {
            // L'utilisateur a annulé - rester sur la page loginOptions
            console.log('Connexion Microsoft annulée par l\'utilisateur')
            return
        }
        
        // Erreur inattendue - afficher un message d'erreur
        $('#loginError').removeClass('hidden')
        $('#loginErrorText').text('Une erreur inattendue s\'est produite lors de la connexion Microsoft')
        
        // Masquer l'erreur après 5 secondes
        setTimeout(() => {
            $('#loginError').addClass('hidden')
        }, 5000)
        
    } else if (arguments_[0] === MSFT_REPLY_TYPE.SUCCESS) {
        const queryMap = arguments_[1]
        const viewOnClose = arguments_[2]
        
        // Erreur dans la réponse de Microsoft
        if (Object.prototype.hasOwnProperty.call(queryMap, 'error')) {
            const error = queryMap.error
            const errorDesc = queryMap.error_description || 'Erreur d\'authentification Microsoft'
            
            console.error('Erreur Microsoft Auth:', error, errorDesc)
            
            $('#loginError').removeClass('hidden')
            $('#loginErrorText').text(errorDesc)
            
            // Masquer l'erreur après 5 secondes
            setTimeout(() => {
                $('#loginError').addClass('hidden')
            }, 5000)
            
        } else {
            // Succès - changer de vue
            switchView(getCurrentView(), loginOptionsViewOnLoginSuccess, 500, 500)
        }
    }
})