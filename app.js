'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  filter: '',
  activePanel: 'console',
  ports: {},

  console: { logs: [], levelFilters: { log: true, info: true, warn: true, error: true, debug: true }, searchFilter: '', showRedux: false },

  network: {
    requests: {},
    order: [],
    statusFilter: 'all',
    typeFilter: 'fetch',
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
    sortDir: 'asc',
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
  } catch { return esc(typeof val === 'object' ? JSON.stringify(val) : String(val)); }
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
function _getPanelOrder() {
  const order = getTabOrder();
  // Always include settings at the end
  if (!order.includes('settings')) order.push('settings');
  return order;
}

function switchPanel(panel) {
  if (!$(`panel-${panel}`)) return;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const btn = document.querySelector(`.nav-btn[data-panel="${panel}"]`);
  if (btn) btn.classList.add('active');
  $(`panel-${panel}`).classList.add('active');
  state.activePanel = panel;
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
});

// Keyboard shortcuts: Cmd+1–9 for panel switching, Cmd+K clear
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const num = parseInt(e.key);
  const panelOrder = _getPanelOrder();
  if (num >= 1 && num <= panelOrder.length) {
    e.preventDefault();
    const vis = getTabVisibility();
    const target = panelOrder[num - 1];
    if (vis[target] !== false) switchPanel(target);
  }
  if (e.key === 'k') {
    e.preventDefault();
    clearActiveTab();
  }
  if (e.key === 's') {
    e.preventDefault();
    takeScreenshot();
  }
});

// Global filter removed — each panel has its own search input

// ─── Clear (each panel has its own clear button now) ─────────────────────────

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
    case 'native':
      _nativeState.logs = [];
      if ($('nativeBadge')) $('nativeBadge').textContent = '0';
      const nativeList = $('nativeLogList');
      if (nativeList) nativeList.innerHTML = '';
      break;
    default:
      break;
  }
}

// Clear all (used by IPC clear-all-ui from menu Cmd+K, and on device disconnect)
function clearAll() {
  // Cancel pending render batches
  if (_consoleRAF) { cancelAnimationFrame(_consoleRAF); _consoleRAF = null; }
  if (_netRAF) { cancelAnimationFrame(_netRAF); _netRAF = null; }
  if (_storageRAF) { cancelAnimationFrame(_storageRAF); _storageRAF = null; }
  // Console
  state.console.logs = [];
  _consolePending = [];
  _lastLogMsg = ''; _lastLogRow = null; _lastLogCount = 1;
  // Network
  state.network.requests = {};
  state.network.order = [];
  state.network.selectedId = null;
  closeNetDetail();
  // Redux
  state.redux.actions = [];
  state.redux.states = [];
  state.redux.selected = -1;
  // Storage
  state.storage.entries = {};
  state.storage.keys = [];
  state.storage.selected = null;
  // GA4
  ga4State.events = [];
  ga4State.selected = -1;
  ga4State.searchFilter = '';
  const ga4Search = $('ga4Search');
  if (ga4Search) ga4Search.value = '';
  const ga4Detail = $('ga4Detail');
  if (ga4Detail) ga4Detail.innerHTML = '';
  // Native logs
  _nativeState.logs = [];
  const nativeList = $('nativeLogList');
  if (nativeList) nativeList.innerHTML = '';
  // Performance
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
  // Memory
  const memHU = $('memHeapUsed'); if (memHU) memHU.textContent = '—';
  const memHT = $('memHeapTotal'); if (memHT) memHT.textContent = '—';
  const memN = $('memNative'); if (memN) memN.textContent = '—';
  // Badges
  $('cBadge').textContent = '0';
  $('nBadge').textContent = '0';
  $('rBadge').textContent = '0';
  $('sBadge').textContent = '0';
  if ($('ga4Badge')) $('ga4Badge').textContent = '0';
  if ($('nativeBadge')) $('nativeBadge').textContent = '0';
  // Re-render all
  renderConsole();
  renderNetwork();
  renderRedux();
  renderStorage();
  if (typeof renderGA4List === 'function') { renderGA4List(); renderGA4Summary(); }
}

// Free heavy in-memory data without clearing the visible UI.
// Called on device disconnect and app quit to reduce memory footprint
// while keeping logs/network/redux visible for inspection.
function freeMemory() {
  // Drop response/request bodies from network requests (biggest memory hog)
  for (const id of state.network.order) {
    const r = state.network.requests[id];
    if (r) { r.responseBody = null; r.requestBody = null; }
  }
  // Trim console logs to a small tail (keep last 200 for reference)
  if (state.console.logs.length > 200) {
    state.console.logs = state.console.logs.slice(-200);
  }
  // Drop full Redux state snapshots (keep action metadata)
  state.redux.states = [];
  // Drop storage values (keep keys for reference)
  for (const k in state.storage.entries) {
    state.storage.entries[k] = null;
  }
  // Trim GA4 events
  if (ga4State.events.length > 200) {
    ga4State.events = ga4State.events.slice(-200);
  }
  // Trim native logs
  if (_nativeState.logs.length > 200) {
    _nativeState.logs = _nativeState.logs.slice(-200);
  }
  // Drop performance timeline data
  perfState.data = [];
  perfState.fps = [];
  perfState.jsThread = [];
  perfState.uiThread = [];
  // Flush pending console batch
  _consolePending = [];
}

// ─── CDP Button ───────────────────────────────────────────────────────────────
$('btnCDP')?.addEventListener('click', () => {
  // Tell main process to open the CDP DevTools window with the best available target
  window.electronAPI?.openCDPTarget(null); // null = use latest known target
});

// ─── Screenshot Button ────────────────────────────────────────────────────────
$('btnScreenshot')?.addEventListener('click', takeScreenshot);

function takeScreenshot() {
  const btn = $('btnScreenshot');
  if (!btn) return;
  const origText = btn.innerHTML;
  btn.innerHTML = '<span style="opacity:0.6">Saving...</span>';
  // Use Electron's native capturePage — always works, no DOM rendering issues
  window.electronAPI?.captureScreenshot();
  btn.innerHTML = '<span style="color:var(--green)">Saved!</span>';
  setTimeout(() => { btn.innerHTML = origText; }, 2000);
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC from Main
// ─────────────────────────────────────────────────────────────────────────────
if (window.electronAPI) {
  window.electronAPI.on('ports', ports => { state.ports = ports; });

  window.electronAPI.on('cdp-targets', targets => {
    state.cdpTargets = targets;
    const btn = $('btnCDP');
    if (btn) {
      const hasCDP = targets?.length > 0;
      const port = state.ports?.METRO || getStoredMetroPort();
      btn.textContent = hasCDP
        ? `JS Debugger (:${port}) [${targets.length}] ↗`
        : `JS Debugger (:${port}) ↗`;
      btn.style.opacity = hasCDP ? '1' : '0.5';
      if (hasCDP) {
        btn.onclick = () => window.electronAPI.openCDPTarget(targets[0].webSocketDebuggerUrl);
      }
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

  window.electronAPI.on('clear-all-ui', clearAll);

  // When all device bridges disconnect, release heavy memory but keep logs visible.
  // Debounced to avoid data loss during hot reloads or flaky connections.
  let _disconnectTimer = null;
  window.electronAPI.on('device-all-disconnected', () => {
    clearTimeout(_disconnectTimer);
    _disconnectTimer = setTimeout(() => {
      console.log('[App] All devices disconnected — freeing memory');
      freeMemory();
    }, 3000);
  });
  // Cancel pending free if a device reconnects
  const _cancelDisconnectTimer = () => { clearTimeout(_disconnectTimer); _disconnectTimer = null; };
  window.electronAPI.on('redux-connected', on => { if (on) _cancelDisconnectTimer(); updateDeviceBanner('redux', on); });
  window.electronAPI.on('network-connected', on => { if (on) _cancelDisconnectTimer(); updateDeviceBanner('network', on); });
  window.electronAPI.on('storage-connected', on => { if (on) _cancelDisconnectTimer(); updateDeviceBanner('storage', on); });
  window.electronAPI.on('react-dt-status', on => { updateDeviceBanner('reactDT', on); });

  // Cmd+F — focus the search input for the active panel
  function _handleFind() {
    // If network detail is open, focus the detail search
    if (state.activePanel === 'network' && state.network.selectedId) {
      const wrap = $('detailSearchWrap');
      const input = $('detailSearchInput');
      if (wrap && input) {
        wrap.style.display = 'flex';
        input.focus();
        input.select();
        return;
      }
    }
    const searchMap = {
      console: 'consoleSearch',
      network: 'netSearchInput',
      ga4: 'ga4Search',
      redux: 'reduxSearch',
      storage: 'storageSearch',
    };
    const inputId = searchMap[state.activePanel];
    if (inputId) {
      const el = $(inputId);
      if (el) { el.focus(); el.select(); }
    }
    // Also show/focus Console bottom find bar
    if (state.activePanel === 'console') {
      const bar = $('consoleFindBar');
      if (bar) { bar.style.display = 'flex'; $('consoleFindInput')?.focus(); }
    }
  }
  window.electronAPI.on('focus-search', _handleFind);
  // Direct keyboard fallback — Electron menu accelerators can miss in some contexts
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      _handleFind();
    }
  });

  window.electronAPI.on('app-version', (version, isPackaged) => {
    state._appVersion = version;
    state._isPackaged = !!isPackaged;
    // Update anywhere the version is displayed
    document.querySelectorAll('#aboutVersion').forEach(el => el.textContent = 'v' + version);
  });

  window.electronAPI.on('update-available', ({ current, latest, autoUpdate }) => {
    state._updateAvailable = { current, latest, autoUpdate };
    _applyUpdateBanner();
  });

  window.electronAPI.on('update-downloaded', ({ version }) => {
    state._updateDownloaded = version;
    _applyUpdateBanner();
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
// Reusable — called from IPC handler AND from initSettingsPanel
function _applyUpdateBanner() {
  const info = state._updateAvailable;
  if (!info) return;
  const { current, latest, autoUpdate } = info;
  const downloaded = state._updateDownloaded;
  const targetVersion = downloaded || latest;

  const el = $('aboutVersion');
  if (el) {
    if (downloaded) {
      el.innerHTML = `v${current} <span style="color:var(--green);font-size:10px;margin-left:6px">v${downloaded} ready to install</span>`;
    } else {
      el.innerHTML = `v${current} <span style="color:var(--green);font-size:10px;margin-left:6px">v${latest} available</span>`;
    }
  }

  // Remove old buttons if state changed
  const oldBtn = $('updateBtn');
  if (oldBtn && downloaded && !oldBtn.dataset.isRestart) oldBtn.parentElement?.remove();
  const oldChangelog = $('changelogBtn');
  if (oldChangelog && downloaded && !oldChangelog.dataset.updated) oldChangelog.remove();

  const aboutEl = document.querySelector('.settings-about');
  if (!aboutEl) return;

  // Add "What's new?" link
  if (!$('changelogBtn')) {
    const link = document.createElement('div');
    link.style.cssText = 'margin-top:6px;text-align:center';
    link.innerHTML = `<span id="changelogBtn" class="about-link" style="font-size:10px;cursor:pointer" data-updated="${downloaded ? '1' : ''}">What's new in v${targetVersion}?</span>`;
    aboutEl.appendChild(link);
    $('changelogBtn')?.addEventListener('click', () => _showChangelog(targetVersion));
  }

  // Add update button
  if (!$('updateBtn')) {
    const btn = document.createElement('div');
    btn.style.cssText = 'margin-top:8px;text-align:center';
    if (downloaded) {
      btn.innerHTML = '<button id="updateBtn" data-is-restart="1" class="tb-btn primary" style="font-size:11px;padding:6px 16px">Restart & Update to v' + downloaded + '</button>';
      aboutEl.appendChild(btn);
      $('updateBtn')?.addEventListener('click', () => window.electronAPI?.installUpdate());
    } else if (autoUpdate) {
      btn.innerHTML = '<button id="updateBtn" class="tb-btn" style="font-size:11px;padding:6px 16px;opacity:0.7" disabled>Downloading v' + latest + '...</button>';
      aboutEl.appendChild(btn);
    } else {
      btn.innerHTML = '<button id="updateBtn" class="tb-btn primary" style="font-size:11px;padding:6px 16px">Download v' + latest + '</button>';
      aboutEl.appendChild(btn);
      $('updateBtn')?.addEventListener('click', () => window.electronAPI?.openExternal('https://github.com/sharanagouda/reactoradar/releases'));
    }
  }
}

async function _showChangelog(version) {
  if (!version || typeof version !== 'string') return;

  // Remove existing modal
  $('changelogModal')?.remove();

  const safeVersion = esc(version);
  const modal = document.createElement('div');
  modal.id = 'changelogModal';
  modal.className = 'changelog-modal-overlay';
  modal.innerHTML = `
    <div class="changelog-modal">
      <div class="changelog-header">
        <span class="changelog-title">What's New in v${safeVersion}</span>
        <button class="changelog-close" id="changelogClose">&times;</button>
      </div>
      <div class="changelog-body" id="changelogBody">
        <div style="color:var(--text-dim);padding:20px;text-align:center">Loading release notes...</div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  // Close handlers
  $('changelogClose')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  // Fetch changelog
  try {
    const notes = await window.electronAPI?.fetchChangelog(version);
    const body = $('changelogBody');
    if (!body) return;
    if (!notes || typeof notes !== 'string') {
      body.innerHTML = '<div style="color:var(--text-dim);padding:20px;text-align:center">No release notes available.</div>';
      return;
    }
    if (body && notes) {
      // Simple markdown-like rendering
      body.innerHTML = notes
        .replace(/^### (.+)$/gm, '<h3 style="color:var(--accent);font-size:12px;font-weight:700;margin:12px 0 6px">$1</h3>')
        .replace(/^## (.+)$/gm, '<h2 style="color:var(--text);font-size:14px;font-weight:700;margin:16px 0 8px">$1</h2>')
        .replace(/^- \*\*(.+?)\*\*(.*)$/gm, '<div style="margin:3px 0;font-size:11px;line-height:1.6"><b style="color:var(--text)">$1</b><span style="color:var(--text-dim)">$2</span></div>')
        .replace(/^- (.+)$/gm, '<div style="margin:3px 0;font-size:11px;line-height:1.6;color:var(--text-mid)">• $1</div>')
        .replace(/`([^`]+)`/g, '<code style="background:var(--bg3);padding:1px 4px;border-radius:3px;color:var(--accent);font-size:10px">$1</code>')
        .replace(/\n\n/g, '<br/>');
    }
  } catch {
    const body = $('changelogBody');
    if (body) body.innerHTML = '<div style="color:var(--red);padding:20px;text-align:center">Could not fetch release notes</div>';
  }
}

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
  return { log: true, info: true, warn: true, error: true, debug: true, redux: false };
}
function setStoredLogLevels(levels) {
  try { localStorage.setItem('rn-debug-log-levels', JSON.stringify(levels)); } catch {}
}

function initConsolePanel() {
  const panel = $('panel-console');
  const levels = getStoredLogLevels();
  state.console.levelFilters = levels;
  state.console.showRedux = !!levels.redux;

  panel.innerHTML = `
    <div class="panel-toolbar">
      <span class="panel-label">Console</span>
      <span class="badge" id="cBadge">0</span>
      <input id="consoleSearch" class="net-search-input" style="margin-left:12px" placeholder="Filter logs..." />
      <div class="ml-auto" style="display:flex;align-items:center;gap:6px">
        <button class="panel-clear-btn" id="consoleExport" title="Export logs as JSON">Export</button>
        <button class="panel-clear-btn" id="consoleClear" title="Clear console">Clear</button>
        <div class="console-level-dropdown" id="consoleLevelDropdown">
          <button class="console-level-btn" id="consoleLevelBtn">Levels ▾</button>
          <div class="console-level-menu" id="consoleLevelMenu">
            <label class="console-level-option"><input type="checkbox" data-level="log" ${levels.log ? 'checked' : ''} /><span class="lvl-dot" style="background:var(--text-mid)"></span>Log</label>
            <label class="console-level-option"><input type="checkbox" data-level="info" ${levels.info ? 'checked' : ''} /><span class="lvl-dot" style="background:var(--accent)"></span>Info</label>
            <label class="console-level-option"><input type="checkbox" data-level="warn" ${levels.warn ? 'checked' : ''} /><span class="lvl-dot" style="background:var(--yellow)"></span>Warn</label>
            <label class="console-level-option"><input type="checkbox" data-level="error" ${levels.error ? 'checked' : ''} /><span class="lvl-dot" style="background:var(--red)"></span>Error</label>
            <label class="console-level-option"><input type="checkbox" data-level="debug" ${levels.debug ? 'checked' : ''} /><span class="lvl-dot" style="background:var(--accent2)"></span>Debug</label>
            <div style="border-top:1px solid var(--border);margin:4px 0"></div>
            <label class="console-level-option"><input type="checkbox" data-level="redux" ${levels.redux ? 'checked' : ''} /><span class="lvl-dot" style="background:var(--green)"></span>Redux Actions</label>
          </div>
        </div>
      </div>
    </div>
    <div class="scroll-area" id="consoleList">
      <div class="empty-state" id="consoleEmpty">
        <div class="icon">⬛</div>
        <div class="label">No logs yet</div>
        <div class="hint">Logs will appear here automatically</div>
      </div>
    </div>
    <div class="console-find-bar" id="consoleFindBar" style="display:none">
      <input id="consoleFindInput" class="console-find-input" placeholder="Find in logs... (Cmd+F)" />
      <span id="consoleFindCount" class="console-find-count"></span>
      <button class="console-find-btn" id="consoleFindPrev" title="Previous">▲</button>
      <button class="console-find-btn" id="consoleFindNext" title="Next">▼</button>
      <button class="console-find-btn" id="consoleFindClose" title="Close (Esc)">✕</button>
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
      if (level === 'redux') state.console.showRedux = checkbox.checked;
      setStoredLogLevels(state.console.levelFilters);
      updateLevelBtnText();
      renderConsole();
    }
  });

  updateLevelBtnText();

  $('consoleExport')?.addEventListener('click', () => {
    const data = JSON.stringify(state.console.logs, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `reactoradar-console-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  });

  $('consoleClear').addEventListener('click', () => {
    state.console.logs = [];
    _consolePending = [];
    _lastLogMsg = ''; _lastLogRow = null; _lastLogCount = 1;
    $('cBadge').textContent = '0';
    renderConsole();
  });

  // Find bar (Cmd+F)
  let _findMatches = [];
  let _findIdx = -1;

  function doFind(term) {
    // Clear previous highlights
    document.querySelectorAll('.console-find-highlight').forEach(el => {
      el.replaceWith(el.textContent);
    });
    _findMatches = [];
    _findIdx = -1;
    if (!term) { $('consoleFindCount').textContent = ''; return; }

    const rows = document.querySelectorAll('#consoleList .log-row');
    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      if (text.includes(term.toLowerCase())) _findMatches.push(row);
    });
    $('consoleFindCount').textContent = _findMatches.length ? `${_findMatches.length} found` : 'No matches';
    if (_findMatches.length) { _findIdx = 0; _findMatches[0].scrollIntoView({ block: 'nearest' }); _findMatches[0].style.outline = '1px solid var(--accent)'; }
  }

  function findNav(dir) {
    if (!_findMatches.length) return;
    if (_findMatches[_findIdx]) _findMatches[_findIdx].style.outline = '';
    _findIdx = (_findIdx + dir + _findMatches.length) % _findMatches.length;
    _findMatches[_findIdx].scrollIntoView({ block: 'nearest' });
    _findMatches[_findIdx].style.outline = '1px solid var(--accent)';
    $('consoleFindCount').textContent = `${_findIdx + 1}/${_findMatches.length}`;
  }

  $('consoleFindInput').addEventListener('input', (e) => doFind(e.target.value));
  $('consoleFindPrev').addEventListener('click', () => findNav(-1));
  $('consoleFindNext').addEventListener('click', () => findNav(1));
  $('consoleFindClose').addEventListener('click', () => {
    $('consoleFindBar').style.display = 'none';
    if (_findMatches[_findIdx]) _findMatches[_findIdx].style.outline = '';
    _findMatches = []; _findIdx = -1;
    $('consoleFindInput').value = '';
    $('consoleFindCount').textContent = '';
  });
  $('consoleFindInput').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('consoleFindClose').click();
    if (e.key === 'Enter') findNav(e.shiftKey ? -1 : 1);
  });
}

function updateLevelBtnText() {
  const levels = state.console.levelFilters;
  const logLevels = { log: levels.log, info: levels.info, warn: levels.warn, error: levels.error, debug: levels.debug };
  const allOn = Object.values(logLevels).every(v => v);
  const allOff = Object.values(logLevels).every(v => !v);
  const btn = $('consoleLevelBtn');
  if (!btn) return;
  let text = '';
  if (allOn) text = 'All Levels';
  else if (allOff) text = 'None';
  else text = Object.entries(logLevels).filter(([, v]) => v).map(([k]) => k.charAt(0).toUpperCase() + k.slice(1)).join(', ');
  if (levels.redux) text += (text ? ' + ' : '') + 'Redux';
  btn.textContent = text + ' ▾';
}

// Console is fed via IPC (network-event handled in IPC section above)

// ─── Toast Notifications ─────────────────────────────────────────────────────
let _toastContainer = null;
const _activeToasts = {};

function getToastsEnabled() {
  try { return localStorage.getItem('rn-debug-toasts') !== 'false'; } catch { return true; }
}
function setToastsEnabled(v) {
  try { localStorage.setItem('rn-debug-toasts', v ? 'true' : 'false'); } catch {}
}

function showToast(message, type, targetPanel) {
  if (!getToastsEnabled()) return;
  if (!_toastContainer) {
    _toastContainer = document.createElement('div');
    _toastContainer.id = 'toastContainer';
    _toastContainer.className = 'toast-container';
    document.body.appendChild(_toastContainer);
  }
  // Don't show toast if user is already on the target panel
  if (targetPanel && state.activePanel === targetPanel) return;

  // Deduplicate: if same message already showing, increment count
  const key = `${type}:${message}`;
  if (_activeToasts[key] && _activeToasts[key].el.parentNode) {
    const existing = _activeToasts[key];
    existing.count++;
    const msgEl = existing.el.querySelector('.toast-msg');
    if (msgEl) msgEl.textContent = `${message} (${existing.count})`;
    // Reset auto-remove timer
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => {
      if (existing.el.parentNode) existing.el.remove();
      delete _activeToasts[key];
    }, 5000);
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type || 'info'}`;
  toast.innerHTML = `<span class="toast-msg">${esc(message)}</span>`;
  if (targetPanel) {
    const btn = document.createElement('span');
    btn.className = 'toast-action';
    btn.textContent = 'View';
    btn.addEventListener('click', () => { switchPanel(targetPanel); toast.remove(); delete _activeToasts[key]; });
    toast.appendChild(btn);
  }
  const close = document.createElement('span');
  close.className = 'toast-close';
  close.textContent = '✕';
  close.addEventListener('click', () => { toast.remove(); delete _activeToasts[key]; });
  toast.appendChild(close);

  _toastContainer.appendChild(toast);
  const timer = setTimeout(() => {
    if (toast.parentNode) toast.remove();
    delete _activeToasts[key];
  }, 5000);
  _activeToasts[key] = { el: toast, count: 1, timer };
  // Keep max 3 toasts
  const toasts = _toastContainer.querySelectorAll('.toast');
  if (toasts.length > 3) { toasts[0].remove(); }
}

// ─── Batched console append (fixes re-render performance) ────────────────────
let _consolePending = [];
let _consoleRAF = null;

let _lastLogMsg = '';
let _lastLogRow = null;
let _lastLogCount = 1;

const MAX_CONSOLE_LOGS = 5000;

function addConsoleLog(event) {
  state.console.logs.push(event);
  // Cap in-memory logs to prevent memory leak
  if (state.console.logs.length > MAX_CONSOLE_LOGS) {
    state.console.logs = state.console.logs.slice(-MAX_CONSOLE_LOGS);
  }
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
    // Redux logs use showRedux flag; regular logs use levelFilters
    if (l.level === 'redux') {
      if (!state.console.showRedux) return;
    } else if (levelFilters && !levelFilters[l.level]) return;
    if (searchFilter && !l.message?.toLowerCase().includes(searchFilter)) return;

    // Group consecutive identical messages
    const msgKey = `${l.level}:${l.message || ''}`;
    if (msgKey === _lastLogMsg && _lastLogRow && _lastLogRow.parentNode) {
      _lastLogCount++;
      let badge = _lastLogRow.querySelector('.log-group-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'log-group-badge';
        _lastLogRow.insertBefore(badge, _lastLogRow.firstChild);
      }
      badge.textContent = _lastLogCount;
      return; // Don't add a new row
    }

    _lastLogMsg = msgKey;
    _lastLogCount = 1;
    const row = buildLogRow(l);
    _lastLogRow = row;
    frag.appendChild(row);
    added++;
  });

  if (added > 0) {
    // Hide empty state as soon as we have visible rows
    if (empty) empty.style.display = 'none';
    // Auto-scroll only if user is already near the bottom (within 150px)
    const wasAtBottom = (list.scrollHeight - list.scrollTop - list.clientHeight) < 150;
    list.appendChild(frag);
    // Keep DOM size manageable — remove oldest rows
    const rows = list.querySelectorAll('.log-row');
    const MAX_DOM_ROWS = 2000;
    if (rows.length > MAX_DOM_ROWS) {
      const toRemove = rows.length - MAX_DOM_ROWS;
      for (let i = 0; i < toRemove; i++) rows[i].remove();
    }
    if (wasAtBottom) list.scrollTop = list.scrollHeight;
  }
}

window.electronAPI?.on('console-event', addConsoleLog);

// ─── Object Tree Renderer (Chrome DevTools-like) ─────────────────────────────
// Builds interactive, collapsible DOM nodes for objects/arrays.

// Collect all entries for an object: own data properties + prototype getter values.
// Getter-derived keys use the clean name (e.g. "deliveryId") and skip backing
// fields (e.g. "_deliveryId") so the log output mirrors the model's public API.
function collectEntries(val) {
  if (Array.isArray(val)) return val.map((v, i) => [i, v]);

  const result = {};
  const getterKeys = new Set();

  // 1. Walk prototype chain and invoke getters
  let proto = Object.getPrototypeOf(val);
  while (proto && proto !== Object.prototype) {
    const descs = Object.getOwnPropertyDescriptors(proto);
    for (const [k, desc] of Object.entries(descs)) {
      if (k === 'constructor') continue;
      if (desc.get && !(k in result)) {
        try { result[k] = desc.get.call(val); } catch { /* skip broken getters */ }
        getterKeys.add(k);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }

  // 2. Add own data properties, but skip backing fields whose getter is present.
  //    Convention: getter "foo" backs "_foo"; if "foo" was collected, skip "_foo".
  const ownKeys = Object.keys(val);
  for (const k of ownKeys) {
    const clean = k.startsWith('_') ? k.slice(1) : null;
    if (clean && getterKeys.has(clean)) continue; // skip _backing field
    if (!(k in result)) result[k] = val[k];
  }

  return Object.entries(result);
}

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
    const entries = collectEntries(val);
    if (entries.length === 0) return '{}';
    const items = [];
    let len = 2;
    for (let i = 0; i < entries.length && len < maxLen; i++) {
      const s = `${entries[i][0]}: ${primitivePreview(entries[i][1])}`;
      len += s.length + 2;
      items.push(s);
    }
    const suffix = items.length < entries.length ? ', ...' : '';
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
    const entries = collectEntries(val);
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

function _safeStr(val) {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  try { return JSON.stringify(val, null, 2); } catch { return String(val); }
}

function createPrimitiveSpan(val) {
  const s = document.createElement('span');
  if (val === null) { s.className = 'ov-null'; s.textContent = 'null'; }
  else if (val === undefined) { s.className = 'ov-undef'; s.textContent = 'undefined'; }
  else if (typeof val === 'string') { s.className = 'ov-str'; s.textContent = `"${val}"`; }
  else if (typeof val === 'number') { s.className = 'ov-num'; s.textContent = String(val); }
  else if (typeof val === 'boolean') { s.className = 'ov-bool'; s.textContent = String(val); }
  else { s.textContent = _safeStr(val); }
  return s;
}

// Parse a structured arg from the SDK (or fall back to raw message string)
function renderConsoleArg(arg) {
  if (!arg || typeof arg !== 'object' || !arg.t) {
    // Backward compat: raw string
    const s = document.createElement('span');
    s.className = 'ov-str';
    s.textContent = _safeStr(arg);
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
  s.textContent = _safeStr(v);
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

  // Arrow (inline, not inside body-wrap)
  const arrow = document.createElement('span');
  arrow.className = 'log-arrow';
  arrow.textContent = '\u25B6';
  div.appendChild(arrow);

  // Body wrapper
  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'log-body-wrap';

  // Single-line preview: message text + caller
  const preview = document.createElement('div');
  preview.className = 'log-preview';
  const msgText = (l.message || '').replace(/\n/g, ' ').slice(0, 200);
  const previewText = document.createElement('span');
  previewText.textContent = msgText + ((l.message || '').length > 200 ? '...' : '');
  preview.appendChild(previewText);
  bodyWrap.appendChild(preview);

  // Full content (hidden by default)
  const full = document.createElement('div');
  full.className = 'log-full';
  full.style.display = 'none';
  full.appendChild(buildLogBody(l));
  bodyWrap.appendChild(full);

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
    if (label === '—' || !action) {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      menu.appendChild(sep);
      return;
    }
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
    // Redux logs use showRedux flag; regular logs use levelFilters
    if (l.level === 'redux') {
      if (!state.console.showRedux) return false;
    } else if (levelFilters && !levelFilters[l.level]) return false;
    if (searchFilter && !l.message?.toLowerCase().includes(searchFilter)) return false;
    return true;
  });

  list.querySelectorAll('.log-row').forEach(e => e.remove());
  if (!empty) { /* guard */ }
  else if (visible.length > 0) {
    empty.style.display = 'none';
  } else if (state.console.logs.length > 0) {
    const lbl = empty.querySelector('.label');
    const hint = empty.querySelector('.hint');
    if (lbl) lbl.textContent = 'No matching logs';
    if (hint) hint.textContent = 'Adjust level filters or clear search to see logs';
    empty.style.display = 'flex';
  } else {
    const lbl = empty.querySelector('.label');
    const hint = empty.querySelector('.hint');
    if (lbl) lbl.textContent = 'No logs yet';
    if (hint) hint.textContent = 'Logs will appear here automatically';
    empty.style.display = 'flex';
  }

  // Render only the last N visible rows for performance
  const MAX_RENDER = 5000;
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
  { key: 'name',      label: 'Name',      width: 380, min: 150 },
  { key: 'status',    label: 'Status',    width: 60,  min: 40 },
  { key: 'type',      label: 'Type',      width: 70,  min: 40 },
  { key: 'initiator', label: 'Initiator', width: 80,  min: 50 },
  { key: 'size',      label: 'Size',      width: 65,  min: 40 },
  { key: 'time',      label: 'Time',      width: 65,  min: 40 },
  { key: 'waterfall', label: 'Waterfall', width: 100, min: 60 },
];

function initNetworkPanel() {
  const panel = $('panel-network');
  panel.innerHTML = `
    <div class="panel-toolbar">
      <span class="panel-label">Network</span>
      <span class="badge" id="nBadge">0</span>
      <div class="ml-auto" style="display:flex;align-items:center;gap:6px">
        <button class="panel-clear-btn" id="networkExport" title="Export as HAR">Export HAR</button>
        <button class="panel-clear-btn" id="networkClear" title="Clear network">Clear</button>
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
        <button class="net-type-btn" data-type="all">All</button>
        <button class="net-type-btn active" data-type="fetch">Fetch/XHR</button>
        <button class="net-type-btn" data-type="js">JS</button>
        <button class="net-type-btn" data-type="css">CSS</button>
        <button class="net-type-btn" data-type="img">Img</button>
        <button class="net-type-btn" data-type="media">Media</button>
        <button class="net-type-btn" data-type="font">Font</button>
        <button class="net-type-btn" data-type="doc">Doc</button>
        <button class="net-type-btn" data-type="ws">WS</button>
      </div>
      <div class="net-status-filters" id="netStatusFilters">
        <button class="net-status-btn active" data-status="all">All</button>
        <button class="net-status-btn" data-status="2xx">2xx</button>
        <button class="net-status-btn" data-status="errors">Errors</button>
        <button class="net-status-btn net-slow-btn" data-status="slow">Slow (>1s)</button>
      </div>
      <div class="net-hidden-wrap" style="position:relative;margin-left:4px">
        <button class="net-status-btn net-hidden-btn" id="netHiddenBtn" style="display:none" title="Manage hidden URLs">Hidden</button>
        <div class="net-hidden-dropdown" id="netHiddenDropdown" style="display:none"></div>
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
          <div class="detail-search-wrap" id="detailSearchWrap" style="display:none">
            <input id="detailSearchInput" class="detail-search-input" placeholder="Search key or value..." />
            <span id="detailSearchCount" class="detail-search-count"></span>
            <button class="detail-search-nav" id="detailSearchPrev" title="Previous">&#9650;</button>
            <button class="detail-search-nav" id="detailSearchNext" title="Next">&#9660;</button>
            <button class="detail-search-close" id="detailSearchClose" title="Close search">&times;</button>
          </div>
          <button class="detail-close" id="netDetailClose" title="Close">&times;</button>
        </div>
        <div class="detail-content" id="netDetailContent"></div>
      </div>
    </div>
    <div class="net-stats-bar" id="netStatsBar">
      <span id="netStatsTotal">0 requests</span>
      <span class="net-stats-sep">|</span>
      <span id="netStatsAvg">Avg: —</span>
      <span class="net-stats-sep">|</span>
      <span id="netStatsSlowest">Slowest: —</span>
      <span class="net-stats-sep">|</span>
      <span id="netStatsErrors">Errors: 0</span>
      <span class="net-stats-sep">|</span>
      <span id="netStatsSlow">Slow (>1s): 0</span>
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

  // Status filter buttons (All / 2xx / Errors / Slow)
  $('netStatusFilters').addEventListener('click', (e) => {
    const btn = e.target.closest('.net-status-btn');
    if (!btn) return;
    $('netStatusFilters').querySelectorAll('.net-status-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.network.statusFilter = btn.dataset.status;
    renderNetwork();
  });

  // Hidden URLs button
  $('netHiddenBtn')?.addEventListener('click', () => {
    const dd = $('netHiddenDropdown');
    if (!dd) return;
    const isOpen = dd.style.display !== 'none';
    if (isOpen) { dd.style.display = 'none'; return; }
    // Build dropdown with hidden URL list
    const hidden = getHiddenURLs();
    dd.innerHTML = '';
    if (!hidden.length) { dd.style.display = 'none'; return; }
    const title = document.createElement('div');
    title.className = 'net-hidden-title';
    title.innerHTML = `<span>Hidden URLs (${hidden.length})</span><button class="net-hidden-clear" id="netHiddenClearAll">Clear All</button>`;
    dd.appendChild(title);
    hidden.forEach(pattern => {
      const row = document.createElement('div');
      row.className = 'net-hidden-row';
      const label = document.createElement('span');
      label.className = 'net-hidden-url';
      label.textContent = pattern;
      label.title = pattern;
      row.appendChild(label);
      const btn = document.createElement('button');
      btn.className = 'net-hidden-unhide';
      btn.textContent = 'Unhide';
      btn.addEventListener('click', () => {
        removeHiddenURL(pattern);
        row.remove();
        renderNetwork();
        if (!getHiddenURLs().length) dd.style.display = 'none';
      });
      row.appendChild(btn);
      dd.appendChild(row);
    });
    dd.style.display = 'block';
    // Clear all handler
    dd.querySelector('#netHiddenClearAll')?.addEventListener('click', () => {
      setHiddenURLs([]);
      _updateHiddenBadge();
      dd.style.display = 'none';
      renderNetwork();
    });
  });
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const dd = $('netHiddenDropdown');
    if (dd && dd.style.display !== 'none' && !e.target.closest('.net-hidden-wrap')) {
      dd.style.display = 'none';
    }
  });
  // Initialize hidden badge
  _updateHiddenBadge();

  // Throttle select
  $('netThrottleSelect').addEventListener('change', (e) => {
    state.network.throttle = e.target.value;
    // Send throttle config to the RN app
    window.electronAPI?.setNetworkThrottle(state.network.throttle);
  });

  // Export network as HAR
  $('networkExport')?.addEventListener('click', () => {
    const entries = state.network.order.map(id => {
      const r = state.network.requests[id];
      if (!r) return null;
      return {
        startedDateTime: new Date(r.ts || Date.now()).toISOString(),
        time: r.duration || 0,
        request: {
          method: r.method || 'GET',
          url: r.url || '',
          headers: Object.entries(r.requestHeaders || {}).map(([n, v]) => ({ name: n, value: v })),
          postData: r.requestBody ? { mimeType: 'application/json', text: typeof r.requestBody === 'object' ? JSON.stringify(r.requestBody) : String(r.requestBody) } : undefined,
        },
        response: {
          status: r.status || 0,
          statusText: r.statusText || '',
          headers: Object.entries(r.responseHeaders || {}).map(([n, v]) => ({ name: n, value: v })),
          content: { size: -1, mimeType: 'application/json', text: r.responseBody ? (typeof r.responseBody === 'object' ? JSON.stringify(r.responseBody) : String(r.responseBody)) : '' },
        },
        timings: { send: 0, wait: r.duration || 0, receive: 0 },
      };
    }).filter(Boolean);
    const har = { log: { version: '1.2', creator: { name: 'ReactoRadar', version: '1.6.0' }, entries } };
    const blob = new Blob([JSON.stringify(har, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `reactoradar-network-${Date.now()}.har`; a.click();
    URL.revokeObjectURL(url);
  });

  // Clear network
  $('networkClear').addEventListener('click', () => {
    state.network.requests = {};
    state.network.order = [];
    state.network.selectedId = null;
    closeNetDetail();
    $('nBadge').textContent = '0';
    renderNetwork();
  });

  // Close detail button
  $('netDetailClose').addEventListener('click', closeNetDetail);

  // Detail panel search
  let _detailSearchMatches = [];
  let _detailSearchIdx = -1;

  function _detailSearch() {
    const term = $('detailSearchInput')?.value?.trim().toLowerCase();
    const body = $('netDetailContent');
    if (!body || !term) { _detailClearSearch(); return; }

    // Remove old highlights
    body.querySelectorAll('.detail-search-hl').forEach(el => {
      const parent = el.parentNode;
      parent.replaceChild(document.createTextNode(el.textContent), el);
      parent.normalize();
    });

    _detailSearchMatches = [];
    _detailSearchIdx = -1;

    // Walk all text nodes and highlight matches
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach(node => {
      const text = node.textContent;
      const lower = text.toLowerCase();
      if (!lower.includes(term)) return;

      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      let idx;
      while ((idx = lower.indexOf(term, lastIdx)) !== -1) {
        if (idx > lastIdx) frag.appendChild(document.createTextNode(text.slice(lastIdx, idx)));
        const hl = document.createElement('span');
        hl.className = 'detail-search-hl';
        hl.textContent = text.slice(idx, idx + term.length);
        _detailSearchMatches.push(hl);
        frag.appendChild(hl);
        lastIdx = idx + term.length;
      }
      if (lastIdx < text.length) frag.appendChild(document.createTextNode(text.slice(lastIdx)));
      node.parentNode.replaceChild(frag, node);
    });

    // Update count
    const countEl = $('detailSearchCount');
    if (countEl) countEl.textContent = _detailSearchMatches.length ? `${_detailSearchMatches.length} found` : 'No match';

    // Navigate to first match
    if (_detailSearchMatches.length) _detailNavTo(0);
  }

  function _detailNavTo(idx) {
    // Remove active highlight from previous
    if (_detailSearchIdx >= 0 && _detailSearchMatches[_detailSearchIdx]) {
      _detailSearchMatches[_detailSearchIdx].classList.remove('active');
    }
    _detailSearchIdx = idx;
    const el = _detailSearchMatches[idx];
    if (!el) return;
    el.classList.add('active');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Update count
    const countEl = $('detailSearchCount');
    if (countEl) countEl.textContent = `${idx + 1}/${_detailSearchMatches.length}`;
  }

  function _detailClearSearch() {
    const body = $('netDetailContent');
    if (body) {
      body.querySelectorAll('.detail-search-hl').forEach(el => {
        const parent = el.parentNode;
        parent.replaceChild(document.createTextNode(el.textContent), el);
        parent.normalize();
      });
    }
    _detailSearchMatches = [];
    _detailSearchIdx = -1;
    const countEl = $('detailSearchCount');
    if (countEl) countEl.textContent = '';
  }

  $('detailSearchInput')?.addEventListener('input', () => {
    clearTimeout($('detailSearchInput')._debounce);
    $('detailSearchInput')._debounce = setTimeout(_detailSearch, 200);
  });
  $('detailSearchInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!_detailSearchMatches.length) return;
      const next = e.shiftKey
        ? (_detailSearchIdx - 1 + _detailSearchMatches.length) % _detailSearchMatches.length
        : (_detailSearchIdx + 1) % _detailSearchMatches.length;
      _detailNavTo(next);
    }
    if (e.key === 'Escape') {
      _detailClearSearch();
      $('detailSearchWrap').style.display = 'none';
    }
  });
  $('detailSearchNext')?.addEventListener('click', () => {
    if (!_detailSearchMatches.length) return;
    _detailNavTo((_detailSearchIdx + 1) % _detailSearchMatches.length);
  });
  $('detailSearchPrev')?.addEventListener('click', () => {
    if (!_detailSearchMatches.length) return;
    _detailNavTo((_detailSearchIdx - 1 + _detailSearchMatches.length) % _detailSearchMatches.length);
  });
  $('detailSearchClose')?.addEventListener('click', () => {
    _detailClearSearch();
    $('detailSearchInput').value = '';
    $('detailSearchWrap').style.display = 'none';
  });

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
    case 'fetch': // Fetch/XHR — show API calls (JSON, text, form data), exclude static assets
      return !ct.includes('image') && !ct.includes('font') && !ct.includes('video') && !ct.includes('audio')
        && !/\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf|eot|mp4|mp3|css)(\?|$)/.test(url);
    case 'js':    return ct.includes('javascript') || /\.(js|jsx|bundle)(\?|$)/.test(url);
    case 'css':   return ct.includes('css') || /\.css(\?|$)/.test(url);
    case 'img':   return ct.includes('image') || /\.(png|jpg|jpeg|gif|svg|webp|ico|avif|bmp)(\?|$)/.test(url);
    case 'media': return ct.includes('video') || ct.includes('audio') || /\.(mp4|mp3|wav|webm|ogg|m3u8)(\?|$)/.test(url);
    case 'font':  return ct.includes('font') || /\.(woff2?|ttf|otf|eot)(\?|$)/.test(url);
    case 'doc':   return ct.includes('html') || ct.includes('xml') || /\.(html?|xml)(\?|$)/.test(url);
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
    // Cap network history to prevent memory leak
    const MAX_NET_HISTORY = 1000;
    if (state.network.order.length > MAX_NET_HISTORY) {
      const trimIds = state.network.order.splice(0, state.network.order.length - MAX_NET_HISTORY);
      trimIds.forEach(tid => delete state.network.requests[tid]);
    }
    $('nBadge').textContent = state.network.order.length;
  } else {
    Object.assign(state.network.requests[id] || (state.network.requests[id] = {}), event);
    // Toast for errors and slow APIs
    const r = state.network.requests[id];
    if (r && (phase === 'response' || phase === 'error')) {
      const name = r.url?.split('/').pop()?.split('?')[0] || r.url || '?';
      if (r.phase === 'error' || (r.status && r.status >= 400)) {
        showToast(`API Error: ${r.status || 'ERR'} ${name}`, 'error', 'network');
      } else if ((r.duration || 0) >= 3000) {
        showToast(`Slow API: ${(r.duration/1000).toFixed(1)}s — ${name}`, 'warn', 'network');
      }
    }
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
    if (statusFilter === 'slow' && !((r.duration || 0) >= 1000)) return false;
    if (searchFilter && !r.url?.toLowerCase().includes(searchFilter)) return false;
    if (typeFilter !== 'all' && !matchNetType(r, typeFilter)) return false;
    if (isURLHidden(r.url || '')) return false;
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
  _updateNetStats();
}

function _updateNetStats() {
  const allReqs = state.network.order.map(id => state.network.requests[id]).filter(Boolean);
  const completed = allReqs.filter(r => r.duration != null);
  const total = allReqs.length;
  const errors = allReqs.filter(r => r.phase === 'error' || (r.status && r.status >= 400)).length;
  const slow = completed.filter(r => r.duration >= 1000).length;
  const durations = completed.map(r => r.duration);
  const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const slowest = durations.length ? Math.max(...durations) : 0;
  const slowestReq = completed.find(r => r.duration === slowest);
  const slowestName = slowestReq ? (tryURL(slowestReq.url)?.pathname?.split('/').pop() || slowestReq.url?.split('/').pop() || '?') : '—';

  const el = (id, text) => { const e = $(id); if (e) e.textContent = text; };
  el('netStatsTotal', `${total} requests`);
  el('netStatsAvg', `Avg: ${avg ? (avg > 999 ? `${(avg/1000).toFixed(1)}s` : `${avg}ms`) : '—'}`);
  el('netStatsSlowest', `Slowest: ${slowest ? (slowest > 999 ? `${(slowest/1000).toFixed(1)}s` : `${slowest}ms`) + ` (${slowestName})` : '—'}`);
  el('netStatsErrors', `Errors: ${errors}`);
  el('netStatsSlow', `Slow (>1s): ${slow}`);
  // Highlight if there are slow or errored requests
  if (slow > 0) $('netStatsSlow')?.classList.add('warn');
  else $('netStatsSlow')?.classList.remove('warn');
  if (errors > 0) $('netStatsErrors')?.classList.add('err');
  else $('netStatsErrors')?.classList.remove('err');
}

function _isHttpError(r) {
  return r.phase === 'error' || (r.status && r.status >= 400);
}

function buildNetRow(r, wfMin, wfRange) {
  const row = document.createElement('div');
  const rowSlow = !_isHttpError(r) && (r.duration || 0) >= 1000;
  const rowVerySlow = !_isHttpError(r) && (r.duration || 0) >= 3000;
  row.className = 'net-row' + (r.id === state.network.selectedId ? ' selected' : '') + (_isHttpError(r) ? ' error' : '') + (rowVerySlow ? ' very-slow' : rowSlow ? ' slow' : '');
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
  const isErr = _isHttpError(r);
  const pathCls = isErr ? ' net-path-error' : '';
  nameCell.innerHTML = `<span class="method-badge ${mClass}">${method}</span> <span class="net-path${pathCls}" title="${esc(r.url)}">${esc(fullPath)}</span><span class="net-host">${esc(host)}</span>`;
  row.appendChild(nameCell);

  // Status
  const statusCell = document.createElement('div');
  statusCell.className = 'net-cell net-status';
  statusCell.dataset.col = 'status';
  statusCell.style.width = NET_COLS[1].width + 'px';
  let statusStr = '...', sCls = 's-pending';
  if (r.phase === 'error') { statusStr = 'ERR'; sCls = 's-err'; }
  else if (r.status) {
    statusStr = String(r.status);
    const group = Math.floor(r.status / 100);
    // 1xx info, 2xx success, 3xx redirect, 4xx client error, 5xx server error
    if (group >= 4) sCls = 's-err';
    else sCls = `s-${group}`;
  }
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
  const dur = r.duration || 0;
  const slowClass = dur >= 3000 ? ' very-slow' : dur >= 1000 ? ' slow' : '';
  timeCell.className = 'net-cell net-time' + slowClass;
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
    else if (r.status && r.status >= 400) barCls = 'err';
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

function _estimateSize(val) {
  if (val == null) return 0;
  if (typeof val === 'string') return val.length;
  try { return JSON.stringify(val).length; } catch { return 0; }
}

function _formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

function renderNetDetailTabs(r) {
  const tabs = $('netDetailTabs');
  tabs.innerHTML = '';

  const tabDefs = [
    { label: 'Headers', key: 'headers' },
    { label: 'Request', key: 'request', sizeFrom: 'requestBody' },
    { label: 'Preview', key: 'preview', sizeFrom: 'responseBody' },
    { label: 'Response', key: 'response', sizeFrom: 'responseBody' },
  ];

  tabDefs.forEach(({ label, key, sizeFrom }) => {
    const btn = document.createElement('button');
    btn.className = 'detail-tab' + (r._tab === key ? ' active' : '');
    let text = label;
    if (sizeFrom && r[sizeFrom]) {
      const size = _estimateSize(r[sizeFrom]);
      if (size > 0) text += ` (${_formatBytes(size)})`;
    }
    btn.textContent = text;
    btn.addEventListener('click', () => {
      r._tab = key;
      tabs.querySelectorAll('.detail-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderNetDetailContent(r);
    });
    tabs.appendChild(btn);
  });

  // Show search box for Preview/Response tabs
  const searchWrap = $('detailSearchWrap');
  if (searchWrap) {
    searchWrap.style.display = (r._tab === 'preview' || r._tab === 'response' || r._tab === 'headers') ? 'flex' : 'none';
  }
}

function renderNetDetailContent(r) {
  let body = $('netDetailContent');
  if (!body) return;
  // Clone-replace to remove all stale event listeners (prevents contextmenu leak)
  const fresh = body.cloneNode(false);
  body.parentNode.replaceChild(fresh, body);
  body = fresh;
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
        <span class="kv-key">Status</span><span class="kv-val ${r.phase === 'error' ? 's-err' : r.status ? (r.status >= 400 ? 's-err' : 's-' + Math.floor(r.status/100)) : 's-pending'}">${r.phase === 'error' ? (r.status || 'ERR') : (r.status || 'Pending')} ${r.statusText || (r.phase === 'error' ? r.error || 'Network Error' : '')}</span>
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
    const isErrStatus = _isHttpError(r);
    if (r.phase === 'error' && !r.responseBody) { body.innerHTML = `<span style="color:var(--red)">${esc(r.error || 'Request failed')}</span>`; return; }
    if (!r.responseBody && r.phase !== 'response') { body.innerHTML = '<span style="color:var(--text-dim)">Pending...</span>'; return; }
    // Render as collapsible JSON tree with right-click copy
    const val = r.responseBody;
    let treeData = val;
    if (typeof val === 'string') {
      try { treeData = JSON.parse(val); } catch {
        body.innerHTML = `<span style="color:${isErrStatus ? 'var(--red)' : 'inherit'}">${esc(val)}</span>`;
        return;
      }
    }
    if (treeData && typeof treeData === 'object') {
      body.innerHTML = '';
      // Show error status banner above the response body
      if (isErrStatus) {
        const errBanner = document.createElement('div');
        errBanner.style.cssText = 'color:var(--red);font-weight:600;padding:4px 0 8px;font-size:11px;border-bottom:1px solid rgba(255,94,114,.15);margin-bottom:8px';
        errBanner.textContent = `${r.status || 'ERR'} ${r.statusText || r.error || 'Error'}`;
        body.appendChild(errBanner);
      }
      body.appendChild(createTreeNode(null, treeData, false));
      // Right-click on preview to copy the whole object or clicked node value
      body.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showPreviewCopyMenu(e, treeData);
      });
    } else {
      body.innerHTML = isErrStatus
        ? `<span style="color:var(--red)">${esc(String(r.responseBody))}</span>`
        : '<span style="color:var(--text-dim)">No preview available</span>';
    }
  } else if (tab === 'response') {
    const isErrStatus = _isHttpError(r);
    if (r.phase === 'error' && !r.responseBody) { body.innerHTML = `<span style="color:var(--red)">${esc(r.error || 'Request failed')}</span>`; return; }
    if (!r.responseBody && r.phase !== 'response') { body.innerHTML = '<span style="color:var(--text-dim)">Pending...</span>'; return; }
    if (isErrStatus) {
      const errBanner = document.createElement('div');
      errBanner.style.cssText = 'color:var(--red);font-weight:600;padding:4px 0 8px;font-size:11px;border-bottom:1px solid rgba(255,94,114,.15);margin-bottom:8px';
      errBanner.textContent = `${r.status || 'ERR'} ${r.statusText || r.error || 'Error'}`;
      body.innerHTML = '';
      body.appendChild(errBanner);
      const raw = document.createElement('div');
      raw.style.color = 'var(--red)';
      raw.innerHTML = renderJSON(r.responseBody);
      body.appendChild(raw);
    } else {
      body.innerHTML = renderJSON(r.responseBody);
    }
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
  // Hide URL option
  items.push({ label: '—', action: null }); // separator
  items.push({ label: 'Hide this URL', action: () => {
    addHiddenURL(r.url || '');
    renderNetwork();
  }});
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
      <div class="ml-auto" style="display:flex;align-items:center;gap:6px">
        <label class="toggle-label" for="ga4ColorToggle" style="font-size:10px;gap:4px">
          <span style="color:var(--text-dim)">Colors</span>
          <input type="checkbox" id="ga4ColorToggle" class="toggle-input" ${getGA4ColorsEnabled() ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
        <button class="panel-clear-btn" id="ga4Clear" title="Clear GA4 events">Clear</button>
      </div>
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

  $('ga4ColorToggle')?.addEventListener('change', (e) => {
    setGA4ColorsEnabled(e.target.checked);
    renderGA4List();
    renderGA4Summary();
  });

  $('ga4Clear').addEventListener('click', () => {
    ga4State.events = [];
    ga4State.selected = -1;
    ga4State.searchFilter = '';
    const search = $('ga4Search');
    if (search) search.value = '';
    $('ga4Badge').textContent = '0';
    renderGA4List();
    renderGA4Summary();
    // Clear detail pane
    const detail = $('ga4Detail');
    if (detail) detail.innerHTML = '<div class="ga4-detail-empty" style="color:var(--text-dim);padding:20px;text-align:center;font-size:11px">Select an event to view details</div>';
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
  if (!isTabEnabled('ga4')) return;
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

// Assign consistent color to each GA4 event name
const _ga4EventColors = {};
const _ga4ColorPalette = [
  '#4facff',  // blue
  '#3dd68c',  // green
  '#ff813f',  // orange
  '#c678dd',  // purple
  '#e06c75',  // coral
  '#56b6c2',  // teal
  '#d19a66',  // gold
  '#98c379',  // lime
  '#e5c07b',  // yellow
  '#ff5e72',  // red
  '#61afef',  // light blue
  '#be5046',  // rust
];
let _ga4ColorIdx = 0;
function _ga4EventColor(name) {
  if (!getGA4ColorsEnabled()) return ''; // empty = inherit default text color
  if (!_ga4EventColors[name]) {
    _ga4EventColors[name] = _ga4ColorPalette[_ga4ColorIdx % _ga4ColorPalette.length];
    _ga4ColorIdx++;
  }
  return _ga4EventColors[name];
}
function getGA4ColorsEnabled() {
  try { return localStorage.getItem('rn-debug-ga4-colors') === 'true'; } catch { return false; }
}
function setGA4ColorsEnabled(v) {
  try { localStorage.setItem('rn-debug-ga4-colors', v ? 'true' : 'false'); } catch {}
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

    const time = new Date(e.ts).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const evtColor = _ga4EventColor(e.name);
    const colorStyle = evtColor ? `color:${evtColor}` : '';
    row.innerHTML = `
      <span class="ga4-cell ga4-time">${time}</span>
      <span class="ga4-cell ga4-name" style="${colorStyle}">${esc(e.name)}</span>`;

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
  let detail = $('ga4Detail');
  if (!detail) return;

  const time = new Date(e.ts).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Clone-replace to remove stale event listeners
  const fresh = detail.cloneNode(false);
  detail.parentNode.replaceChild(fresh, detail);
  detail = fresh;

  // Header info
  const header = document.createElement('div');
  header.className = 'ga4-detail-info';
  header.innerHTML = `
    <div class="ga4-detail-row"><span class="ga4-detail-key">Event Name</span><span class="ga4-detail-val" style="${_ga4EventColor(e.name) ? 'color:' + _ga4EventColor(e.name) + ';' : ''}font-weight:600;font-size:1.1em">${esc(e.name)}</span></div>
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
    const chipColor = _ga4EventColor(name);
    chip.className = 'ga4-summary-chip' + (isActive ? ' active' : '');
    if (chipColor) {
      chip.style.borderColor = chipColor;
      if (isActive) chip.style.background = chipColor + '22';
      chip.innerHTML = `<b style="color:${chipColor}">${esc(name)}</b><span class="chip-count">${count}</span>`;
    } else {
      chip.innerHTML = `<b>${esc(name)}</b><span class="chip-count">${count}</span>`;
    }
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
      <input id="reduxSearch" class="net-search-input" style="margin-left:12px" placeholder="Filter actions..." />
      <div class="ml-auto" style="display:flex;align-items:center;gap:8px">
        <button class="panel-clear-btn" id="reduxClear" title="Clear redux">Clear</button>
        <button class="panel-clear-btn" id="reduxSort" title="Toggle sort order">Time ▲</button>
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

  $('reduxClear').addEventListener('click', () => {
    state.redux.actions = [];
    state.redux.states = [];
    state.redux.selected = -1;
    $('rBadge').textContent = '0';
    renderRedux();
  });

  $('reduxSort').addEventListener('click', () => {
    state.redux.sortDir = state.redux.sortDir === 'desc' ? 'asc' : 'desc';
    $('reduxSort').textContent = state.redux.sortDir === 'desc' ? 'Time \u25BC' : 'Time \u25B2';
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

// Find leaf-level changes between two values (for Redux store diff)
function _findLeafChanges(oldVal, newVal, basePath, maxDepth) {
  const changes = [];
  if (maxDepth === undefined) maxDepth = 5;

  function walk(a, b, path, depth) {
    if (depth > maxDepth) {
      if (!_deepEqual(a, b)) changes.push({ path, oldVal: a, newVal: b });
      return;
    }
    if (a === b) return;
    if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) {
      changes.push({ path, oldVal: a, newVal: b });
      return;
    }
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    allKeys.forEach(k => {
      if (!_deepEqual(a[k], b[k])) {
        const childPath = path ? `${path}.${k}` : k;
        if (a[k] != null && b[k] != null && typeof a[k] === 'object' && typeof b[k] === 'object' && !Array.isArray(a[k])) {
          walk(a[k], b[k], childPath, depth + 1);
        } else {
          changes.push({ path: childPath, oldVal: a[k], newVal: b[k] });
        }
      }
    });
  }

  walk(oldVal, newVal, '', 0);
  return changes;
}

// Create a tree node with changed paths highlighted in a different color
function _createHighlightedTree(key, val, changedPaths, currentPath, isOld) {
  const isArray = Array.isArray(val);
  const isObj = val !== null && typeof val === 'object';
  const myPath = key !== null ? (currentPath ? `${currentPath}.${key}` : String(key)) : currentPath;
  const isChanged = changedPaths.has(myPath);

  if (!isObj) {
    // Leaf value
    const row = document.createElement('div');
    row.className = 'ov-leaf' + (isChanged ? ' rdx-highlight' : '');
    if (isChanged) row.style.cssText = isOld
      ? 'background:rgba(255,94,114,.12);border-radius:3px;padding:1px 4px;'
      : 'background:rgba(61,214,140,.12);border-radius:3px;padding:1px 4px;';
    if (key !== null) {
      const k = document.createElement('span');
      k.className = 'ov-key';
      k.style.color = isChanged ? (isOld ? 'var(--red)' : 'var(--green)') : '';
      k.textContent = `${key}: `;
      row.appendChild(k);
    }
    const v = document.createElement('span');
    v.className = 'ov-prim';
    if (isChanged) v.style.fontWeight = '700';
    if (val === null) { v.textContent = 'null'; v.style.color = isChanged ? (isOld ? 'var(--red)' : 'var(--green)') : 'var(--text-dim)'; }
    else if (typeof val === 'string') { v.textContent = `"${val}"`; v.style.color = isChanged ? (isOld ? 'var(--red)' : 'var(--green)') : 'var(--green)'; }
    else if (typeof val === 'number') { v.textContent = String(val); v.style.color = isChanged ? (isOld ? 'var(--red)' : 'var(--green)') : 'var(--accent2)'; }
    else if (typeof val === 'boolean') { v.textContent = String(val); v.style.color = isChanged ? (isOld ? 'var(--red)' : 'var(--green)') : 'var(--accent2)'; }
    else { v.textContent = _safeStr(val); }
    row.appendChild(v);
    return row;
  }

  // Object/Array — check if any descendants changed
  const hasChangedDescendant = [...changedPaths].some(p => p === myPath || p.startsWith(myPath ? myPath + '.' : ''));
  const container = document.createElement('div');
  container.className = 'ov-node';

  const header = document.createElement('div');
  header.className = 'ov-header';

  const arrow = document.createElement('span');
  arrow.className = 'ov-arrow';
  arrow.textContent = '\u25B6';
  header.appendChild(arrow);

  if (key !== null) {
    const k = document.createElement('span');
    k.className = 'ov-key';
    if (hasChangedDescendant) k.style.color = isOld ? 'var(--red)' : 'var(--green)';
    k.textContent = `${key}: `;
    header.appendChild(k);
  }

  const preview = document.createElement('span');
  preview.className = 'ov-preview';
  preview.textContent = isArray ? `Array(${val.length})` : `{${Object.keys(val).length} keys}`;
  header.appendChild(preview);

  container.appendChild(header);

  const children = document.createElement('div');
  children.className = 'ov-children';
  // Always start collapsed — user expands what they need
  children.style.display = 'none';

  let populated = false;
  function populate() {
    if (populated) return;
    populated = true;
    const entries = isArray ? val.map((v, i) => [i, v]) : Object.entries(val);
    entries.forEach(([k, v]) => {
      children.appendChild(_createHighlightedTree(k, v, changedPaths, myPath, isOld));
    });
  }

  header.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = children.style.display !== 'none';
    children.style.display = open ? 'none' : 'block';
    arrow.textContent = open ? '\u25B6' : '\u25BC';
    if (!open) populate();
  });

  container.appendChild(children);
  return container;
}

function handleReduxEvent(event) {
  if (event.type !== 'redux') return;
  // Skip processing if Redux tab is disabled (saves memory)
  if (!isTabEnabled('redux')) return;
  const { action, nextState } = event;
  const idx = state.redux.actions.length;

  const prevState = state.redux.states.length > 0 ? state.redux.states[state.redux.states.length - 1] : null;
  const changedKeys = [];
  if (prevState && nextState && typeof prevState === 'object' && typeof nextState === 'object') {
    const allKeys = new Set([...Object.keys(prevState), ...Object.keys(nextState)]);
    allKeys.forEach(k => { if (!_deepEqual(prevState[k], nextState[k])) changedKeys.push(k); });
  }

  const actionEntry = { type: action?.type || '?', payload: action, ts: event.ts, index: idx, changedKeys };
  state.redux.actions.push(actionEntry);
  state.redux.states.push(nextState);
  // Cap Redux history to prevent memory leak (full state stored per action)
  const MAX_REDUX_HISTORY = 500;
  if (state.redux.actions.length > MAX_REDUX_HISTORY) {
    const trim = state.redux.actions.length - MAX_REDUX_HISTORY;
    state.redux.actions.splice(0, trim);
    state.redux.states.splice(0, trim);
    // Re-index remaining actions
    state.redux.actions.forEach((a, i) => a.index = i);
    if (state.redux.selected >= 0) state.redux.selected = Math.max(0, state.redux.selected - trim);
  }
  // Don't auto-select — keep all collapsed until user clicks
  $('rBadge').textContent = state.redux.actions.length;
  renderRedux();

  // Always add Redux actions to console logs — visibility controlled by showRedux filter
  {
    const msg = `[Redux] ${actionEntry.type}` + (changedKeys.length ? ` (changed: ${changedKeys.join(', ')})` : '');
    addConsoleLog({
      level: 'redux',
      message: msg,
      args: [{ t: 'string', v: `[Redux] ${actionEntry.type}` }, { t: 'object', v: action }],
      ts: event.ts,
      _isRedux: true,
    });
  }
}

// Assign a consistent color to each Redux action category (e.g. ANALYTICS, CART, USER)
const _reduxCatColors = {};
const _reduxColorPalette = [
  'var(--accent)',   // blue
  'var(--green)',    // green
  'var(--orange)',   // orange
  'var(--accent2)',  // purple
  '#e06c75',        // coral
  '#56b6c2',        // teal
  '#c678dd',        // magenta
  '#d19a66',        // gold
  '#98c379',        // lime
  '#e5c07b',        // yellow
];
let _reduxColorIdx = 0;
function _reduxCategoryColor(category) {
  if (!_reduxCatColors[category]) {
    _reduxCatColors[category] = _reduxColorPalette[_reduxColorIdx % _reduxColorPalette.length];
    _reduxColorIdx++;
  }
  return _reduxCatColors[category];
}

function renderRedux() {
  const content = $('reduxContent');
  const empty = $('reduxEmpty');
  if (!content) return;

  const { actions, states, selected, searchFilter, sortDir } = state.redux;
  let visible = searchFilter ? actions.filter(a => a.type.toLowerCase().includes(searchFilter)) : [...actions];
  if (sortDir === 'desc') visible = [...visible].reverse();

  empty.style.display = visible.length ? 'none' : 'flex';
  content.querySelectorAll('.rdx-entry').forEach(e => e.remove());
  if (!visible.length) return;

  const ttLabel = $('ttLabel');
  if (ttLabel) ttLabel.textContent = selected >= 0 ? `${selected + 1}/${actions.length}` : `—/${actions.length}`;

  const frag = document.createDocumentFragment();
  visible.forEach(a => {
    const isSelected = a.index === selected;

    const entry = document.createElement('div');
    entry.className = 'rdx-entry' + (isSelected ? ' selected' : '');

    // Row header — always visible
    const header = document.createElement('div');
    header.className = 'rdx-entry-header';
    const changesBadge = a.changedKeys?.length ? `<span class="rdx-changes">${a.changedKeys.length} changed</span>` : '';
    // Color-code action type by category prefix (e.g. ANALYTICS/, CART/, USER/)
    const typeParts = a.type.split('/');
    let typeHtml;
    if (typeParts.length >= 2) {
      const catColor = _reduxCategoryColor(typeParts[0]);
      typeHtml = `<span class="rdx-type-cat" style="color:${catColor}">${esc(typeParts[0])}/</span><span class="rdx-type-name">${esc(typeParts.slice(1).join('/'))}</span>`;
    } else {
      typeHtml = `<span class="rdx-type">${esc(a.type)}</span>`;
    }
    header.innerHTML = `<span class="rdx-index">#${a.index}</span>${typeHtml}<span class="rdx-header-right">${changesBadge}<span class="rdx-time">${ts(a.ts)}</span></span>`;
    // Toggle: click to expand, click again to collapse
    header.addEventListener('click', () => {
      state.redux.selected = isSelected ? -1 : a.index;
      renderRedux();
    });
    // Right-click to copy action type
    header.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e, [
        { label: 'Copy Action Type', action: () => navigator.clipboard.writeText(a.type) },
        { label: 'Copy Action Payload', action: () => navigator.clipboard.writeText(JSON.stringify(a.payload, null, 2)) },
      ]);
    });
    // Allow text selection on the action type
    header.style.userSelect = 'text';
    entry.appendChild(header);

    // Expanded detail — only for explicitly selected action
    if (isSelected) {
      const detail = document.createElement('div');
      detail.className = 'rdx-entry-detail';

      // Close button
      const closeBtn = document.createElement('button');
      closeBtn.className = 'rdx-close-btn';
      closeBtn.textContent = '✕';
      closeBtn.title = 'Close';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.redux.selected = -1;
        renderRedux();
      });
      detail.appendChild(closeBtn);

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
        pLabel.textContent = 'Action Payload';
        detail.appendChild(pLabel);
        detail.appendChild(createTreeNode(null, a.payload, false));
      }

      // Store changes — two-column layout: Previous | Current
      const prevS = a.index > 0 ? states[a.index - 1] : null;
      const currS = states[a.index];
      if (currS && typeof currS === 'object' && a.changedKeys?.length > 0) {
        a.changedKeys.forEach(key => {
          const keyWrap = document.createElement('div');
          keyWrap.className = 'rdx-store-diff';

          const kLabel = document.createElement('div');
          kLabel.className = 'rdx-store-key-label';
          kLabel.textContent = key;
          keyWrap.appendChild(kLabel);

          const oldVal = prevS ? prevS[key] : undefined;
          const newVal = currS[key];

          // Find which sub-keys changed (for highlighting)
          const changedPaths = new Set();
          _findLeafChanges(oldVal, newVal, '').forEach(c => changedPaths.add(c.path));

          // Two-column grid: Previous | Current
          const grid = document.createElement('div');
          grid.className = 'rdx-diff-grid';

          // Previous column
          const prevCol = document.createElement('div');
          prevCol.className = 'rdx-diff-col prev';
          const prevLabel = document.createElement('div');
          prevLabel.className = 'rdx-state-label prev';
          prevLabel.textContent = '- Previous';
          prevCol.appendChild(prevLabel);
          if (oldVal !== undefined) {
            prevCol.appendChild(_createHighlightedTree(null, oldVal, changedPaths, '', true));
          } else {
            const na = document.createElement('span');
            na.style.cssText = 'color:var(--text-dim);font-size:10px;font-style:italic';
            na.textContent = 'undefined';
            prevCol.appendChild(na);
          }
          grid.appendChild(prevCol);

          // Current column
          const currCol = document.createElement('div');
          currCol.className = 'rdx-diff-col curr';
          const currLabel = document.createElement('div');
          currLabel.className = 'rdx-state-label curr';
          currLabel.textContent = '+ Current';
          currCol.appendChild(currLabel);
          if (newVal !== undefined) {
            currCol.appendChild(_createHighlightedTree(null, newVal, changedPaths, '', false));
          } else {
            const na = document.createElement('span');
            na.style.cssText = 'color:var(--text-dim);font-size:10px;font-style:italic';
            na.textContent = 'undefined';
            currCol.appendChild(na);
          }
          grid.appendChild(currCol);

          // Right-click to copy on each column
          prevCol.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            showContextMenu(e, [
              { label: 'Copy Previous Value', action: () => navigator.clipboard.writeText(JSON.stringify(oldVal, null, 2)) },
              { label: 'Copy Current Value', action: () => navigator.clipboard.writeText(JSON.stringify(newVal, null, 2)) },
              { label: `Copy "${key}" key`, action: () => navigator.clipboard.writeText(key) },
            ]);
          });
          currCol.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            showContextMenu(e, [
              { label: 'Copy Current Value', action: () => navigator.clipboard.writeText(JSON.stringify(newVal, null, 2)) },
              { label: 'Copy Previous Value', action: () => navigator.clipboard.writeText(JSON.stringify(oldVal, null, 2)) },
              { label: `Copy "${key}" key`, action: () => navigator.clipboard.writeText(key) },
            ]);
          });

          keyWrap.appendChild(grid);
          detail.appendChild(keyWrap);
        });
      }

      entry.appendChild(detail);
    }

    frag.appendChild(entry);
  });

  content.appendChild(frag);
  // Scroll selected entry into view
  const selEl = content.querySelector('.rdx-entry.selected');
  if (selEl) {
    selEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }
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
    <div class="storage-layout" id="storageLayout">
      <div class="storage-keys" id="storageKeysPane">
        <div class="panel-toolbar" style="height:32px">
          <span style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Keys</span>
        </div>
        <div class="scroll-area storage-keys-list" id="storageKeyList">
          <div class="empty-state" id="storageEmpty">
            <div class="icon">💾</div>
            <div class="label">No storage data</div>
            <div class="hint">AsyncStorage data will appear here</div>
          </div>
        </div>
      </div>
      <div class="storage-resize-handle" id="storageResizeHandle"></div>
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

  // Drag resize handle for key list width
  const handle = $('storageResizeHandle');
  const layout = $('storageLayout');
  const keysPane = $('storageKeysPane');
  if (handle && layout && keysPane) {
    let dragging = false;
    let startX = 0;
    let startW = 0;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startW = keysPane.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const newW = Math.max(120, Math.min(600, startW + (e.clientX - startX)));
      layout.style.gridTemplateColumns = `${newW}px 4px 1fr`;
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }
}

let _storageRAF = null;

function handleStorageEvent(event) {
  if (event.type !== 'storage') return;
  if (!isTabEnabled('storage')) return;
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
  let body = $('storageValueBody');
  const keyLabel = $('storageSelectedKey');
  if (!body) return;
  const { selected, entries } = state.storage;
  if (!selected) {
    body.innerHTML = '<span style="color:var(--text-dim)">Select a key</span>';
    if (keyLabel) keyLabel.textContent = '';
    return;
  }
  if (keyLabel) keyLabel.textContent = selected;
  // Clone-replace to remove stale event listeners
  const fresh = body.cloneNode(false);
  body.parentNode.replaceChild(fresh, body);
  body = fresh;

  let val = entries[selected];
  // Try to parse JSON strings into objects for tree display
  if (typeof val === 'string') {
    try { val = JSON.parse(val); } catch {}
  }

  if (val && typeof val === 'object') {
    body.appendChild(createTreeNode(null, val, false));
    body.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, [
        { label: 'Copy Value', action: () => navigator.clipboard.writeText(JSON.stringify(val, null, 2)) },
        { label: 'Copy Key', action: () => navigator.clipboard.writeText(selected) },
      ]);
    });
  } else {
    body.innerHTML = renderJSON(val);
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}b`;
  return `${(bytes/1024).toFixed(1)}kb`;
}

// ─────────────────────────────────────────────────────────────────────────────
// REACT TREE PANEL
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// NATIVE LOGS PANEL
// ─────────────────────────────────────────────────────────────────────────────
const _nativeState = { logs: [], connected: false, platform: null, levelFilter: 'all', searchFilter: '' };
const MAX_NATIVE_LOGS = 2000;

function initNativeLogsPanel() {
  const panel = $('panel-native');
  if (!panel) return;
  panel.innerHTML = `
    <div class="panel-toolbar">
      <span class="panel-label">Native Logs</span>
      <span class="badge" id="nativeBadge">0</span>
      <div class="ml-auto" style="display:flex;align-items:center;gap:6px">
        <span class="native-status" id="nativeStatus">Detecting...</span>
        <button class="panel-clear-btn" id="nativeClear">Clear</button>
      </div>
    </div>
    <div class="native-connect-panel" id="nativeConnectPanel">
      <div class="native-hero">
        <div style="font-size:36px;opacity:0.15;margin-bottom:12px">📱</div>
        <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:6px">Native Logs</div>
        <div style="font-size:11px;color:var(--text-dim);max-width:420px;line-height:1.7;margin-bottom:20px">
          Stream native crash logs, errors, and warnings directly in ReactoRadar.<br/>
          No need to open Android Studio or Xcode.
        </div>
        <div class="native-platform-cards">
          <div class="native-card" id="nativeCardAndroid">
            <div class="native-card-icon">🤖</div>
            <div class="native-card-title">Android</div>
            <div class="native-card-hint">Requires: <code>adb</code> in PATH (Android SDK)</div>
            <div class="native-card-prereq">
              <div class="native-prereq-step"><b>Prerequisites:</b></div>
              <div class="native-prereq-step">1. Enable <b>Developer Options</b> on device<br/><span style="color:var(--text-dim);font-size:9px">Settings → About Phone → Tap Build Number 7 times</span></div>
              <div class="native-prereq-step">2. Enable <b>USB Debugging</b><br/><span style="color:var(--text-dim);font-size:9px">Settings → Developer Options → USB Debugging → ON</span></div>
              <div class="native-prereq-step">3. Connect device via USB and accept the prompt</div>
              <div class="native-prereq-step">4. Verify: run <code>adb devices</code> in terminal</div>
            </div>
            <div id="nativeAndroidStatus" class="native-detect-status"></div>
            <button class="native-connect-btn" id="nativeConnectAndroid">Connect Android</button>
          </div>
          <div class="native-card" id="nativeCardIOS">
            <div class="native-card-icon">🍎</div>
            <div class="native-card-title">iOS</div>
            <div class="native-card-hint">Simulator or USB device</div>
            <div class="native-card-prereq">
              <div class="native-prereq-step"><b>Simulator:</b></div>
              <div class="native-prereq-step">Requires Xcode Command Line Tools<br/><code>xcode-select --install</code></div>
              <div class="native-prereq-step" style="margin-top:6px"><b>Real Device (USB):</b></div>
              <div class="native-prereq-step">1. Install: <code>brew install libimobiledevice</code></div>
              <div class="native-prereq-step">2. Connect device, tap <b>Trust</b> on the prompt</div>
              <div class="native-prereq-step">3. Verify: <code>idevice_id -l</code> shows device UDID</div>
            </div>
            <div id="nativeIOSStatus" class="native-detect-status"></div>
            <div style="display:flex;gap:6px;margin-top:8px">
              <button class="native-connect-btn" id="nativeConnectIOSSim">Simulator</button>
              <button class="native-connect-btn" id="nativeConnectIOSDevice">USB Device</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="native-logs-area" id="nativeLogsArea" style="display:none">
      <div class="native-filter-bar">
        <input id="nativeSearch" class="net-search-input" placeholder="Filter logs..." />
        <div class="native-level-filters" id="nativeLevelFilters">
          <button class="net-status-btn active" data-level="all">All</button>
          <button class="net-status-btn" data-level="fatal">Fatal</button>
          <button class="net-status-btn" data-level="error">Error</button>
          <button class="net-status-btn" data-level="warn">Warn</button>
          <button class="net-status-btn" data-level="info">Info</button>
          <button class="net-status-btn" data-level="debug">Debug</button>
        </div>
        <div style="margin-left:auto;display:flex;gap:6px;align-items:center">
          <button class="panel-clear-btn" id="nativeLogsClear">Clear</button>
          <button class="panel-clear-btn" id="nativeDisconnect" style="color:var(--red)">Disconnect</button>
        </div>
      </div>
      <div class="native-log-list" id="nativeLogList"></div>
    </div>`;

  // Connect buttons — auto-enable tab when user clicks connect
  function _enableNativeTab() {
    const vis = getTabVisibility();
    if (!vis['native']) {
      vis['native'] = true;
      setTabVisibility(vis);
      applyTabVisibility();
    }
  }
  $('nativeConnectAndroid')?.addEventListener('click', () => { _enableNativeTab(); window.electronAPI?.startNativeLogs('android'); });
  $('nativeConnectIOSSim')?.addEventListener('click', () => { _enableNativeTab(); window.electronAPI?.startNativeLogs('ios-sim'); });
  $('nativeConnectIOSDevice')?.addEventListener('click', () => { _enableNativeTab(); window.electronAPI?.startNativeLogs('ios-device'); });
  $('nativeDisconnect')?.addEventListener('click', () => window.electronAPI?.stopNativeLogs());

  // Clear buttons (toolbar + logs area)
  $('nativeClear')?.addEventListener('click', _clearNativeLogs);
  $('nativeLogsClear')?.addEventListener('click', _clearNativeLogs);

  // Level filter
  $('nativeLevelFilters')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.net-status-btn');
    if (!btn) return;
    $('nativeLevelFilters').querySelectorAll('.net-status-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _nativeState.levelFilter = btn.dataset.level;
    _renderNativeLogs();
  });

  // Search
  $('nativeSearch')?.addEventListener('input', (e) => {
    _nativeState.searchFilter = e.target.value.toLowerCase().trim();
    _renderNativeLogs();
  });

  // IPC: receive native logs
  window.electronAPI?.on('native-log', (log) => {
    if (!isTabEnabled('native')) return;
    _nativeState.logs.push(log);
    if (_nativeState.logs.length > MAX_NATIVE_LOGS) {
      _nativeState.logs = _nativeState.logs.slice(-MAX_NATIVE_LOGS);
    }
    $('nativeBadge').textContent = _nativeState.logs.length;
    _appendNativeLog(log);
  });

  // IPC: connection status
  window.electronAPI?.on('native-status', (status) => {
    _nativeState.connected = status.connected;
    _nativeState.platform = status.platform || null;
    const statusEl = $('nativeStatus');
    const connectPanel = $('nativeConnectPanel');
    const logsArea = $('nativeLogsArea');

    if (status.connected) {
      if (statusEl) { statusEl.textContent = `Connected (${status.platform})`; statusEl.style.color = 'var(--green)'; }
      if (connectPanel) connectPanel.style.display = 'none';
      if (logsArea) logsArea.style.display = 'flex';
    } else {
      if (statusEl) {
        statusEl.textContent = status.error || 'Not connected';
        statusEl.style.color = status.error ? 'var(--red)' : 'var(--text-dim)';
      }
      if (connectPanel) connectPanel.style.display = 'flex';
      if (logsArea) logsArea.style.display = 'none';
    }
  });

  // Auto-detect platform and auto-connect
  _autoDetectNative();
}

function _clearNativeLogs() {
  _nativeState.logs = [];
  if ($('nativeBadge')) $('nativeBadge').textContent = '0';
  const list = $('nativeLogList');
  if (list) list.innerHTML = '';
}

async function _autoDetectNative() {
  const statusEl = $('nativeStatus');
  try {
    const result = await window.electronAPI?.detectNativePlatform();
    if (!result) { if (statusEl) { statusEl.textContent = 'Detection unavailable'; statusEl.style.color = 'var(--text-dim)'; } return; }

    // Update card statuses
    const androidStatus = $('nativeAndroidStatus');
    const iosStatus = $('nativeIOSStatus');
    if (androidStatus) {
      if (result.android) { androidStatus.innerHTML = '<span style="color:var(--green)">Device detected</span>'; }
      else if (result.adbPath) { androidStatus.innerHTML = '<span style="color:var(--orange)">adb found — no device connected</span>'; }
      else { androidStatus.innerHTML = '<span style="color:var(--text-dim)">adb not found</span>'; }
    }
    if (iosStatus) {
      const parts = [];
      if (result.iosSim) parts.push('<span style="color:var(--green)">Simulator running</span>');
      if (result.iosDevice) parts.push('<span style="color:var(--green)">USB device detected</span>');
      if (!parts.length) parts.push('<span style="color:var(--text-dim)">No device detected</span>');
      iosStatus.innerHTML = parts.join(' · ');
    }

    // Show detection result — user clicks Connect to start
    if (result.android || result.iosSim || result.iosDevice) {
      const detected = [result.android ? 'Android' : '', result.iosSim ? 'iOS Sim' : '', result.iosDevice ? 'iOS Device' : ''].filter(Boolean).join(', ');
      if (statusEl) { statusEl.textContent = `Detected: ${detected} — click Connect to start`; statusEl.style.color = 'var(--accent)'; }
    } else {
      if (statusEl) { statusEl.textContent = 'No device detected'; statusEl.style.color = 'var(--text-dim)'; }
    }
  } catch {
    if (statusEl) { statusEl.textContent = 'Detection failed'; statusEl.style.color = 'var(--text-dim)'; }
  }
}

function _appendNativeLog(log) {
  const list = $('nativeLogList');
  if (!list) return;

  // Check filters
  if (_nativeState.levelFilter !== 'all' && log.level !== _nativeState.levelFilter) return;
  if (_nativeState.searchFilter && !log.message?.toLowerCase().includes(_nativeState.searchFilter) && !log.tag?.toLowerCase().includes(_nativeState.searchFilter)) return;

  const isExpandable = log.level === 'error' || log.level === 'fatal' || (log.message || '').length > 200;
  const row = document.createElement('div');
  row.className = `native-log-row native-${log.level || 'info'}`;

  const time = log.time || new Date(log.ts).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Header line (always visible)
  const header = document.createElement('div');
  header.className = 'native-log-header';
  header.innerHTML = `<span class="native-log-time">${esc(time)}</span>`
    + `<span class="native-log-level">${esc((log.level || 'info').toUpperCase())}</span>`
    + (log.tag ? `<span class="native-log-tag">${esc(log.tag)}</span>` : '')
    + `<span class="native-log-preview">${esc((log.message || '').split('\\n')[0].slice(0, 200))}</span>`;
  row.appendChild(header);

  // Expandable full message (for errors and long messages)
  if (isExpandable) {
    const fullMsg = document.createElement('div');
    fullMsg.className = 'native-log-full';
    fullMsg.style.display = 'none';
    fullMsg.textContent = log.message || '';
    row.appendChild(fullMsg);

    header.style.cursor = 'pointer';
    header.addEventListener('click', () => {
      const open = fullMsg.style.display !== 'none';
      fullMsg.style.display = open ? 'none' : 'block';
      row.classList.toggle('expanded', !open);
    });
  }

  // Right-click to copy
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e, [
      { label: 'Copy Message', action: () => navigator.clipboard.writeText(log.message || '') },
      { label: 'Copy Raw Line', action: () => navigator.clipboard.writeText(log.raw || log.message || '') },
      ...(log.tag ? [{ label: `Copy Tag (${log.tag})`, action: () => navigator.clipboard.writeText(log.tag) }] : []),
    ]);
  });

  list.appendChild(row);

  // Cap DOM rows
  while (list.children.length > 1000) list.firstChild.remove();

  // Auto-scroll if near bottom
  const atBottom = (list.scrollHeight - list.scrollTop - list.clientHeight) < 150;
  if (atBottom) list.scrollTop = list.scrollHeight;
}

function _renderNativeLogs() {
  const list = $('nativeLogList');
  if (!list) return;
  list.innerHTML = '';
  _nativeState.logs.forEach(log => _appendNativeLog(log));
}

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
        <div class="hint">Opens as a separate window connected to your app via port 8097</div>
        <div class="hint" style="margin-top:8px;color:var(--yellow)">Note: The RN inspector overlay won't work while React DevTools is connected. Close the DevTools window to use the built-in inspector.</div>
        <button class="btn-launch" id="btnReactDT" style="margin-top:12px">Open React DevTools ↗</button>
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

const FONT_FAMILIES = [
  { label: 'SF Mono', value: "'SFMono-Regular', 'SF Mono', monospace" },
  { label: 'Menlo', value: "Menlo, monospace" },
  { label: 'Monaco', value: "Monaco, monospace" },
  { label: 'Courier New', value: "'Courier New', Courier, monospace" },
  { label: 'System Mono', value: "monospace" },
];
function getStoredFontFamily() {
  try {
    const saved = localStorage.getItem('rn-debug-fontfamily');
    // Reset if saved value was a removed font
    if (saved && !FONT_FAMILIES.some(f => f.value === saved)) return FONT_FAMILIES[0].value;
    return saved || FONT_FAMILIES[0].value;
  } catch { return FONT_FAMILIES[0].value; }
}
function setStoredFontFamily(f) {
  try { localStorage.setItem('rn-debug-fontfamily', f); } catch {}
}
function applyFontFamily(family) {
  document.body.style.fontFamily = family;
}

// ─── Hidden URLs (Network tab) ───────────────────────────────────────────────
function getHiddenURLs() {
  try { return JSON.parse(localStorage.getItem('rn-debug-hidden-urls') || '[]'); } catch { return []; }
}
function setHiddenURLs(list) {
  try { localStorage.setItem('rn-debug-hidden-urls', JSON.stringify(list)); } catch {}
}
function addHiddenURL(url) {
  // Extract the base URL (without query params) as the pattern
  const pattern = url.split('?')[0];
  const list = getHiddenURLs();
  if (!list.includes(pattern)) {
    list.push(pattern);
    setHiddenURLs(list);
  }
  _updateHiddenBadge();
}
function removeHiddenURL(pattern) {
  const list = getHiddenURLs().filter(u => u !== pattern);
  setHiddenURLs(list);
  _updateHiddenBadge();
}
function isURLHidden(url) {
  const hidden = getHiddenURLs();
  if (!hidden.length) return false;
  const base = url.split('?')[0];
  return hidden.some(pattern => base === pattern || base.startsWith(pattern));
}
function _updateHiddenBadge() {
  const btn = $('netHiddenBtn');
  if (!btn) return;
  const count = getHiddenURLs().length;
  btn.textContent = count > 0 ? `Hidden (${count})` : 'Hidden';
  btn.style.display = count > 0 ? '' : 'none';
}

// ─── Tab Visibility ──────────────────────────────────────────────────────────
const TAB_CONFIG = [
  { id: 'console',     label: 'Console',      icon: '🖥', essential: true },
  { id: 'network',     label: 'Network',      icon: '📡', essential: true },
  { id: 'redux',       label: 'Redux',        icon: '🔲', essential: false },
  { id: 'ga4',         label: 'GA4 Events',   icon: '📊', essential: false },
  { id: 'storage',     label: 'AsyncStorage', icon: '💾', essential: false },
  { id: 'memory',      label: 'Memory',       icon: '🧠', essential: false, defaultHidden: true },
  { id: 'performance', label: 'Performance',  icon: '⚡', essential: false, defaultHidden: true },
  { id: 'react',       label: 'React Tree',   icon: '⚛️', essential: false },
  { id: 'native',      label: 'Native Logs',  icon: '📱', essential: false, defaultHidden: true },
];
function getTabVisibility() {
  try {
    const saved = JSON.parse(localStorage.getItem('rn-debug-tab-visibility') || '{}');
    const result = {};
    TAB_CONFIG.forEach(t => { result[t.id] = saved[t.id] !== undefined ? saved[t.id] : !t.defaultHidden; });
    return result;
  } catch {
    const result = {};
    TAB_CONFIG.forEach(t => { result[t.id] = !t.defaultHidden; });
    return result;
  }
}
function setTabVisibility(vis) {
  try { localStorage.setItem('rn-debug-tab-visibility', JSON.stringify(vis)); } catch {}
}
function getTabOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem('rn-debug-tab-order') || '[]');
    if (saved.length) {
      // Merge: keep saved order, append any new tabs not in saved list
      const allIds = TAB_CONFIG.map(t => t.id);
      const merged = saved.filter(id => allIds.includes(id));
      allIds.forEach(id => { if (!merged.includes(id)) merged.push(id); });
      return merged;
    }
  } catch {}
  return TAB_CONFIG.map(t => t.id);
}
function setTabOrder(order) {
  try { localStorage.setItem('rn-debug-tab-order', JSON.stringify(order)); } catch {}
}
function applyTabVisibility() {
  const vis = getTabVisibility();
  const order = getTabOrder();
  const nav = $('sidebar');
  if (!nav) return;
  // Reorder nav buttons according to saved order + hide disabled ones
  // Settings button always stays last
  const settingsBtn = nav.querySelector('.nav-btn[data-panel="settings"]');
  const spacer = nav.querySelector('.nav-spacer');
  const anchor = spacer || settingsBtn; // insert before spacer or settings
  order.forEach(tabId => {
    const btn = nav.querySelector(`.nav-btn[data-panel="${tabId}"]`);
    if (btn) {
      btn.style.display = vis[tabId] ? '' : 'none';
      nav.insertBefore(btn, anchor);
    }
  });
  // If active panel is now hidden, switch to first visible
  if (!vis[state.activePanel]) {
    const first = order.find(id => vis[id]);
    if (first) switchPanel(first);
  }
}
function isTabEnabled(tabId) {
  return getTabVisibility()[tabId] !== false;
}

function _buildTabVisGrid() {
  const container = $('tabVisibilityGrid');
  if (!container) return;
  container.innerHTML = '';
  const vis = getTabVisibility();
  const order = getTabOrder();
  let dragSrc = null;

  order.forEach(tabId => {
    const t = TAB_CONFIG.find(c => c.id === tabId);
    if (!t) return;

    const item = document.createElement('div');
    item.className = `tab-vis-item ${vis[t.id] ? 'active' : 'inactive'}`;
    item.dataset.tab = t.id;
    item.draggable = true;

    // Drag handle
    const drag = document.createElement('span');
    drag.className = 'tab-vis-drag';
    drag.textContent = '⠿';
    item.appendChild(drag);

    // Checkbox
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'tab-vis-check';
    check.checked = vis[t.id];
    if (t.essential) check.disabled = true;
    check.addEventListener('change', () => {
      const v = getTabVisibility();
      v[t.id] = check.checked;
      setTabVisibility(v);
      applyTabVisibility();
      item.classList.toggle('active', check.checked);
      item.classList.toggle('inactive', !check.checked);
    });
    item.appendChild(check);

    // Icon + label
    const icon = document.createElement('span');
    icon.className = 'tab-vis-icon';
    icon.textContent = t.icon;
    item.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'tab-vis-label';
    label.textContent = t.label;
    item.appendChild(label);

    if (t.essential) {
      const req = document.createElement('span');
      req.className = 'tab-vis-required';
      req.textContent = 'Required';
      item.appendChild(req);
    }

    // Drag events
    item.addEventListener('dragstart', (e) => {
      dragSrc = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      container.querySelectorAll('.tab-vis-item').forEach(el => el.classList.remove('drag-over'));
      dragSrc = null;
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragSrc && dragSrc !== item) item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      if (!dragSrc || dragSrc === item) return;
      // Reorder: move dragSrc before or after this item
      const items = [...container.querySelectorAll('.tab-vis-item')];
      const fromIdx = items.indexOf(dragSrc);
      const toIdx = items.indexOf(item);
      if (fromIdx < toIdx) {
        container.insertBefore(dragSrc, item.nextSibling);
      } else {
        container.insertBefore(dragSrc, item);
      }
      // Save new order
      const newOrder = [...container.querySelectorAll('.tab-vis-item')].map(el => el.dataset.tab);
      setTabOrder(newOrder);
      applyTabVisibility();
    });

    container.appendChild(item);
  });
}

function getStoredAppName() {
  try { return localStorage.getItem('rn-debug-appname') || 'ReactoRadar'; } catch { return 'ReactoRadar'; }
}
function setStoredAppName(n) {
  try { localStorage.setItem('rn-debug-appname', n); } catch {}
}
function getStoredMetroPort() {
  try { return parseInt(localStorage.getItem('rn-debug-metro-port')) || 8081; } catch { return 8081; }
}
function setStoredMetroPort(p) {
  try { localStorage.setItem('rn-debug-metro-port', String(p)); } catch {}
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
      <div class="settings-two-col">
        <div class="settings-col-left">
          <div class="settings-section">
            <div class="settings-section-title">Appearance</div>
            <div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:8px">
              <div>
                <div class="settings-label">Theme</div>
                <div class="settings-hint">Choose a color theme</div>
              </div>
              <div class="theme-grid" id="themeSwitcher"></div>
            </div>
            <div class="settings-row">
              <div>
                <div class="settings-label">Font Size</div>
                <div class="settings-hint">Adjust text size</div>
              </div>
              <div class="font-size-control">
                <button class="font-size-btn" id="fontSizeDown">A-</button>
                <span class="font-size-display" id="fontSizeDisplay">${currentSize}px</span>
                <button class="font-size-btn" id="fontSizeUp">A+</button>
              </div>
            </div>
            <div class="settings-row">
              <div>
                <div class="settings-label">Font Family</div>
              </div>
              <select id="fontFamilySelect" class="net-throttle-select" style="width:150px">
                ${FONT_FAMILIES.map(f => `<option value="${esc(f.value)}" ${f.value === getStoredFontFamily() ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
              </select>
            </div>
            <div class="settings-row">
              <div>
                <div class="settings-label">App Name</div>
              </div>
              <div style="display:flex;align-items:center;gap:6px">
                <input id="appNameInput" class="net-search-input" style="width:120px;text-align:center" value="${getStoredAppName()}" />
                <button class="font-size-btn" id="appNameReset" title="Reset">Reset</button>
              </div>
            </div>
            <div class="settings-row">
              <div>
                <div class="settings-label">Toast Notifications</div>
                <div class="settings-hint">Show alerts for API errors and slow requests</div>
              </div>
              <label class="toggle-label" for="toastToggle">
                <input type="checkbox" id="toastToggle" class="toggle-input" ${getToastsEnabled() ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-title">Connection</div>
            <div class="settings-row">
              <div>
                <div class="settings-label">Bridge Ports</div>
                <div class="settings-hint">Redux :9090 · Storage :9091 · Network :9092</div>
              </div>
            </div>
            <div class="settings-row">
              <div>
                <div class="settings-label">Metro Port</div>
              </div>
              <input id="metroPortInput" type="number" class="net-search-input" style="width:70px;text-align:center" value="${getStoredMetroPort()}" />
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-title">About</div>
            <div class="settings-about">
              <div class="about-name" id="aboutAppName">${getStoredAppName()}</div>
              <div class="about-version" id="aboutVersion">v${state._appVersion || '...'}</div>
              <div class="about-desc">Standalone macOS debugger for React Native.<br/>Supports Hermes, New Arch, and RN 0.74+.</div>
              <div class="about-links" style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
                <span class="about-link" id="linkGithub">GitHub</span>
                <span class="about-link" id="linkDocs">Docs</span>
                <span class="about-link" id="linkLinkedIn">LinkedIn</span>
              </div>
              <div style="margin-top:12px;text-align:center">
                <button class="support-btn" id="linkSupport" title="Support ReactoRadar development">☕ Support this project</button>
              </div>
            </div>
          </div>
        </div>
        <div class="settings-col-right">
          <div class="settings-section">
            <div class="settings-section-title">Panels</div>
            <div class="settings-hint" style="margin-bottom:8px">Show/hide tabs and drag to reorder. Disabled tabs save memory.</div>
            <div class="tab-visibility-grid" id="tabVisibilityGrid"></div>
          </div>
          <div class="settings-section">
            <div class="settings-section-title">Keyboard Shortcuts</div>
            <div class="settings-shortcut-grid">
              <span class="sc-key">⌘K</span><span class="sc-label">Clear All</span>
              <span class="sc-key">⌘D</span><span class="sc-label">JS Debugger</span>
              <span class="sc-key">⌘R</span><span class="sc-label">React DevTools</span>
              <span class="sc-key">⌘⇧T</span><span class="sc-label">Toggle Theme</span>
              <span class="sc-key">⌘F</span><span class="sc-label">Find</span>
              <span class="sc-key">⌘1–9</span><span class="sc-label">Switch Panels</span>
              <span class="sc-key">⌘+/−</span><span class="sc-label">Zoom</span>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-title">Quick Start</div>
            <div class="settings-hint" style="line-height:1.8;font-size:11px">
              <b style="color:var(--text)">1.</b> <code style="color:var(--accent);background:var(--bg3);padding:1px 5px;border-radius:3px">npx reactoradar setup</code><br/>
              <b style="color:var(--text)">2.</b> <code style="color:var(--accent);background:var(--bg3);padding:1px 5px;border-radius:3px">npx reactoradar</code> or open app<br/>
              <b style="color:var(--text)">3.</b> <code style="color:var(--accent);background:var(--bg3);padding:1px 5px;border-radius:3px">npx react-native start</code><br/>
              <b style="color:var(--text)">4.</b> Console, Network, Redux auto-connect<br/>
              <b style="color:var(--text)">5.</b> <code style="color:var(--accent);background:var(--bg3);padding:1px 5px;border-radius:3px">npx reactoradar remove</code> to uninstall
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-title">Version History</div>
            <div class="settings-hint" style="margin-bottom:4px">Roll back to a previous version if you notice issues.</div>
            <div class="settings-hint rollback-steps" id="rollbackSteps" style="margin-bottom:10px;line-height:1.8;font-size:10px">
              <b style="color:var(--text)">How to roll back:</b><br/>
              <span id="rollbackDmgSteps" style="display:none">
                <b style="color:var(--text)">1.</b> Click <b>Download</b> on the version you want<br/>
                <b style="color:var(--text)">2.</b> Open the downloaded <code style="color:var(--accent);background:var(--bg3);padding:1px 4px;border-radius:3px">.dmg</code> file<br/>
                <b style="color:var(--text)">3.</b> Drag the app to Applications (replace existing)<br/>
                <b style="color:var(--text)">4.</b> Relaunch ReactoRadar
              </span>
              <span id="rollbackNpmSteps" style="display:none">
                <b style="color:var(--text)">1.</b> Run <code style="color:var(--accent);background:var(--bg3);padding:1px 4px;border-radius:3px">npx reactoradar@&lt;version&gt;</code> e.g. <code style="color:var(--accent);background:var(--bg3);padding:1px 4px;border-radius:3px">npx reactoradar@1.6.4</code><br/>
                <b style="color:var(--text)">2.</b> Or pin globally: <code style="color:var(--accent);background:var(--bg3);padding:1px 4px;border-radius:3px">npm i -g reactoradar@1.6.4</code><br/>
                <b style="color:var(--text)">3.</b> Run <code style="color:var(--accent);background:var(--bg3);padding:1px 4px;border-radius:3px">reactoradar</code> to launch
              </span>
            </div>
            <div id="versionHistoryList" class="version-history-list">
              <div style="color:var(--text-dim);font-size:11px;padding:12px;text-align:center">Loading versions...</div>
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
  // Tab visibility + drag reorder
  _buildTabVisGrid();

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
    window.electronAPI?.openExternal('https://github.com/sharanagouda/reactoradar');
  });
  $('linkDocs')?.addEventListener('click', () => {
    window.electronAPI?.openExternal('https://github.com/sharanagouda/reactoradar#readme');
  });
  $('linkLinkedIn')?.addEventListener('click', () => {
    window.electronAPI?.openExternal('https://www.linkedin.com/in/sharanagoudamk/');
  });
  $('linkSupport')?.addEventListener('click', () => {
    window.electronAPI?.openExternal('https://razorpay.me/@reactoradar');
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

  // Metro Port
  $('metroPortInput')?.addEventListener('change', (e) => {
    let port = parseInt(e.target.value.trim());
    if (isNaN(port) || port < 1024 || port > 65535) port = 8081;
    e.target.value = port;
    setStoredMetroPort(port);
    window.electronAPI?.setMetroPort(port);
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

  // Font family
  $('fontFamilySelect')?.addEventListener('change', (e) => {
    const family = e.target.value;
    setStoredFontFamily(family);
    applyFontFamily(family);
  });

  // Toast toggle
  $('toastToggle')?.addEventListener('change', (e) => {
    setToastsEnabled(e.target.checked);
  });

  // Apply update banner if update info arrived before settings panel was created
  _applyUpdateBanner();

  // Fetch and render version history for rollback
  _loadVersionHistory();
}

function _loadVersionHistory() {
  const container = $('versionHistoryList');
  if (!container) return;
  if (!window.electronAPI || typeof window.electronAPI.fetchReleases !== 'function') {
    container.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:12px;text-align:center">Version history not available.</div>';
    return;
  }

  // Show appropriate rollback steps based on install type
  const isPackaged = !!state._isPackaged;
  const dmgSteps = $('rollbackDmgSteps');
  const npmSteps = $('rollbackNpmSteps');
  if (dmgSteps) dmgSteps.style.display = isPackaged ? '' : 'none';
  if (npmSteps) npmSteps.style.display = isPackaged ? 'none' : '';

  window.electronAPI.fetchReleases().then(releases => {
    if (!Array.isArray(releases) || releases.length === 0) {
      container.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:12px;text-align:center">Could not load versions.</div>';
      return;
    }

    const currentVersion = state._appVersion || '';
    container.innerHTML = '';

    releases.forEach(r => {
      if (!r || !r.version) return; // skip malformed entries

      const isCurrent = r.version === currentVersion;
      const row = document.createElement('div');
      row.className = 'version-row' + (isCurrent ? ' version-current' : '');

      // Safe date formatting
      let dateStr = '';
      if (r.date) {
        try {
          const d = new Date(r.date);
          if (!isNaN(d.getTime())) {
            dateStr = d.toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
          }
        } catch { /* skip bad date */ }
      }

      // Build action button based on install type
      let actionHtml = '';
      if (isCurrent) {
        actionHtml = '<span class="version-installed">Installed</span>';
      } else if (isPackaged) {
        actionHtml = '<button class="version-install-btn" title="Download .dmg for this version">Download</button>';
      } else {
        actionHtml = `<button class="version-npm-btn" title="Copy npm install command">npx @${esc(r.version)}</button>`;
      }

      row.innerHTML = `
        <div class="version-info">
          <span class="version-tag">v${esc(r.version)}${r.prerelease ? ' <span class="version-pre">pre</span>' : ''}${isCurrent ? ' <span class="version-badge">current</span>' : ''}</span>
          <span class="version-date">${esc(dateStr)}</span>
        </div>
        <div class="version-actions">
          ${actionHtml}
          <button class="version-notes-btn" title="View release notes">Notes</button>
        </div>`;

      // DMG download button — opens the .dmg asset or release page
      const installBtn = row.querySelector('.version-install-btn');
      if (installBtn) {
        installBtn.addEventListener('click', () => {
          const url = r.dmgUrl || r.htmlUrl || '';
          if (url) {
            window.electronAPI.openExternal(url);
          }
        });
      }

      // NPM copy button — copies the npx command to clipboard
      const npmBtn = row.querySelector('.version-npm-btn');
      if (npmBtn) {
        npmBtn.addEventListener('click', () => {
          const cmd = `npx reactoradar@${r.version}`;
          navigator.clipboard.writeText(cmd).then(() => {
            const orig = npmBtn.textContent;
            npmBtn.textContent = 'Copied!';
            npmBtn.style.color = 'var(--green)';
            setTimeout(() => { npmBtn.textContent = orig; npmBtn.style.color = ''; }, 2000);
          }).catch(() => {});
        });
      }

      // Notes button — show changelog in modal
      const notesBtn = row.querySelector('.version-notes-btn');
      if (notesBtn) {
        notesBtn.addEventListener('click', () => {
          if (r.version && typeof _showChangelog === 'function') {
            _showChangelog(r.version);
          }
        });
      }

      container.appendChild(row);
    });

    // If no rows were rendered (all entries were malformed)
    if (container.children.length === 0) {
      container.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:12px;text-align:center">No versions found.</div>';
    }
  }).catch(() => {
    if (container) {
      container.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:12px;text-align:center">Could not load versions. Check your internet connection.</div>';
    }
  });
}

// ─── Memory Monitor ──────────────────────────────────────────────────────────
// Check memory usage periodically and warn user before it causes blank screen
let _memoryWarningShown = false;
setInterval(() => {
  if (!window.performance || !performance.memory) return;
  const used = performance.memory.usedJSHeapSize;
  const limit = performance.memory.jsHeapSizeLimit;
  const pct = used / limit;
  // Warn at 70% usage
  if (pct > 0.7 && !_memoryWarningShown) {
    _memoryWarningShown = true;
    const banner = document.createElement('div');
    banner.id = 'memoryWarning';
    banner.className = 'memory-warning';
    const usedMB = Math.round(used / 1024 / 1024);
    banner.innerHTML = `<span>High memory usage (${usedMB}MB) — ReactoRadar may become unresponsive.</span>`
      + `<button class="memory-warn-btn" id="memWarnClear">Clear All Data</button>`
      + `<button class="memory-warn-btn" id="memWarnDismiss">Dismiss</button>`;
    document.body.prepend(banner);
    $('memWarnClear')?.addEventListener('click', () => {
      // Clear all panel data
      state.console.logs = []; _consolePending = [];
      _lastLogMsg = ''; _lastLogRow = null; _lastLogCount = 1;
      $('cBadge').textContent = '0'; renderConsole();
      state.network.requests = {}; state.network.order = []; state.network.selectedId = null;
      $('nBadge').textContent = '0'; renderNetwork();
      state.redux.actions = []; state.redux.states = []; state.redux.selected = -1;
      $('rBadge').textContent = '0'; renderRedux();
      banner.remove(); _memoryWarningShown = false;
    });
    $('memWarnDismiss')?.addEventListener('click', () => { banner.remove(); });
  }
  // Reset flag when memory drops
  if (pct < 0.5) _memoryWarningShown = false;
}, 30000); // Check every 30 seconds

// Apply saved theme + font size + font family + app name on load
applyTheme(getStoredTheme());
applyFontSize(getStoredFontSize());
applyFontFamily(getStoredFontFamily());
applyAppName(getStoredAppName());
applyTabVisibility();

// Send stored metro port to backend
window.electronAPI?.setMetroPort(getStoredMetroPort());

// ─────────────────────────────────────────────────────────────────────────────
// SOURCES PANEL (placeholder — use JS Debugger button for breakpoints)
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

  // Folders start collapsed — populate lazily on first expand
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
      const port = getStoredMetroPort();
      const resp = await fetch(`http://localhost:${port}/${filepath}?platform=ios&dev=true`);
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
  if (!isTabEnabled('performance') && !isTabEnabled('memory')) return;
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
initNativeLogsPanel();
initSettingsPanel();
