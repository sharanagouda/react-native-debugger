// ─── React Tree Panel ──────────────────────────────────────────────────────
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
