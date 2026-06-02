'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  filter: '',
  activePanel: 'console',
  ports: {},

  console: { logs: [], levelFilters: { log: true, info: true, warn: true, error: true, debug: true }, searchFilter: '' },

  network: {
    requests: {},
    order: [],
    statusFilter: 'all',
    typeFilter: 'all',
    searchFilter: '',
    throttle: 'none',
    enabled: true,
    selectedId: null,
    sortCol: 'time',
    sortDir: 'desc',
  },

  redux: {
    actions: [],
    states: [],
    selected: -1,
    searchFilter: '',
  },

  storage: {
    entries: {},    // key → value string
    keys: [],       // ordered keys
    selected: null,
    searchFilter: '',
  },

  // Device connection tracking
  connections: { redux: false, network: false, storage: false, reactDT: false },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => s == null ? '' : String(s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const ts = ms => new Date(ms).toLocaleTimeString('en',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});


function pretty(val) {
  if (val == null) return '';
  if (typeof val === 'string') { try { return JSON.stringify(JSON.parse(val),null,2); } catch{} return val; }
  return JSON.stringify(val, null, 2);
}

function syntaxHighlight(json) {
  return json
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, m => {
      if (/^"/.test(m)) return /:$/.test(m) ? `<span class="json-key">${m}</span>` : `<span class="json-str">${m}</span>`;
      if (/true|false/.test(m)) return `<span class="json-bool">${m}</span>`;
      if (/null/.test(m)) return `<span class="json-null">${m}</span>`;
      return `<span class="json-num">${m}</span>`;
    });
}

function renderJSON(val) {
  try {
    const str = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
    return syntaxHighlight(esc(str));
  } catch { return esc(String(val)); }
}

function tryURL(url) { try { return new URL(url); } catch { return null; } }

// Extract short caller display from the SDK's caller string.
// SDK now sends: "HomeScreen.tsx:42 (HomeScreen)" or "ProductDetails" or "file.tsx:10"
function extractCallerShort(caller) {
  if (!caller) return '';
  // Already short format from SDK — just clean up
  const trimmed = caller.replace(/^\s*at\s+/, '').trim();
  // If it's just a function name (no file), return as-is
  if (!trimmed.includes(':') && !trimmed.includes('/')) return trimmed;
  // If it's "file.tsx:42 (FuncName)", return "file.tsx:42"
  const m = trimmed.match(/^([^/\\\s]+\.[jt]sx?:\d+)/);
  if (m) return m[1];
  // Fallback
  return trimmed.length > 40 ? trimmed.slice(-40) : trimmed;
}

function highlight(html, term) {
  if (!term) return html;
  const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  return html.replace(re, '<mark>$1</mark>');
}

// ─── Navigation ───────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const panel = btn.dataset.panel;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $(`panel-${panel}`).classList.add('active');
    state.activePanel = panel;
  });
});

// Global filter removed — each panel has its own search input

// ─── Clear (active tab only) ──────────────────────────────────────────────────
$('btnClear').addEventListener('click', clearActiveTab);

function clearActiveTab() {
  switch (state.activePanel) {
    case 'console':
      state.console.logs = [];
      _consolePending = [];
      $('cBadge').textContent = '0';
      renderConsole();
      break;
    case 'network':
      state.network.requests = {};
      state.network.order = [];
      state.network.selectedId = null;
      closeNetDetail();
      $('nBadge').textContent = '0';
      renderNetwork();
      break;
    case 'redux':
      state.redux.actions = [];
      state.redux.states = [];
      state.redux.selected = -1;
      $('rBadge').textContent = '0';
      renderRedux();
      break;
    case 'storage':
      state.storage.entries = {};
      state.storage.keys = [];
      state.storage.selected = null;
      $('sBadge').textContent = '0';
      renderStorage();
      break;
    case 'ga4':
      ga4State.events = [];
      ga4State.selected = -1;
      $('ga4Badge').textContent = '0';
      renderGA4List();
      renderGA4Summary();
      break;
    case 'performance':
      perfState.fps = [];
      perfState.jsThread = [];
      perfState.uiThread = [];
      perfState.data = [];
      const perfFPS = $('perfFPS'); if (perfFPS) perfFPS.textContent = '—';
      const perfJS = $('perfJS'); if (perfJS) perfJS.textContent = '—';
      const perfUI = $('perfUI'); if (perfUI) perfUI.textContent = '—';
      clearPerfCanvas('perfFPSCanvas');
      clearPerfCanvas('perfJSCanvas');
      clearPerfCanvas('perfUICanvas');
      break;
    case 'memory':
      const memHU = $('memHeapUsed'); if (memHU) memHU.textContent = '—';
      const memHT = $('memHeapTotal'); if (memHT) memHT.textContent = '—';
      const memN = $('memNative'); if (memN) memN.textContent = '—';
      break;
    default:
      break;
  }
}

// Clear all (used by IPC clear-all-ui from menu Cmd+K)
function clearAll() {
  state.console.logs = [];
  _consolePending = [];
  state.network.requests = {};
  state.network.order = [];
  state.network.selectedId = null;
  closeNetDetail();
  state.redux.actions = [];
  state.redux.states = [];
  state.redux.selected = -1;
  state.storage.entries = {};
  state.storage.keys = [];
  state.storage.selected = null;
  $('cBadge').textContent = '0';
  $('nBadge').textContent = '0';
  $('rBadge').textContent = '0';
  $('sBadge').textContent = '0';
  renderConsole();
  renderNetwork();
  renderRedux();
  renderStorage();
}

// ─── CDP Button ───────────────────────────────────────────────────────────────
$('btnCDP').addEventListener('click', () => {
  // Tell main process to open the CDP DevTools window with the best available target
  window.electronAPI?.openCDPTarget(null); // null = use latest known target
});

// ─────────────────────────────────────────────────────────────────────────────
// IPC from Main
// ─────────────────────────────────────────────────────────────────────────────
if (window.electronAPI) {
  window.electronAPI.on('ports', ports => { state.ports = ports; });

  window.electronAPI.on('cdp-targets', targets => {
    const hasCDP = targets?.length > 0;
    $('btnCDP').textContent = hasCDP
      ? `JS Debugger (${targets.length}) ↗`
      : 'JS Debugger ↗';
    $('btnCDP').style.opacity = hasCDP ? '1' : '0.5';
    if (hasCDP) {
      $('btnCDP').onclick = () => window.electronAPI.openCDPTarget(targets[0].webSocketDebuggerUrl);
    }

  });

  window.electronAPI.on('redux-event', handleReduxEvent);
  window.electronAPI.on('network-event', handleNetworkEvent);
  window.electronAPI.on('storage-event', handleStorageEvent);

  window.electronAPI.on('ga4-event', handleGA4Event);

  window.electronAPI.on('perf-event', event => {
    handlePerfEvent(event);
    handleMemoryEvent(event);
  });

  window.electronAPI.on('redux-connected', on => { updateDeviceBanner('redux', on); });
  window.electronAPI.on('network-connected', on => { updateDeviceBanner('network', on); });
  window.electronAPI.on('storage-connected', on => { updateDeviceBanner('storage', on); });
  window.electronAPI.on('react-dt-status', on => { updateDeviceBanner('reactDT', on); });

  window.electronAPI.on('clear-all-ui', clearAll);

  window.electronAPI.on('app-version', (version) => {
    state._appVersion = version;
    const el = $('aboutVersion');
    if (el) el.textContent = 'v' + version;
  });

  window.electronAPI.on('update-available', ({ current, latest }) => {
    // Show in settings only, not as a banner
    state._updateAvailable = { current, latest };
    const el = $('aboutVersion');
    if (el) el.innerHTML = `v${current} <span style="color:var(--green);font-size:10px;margin-left:6px">v${latest} available</span>`;
    // Add update button in settings if not already there
    if (!$('updateBtn')) {
      const aboutEl = document.querySelector('.settings-about');
      if (aboutEl) {
        const btn = document.createElement('div');
        btn.style.cssText = 'margin-top:10px';
        btn.innerHTML = '<button id="updateBtn" class="tb-btn primary" style="font-size:11px">Download v' + latest + '</button>';
        aboutEl.appendChild(btn);
        $('updateBtn')?.addEventListener('click', () => {
          window.electronAPI?.openExternal('https://github.com/sharanagouda/react-native-debugger/releases');
        });
      }
    }
  });

  window.electronAPI.on('trigger-open-cdp', () => {
    window.electronAPI?.openCDPTarget(null);
  });

  // Theme toggle from menu shortcut (Cmd+Shift+T)
  window.electronAPI.on('theme-changed', theme => {
    document.documentElement.setAttribute('data-theme', theme);
    setStoredTheme(theme);
    document.querySelectorAll('#themeSwitcher .theme-card')
      .forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
  });
}

// ─── Device Connection Status (inline in titlebar) ───────────────────────────
function updateDeviceBanner(service, connected) {
  state.connections[service] = connected;
  const el = $('deviceStatus');
  const text = $('deviceText');
  if (!el || !text) return;

  const any = state.connections.redux || state.connections.network || state.connections.storage || state.connections.reactDT;

  if (any) {
    el.className = 'device-status connected';
    text.textContent = 'Device connected';
  } else {
    el.className = 'device-status waiting';
    text.textContent = 'Waiting for device...';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSOLE PANEL
// ─────────────────────────────────────────────────────────────────────────────
// Load saved log level filters from localStorage
function getStoredLogLevels() {
  try {
    const saved = localStorage.getItem('rn-debug-log-levels');
    if (saved) return JSON.parse(saved);
  } catch {}
  return { log: true, info: true, warn: true, error: true, debug: true };
}
function setStoredLogLevels(levels) {
  try { localStorage.setItem('rn-debug-log-levels', JSON.stringify(levels)); } catch {}
}

function initConsolePanel() {
  const panel = $('panel-console');
  const levels = getStoredLogLevels();
  state.console.levelFilters = levels;

  panel.innerHTML = `
    <div class="panel-toolbar">
      <span class="panel-label">Console</span>
      <span class="badge" id="cBadge">0</span>
      <input id="consoleSearch" class="net-search-input" style="margin-left:12px" placeholder="Filter logs..." />
      <div class="ml-auto" style="display:flex;align-items:center;gap:6px">
        <div class="console-level-dropdown" id="consoleLevelDropdown">
          <button class="console-level-btn" id="consoleLevelBtn">Levels ▾</button>
          <div class="console-level-menu" id="consoleLevelMenu">
            <label class="console-level-option"><input type="checkbox" data-level="log" ${levels.log ? 'checked' : ''} /><span class="lvl-dot" style="background:var(--text-mid)"></span>Log</label>
            <label class="console-level-option"><input type="checkbox" data-level="info" ${levels.info ? 'checked' : ''} /><span class="lvl-dot" style="background:var(--accent)"></span>Info</label>
            <label class="console-level-option"><input type="checkbox" data-level="warn" ${levels.warn ? 'checked' : ''} /><span class="lvl-dot" style="background:var(--yellow)"></span>Warn</label>
            <label class="console-level-option"><input type="checkbox" data-level="error" ${levels.error ? 'checked' : ''} /><span class="lvl-dot" style="background:var(--red)"></span>Error</label>
            <label class="console-level-option"><input type="checkbox" data-level="debug" ${levels.debug ? 'checked' : ''} /><span class="lvl-dot" style="background:var(--accent2)"></span>Debug</label>
          </div>
        </div>
      </div>
    </div>
    <div class="scroll-area" id="consoleList">
      <div class="empty-state" id="consoleEmpty">
        <div class="icon">⬛</div>
        <div class="label">No logs yet</div>
        <div class="hint">Add RNDebugSDK.js to your app</div>
      </div>
    </div>`;

  // Search filter
  $('consoleSearch').addEventListener('input', (e) => {
    state.console.searchFilter = e.target.value.toLowerCase().trim();
    renderConsole();
  });

  // Level dropdown toggle
  $('consoleLevelBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('consoleLevelMenu').classList.toggle('open');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#consoleLevelDropdown')) {
      $('consoleLevelMenu')?.classList.remove('open');
    }
  });

  // Level checkbox changes
  $('consoleLevelMenu').addEventListener('change', (e) => {
    const checkbox = e.target;
    const level = checkbox.dataset.level;
    if (level) {
      state.console.levelFilters[level] = checkbox.checked;
      setStoredLogLevels(state.console.levelFilters);
      updateLevelBtnText();
      renderConsole();
    }
  });

  updateLevelBtnText();
}

function updateLevelBtnText() {
  const levels = state.console.levelFilters;
  const allOn = Object.values(levels).every(v => v);
  const allOff = Object.values(levels).every(v => !v);
  const btn = $('consoleLevelBtn');
  if (!btn) return;
  if (allOn) btn.textContent = 'All Levels ▾';
  else if (allOff) btn.textContent = 'None ▾';
  else {
    const active = Object.entries(levels).filter(([, v]) => v).map(([k]) => k.charAt(0).toUpperCase() + k.slice(1));
    btn.textContent = active.join(', ') + ' ▾';
  }
}

// Console is fed via IPC (network-event handled in IPC section above)

// ─── Batched console append (fixes re-render performance) ────────────────────
let _consolePending = [];
let _consoleRAF = null;

function addConsoleLog(event) {
  state.console.logs.push(event);
  _consolePending.push(event);
  // Batch DOM updates via rAF — only one paint per frame
  if (!_consoleRAF) {
    _consoleRAF = requestAnimationFrame(flushConsoleBatch);
  }
}

function flushConsoleBatch() {
  _consoleRAF = null;
  const batch = _consolePending;
  _consolePending = [];
  if (!batch.length) return;

  $('cBadge').textContent = state.console.logs.length;

  const list = $('consoleList');
  const empty = $('consoleEmpty');
  if (!list) return;

  const { levelFilters, searchFilter } = state.console;
  const frag = document.createDocumentFragment();
  let added = 0;

  batch.forEach(l => {
    if (levelFilters && !levelFilters[l.level]) return;
    if (searchFilter && !l.message?.toLowerCase().includes(searchFilter)) return;
    frag.appendChild(buildLogRow(l));
    added++;
  });

  if (added > 0) {
    empty.style.display = 'none';
    list.appendChild(frag);
    // Keep DOM size manageable — remove oldest rows if over 500
    const rows = list.querySelectorAll('.log-row');
    const MAX_DOM_ROWS = 500;
    if (rows.length > MAX_DOM_ROWS) {
      const toRemove = rows.length - MAX_DOM_ROWS;
      for (let i = 0; i < toRemove; i++) rows[i].remove();
    }
    list.scrollTop = list.scrollHeight;
  }
}

window.electronAPI?.on('console-event', addConsoleLog);

// ─── Object Tree Renderer (Chrome DevTools-like) ─────────────────────────────
// Builds interactive, collapsible DOM nodes for objects/arrays.

function objPreview(val, maxLen) {
  maxLen = maxLen || 80;
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    const items = [];
    let len = 2; // [ ]
    for (let i = 0; i < val.length && len < maxLen; i++) {
      const s = primitivePreview(val[i]);
      len += s.length + 2;
      items.push(s);
    }
    const suffix = items.length < val.length ? ', ...' : '';
    return `(${val.length}) [${items.join(', ')}${suffix}]`;
  }
  if (typeof val === 'object') {
    const keys = Object.keys(val);
    if (keys.length === 0) return '{}';
    const items = [];
    let len = 2;
    for (let i = 0; i < keys.length && len < maxLen; i++) {
      const s = `${keys[i]}: ${primitivePreview(val[keys[i]])}`;
      len += s.length + 2;
      items.push(s);
    }
    const suffix = items.length < keys.length ? ', ...' : '';
    return `{${items.join(', ')}${suffix}}`;
  }
  return primitivePreview(val);
}

function primitivePreview(val) {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (typeof val === 'string') return val.length > 50 ? `"${val.slice(0,50)}..."` : `"${val}"`;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return `Array(${val.length})`;
  if (typeof val === 'object') return `{...}`;
  return String(val);
}

function createTreeNode(key, val, startCollapsed) {
  const isArray = Array.isArray(val);
  const isObj = val !== null && typeof val === 'object';

  if (!isObj) {
    // Primitive leaf
    const row = document.createElement('div');
    row.className = 'ov-leaf';
    if (key !== null) {
      const k = document.createElement('span');
      k.className = 'ov-key';
      k.textContent = isNaN(key) ? `${key}: ` : `${key}: `;
      row.appendChild(k);
    }
    row.appendChild(createPrimitiveSpan(val));
    return row;
  }

  // Collapsible object/array
  const container = document.createElement('div');
  container.className = 'ov-node';

  const header = document.createElement('div');
  header.className = 'ov-header';

  const arrow = document.createElement('span');
  arrow.className = 'ov-arrow';
  arrow.textContent = '\u25B6'; // ▶
  header.appendChild(arrow);

  if (key !== null) {
    const k = document.createElement('span');
    k.className = 'ov-key';
    k.textContent = `${key}: `;
    header.appendChild(k);
  }

  const preview = document.createElement('span');
  preview.className = 'ov-preview';
  preview.textContent = objPreview(val);
  header.appendChild(preview);

  container.appendChild(header);

  const children = document.createElement('div');
  children.className = 'ov-children';
  children.style.display = 'none';

  let populated = false;

  function populateChildren() {
    if (populated) return;
    populated = true;
    const entries = isArray ? val.map((v, i) => [i, v]) : Object.entries(val);
    entries.forEach(([k, v]) => {
      children.appendChild(createTreeNode(k, v, true));
    });
    // For arrays show length, for objects show prototype hint
    if (isArray) {
      const lenNode = document.createElement('div');
      lenNode.className = 'ov-leaf ov-meta';
      lenNode.textContent = `length: ${val.length}`;
      children.appendChild(lenNode);
    }
  }

  let expanded = !startCollapsed;
  if (expanded) {
    populateChildren();
    children.style.display = 'block';
    arrow.textContent = '\u25BC'; // ▼
    arrow.classList.add('expanded');
    preview.style.display = 'none';
  }

  header.addEventListener('click', (e) => {
    e.stopPropagation();
    expanded = !expanded;
    if (expanded) {
      populateChildren();
      children.style.display = 'block';
      arrow.textContent = '\u25BC';
      arrow.classList.add('expanded');
      preview.style.display = 'none';
    } else {
      children.style.display = 'none';
      arrow.textContent = '\u25B6';
      arrow.classList.remove('expanded');
      preview.style.display = '';
    }
  });

  container.appendChild(children);
  return container;
}

function createPrimitiveSpan(val) {
  const s = document.createElement('span');
  if (val === null) { s.className = 'ov-null'; s.textContent = 'null'; }
  else if (val === undefined) { s.className = 'ov-undef'; s.textContent = 'undefined'; }
  else if (typeof val === 'string') { s.className = 'ov-str'; s.textContent = `"${val}"`; }
  else if (typeof val === 'number') { s.className = 'ov-num'; s.textContent = String(val); }
  else if (typeof val === 'boolean') { s.className = 'ov-bool'; s.textContent = String(val); }
  else { s.textContent = String(val); }
  return s;
}

// Parse a structured arg from the SDK (or fall back to raw message string)
function renderConsoleArg(arg) {
  if (!arg || typeof arg !== 'object' || !arg.t) {
    // Backward compat: raw string
    const s = document.createElement('span');
    s.className = 'ov-str';
    s.textContent = String(arg);
    return s;
  }
  const { t, v } = arg;
  if (t === 'string') {
    const s = document.createElement('span');
    s.className = 'log-text';
    s.textContent = v;
    return s;
  }
  if (t === 'number') { return createPrimitiveSpan(v); }
  if (t === 'boolean') { return createPrimitiveSpan(v); }
  if (t === 'null') { return createPrimitiveSpan(null); }
  if (t === 'undefined') { return createPrimitiveSpan(undefined); }
  if (t === 'object' || t === 'array') {
    return createTreeNode(null, v, false);
  }
  const s = document.createElement('span');
  s.textContent = String(v);
  return s;
}

// Build the body of a console log row. If structured args exist, render each;
// otherwise fall back to the flat message string and try to detect JSON in it.
function buildLogBody(logEntry) {
  const container = document.createElement('div');
  container.className = 'log-body';

  if (logEntry.args && Array.isArray(logEntry.args) && logEntry.args.length > 0) {
    // Structured args from updated SDK
    logEntry.args.forEach((arg, i) => {
      if (i > 0) container.appendChild(document.createTextNode(' '));
      container.appendChild(renderConsoleArg(arg));
    });
  } else if (logEntry.message != null) {
    // Legacy / flat message — try to parse JSON objects out of it
    const msg = String(logEntry.message);
    // Try parsing the whole message as JSON
    try {
      const parsed = JSON.parse(msg);
      if (typeof parsed === 'object' && parsed !== null) {
        container.appendChild(createTreeNode(null, parsed, false));
        return container;
      }
    } catch {}

    // Otherwise render as text, but look for embedded JSON blocks
    // If it looks like it contains JSON, try to pretty-render inline
    const jsonRe = /(\{[\s\S]*\}|\[[\s\S]*\])/;
    const match = msg.match(jsonRe);
    if (match && match[0].length > 2) {
      try {
        const parsed = JSON.parse(match[0]);
        // There's text before/after
        const before = msg.slice(0, match.index);
        const after = msg.slice(match.index + match[0].length);
        if (before) container.appendChild(document.createTextNode(before));
        container.appendChild(createTreeNode(null, parsed, false));
        if (after) container.appendChild(document.createTextNode(after));
        return container;
      } catch {}
    }

    // Plain text
    const span = document.createElement('span');
    span.className = 'log-text';
    span.textContent = msg;
    container.appendChild(span);
  }

  return container;
}

function buildLogRow(l) {
  const div = document.createElement('div');
  div.className = `log-row entry ${l.level}`;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = ts(l.ts);
  div.appendChild(timeSpan);

  const lvlSpan = document.createElement('span');
  lvlSpan.className = `lvl-badge lvl-${l.level}`;
  lvlSpan.textContent = l.level;
  div.appendChild(lvlSpan);

  // Body wrapper with preview (collapsed) and full (expanded)
  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'log-body-wrap';

  // Single-line preview with caller at end
  const preview = document.createElement('div');
  preview.className = 'log-preview';
  const msgText = (l.message || '').replace(/\n/g, ' ').slice(0, 200);
  const previewText = document.createElement('span');
  previewText.textContent = msgText + ((l.message || '').length > 200 ? '...' : '');
  preview.appendChild(previewText);
  if (l.caller) {
    // Extract short filename:line from caller like "at Component (file.js:42:10)"
    const callerShort = extractCallerShort(l.caller);
    if (callerShort) {
      const callerTag = document.createElement('span');
      callerTag.className = 'log-caller-inline';
      callerTag.textContent = callerShort;
      preview.appendChild(callerTag);
    }
  }
  bodyWrap.appendChild(preview);

  // Full content (hidden by default)
  const full = document.createElement('div');
  full.className = 'log-full';
  full.style.display = 'none';
  full.appendChild(buildLogBody(l));
  if (l.caller) {
    const callerSpan = document.createElement('span');
    callerSpan.className = 'log-caller';
    callerSpan.textContent = l.caller;
    full.appendChild(callerSpan);
  }
  bodyWrap.appendChild(full);

  // Expand/collapse arrow
  const arrow = document.createElement('span');
  arrow.className = 'log-arrow';
  arrow.textContent = '\u25B6';
  bodyWrap.prepend(arrow);

  let expanded = false;
  // Only toggle on click, NOT on text selection drag
  let _mouseDownPos = null;
  bodyWrap.addEventListener('mousedown', (e) => {
    _mouseDownPos = { x: e.clientX, y: e.clientY };
  });
  bodyWrap.addEventListener('click', (e) => {
    // Don't toggle if user is selecting text (dragged mouse)
    if (_mouseDownPos) {
      const dx = Math.abs(e.clientX - _mouseDownPos.x);
      const dy = Math.abs(e.clientY - _mouseDownPos.y);
      if (dx > 3 || dy > 3) return; // user dragged to select
    }
    // Don't toggle if there's an active text selection
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;
    // Don't toggle if clicking inside object tree expander
    if (e.target.closest('.ov-header')) return;
    expanded = !expanded;
    if (expanded) {
      preview.style.display = 'none';
      full.style.display = 'block';
      arrow.textContent = '\u25BC';
      arrow.classList.add('expanded');
    } else {
      preview.style.display = '';
      full.style.display = 'none';
      arrow.textContent = '\u25B6';
      arrow.classList.remove('expanded');
    }
  });

  // Right-click → copy options
  div.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const items = [];

    // Copy selected text
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) {
      items.push({ label: 'Copy Selection', action: () => navigator.clipboard.writeText(sel.toString()) });
    }

    // Copy full log message
    items.push({ label: 'Copy Message', action: () => {
      navigator.clipboard.writeText(l.message || '');
    }});

    // Copy as JSON (if structured args exist)
    if (l.args && l.args.length > 0) {
      items.push({ label: 'Copy as JSON', action: () => {
        const json = l.args.map(a => {
          if (a.t === 'object' || a.t === 'array') return JSON.stringify(a.v, null, 2);
          return String(a.v);
        }).join(' ');
        navigator.clipboard.writeText(json);
      }});
    }

    // Copy caller location
    if (l.caller) {
      items.push({ label: 'Copy Caller', action: () => navigator.clipboard.writeText(l.caller) });
    }

    showContextMenu(e, items);
  });

  div.appendChild(bodyWrap);
  return div;
}

// ─── Shared context menu helper ──────────────────────────────────────────────
function showContextMenu(e, items) {
  document.querySelectorAll('.ctx-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  items.forEach(({ label, action }) => {
    const item = document.createElement('div');
    item.className = 'ctx-item';
    item.textContent = label;
    item.addEventListener('click', () => { action(); menu.remove(); });
    menu.appendChild(item);
  });
  menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - items.length * 32 - 10) + 'px';
  document.body.appendChild(menu);
  setTimeout(() => {
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); } };
    document.addEventListener('click', close);
  }, 0);
}

// Full re-render — only used on filter/level change, NOT on every incoming log
function renderConsole() {
  const list = $('consoleList');
  const empty = $('consoleEmpty');
  if (!list) return;

  const { levelFilters, searchFilter } = state.console;
  const visible = state.console.logs.filter(l => {
    if (levelFilters && !levelFilters[l.level]) return false;
    if (searchFilter && !l.message?.toLowerCase().includes(searchFilter)) return false;
    return true;
  });

  list.querySelectorAll('.log-row').forEach(e => e.remove());
  empty.style.display = visible.length ? 'none' : 'flex';

  // Render only the last 500 visible rows for performance
  const MAX_RENDER = 500;
  const toRender = visible.length > MAX_RENDER ? visible.slice(-MAX_RENDER) : visible;
  if (visible.length > MAX_RENDER) {
    const info = document.createElement('div');
    info.className = 'log-row';
    info.style.cssText = 'color:var(--text-dim);font-size:10px;padding:6px 14px;text-align:center;font-style:italic';
    info.textContent = `${visible.length - MAX_RENDER} older logs hidden for performance`;
    list.appendChild(info);
  }

  const frag = document.createDocumentFragment();
  toRender.forEach(l => frag.appendChild(buildLogRow(l)));
  list.appendChild(frag);
  list.scrollTop = list.scrollHeight;
}

// ─────────────────────────────────────────────────────────────────────────────
// NETWORK PANEL (Chrome DevTools-style)
// ─────────────────────────────────────────────────────────────────────────────
const NET_COLS = [
  { key: 'name',      label: 'Name',      width: 260, min: 100 },
  { key: 'status',    label: 'Status',    width: 60,  min: 40 },
  { key: 'type',      label: 'Type',      width: 70,  min: 40 },
  { key: 'initiator', label: 'Initiator', width: 90,  min: 50 },
  { key: 'size',      label: 'Size',      width: 70,  min: 40 },
  { key: 'time',      label: 'Time',      width: 70,  min: 40 },
  { key: 'waterfall', label: 'Waterfall', width: 120, min: 60 },
];

function initNetworkPanel() {
  const panel = $('panel-network');
  panel.innerHTML = `
    <div class="panel-toolbar">
      <span class="panel-label">Network</span>
      <span class="badge" id="nBadge">0</span>
      <div class="ml-auto" style="display:flex;align-items:center;gap:6px">
        <label class="toggle-label" for="netToggle">
          <span class="toggle-text" id="netToggleText">Capture ON</span>
          <input type="checkbox" id="netToggle" class="toggle-input" checked />
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
    <div class="net-filter-bar" id="netFilterBar">
      <input id="netSearchInput" class="net-search-input" placeholder="Filter URLs..." />
      <div class="net-type-filters" id="netTypeFilters">
        <button class="net-type-btn active" data-type="all">All</button>
        <button class="net-type-btn" data-type="fetch">Fetch/XHR</button>
        <button class="net-type-btn" data-type="js">JS</button>
        <button class="net-type-btn" data-type="css">CSS</button>
        <button class="net-type-btn" data-type="img">Img</button>
        <button class="net-type-btn" data-type="media">Media</button>
        <button class="net-type-btn" data-type="font">Font</button>
        <button class="net-type-btn" data-type="doc">Doc</button>
        <button class="net-type-btn" data-type="ws">WS</button>
      </div>
      <div class="net-throttle" id="netThrottle">
        <select id="netThrottleSelect" class="net-throttle-select">
          <option value="none">No throttling</option>
          <option value="fast3g">Fast 3G</option>
          <option value="slow3g">Slow 3G</option>
          <option value="offline">Offline</option>
        </select>
      </div>
    </div>
    <div class="net-layout">
      <div class="net-table-wrap" id="netTableWrap">
        <div class="net-header" id="netHeader"></div>
        <div class="net-rows" id="netRows">
          <div class="empty-state" id="networkEmpty">
            <div class="icon">📡</div>
            <div class="label">No requests yet</div>
            <div class="hint">API calls will appear here automatically</div>
          </div>
        </div>
      </div>
      <div class="net-detail-pane" id="netDetailPane">
        <div class="net-detail-bar">
          <div class="detail-tabs" id="netDetailTabs"></div>
          <button class="detail-close" id="netDetailClose" title="Close">&times;</button>
        </div>
        <div class="detail-content" id="netDetailContent"></div>
      </div>
    </div>`;

  $('netToggle').addEventListener('change', (e) => {
    state.network.enabled = e.target.checked;
    $('netToggleText').textContent = e.target.checked ? 'Capture ON' : 'Capture OFF';
    window.electronAPI?.setNetworkCapture(e.target.checked);
  });

  // Network search input
  $('netSearchInput').addEventListener('input', (e) => {
    state.network.searchFilter = e.target.value.toLowerCase().trim();
    renderNetwork();
  });

  // Type filter buttons
  $('netTypeFilters').addEventListener('click', (e) => {
    const btn = e.target.closest('.net-type-btn');
    if (!btn) return;
    $('netTypeFilters').querySelectorAll('.net-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.network.typeFilter = btn.dataset.type;
    renderNetwork();
  });

  // Throttle select
  $('netThrottleSelect').addEventListener('change', (e) => {
    state.network.throttle = e.target.value;
    // Send throttle config to the RN app
    window.electronAPI?.setNetworkThrottle(state.network.throttle);
  });

  // Close detail button
  $('netDetailClose').addEventListener('click', closeNetDetail);

  buildNetHeader();
}

// ─── Column header with sort icons + full-height resize handles ──────────────
function buildNetHeader() {
  const header = $('netHeader');
  header.innerHTML = '';
  NET_COLS.forEach((col, i) => {
    const cell = document.createElement('div');
    cell.className = 'net-hcell';
    cell.style.width = col.width + 'px';
    cell.dataset.col = col.key;

    const label = document.createElement('span');
    label.className = 'net-hcell-label';
    label.textContent = col.label;
    cell.appendChild(label);

    if (col.key !== 'waterfall') {
      const sortIcon = document.createElement('span');
      sortIcon.className = 'net-sort-icon';
      if (state.network.sortCol === col.key) {
        sortIcon.textContent = state.network.sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
        sortIcon.classList.add('active');
      }
      cell.appendChild(sortIcon);
      cell.addEventListener('click', (e) => {
        if (e.target.closest('.net-hcell-resize')) return;
        if (state.network.sortCol === col.key) {
          state.network.sortDir = state.network.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.network.sortCol = col.key;
          state.network.sortDir = col.key === 'name' ? 'asc' : 'desc';
        }
        buildNetHeader();
        renderNetwork();
      });
      cell.style.cursor = 'pointer';
    }

    // Resize handle in header
    if (i < NET_COLS.length - 1) {
      const handle = document.createElement('div');
      handle.className = 'net-hcell-resize';
      handle.addEventListener('mousedown', (e) => startColResize(e, col));
      cell.appendChild(handle);
    }
    header.appendChild(cell);
  });

  // Build full-height resize overlay lines
  buildResizeOverlays();
}

function buildResizeOverlays() {
  // Remove old overlays
  document.querySelectorAll('.net-resize-overlay').forEach(e => e.remove());
  const tableWrap = $('netTableWrap');
  if (!tableWrap) return;
  // Make the table wrap position:relative for overlay positioning
  tableWrap.style.position = 'relative';

  let leftOffset = 0;
  NET_COLS.forEach((col, i) => {
    leftOffset += col.width;
    if (i >= NET_COLS.length - 1) return; // no handle after last column

    const overlay = document.createElement('div');
    overlay.className = 'net-resize-overlay';
    overlay.style.left = (leftOffset - 3) + 'px';
    overlay.addEventListener('mousedown', (e) => startColResize(e, col));
    tableWrap.appendChild(overlay);
  });
}

function startColResize(e, col) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startW = col.width;

  // Add visual feedback
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  function onMove(ev) {
    const delta = ev.clientX - startX;
    col.width = Math.max(col.min, startW + delta);
    // Update header + all data cells for this column
    document.querySelectorAll(`.net-cell[data-col="${col.key}"], .net-hcell[data-col="${col.key}"]`)
      .forEach(el => el.style.width = col.width + 'px');
    // Keep detail pane aligned with Name column
    if (col.key === 'name' && state.network.selectedId) {
      const pane = $('netDetailPane');
      if (pane) pane.style.left = (col.width + 1) + 'px';
    }
    // Reposition overlays
    buildResizeOverlays();
  }
  function onUp() {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ─── Network type matching ──────────────────────────────────────────────────
function matchNetType(r, type) {
  const ct = (r.responseHeaders?.['content-type'] || r.responseHeaders?.['Content-Type'] || '').toLowerCase();
  const url = (r.url || '').toLowerCase();
  switch (type) {
    case 'fetch': return true; // All XHR/fetch requests pass
    case 'js':    return ct.includes('javascript') || url.endsWith('.js') || url.endsWith('.bundle');
    case 'css':   return ct.includes('css') || url.endsWith('.css');
    case 'img':   return ct.includes('image') || /\.(png|jpg|jpeg|gif|svg|webp|ico)(\?|$)/i.test(url);
    case 'media':  return ct.includes('video') || ct.includes('audio') || /\.(mp4|mp3|wav|webm)(\?|$)/i.test(url);
    case 'font':  return ct.includes('font') || /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(url);
    case 'doc':   return ct.includes('html') || ct.includes('xml');
    case 'ws':    return url.startsWith('ws://') || url.startsWith('wss://');
    default:      return true;
  }
}

let _netRAF = null;

function handleNetworkEvent(event) {
  if (event.type === 'console') { addConsoleLog(event); return; }
  if (event.type !== 'network') return;
  if (!state.network.enabled) return;

  const { id, phase } = event;
  if (phase === 'request') {
    state.network.requests[id] = { ...event, _tab: 'headers' };
    if (!state.network.order.includes(id)) state.network.order.push(id);
    $('nBadge').textContent = state.network.order.length;
  } else {
    Object.assign(state.network.requests[id] || (state.network.requests[id] = {}), event);
  }
  if (!_netRAF) {
    _netRAF = requestAnimationFrame(() => {
      _netRAF = null;
      renderNetwork();
    });
  }
}

// ─── Sort network IDs ───────────────────────────────────────────────────────
function sortNetworkIds(ids) {
  const { sortCol, sortDir } = state.network;
  const reqs = state.network.requests;
  const sorted = [...ids].sort((a, b) => {
    const ra = reqs[a], rb = reqs[b];
    if (!ra || !rb) return 0;
    let va, vb;
    switch (sortCol) {
      case 'name':
        va = (ra.url || '').toLowerCase(); vb = (rb.url || '').toLowerCase();
        return va < vb ? -1 : va > vb ? 1 : 0;
      case 'status':
        va = ra.status || 0; vb = rb.status || 0;
        return va - vb;
      case 'type':
        va = (ra.responseHeaders?.['content-type'] || '').toLowerCase();
        vb = (rb.responseHeaders?.['content-type'] || '').toLowerCase();
        return va < vb ? -1 : va > vb ? 1 : 0;
      case 'size':
        // Use cached size or estimate — avoid JSON.stringify in sort comparator
        va = ra._cachedSize ?? (ra._cachedSize = typeof ra.responseBody === 'string' ? ra.responseBody.length : (ra.responseBody != null ? 100 : 0));
        vb = rb._cachedSize ?? (rb._cachedSize = typeof rb.responseBody === 'string' ? rb.responseBody.length : (rb.responseBody != null ? 100 : 0));
        return va - vb;
      case 'time':
      default:
        va = ra.ts || 0; vb = rb.ts || 0;
        return va - vb;
    }
  });
  if (sortDir === 'desc') sorted.reverse();
  return sorted;
}

// ─── Render network rows ────────────────────────────────────────────────────
function renderNetwork() {
  const rows = $('netRows');
  const empty = $('networkEmpty');
  if (!rows) return;

  const { statusFilter, typeFilter, searchFilter } = state.network;
  const visible = state.network.order.filter(id => {
    const r = state.network.requests[id];
    if (!r) return false;
    if (statusFilter === '2xx' && !(r.status >= 200 && r.status < 300)) return false;
    if (statusFilter === 'errors' && !(r.phase === 'error' || r.status >= 400)) return false;
    if (searchFilter && !r.url?.toLowerCase().includes(searchFilter)) return false;
    if (typeFilter !== 'all' && !matchNetType(r, typeFilter)) return false;
    return true;
  });

  // Sort: apply current sort, default = newest first
  const sortedVisible = sortNetworkIds(visible);

  empty.style.display = sortedVisible.length ? 'none' : 'flex';
  rows.querySelectorAll('.net-row').forEach(e => e.remove());

  // Waterfall scale: find min/max timestamps
  let wfMin = Infinity, wfMax = 0;
  sortedVisible.forEach(id => {
    const r = state.network.requests[id];
    if (r.ts) { wfMin = Math.min(wfMin, r.ts); wfMax = Math.max(wfMax, r.ts + (r.duration || 0)); }
  });
  const wfRange = Math.max(wfMax - wfMin, 1);

  // Render max 300 rows for performance
  const MAX_NET_ROWS = 300;
  const toRender = sortedVisible.length > MAX_NET_ROWS ? sortedVisible.slice(0, MAX_NET_ROWS) : sortedVisible;

  const frag = document.createDocumentFragment();
  if (sortedVisible.length > MAX_NET_ROWS) {
    const info = document.createElement('div');
    info.className = 'net-row';
    info.style.cssText = 'color:var(--text-dim);font-size:10px;padding:6px 14px;justify-content:center;font-style:italic';
    info.textContent = `Showing ${MAX_NET_ROWS} of ${sortedVisible.length} requests`;
    frag.appendChild(info);
  }
  toRender.forEach(id => {
    const r = state.network.requests[id];
    frag.appendChild(buildNetRow(r, wfMin, wfRange));
  });
  rows.appendChild(frag);
}

function buildNetRow(r, wfMin, wfRange) {
  const row = document.createElement('div');
  row.className = 'net-row' + (r.id === state.network.selectedId ? ' selected' : '') + (r.phase === 'error' ? ' error' : '');
  row.dataset.id = r.id;

  const urlObj = tryURL(r.url);
  const pathname = urlObj ? urlObj.pathname : r.url || '';
  const filename = pathname.split('/').filter(Boolean).pop() || pathname;
  const host = urlObj ? urlObj.host : '';

  // Name — show method + full path (expands with column)
  const nameCell = document.createElement('div');
  nameCell.className = 'net-cell net-cell-name';
  nameCell.dataset.col = 'name';
  nameCell.style.width = NET_COLS[0].width + 'px';
  const method = r.method || '?';
  const mClass = ['GET','POST','PUT','PATCH','DELETE'].includes(method) ? `m-${method}` : 'm-other';
  const fullPath = urlObj ? urlObj.pathname + urlObj.search : r.url || '';
  nameCell.innerHTML = `<span class="method-badge ${mClass}">${method}</span> <span class="net-path" title="${esc(r.url)}">${esc(fullPath)}</span><span class="net-host">${esc(host)}</span>`;
  row.appendChild(nameCell);

  // Status
  const statusCell = document.createElement('div');
  statusCell.className = 'net-cell net-status';
  statusCell.dataset.col = 'status';
  statusCell.style.width = NET_COLS[1].width + 'px';
  let statusStr = '...', sCls = 's-pending';
  if (r.phase === 'error') { statusStr = 'ERR'; sCls = 's-err'; }
  else if (r.status) { statusStr = String(r.status); sCls = `s-${Math.floor(r.status/100)}`; }
  statusCell.className += ` ${sCls}`;
  statusCell.textContent = statusStr;
  row.appendChild(statusCell);

  // Type (content-type from response headers)
  const typeCell = document.createElement('div');
  typeCell.className = 'net-cell net-type';
  typeCell.dataset.col = 'type';
  typeCell.style.width = NET_COLS[2].width + 'px';
  const ct = r.responseHeaders?.['content-type'] || r.responseHeaders?.['Content-Type'] || '';
  typeCell.textContent = ct.split(';')[0].replace('application/', '').replace('text/', '') || '—';
  row.appendChild(typeCell);

  // Initiator
  const initCell = document.createElement('div');
  initCell.className = 'net-cell net-initiator';
  initCell.dataset.col = 'initiator';
  initCell.style.width = NET_COLS[3].width + 'px';
  initCell.textContent = r.initiator || 'xhr';
  row.appendChild(initCell);

  // Size
  const sizeCell = document.createElement('div');
  sizeCell.className = 'net-cell net-size';
  sizeCell.dataset.col = 'size';
  sizeCell.style.width = NET_COLS[4].width + 'px';
  const bodyStr = typeof r.responseBody === 'string' ? r.responseBody : (r.responseBody != null ? JSON.stringify(r.responseBody) : '');
  sizeCell.textContent = bodyStr.length > 0 ? formatSize(bodyStr.length) : '—';
  row.appendChild(sizeCell);

  // Time
  const timeCell = document.createElement('div');
  timeCell.className = 'net-cell net-time' + ((r.duration || 0) > 1500 ? ' slow' : '');
  timeCell.dataset.col = 'time';
  timeCell.style.width = NET_COLS[5].width + 'px';
  timeCell.textContent = r.duration != null ? (r.duration > 999 ? `${(r.duration/1000).toFixed(1)}s` : `${r.duration}ms`) : '...';
  row.appendChild(timeCell);

  // Waterfall
  const wfCell = document.createElement('div');
  wfCell.className = 'net-cell net-waterfall';
  wfCell.dataset.col = 'waterfall';
  wfCell.style.width = NET_COLS[6].width + 'px';
  if (r.ts) {
    const left = ((r.ts - wfMin) / wfRange) * 100;
    const width = Math.max(2, ((r.duration || 50) / wfRange) * 100);
    let barCls = 'pending';
    if (r.phase === 'error') barCls = 'err';
    else if (r.status) barCls = `s${Math.floor(r.status/100)}`;
    wfCell.innerHTML = `<div class="wf-bar ${barCls}" style="left:${left}%;width:${width}%"></div>`;
  }
  row.appendChild(wfCell);

  // Click to select and show detail
  row.addEventListener('click', () => selectNetRequest(r.id));

  // Right-click for context menu (copy as cURL)
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showNetContextMenu(e, r);
  });

  return row;
}

// ─── Select request → overlay detail pane over Status/Type/etc columns ───────
function selectNetRequest(id) {
  state.network.selectedId = id;
  const r = state.network.requests[id];
  if (!r) return;

  // Highlight selected row
  document.querySelectorAll('#netRows .net-row').forEach(el =>
    el.classList.toggle('selected', el.dataset.id === id)
  );

  // Position detail pane to overlay everything after the Name column
  const pane = $('netDetailPane');
  const nameColWidth = NET_COLS[0].width;
  pane.style.left = (nameColWidth + 1) + 'px'; // +1 for the border
  pane.classList.add('open');
  r._tab = r._tab || 'headers';
  renderNetDetailTabs(r);
  renderNetDetailContent(r);
}

function closeNetDetail() {
  state.network.selectedId = null;
  const pane = $('netDetailPane');
  if (pane) pane.classList.remove('open');
  document.querySelectorAll('#netRows .net-row').forEach(el =>
    el.classList.remove('selected')
  );
}

function renderNetDetailTabs(r) {
  const tabs = $('netDetailTabs');
  tabs.innerHTML = '';
  ['Headers', 'Request', 'Preview', 'Response'].forEach(label => {
    const key = label.toLowerCase();
    const btn = document.createElement('button');
    btn.className = 'detail-tab' + (r._tab === key ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      r._tab = key;
      tabs.querySelectorAll('.detail-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderNetDetailContent(r);
    });
    tabs.appendChild(btn);
  });
}

function renderNetDetailContent(r) {
  const body = $('netDetailContent');
  if (!body) return;
  const tab = r._tab || 'headers';

  if (tab === 'headers') {
    const rqH = r.requestHeaders || {};
    const rsH = r.responseHeaders || {};
    const renderH = (title, h) => {
      const keys = Object.keys(h);
      if (!keys.length) return `<div class="section-label">${title}</div><span style="color:var(--text-dim)">none</span>`;
      return `<div class="section-label">${title}</div><div class="kv-grid">${keys.map(k => {
        let val = h[k];
        if (val && typeof val === 'object') { try { val = JSON.stringify(val); } catch { val = String(val); } }
        return `<span class="kv-key">${esc(k)}</span><span class="kv-val">${esc(val)}</span>`;
      }).join('')}</div>`;
    };
    body.innerHTML = `<div class="section-label" style="margin-top:0">General</div>
      <div class="kv-grid">
        <span class="kv-key">Request URL</span><span class="kv-val">${esc(r.url)}</span>
        <span class="kv-key">Method</span><span class="kv-val">${esc(r.method)}</span>
        <span class="kv-key">Status</span><span class="kv-val ${r.status ? 's-' + Math.floor(r.status/100) : 's-pending'}">${r.status || 'Pending'} ${r.statusText || ''}</span>
      </div>
      ${renderH('Response Headers', rsH)}
      ${renderH('Request Headers', rqH)}`;
  } else if (tab === 'request') {
    if (!r.requestBody) {
      body.innerHTML = '<span style="color:var(--text-dim)">No request body</span>';
    } else {
      body.innerHTML = '';
      let reqData = r.requestBody;
      if (typeof reqData === 'string') {
        try { reqData = JSON.parse(reqData); } catch {}
      }
      if (reqData && typeof reqData === 'object') {
        body.appendChild(createTreeNode(null, reqData, false));
        body.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showPreviewCopyMenu(e, reqData);
        });
      } else {
        body.innerHTML = renderJSON(r.requestBody);
      }
    }
  } else if (tab === 'preview') {
    if (r.phase === 'error') { body.innerHTML = `<span style="color:var(--red)">${esc(r.error || 'Request failed')}</span>`; return; }
    if (!r.responseBody && r.phase !== 'response') { body.innerHTML = '<span style="color:var(--text-dim)">Pending...</span>'; return; }
    // Render as collapsible JSON tree with right-click copy
    const val = r.responseBody;
    let treeData = val;
    if (typeof val === 'string') {
      try { treeData = JSON.parse(val); } catch { body.textContent = val; return; }
    }
    if (treeData && typeof treeData === 'object') {
      body.innerHTML = '';
      body.appendChild(createTreeNode(null, treeData, false));
      // Right-click on preview to copy the whole object or clicked node value
      body.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showPreviewCopyMenu(e, treeData);
      });
    } else {
      body.innerHTML = '<span style="color:var(--text-dim)">No preview available</span>';
    }
  } else if (tab === 'response') {
    if (r.phase === 'error') { body.innerHTML = `<span style="color:var(--red)">${esc(r.error || 'Request failed')}</span>`; return; }
    if (!r.responseBody && r.phase !== 'response') { body.innerHTML = '<span style="color:var(--text-dim)">Pending...</span>'; return; }
    body.innerHTML = renderJSON(r.responseBody);
  }
}

// ─── Network context menus ──────────────────────────────────────────────────
function showNetContextMenu(e, r) {
  const items = [
    { label: 'Copy as cURL', action: () => navigator.clipboard.writeText(buildCurlCommand(r)) },
    { label: 'Copy URL', action: () => navigator.clipboard.writeText(r.url || '') },
  ];
  if (r.responseBody) {
    items.push({ label: 'Copy Response', action: () => {
      const text = typeof r.responseBody === 'string' ? r.responseBody : JSON.stringify(r.responseBody, null, 2);
      navigator.clipboard.writeText(text);
    }});
  }
  showContextMenu(e, items);
}

function showPreviewCopyMenu(e, fullData) {
  const items = [
    { label: 'Copy Object', action: () => navigator.clipboard.writeText(JSON.stringify(fullData, null, 2)) },
  ];
  const sel = window.getSelection();
  if (sel && sel.toString().length > 0) {
    items.push({ label: 'Copy Selection', action: () => navigator.clipboard.writeText(sel.toString()) });
  }
  const keyEl = e.target.closest('.ov-key');
  const leafEl = e.target.closest('.ov-leaf');
  if (keyEl || leafEl) {
    items.push({ label: 'Copy Value', action: () => navigator.clipboard.writeText((leafEl || keyEl.parentElement).textContent) });
  }
  showContextMenu(e, items);
}

function buildCurlCommand(r) {
  let cmd = `curl '${r.url}'`;
  if (r.method && r.method !== 'GET') cmd += ` -X ${r.method}`;
  const headers = r.requestHeaders || {};
  Object.entries(headers).forEach(([k, v]) => {
    cmd += ` \\\n  -H '${k}: ${v}'`;
  });
  if (r.requestBody) {
    const body = typeof r.requestBody === 'string' ? r.requestBody : JSON.stringify(r.requestBody);
    cmd += ` \\\n  --data-raw '${body.replace(/'/g, "'\\''")}'`;
  }
  return cmd;
}

// ─────────────────────────────────────────────────────────────────────────────
// GA4 EVENT INSPECTOR
// ─────────────────────────────────────────────────────────────────────────────
const ga4State = { events: [], selected: -1, searchFilter: '', sortDir: 'desc' };

function initGA4Panel() {
  const panel = $('panel-ga4');
  panel.innerHTML = `
    <div class="panel-toolbar">
      <span class="panel-label">GA4 Events</span>
      <span class="badge" id="ga4Badge">0</span>
      <input id="ga4Search" class="net-search-input" style="margin-left:12px" placeholder="Filter events..." />
    </div>
    <div class="ga4-layout">
      <div class="ga4-list-pane">
        <div class="ga4-list-header">
          <span class="ga4-hcell ga4-sort-btn" id="ga4SortBtn" style="width:90px;cursor:pointer" title="Click to toggle sort order">Time <span id="ga4SortIcon">\u25BC</span></span>
          <span class="ga4-hcell" style="flex:1">Event</span>
        </div>
        <div class="scroll-area" id="ga4List">
          <div class="empty-state" id="ga4Empty">
            <div class="icon" style="font-size:28px;opacity:.2">📊</div>
            <div class="label">No GA4 events yet</div>
            <div class="hint">Events from @react-native-firebase/analytics will appear here</div>
          </div>
        </div>
      </div>
      <div class="ga4-resize-handle" id="ga4ResizeHandle"></div>
      <div class="ga4-detail-pane" id="ga4DetailPane">
        <div class="ga4-detail-header">EVENT DETAIL</div>
        <div class="scroll-area ga4-detail-content" id="ga4Detail">
          <span style="color:var(--text-dim);padding:16px;display:block">Click an event to inspect</span>
        </div>
      </div>
    </div>
    <div class="ga4-summary" id="ga4Summary">
      <span class="ga4-summary-label">Total: 0</span>
    </div>`;

  $('ga4Search').addEventListener('input', (e) => {
    ga4State.searchFilter = e.target.value.toLowerCase().trim();
    renderGA4List();
    renderGA4Summary(); // update active chip highlight
  });

  $('ga4SortBtn').addEventListener('click', () => {
    ga4State.sortDir = ga4State.sortDir === 'desc' ? 'asc' : 'desc';
    $('ga4SortIcon').textContent = ga4State.sortDir === 'desc' ? '\u25BC' : '\u25B2';
    renderGA4List();
  });

  // Resizable divider between list and detail
  const resizeHandle = $('ga4ResizeHandle');
  const detailPane = $('ga4DetailPane');
  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = detailPane.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    function onMove(ev) {
      const delta = startX - ev.clientX;
      detailPane.style.width = Math.max(200, Math.min(window.innerWidth * 0.8, startWidth + delta)) + 'px';
    }
    function onUp() {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function handleGA4Event(event) {
  ga4State.events.push({
    name: event.name || '?',
    params: event.params || {},
    tag: event.tag || 'GA4',
    source: event.source || '',
    ts: event.ts || Date.now(),
    index: ga4State.events.length,
  });
  $('ga4Badge').textContent = ga4State.events.length;

  // Append to list (batched via rAF)
  if (!ga4State._raf) {
    ga4State._raf = requestAnimationFrame(() => {
      ga4State._raf = null;
      renderGA4List();
      renderGA4Summary();
    });
  }
}

function renderGA4List() {
  const list = $('ga4List');
  const empty = $('ga4Empty');
  if (!list) return;

  const { searchFilter, sortDir } = ga4State;
  let visible = ga4State.events.filter(e =>
    !searchFilter || e.name.toLowerCase().includes(searchFilter)
  );

  // Sort: newest first (desc) or oldest first (asc)
  if (sortDir === 'desc') {
    visible = [...visible].reverse();
  }

  empty.style.display = visible.length ? 'none' : 'flex';
  list.querySelectorAll('.ga4-row').forEach(e => e.remove());

  // Cap at 500 rows
  const MAX = 500;
  const toRender = visible.length > MAX ? visible.slice(0, MAX) : visible;

  const frag = document.createDocumentFragment();
  toRender.forEach(e => {
    const row = document.createElement('div');
    row.className = 'ga4-row' + (e.index === ga4State.selected ? ' selected' : '');

    const time = new Date(e.ts).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });

    row.innerHTML = `
      <span class="ga4-cell ga4-time">${time}</span>
      <span class="ga4-cell ga4-name">${esc(e.name)}</span>`;

    row.addEventListener('click', () => {
      ga4State.selected = e.index;
      list.querySelectorAll('.ga4-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      renderGA4Detail(e);
    });

    // Right-click to copy
    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      showContextMenu(ev, [
        { label: 'Copy Event Name', action: () => navigator.clipboard.writeText(e.name) },
        { label: 'Copy as JSON', action: () => navigator.clipboard.writeText(JSON.stringify({ event: e.name, params: e.params }, null, 2)) },
      ]);
    });

    frag.appendChild(row);
  });
  list.appendChild(frag);
}

function renderGA4Detail(e) {
  const detail = $('ga4Detail');
  if (!detail) return;

  const time = new Date(e.ts).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });

  detail.innerHTML = '';

  // Header info
  const header = document.createElement('div');
  header.className = 'ga4-detail-info';
  header.innerHTML = `
    <div class="ga4-detail-row"><span class="ga4-detail-key">Event Name</span><span class="ga4-detail-val" style="color:var(--accent);font-weight:600">${esc(e.name)}</span></div>
    <div class="ga4-detail-row"><span class="ga4-detail-key">Timestamp</span><span class="ga4-detail-val">${time}</span></div>
`;
  detail.appendChild(header);

  // Separator
  const sep = document.createElement('div');
  sep.className = 'ga4-detail-sep';
  detail.appendChild(sep);

  // Parameters as key-value list with collapsible objects
  if (e.params && typeof e.params === 'object') {
    const keys = Object.keys(e.params).sort();
    keys.forEach(key => {
      const val = e.params[key];
      const row = document.createElement('div');
      row.className = 'ga4-param-row';

      const keyEl = document.createElement('span');
      keyEl.className = 'ga4-param-key';
      keyEl.textContent = key;
      row.appendChild(keyEl);

      if (val && typeof val === 'object') {
        // Collapsible object tree
        const treeWrap = document.createElement('span');
        treeWrap.className = 'ga4-param-val';
        treeWrap.appendChild(createTreeNode(null, val, true));
        row.appendChild(treeWrap);
      } else {
        const valEl = document.createElement('span');
        valEl.className = 'ga4-param-val';
        valEl.textContent = val === null ? 'null' : val === undefined ? 'undefined' : JSON.stringify(val);
        if (typeof val === 'string') valEl.style.color = 'var(--green)';
        else if (typeof val === 'number') valEl.style.color = 'var(--orange)';
        else if (typeof val === 'boolean') valEl.style.color = 'var(--accent2)';
        row.appendChild(valEl);
      }

      detail.appendChild(row);
    });
  }

  // Right-click on detail
  detail.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    showContextMenu(ev, [
      { label: 'Copy All Parameters', action: () => navigator.clipboard.writeText(JSON.stringify(e.params, null, 2)) },
      { label: 'Copy Event JSON', action: () => navigator.clipboard.writeText(JSON.stringify({ event: e.name, params: e.params, timestamp: e.ts }, null, 2)) },
    ]);
  });
}

function renderGA4Summary() {
  const summary = $('ga4Summary');
  if (!summary) return;

  const counts = {};
  ga4State.events.forEach(e => {
    counts[e.name] = (counts[e.name] || 0) + 1;
  });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  summary.innerHTML = '';

  const totalLabel = document.createElement('span');
  totalLabel.className = 'ga4-summary-label';
  totalLabel.textContent = `Total: ${ga4State.events.length}`;
  summary.appendChild(totalLabel);

  sorted.forEach(([name, count]) => {
    const chip = document.createElement('span');
    const isActive = ga4State.searchFilter === name.toLowerCase();
    chip.className = 'ga4-summary-chip' + (isActive ? ' active' : '');
    chip.innerHTML = `<b>${esc(name)}</b><span class="chip-count">${count}</span>`;
    chip.addEventListener('click', () => {
      const search = $('ga4Search');
      if (isActive) {
        // Clear filter
        ga4State.searchFilter = '';
        if (search) search.value = '';
      } else {
        // Set filter to this event name
        ga4State.searchFilter = name.toLowerCase();
        if (search) search.value = name;
      }
      renderGA4List();
      renderGA4Summary();
    });
    summary.appendChild(chip);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// REDUX PANEL
// ─────────────────────────────────────────────────────────────────────────────
function initReduxPanel() {
  const panel = $('panel-redux');
  panel.innerHTML = `
    <div class="panel-toolbar">
      <span class="panel-label">Redux</span>
      <span class="badge" id="rBadge">0</span>
      <div class="ml-auto" style="display:flex;align-items:center;gap:8px">
        <input id="reduxSearch" class="net-search-input" placeholder="Filter actions..." />
        <div class="time-travel-bar" style="border:none;padding:0;margin:0">
          <button class="tt-btn" onclick="reduxJumpTo(state.redux.selected-1)">◀</button>
          <span class="tt-label" id="ttLabel">—/—</span>
          <button class="tt-btn" onclick="reduxJumpTo(state.redux.selected+1)">▶</button>
        </div>
      </div>
    </div>
    <div class="scroll-area" id="reduxContent">
      <div class="empty-state" id="reduxEmpty">
        <div class="icon">🔲</div>
        <div class="label">No actions dispatched</div>
        <div class="hint">Connect Redux store to RNDebugSDK</div>
      </div>
    </div>`;

  $('reduxSearch').addEventListener('input', (e) => {
    state.redux.searchFilter = e.target.value.toLowerCase().trim();
    renderRedux();
  });
}

window.reduxJumpTo = idx => {
  const { actions } = state.redux;
  if (!actions.length) return;
  idx = Math.max(0, Math.min(actions.length - 1, idx));
  state.redux.selected = idx;
  renderRedux();
};

// Fast deep equality check for Redux state comparison
function _deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch { return false; }
}

function handleReduxEvent(event) {
  if (event.type !== 'redux') return;
  const { action, nextState } = event;
  const idx = state.redux.actions.length;

  const prevState = state.redux.states.length > 0 ? state.redux.states[state.redux.states.length - 1] : null;
  const changedKeys = [];
  if (prevState && nextState && typeof prevState === 'object' && typeof nextState === 'object') {
    const allKeys = new Set([...Object.keys(prevState), ...Object.keys(nextState)]);
    allKeys.forEach(k => { if (!_deepEqual(prevState[k], nextState[k])) changedKeys.push(k); });
  }

  state.redux.actions.push({ type: action?.type || '?', payload: action, ts: event.ts, index: idx, changedKeys });
  state.redux.states.push(nextState);
  state.redux.selected = idx;
  $('rBadge').textContent = state.redux.actions.length;
  renderRedux();
}

function renderRedux() {
  const content = $('reduxContent');
  const empty = $('reduxEmpty');
  if (!content) return;

  const { actions, states, selected, searchFilter } = state.redux;
  const visible = searchFilter ? actions.filter(a => a.type.toLowerCase().includes(searchFilter)) : actions;

  empty.style.display = visible.length ? 'none' : 'flex';
  content.querySelectorAll('.rdx-entry').forEach(e => e.remove());
  if (!visible.length) return;

  const ttLabel = $('ttLabel');
  if (ttLabel) ttLabel.textContent = `${selected + 1}/${actions.length}`;

  const frag = document.createDocumentFragment();
  visible.forEach(a => {
    const isSelected = a.index === selected;
    const isPrev = a.index === selected - 1;
    const isNext = a.index === selected + 1;

    const entry = document.createElement('div');
    entry.className = 'rdx-entry' + (isSelected ? ' selected' : '') + (isPrev ? ' is-prev' : '') + (isNext ? ' is-next' : '');

    // Row header — always visible
    const header = document.createElement('div');
    header.className = 'rdx-entry-header';
    const changesBadge = a.changedKeys?.length ? `<span class="rdx-changes">${a.changedKeys.length}</span>` : '';
    const roleTag = isPrev ? '<span class="rdx-role prev">PREV</span>' : isNext ? '<span class="rdx-role next">NEXT</span>' : isSelected ? '<span class="rdx-role current">CURRENT</span>' : '';
    header.innerHTML = `<span class="rdx-index">#${a.index}</span>${roleTag}<span class="rdx-type">${esc(a.type)}</span>${changesBadge}<span class="rdx-time">${ts(a.ts)}</span>`;
    header.addEventListener('click', () => { state.redux.selected = a.index; renderRedux(); });
    entry.appendChild(header);

    // Expanded detail for selected / prev / next
    if (isSelected || isPrev || isNext) {
      const detail = document.createElement('div');
      detail.className = 'rdx-entry-detail';

      // Changed keys badges
      if (a.changedKeys?.length > 0) {
        const keysEl = document.createElement('div');
        keysEl.className = 'redux-changed-keys';
        keysEl.innerHTML = `<span class="redux-changed-label">Changed:</span> ${a.changedKeys.map(k =>
          `<span class="redux-changed-key">${esc(k)}</span>`).join(' ')}`;
        detail.appendChild(keysEl);
      }

      // Payload
      if (a.payload) {
        const pLabel = document.createElement('div');
        pLabel.className = 'redux-section-title';
        pLabel.textContent = 'Payload';
        detail.appendChild(pLabel);
        detail.appendChild(createTreeNode(null, a.payload, !isSelected));
      }

      // Store changes (only for selected)
      if (isSelected) {
        const prevS = a.index > 0 ? states[a.index - 1] : null;
        const currS = states[a.index];
        if (currS && typeof currS === 'object' && a.changedKeys?.length > 0) {
          const sLabel = document.createElement('div');
          sLabel.className = 'redux-section-title';
          sLabel.textContent = 'Store Changes';
          detail.appendChild(sLabel);

          a.changedKeys.forEach(key => {
            const keyWrap = document.createElement('div');
            keyWrap.className = 'rdx-store-diff';
            const kLabel = document.createElement('div');
            kLabel.className = 'rdx-store-key-label';
            kLabel.textContent = key;
            keyWrap.appendChild(kLabel);

            if (prevS && prevS[key] !== undefined) {
              const prevRow = document.createElement('div');
              prevRow.className = 'rdx-diff-row removed';
              prevRow.innerHTML = '<span class="rdx-diff-sign">-</span>';
              prevRow.appendChild(createTreeNode(null, prevS[key], true));
              keyWrap.appendChild(prevRow);
            }
            if (currS[key] !== undefined) {
              const newRow = document.createElement('div');
              newRow.className = 'rdx-diff-row added';
              newRow.innerHTML = '<span class="rdx-diff-sign">+</span>';
              newRow.appendChild(createTreeNode(null, currS[key], true));
              keyWrap.appendChild(newRow);
            }
            detail.appendChild(keyWrap);
          });
        }
      }

      entry.appendChild(detail);
    }

    frag.appendChild(entry);
  });

  content.appendChild(frag);
  const selEl = content.querySelector('.rdx-entry.selected');
  if (selEl) selEl.scrollIntoView({ block: 'nearest' });
}

// ─────────────────────────────────────────────────────────────────────────────
// ASYNC STORAGE PANEL
// ─────────────────────────────────────────────────────────────────────────────
function initStoragePanel() {
  const panel = $('panel-storage');
  panel.innerHTML = `
    <div class="panel-toolbar">
      <span class="panel-label">AsyncStorage</span>
      <span class="badge" id="sBadge">0</span>
      <div class="ml-auto">
        <input id="storageSearch" class="net-search-input" placeholder="Filter keys..." />
      </div>
    </div>
    <div class="storage-layout">
      <div class="storage-keys">
        <div class="panel-toolbar" style="height:32px">
          <span style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Keys</span>
        </div>
        <div class="scroll-area storage-keys-list" id="storageKeyList">
          <div class="empty-state" id="storageEmpty">
            <div class="icon">💾</div>
            <div class="label">No storage data</div>
            <div class="hint">Add storage plugin to RNDebugPlugin</div>
          </div>
        </div>
      </div>
      <div class="storage-value-view">
        <div class="storage-value-toolbar">
          <span style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Value</span>
          <span id="storageSelectedKey" style="font-size:11px;color:var(--accent);margin-left:8px"></span>
        </div>
        <div class="storage-value-body" id="storageValueBody">
          <span style="color:var(--text-dim)">Select a key to view its value</span>
        </div>
      </div>
     </div>`;

  $('storageSearch').addEventListener('input', (e) => {
    state.storage.searchFilter = e.target.value.toLowerCase().trim();
    renderStorage();
  });
}

let _storageRAF = null;

function handleStorageEvent(event) {
  if (event.type !== 'storage') return;
  const { key, value, action } = event;
  if (action === 'set' || action === 'snapshot') {
    if (action === 'snapshot' && typeof key === 'object') {
      // Skip if data hasn't changed
      const newKeys = Object.keys(key).slice().sort().join(',');
      const oldKeys = state.storage.keys.slice().sort().join(',');
      if (newKeys === oldKeys) {
        // Check if values changed
        let same = true;
        for (const [k, v] of Object.entries(key)) {
          if (state.storage.entries[k] !== v) { same = false; break; }
        }
        if (same) return; // No changes, skip re-render
      }
      Object.entries(key).forEach(([k, v]) => {
        state.storage.entries[k] = v;
        if (!state.storage.keys.includes(k)) state.storage.keys.push(k);
      });
    } else {
      if (state.storage.entries[key] === value) return; // No change
      state.storage.entries[key] = value;
      if (!state.storage.keys.includes(key)) state.storage.keys.push(key);
    }
  } else if (action === 'remove') {
    if (!(key in state.storage.entries)) return; // Already removed
    delete state.storage.entries[key];
    state.storage.keys = state.storage.keys.filter(k => k !== key);
    if (state.storage.selected === key) state.storage.selected = null;
  }
  $('sBadge').textContent = state.storage.keys.length;
  // Debounce render via rAF
  if (!_storageRAF) {
    _storageRAF = requestAnimationFrame(() => {
      _storageRAF = null;
      renderStorage();
    });
  }
}

function renderStorage() {
  const list = $('storageKeyList');
  const empty = $('storageEmpty');
  if (!list) return;

  const { searchFilter } = state.storage;
  const visible = state.storage.keys.filter(k =>
    !searchFilter || k.toLowerCase().includes(searchFilter)
  );

  empty.style.display = visible.length ? 'none' : 'flex';
  list.querySelectorAll('.storage-key-row').forEach(e => e.remove());

  const frag = document.createDocumentFragment();
  visible.forEach(k => {
    const div = document.createElement('div');
    const val = state.storage.entries[k] || '';
    div.className = 'storage-key-row entry' + (k === state.storage.selected ? ' selected' : '');
    div.innerHTML = `
      <span class="key-name">${highlight(esc(k), searchFilter)}</span>
      <span class="key-size">${formatSize(val.length)}</span>`;
    div.onclick = () => { state.storage.selected = k; renderStorage(); renderStorageValue(); };
    frag.appendChild(div);
  });
  list.appendChild(frag);
  renderStorageValue();
}

function renderStorageValue() {
  const body = $('storageValueBody');
  const keyLabel = $('storageSelectedKey');
  if (!body) return;
  const { selected, entries } = state.storage;
  if (!selected) {
    body.innerHTML = '<span style="color:var(--text-dim)">Select a key</span>';
    if (keyLabel) keyLabel.textContent = '';
    return;
  }
  if (keyLabel) keyLabel.textContent = selected;
  body.innerHTML = renderJSON(entries[selected]);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}b`;
  return `${(bytes/1024).toFixed(1)}kb`;
}

// ─────────────────────────────────────────────────────────────────────────────
// REACT TREE PANEL
// ─────────────────────────────────────────────────────────────────────────────
function initReactPanel() {
  const panel = $('panel-react');
  panel.innerHTML = `
    <div class="panel-toolbar">
      <span class="panel-label">React Tree</span>
    </div>
    <div class="react-panel-inner">
      <div class="react-connect-hint" id="reactHint">
        <div class="icon" style="font-size:40px;opacity:.2">⚛️</div>
        <div class="label">React DevTools</div>
        <div class="hint">Launches as a separate window connected to your app</div>
        <div class="hint">React Native auto-connects on port <code>8097</code> in dev mode</div>
        <button class="btn-launch" id="btnReactDT">Open React DevTools ↗</button>
      </div>
    </div>`;

  $('btnReactDT').addEventListener('click', () => {
    window.electronAPI?.openReactDevTools();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS PANEL
// ─────────────────────────────────────────────────────────────────────────────
function getStoredTheme() {
  try { return localStorage.getItem('rn-debug-theme') || 'dark'; } catch { return 'dark'; }
}
function setStoredTheme(t) {
  try { localStorage.setItem('rn-debug-theme', t); } catch {}
}
function getStoredFontSize() {
  try { return parseInt(localStorage.getItem('rn-debug-fontsize')) || 12; } catch { return 12; }
}
function setStoredFontSize(s) {
  try { localStorage.setItem('rn-debug-fontsize', String(s)); } catch {}
}

function getStoredAppName() {
  try { return localStorage.getItem('rn-debug-appname') || 'ReactoRadar'; } catch { return 'ReactoRadar'; }
}
function setStoredAppName(n) {
  try { localStorage.setItem('rn-debug-appname', n); } catch {}
}
function applyAppName(name) {
  const logo = document.querySelector('.logo');
  if (logo) {
    // Split name — first part normal, last word in accent span
    const words = name.split(/(?=[A-Z])/);
    if (words.length >= 2) {
      logo.innerHTML = words.slice(0, -1).join('') + '<span>' + words[words.length - 1] + '</span>';
    } else {
      logo.textContent = name;
    }
  }
  document.title = name;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  // Tell main process (light themes need light nativeTheme for window chrome)
  const isLight = ['light', 'solarized-light'].includes(theme);
  window.electronAPI?.setTheme(isLight ? 'light' : 'dark');
}

function applyFontSize(size) {
  document.documentElement.style.setProperty('--app-font-size', size + 'px');
  document.body.style.fontSize = size + 'px';
  // Inject/update a <style> tag so ALL current and future elements get the size
  let styleEl = document.getElementById('dynamic-font-size');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'dynamic-font-size';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `
    .log-preview, .log-body, .log-text, .log-caller-inline,
    .net-cell, .net-cell-name, .net-type, .net-initiator, .net-size, .net-time, .net-status,
    .detail-content, .kv-val, .kv-key,
    .rdx-type, .rdx-entry-detail, .rdx-store-key-label,
    .storage-value-body, .storage-key-row,
    .sources-code, .source-line-code,
    .ov-leaf, .ov-key, .ov-preview, .ov-str, .ov-num, .ov-bool, .ov-null, .ov-undef,
    .perf-meter-label,
    .settings-label, .settings-hint {
      font-size: ${size}px !important;
    }
  `;
  const display = $('fontSizeDisplay');
  if (display) display.textContent = size + 'px';
}

function initSettingsPanel() {
  const panel = $('panel-settings');
  const current = getStoredTheme();
  const currentSize = getStoredFontSize();
  panel.innerHTML = `
    <div class="panel-toolbar">
      <span class="panel-label">Settings</span>
    </div>
    <div class="scroll-area">
      <div class="settings-content">
        <div class="settings-section">
          <div class="settings-section-title">Appearance</div>
          <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px">
            <div>
              <div class="settings-label">Theme</div>
              <div class="settings-hint">Choose a color theme for the debugger</div>
            </div>
            <div class="theme-grid" id="themeSwitcher"></div>
          </div>
          <div class="settings-row">
            <div>
              <div class="settings-label">Font Size</div>
              <div class="settings-hint">Adjust text size across all panels</div>
            </div>
            <div class="font-size-control">
              <button class="font-size-btn" id="fontSizeDown">A-</button>
              <span class="font-size-display" id="fontSizeDisplay">${currentSize}px</span>
              <button class="font-size-btn" id="fontSizeUp">A+</button>
            </div>
           </div>
          <div class="settings-row">
            <div>
              <div class="settings-label">App Name</div>
              <div class="settings-hint">Customize the app title (visible in titlebar)</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <input id="appNameInput" class="net-search-input" style="width:140px;text-align:center" value="${getStoredAppName()}" />
              <button class="font-size-btn" id="appNameReset" title="Reset to default">Reset</button>
            </div>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">Connection</div>
          <div class="settings-row">
            <div>
              <div class="settings-label">Bridge Ports</div>
              <div class="settings-hint">Redux :9090 &middot; Storage :9091 &middot; Network :9092 &middot; React DT :8097</div>
            </div>
          </div>
          <div class="settings-row">
            <div>
              <div class="settings-label">Metro Bundler</div>
              <div class="settings-hint">CDP target discovery on :8081</div>
            </div>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">Keyboard Shortcuts</div>
          <div class="settings-row">
            <div class="settings-label">Clear Active Tab</div>
            <div class="settings-hint" style="font-size:11px;color:var(--text-mid)">Clear button</div>
          </div>
          <div class="settings-row">
            <div class="settings-label">Clear All</div>
            <div class="settings-hint" style="font-size:11px;color:var(--text-mid)">&#8984;K</div>
          </div>
          <div class="settings-row">
            <div class="settings-label">Open JS Debugger</div>
            <div class="settings-hint" style="font-size:11px;color:var(--text-mid)">&#8984;D</div>
          </div>
          <div class="settings-row">
            <div class="settings-label">Open React DevTools</div>
            <div class="settings-hint" style="font-size:11px;color:var(--text-mid)">&#8984;R</div>
          </div>
          <div class="settings-row">
            <div class="settings-label">Toggle Theme</div>
            <div class="settings-hint" style="font-size:11px;color:var(--text-mid)">&#8984;&#8679;T</div>
          </div>
          <div class="settings-row">
            <div class="settings-label">Zoom In / Out</div>
            <div class="settings-hint" style="font-size:11px;color:var(--text-mid)">&#8984;+ / &#8984;-</div>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">How to Use</div>
          <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px">
            <div class="settings-hint" style="line-height:1.8">
              <b style="color:var(--text)">1. Setup</b> — Run <code style="color:var(--accent);background:var(--bg3);padding:1px 5px;border-radius:3px">npx reactoradar setup</code> from your RN project<br/>
              <b style="color:var(--text)">2. Start</b> — Run <code style="color:var(--accent);background:var(--bg3);padding:1px 5px;border-radius:3px">npx reactoradar</code> or open ReactoRadar.app<br/>
              <b style="color:var(--text)">3. Run your app</b> — <code style="color:var(--accent);background:var(--bg3);padding:1px 5px;border-radius:3px">npx react-native start --reset-cache</code><br/>
              <b style="color:var(--text)">4. Debug</b> — Console, Network, Redux data flows automatically<br/>
              <b style="color:var(--text)">5. Remove</b> — Run <code style="color:var(--accent);background:var(--bg3);padding:1px 5px;border-radius:3px">npx reactoradar remove</code> to clean uninstall
            </div>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">About</div>
          <div class="settings-about">
            <div class="about-name" id="aboutAppName">${getStoredAppName()}</div>
            <div class="about-version" id="aboutVersion">v${state._appVersion || '...'}</div>
            <div class="about-desc">A standalone macOS debugger for React Native apps.<br/>Supports Hermes, New Architecture, and React Native 0.74+.</div>
            <div class="about-links" style="display:flex;gap:16px;justify-content:center">
              <span class="about-link" id="linkGithub">GitHub</span>
              <span class="about-link" id="linkDocs">Documentation</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  // Build theme cards
  const themes = [
    { id: 'dark',            name: 'Dark',            colors: ['#0d0e11','#4facff','#3dd68c','#ff5e72'] },
    { id: 'light',           name: 'Light',           colors: ['#f5f6f8','#0969da','#1a7f37','#cf222e'] },
    { id: 'monokai',         name: 'Monokai',         colors: ['#272822','#66d9ef','#a6e22e','#f92672'] },
    { id: 'dracula',         name: 'Dracula',         colors: ['#282a36','#8be9fd','#50fa7b','#ff5555'] },
    { id: 'solarized-dark',  name: 'Solarized Dark',  colors: ['#002b36','#268bd2','#859900','#dc322f'] },
    { id: 'solarized-light', name: 'Solarized Light', colors: ['#fdf6e3','#268bd2','#859900','#dc322f'] },
    { id: 'nord',            name: 'Nord',            colors: ['#2e3440','#88c0d0','#a3be8c','#bf616a'] },
    { id: 'github-dark',     name: 'GitHub Dark',     colors: ['#0d1117','#58a6ff','#3fb950','#f85149'] },
    { id: 'one-dark',        name: 'One Dark',        colors: ['#282c34','#61afef','#98c379','#e06c75'] },
  ];
  const grid = $('themeSwitcher');
  themes.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'theme-card' + (current === t.id ? ' active' : '');
    btn.dataset.theme = t.id;
    btn.innerHTML = '<div class="theme-preview" style="background:' + t.colors[0] + '">' +
      '<span style="background:' + t.colors[1] + '"></span>' +
      '<span style="background:' + t.colors[2] + '"></span>' +
      '<span style="background:' + t.colors[3] + '"></span>' +
      '</div><div class="theme-name">' + t.name + '</div>';
    grid.appendChild(btn);
  });

  // Theme switcher
  $('themeSwitcher').addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-card');
    if (!btn) return;
    const theme = btn.dataset.theme;
    document.querySelectorAll('#themeSwitcher .theme-card').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setStoredTheme(theme);
    applyTheme(theme);
  });

  // About links
  $('linkGithub')?.addEventListener('click', () => {
    window.electronAPI?.openExternal('https://github.com/sharanagouda/react-native-debugger');
  });
  $('linkDocs')?.addEventListener('click', () => {
    window.electronAPI?.openExternal('https://github.com/sharanagouda/react-native-debugger#readme');
  });

  // App name
  $('appNameInput').addEventListener('change', (e) => {
    const name = e.target.value.trim() || 'ReactoRadar';
    setStoredAppName(name);
    applyAppName(name);
  });
  $('appNameReset').addEventListener('click', () => {
    setStoredAppName('ReactoRadar');
    $('appNameInput').value = 'ReactoRadar';
    applyAppName('ReactoRadar');
  });

  // Font size controls
  $('fontSizeDown').addEventListener('click', () => {
    let size = getStoredFontSize();
    size = Math.max(8, size - 1);
    setStoredFontSize(size);
    applyFontSize(size);
  });
  $('fontSizeUp').addEventListener('click', () => {
    let size = getStoredFontSize();
    size = Math.min(20, size + 1);
    setStoredFontSize(size);
    applyFontSize(size);
  });
}

// Apply saved theme + font size + app name on load
applyTheme(getStoredTheme());
applyFontSize(getStoredFontSize());
applyAppName(getStoredAppName());

// ─────────────────────────────────────────────────────────────────────────────
// SOURCES PANEL — CDP-based file browser + breakpoints
// ─────────────────────────────────────────────────────────────────────────────
function initSourcesPanel() {
  const panel = $('panel-sources');
  panel.innerHTML = `
    <div class="panel-toolbar">
      <span class="panel-label">Sources</span>
      <div class="ml-auto" style="display:flex;gap:6px">
        <button class="tb-btn" id="btnOpenSourcesExt" title="Open in separate DevTools window">Breakpoints ↗</button>
      </div>
    </div>
    <div class="sources-layout">
      <div class="sources-sidebar" id="sourcesSidebar">
        <div class="panel-toolbar" style="height:32px">
          <input id="sourcesSearch" class="net-search-input" style="width:100%" placeholder="Search files..." />
        </div>
        <div class="scroll-area sources-file-list" id="sourcesFileList">
          <div class="empty-state" id="sourcesEmpty">
            <div class="icon" style="font-size:28px;opacity:.2">&lt;/&gt;</div>
            <div class="label">Waiting for Metro...</div>
            <div class="hint">Source files will load when Metro is running</div>
          </div>
        </div>
      </div>
      <div class="sources-editor" id="sourcesEditor">
        <div class="panel-toolbar" style="height:32px">
          <span id="sourcesFileName" style="font-size:10px;color:var(--accent)"></span>
          <span id="sourcesLineInfo" style="font-size:10px;color:var(--text-dim);margin-left:auto"></span>
        </div>
        <div class="scroll-area sources-code" id="sourcesCode">
          <span style="color:var(--text-dim);padding:20px;display:block">Select a file to view its source</span>
        </div>
      </div>
    </div>`;

  // Open JS Debugger for breakpoints
  $('btnOpenSourcesExt').addEventListener('click', () => {
    window.electronAPI?.openCDPTarget(null);
  });

  // Search filter for file tree
  $('sourcesSearch').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    document.querySelectorAll('#sourcesFileList .src-tree-file').forEach(row => {
      const filepath = row.dataset.file || '';
      const match = !term || filepath.toLowerCase().includes(term);
      row.style.display = match ? '' : 'none';
    });
    // Show/hide folder nodes based on whether they have visible children
    document.querySelectorAll('#sourcesFileList .src-tree-folder').forEach(folder => {
      const visibleFiles = folder.querySelectorAll('.src-tree-file:not([style*="display: none"])');
      folder.style.display = (!term || visibleFiles.length > 0) ? '' : 'none';
      // Auto-expand folders when searching
      if (term && visibleFiles.length > 0) {
        const children = folder.querySelector('.src-tree-children');
        const arrow = folder.querySelector('.src-tree-arrow');
        if (children) children.style.display = 'block';
        if (arrow) { arrow.textContent = '\u25BC'; arrow.classList.add('expanded'); }
      }
    });
  });

  // Fetch the source map / bundle modules list from Metro
  fetchSourceFileList();
}

async function fetchSourceFileList() {
  if (!window.electronAPI?.getSourceFileList) {
    console.log('[Sources] electronAPI.getSourceFileList not available, retrying...');
    setTimeout(fetchSourceFileList, 5000);
    return;
  }
  try {
    console.log('[Sources] Fetching file list from Metro...');
    const result = await window.electronAPI.getSourceFileList();
    console.log('[Sources] Got result:', result?.files?.length, 'files, root:', result?.root?.slice(-30));
    if (result?.files && result.files.length > 0) {
      state._sourcesRoot = result.root;
      // Limit to 500 files max to avoid DOM overload
      const files = result.files.length > 500 ? result.files.slice(0, 500) : result.files;
      renderSourceFileList(files);
      console.log('[Sources] Rendered', files.length, 'files');
    } else {
      console.log('[Sources] No files, retrying in 5s...');
      setTimeout(fetchSourceFileList, 5000);
    }
  } catch (e) {
    console.log('[Sources] Error:', e?.message || e);
    setTimeout(fetchSourceFileList, 5000);
  }
}

function renderSourceFileList(files) {
  const list = $('sourcesFileList');
  const empty = $('sourcesEmpty');
  if (!list) return;
  if (!files.length) return;
  if (empty) empty.style.display = 'none';
  list.querySelectorAll('.src-tree-node').forEach(e => e.remove());

  // Build folder tree from file paths
  const tree = {};
  files.forEach(filepath => {
    const parts = filepath.split('/').filter(Boolean);
    let node = tree;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) {
        // File leaf
        node[part] = filepath; // string = file
      } else {
        // Folder
        if (!node[part] || typeof node[part] === 'string') node[part] = {};
        node = node[part];
      }
    });
  });

  // Render tree recursively
  const frag = document.createDocumentFragment();

  // Project folders first, node_modules last
  const topKeys = Object.keys(tree).sort((a, b) => {
    if (a === 'node_modules') return 1;
    if (b === 'node_modules') return -1;
    return a.localeCompare(b);
  });

  topKeys.forEach(key => {
    frag.appendChild(buildSourceTreeNode(key, tree[key], 0));
  });
  list.appendChild(frag);
}

function buildSourceTreeNode(name, value, depth) {
  if (typeof value === 'string') {
    // File leaf
    const row = document.createElement('div');
    row.className = 'src-tree-node src-tree-file';
    row.dataset.file = value;
    row.style.paddingLeft = (12 + depth * 16) + 'px';
    const isNM = value.includes('node_modules');
    const ext = name.split('.').pop();
    const iconColor = ext === 'tsx' || ext === 'ts' ? '#3178c6'
      : ext === 'jsx' || ext === 'js' ? '#f0db4f'
      : ext === 'json' ? '#a0a0a0'
      : ext === 'css' ? '#264de4'
      : 'var(--text-dim)';
    row.innerHTML = `<span class="src-file-icon" style="color:${iconColor}">●</span><span class="src-file-name" style="color:${isNM ? 'var(--text-dim)' : 'var(--text-bright)'}">${esc(name)}</span>`;
    row.addEventListener('click', () => {
      const fileList = $('sourcesFileList');
      fileList.querySelectorAll('.src-tree-file').forEach(el => el.classList.remove('selected'));
      row.classList.add('selected');
      loadSourceFile(value);
    });
    // Search filter support
    const searchInput = $('sourcesSearch');
    if (searchInput && searchInput.value) {
      const term = searchInput.value.toLowerCase();
      if (!name.toLowerCase().includes(term) && !value.toLowerCase().includes(term)) {
        row.style.display = 'none';
      }
    }
    return row;
  }

  // Folder node
  const container = document.createElement('div');
  container.className = 'src-tree-node src-tree-folder';

  const header = document.createElement('div');
  header.className = 'src-tree-folder-header';
  header.style.paddingLeft = (8 + depth * 16) + 'px';

  const arrow = document.createElement('span');
  arrow.className = 'src-tree-arrow';
  arrow.textContent = '\u25B6';

  const folderName = document.createElement('span');
  folderName.className = 'src-folder-name';
  const isNM = name === 'node_modules';
  folderName.style.color = isNM ? 'var(--text-dim)' : 'var(--text)';
  folderName.textContent = name;

  header.appendChild(arrow);
  header.appendChild(folderName);
  container.appendChild(header);

  const children = document.createElement('div');
  children.className = 'src-tree-children';
  // Start all folders collapsed
  children.style.display = 'none';

  // Sort: folders first, then files
  const entries = Object.entries(value).sort((a, b) => {
    const aIsFolder = typeof a[1] === 'object';
    const bIsFolder = typeof b[1] === 'object';
    if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
    return a[0].localeCompare(b[0]);
  });

  let populated = false;
  function populate() {
    if (populated) return;
    populated = true;
    entries.forEach(([childName, childValue]) => {
      children.appendChild(buildSourceTreeNode(childName, childValue, depth + 1));
    });
  }

  if (!startCollapsed) populate();

  header.addEventListener('click', () => {
    const isOpen = children.style.display !== 'none';
    if (!isOpen) {
      populate();
      children.style.display = 'block';
      arrow.textContent = '\u25BC';
      arrow.classList.add('expanded');
    } else {
      children.style.display = 'none';
      arrow.textContent = '\u25B6';
      arrow.classList.remove('expanded');
    }
  });

  container.appendChild(children);
  return container;
}

async function loadSourceFile(filepath) {
  const codeEl = $('sourcesCode');
  const nameEl = $('sourcesFileName');
  const lineEl = $('sourcesLineInfo');
  if (!codeEl) return;
  if (nameEl) nameEl.textContent = filepath.split('/').pop();
  if (lineEl) lineEl.textContent = filepath;
  codeEl.innerHTML = '<span style="color:var(--text-dim)">Loading...</span>';

  let source = null;
  const root = state._sourcesRoot || '';
  const fullPath = root ? `${root}/${filepath}` : filepath;

  // Strategy 1: Read from disk via IPC (most reliable)
  if (window.electronAPI?.readSourceFile) {
    source = await window.electronAPI.readSourceFile(fullPath);
  }

  // Strategy 2: Fetch from Metro
  if (!source) {
    try {
      const resp = await fetch(`http://localhost:8081/${filepath}?platform=ios&dev=true`);
      if (resp.ok) source = await resp.text();
    } catch {}
  }

  if (!source) {
    codeEl.innerHTML = `<span style="color:var(--text-dim);padding:20px;display:block">Could not load: ${esc(filepath)}</span>`;
    return;
  }

  // Render with line numbers
  const lines = source.split('\n');
  if (lineEl) lineEl.textContent = `${filepath}  (${lines.length} lines)`;
  codeEl.innerHTML = '';
  const pre = document.createElement('pre');
  pre.className = 'source-pre';
  lines.forEach((line, i) => {
    const lineDiv = document.createElement('div');
    lineDiv.className = 'source-line';
    lineDiv.innerHTML = `<span class="source-line-num">${i + 1}</span><span class="source-line-code">${syntaxHighlight(esc(line))}</span>`;
    pre.appendChild(lineDiv);
  });
  codeEl.appendChild(pre);
}

// Called from cdp-targets IPC handler (no longer opens external window)

// Called from cdp-targets IPC handler (shared, no duplicate registration)
// Sources panel uses Metro source map for file tree — CDP targets are only
// used for the "Breakpoints" button, not for the file list.
function updateSourcesPanel(targets) {
  // No-op: file list is populated by fetchSourceFileList from Metro source map
}

// ─────────────────────────────────────────────────────────────────────────────
// PERFORMANCE PANEL — FPS, render timing, JS thread
// ─────────────────────────────────────────────────────────────────────────────
const perfState = { fps: [], jsThread: [], uiThread: [], recording: false, data: [] };

function initPerformancePanel() {
  const panel = $('panel-performance');
  panel.innerHTML = `
    <div class="panel-toolbar">
      <span class="panel-label">Performance</span>
      <div class="ml-auto" style="display:flex;gap:6px">
        <button class="tb-btn" id="btnPerfRecord">Record</button>
        <button class="tb-btn" id="btnPerfClear">Clear</button>
      </div>
    </div>
    <div class="perf-layout">
      <div class="perf-meters">
        <div class="perf-meter">
          <div class="perf-meter-label">FPS</div>
          <div class="perf-meter-value" id="perfFPS">—</div>
          <canvas class="perf-canvas" id="perfFPSCanvas" width="200" height="60"></canvas>
        </div>
        <div class="perf-meter">
          <div class="perf-meter-label">JS Thread</div>
          <div class="perf-meter-value" id="perfJS">—</div>
          <canvas class="perf-canvas" id="perfJSCanvas" width="200" height="60"></canvas>
        </div>
        <div class="perf-meter">
          <div class="perf-meter-label">UI Thread</div>
          <div class="perf-meter-value" id="perfUI">—</div>
          <canvas class="perf-canvas" id="perfUICanvas" width="200" height="60"></canvas>
        </div>
      </div>
      <div class="scroll-area perf-timeline" id="perfTimeline">
        <div class="empty-state" id="perfEmpty">
          <div class="icon" style="font-size:28px;opacity:.2">📊</div>
          <div class="label">No performance data</div>
          <div class="hint">Click "Record" to start capturing performance metrics</div>
          <div class="hint">The SDK sends FPS + thread usage automatically when connected</div>
        </div>
      </div>
    </div>`;

  $('btnPerfRecord').addEventListener('click', () => {
    perfState.recording = !perfState.recording;
    $('btnPerfRecord').textContent = perfState.recording ? 'Stop' : 'Record';
    $('btnPerfRecord').classList.toggle('primary', perfState.recording);
    if (perfState.recording) {
      // Tell SDK to start sending perf data
      window.electronAPI?.setNetworkCapture(true); // reuse channel
    }
  });

  $('btnPerfClear').addEventListener('click', () => {
    perfState.fps = [];
    perfState.jsThread = [];
    perfState.uiThread = [];
    perfState.data = [];
    $('perfFPS').textContent = '—';
    $('perfJS').textContent = '—';
    $('perfUI').textContent = '—';
    clearPerfCanvas('perfFPSCanvas');
    clearPerfCanvas('perfJSCanvas');
    clearPerfCanvas('perfUICanvas');
  });
}

function clearPerfCanvas(id) {
  const canvas = $(id);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawPerfGraph(canvasId, data, maxVal, color) {
  const canvas = $(canvasId);
  if (!canvas || !data.length) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let y = 0; y < h; y += h/4) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // Data line
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const step = w / Math.max(data.length - 1, 1);
  data.forEach((v, i) => {
    const x = i * step;
    const y = h - (v / maxVal) * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Fill under
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = color.replace('1)', '0.1)');
  ctx.fill();
}

// Handle performance events from SDK (always updates meters, graphs only when recording)
function handlePerfEvent(event) {
  if (event.fps != null) {
    perfState.fps.push(event.fps);
    if (perfState.fps.length > 100) perfState.fps.shift();
    const fpsEl = $('perfFPS');
    if (fpsEl) fpsEl.textContent = event.fps + ' fps';
    drawPerfGraph('perfFPSCanvas', perfState.fps, 60, 'rgba(61,214,140,1)');
  }
  if (event.jsThread != null) {
    perfState.jsThread.push(event.jsThread);
    if (perfState.jsThread.length > 100) perfState.jsThread.shift();
    const jsEl = $('perfJS');
    if (jsEl) jsEl.textContent = event.jsThread.toFixed(1) + 'ms';
    drawPerfGraph('perfJSCanvas', perfState.jsThread, 32, 'rgba(79,172,255,1)');
  }
  if (event.uiThread != null) {
    perfState.uiThread.push(event.uiThread);
    if (perfState.uiThread.length > 100) perfState.uiThread.shift();
    const uiEl = $('perfUI');
    if (uiEl) uiEl.textContent = event.uiThread.toFixed(1) + 'ms';
    drawPerfGraph('perfUICanvas', perfState.uiThread, 32, 'rgba(155,127,255,1)');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MEMORY PANEL — Heap snapshot summary via Hermes CDP
// ─────────────────────────────────────────────────────────────────────────────
function initMemoryPanel() {
  const panel = $('panel-memory');
  panel.innerHTML = `
    <div class="panel-toolbar">
      <span class="panel-label">Memory</span>
      <div class="ml-auto" style="display:flex;gap:6px">
        <button class="tb-btn primary" id="btnHeapSnapshot">Take Heap Snapshot</button>
      </div>
    </div>
    <div class="memory-layout">
      <div class="perf-meters" style="padding:14px">
        <div class="perf-meter">
          <div class="perf-meter-label">JS Heap Used</div>
          <div class="perf-meter-value" id="memHeapUsed">—</div>
        </div>
        <div class="perf-meter">
          <div class="perf-meter-label">JS Heap Total</div>
          <div class="perf-meter-value" id="memHeapTotal">—</div>
        </div>
        <div class="perf-meter">
          <div class="perf-meter-label">Native Memory</div>
          <div class="perf-meter-value" id="memNative">—</div>
        </div>
      </div>
      <div class="scroll-area" id="memoryContent">
        <div class="empty-state" id="memoryEmpty">
          <div class="icon" style="font-size:28px;opacity:.2">🧠</div>
          <div class="label">No memory data</div>
          <div class="hint">Click "Take Heap Snapshot" to capture memory usage</div>
          <div class="hint">Requires Hermes CDP connection (press Cmd+D first)</div>
        </div>
      </div>
    </div>`;

  $('btnHeapSnapshot').addEventListener('click', () => {
    // Request heap snapshot via CDP - this opens the DevTools window
    // which has built-in Memory profiler
    window.electronAPI?.openCDPTarget(null);
  });
}

// Handle memory events from SDK
function handleMemoryEvent(event) {
  const hu = $('memHeapUsed'), ht = $('memHeapTotal'), mn = $('memNative');
  if (event.heapUsed != null && hu) hu.textContent = formatSize(event.heapUsed);
  if (event.heapTotal != null && ht) ht.textContent = formatSize(event.heapTotal);
  if (event.native != null && mn) mn.textContent = formatSize(event.native);
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────
initConsolePanel();
initNetworkPanel();
initGA4Panel();
initPerformancePanel();
initMemoryPanel();
initReduxPanel();
initStoragePanel();
initReactPanel();
initSettingsPanel();
