# ReactoRadar

<p align="center">
  <b>A standalone macOS debugger for React Native apps</b>
  <br/>
  <i>Supports React Native 0.74+ with Hermes, New Architecture, and latest versions</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React%20Native-0.74%2B-blue" alt="React Native 0.74+" />
  <img src="https://img.shields.io/badge/Hermes-Supported-green" alt="Hermes" />
  <img src="https://img.shields.io/badge/New%20Architecture-Supported-green" alt="New Arch" />
  <img src="https://img.shields.io/badge/Platform-macOS-lightgrey" alt="macOS" />
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT" />
  <img src="https://img.shields.io/npm/v/reactoradar" alt="npm version" />
</p>

---

> The original [React Native Debugger](https://github.com/jhen0409/react-native-debugger) only supports the old Remote Debugger and doesn't work with Hermes / JSI / New Architecture. **ReactoRadar is the modern replacement** — built from scratch to work with the latest React Native versions.

## Screenshots

### Console — Interactive Log Viewer
<p align="center">
  <img src="https://raw.githubusercontent.com/sharanagouda/react-native-debugger/main/screenshots/consoleLogs.png" alt="Console Panel" width="800" />
</p>

*Collapsible object trees, multi-select level filters (Log/Info/Warn/Error/Debug), search, right-click to copy*

### Network — Chrome DevTools-style Inspector
<p align="center">
  <img src="https://raw.githubusercontent.com/sharanagouda/react-native-debugger/main/screenshots/networkLogs.png" alt="Network Panel" width="800" />
</p>

*Resizable/sortable columns, request/response detail with collapsible trees, Copy as cURL, throttling*

## Features

| Tab | What it does |
|---|---|
| **Console** | Log viewer with collapsible object trees, multi-select level dropdown (persists across restarts), search filter |
| **Network** | Chrome DevTools-style inspector — resizable/sortable columns (Name, Status, Type, Initiator, Size, Time, Waterfall), search, type filters (Fetch/XHR, JS, CSS, Img, Media, Font, Doc, WS), throttling (Fast 3G / Slow 3G / Offline), Copy as cURL, request/response as collapsible trees |
| **Redux** | Scrollable action list with time travel, prev/current/next actions, payload trees, store diff showing changed keys with old → new values |
| **GA4 Events** | Firebase Analytics inspector — intercepts ALL `log*` and `set*` methods on `@react-native-firebase/analytics`, event list with time + name, detail pane with all parameters as key-value trees, summary chips (click to filter), sort by time |
| **App** | AsyncStorage live key/value browser with search |
| **Memory** | JS Heap Used/Total, Native Memory from Hermes runtime |
| **Performance** | Live FPS meter, JS Thread timing, UI Thread timing with sparkline graphs |
| **React** | Component tree and props inspector via `react-devtools-core` relay |
| **Settings** | 9 color themes (Dark, Light, Monokai, Dracula, Solarized Dark/Light, Nord, GitHub Dark, One Dark), font size controls, custom app name, how-to-use guide, auto-update notification |

## Installation

### Option A: Using npx (recommended)

```bash
cd your-react-native-project
npx reactoradar setup     # Install SDK (one time)
npx reactoradar            # Launch the debugger
```

### Option B: Download .dmg

1. Download from [Releases](https://github.com/sharanagouda/react-native-debugger/releases)
2. Drag **ReactoRadar** to Applications
3. Install the SDK: `npx reactoradar setup` from your RN project
4. Open ReactoRadar from Applications

> **macOS Gatekeeper**: First launch → right-click → Open → Open. Or: `xattr -cr "/Applications/ReactoRadar.app"`

### Option C: Global install

```bash
npm install -g reactoradar
```

### Option D: Build from source

```bash
git clone https://github.com/sharanagouda/react-native-debugger.git
cd react-native-debugger
npm install
npm start          # dev mode
npm run build      # build .dmg
```

## Quick Start

```bash
# Step 1: Install SDK (one time)
cd your-react-native-project
npx reactoradar setup

# Step 2: Launch debugger
npx reactoradar
# or open ReactoRadar.app from Applications

# Step 3: Run your app
npx react-native start --reset-cache
```

Console, Network, Redux, GA4, AsyncStorage data flows automatically. No config needed.

### Uninstall

```bash
npx reactoradar remove
```

## React Native Compatibility

| ReactoRadar | React Native | Engine | Architecture |
|---|---|---|---|
| v1.3+ | 0.74 — 0.81+ | Hermes | Old & New Architecture |

## Network Inspector

| Feature | Details |
|---|---|
| **Columns** | Name, Status, Type, Initiator, Size, Time, Waterfall — resizable and sortable |
| **Search** | Filter by URL in real time |
| **Type filters** | All, Fetch/XHR, JS, CSS, Img, Media, Font, Doc, WS |
| **Throttling** | No throttling, Fast 3G (500ms), Slow 3G (2s), Offline |
| **Detail view** | Click row → Headers / Request / Preview / Response side panel |
| **Copy as cURL** | Right-click → Copy as cURL / Copy URL / Copy Response |
| **Request body** | Collapsible object tree (not raw JSON) |
| **Capture toggle** | ON/OFF switch to pause network capture |

## GA4 Event Inspector

| Feature | Details |
|---|---|
| **Auto-intercept** | Patches ALL `log*` and `set*` methods on Firebase Analytics prototype — no hardcoded list, catches current + future methods |
| **Event list** | Time + event name, newest first, sortable |
| **Detail pane** | All parameters as key-value list with collapsible trees for objects/arrays |
| **Summary chips** | Click any chip to filter by that event type, click again to clear |
| **Resizable** | Drag the divider between list and detail |
| **Supported methods** | `logEvent`, `logPurchase`, `logAddToCart`, `logViewItem`, `logScreenView`, `logSelectPromotion`, `logViewPromotion`, `setUserId`, `setUserProperty`, `setConsent`, and 30+ more |

## Redux DevTools

- Scrollable action list with search filter
- Click an action → shows Previous / Current / Next with payloads as collapsible trees
- Store diff for current action: shows each changed key with **- old value** and **+ new value**
- Deep equality comparison (no false positives from reference changes)
- Time travel with ◀ ▶ navigation

## Themes

9 built-in themes: **Dark** (default), **Light**, **Monokai**, **Dracula**, **Solarized Dark**, **Solarized Light**, **Nord**, **GitHub Dark**, **One Dark**

All 16 CSS variables change per theme — every element in the app updates including text, backgrounds, borders, syntax highlighting, badges, and graphs.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+D` | Open JS Debugger (CDP DevTools) |
| `Cmd+R` | Open React DevTools |
| `Cmd+K` | Clear all panels |
| `Cmd+Shift+T` | Cycle through themes |
| `Cmd+C/V/A` | Copy / Paste / Select All |

## Ports

| Port | Service |
|---|---|
| 9090 | Redux bridge |
| 9091 | AsyncStorage bridge |
| 9092 | Console + Network + GA4 + Performance bridge |
| 8097 | React DevTools relay |
| 8081 | Metro bundler (CDP) |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│               ReactoRadar (Electron)                │
│                                                     │
│  Console │ Network │ Redux │ GA4 │ App              │
│  Memory │ Perf │ React │ Settings                   │
│                                                     │
│  main.js                                            │
│   ├─ WS :9092 ← console + network + ga4 + perf     │
│   ├─ WS :9090 ← redux actions + state              │
│   ├─ WS :9091 ← asyncstorage                       │
│   ├─ WS :8097 ← react-devtools relay               │
│   └─ HTTP :8081 → Metro CDP (on-demand)             │
└──────────────────────┬──────────────────────────────┘
                       │ WebSocket
┌──────────────────────┴──────────────────────────────┐
│            Your React Native App                    │
│                                                     │
│  RNDebugSDK.js (__DEV__ only)                       │
│   ├─ console.* interceptor                          │
│   ├─ XHR constructor wrapper (axios + fetch)        │
│   ├─ Firebase Analytics prototype interceptor       │
│   ├─ FPS + memory metrics                           │
│   ├─ Redux middleware                               │
│   └─ AsyncStorage watcher                           │
└─────────────────────────────────────────────────────┘
```

## Troubleshooting

| Problem | Solution |
|---|---|
| App won't launch from VS Code terminal | `unset ELECTRON_RUN_AS_NODE && npx reactoradar` |
| "Waiting for device" | Restart Metro: `npx react-native start --reset-cache` |
| Network tab empty | Run Metro with `--reset-cache` |
| `XHRInterceptor.js` warning | Set `networking: false` in ReactotronConfig.js |
| GA4 events not showing | Restart Metro with `--reset-cache` after setup |
| Port conflict | Change ports in `main.js` and `RNDebugSDK.js` |

## Privacy

ReactoRadar runs entirely on your local machine. No data collection, no analytics, no telemetry. See [PRIVACY.md](./PRIVACY.md).

## Contributing

Contributions welcome! Fork → branch → PR.

```bash
git clone https://github.com/sharanagouda/react-native-debugger.git
cd react-native-debugger
npm install
npm start
```

### Ideas for contribution
- Windows / Linux support
- Source file browser with breakpoints
- Flipper plugin compatibility
- Custom themes
- React Native New Architecture profiling

## Credits

- [Electron](https://www.electronjs.org/)
- [React DevTools](https://github.com/facebook/react/tree/main/packages/react-devtools)
- [Redux DevTools](https://github.com/reduxjs/redux-devtools)
- [React Native Debugger](https://github.com/jhen0409/react-native-debugger) — the original inspiration

## License

[MIT](./LICENSE)
