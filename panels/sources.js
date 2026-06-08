// ─── Sources Panel ─────────────────────────────────────────────────────────
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
