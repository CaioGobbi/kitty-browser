; Registers Kitty as a web browser for the current user, so it shows up in
; Windows Settings > Apps > Default apps and can open http/https links and
; .html files. Everything is removed on uninstall.
!define KITTY_EXE "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
!define KITTY_CLIENT "Software\Clients\StartMenuInternet\Kitty"

!macro kittyProgId NAME FRIENDLY
  WriteRegStr HKCU "Software\Classes\${NAME}" "" "${FRIENDLY}"
  WriteRegStr HKCU "Software\Classes\${NAME}" "FriendlyTypeName" "${FRIENDLY}"
  WriteRegStr HKCU "Software\Classes\${NAME}\DefaultIcon" "" "${KITTY_EXE},0"
  WriteRegStr HKCU "Software\Classes\${NAME}\shell\open\command" "" '"${KITTY_EXE}" "%1"'
!macroend

!macro customInstall
  WriteRegStr HKCU "${KITTY_CLIENT}" "" "Kitty"
  WriteRegStr HKCU "${KITTY_CLIENT}\DefaultIcon" "" "${KITTY_EXE},0"
  WriteRegStr HKCU "${KITTY_CLIENT}\shell\open\command" "" '"${KITTY_EXE}"'
  WriteRegStr HKCU "${KITTY_CLIENT}\Capabilities" "ApplicationName" "Kitty"
  WriteRegStr HKCU "${KITTY_CLIENT}\Capabilities" "ApplicationDescription" "Navegador rápido e focado em privacidade"
  WriteRegStr HKCU "${KITTY_CLIENT}\Capabilities" "ApplicationIcon" "${KITTY_EXE},0"
  WriteRegStr HKCU "${KITTY_CLIENT}\Capabilities\StartMenu" "StartMenuInternet" "Kitty"
  WriteRegStr HKCU "${KITTY_CLIENT}\Capabilities\URLAssociations" "http" "KittyURL"
  WriteRegStr HKCU "${KITTY_CLIENT}\Capabilities\URLAssociations" "https" "KittyURL"
  WriteRegStr HKCU "${KITTY_CLIENT}\Capabilities\FileAssociations" ".html" "KittyHTML"
  WriteRegStr HKCU "${KITTY_CLIENT}\Capabilities\FileAssociations" ".htm" "KittyHTML"
  WriteRegStr HKCU "${KITTY_CLIENT}\Capabilities\FileAssociations" ".xhtml" "KittyHTML"
  WriteRegStr HKCU "Software\RegisteredApplications" "Kitty" "${KITTY_CLIENT}\Capabilities"

  !insertmacro kittyProgId "KittyURL" "Kitty URL"
  WriteRegStr HKCU "Software\Classes\KittyURL" "URL Protocol" ""
  !insertmacro kittyProgId "KittyHTML" "Página web do Kitty"

  ; Tell Explorer the associations changed.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "${KITTY_CLIENT}"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Kitty"
  DeleteRegKey HKCU "Software\Classes\KittyURL"
  DeleteRegKey HKCU "Software\Classes\KittyHTML"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
