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
        ; Attempt to launch the installed application (robust)
        ; Try a couple of likely executable names first
        StrCpy $R5 "$INSTDIR\\MultiGames Studio Launcher.exe"
        StrCpy $R6 "$INSTDIR\\multigames-studio-launcher.exe"
        FileOpen $R1 "$TEMP\\mgs_installer.log" a
        ${If} ${File} ; ensure File functions are available
        ${EndIf}
        ; Try productName.exe
        IfFileExists "$R5" 0 +3
            FileWrite $R1 "Found executable: $R5\r\n"
            ExecShell open "$R5" ""
            Goto +6
        ; Try name-based exe
        IfFileExists "$R6" 0 +3
            FileWrite $R1 "Found executable: $R6\r\n"
            ExecShell open "$R6" ""
            Goto +3
        ; Fallback: find first .exe in install dir and run it
        FindFirst $R7 $R8 "$INSTDIR\\*.exe"
        ${If} $R7 == 0
            FileWrite $R1 "No exe found in $INSTDIR\\*.exe\r\n"
        ${Else}
            StrCpy $R9 "$INSTDIR\\$R8"
            FileWrite $R1 "Launching fallback exe: $R9\r\n"
            ExecShell open "$R9" ""
            FindClose $R7
        ${EndIf}
        FileClose $R1
FunctionEnd
