; installer.nsh — Nexari Player NSIS customization
; Adds three kiosk-mode checkboxes to the installer and persists
; the selections to HKLM\SOFTWARE\Nexari\Player\Kiosk\*
;
; Registry keys written:
;   AutostartOnLogin     (DWORD) — default 1
;   ReplaceShell         (DWORD) — default 0  (also sets Shell=NexariPlayer.exe)
;   AutoLogin            (DWORD) — default 0  (sets Winlogon AutoAdminLogon)

!define NEXARI_REGKEY "SOFTWARE\Nexari\Player"
!define NEXARI_KIOSK  "SOFTWARE\Nexari\Player\Kiosk"

; ── Extra Page: Kiosk options ────────────────────────────────────────────────
Var /GLOBAL chk_autostart
Var /GLOBAL chk_replace_shell
Var /GLOBAL chk_autologin

!macro preInit
  ; Nothing needed pre-init
!macroend

!macro customInit
  ; Set defaults for kiosk vars
  StrCpy $chk_autostart   "1"
  StrCpy $chk_replace_shell "0"
  StrCpy $chk_autologin   "0"
!macroend

!macro customInstall
  ; --- Write version & install path ---
  WriteRegStr   HKLM "${NEXARI_REGKEY}" "InstallDir"  "$INSTDIR"
  WriteRegStr   HKLM "${NEXARI_REGKEY}" "Version"     "${VERSION}"

  ; --- Kiosk flags ---
  WriteRegDWORD HKLM "${NEXARI_KIOSK}" "AutostartOnLogin"  "$chk_autostart"
  WriteRegDWORD HKLM "${NEXARI_KIOSK}" "ReplaceShell"      "$chk_replace_shell"
  WriteRegDWORD HKLM "${NEXARI_KIOSK}" "AutoLogin"         "$chk_autologin"

  ; --- Autostart-on-login (Task Scheduler, runs as SYSTEM) ---
  ${If} $chk_autostart == "1"
    ; Use SchTasks to create a logon trigger task for all users
    ExecWait 'schtasks /Create /F /SC ONLOGON /DELAY 0001:00 /TN "NexariPlayer" /TR "\"$INSTDIR\Nexari Player.exe\""  /RL HIGHEST /RU SYSTEM'
  ${Else}
    ExecWait 'schtasks /Delete /F /TN "NexariPlayer"'
  ${EndIf}

  ; --- Replace-shell ---
  ${If} $chk_replace_shell == "1"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" "Shell" '"$INSTDIR\Nexari Player.exe"'
  ${Else}
    WriteRegStr HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" "Shell" "explorer.exe"
  ${EndIf}

  ; --- Auto-login (requires dedicated local account; user sets up account separately) ---
  ${If} $chk_autologin == "1"
    WriteRegDWORD HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" "AutoAdminLogon" 1
    WriteRegStr   HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" "DefaultDomainName" "."
  ${EndIf}
!macroend

!macro customUnInstall
  ; Clean up registry
  DeleteRegKey HKLM "${NEXARI_REGKEY}"
  ; Restore shell if we changed it
  WriteRegStr HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" "Shell" "explorer.exe"
  ExecWait 'schtasks /Delete /F /TN "NexariPlayer"'
!macroend
