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

// ─── State ────────────────────────────────────────────────────────────────────
let reduxClients   = new Set();
let storageClients = new Set();
let networkClients = new Set();

// ─── Set dock icon ASAP (before app ready) ──────────────────────────────────
const _appIcon = nativeImage.createFromPath(path.join(__dirname, 'ReactoRadar.png'));

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';

  // Set dock icon on macOS
  if (process.platform === 'darwin' && !_appIcon.isEmpty()) {
    try { app.dock.setIcon(_appIcon); } catch {}
  }

  await createMainWindow();

  // Send version to renderer
  const appVersion = require('./package.json').version;
  mainWindow?.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send('app-version', appVersion);
  });

  // Check for updates (non-blocking)
  checkForUpdates();
  startBridgeServers();
  startReactDevToolsServer();
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
    mainWindow.webContents.send('ports', PORTS);
  });
}

// ─── Update Checker ──────────────────────────────────────────────────────────
function checkForUpdates() {
  const currentVersion = require('./package.json').version;
  https.get('https://registry.npmjs.org/reactoradar/latest', (res) => {
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => {
      try {
        const latest = JSON.parse(data).version;
        if (latest && latest !== currentVersion) {
          // Notify the renderer to show an update banner
          mainWindow?.webContents.send('update-available', { current: currentVersion, latest });
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
        mainWindow?.webContents.send('cdp-targets', rnTargets);
        if (callback) callback(rnTargets);
      } catch (_) {
        if (callback) callback([]);
      }
    });
  }).on('error', () => {
    lastKnownTargets = [];
    mainWindow?.webContents.send('cdp-targets', []);
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
        mainWindow?.webContents.send('react-dt-status', false);
      }
    });
    reactDTServer.on('connection', (ws) => {
      reactDTClients.add(ws);
      console.log(`[ReactDT] Client connected (total: ${reactDTClients.size})`);
      mainWindow?.webContents.send('react-dt-status', true);

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
          mainWindow?.webContents.send('react-dt-status', false);
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
    mainWindow?.webContents.send('redux-event', event);
  });

  // AsyncStorage Bridge
  startBridge(PORTS.STORAGE_BRIDGE, 'storage', storageClients, (event) => {
    mainWindow?.webContents.send('storage-event', event);
  });

  // Network + Console + Perf Bridge (port 9092 carries all types from RNDebugSDK)
  startBridge(PORTS.NETWORK_BRIDGE, 'network', networkClients, (event) => {
    if (event.type === 'control') return;
    if (event.type === 'console') {
      mainWindow?.webContents.send('console-event', event);
    } else if (event.type === 'perf') {
      mainWindow?.webContents.send('perf-event', event);
    } else if (event.type === 'ga4') {
      mainWindow?.webContents.send('ga4-event', event);
    } else {
      mainWindow?.webContents.send('network-event', event);
    }
  });
}

function startBridge(port, name, clients, onEvent) {
  const wss = new WebSocketServer({ port });
  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[${name}] RN app connected`);
    mainWindow?.webContents.send(`${name}-connected`, true);

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
        mainWindow?.webContents.send(`${name}-connected`, false);
      }
    });
  });
  console.log(`[${name}] Bridge on :${port}`);
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
            "lsof -i :8081 -t 2>/dev/null | head -1 | xargs -I{} lsof -p {} -Fn 2>/dev/null | grep '^n/' | grep 'node_modules' | head -1 | sed 's|^n||;s|/node_modules.*||'",
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
          click: () => { mainWindow?.webContents.send('trigger-open-cdp'); },
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
          click: () => { mainWindow?.webContents.send('clear-all-ui'); },
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
              mainWindow.webContents.send('theme-changed', next);
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
