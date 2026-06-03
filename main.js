'use strict';

const { app, BrowserWindow, ipcMain, Menu, shell, nativeTheme, nativeImage } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const { WebSocketServer, WebSocket } = require('ws');

// ─── Ports ────────────────────────────────────────────────────────────────────
const PORTS = {
  METRO:         8081,   // Metro bundler (CDP proxy lives here)
  REACT_DT:      8097,   // react-devtools-core server port
  REDUX_BRIDGE:  9090,   // our custom Redux WS bridge
  STORAGE_BRIDGE:9091,   // AsyncStorage WS bridge
  NETWORK_BRIDGE:9092,   // Network intercept WS bridge
};

// ─── Windows ──────────────────────────────────────────────────────────────────
let mainWindow = null;
let devtoolsWindow = null;  // hosts the embedded CDP DevTools frontend

// Safe IPC send — prevents "Object has been destroyed" crash
function _send(channel, ...args) {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  } catch {}
}

// ─── State ────────────────────────────────────────────────────────────────────
let reduxClients   = new Set();
let storageClients = new Set();
let networkClients = new Set();

// ─── Set dock icon ASAP (before app ready) ──────────────────────────────────
const _appIcon = nativeImage.createFromPath(path.join(__dirname, 'ReactoRadar.png'));

// ─── Single Instance Lock ────────────────────────────────────────────────────
// Prevent multiple ReactoRadar instances from running simultaneously.
// If a second instance launches, focus the existing window instead.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another instance is already running — show a dialog and quit
  const { dialog } = require('electron');
  app.whenReady().then(() => {
    dialog.showErrorBox(
      'ReactoRadar is already running',
      'Another instance of ReactoRadar is already open.\n\nPlease close the existing instance first, or check your system tray / dock.\n\nIf the old version is stuck, run:\n  kill $(lsof -ti :9092) \nin your terminal to stop it.'
    );
    app.quit();
  });
} else {
  app.on('second-instance', () => {
    // Focus the existing window when someone tries to open a second instance
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
if (gotLock) app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';

  // Set dock icon on macOS
  if (process.platform === 'darwin' && !_appIcon.isEmpty()) {
    try { app.dock.setIcon(_appIcon); } catch {}
  }

  await createMainWindow();

  // Send version to renderer — try package.json, fallback to app.getVersion()
  let appVersion;
  try { appVersion = require('./package.json').version; } catch { appVersion = app.getVersion(); }
  // Send multiple times to ensure renderer catches it
  mainWindow.webContents.on('did-finish-load', () => {
    [200, 1000, 3000].forEach(delay => {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          _send('app-version', appVersion);
        }
      }, delay);
    });
  });

  // Check for updates (non-blocking)
  checkForUpdates();
  startBridgeServers();
  // React DevTools relay NOT started by default — it blocks RN's built-in inspector.
  // Started on-demand when user clicks React tab or Cmd+R.
  setupMetroCDPProxy();
  setupIPC();
  buildMenu();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // Close all WS servers gracefully
  if (reactDTServer) {
    reactDTServer.close();
    reactDTClients.forEach(ws => ws.close());
    reactDTClients.clear();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

// ─── Main Window ──────────────────────────────────────────────────────────────
async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0b0e',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: _appIcon,
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Open the JS Debugger panel (CDP DevTools) in a second window
  mainWindow.webContents.on('did-finish-load', () => {
    _send('ports', PORTS);
  });
}

// ─── Update Checker ──────────────────────────────────────────────────────────
function _semverCompare(a, b) {
  // Returns 1 if a > b, -1 if a < b, 0 if equal
  const pa = (a || '').split('.').map(Number);
  const pb = (b || '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0, vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

function checkForUpdates() {
  const currentVersion = require('./package.json').version;
  https.get('https://registry.npmjs.org/reactoradar/latest', (res) => {
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => {
      try {
        const latest = JSON.parse(data).version;
        if (latest && _semverCompare(latest, currentVersion) > 0) {
          // Send with retries to ensure renderer catches it after did-finish-load
          const payload = { current: currentVersion, latest };
          [500, 2000, 5000].forEach(delay => {
            setTimeout(() => {
              if (mainWindow && !mainWindow.isDestroyed()) {
                _send('update-available', payload);
              }
            }, delay);
          });
          console.log(`[Update] New version available: ${latest} (current: ${currentVersion})`);
        }
      } catch {}
    });
  }).on('error', () => {}); // Silently fail — update check is optional
}

// ─── CDP DevTools Window (JS breakpoints, Sources, Console) ──────────────────
let lastKnownTargets = [];

function openCDPWindow(target) {
  if (devtoolsWindow && !devtoolsWindow.isDestroyed()) {
    devtoolsWindow.focus();
    return;
  }

  // Build the frontend URL from Metro's provided devtoolsFrontendUrl
  // Metro /json/list returns: { devtoolsFrontendUrl: "/debugger-frontend/rn_fusebox.html?ws=...", ... }
  let frontendUrl;
  if (target.devtoolsFrontendUrl) {
    // Metro provides the exact path — use it
    frontendUrl = `http://localhost:${PORTS.METRO}${target.devtoolsFrontendUrl}`;
  } else if (target.webSocketDebuggerUrl) {
    // Fallback: construct URL manually with rn_fusebox (RN 0.76+) or rn_inspector (older)
    const wsUrl = target.webSocketDebuggerUrl;
    frontendUrl = `http://localhost:${PORTS.METRO}/debugger-frontend/rn_fusebox.html?ws=${encodeURIComponent(wsUrl)}&sources.hide_add_folder=true`;
  } else {
    console.warn('[CDP] No usable target URL');
    return;
  }

  const titleSuffix = target.deviceName ? ` — ${target.deviceName}` : '';
  devtoolsWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0b0e',
    title: `JS Debugger${titleSuffix}`,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  console.log(`[CDP] Loading DevTools: ${frontendUrl}`);
  devtoolsWindow.loadURL(frontendUrl);

  devtoolsWindow.on('closed', () => { devtoolsWindow = null; });
}

// ─── Metro CDP — fetch targets on demand (no continuous polling) ──────────────
// Continuous polling causes Metro's dev-middleware WebSocket to crash with
// "readyState 3 (CLOSED)" when connections are opened/closed rapidly.
// Instead, we fetch targets only when the user needs them.
function fetchCDPTargets(callback) {
  http.get(`http://localhost:${PORTS.METRO}/json/list`, (res) => {
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => {
      try {
        const targets = JSON.parse(data);
        const rnTargets = targets.filter(t =>
          t.type === 'node' || t.devtoolsFrontendUrl
        );
        lastKnownTargets = rnTargets;
        _send('cdp-targets', rnTargets);
        if (callback) callback(rnTargets);
      } catch (_) {
        if (callback) callback([]);
      }
    });
  }).on('error', () => {
    lastKnownTargets = [];
    _send('cdp-targets', []);
    if (callback) callback([]);
  });
}

function setupMetroCDPProxy() {
  // Single fetch after app starts (not continuous polling)
  setTimeout(() => fetchCDPTargets(), 3000);
}

// ─── React DevTools Relay Server (Component Tree + Profiler) ─────────────────
// React Native automatically connects to ws://localhost:8097 in dev mode.
// We run a simple WS relay on that port. When a standalone react-devtools
// window connects (via `npx react-devtools`) or when the RN app connects,
// we track the connection and relay messages between frontend ↔ backend.
let reactDTServer = null;
let reactDTClients = new Set();

function startReactDevToolsServer() {
  try {
    reactDTServer = new WebSocketServer({ port: PORTS.REACT_DT });
    reactDTServer.on('error', (err) => {
      console.warn(`[ReactDT] Server error: ${err.message}`);
      if (err.code === 'EADDRINUSE') {
        _send('react-dt-status', false);
      }
    });
    reactDTServer.on('connection', (ws) => {
      reactDTClients.add(ws);
      console.log(`[ReactDT] Client connected (total: ${reactDTClients.size})`);
      _send('react-dt-status', true);

      // Relay messages between all connected clients (frontend ↔ backend)
      ws.on('message', (data) => {
        reactDTClients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(data);
          }
        });
      });

      ws.on('close', () => {
        reactDTClients.delete(ws);
        console.log(`[ReactDT] Client disconnected (total: ${reactDTClients.size})`);
        if (reactDTClients.size === 0) {
          _send('react-dt-status', false);
        }
      });
    });
    console.log(`[ReactDT] Relay server on :${PORTS.REACT_DT}`);
  } catch (e) {
    console.warn('[ReactDT] Failed to start relay server:', e.message);
  }
}

// ─── Bridge Servers (Redux, Storage, Network) ─────────────────────────────────
function startBridgeServers() {
  // Redux Bridge
  startBridge(PORTS.REDUX_BRIDGE, 'redux', reduxClients, (event) => {
    _send('redux-event', event);
  });

  // AsyncStorage Bridge
  startBridge(PORTS.STORAGE_BRIDGE, 'storage', storageClients, (event) => {
    _send('storage-event', event);
  });

  // Network + Console + Perf Bridge (port 9092 carries all types from RNDebugSDK)
  startBridge(PORTS.NETWORK_BRIDGE, 'network', networkClients, (event) => {
    if (event.type === 'control') return;
    if (event.type === 'console') {
      _send('console-event', event);
    } else if (event.type === 'perf') {
      _send('perf-event', event);
    } else if (event.type === 'ga4') {
      _send('ga4-event', event);
    } else {
      _send('network-event', event);
    }
  });
}

function startBridge(port, name, clients, onEvent) {
  try {
    const wss = new WebSocketServer({ port });
    wss.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[${name}] Port ${port} is already in use — another ReactoRadar or debugger may be running.`);
        const { dialog } = require('electron');
        dialog.showErrorBox(
          `Port ${port} is in use`,
          `ReactoRadar cannot start the ${name} bridge because port ${port} is already occupied.\n\nThis usually means an older version of ReactoRadar is still running.\n\nTo fix this, run the following in your terminal:\n  kill $(lsof -ti :${port})\n\nThen restart ReactoRadar.`
        );
      }
    });
    wss.on('connection', (ws) => {
      clients.add(ws);
      console.log(`[${name}] RN app connected`);
      _send(`${name}-connected`, true);

      ws.on('message', (raw) => {
        try {
          const event = JSON.parse(raw.toString());
          onEvent(event);
        } catch (e) {
          console.warn(`[${name}] Failed to parse message:`, e.message);
        }
      });

      ws.on('close', () => {
        clients.delete(ws);
        if (clients.size === 0) {
          _send(`${name}-connected`, false);
        }
      });
    });
    console.log(`[${name}] Bridge on :${port}`);
  } catch (e) {
    console.error(`[${name}] Failed to start bridge on port ${port}:`, e.message);
  }
}

// ─── IPC from Renderer ────────────────────────────────────────────────────────
function setupIPC() {
  ipcMain.on('open-cdp-target', (_, wsUrl) => {
    // Always fetch fresh targets, then open
    fetchCDPTargets((targets) => {
      if (wsUrl && targets.length > 0) {
        const target = targets.find(t => t.webSocketDebuggerUrl === wsUrl) || targets[0];
        openCDPWindow(target);
      } else if (targets.length > 0) {
        const target = targets.find(t =>
          t.reactNative?.capabilities?.prefersFuseboxFrontend
        ) || targets[0];
        openCDPWindow(target);
      }
    });
  });

  ipcMain.on('open-react-devtools', () => {
    // Start the relay server if not already running
    if (!reactDTServer) startReactDevToolsServer();
    // Open standalone react-devtools window
    const rdtWin = new BrowserWindow({
      width: 1100,
      height: 700,
      titleBarStyle: 'hiddenInset',
      backgroundColor: '#0a0b0e',
      title: 'React DevTools',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    // Metro serves the React DevTools frontend at /debugger-ui
    rdtWin.loadURL(`http://localhost:${PORTS.METRO}/debugger-ui`);
  });

  // clear-all is handled by renderer via clear-all-ui IPC from menu

  ipcMain.on('set-metro-port', (_, port) => {
    const p = parseInt(port);
    if (isNaN(p) || p < 1024 || p > 65535) return;
    PORTS.METRO = p;
    fetchCDPTargets();
    _send('ports', PORTS);
  });

  ipcMain.on('set-network-capture', (_, enabled) => {
    // Broadcast to connected RN apps so they can stop/start intercepting
    networkClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'control', action: 'set-network-capture', enabled }));
      }
    });
  });

  // Track the RN project root — detected from Metro or setup
  let _rnProjectRoot = null;

  ipcMain.handle('read-source-file', async (_, filepath) => {
    const fs = require('fs');
    try {
      // Try absolute path first
      if (path.isAbsolute(filepath) && fs.existsSync(filepath)) {
        return fs.readFileSync(filepath, 'utf8');
      }

      // Find the RN project root by checking where Metro is running
      if (!_rnProjectRoot) {
        // Look for common project paths
        const candidates = [];
        // Check Metro's cwd by looking at the source map paths
        const home = process.env.HOME || '';
        // Scan for directories containing package.json with react-native
        // Dynamically find RN project directories
        const searchDirs = [];
        // Scan home directory for common RN project patterns
        try {
          const homeItems = require('fs').readdirSync(home);
          homeItems.forEach(dir => {
            const full = path.join(home, dir);
            try {
              const sub = require('fs').readdirSync(full);
              sub.forEach(s => {
                const projDir = path.join(full, s);
                if (require('fs').existsSync(path.join(projDir, 'package.json')) &&
                    require('fs').existsSync(path.join(projDir, 'node_modules', 'react-native'))) {
                  searchDirs.push(projDir);
                }
                // One level deeper (e.g., ~/Company/branch/project)
                try {
                  require('fs').readdirSync(projDir).forEach(ss => {
                    const deep = path.join(projDir, ss);
                    if (require('fs').existsSync(path.join(deep, 'package.json')) &&
                        require('fs').existsSync(path.join(deep, 'node_modules', 'react-native'))) {
                      searchDirs.push(deep);
                    }
                  });
                } catch {}
              });
            } catch {}
          });
        } catch {}
        // Also try to detect from Metro's /json endpoint
        try {
          const result = require('child_process').execSync(
            `lsof -i :${PORTS.METRO} -t 2>/dev/null | head -1 | xargs -I{} lsof -p {} -Fn 2>/dev/null | grep '^n/' | grep 'node_modules' | head -1 | sed 's|^n||;s|/node_modules.*||'`,
            { encoding: 'utf8', timeout: 3000 }
          ).trim();
          if (result && fs.existsSync(result)) candidates.unshift(result);
        } catch {}

        candidates.push(...searchDirs);
        for (const dir of candidates) {
          const full = path.join(dir, filepath);
          if (fs.existsSync(full)) {
            _rnProjectRoot = dir;
            break;
          }
        }
      }

      if (_rnProjectRoot) {
        const full = path.join(_rnProjectRoot, filepath);
        if (fs.existsSync(full)) return fs.readFileSync(full, 'utf8');
      }

      // Last resort: search recursively from home
      const homeSearch = path.join(process.env.HOME || '', filepath);
      if (fs.existsSync(homeSearch)) return fs.readFileSync(homeSearch, 'utf8');

      return null;
    } catch (e) {
      return null;
    }
  });

  ipcMain.on('set-stack-trace-capture', (_, enabled) => {
    networkClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'control', action: 'set-stack-trace', enabled }));
      }
    });
  });

  ipcMain.on('set-network-throttle', (_, profile) => {
    // Broadcast throttle config to connected RN apps
    networkClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'control', action: 'set-throttle', profile }));
      }
    });
  });

  ipcMain.on('open-external', (_, url) => {
    if (url && typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url);
    }
  });

  ipcMain.on('set-theme', (_, theme) => {
    nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark';
    const bg = theme === 'light' ? '#f5f6f8' : '#0a0b0e';
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(bg);
    }
  });
}

// ─── macOS App Menu ───────────────────────────────────────────────────────────
function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Debugger',
      submenu: [
        {
          label: 'Open JS Debugger (CDP)',
          accelerator: 'Cmd+D',
          click: () => { _send('trigger-open-cdp'); },
        },
        {
          label: 'Open React DevTools',
          accelerator: 'Cmd+R',
          click: () => { ipcMain.emit('open-react-devtools'); },
        },
        { type: 'separator' },
        {
          label: 'Clear All',
          accelerator: 'Cmd+K',
          click: () => { _send('clear-all-ui'); },
        },
        { type: 'separator' },
        {
          label: 'Next Theme',
          accelerator: 'Cmd+Shift+T',
          click: () => {
            const themes = ['dark','light','monokai','dracula','solarized-dark','solarized-light','nord','github-dark','one-dark'];
            const current = nativeTheme.themeSource || 'dark';
            const idx = themes.indexOf(current);
            const next = themes[(idx + 1) % themes.length];
            nativeTheme.themeSource = next.includes('light') ? 'light' : 'dark';
            if (mainWindow && !mainWindow.isDestroyed()) {
              _send('theme-changed', next);
            }
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'Cmd+F',
          click: () => { _send('focus-search'); },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
