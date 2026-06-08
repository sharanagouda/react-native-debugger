# ReactoRadar — Architecture & Coding Rules

> **Read this file before making ANY code changes.**
> This document defines the architecture, panel ownership, state contracts, and rules
> that must be followed to avoid breaking existing functionality.

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
| `panels/sources.js` | Sources panel — Metro source file browser |
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
1. app.js          — state, $, esc, ts, clearAll, freeMemory (no panel dependencies)
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

## Critical Rule: Do NOT Break Other Panels

**Every panel is currently in a single `app.js` file.** Changes to one panel can silently
break another. Before making any change, check:

1. **Shared state** — Is the variable you're touching read/written by other panels?
2. **Shared functions** — Is the function you're modifying called from other panels?
3. **IPC listeners** — The preload `on()` method calls `removeAllListeners(channel)`.
   Registering the same channel twice **kills the first listener**.
4. **Array sync** — `state.redux.actions` and `state.redux.states` MUST have the same length.
   Never empty one without emptying the other.

---

## Panels — Ownership & State

### Console Panel
- **Init:** `initConsolePanel()` (app.js)
- **State owned:**
  - `state.console.logs` — array of log entries
  - `state.console.levelFilters` — `{log, info, warn, error, debug}` booleans
  - `state.console.searchFilter` — string
  - `state.console.showRedux` — boolean (show redux actions in console)
  - `_consolePending` — batch queue for rAF rendering
  - `_consoleRAF` — pending requestAnimationFrame ID
  - `_lastLogMsg`, `_lastLogRow`, `_lastLogCount` — log grouping state
- **IPC channels:** `console-event` (line 921)
- **Key functions:** `addConsoleLog()`, `flushConsoleBatch()`, `renderConsole()`, `buildLogRow()`, `buildLogBody()`
- **Cross-panel dependency:** Called by Redux (`handleReduxEvent` → `addConsoleLog`)
- **Constants:** `MAX_CONSOLE_LOGS = 5000`

### Network Panel
- **Init:** `initNetworkPanel()` (app.js)
- **State owned:**
  - `state.network.requests` — `{id: requestObj}` map
  - `state.network.order` — array of request IDs
  - `state.network.selectedId`, `statusFilter`, `typeFilter`, `searchFilter`, `throttle`, `enabled`, `sortCol`, `sortDir`
  - `_netRAF` — pending requestAnimationFrame ID
- **IPC channels:** `network-event` (line 357)
- **Key functions:** `handleNetworkEvent()`, `renderNetwork()`, `buildNetRow()`, `selectNetRequest()`, `closeNetDetail()`
- **Cross-panel dependency:** Calls `addConsoleLog()` for error toasts; calls `showToast()`
- **Constants:** `NET_COLS` (column definitions)

### Redux Panel
- **Init:** `initReduxPanel()` (app.js)
- **State owned:**
  - `state.redux.actions` — array of action entries
  - `state.redux.states` — array of full state snapshots (**MUST be same length as actions**)
  - `state.redux.selected` — selected action index (-1 = none)
  - `state.redux.searchFilter`, `sortDir`
  - `_reduxCatColors`, `_reduxColorIdx` — action category color cache
- **IPC channels:** `redux-event` (line 356)
- **Key functions:** `handleReduxEvent()`, `renderRedux()`, `_createHighlightedTree()`, `_deepEqual()`, `_findLeafChanges()`
- **Cross-panel dependency:** Calls `addConsoleLog()` to mirror actions in console
- **CRITICAL:** `actions` and `states` arrays must always be the same length. Never clear one without the other.
- **Constants:** `MAX_REDUX_HISTORY = 500`

### GA4 Events Panel
- **Init:** `initGA4Panel()` (app.js)
- **State owned:**
  - `ga4State` — standalone object: `{events, selected, searchFilter, sortDir, _raf}`
  - `_ga4EventColors`, `_ga4ColorIdx` — event color cache
- **IPC channels:** `ga4-event` (line 360)
- **Key functions:** `handleGA4Event()`, `renderGA4List()`, `renderGA4Detail()`, `renderGA4Summary()`

### Storage Panel
- **Init:** `initStoragePanel()` (app.js)
- **State owned:**
  - `state.storage.entries` — `{key: value}` map
  - `state.storage.keys` — ordered key array
  - `state.storage.selected`, `searchFilter`
  - `_storageRAF` — pending requestAnimationFrame ID
- **IPC channels:** `storage-event` (line 358)
- **Key functions:** `handleStorageEvent()`, `renderStorage()`, `renderStorageValue()`

### Performance Panel
- **Init:** `initPerformancePanel()` (app.js)
- **State owned:**
  - `perfState` — standalone object: `{fps, jsThread, uiThread, recording, data}`
- **IPC channels:** `perf-event` (line 362, shared with Memory)
- **Key functions:** `handlePerfEvent()`, `drawPerfGraph()`, `clearPerfCanvas()`

### Memory Panel
- **Init:** `initMemoryPanel()` (app.js)
- **State owned:** None (displays live values from perf events)
- **IPC channels:** `perf-event` (line 362, shared with Performance)
- **Key functions:** `handleMemoryEvent()`

### Native Logs Panel
- **Init:** `initNativeLogsPanel()` (app.js)
- **State owned:**
  - `_nativeState` — standalone object: `{logs, connected, platform, levelFilter, searchFilter}`
- **IPC channels:** `native-log`, `native-status` (registered inside init, lines 3429, 3440)
- **Key functions:** `_clearNativeLogs()`, `_appendNativeLog()`, `_renderNativeLogs()`, `_autoDetectNative()`
- **Constants:** `MAX_NATIVE_LOGS`

### Settings Panel
- **Init:** `initSettingsPanel()` (app.js)
- **State owned:** All localStorage accessors (theme, font, app name, metro port, tab visibility, tab order, hidden URLs)
- **Key functions:** `applyTheme()`, `applyFontSize()`, `applyFontFamily()`, `applyAppName()`, `applyTabVisibility()`, `_buildTabVisGrid()`, `_loadVersionHistory()`
- **Constants:** `TAB_CONFIG`, `FONT_FAMILIES`

### Sources Panel
- **Init:** `initSourcesPanel()` (app.js)
- **Key functions:** `fetchSourceFileList()`, `renderSourceFileList()`, `buildSourceTreeNode()`, `loadSourceFile()`

### React Tree Panel
- **Init:** `initReactPanel()` (app.js)
- **Minimal** — just a connect button for React DevTools

---

## Shared Utilities — DO NOT MODIFY without checking all callers

| Function | Used By |
|----------|---------|
| `$(id)` | Every panel |
| `esc(s)` | Every panel |
| `ts(ms)` | Console, Network, Redux, GA4, Native |
| `collectEntries(val)` | `objPreview()`, `createTreeNode()` |
| `objPreview(val)` | `createTreeNode()` |
| `createTreeNode(key, val, collapsed)` | Console, Network, Redux, Storage, GA4 |
| `createPrimitiveSpan(val)` | `createTreeNode()`, `renderConsoleArg()` |
| `showContextMenu(e, items)` | Console, Network, Redux, Storage, GA4, Native |
| `clearAll()` | IPC `clear-all-ui`, memory warning |
| `freeMemory()` | IPC `device-all-disconnected` (debounced) |
| `clearActiveTab()` | Keyboard shortcut Cmd+K |
| `isTabEnabled(tabId)` | Redux, GA4, Storage, Native, Performance |
| `formatSize(bytes)` | Storage, Network, Memory |
| `switchPanel(panel)` | Navigation, tab visibility, toasts |
| `updateDeviceBanner(service, on)` | IPC connection handlers |
| `showToast(msg, type, panel)` | Network |

---

## IPC Channel Registry

### Renderer listens (app.js → via preload allowlist)

| Channel | Handler | Panel |
|---------|---------|-------|
| `ports` | Sets `state.ports` | Global |
| `cdp-targets` | Updates CDP button | Global |
| `redux-event` | `handleReduxEvent` | Redux |
| `network-event` | `handleNetworkEvent` | Network |
| `storage-event` | `handleStorageEvent` | Storage |
| `console-event` | `addConsoleLog` | Console |
| `ga4-event` | `handleGA4Event` | GA4 |
| `perf-event` | `handlePerfEvent` + `handleMemoryEvent` | Perf + Memory |
| `redux-connected` | `updateDeviceBanner` + cancel disconnect timer | Global |
| `network-connected` | `updateDeviceBanner` + cancel disconnect timer | Global |
| `storage-connected` | `updateDeviceBanner` + cancel disconnect timer | Global |
| `react-dt-status` | `updateDeviceBanner` | Global |
| `clear-all-ui` | `clearAll()` | Global |
| `device-all-disconnected` | debounced `freeMemory()` | Global |
| `app-version` | Sets `state._appVersion`, `state._isPackaged` | Settings |
| `update-available` | `_applyUpdateBanner()` | Settings |
| `update-downloaded` | `_applyUpdateBanner()` | Settings |
| `trigger-open-cdp` | Opens CDP | Global |
| `theme-changed` | Applies theme | Settings |
| `focus-search` | Focuses active panel search | Global |
| `native-log` | Appends native log | Native (registered inside init) |
| `native-status` | Updates native connection status | Native (registered inside init) |

### Preload allowlist (preload.js)

**Every new IPC channel MUST be added to the `allowed` array in `preload.js` line 10-14.**
If a channel is not in this array, the listener is silently dropped — no error, no warning.

### Main process sends (main.js)

| Channel | Sent from |
|---------|-----------|
| `redux-event` | `startBridge` callback for Redux bridge (port 9090) |
| `network-event` | `startBridge` callback for Network bridge (port 9092) |
| `storage-event` | `startBridge` callback for Storage bridge (port 9091) |
| `console-event` | `startBridge` callback for Network bridge (type=console) |
| `perf-event` | `startBridge` callback for Network bridge (type=perf) |
| `ga4-event` | `startBridge` callback for Network bridge (type=ga4) |
| `*-connected` | `startBridge` on WS connect/disconnect |
| `device-all-disconnected` | `startBridge` when all 3 bridges have 0 clients |
| `clear-all-ui` | Menu Cmd+K handler |
| `app-version` | `createMainWindow` on `did-finish-load` |
| `native-log` | Native log process stdout parser |
| `native-status` | Native log start/stop/error |

---

## Main Process (main.js) — Structure

### WebSocket Bridges

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
5. Kill `_nativeLogProcess` (second `before-quit` handler inside `setupIPC`)

---

## Rules for Making Changes

### 1. Adding a new panel
- Add init function: `initXxxPanel()`
- Add to `TAB_CONFIG` array
- Add to init sequence at bottom of app.js
- Add state to `clearAll()` and `freeMemory()` if the panel stores data
- Add case to `clearActiveTab()` if the panel has clearable data

### 2. Adding a new IPC channel
- Add `ipcMain.on/handle` in `main.js` `setupIPC()`
- Add channel name to `preload.js` allowed array (line 10-14)
- Add `window.electronAPI.on()` in app.js or expose send method in preload
- **Test:** Verify the listener fires by adding a `console.log` in the handler

### 3. Modifying shared state
- Check all panels that read/write the field (see tables above)
- **Redux arrays:** `actions` and `states` must stay in sync
- **rAF IDs:** Cancel with `cancelAnimationFrame()` before clearing data
- **freeMemory():** Only trim, never wipe arrays that other panels index into

### 4. Modifying clearAll() or freeMemory()
- `clearAll()` wipes everything + re-renders — used for explicit user action (Cmd+K)
- `freeMemory()` trims heavy data without clearing UI — used on disconnect/quit
- After modifying either, verify ALL panels still render correctly
- Test: Cmd+K clears all panels, device disconnect doesn't break subsequent events

### 5. Modifying the object tree renderer
- `collectEntries()`, `objPreview()`, `createTreeNode()` are used by Console, Network, Redux, Storage, GA4
- **Any change to these functions affects ALL panels** that render object trees
- `_createHighlightedTree()` in Redux is a SEPARATE tree renderer — changes to `createTreeNode` do NOT automatically apply to Redux diff trees

### 6. CSS variable naming
- Themes define: `--bg`, `--bg2`, `--bg3`, `--bg4` (NOT `--bg1`)
- `--text`, `--text-mid`, `--text-dim`, `--text-bright`
- `--accent`, `--accent2`, `--border`, `--border2`
- `--green`, `--yellow`, `--red`
- **Never use undefined variables** — the value resolves to transparent/empty

---

## SDK Integration (in user's React Native app)

The SDK (`RNDebugSDK.js`) has two parts:
1. **Auto-connect** — WebSocket connections to ports 9090/9091/9092 open on import
2. **Manual wiring** — Redux requires adding `reduxMiddleware` or `reduxEnhancer` to the store

`npx reactoradar setup` handles:
- Copying SDK to `src/debug/RNDebugSDK.js`
- Patching entry file (`index.js`) to import SDK
- Auto-patching RTK `configureStore` with middleware
- **Legacy `createStore`**: Only prints manual instructions (does NOT auto-patch)

If Redux is not working:
1. Check if `reduxMiddleware` or `reduxEnhancer` is wired into the store
2. Connection to port 9090 ("RN app connected") does NOT mean events are flowing
3. Events only flow when `store.dispatch()` goes through the middleware/enhancer

---

## Testing Checklist (after any change)

- [ ] Console: logs appear, level filters work, search works, Cmd+K clears
- [ ] Network: requests appear, detail panel opens, HAR export works
- [ ] Redux: actions appear, state diff shows, Cmd+K clears
- [ ] GA4: events appear, summary works, color toggle works
- [ ] Storage: keys appear, values render, search works
- [ ] Performance: FPS/JS/UI graphs render when recording
- [ ] Memory: heap values appear
- [ ] Native Logs: connect to adb/xcrun, logs stream, Cmd+K clears
- [ ] Settings: theme switch, font size, tab visibility, version history loads
- [ ] Device disconnect: `freeMemory()` fires after 3s, panels still work after reconnect
- [ ] Device reconnect: cancel disconnect timer, new events flow immediately
- [ ] Cmd+K: clears active tab (all tabs including native)
- [ ] App quit: `devtoolsWindow` closed, bridges closed, no crash
