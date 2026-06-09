// ─── Native Logs Panel ─────────────────────────────────────────────────────
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

