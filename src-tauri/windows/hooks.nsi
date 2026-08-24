; NSIS installer hooks (wired via bundle.windows.nsis.installerHooks).
;
; The updater runs this installer silently (/S) on every new version, and the stock
; template re-creates the desktop shortcut each time — so an icon the user deleted
; kept coming back after every update. Rule here: a silent install leaves the desktop
; exactly as it found it. Interactive (first) installs keep today's behaviour.

Var DualDesktopLnkExisted

!macro NSIS_HOOK_PREINSTALL
  StrCpy $DualDesktopLnkExisted "0"
  IfFileExists "$DESKTOP\${PRODUCTNAME}.lnk" 0 +2
    StrCpy $DualDesktopLnkExisted "1"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Only a silent run (the updater) may undo the template's shortcut; a human clicking
  ; through the installer asked for the icon.
  IfSilent 0 dual_desktop_keep
  StrCmp $DualDesktopLnkExisted "1" dual_desktop_keep 0
    Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  dual_desktop_keep:
!macroend
