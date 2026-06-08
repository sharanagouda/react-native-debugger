// ─────────────────────────────────────────────────────────────────────────────
// ASYNC STORAGE PANEL — extracted from app.js
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
