!macro customInstall
  MessageBox MB_YESNO "Add Calendar command-line tools to your user PATH?" IDNO skipCalendarPath
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\assets\manage-path.ps1" -Directory "$INSTDIR" -Action Add'
  skipCalendarPath:
!macroend
!macro customUnInstall
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\assets\manage-path.ps1" -Directory "$INSTDIR" -Action Remove'
!macroend
