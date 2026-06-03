'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const registeredChannels = new Set();

contextBridge.exposeInMainWorld('electronAPI', {
  // Listen from main (idempotent — only one listener per channel)
  on: (channel, cb) => {
    const allowed = [
      'ports', 'cdp-targets', 'redux-event', 'storage-event', 'network-event',
      'console-event', 'perf-event', 'ga4-event', 'redux-connected', 'storage-connected', 'network-connected',
      'react-dt-status', 'trigger-open-cdp', 'clear-all-ui', 'theme-changed', 'update-available', 'app-version', 'focus-search',
    ];
    if (allowed.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
      registeredChannels.add(channel);
      ipcRenderer.on(channel, (_, ...args) => cb(...args));
    }
  },
  // Send to main
  openCDPTarget: (wsUrl) => ipcRenderer.send('open-cdp-target', wsUrl),
  openReactDevTools: () => ipcRenderer.send('open-react-devtools'),
  clearAll: () => ipcRenderer.send('clear-all'),
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),
  setNetworkCapture: (enabled) => ipcRenderer.send('set-network-capture', enabled),
  setStackTraceCapture: (enabled) => ipcRenderer.send('set-stack-trace-capture', enabled),
  setNetworkThrottle: (profile) => ipcRenderer.send('set-network-throttle', profile),
  setMetroPort: (port) => ipcRenderer.send('set-metro-port', port),
  readSourceFile: (filepath) => ipcRenderer.invoke('read-source-file', filepath),
  openExternal: (url) => ipcRenderer.send('open-external', url),
});
