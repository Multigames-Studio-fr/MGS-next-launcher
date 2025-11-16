; Request UAC elevation when necessary (highest is valid NSIS value)
RequestExecutionLevel highest

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"
!include "LogicLib.nsh"

Var SCOPE_USER_RADIO
Var SCOPE_ALL_RADIO

; Custom installer page to choose install scope (current user or all users)
; Define both the create and leave callbacks so makensis knows the function is used
Page custom SelectScopePage SelectScopePageLeave

Function SelectScopePage
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
        Abort
    ${EndIf}

    ; Title text
    ${NSD_CreateLabel} 0u 0u 100% 12u "Installation Settings"
    Pop $0

    ; Radio buttons
    ${NSD_CreateRadioButton} 10u 20u 100% 12u "Install for current user only (recommended)"
    Pop $SCOPE_USER_RADIO
    ${NSD_CreateRadioButton} 10u 36u 100% 12u "Install for all users (requires admin privileges)"
    Pop $SCOPE_ALL_RADIO

    ; Default to current user
    ${NSD_SetState} $SCOPE_USER_RADIO ${BST_CHECKED}

    nsDialogs::Show
FunctionEnd

Function SelectScopePageLeave
    ; If the current page is our custom page, read selection and adjust $INSTDIR
    StrCpy $R0 $INSTDIR
    ${NSD_GetState} $SCOPE_ALL_RADIO $R1
    ${If} $R1 == ${BST_CHECKED}
        ; All users selected -> set Program Files destination
        StrCpy $INSTDIR "$PROGRAMFILES\\multigames-studio-launcher"
    ${Else}
        ; Current user -> use Local AppData
        StrCpy $INSTDIR "$LOCALAPPDATA\\multigames-studio-launcher"
    ${EndIf}
FunctionEnd

; Ensure license page is shown (electron-builder will insert MUI_PAGE_LICENSE when license is present)
; This file is included into the generated NSIS script by electron-builder.
