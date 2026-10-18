// ============================================================
// MotionForge Studio — Precision Multi-Track Timeline
// Canvas 2D, Horizontal Zoom, Pan, Snap, Edge Trim, Context Menu
// ============================================================

import { $, h } from '../util/dom.js';
import { store, state } from '../state.js';
import { getLayerColor } from './layers.js';
import { toast } from '../ui/toast.js';

const RULER_H = 26;
const TRACK_H = 28;
const TRACK_GAP = 6;
const AUDIO_TRACK_H = 24;

export class TimelinePanel {
  constructor() {
    this.canvas = $('#timeline-canvas');
    this.ctx = this.canvas?.getContext('2d');
    this.infoLabel = $('#timeline-info');
    this.contextMenu = null;

    // Interaction state
    this.isDraggingPlayhead = false;
    this.isPanning = false;
    this.panStartX = 0;
    this.initialPanOffset = 0;

    // Layer trimming/moving state
    this.dragMode = null; // 'move' | 'trim-left' | 'trim-right'
    this.dragLayer = null;
    this.dragStartMouseX = 0;
    this.dragInitialAt = 0;
    this.dragInitialDuration = 0;
    this.edgeHoverZone = 6; // px zone for edge cursor

    this.init();
    store.subscribe((event) => {
      if (['scene:loaded', 'scene:mutated', 'playhead:moved', 'layer:selected', 'playback:changed'].includes(event)) {
        this.requestDraw();
      }
    });
  }

  init() {
    if (!this.canvas) return;

    window.addEventListener('resize', () => this.resizeCanvas());
    setTimeout(() => this.resizeCanvas(), 50);

    // Canvas Mouse Events
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', () => this.onMouseUp());
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => this.onContextMenu(e));

    // Global click dismisses context menu
    document.addEventListener('click', () => this.dismissContextMenu());

    // Fit button
    $('#btn-fit')?.addEventListener('click', () => this.fitToWindow());
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    this.requestDraw();
  }

  fitToWindow() {
    state.zoom = 1;
    state.panOffset = 0;
    this.updateInfoLabel();
    this.requestDraw();
  }

  updateInfoLabel() {
    if (!this.infoLabel) return;
    const dur = state.scene?.durationMs || 10000;
    const visibleDur = (dur / state.zoom / 1000).toFixed(1);
    this.infoLabel.textContent = `${Math.round(state.zoom * 100)}% · ${visibleDur}s visible`;
  }

  timeToX(ms) {
    const w = this.canvas.clientWidth;
    const totalDuration = state.scene?.durationMs || 10000;
    const pxPerMs = (w * state.zoom) / totalDuration;
    return ms * pxPerMs + state.panOffset;
  }

  xToTime(x) {
    const w = this.canvas.clientWidth;
    const totalDuration = state.scene?.durationMs || 10000;
    const pxPerMs = (w * state.zoom) / totalDuration;
    const rawMs = (x - state.panOffset) / pxPerMs;

    if (!state.snapEnabled) {
      return Math.max(0, Math.min(rawMs, totalDuration));
    }

    // Snap to 100ms grid
    let snapped = Math.round(rawMs / 100) * 100;

    // Magnet snap to nearest keyframes or layer boundaries (within 12px)
    const snapThresholdMs = 12 / pxPerMs;
    const layers = state.scene?.layers || [];
    for (const l of layers) {
      const start = l.at || 0;
      const end = start + (l.duration || 3000);
      if (Math.abs(rawMs - start) < snapThresholdMs) {
        snapped = start;
        break;
      }
      if (Math.abs(rawMs - end) < snapThresholdMs) {
        snapped = end;
        break;
      }
    }

    return Math.max(0, Math.min(snapped, totalDuration));
  }

  onMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Pan with Middle Click or Space+Click
    if (e.button === 1 || e.spaceKey || (e.buttons === 4) || (e.shiftKey && e.altKey)) {
      e.preventDefault();
      this.isPanning = true;
      this.panStartX = e.clientX;
      this.initialPanOffset = state.panOffset;
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button !== 0) return; // Only primary click for rest

    // 1. Click on Ruler -> Playhead scrub exclusively
    if (y <= RULER_H) {
      this.isDraggingPlayhead = true;
      store.setPlayhead(this.xToTime(x));
      return;
    }

    // 2. Click in Tracks Area
    const layers = state.scene?.layers || [];
    const totalDuration = state.scene?.durationMs || 10000;
    let clickedLayer = null;
    let hitEdge = null;

    layers.forEach((layer, i) => {
      const trackY = RULER_H + i * (TRACK_H + TRACK_GAP);
      if (y >= trackY && y <= trackY + TRACK_H) {
        const x1 = this.timeToX(layer.at || 0);
        const x2 = this.timeToX((layer.at || 0) + (layer.duration || (totalDuration - (layer.at || 0))));

        if (x >= x1 - 4 && x <= x2 + 4) {
          clickedLayer = layer;
          if (Math.abs(x - x1) <= this.edgeHoverZone) {
            hitEdge = 'left';
          } else if (Math.abs(x - x2) <= this.edgeHoverZone) {
            hitEdge = 'right';
          }
        }
      }
    });

    if (clickedLayer) {
      const isMulti = e.shiftKey || e.ctrlKey || e.metaKey;
      store.selectLayer(clickedLayer.id, isMulti);

      if (!clickedLayer._locked) {
        this.dragLayer = clickedLayer;
        this.dragStartMouseX = x;
        this.dragInitialAt = clickedLayer.at || 0;
        this.dragInitialDuration = clickedLayer.duration || 3000;

        if (hitEdge === 'left') {
          this.dragMode = 'trim-left';
        } else if (hitEdge === 'right') {
          this.dragMode = 'trim-right';
        } else {
          this.dragMode = 'move';
        }
      }
    } else {
      // Clicked on empty track space -> scrub playhead
      this.isDraggingPlayhead = true;
      store.setPlayhead(this.xToTime(x));
    }
  }

  onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (this.isPanning) {
      const deltaX = e.clientX - this.panStartX;
      state.panOffset = this.initialPanOffset + deltaX;
      // Clamp pan offset so we don't pan infinitely off
      const maxPan = this.canvas.clientWidth * (state.zoom - 1);
      state.panOffset = Math.min(100, Math.max(-maxPan - 100, state.panOffset));
      this.requestDraw();
      return;
    }

    if (this.isDraggingPlayhead) {
      store.setPlayhead(this.xToTime(x));
      return;
    }

    if (this.dragMode && this.dragLayer) {
      const currentMs = this.xToTime(x);
      const startMs = this.xToTime(this.dragStartMouseX);
      const deltaMs = Math.round(currentMs - startMs);

      store.mutateScene((scene) => {
        const l = scene.layers.find(x => x.id === this.dragLayer.id);
        if (!l) return;

        if (this.dragMode === 'move') {
          l.at = Math.max(0, this.dragInitialAt + deltaMs);
        } else if (this.dragMode === 'trim-left') {
          const newAt = Math.max(0, this.dragInitialAt + deltaMs);
          const maxAt = this.dragInitialAt + this.dragInitialDuration - 100;
          const clampedAt = Math.min(newAt, maxAt);
          l.duration = this.dragInitialDuration - (clampedAt - this.dragInitialAt);
          l.at = clampedAt;
        } else if (this.dragMode === 'trim-right') {
          l.duration = Math.max(100, this.dragInitialDuration + deltaMs);
        }
      }, `Adjust ${this.dragLayer.id}`);
      return;
    }

    // Cursor feedback on hover
    if (y <= RULER_H) {
      this.canvas.style.cursor = 'ew-resize';
      return;
    }

    let cursor = 'crosshair';
    const layers = state.scene?.layers || [];
    const totalDuration = state.scene?.durationMs || 10000;

    layers.forEach((layer, i) => {
      const trackY = RULER_H + i * (TRACK_H + TRACK_GAP);
      if (y >= trackY && y <= trackY + TRACK_H) {
        const x1 = this.timeToX(layer.at || 0);
        const x2 = this.timeToX((layer.at || 0) + (layer.duration || (totalDuration - (layer.at || 0))));
        if (Math.abs(x - x1) <= this.edgeHoverZone || Math.abs(x - x2) <= this.edgeHoverZone) {
          cursor = 'col-resize';
        } else if (x > x1 && x < x2) {
          cursor = 'grab';
        }
      }
    });

    this.canvas.style.cursor = cursor;
  }

  onMouseUp() {
    this.isDraggingPlayhead = false;
    this.isPanning = false;
    this.dragMode = null;
    this.dragLayer = null;
    this.canvas.style.cursor = 'crosshair';
  }

  onWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;

      const timeAtMouse = this.xToTime(mouseX);
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const nextZoom = Math.max(0.5, Math.min(8, state.zoom * zoomFactor));

      state.zoom = nextZoom;

      // Re-anchor pan so time under mouse stays fixed
      const newXAtTime = this.timeToX(timeAtMouse);
      state.panOffset += (mouseX - newXAtTime);

      this.updateInfoLabel();
      this.requestDraw();
    } else {
      // Horizontal pan with trackpad/wheel
      e.preventDefault();
      state.panOffset -= e.deltaX || (e.shiftKey ? e.deltaY : 0);
      this.requestDraw();
    }
  }

  onContextMenu(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const layers = state.scene?.layers || [];
    const totalDuration = state.scene?.durationMs || 10000;
    let clickedLayer = null;

    layers.forEach((layer, i) => {
      const trackY = RULER_H + i * (TRACK_H + TRACK_GAP);
      if (y >= trackY && y <= trackY + TRACK_H) {
        const x1 = this.timeToX(layer.at || 0);
        const x2 = this.timeToX((layer.at || 0) + (layer.duration || (totalDuration - (layer.at || 0))));
        if (x >= x1 && x <= x2) clickedLayer = layer;
      }
    });

    this.showContextMenu(e.clientX, e.clientY, clickedLayer, this.xToTime(x));
  }

  showContextMenu(clientX, clientY, layer, atMs) {
    this.dismissContextMenu();

    const items = [];
    if (layer) {
      items.push({
        label: `Duplicate "${layer.id}"`,
        onClick: () => {
          if (window.__mf_duplicateLayer) window.__mf_duplicateLayer(layer);
        },
      });
      items.push({
        label: layer._locked ? 'Unlock Layer' : 'Lock Layer',
        onClick: () => {
          store.mutateScene((scene) => {
            const l = scene.layers.find(x => x.id === layer.id);
            if (l) l._locked = !l._locked;
          }, `${layer._locked ? 'Unlock' : 'Lock'} ${layer.id}`);
        },
      });
      items.push({
        label: layer._hidden ? 'Show Layer' : 'Hide Layer',
        onClick: () => {
          store.mutateScene((scene) => {
            const l = scene.layers.find(x => x.id === layer.id);
            if (l) l._hidden = !l._hidden;
          }, `${layer._hidden ? 'Show' : 'Hide'} ${layer.id}`);
        },
      });
      items.push({
        label: 'Jump Playhead to Layer Start',
        onClick: () => store.setPlayhead(layer.at || 0),
      });
      items.push({
        label: 'Delete Layer',
        danger: true,
        onClick: () => {
          if (window.__mf_deleteLayer) window.__mf_deleteLayer(layer.id);
        },
      });
    } else {
      items.push({
        label: `Add SFX Cue here (${Math.round(atMs)}ms)`,
        onClick: () => {
          store.mutateScene((scene) => {
            if (!scene.audio) scene.audio = { cues: [] };
            if (!scene.audio.cues) scene.audio.cues = [];
            scene.audio.cues.push({ sfx: 'whoosh', at: Math.round(atMs), gain: 1 });
          }, `Add SFX at ${Math.round(atMs)}ms`);
          toast.success('SFX Added', `Placed cue at ${Math.round(atMs)}ms`);
        },
      });
      items.push({
        label: 'Move Playhead Here',
        onClick: () => store.setPlayhead(atMs),
      });
    }

    this.contextMenu = h('div', { class: 'mf-context-menu' });
    items.forEach((item) => {
      const row = h(
        'div',
        {
          class: `mf-context-item ${item.danger ? 'danger' : ''}`,
          onClick: () => {
            this.dismissContextMenu();
            item.onClick();
          },
        },
        item.label
      );
      this.contextMenu.appendChild(row);
    });

    document.body.appendChild(this.contextMenu);

    // Position menu
    let top = clientY;
    let left = clientX;
    if (left + 220 > window.innerWidth) left = window.innerWidth - 230;
    if (top + 200 > window.innerHeight) top = window.innerHeight - 210;

    this.contextMenu.style.top = `${top}px`;
    this.contextMenu.style.left = `${left}px`;
  }

  dismissContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
  }

  requestDraw() {
    requestAnimationFrame(() => this.draw());
  }

  draw() {
    if (!this.canvas || !this.ctx) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    this.ctx.clearRect(0, 0, w, h);

    // 1. Background
    this.ctx.fillStyle = '#0a0a0f';
    this.ctx.fillRect(0, 0, w, h);

    // 2. Ruler Header
    this.ctx.fillStyle = '#101017';
    this.ctx.fillRect(0, 0, w, RULER_H);

    const totalDuration = state.scene?.durationMs || 10000;
    const tickMs = this.calcTickMs(totalDuration / state.zoom);

    this.ctx.font = '11px JetBrains Mono, monospace';
    this.ctx.textBaseline = 'middle';

    const startVisibleMs = Math.max(0, this.xToTime(0));
    const endVisibleMs = Math.min(totalDuration, this.xToTime(w));

    // Render ruler ticks
    const firstTick = Math.floor(startVisibleMs / tickMs) * tickMs;
    for (let t = firstTick; t <= endVisibleMs + tickMs; t += tickMs) {
      const x = this.timeToX(t);
      if (x < -50 || x > w + 50) continue;

      this.ctx.fillStyle = '#52525b';
      this.ctx.fillRect(x, RULER_H - 6, 1, 6);

      // Grid line extending down tracks
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
      this.ctx.fillRect(x, RULER_H, 1, h - RULER_H);

      if (t % (tickMs * 2) === 0 || tickMs >= 1000) {
        this.ctx.fillStyle = '#a1a1aa';
        this.ctx.fillText((t / 1000).toFixed(1) + 's', x + 4, RULER_H / 2);
      }
    }

    // 3. Render Layers
    const layers = state.scene?.layers || [];
    layers.forEach((layer, i) => {
      const trackY = RULER_H + i * (TRACK_H + TRACK_GAP);
      if (trackY + TRACK_H > h - AUDIO_TRACK_H) return;

      const color = getLayerColor(layer.type);
      const start = layer.at || 0;
      const dur = layer.duration || (totalDuration - start);
      const x1 = this.timeToX(start);
      const x2 = this.timeToX(start + dur);
      const isSelected = state.selectedLayerIds?.includes(layer.id) || state.selectedLayerId === layer.id;

      // Track row highlight
      this.ctx.fillStyle = isSelected ? 'rgba(245, 158, 11, 0.08)' : 'rgba(255, 255, 255, 0.01)';
      this.ctx.fillRect(0, trackY, w, TRACK_H);

      // Layer bar
      if (x2 > x1) {
        const barAlpha = layer._hidden ? '15' : '35';
        this.ctx.fillStyle = color + barAlpha;
        this.ctx.fillRect(x1, trackY + 2, x2 - x1, TRACK_H - 4);

        this.ctx.strokeStyle = isSelected ? color : color + (layer._hidden ? '55' : 'AA');
        this.ctx.lineWidth = isSelected ? 1.5 : 1;
        this.ctx.strokeRect(x1 + 0.5, trackY + 2.5, x2 - x1 - 1, TRACK_H - 5);

        // Accent pill on left edge
        this.ctx.fillStyle = color;
        this.ctx.fillRect(x1, trackY + 2, 3, TRACK_H - 4);

        // Label
        this.ctx.fillStyle = layer._hidden ? '#52525b' : '#f1f5f9';
        this.ctx.font = '11px Inter, sans-serif';
        const label = `${layer.id}${layer._locked ? ' 🔒' : ''}`;
        const maxW = x2 - x1 - 12;
        if (maxW > 20) {
          this.ctx.save();
          this.ctx.beginPath();
          this.ctx.rect(x1 + 6, trackY + 2, maxW, TRACK_H - 4);
          this.ctx.clip();
          this.ctx.fillText(label, x1 + 8, trackY + TRACK_H / 2);
          this.ctx.restore();
        }
      }

      // Keyframes
      this.drawDiamond(layer.entrance, start, color, trackY);
      if (layer.emphasis) this.drawDiamond(layer.emphasis, start + (layer.emphasis.delayMs || 0), color, trackY);
      if (layer.exit) this.drawDiamond(layer.exit, start + dur - 500, color, trackY);
    });

    // 4. Audio SFX Track (if audio cues exist)
    const audioY = h - AUDIO_TRACK_H;
    this.ctx.fillStyle = '#101017';
    this.ctx.fillRect(0, audioY, w, AUDIO_TRACK_H);
    this.ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    this.ctx.strokeRect(0, audioY, w, 1);

    this.ctx.fillStyle = '#52525b';
    this.ctx.font = '10px JetBrains Mono, monospace';
    this.ctx.fillText('AUDIO', 8, audioY + AUDIO_TRACK_H / 2);

    const audioCues = state.scene?.audio?.cues || [];
    audioCues.forEach((cue) => {
      const cueX = this.timeToX(cue.at || 0);
      if (cueX >= 0 && cueX <= w) {
        this.ctx.fillStyle = '#14b8a6';
        this.ctx.beginPath();
        this.ctx.arc(cueX, audioY + AUDIO_TRACK_H / 2, 5, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.strokeStyle = '#0a0a0f';
        this.ctx.stroke();
      }
    });

    // 5. Playhead
    const px = this.timeToX(state.playhead);
    this.ctx.strokeStyle = '#f59e0b';
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.moveTo(px, 0);
    this.ctx.lineTo(px, h);
    this.ctx.stroke();

    // Playhead arrow cap
    this.ctx.fillStyle = '#f59e0b';
    this.ctx.beginPath();
    this.ctx.moveTo(px - 7, 0);
    this.ctx.lineTo(px + 7, 0);
    this.ctx.lineTo(px, 10);
    this.ctx.closePath();
    this.ctx.fill();

    // Empty state if no layers
    if (!layers.length) {
      this.ctx.fillStyle = '#52525b';
      this.ctx.font = '13px Inter, sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('No layers — load a scene or add a layer', w / 2, (h - RULER_H) / 2);
      this.ctx.textAlign = 'left';
    }
  }

  drawDiamond(preset, atMs, color, trackY) {
    if (!preset) return;
    const x = this.timeToX(atMs);
    const y = trackY + TRACK_H / 2;

    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.moveTo(x, y - 4);
    this.ctx.lineTo(x + 4, y);
    this.ctx.lineTo(x, y + 4);
    this.ctx.lineTo(x - 4, y);
    this.ctx.closePath();
    this.ctx.fill();

    this.ctx.strokeStyle = '#0a0a0f';
    this.ctx.lineWidth = 1;
    this.ctx.stroke();
  }

  calcTickMs(visibleDurationMs) {
    const targets = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
    for (const t of targets) {
      if (visibleDurationMs / t <= 20) return t;
    }
    return 10000;
  }
}

export const timelinePanel = new TimelinePanel();
