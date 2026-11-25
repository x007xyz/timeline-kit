const STYLE_ID = 'timeline-kit-editor-styles'

const styles = `
.tk-timeline-editor{--tk-border:#d1d5db;--tk-border-strong:#64748b;--tk-bg:#ffffff;--tk-panel:#f9fafb;--tk-surface:#ffffff;--tk-track:#e5e7eb;--tk-text:#111827;--tk-muted:#6b7280;--tk-accent:#3b82f6;--tk-danger:#ef4444;--tk-ruler-bg:#e5e7eb;--tk-ruler-text:#374151;--tk-ruler-sub:#6b7280;--tk-ruler-long:#374151;--tk-ruler-short:#6b7280;--tk-ruler-focus:#c4b5fd;position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;user-select:none;outline:none;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--tk-text);background:var(--tk-bg)}
.tk-timeline-editor[data-theme="dark"]{--tk-border:#2b3442;--tk-border-strong:#60a5fa;--tk-bg:#111827;--tk-panel:#192131;--tk-surface:#0f172a;--tk-track:#1f2937;--tk-text:#e5e7eb;--tk-muted:#94a3b8;--tk-accent:#60a5fa;--tk-danger:#f87171;--tk-ruler-bg:#1f2937;--tk-ruler-text:#e5e7eb;--tk-ruler-sub:#94a3b8;--tk-ruler-long:#cbd5e1;--tk-ruler-short:#94a3b8;--tk-ruler-focus:#312e81}
.dark .tk-timeline-editor[data-theme="auto"]{--tk-border:#2b3442;--tk-border-strong:#60a5fa;--tk-bg:#111827;--tk-panel:#192131;--tk-surface:#0f172a;--tk-track:#1f2937;--tk-text:#e5e7eb;--tk-muted:#94a3b8;--tk-accent:#60a5fa;--tk-danger:#f87171;--tk-ruler-bg:#1f2937;--tk-ruler-text:#e5e7eb;--tk-ruler-sub:#94a3b8;--tk-ruler-long:#cbd5e1;--tk-ruler-short:#94a3b8;--tk-ruler-focus:#312e81}
@media (prefers-color-scheme: dark){
  .tk-timeline-editor[data-theme="auto"]{--tk-border:#2b3442;--tk-border-strong:#60a5fa;--tk-bg:#111827;--tk-panel:#192131;--tk-surface:#0f172a;--tk-track:#1f2937;--tk-text:#e5e7eb;--tk-muted:#94a3b8;--tk-accent:#60a5fa;--tk-danger:#f87171;--tk-ruler-bg:#1f2937;--tk-ruler-text:#e5e7eb;--tk-ruler-sub:#94a3b8;--tk-ruler-long:#cbd5e1;--tk-ruler-short:#94a3b8;--tk-ruler-focus:#312e81}
}
.tk-timeline-toolbar{flex:0 0 auto;padding:8px 16px 6px;border-bottom:1px solid var(--tk-border);background:var(--tk-bg)}
.tk-toolbar-shell{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px;flex-wrap:wrap}
.tk-toolbar-group{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tk-toolbar-button,.tk-zoom-button{appearance:none;border:0;background:transparent;color:var(--tk-muted);font-size:12px;line-height:1;cursor:pointer;padding:6px 8px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center}
.tk-toolbar-button[data-command="undo"],.tk-toolbar-button[data-command="redo"],.tk-toolbar-button[data-command="split"],.tk-toolbar-button[data-command="delete"],.tk-toolbar-button[data-command="magnet"],.tk-toolbar-button[data-command="fit"]{width:24px;height:24px;padding:0}
.tk-toolbar-button:hover:not(:disabled),.tk-zoom-button:hover{background:color-mix(in srgb,var(--tk-accent) 14%,transparent);color:var(--tk-accent)}
.tk-toolbar-button.is-active{color:var(--tk-accent);background:color-mix(in srgb,var(--tk-accent) 22%,transparent)}
.tk-toolbar-button:disabled{opacity:.4;cursor:not-allowed}
.tk-toolbar-zoom{display:flex;align-items:center;gap:8px;margin-left:16px;width:min(208px,100%);min-width:120px;height:32px;flex:1 1 180px}
.tk-zoom-button{padding:0;width:22px;height:22px}
.tk-zoom-slider{width:100%;accent-color:var(--tk-accent);cursor:pointer}
.tk-timeline-workspace{position:relative;flex:1 1 auto;min-height:0;display:flex;flex-direction:row;overflow:hidden}
.tk-timeline-sidebar{flex:0 0 auto;display:flex;flex-direction:column;width:112px;border-right:1px solid var(--tk-border);overflow:hidden;background:var(--tk-surface)}
.tk-timeline-sidebar-header{flex:0 0 auto;height:20px;background:var(--tk-panel);border-bottom:1px solid var(--tk-border);box-sizing:border-box}
.tk-timeline-sidebar-body{display:flex;flex:1 1 auto;flex-direction:column;gap:4px;min-height:0;box-sizing:border-box;will-change:transform}
.tk-track-label{display:flex;flex:0 0 auto;align-items:center;justify-content:center;gap:10px;width:100%;padding:0 6px;background:var(--tk-surface);box-sizing:border-box}
.tk-track-icon{display:flex;align-items:center;justify-content:center;min-width:20px;min-height:20px}
.tk-track-controls{display:flex;align-items:center;justify-content:center;gap:6px}
.tk-track-toggle{appearance:none;border:0;background:transparent;padding:0;width:18px;height:18px;border-radius:4px;color:var(--tk-muted);cursor:pointer;display:flex;align-items:center;justify-content:center}
.tk-track-toggle:hover{background:var(--tk-track)}
.tk-track-toggle.is-active{color:var(--tk-accent)}
.tk-lucide{display:block;flex:none}
.tk-timeline-main{position:relative;flex:1 1 auto;min-width:0;min-height:0;overflow:hidden;background:var(--tk-surface)}
.tk-timeline-main-scroller{position:relative;display:flex;flex-direction:column;overflow:auto;height:100%}
.tk-timeline-ruler{position:sticky;top:0;left:0;right:0;height:20px;flex:0 0 20px;z-index:20;background:var(--tk-ruler-bg);cursor:pointer}
.tk-ruler-canvas{display:block;width:100%;height:100%}
.tk-tracks-viewport{position:relative;flex:1 0 auto;min-height:calc(100% - 20px)}
.tk-tracks{position:relative;display:flex;flex-direction:column;gap:4px;min-height:100%;box-sizing:border-box}
.tk-empty-state{position:absolute;inset:20px 0 20px 0;display:none;align-items:center;justify-content:center;color:var(--tk-muted);font-size:14px;z-index:2}
.tk-guideline{position:absolute;display:none;pointer-events:none;z-index:25}
.tk-guideline-vertical{top:0;bottom:0;width:1px;background:var(--tk-accent)}
.tk-guideline-horizontal{left:0;right:0;height:2px;background:var(--tk-accent)}
.tk-drag-preview{position:absolute;display:none;align-items:center;justify-content:center;background:color-mix(in srgb,var(--tk-accent) 18%,transparent);border:2px dashed var(--tk-accent);border-radius:4px;color:var(--tk-accent);font-size:12px;font-weight:700;pointer-events:none;z-index:22;box-sizing:border-box}
.tk-marquee{position:absolute;display:none;pointer-events:none;z-index:26;border:1px solid var(--tk-accent);background:color-mix(in srgb,var(--tk-accent) 14%,transparent);border-radius:2px;box-sizing:border-box}
.tk-track-row{position:relative;flex:0 0 auto;background:var(--tk-track);border:2px solid transparent;box-sizing:border-box}
.tk-track-lane{position:relative;height:100%;box-sizing:border-box}
.tk-track-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:20}
.tk-track-overlay.is-locked{background:rgba(254,202,202,.28)}
.tk-track-overlay.is-hidden{background:rgba(209,213,219,.45)}
.tk-track-overlay.is-muted{background:rgba(254,240,138,.3)}
.tk-track-overlay-badge{padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--tk-surface) 88%,transparent);font-size:11px;font-weight:600}
.tk-track-clip{position:absolute;top:0;bottom:0;border-radius:4px;overflow:visible;border:1px solid rgba(255,255,255,.12);cursor:grab;box-sizing:border-box}
.tk-track-clip-content{height:100%;width:100%;overflow:hidden;border-radius:3px;display:flex;align-items:stretch;justify-content:flex-start}
.tk-track-clip.is-selected{z-index:15;box-shadow:0 0 0 2px var(--tk-border-strong)}
.tk-track-clip.is-dragging{z-index:18;cursor:grabbing;opacity:.88}
.tk-track-clip.is-trimming{z-index:18;cursor:ew-resize;opacity:.95}
.tk-track-clip-selection-frame{position:absolute;inset:0;border:1px solid transparent;border-radius:3px;z-index:3;pointer-events:none}
.tk-track-clip.is-selected .tk-track-clip-selection-frame{border-color:var(--tk-border-strong)}
.tk-track-clip-handle{position:absolute;top:-1px;bottom:-1px;width:8px;z-index:4;opacity:0;transition:opacity .12s ease;display:flex;align-items:center;justify-content:center;border-radius:2px;background:var(--tk-border-strong);color:#f8fafc;font-size:10px;line-height:1}
.tk-track-clip:hover .tk-track-clip-handle,.tk-track-clip.is-selected .tk-track-clip-handle{opacity:1}
.tk-track-clip-handle.is-left{left:-8px;cursor:w-resize}
.tk-track-clip-handle.is-right{right:-8px;cursor:e-resize}
.tk-media-clip{position:relative;width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;color:#f8fafc;background:linear-gradient(180deg,rgba(15,23,42,.98),rgba(30,41,59,.94))}
.tk-media-clip.is-audio{background:linear-gradient(180deg,rgba(6,78,59,.96),rgba(17,94,89,.92))}
.tk-media-clip-label{flex:0 0 auto;height:18px;line-height:18px;padding:0 8px;font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.08)}
.tk-media-clip-body{position:relative;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.tk-media-clip-filmstrip-host{position:relative;flex:1 1 auto;min-height:0;overflow:hidden;background:linear-gradient(180deg,rgba(15,23,42,.36),rgba(15,23,42,.08))}
.tk-media-clip-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.tk-media-clip-filmstrip{position:relative;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(24px,1fr);gap:1px;flex:1;min-height:0;padding:1px;background:linear-gradient(180deg,rgba(15,23,42,.36),rgba(15,23,42,.08))}
.tk-media-clip-filmstrip-placeholder{display:block;min-width:0;border-radius:2px;background:linear-gradient(135deg,rgba(148,163,184,.24),rgba(71,85,105,.18))}
.tk-media-clip-waveform{position:relative;display:flex;align-items:center;justify-content:center;height:14px;min-height:14px;overflow:hidden;padding:0 4px;background:linear-gradient(180deg,rgba(59,130,246,.16),rgba(15,23,42,.14));color:rgba(191,219,254,.95)}
.tk-media-clip-waveform.is-audio-body{flex:1;height:auto;min-height:0;padding:0;background:linear-gradient(180deg,rgba(34,197,94,.16),rgba(15,23,42,.12));color:rgba(187,247,208,.96)}
.tk-media-clip-waveform-placeholder{display:block;width:100%;height:1px;border-radius:999px;background:currentColor;opacity:.45}
.tk-default-clip{width:100%;height:100%;padding:8px 10px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;background:linear-gradient(135deg,#111827,#374151 52%,#6b7280);color:#fff}
.tk-default-clip[data-type="text"]{background:linear-gradient(135deg,#701a75,#f5d0fe);color:#3b0764}
.tk-default-clip[data-type="image"]{background:linear-gradient(135deg,#78350f,#fde68a);color:#451a03}
.tk-default-clip-title{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tk-default-clip-meta{font-size:10px;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tk-playhead{position:absolute;top:0;bottom:0;width:1px;background:var(--tk-border-strong);z-index:30;pointer-events:none}
.tk-playhead-handle{position:absolute;top:0;left:0;width:10px;height:12px;background:var(--tk-border-strong);border:1px solid var(--tk-border-strong);transform:translateX(-50%);cursor:ew-resize;pointer-events:auto}
.tk-timeline-editor:focus-visible{outline:2px solid var(--tk-accent);outline-offset:-2px}
.tk-toolbar-button:focus-visible,.tk-zoom-button:focus-visible,.tk-zoom-slider:focus-visible,.tk-track-toggle:focus-visible,.tk-playhead-handle:focus-visible{outline:2px solid var(--tk-accent);outline-offset:2px}
.tk-sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.tk-playhead-handle::after{content:'';display:block;width:10px;height:10px;border:5px solid var(--tk-border-strong);position:absolute;top:100%;left:-1px;border-right-color:transparent;border-left-color:transparent;border-bottom-color:transparent;box-sizing:border-box}
@media (max-width: 900px){
  .tk-timeline-toolbar{padding:8px 12px 6px}
  .tk-toolbar-shell{align-items:flex-start}
  .tk-toolbar-group.is-right{width:100%;justify-content:space-between}
  .tk-toolbar-zoom{margin-left:0}
  .tk-timeline-sidebar{width:76px}
  .tk-track-label{gap:6px;padding:0 4px}
  .tk-track-controls{gap:4px}
}
@media (max-width: 640px){
  .tk-timeline-toolbar{padding:8px 10px 6px}
  .tk-toolbar-shell{gap:8px}
  .tk-toolbar-group{gap:6px}
  .tk-toolbar-group.is-right{align-items:center}
  .tk-toolbar-zoom{flex-basis:100%;width:100%}
}
`

export function ensureTimelineStyles(enabled: boolean = true): void {
  if (!enabled || typeof document === 'undefined') {
    return
  }
  if (document.getElementById(STYLE_ID)) {
    return
  }

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = styles
  document.head.appendChild(style)
}
