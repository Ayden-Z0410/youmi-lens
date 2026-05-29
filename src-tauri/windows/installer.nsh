; Youmi Lens — Windows NSIS installer hooks
;
; The stock Tauri v2 NSIS template only offers a desktop shortcut as an opt-in
; checkbox on the installer's finish page (MUI_FINISHPAGE_SHOWREADME repurposed
; as "Create desktop shortcut"). That does not reliably produce a desktop icon:
; it depends on the user leaving the box checked, on a GUI (non-silent) install,
; and it is skipped for silent/passive installs unless /R is passed.
;
; These hooks force-create the desktop shortcut on every install and remove it
; on uninstall. CreateShortcut overwrites in place, so this is idempotent and
; coexists harmlessly with the finish-page checkbox if it is also used.
;
; ${PRODUCTNAME}, ${MAINBINARYNAME}, $INSTDIR and $DESKTOP are all defined/valid
; at these hook points in the generated installer.nsi.

!macro NSIS_HOOK_POSTINSTALL
  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
!macroend
