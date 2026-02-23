/**
 * Script for welcome.ejs
 */
document.getElementById('welcomeButton').addEventListener('click', e => {
    if (typeof loginOptionsCancelEnabled === 'function') loginOptionsCancelEnabled(false) // False by default, be explicit.
    loginOptionsViewOnLoginSuccess = VIEWS.landing
    loginOptionsViewOnLoginCancel = VIEWS.loginOptions
    switchView(VIEWS.welcome, VIEWS.loginOptions)
})