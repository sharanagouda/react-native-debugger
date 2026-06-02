#!/bin/bash
# This script is used as BROWSER= for Metro to redirect "Open DevTools" to RN Debugger app
# Instead of opening Chrome, it opens our Electron app

if [ -d "/Applications/RN Debugger.app" ]; then
  open "/Applications/RN Debugger.app"
else
  echo "[RN Debugger] App not installed. Install from: https://github.com/sharanagouda/react-native-debugger/releases"
fi
