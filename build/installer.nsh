; Note: do NOT request UAC elevation unconditionally here.
; If RequestExecutionLevel is set to 'highest', the installer runs elevated
; even when the user chooses a per-user install, which can cause confusing
; behavior (duplicate installs into Program Files and AppData). We handle
; per-user vs all-users by using SetShellVarContext below.

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
        ; All users selected -> install for all users
        SetShellVarContext all
        StrCpy $INSTDIR "$PROGRAMFILES\\multigames-studio-launcher"
    ${Else}
        ; Current user -> install just for current user
        SetShellVarContext current
        StrCpy $INSTDIR "$LOCALAPPDATA\\multigames-studio-launcher"
    ${EndIf}
FunctionEnd

; Ensure license page is shown (electron-builder will insert MUI_PAGE_LICENSE when license is present)
; This file is included into the generated NSIS script by electron-builder.

; Debugging helper: log install destination and timestamp when install finishes
Function .onInstSuccess
    ; $R0..$R2 used for temporary storage
    StrCpy $R0 "$TEMP\\mgs_installer.log"
    ; Open (append) the log file
    FileOpen $R1 $R0 a
    ${If} $R1 == error
        ; if we can't open, silently ignore
        Return
    ${EndIf}
    ; Write a simple timestamp and the selected install dir
    ; NSIS doesn't have a built-in datetime, so write tick count as a rough marker
    System::Call 'Kernel32::GetTickCount() i .r2'
    FileWrite $R1 "Tick: $R2 - Installed to: $INSTDIR\r\n"
    FileClose $R1
FunctionEnd
