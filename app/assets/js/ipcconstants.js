// NOTE FOR THIRD-PARTY
// REPLACE THIS CLIENT ID WITH YOUR APPLICATION ID.
// SEE https://github.com/dscalzi/HeliosLauncher/blob/master/docs/MicrosoftAuth.md
exports.AZURE_CLIENT_ID = '27bffed9-be12-432f-8a78-bfa7b2087e66'
// SEE NOTE ABOVE.


// Opcodes
exports.MSFT_OPCODE = {
    OPEN_LOGIN: 'MSFT_AUTH_OPEN_LOGIN',
    OPEN_LOGOUT: 'MSFT_AUTH_OPEN_LOGOUT',
    REPLY_LOGIN: 'MSFT_AUTH_REPLY_LOGIN',
    REPLY_LOGOUT: 'MSFT_AUTH_REPLY_LOGOUT'
}
// Reply types for REPLY opcode.
exports.MSFT_REPLY_TYPE = {
    SUCCESS: 'MSFT_AUTH_REPLY_SUCCESS',
    ERROR: 'MSFT_AUTH_REPLY_ERROR'
}
// Error types for ERROR reply.
exports.MSFT_ERROR = {
    ALREADY_OPEN: 'MSFT_AUTH_ERR_ALREADY_OPEN',
    NOT_FINISHED: 'MSFT_AUTH_ERR_NOT_FINISHED',
    AUTH_TIMEOUT: 'MSFT_AUTH_ERR_TIMEOUT',
    WINDOW_CREATE_FAILED: 'MSFT_AUTH_ERR_WINDOW_FAILED',
    URL_LOAD_FAILED: 'MSFT_AUTH_ERR_URL_FAILED',
    NETWORK_ERROR: 'MSFT_AUTH_ERR_NETWORK',
    INVALID_RESPONSE: 'MSFT_AUTH_ERR_INVALID_RESPONSE'
}

// User-friendly error messages for each error type
exports.MSFT_ERROR_MESSAGES = {
    [exports.MSFT_ERROR.ALREADY_OPEN]: 'Une fenêtre de connexion Microsoft est déjà ouverte.',
    [exports.MSFT_ERROR.NOT_FINISHED]: 'La connexion a été annulée.',
    [exports.MSFT_ERROR.AUTH_TIMEOUT]: 'La connexion a expiré. Veuillez réessayer.',
    [exports.MSFT_ERROR.WINDOW_CREATE_FAILED]: 'Impossible de créer la fenêtre de connexion.',
    [exports.MSFT_ERROR.URL_LOAD_FAILED]: 'Impossible de charger la page de connexion Microsoft.',
    [exports.MSFT_ERROR.NETWORK_ERROR]: 'Erreur réseau. Vérifiez votre connexion Internet.',
    [exports.MSFT_ERROR.INVALID_RESPONSE]: 'Réponse invalide de Microsoft.'
}

exports.SHELL_OPCODE = {
    TRASH_ITEM: 'TRASH_ITEM'
}

// Account validation status
exports.ACCOUNT_STATUS = {
    VALID: 'ACCOUNT_VALID',
    EXPIRED: 'ACCOUNT_EXPIRED',
    INVALID: 'ACCOUNT_INVALID',
    NETWORK_ERROR: 'ACCOUNT_NETWORK_ERROR',
    REFRESH_REQUIRED: 'ACCOUNT_REFRESH_REQUIRED'
}