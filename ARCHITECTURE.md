# ReactoRadar: Technical Architecture & Data Flow Document

## 1. High-Level Architecture Overview
ReactoRadar operates on a **Client-Server-UI** architecture, bridging the React Native environment with a standalone macOS Electron application. It consists of three primary layers:

1. **The Client (React Native SDK - `RNDebugSDK.js`)**: Runs inside the React Native JavaScript runtime. It patches native APIs (Console, Network, Redux, etc.) and acts as a WebSocket client.
2. **The Server (Electron Main Process - `main.js`)**: Runs in Node.js on the developer's machine. It hosts local WebSocket servers to receive data from the SDK and acts as a proxy to the Metro Bundler for CDP (Chrome DevTools Protocol) debugging.
3. **The UI (Electron Renderer - `app.js` & `index.html`)**: The visual dashboard. It receives data from the Main Process via Electron's Inter-Process Communication (IPC) and renders it into the DOM.

---

## 2. How the Connection is Established

The connection relies on local WebSocket bridges. When the React Native app launches in development mode (`__DEV__ === true`), the SDK executes immediately.

1. **Server Initialization**: When you open the ReactoRadar Electron app, `main.js` spins up three `WebSocketServer` instances on specific ports:
   - `Port 9092`: Network & Console Bridge
   - `Port 9090`: Redux Bridge
   - `Port 9091`: AsyncStorage Bridge
2. **Client Connection**: The SDK uses a `makeChannel` factory function to instantiate standard `WebSocket` connections to `ws://10.0.2.2:<port>` (Android emulator) or `ws://127.0.0.1:<port>` (iOS/Local).
3. **Queueing**: If the Electron app isn't open yet, the SDK queues messages (up to 300) and attempts to reconnect every 2 seconds. Once connected, it flushes the queue.

---

## 3. How Data is Intercepted (The SDK)

The SDK captures data by "monkey-patching" (wrapping) global JavaScript objects and prototypes.

### A. Console Logs
The SDK overrides `console.log`, `console.warn`, `console.error`, etc.
- **Interception**: It stores the original `console.log` in a private `_console` object, then replaces `global.console.log` with a custom function.
- **Processing**: When the app calls `console.log(obj)`, the SDK:
  1. Calls the original `_console.log` so it still appears in Metro/Xcode.
  2. Serializes the arguments safely (handling circular references, Errors, and functions).
  3. Extracts the stack trace to find the exact file and line number of the caller.
  4. Sends a JSON payload via the `9092` WebSocket channel: `{ type: 'console', level: 'log', message: '...', caller: 'App.tsx:42' }`.

### B. Network APIs (Fetch, XHR, Axios)
To capture network traffic, the SDK intercepts requests at three levels to ensure nothing is missed:
- **Fetch API**: Replaces `global.fetch`. It captures the request URL, method, and headers. It then awaits the original `fetch`, clones the response (`resp.clone().text()`), parses the body, and sends the timing and payload data over the WebSocket.
- **XMLHttpRequest (XHR)**: React Native and third-party libraries often fight over the `XMLHttpRequest.prototype`. Instead of patching the prototype, ReactoRadar wraps the `XMLHttpRequest` **constructor**. Every time a new XHR instance is created, the SDK attaches wrappers to `.open()`, `.send()`, and `.setRequestHeader()`, and adds a `readystatechange` event listener to capture the response body and headers.
- **Axios**: Since Axios can sometimes bypass global patches depending on import hoisting, the SDK dynamically requires `axios` and injects an Axios Interceptor (`axios.interceptors.request.use` and `response.use`).

### C. Conflict Resolution (Debugger Detection)
If a developer attaches Chrome DevTools or the Hermes Inspector, having two systems intercepting network/console at the same time causes prototype chain crashes or deadlocks. 
- The SDK runs a `_checkDebuggerAttached()` interval. 
- If it detects `global.__REACT_DEVTOOLS_GLOBAL_HOOK__?.__debuggerAttached` or Hermes debugger flags, it instantly **bypasses all interception**, letting the native inspector work flawlessly.

---

## 4. Data Pipeline: From App to Display

Here is the exact step-by-step lifecycle of a single `console.log("Hello")` or `fetch()` request:

### Step 1: React Native Runtime (SDK)
1. App executes `console.log("Hello")`.
2. `RNDebugSDK.js` intercepts it, formats it into a JSON string, and calls `ws.send()`.

### Step 2: Electron Main Process (`main.js`)
1. The `WebSocketServer` listening on port `9092` receives the message.
2. `main.js` parses the JSON to determine its type (`console`, `network`, `perf`, etc.).
3. It forwards the payload to the frontend window using Electron's IPC:
   ```javascript
   mainWindow.webContents.send('console-event', parsedData);
   ```

### Step 3: Electron Preload Script (`preload.js`)
1. For security, the frontend HTML cannot directly access Node.js APIs. `preload.js` acts as a secure bridge.
2. It exposes a global `window.electronAPI.on('console-event', callback)` function to the DOM.

### Step 4: Electron Renderer (`app.js`)
1. `app.js` listens to the event: `window.electronAPI.on('console-event', addConsoleLog)`.
2. **Rendering**: The `addConsoleLog(event)` function dynamically generates HTML elements (`div`, `span`).
3. **Formatting**: It applies syntax highlighting (e.g., coloring strings green, numbers purple, objects as collapsible JSON trees).
4. **DOM Insertion**: The new element is appended to the `#consoleList` container in `index.html`. If auto-scroll is enabled, the UI scrolls to the bottom.

---

## 5. CDP & Metro Bundler Integration (JS Debugger)

ReactoRadar isn't just a passive log viewer; it also integrates with React Native's Chrome DevTools Protocol (CDP) for actual breakpoint debugging.

1. **Target Discovery**: `main.js` makes an HTTP GET request to the Metro Bundler (e.g., `http://localhost:8081/json/list`).
2. **Port Customization**: The user can change the Metro port in the Settings UI. This sends an IPC message (`set-metro-port`) to `main.js`, which instantly updates its target discovery URL.
3. **UI Update**: `main.js` sends the discovered targets to `app.js`, which updates the "JS Debugger ↗" button to show the active port and target count (e.g., `JS Debugger (:8081) [1] ↗`).
4. **Launching the Debugger**: When the user clicks the button, `main.js` opens a new Electron `BrowserWindow`. It loads the embedded Chrome DevTools frontend URL provided by Metro, injecting the WebSocket URL of the Hermes engine. This allows the developer to set breakpoints and step through code entirely within ReactoRadar.

---

## Summary Flowchart

```text
[ React Native App ]
       │
       ├─> console.log() / fetch()
       │
[ RNDebugSDK.js ] (Intercepts, formats JSON)
       │
       ├─> (WebSocket ws://127.0.0.1:9092)
       ▼
[ Electron main.js ] (Receives WS, routes to IPC)
       │
       ├─> mainWindow.webContents.send('console-event')
       ▼
[ Electron preload.js ] (Context Bridge)
       │
       ├─> window.electronAPI.on()
       ▼
[ Electron app.js ] (Parses JSON, builds HTML)
       │
       ├─> document.createElement('div')
       ▼
[ index.html ] (Displays to Developer)
```