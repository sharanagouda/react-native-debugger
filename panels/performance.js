// ─── Performance + Memory Panel ────────────────────────────────────────────
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

// ─── Memory Panel ────────────────────────────────────────────────────────────
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
