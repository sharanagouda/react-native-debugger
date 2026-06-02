# RN Debugger — macOS Desktop App

> React Native 0.74+ | Hermes | New Architecture | No Flipper replacement needed

A standalone macOS debugger for React Native — Console, Sources, Network, Performance, Memory, Redux, AsyncStorage, and React component tree — all in one app.

---

## Quick Start

### 1. Install the debugger (one time)

```bash
cd /path/to/rn-debug-app
npm install
```

### 2. Setup from your RN project

From inside your React Native project directory:

```bash
npm run debug:setup
```

Or if you haven't added the script yet:

```bash
node /path/to/rn-debug-app/bin/setup.js
```

This automatically:
- Copies `RNDebugSDK.js` into `src/debug/`
- Detects your platform (iOS Sim / Android Emu / device) and sets HOST
- Patches `index.js` to load the SDK in dev mode
- Detects Redux and wires the debug middleware
- Runs `adb reverse` for Android (if detected)
- Adds `src/debug/RNDebugSDK.js` to `.gitignore`

### 3. Start debugging

```bash
# Terminal 1 — Launch the debugger app
cd /path/to/rn-debug-app
unset ELECTRON_RUN_AS_NODE && npm start

# Terminal 2 — Run your React Native app (from your RN project)
npx react-native start --reset-cache
```

### 4. Remove from your project

```bash
npm run debug:remove
```

---

## RN Project Scripts

Add these to your React Native project's `package.json`:

```json
"scripts": {
  "debug:setup": "node /path/to/rn-debug-app/bin/setup.js",
  "debug:remove": "node /path/to/rn-debug-app/bin/setup.js --uninstall"
}
```

Then:
```bash
npm run debug:setup      # install SDK + wire everything
npm run debug:remove     # clean uninstall
```

The setup script auto-detects that the current directory is a React Native project (no path argument needed).

---

## Tabs

| Tab | What it does |
|---|---|
| **Console** | Log viewer with collapsible object trees, level filters (log/info/warn/error), caller file:line display |
| **Sources** | Browse all source files from Metro bundle, view code with line numbers + syntax highlighting, "Breakpoints" button opens CDP DevTools |
| **Network** | Chrome DevTools-style network inspector — resizable columns (Name, Status, Type, Initiator, Size, Time, Waterfall), search filter, type filters (All/Fetch-XHR/JS/CSS/Img/Media/Font/Doc/WS), throttling (Fast 3G/Slow 3G/Offline), right-click Copy as cURL |
| **Performance** | Live FPS meter, JS Thread timing, UI Thread timing with real-time sparkline graphs |
| **Memory** | JS Heap Used/Total, Native Memory gauges from Hermes runtime |
| **Redux** | Action list with time travel (Prev/Next), State/Diff/Action tabs, previous/current/next action context |
| **App** | AsyncStorage key/value browser with search |
| **React** | React DevTools relay (component tree, props inspector) |
| **Settings** | Dark/Light theme toggle, connection port info, keyboard shortcuts |

---

## Network Tab Features

- **Resizable columns**: Drag the border line between any two column headers
- **Sortable**: Click any column header to sort (arrow indicator shows direction)
- **Newest first**: Default sort is by time descending
- **Search**: Filter input searches API URLs in real time
- **Type filters**: All | Fetch/XHR | JS | CSS | Img | Media | Font | Doc | WS
- **Throttling**: No throttling / Fast 3G (500ms delay) / Slow 3G (2s delay) / Offline
- **Detail view**: Click a row → detail pane opens on the right with Headers/Request/Preview/Response tabs
- **Copy as cURL**: Right-click any request → Copy as cURL / Copy URL / Copy Response
- **Preview**: Right-click in Preview tab → Copy Object / Copy Selection / Copy Value
- **Capture toggle**: ON/OFF switch to pause/resume network capture

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+K` | Clear all panels |
| `Cmd+D` | Open JS Debugger (CDP DevTools window with breakpoints) |
| `Cmd+R` | Open React DevTools window |
| `Cmd+Shift+T` | Toggle Dark / Light mode |
| `Cmd+C` | Copy selected text |
| `Cmd+V` | Paste into filter/search inputs |
| `Cmd+A` | Select all text in active area |

---

## Project Structure

```
rn-debug-app/
├── package.json          Electron app config + npm scripts
├── main.js               Electron main process (WS servers, CDP, IPC)
├── preload.js            IPC bridge (contextBridge, allowed channels)
├── index.html            App shell (titlebar, sidebar, 9 panel tabs)
├── styles.css            Dark + Light themes, all panel styles
├── app.js                Renderer logic (all panels)
├── RNDebugSDK.js         SDK — drop into your RN project
├── bin/setup.js          Auto-setup CLI
├── src/renderer/         Shared modules (state, object-tree)
│   ├── state.js
│   └── object-tree.js
└── assets/               App icon (optional for dev)
```

---

## Debugger App Scripts

| Command | What it does |
|---|---|
| `npm start` | Launch the debugger app |
| `npm run setup <path>` | Auto-configure an RN project (from debugger dir) |
| `npm run build` | Build `.dmg` for distribution |
| `npm run pack` | Build unpacked `.app` directory |

---

## Ports

| Port | Service | Direction |
|---|---|---|
| 9090 | Redux bridge | RN app → Debugger |
| 9091 | AsyncStorage bridge | RN app → Debugger |
| 9092 | Console + Network + Perf bridge | RN app → Debugger |
| 8097 | React DevTools relay | RN app ↔ DevTools |
| 8081 | Metro bundler (CDP) | Debugger → Metro |

Change ports in both `main.js` (PORTS) and `RNDebugSDK.js` (PORTS) if conflicts arise.

---

## Manual Setup (alternative)

If you prefer to wire things by hand instead of using `debug:setup`:

### 1. Copy the SDK

```bash
cp /path/to/rn-debug-app/RNDebugSDK.js <your-rn-project>/src/debug/RNDebugSDK.js
```

### 2. Set the HOST

Edit `src/debug/RNDebugSDK.js`:

```js
const HOST = '127.0.0.1';   // iOS Simulator
// const HOST = '10.0.2.2';  // Android Emulator
// const HOST = '192.168.x.x'; // Physical device (your Mac's LAN IP)
```

### 3. Patch the entry file

Add to the very top of `index.js` (before any other imports):

```js
if (__DEV__) {
  const { watchAsyncStorage } = require('./src/debug/RNDebugSDK');
  watchAsyncStorage();
}
```

### 4. Wire Redux

**Redux Toolkit (`configureStore`):**

```js
const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefault) =>
    __DEV__ ? getDefault().concat(require('./src/debug/RNDebugSDK').reduxMiddleware) : getDefault(),
});
```

**Legacy Redux (middleware array):**

```js
if (__DEV__) {
  middleware.push(require('./src/debug/RNDebugSDK').reduxMiddleware);
}
```

### 5. Android port forwarding

```bash
adb reverse tcp:9090 tcp:9090 && adb reverse tcp:9091 tcp:9091 && adb reverse tcp:9092 tcp:9092 && adb reverse tcp:8097 tcp:8097
```

### 6. Disable Reactotron networking (RN 0.81+)

If using Reactotron, set `networking: false` in ReactotronConfig to avoid `XHRInterceptor.js` warnings:

```js
.useReactNative({
  networking: false, // RNDebugSDK handles network interception
})
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| App won't launch: `Cannot read properties of undefined` | VS Code terminal sets `ELECTRON_RUN_AS_NODE=1`. Run: `unset ELECTRON_RUN_AS_NODE && npm start` |
| Device status shows "Waiting..." | Check HOST in `src/debug/RNDebugSDK.js`. iOS sim: `127.0.0.1`. Android emu: `10.0.2.2` |
| Android emulator can't connect | Run `adb reverse tcp:9090 tcp:9090 && adb reverse tcp:9091 tcp:9091 && adb reverse tcp:9092 tcp:9092` |
| Network tab empty | Run Metro with `--reset-cache` to pick up the latest SDK changes |
| `XHRInterceptor.js does not exist` warning | Set `networking: false` in ReactotronConfig.js |
| Metro crashes with `WebSocket readyState 3` | Update to latest debugger app — CDP polling was replaced with on-demand fetching |
| Console shows `RNDebugSDK.js:101` as caller | Update SDK — caller now skips SDK frames to show actual source file:line |
| AsyncStorage list flickers | Update SDK — snapshot deduplication prevents redundant re-renders |
| Sources tab shows "Waiting for Metro" | Metro must be running and bundle must be built. Wait for `BUNDLE ./index.js` in Metro output |
| `Debug JS Remotely` crashes app | Normal on RN 0.74+ Hermes — use "Open DevTools" or Cmd+D in debugger instead |

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                   macOS Electron App                   │
│                                                        │
│  Console │ Sources │ Network │ Perf │ Memory │ Redux   │
│  App (AsyncStorage) │ React │ Settings                 │
│       ↑        ↑         ↑       ↑       ↑            │
│       └────────┴─────────┴───────┴───────┘             │
│                  IPC (contextBridge)                    │
│                                                        │
│  main.js                                               │
│   ├─ WS Server :9092  ← console + network + perf      │
│   ├─ WS Server :9090  ← redux actions + state          │
│   ├─ WS Server :9091  ← asyncstorage mutations         │
│   ├─ WS Relay  :8097  ← react-devtools bridge          │
│   └─ HTTP      :8081  → Metro CDP (on-demand)          │
└────────────────────────────────────────────────────────┘
                ↑ WebSocket connections
┌────────────────────────────────────────────────────────┐
│               Your React Native App                    │
│                                                        │
│  RNDebugSDK.js (loaded in __DEV__ only)                │
│   ├─ console.* interceptor        → :9092              │
│   ├─ XHR constructor wrapper      → :9092              │
│   ├─ fetch interceptor            → :9092              │
│   ├─ FPS + memory metrics         → :9092              │
│   ├─ network throttle support     ← :9092 (control)    │
│   ├─ reduxMiddleware              → :9090              │
│   └─ watchAsyncStorage()          → :9091              │
│                                                        │
│  Built-in (no config needed):                          │
│   ├─ Hermes CDP (via Metro)       → :8081              │
│   └─ react-devtools-core          → :8097              │
└────────────────────────────────────────────────────────┘
```

---

## Building for Distribution

```bash
npm run build
# Output: dist/RN Debugger-1.0.0.dmg
```

Requirements:
- `assets/icon.icns` — macOS app icon (1024x1024, convert with `iconutil`)
- Apple Developer account for notarization (optional for personal use)
