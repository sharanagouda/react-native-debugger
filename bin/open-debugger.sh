#!/bin/bash
# This script is used as BROWSER= for Metro to redirect "Open DevTools" to ReactoRadar app
# Instead of opening Chrome, it opens our Electron app

if [ -d "/Applications/ReactoRadar.app" ]; then
  open "/Applications/ReactoRadar.app"
else
  echo "[ReactoRadar] App not installed. Install from: https://github.com/sharanagouda/react-native-debugger/releases"
fi
