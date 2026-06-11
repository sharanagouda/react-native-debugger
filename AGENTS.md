# ReactoRadar — Architecture & Coding Rules

> **Read this file COMPLETELY before making ANY code changes.**
> This document defines the architecture, panel ownership, state contracts, and rules
> that must be followed to avoid breaking existing functionality.
>
> **NEVER release without passing the Pre-Release Checklist at the bottom.**

---

## File Structure

### Main Process
| File | Role |
|------|------|
| `main.js` | Electron main process — windows, IPC, bridges, native logs, menus |
| `preload.js` | Context bridge — IPC allowlist, renderer API surface |

### Renderer (loaded in this order via `<script>` tags in index.html)
| File | Role |
|------|------|
| `app.js` | **Shared state**, helpers (`$`, `esc`, `ts`), navigation, `clearAll`, `freeMemory`, `clearActiveTab`, `updateDeviceBanner`, `takeScreenshot` |
| `panels/settings.js` | Settings panel + **shared utilities** used by other panels: `TAB_CONFIG`, `isTabEnabled`, `applyTheme`, `getTabVisibility`, `applyTabVisibility`, hidden URLs, localStorage helpers, `_applyUpdateBanner`, `_showChangelog`, `_loadVersionHistory` |
| `panels/console.js` | Console panel + **shared renderers**: `collectEntries`, `objPreview`, `createTreeNode`, `showContextMenu`, `showToast`, `addConsoleLog` |
| `panels/network.js` | Network panel — `handleNetworkEvent`, `renderNetwork`, HAR export, detail view |
| `panels/ga4.js` | GA4 Events panel — `ga4State`, `handleGA4Event`, `renderGA4List`, `renderGA4Summary` |
| `panels/redux.js` | Redux panel — `handleReduxEvent`, `renderRedux`, `_createHighlightedTree`, state diff |
| `panels/storage.js` | AsyncStorage panel — `handleStorageEvent`, `renderStorage`, `formatSize` |
| `panels/performance.js` | Performance + Memory panels — `perfState`, `handlePerfEvent`, `handleMemoryEvent`, `initMemoryPanel` |
| `panels/native.js` | Native Logs panel — `_nativeState`, `initNativeLogsPanel`, `_appendNativeLog` |
| `panels/react.js` | React Tree panel — just a connect button |
| `panels/sources.js` | Sources panel — Metro source file browser (NOT initialized by default — no `panel-sources` in HTML) |
| `init.js` | **Boot script** (loaded LAST) — IPC wiring, button handlers, memory monitor, settings apply, panel init calls |

### Other
| File | Role |
|------|------|
| `styles.css` | All CSS — themes, panel styles, components |
| `index.html` | Shell HTML — nav sidebar, panel containers, script load order |
| `sdk/RNDebugSDK.js` | Client SDK injected into React Native apps |
| `bin/setup.js` | CLI setup script — copies SDK, patches RN project |

### Script Load Order (critical)
```
1. app.js            — state, $, esc, ts, clearAll, freeMemory (no panel dependencies)
2. panels/settings.js — TAB_CONFIG, isTabEnabled, localStorage helpers (used by all panels)
3. panels/console.js  — createTreeNode, showContextMenu, addConsoleLog (used by other panels)
4. panels/network.js  — depends on: console.js (showToast, showContextMenu, createTreeNode)
5. panels/ga4.js      — depends on: console.js (showContextMenu, createTreeNode)
6. panels/redux.js    — depends on: console.js (addConsoleLog, createTreeNode, showContextMenu)
7. panels/storage.js  — depends on: console.js (createTreeNode, showContextMenu)
8. panels/performance.js — depends on: settings.js (isTabEnabled)
9. panels/native.js   — depends on: settings.js (isTabEnabled)
10. panels/react.js   — no dependencies
11. panels/sources.js — no panel dependencies
12. init.js           — depends on ALL of the above (calls init functions, registers IPC)
```

---

## Current Working State (v1.6.10)

> **This section documents exactly what works. Any change MUST preserve all of this.**

### Panel Status

| Panel | Status | Init Function | File | DOM ID |
|-------|--------|---------------|------|--------|
| Console | WORKING | `initConsolePanel()` | `panels/console.js` | `panel-console` |
| Network | WORKING | `initNetworkPanel()` | `panels/network.js` | `panel-network` |
| Redux | WORKING | `initReduxPanel()` | `panels/redux.js` | `panel-redux` |
| GA4 Events | WORKING | `initGA4Panel()` | `panels/ga4.js` | `panel-ga4` |
| AsyncStorage | WORKING | `initStoragePanel()` | `panels/storage.js` | `panel-storage` |
| Performance | WORKING | `initPerformancePanel()` | `panels/performance.js` | `panel-performance` |
| Memory | WORKING | `initMemoryPanel()` | `panels/performance.js` | `panel-memory` |
| Native Logs | WORKING | `initNativeLogsPanel()` | `panels/native.js` | `panel-native` |
| React Tree | WORKING | `initReactPanel()` | `panels/react.js` | `panel-react` |
| Settings | WORKING | `initSettingsPanel()` | `panels/settings.js` | `panel-settings` |
| Sources | NOT INITIALIZED | `initSourcesPanel()` | `panels/sources.js` | NO DOM element — `panel-sources` does NOT exist in `index.html` |

### Init Sequence (in `init.js`)
```
initConsolePanel();
initNetworkPanel();
initGA4Panel();
initPerformancePanel();
initMemoryPanel();
initReduxPanel();
initStoragePanel();
initReactPanel();
initNativeLogsPanel();
initSettingsPanel();
```
**`initSourcesPanel()` is NOT called — intentional. No DOM element exists for it.**

### IPC Channels Currently Registered (in `init.js`)
All inside `if (window.electronAPI) { }` block:
```
ports, cdp-targets, redux-event, network-event, storage-event,
console-event, ga4-event, perf-event, clear-all-ui,
device-all-disconnected, redux-connected, network-connected,
storage-connected, react-dt-status, focus-search, app-version,
update-available, update-downloaded, trigger-open-cdp, theme-changed
```
Native panel registers `native-log` and `native-status` inside `initNativeLogsPanel()`.

### SDK Platform Detection
The SDK (`sdk/RNDebugSDK.js`) auto-detects the platform at runtime:
- **Android emulator** → `10.0.2.2` (requires `adb reverse` on ports 9090, 9091, 9092, 8097)
- **iOS simulator** → `127.0.0.1`
- **Real device** → Set `HOST_OVERRIDE` in SDK to Mac's LAN IP
- Detection uses `require('react-native').Platform.OS`

### Setup Script (`bin/setup.js`) Behavior
1. Copies `sdk/RNDebugSDK.js` → user's `src/debug/RNDebugSDK.js`
2. Patches `index.js` to import SDK
3. Store file detection order:
   - Step 1: Common directories (`src/store/`, `src/redux/`, etc.) with filenames `store.*`, `index.*`
   - Step 2: Root app files (`src/App.tsx`, `src/App.js`, `App.tsx`, `App.js`)
   - Step 3: Deep recursive scan for files with `createStore(` or `configureStore(` call syntax
4. Auto-patches RTK `configureStore` (adds middleware field)
5. Auto-patches legacy `createStore` if `const middleware = [...]` pattern found
6. Falls back to manual instructions if auto-patch fails
7. Runs `adb reverse` for Android ports
8. Only sets `HOST_OVERRIDE` for real device LAN IP; emulator/simulator uses auto-detect

### Redux Integration Requirements
- Connection to port 9090 ("RN app connected") does NOT mean events are flowing
- `reduxMiddleware` or `reduxEnhancer` MUST be wired into the store
- Events only flow when `store.dispatch()` goes through the middleware/enhancer
- Thunk/function actions are safely serialized as `{type: "[Function: thunk]"}`
- State > 1MB is truncated to `{__truncated: true, sizeBytes, keys}`

---

## Critical Rules — DO NOT VIOLATE

### 1. Every init function MUST have a null guard
```js
function initXxxPanel() {
  const panel = $('panel-xxx');
  if (!panel) return;  // ← REQUIRED — prevents crash if DOM element is missing
  panel.innerHTML = `...`;
}
```

### 2. Redux arrays MUST stay in sync
`state.redux.actions` and `state.redux.states` MUST have the same length.
Never empty one without emptying the other. In `freeMemory()`, always trim both together.

### 3. IPC channels MUST be in preload allowlist
Every new IPC channel MUST be added to the `allowed` array in `preload.js`.
If a channel is not in this array, the listener is **silently dropped** — no error, no warning.

### 4. IPC listeners MUST NOT be registered twice
The preload `on()` method calls `removeAllListeners(channel)` before adding.
Registering the same channel twice **kills the first listener**.
ALL IPC listeners go in `init.js` inside the `if (window.electronAPI) {}` block — nowhere else.

### 5. CSS variables — use ONLY defined variables
Themes define: `--bg`, `--bg2`, `--bg3`, `--bg4` (NOT `--bg1`)
`--text`, `--text-mid`, `--text-dim`, `--text-bright`
`--accent`, `--accent2`, `--border`, `--border2`
`--green`, `--yellow`, `--red`
**Never use `--bg1`** — it resolves to transparent/empty.

### 6. clearAll() and freeMemory() — check ALL panels
- `clearAll()` wipes everything + re-renders — used for Cmd+K
- `freeMemory()` trims heavy data without clearing UI — used on disconnect/quit
- After modifying either, verify ALL panels still render correctly
- Cancel pending `requestAnimationFrame` IDs before clearing data

### 7. Shared functions — check ALL callers before modifying
| Function | Used By |
|----------|---------|
| `$(id)` | Every panel |
| `esc(s)` | Every panel |
| `ts(ms)` | Console, Network, Redux, GA4, Native |
| `collectEntries(val)` | `objPreview()`, `createTreeNode()` |
| `objPreview(val)` | `createTreeNode()` |
| `createTreeNode(key, val, collapsed)` | Console, Network, Redux, Storage, GA4 |
| `showContextMenu(e, items)` | Console, Network, Redux, Storage, GA4, Native |
| `addConsoleLog(entry)` | Console IPC, Redux (`handleReduxEvent`), Network (error toasts) |
| `isTabEnabled(tabId)` | Redux, GA4, Storage, Native, Performance |
| `formatSize(bytes)` | Storage, Network, Memory |

### 8. package.json `files` field MUST include all runtime files
Current required entries:
```json
"files": ["main.js", "preload.js", "index.html", "app.js", "init.js", "panels/", "styles.css", "sdk/", "bin/", "assets/", "AGENTS.md"]
```
**If you add a new file, add it here or it won't be published to npm.**

---

## Panels — Ownership & State

### Console Panel (`panels/console.js`)
- **State:** `state.console.logs`, `state.console.levelFilters`, `state.console.searchFilter`, `state.console.showRedux`
- **Private state:** `_consolePending`, `_consoleRAF`, `_lastLogMsg`, `_lastLogRow`, `_lastLogCount`
- **IPC:** `console-event` → `addConsoleLog()`
- **Cross-panel:** Called by Redux (`handleReduxEvent` → `addConsoleLog`)
- **Constants:** `MAX_CONSOLE_LOGS = 5000`

### Network Panel (`panels/network.js`)
- **State:** `state.network.requests`, `state.network.order`, `state.network.selectedId`, `statusFilter`, `typeFilter`, `searchFilter`, `sortCol`, `sortDir`
- **Private state:** `_netRAF`
- **IPC:** `network-event` → `handleNetworkEvent()`
- **Cross-panel:** Calls `addConsoleLog()`, `showToast()`, `showContextMenu()`

### Redux Panel (`panels/redux.js`)
- **State:** `state.redux.actions`, `state.redux.states` (MUST be same length), `state.redux.selected`
- **IPC:** `redux-event` → `handleReduxEvent()`
- **Cross-panel:** Calls `addConsoleLog()` to mirror actions in console
- **Constants:** `MAX_REDUX_HISTORY = 500`

### GA4 Events Panel (`panels/ga4.js`)
- **State:** `ga4State` standalone object
- **IPC:** `ga4-event` → `handleGA4Event()`

### AsyncStorage Panel (`panels/storage.js`)
- **State:** `state.storage.entries`, `state.storage.keys`, `state.storage.selected`
- **Private state:** `_storageRAF`
- **IPC:** `storage-event` → `handleStorageEvent()`

### Performance Panel (`panels/performance.js`)
- **State:** `perfState` standalone object
- **IPC:** `perf-event` → `handlePerfEvent()`

### Memory Panel (`panels/performance.js`)
- **IPC:** `perf-event` → `handleMemoryEvent()` (shared channel with Performance)

### Native Logs Panel (`panels/native.js`)
- **State:** `_nativeState` standalone object
- **IPC:** `native-log`, `native-status` (registered inside `initNativeLogsPanel`, NOT in init.js)
- **Constants:** `MAX_NATIVE_LOGS = 2000`

### Settings Panel (`panels/settings.js`)
- **State:** All localStorage accessors
- **Shared utilities:** `TAB_CONFIG`, `isTabEnabled()`, `applyTheme()`, `getTabVisibility()`, `applyTabVisibility()`

### React Tree Panel (`panels/react.js`)
- Minimal — just a connect button for React DevTools

### Sources Panel (`panels/sources.js`)
- **NOT INITIALIZED** — `panel-sources` does not exist in `index.html`
- `initSourcesPanel()` has a null guard and returns early

---

## WebSocket Bridges (main.js)

| Port | Name | Client Set | Events Carried |
|------|------|------------|----------------|
| 9090 | Redux | `reduxClients` | `type: 'redux'` — action + nextState |
| 9091 | Storage | `storageClients` | `type: 'storage'` — key/value snapshots |
| 9092 | Network | `networkClients` | `type: 'console'`, `'network'`, `'perf'`, `'ga4'`, `'control'` |
| 8097 | React DT | `reactDTClients` | React DevTools relay (pass-through) |

### before-quit cleanup order
1. Send `device-all-disconnected` to renderer
2. Destroy `devtoolsWindow`
3. Close `reactDTServer` + clients
4. Close all bridge servers + clients
5. Kill `_nativeLogProcess`

---

## Rules for Making Changes

### Adding a new panel
1. Create `panels/newpanel.js` with `function initNewPanel() { const panel = $('panel-new'); if (!panel) return; ... }`
2. Add `<div id="panel-new" class="panel"></div>` to `index.html`
3. Add `<script src="panels/newpanel.js"></script>` to `index.html` BEFORE `init.js`
4. Add `initNewPanel();` to `init.js` init sequence
5. Add to `TAB_CONFIG` array in `panels/settings.js`
6. Add state to `clearAll()` and `freeMemory()` in `app.js`
7. Add case to `clearActiveTab()` in `app.js`

### Adding a new IPC channel
1. Add `ipcMain.on/handle` in `main.js` `setupIPC()`
2. Add channel name to `preload.js` allowed array
3. Add `window.electronAPI.on()` in `init.js` inside the `if (window.electronAPI)` block
4. **Test:** Verify the listener fires

### Modifying the SDK
1. Test on BOTH Android emulator AND iOS simulator
2. Verify `adb reverse` works for Android
3. Test hot reload — ensure no timer/WebSocket leaks
4. Test with Redux Thunk actions (function dispatches)
5. Test with large Redux state (>1MB)
6. Test with binary network responses (images, videos)

---

## Pre-Release Checklist

> **MANDATORY — Do NOT publish without passing ALL checks.**

### Automated Checks (run these commands)
```bash
# 1. Syntax check all files
for f in app.js init.js main.js preload.js panels/*.js sdk/RNDebugSDK.js bin/setup.js; do
  node -c "$f" || echo "FAIL: $f"
done

# 2. No duplicate functions
grep -rhn "^function [a-zA-Z_]" app.js init.js panels/*.js | sed 's/(.*//' | sort | uniq -c | sort -rn | awk '$1 > 1'

# 3. No duplicate top-level variables
grep -rhn "^const [a-zA-Z_]\|^let [a-zA-Z_]" app.js init.js panels/*.js | sed 's/ =.*//' | sort | uniq -c | sort -rn | awk '$1 > 1'

# 4. All critical functions exist
for fn in handleReduxEvent handleNetworkEvent handleStorageEvent handleGA4Event handlePerfEvent handleMemoryEvent clearAll freeMemory updateDeviceBanner initConsolePanel initNetworkPanel initGA4Panel initPerformancePanel initMemoryPanel initReduxPanel initStoragePanel initReactPanel initNativeLogsPanel initSettingsPanel addConsoleLog renderConsole renderNetwork renderRedux renderStorage renderGA4List closeNetDetail clearPerfCanvas showContextMenu createTreeNode isTabEnabled formatSize showToast takeScreenshot collectEntries _applyUpdateBanner _showChangelog; do
  found=$(grep -rln "function $fn\b" app.js init.js panels/*.js 2>/dev/null | head -1)
  [ -z "$found" ] && echo "MISSING: $fn"
done

# 5. npm pack includes all files
npm pack --dry-run 2>&1 | grep -c "panels/\|init.js\|sdk/\|bin/"
# Expected: 15+ files

# 6. IPC channels all in preload allowlist
# Every channel registered in init.js must be in preload.js allowed array
```

### Manual Checks (test in the running app)
- [ ] **App launches** — `npm start` opens the window, no blank screen
- [ ] **Console** — logs appear, level filters work, search works, Cmd+K clears
- [ ] **Network** — requests appear, detail panel opens/closes, search works, Cmd+K clears
- [ ] **Redux** — actions appear, state diff shows correctly, Cmd+K clears, works after disconnect/reconnect
- [ ] **GA4** — events appear, summary tab works, color toggle works
- [ ] **Storage** — keys appear, values render, search works
- [ ] **Performance** — Record button toggles, graphs render when data arrives
- [ ] **Memory** — heap values display when device connected
- [ ] **Native Logs** — Connect button works for Android/iOS, logs stream, Cmd+K clears
- [ ] **Settings** — theme switch works, font size changes, tab visibility toggles, version history loads
- [ ] **React Tree** — connect button shows
- [ ] **Device disconnect** — `freeMemory()` fires after 3s, panels still work after reconnect
- [ ] **Device reconnect** — cancel disconnect timer, new events flow immediately
- [ ] **Cmd+K** — clears active tab data (test on each tab)
- [ ] **All panels render** — switch through every tab, none show blank/white screen

### SDK Checks (test in RN app)
- [ ] **iOS simulator** — SDK connects with `127.0.0.1`, console/network/storage data flows
- [ ] **Android emulator** — SDK connects with `10.0.2.2` (after `adb reverse`), all data flows
- [ ] **Redux** — actions appear in Redux tab AND console (if showRedux enabled)
- [ ] **Hot reload** — reload RN app, SDK reconnects, no duplicate data/timers

### Setup Script Checks
- [ ] `npx reactoradar setup` — copies SDK, patches index.js, detects store file
- [ ] Redux auto-patch — adds `reduxMiddleware` to middleware array
- [ ] `npx reactoradar remove` — cleans up SDK and patches
- [ ] `adb reverse` — ports forwarded for Android

---

## Known Limitations

1. **Sources panel** — `panel-sources` div does not exist in `index.html`. `initSourcesPanel()` is not called. Panel is dormant.
2. **`npx reactoradar setup` store detection** — if store is in an unusual file (not `App.tsx`, not `store.*`), setup may not find it
3. **iOS real device** — requires manually setting `HOST_OVERRIDE` in the SDK
4. **`adb reverse` drops** — if Android emulator restarts, `adb reverse` must be re-run
5. **Performance `jsThread` metric** — currently uses `performance.now() % 16.67` which is approximate
