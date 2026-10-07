; Splash shown when the user runs the Setup. Skipped for silent installs (auto-update runs the Setup with /S).
!macro customInit
  IfSilent jaca_skip_splash
  InitPluginsDir
  File /oname=$PLUGINSDIR\splash.bmp "${BUILD_RESOURCES_DIR}\installer-splash.bmp"
  advsplash::show 2500 300 300 -1 $PLUGINSDIR\splash
  Pop $0
  jaca_skip_splash:
!macroend
