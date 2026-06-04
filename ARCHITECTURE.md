# ReactoRadar: Technical Architecture & Data Flow Document

## 1. High-Level Architecture Overview

ReactoRadar operates on a **Client-Server-UI** architecture, bridging the React Native environment with a standalone macOS Electron application.

```
┌──────────────────┐     WebSocket     ┌──────────────────┐      IPC       ┌──────────────────┐
│   React Native   │ ───────────────── │  Electron Main   │ ────────────── │ Electron Renderer│
│   RNDebugSDK.js  │   :9090/91/92     │    main.js       │  contextBridge │   app.js + DOM   │
└──────────────────┘                   └──────────────────┘                └──────────────────┘
       CLIENT                               SERVER                              UI
```

### Three Layers:

1. **Client (`RNDebugSDK.js`)** — Runs inside the RN JavaScript runtime. Patches console, fetch, XHR, axios, Redux, AsyncStorage, Firebase Analytics. Sends data via WebSocket.
2. **Server (`main.js`)** — Runs in Node.js (Electron main process). Hosts WebSocket servers, routes data via IPC, manages CDP proxy, handles auto-updates.
3. **UI (`app.js` + `index.html`)** — Electron renderer. Receives IPC events, renders panels, manages state, handles user interactions.

---

## 2. Connection Lifecycle

### 2.1 Server Initialization (main.js)

When ReactoRadar launches, `main.js` starts three WebSocket servers:

| Port | Bridge | Data Types |
|------|--------|------------|
| 9092 | Main | Console, Network, GA4 Events, Performance metrics |
| 9090 | Redux | Redux actions + state snapshots |
| 9091 | Storage | AsyncStorage operations |

Each bridge uses the `startBridge(port, name, clients, onEvent)` function which:
- Creates a `WebSocketServer` on the port
- Handles `EADDRINUSE` errors with a user-friendly dialog
- Tracks connected clients in a `Set`
- Parses incoming JSON and routes to the appropriate IPC channel

### 2.2 Client Connection (RNDebugSDK.js)

When the RN app starts in `__DEV__` mode:

1. SDK creates three WebSocket channels via `makeChannel(port, name)`:
   - `mainCh` → port 9092 (console + network + GA4 + perf)
   - `reduxCh` → port 9090 (Redux)
   - `storageCh` → port 9091 (AsyncStorage)

2. Each channel has a **message queue** (max 300 messages). If the server isn't running, messages are queued and flushed on connect.

3. Auto-reconnect every 2 seconds on disconnect.

### 2.3 HOST Resolution

The SDK connects to different hosts based on the device:

| Device | HOST | Mechanism |
|--------|------|-----------|
| iOS Simulator | `127.0.0.1` | Shares Mac's localhost |
| Android Emulator | `10.0.2.2` | Special alias for host machine |
| Android real device (USB) | `10.0.2.2` | `adb reverse` tunnels ports over USB |
| iOS real device | Mac's LAN IP | Auto-detected (e.g., `192.168.1.15`) |

The `setup.js` script auto-detects the platform and patches the HOST constant.

### 2.4 Single Instance Lock

ReactoRadar uses `app.requestSingleInstanceLock()` to prevent multiple instances from running simultaneously. If a second instance launches, it shows an error dialog and focuses the existing window.

---

## 3. Data Interception (SDK)

### 3.1 Console Logs

```
console.log("Hello")
    │
    ▼
SDK wrapper: _console.log("Hello")  ← calls original (still shows in Metro)
    │
    ▼
serializeArg() → { t: 'string', v: 'Hello' }
    │
    ▼
_extractCaller() → 'App.tsx:42 (MyComponent)'
    │
    ▼
mainCh.send({ type: 'console', level: 'log', message: 'Hello', args: [...], caller: '...' })
```

**Stack trace extraction**: Uses regex parsing on `new Error().stack` to find the real caller, skipping SDK internals, minified names, and framework frames.

### 3.2 Network (Fetch + XHR + Axios)

Three-layer interception ensures nothing is missed:

**Fetch**: Replaces `global.fetch`. Captures request → awaits response → clones body via `resp.clone().text()` → sends timing + payload.

**XHR**: Wraps the `XMLHttpRequest` **constructor** (not prototype). Each new instance gets wrapped `.open()`, `.send()`, `.setRequestHeader()`, and a `readystatechange` listener. This avoids prototype chain conflicts with Reactotron and RN internals.

**Axios**: Dynamically `require('axios')` after a tick, then injects request/response interceptors on both the default instance and `axios.create()`.

### 3.3 Redux

Two mechanisms available:

- **`reduxMiddleware`**: For RTK `configureStore` — middleware that calls `next(action)` then sends `{ action, nextState }` to the Redux channel.
- **`reduxEnhancer`**: For legacy `createStore` — wraps `store.dispatch` to capture actions and state.

### 3.4 Firebase Analytics (GA4)

Patches the **prototype** of `@react-native-firebase/analytics` instances:
- Wraps ALL `log*` methods (logEvent, logPurchase, logScreenView, etc.)
- Wraps ALL `set*` methods (setUserId, setUserProperty, setConsent, etc.)
- Uses delayed retries (`[100, 500, 2000, 5000]ms`) to handle dynamic module loading

### 3.5 Debugger Detection

The SDK runs `_checkDebuggerAttached()` every 3 seconds:
- Checks `global.__DEBUGGER_CONNECTED__` (Hermes)
- Checks `global.__REACT_DEVTOOLS_GLOBAL_HOOK__._debuggerAttached`
- Does **NOT** check `global.__inspector` (always present on Hermes — false positive)

When a debugger is detected, `_shouldIntercept()` returns `false` and all interception is bypassed. Auto-resumes when debugger disconnects.

---

## 4. Data Pipeline: Server → UI

### 4.1 IPC Routing (main.js → preload.js → app.js)

```
WebSocket message received
    │
    ▼
main.js: JSON.parse(raw) → determine type
    │
    ├─ type === 'console'  → _send('console-event', event)
    ├─ type === 'network'  → _send('network-event', event)
    ├─ type === 'redux'    → _send('redux-event', event)
    ├─ type === 'ga4'      → _send('ga4-event', event)
    ├─ type === 'perf'     → _send('perf-event', event)
    └─ type === 'storage'  → _send('storage-event', event)
    │
    ▼
_send() helper: checks mainWindow.isDestroyed() + webContents.isDestroyed()
    │
    ▼
preload.js: contextBridge exposes window.electronAPI.on(channel, callback)
    │
    ▼
app.js: handler functions (addConsoleLog, handleNetworkEvent, handleReduxEvent, etc.)
```

### 4.2 Batched Rendering

Console logs use `requestAnimationFrame` batching:
1. `addConsoleLog()` pushes to `_consolePending[]` array
2. Schedules a single `requestAnimationFrame(flushConsoleBatch)`
3. `flushConsoleBatch()` processes the entire batch in one paint cycle
4. Consecutive identical messages are grouped with a count badge

### 4.3 Tab Gating

When a tab is disabled in Settings, its event handler returns immediately:
```js
function handleReduxEvent(event) {
  if (!isTabEnabled('redux')) return;  // ← skips all processing
  // ... rest of handler
}
```
This saves memory by not storing state for unused panels.

---

## 5. Memory Management

### Limits

| Data | Max Items | Behavior |
|------|-----------|----------|
| Console logs (array) | 5,000 | Oldest dropped |
| Console DOM rows | 2,000 | Oldest DOM nodes removed |
| Network requests | 1,000 | Oldest requests deleted |
| Redux actions + states | 500 | Oldest pairs trimmed, indices re-numbered |

### Memory Monitor

A `setInterval` (30s) checks `performance.memory.usedJSHeapSize`. At 70% of `jsHeapSizeLimit`, a warning banner appears with "Clear All Data" and "Dismiss" buttons.

---

## 6. Auto-Update System

### For .dmg installs (packaged app):
- Uses `electron-updater` with GitHub Releases as provider
- Checks on startup (5s delay) + every 2 hours
- Flow: `update-available` → auto-download → `update-downloaded` → "Restart & Update" button in Settings

### For npx users:
- Falls back to npm registry check (`https://registry.npmjs.org/reactoradar/latest`)
- Shows "Download vX.Y.Z" button linking to GitHub Releases

### Semver comparison:
Uses `_semverCompare(a, b)` — proper numeric comparison of `major.minor.patch`, not string equality.

---

## 7. CDP & JS Debugger Integration

1. `fetchCDPTargets()` polls `http://localhost:{metroPort}/json/list` every 3 seconds
2. Returns Hermes debugger WebSocket URLs
3. "JS Debugger" button shows port + target count
4. Click opens `rn_fusebox.html` DevTools frontend in a new Electron `BrowserWindow`
5. Full breakpoint, stepping, variable inspection, and call stack support

---

## 8. Setup Script (bin/setup.js)

The setup script performs:

1. **Platform detection** — Checks for iOS Simulator, Android Emulator, iOS/Android real devices
2. **LAN IP detection** — Uses `os.networkInterfaces()` for real device HOST configuration
3. **SDK copy** — Copies `sdk/RNDebugSDK.js` to `src/debug/RNDebugSDK.js` with HOST patched
4. **Entry file patching** — Adds `if (__DEV__) require('./src/debug/RNDebugSDK')` to `index.js`
5. **Redux auto-wiring** — Finds store file (deep search up to 4 levels), computes correct relative import path, patches `configureStore` or shows manual instructions
6. **adb reverse** — Sets up port forwarding for Android devices
7. **Path repair** — On re-run, detects and fixes stale/broken require paths from older versions

---

## Summary Flowchart

```
[ React Native App ]
       │
       ├─> console.log() / fetch() / dispatch()
       │
[ RNDebugSDK.js ] ─── Debugger detected? ─── YES ──> bypass (no-op)
       │                                       │
       NO                                      │
       │                                       │
       ├─> WebSocket ws://HOST:9092 (console + network + ga4 + perf)
       ├─> WebSocket ws://HOST:9090 (redux)
       ├─> WebSocket ws://HOST:9091 (storage)
       ▼
[ Electron main.js ]
       │
       ├─> _send('console-event')
       ├─> _send('network-event')
       ├─> _send('redux-event')
       ▼
[ preload.js ] ── contextBridge ──> window.electronAPI.on()
       │
       ▼
[ app.js ]
       │
       ├─> Tab enabled? ── NO ──> return (save memory)
       │        │
       │       YES
       │        │
       ├─> addConsoleLog()    → batched RAF → DOM append + log grouping
       ├─> handleNetworkEvent → renderNetwork() + stats bar + toast
       ├─> handleReduxEvent   → store action/state + renderRedux()
       ├─> handleGA4Event     → renderGA4List() + summary chips
       ▼
[ index.html ] ── Displays to Developer
```

---

## Support

If ReactoRadar helps your workflow: [Support this project](https://razorpay.me/@reactoradar)
