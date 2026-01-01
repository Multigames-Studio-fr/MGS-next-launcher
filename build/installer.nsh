; Note: do NOT request UAC elevation unconditionally here.
; If RequestExecutionLevel is set to 'highest', the installer runs elevated
; even when the user chooses a per-user install, which can cause confusing
; behavior (duplicate installs into Program Files and AppData). We handle
; per-user vs all-users by using SetShellVarContext below.

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"
!include "LogicLib.nsh"

; The license page is handled by electron-builder when `build.nsis.license`
; is set in `package.json`. Do not insert `MUI_PAGE_LICENSE` here to avoid
; duplicate pages.

; Note: the installer previously contained a custom `SelectScopePage` to
; choose per-user vs all-users installs. Electron-builder's NSIS logic now
; inserts its own install-scope UI when relevant which caused the same
; page to appear twice. We intentionally remove the custom page so the
; built-in electron-builder pages control install scope and avoid
; duplicated UI.

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

    ; Create a simple installed marker file so the launcher can detect an
    ; installation and skip its first-run installation UI when appropriate.
    StrCpy $R3 "$INSTDIR\\installed.flag"
    FileOpen $R4 $R3 w
    ${If} $R4 == error
        ; silently ignore if we can't create the file
    ${Else}
        FileWrite $R4 "installed"
        FileClose $R4
    ${EndIf}
    
    ; Do NOT launch the application or open any folders after installation.
    ; The launcher will be started manually by the user from Start menu or desktop shortcut.
    ; This avoids opening unexpected folders or windows after update completion.
    ; Launch the launcher executable after installation so updates triggered
    ; from the running launcher will return the user to the application.
    ; If you prefer NOT to auto-run after install, remove or comment the block below.
    ; Only attempt to run when the executable exists in the install dir.
    IfFileExists "$INSTDIR\\MultiGames Studio Launcher.exe" 0 +2
    ExecShell "open" "$INSTDIR\\MultiGames Studio Launcher.exe"
FunctionEnd
