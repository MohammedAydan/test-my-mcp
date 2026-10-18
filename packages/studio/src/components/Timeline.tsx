import { Component, onMount, onCleanup, createEffect } from 'solid-js';
import { store } from '../store.js';
import { getLayerColor } from './LayersPanel.js';
import type { StudioLayer } from '../types.js';

const RULER_H = 26;
const TRACK_H = 28;
const TRACK_GAP = 6;

export const Timeline: Component = () => {
  const state = store.state;
  let canvasRef: HTMLCanvasElement | undefined;
  let ctx: CanvasRenderingContext2D | null = null;

  let isDraggingPlayhead = false;
  let isPanning = false;
  let panStartX = 0;
  let initialPanOffset = 0;

  let dragMode: 'move' | 'trim-left' | 'trim-right' | null = null;
  let dragLayer: StudioLayer | null = null;
  let dragStartMouseX = 0;
  let dragInitialAt = 0;
  let dragInitialDuration = 0;
  const edgeHoverZone = 6;

  const totalDuration = () => state.scene?.durationMs || 10000;

  const timeToX = (ms: number) => {
    if (!canvasRef) return 0;
    const w = canvasRef.clientWidth;
    const pxPerMs = (w * state.zoom) / totalDuration();
    return ms * pxPerMs + state.panOffset;
  };

  const xToTime = (x: number) => {
    if (!canvasRef) return 0;
    const w = canvasRef.clientWidth;
    const pxPerMs = (w * state.zoom) / totalDuration();
    const rawMs = (x - state.panOffset) / pxPerMs;

    if (!state.snapEnabled) {
      return Math.max(0, Math.min(rawMs, totalDuration()));
    }

    let snapped = Math.round(rawMs / 100) * 100;
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
    return Math.max(0, Math.min(snapped, totalDuration()));
  };

  const calcTickMs = (visibleMs: number) => {
    if (visibleMs <= 2000) return 200;
    if (visibleMs <= 5000) return 500;
    if (visibleMs <= 10000) return 1000;
    if (visibleMs <= 30000) return 2000;
    return 5000;
  };

  const draw = () => {
    if (!canvasRef || !ctx) return;
    const w = canvasRef.clientWidth;
    const h = canvasRef.clientHeight;

    ctx.clearRect(0, 0, w, h);

    // 1. Background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, w, h);

    // 2. Ruler Header
    ctx.fillStyle = '#101017';
    ctx.fillRect(0, 0, w, RULER_H);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(0, RULER_H - 1, w, 1);

    const dur = totalDuration();
    const tickMs = calcTickMs(dur / state.zoom);

    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textBaseline = 'middle';

    const startVisibleMs = Math.max(0, xToTime(0));
    const endVisibleMs = Math.min(dur, xToTime(w));

    const firstTick = Math.floor(startVisibleMs / tickMs) * tickMs;
    for (let t = firstTick; t <= endVisibleMs + tickMs; t += tickMs) {
      const x = timeToX(t);
      if (x < -50 || x > w + 50) continue;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(x, RULER_H - 8, 1, 8);

      ctx.fillStyle = '#a1a1aa';
      ctx.fillText(`${(t / 1000).toFixed(1)}s`, x + 4, RULER_H / 2);
    }

    // 3. Tracks & Layer Bars
    const layers = state.scene?.layers || [];
    layers.forEach((layer, i) => {
      const trackY = RULER_H + i * (TRACK_H + TRACK_GAP) + 6;
      const x1 = timeToX(layer.at || 0);
      const layerDur = layer.duration || dur - (layer.at || 0);
      const x2 = timeToX((layer.at || 0) + layerDur);
      const barW = Math.max(4, x2 - x1);

      // Track background lane
      ctx!.fillStyle = 'rgba(255, 255, 255, 0.02)';
      ctx!.fillRect(0, trackY - 2, w, TRACK_H);

      const isSelected =
        state.selectedLayerIds.includes(layer.id) || state.selectedLayerId === layer.id;
      const baseColor = getLayerColor(layer.type);

      // Layer bar fill
      ctx!.fillStyle = isSelected ? baseColor : 'rgba(255, 255, 255, 0.08)';
      ctx!.fillRect(x1, trackY, barW, TRACK_H - 4);

      // Layer bar border
      if (isSelected) {
        ctx!.strokeStyle = '#f59e0b';
        ctx!.lineWidth = 1.5;
        ctx!.strokeRect(x1, trackY, barW, TRACK_H - 4);
      } else {
        ctx!.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx!.lineWidth = 1;
        ctx!.strokeRect(x1, trackY, barW, TRACK_H - 4);
      }

      // Layer label inside bar
      if (barW > 30) {
        ctx!.fillStyle = isSelected ? '#0a0a0f' : '#f1f5f9';
        ctx!.font = '600 11px Inter, sans-serif';
        ctx!.fillText(layer.id || layer.type, x1 + 8, trackY + (TRACK_H - 4) / 2);
      }
    });

    // 4. Playhead Line & Scrubber Needle
    const playheadX = timeToX(state.playhead);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, h);
    ctx.stroke();

    // Needle head in ruler
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(playheadX - 6, 0);
    ctx.lineTo(playheadX + 6, 0);
    ctx.lineTo(playheadX + 6, RULER_H - 6);
    ctx.lineTo(playheadX, RULER_H);
    ctx.lineTo(playheadX - 6, RULER_H - 6);
    ctx.closePath();
    ctx.fill();
  };

  createEffect(() => {
    // Re-draw when relevant state changes
    state.playhead;
    state.zoom;
    state.panOffset;
    state.scene;
    state.selectedLayerId;
    state.selectedLayerIds.length;
    requestAnimationFrame(draw);
  });

  const resize = () => {
    if (!canvasRef) return;
    const rect = canvasRef.parentElement?.getBoundingClientRect();
    if (!rect) return;
    canvasRef.width = rect.width * window.devicePixelRatio;
    canvasRef.height = rect.height * window.devicePixelRatio;
    ctx = canvasRef.getContext('2d');
    ctx?.scale(window.devicePixelRatio, window.devicePixelRatio);
    draw();
  };

  onMount(() => {
    resize();
    window.addEventListener('resize', resize);

    const onMouseDown = (e: MouseEvent) => {
      if (!canvasRef) return;
      const rect = canvasRef.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (e.button === 1 || e.shiftKey && e.altKey) {
        e.preventDefault();
        isPanning = true;
        panStartX = e.clientX;
        initialPanOffset = state.panOffset;
        return;
      }

      if (e.button !== 0) return;

      if (y <= RULER_H) {
        isDraggingPlayhead = true;
        store.setPlayhead(xToTime(x));
        return;
      }

      const layers = state.scene?.layers || [];
      let clickedLayer: StudioLayer | null = null;
      let hitEdge: 'left' | 'right' | null = null;

      layers.forEach((layer, i) => {
        const trackY = RULER_H + i * (TRACK_H + TRACK_GAP) + 6;
        if (y >= trackY && y <= trackY + TRACK_H) {
          const x1 = timeToX(layer.at || 0);
          const x2 = timeToX((layer.at || 0) + (layer.duration || (totalDuration() - (layer.at || 0))));
          if (x >= x1 - 4 && x <= x2 + 4) {
            clickedLayer = layer;
            if (Math.abs(x - x1) <= edgeHoverZone) {
              hitEdge = 'left';
            } else if (Math.abs(x - x2) <= edgeHoverZone) {
              hitEdge = 'right';
            }
          }
        }
      });

      if (clickedLayer) {
        const isMulti = e.shiftKey || e.ctrlKey || e.metaKey;
        store.selectLayer(clickedLayer.id, isMulti);

        if (!clickedLayer._locked) {
          dragLayer = clickedLayer;
          dragStartMouseX = x;
          dragInitialAt = clickedLayer.at || 0;
          dragInitialDuration = clickedLayer.duration || 3000;
          dragMode = hitEdge === 'left' ? 'trim-left' : hitEdge === 'right' ? 'trim-right' : 'move';
        }
      } else {
        isDraggingPlayhead = true;
        store.setPlayhead(xToTime(x));
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!canvasRef) return;
      const rect = canvasRef.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (isPanning) {
        const deltaX = e.clientX - panStartX;
        store.setPanOffset(initialPanOffset + deltaX);
        return;
      }

      if (isDraggingPlayhead) {
        store.setPlayhead(xToTime(x));
        return;
      }

      if (dragMode && dragLayer) {
        const currentMs = xToTime(x);
        const startMs = xToTime(dragStartMouseX);
        const deltaMs = Math.round(currentMs - startMs);

        store.mutateScene((scene) => {
          const l = scene.layers.find((lyr) => lyr.id === dragLayer!.id);
          if (!l) return;
          if (dragMode === 'move') {
            l.at = Math.max(0, dragInitialAt + deltaMs);
          } else if (dragMode === 'trim-left') {
            const newAt = Math.max(0, dragInitialAt + deltaMs);
            const maxAt = dragInitialAt + dragInitialDuration - 100;
            const clampedAt = Math.min(newAt, maxAt);
            l.duration = dragInitialDuration - (clampedAt - dragInitialAt);
            l.at = clampedAt;
          } else if (dragMode === 'trim-right') {
            l.duration = Math.max(100, dragInitialDuration + deltaMs);
          }
        }, `Adjust ${dragLayer.id}`);
        return;
      }

      // Cursor update
      if (y <= RULER_H) {
        canvasRef.style.cursor = 'ew-resize';
        return;
      }
      canvasRef.style.cursor = 'crosshair';
    };

    const onMouseUp = () => {
      isDraggingPlayhead = false;
      isPanning = false;
      dragMode = null;
      dragLayer = null;
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (!canvasRef) return;
        const rect = canvasRef.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const timeAtMouse = xToTime(mouseX);
        const factor = e.deltaY < 0 ? 1.15 : 0.85;
        const nextZoom = Math.max(0.5, Math.min(8, state.zoom * factor));
        store.setZoom(nextZoom);
        const newXAtTime = timeToX(timeAtMouse);
        store.setPanOffset(state.panOffset + (mouseX - newXAtTime));
      } else {
        e.preventDefault();
        store.setPanOffset(state.panOffset - (e.deltaX || (e.shiftKey ? e.deltaY : 0)));
      }
    };

    canvasRef.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvasRef.addEventListener('wheel', onWheel, { passive: false });

    onCleanup(() => {
      window.removeEventListener('resize', resize);
      canvasRef?.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvasRef?.removeEventListener('wheel', onWheel);
    });
  });

  const timelineInfo = () => {
    const dur = totalDuration();
    const visibleDur = (dur / state.zoom / 1000).toFixed(1);
    return `${Math.round(state.zoom * 100)}% · ${visibleDur}s visible`;
  };

  return (
    <section class="timeline-area" aria-label="Interactive timeline">
      <div class="timeline-toolbar">
        <div class="timeline-tools">
          <button
            class="tool-btn"
            id="btn-fit"
            data-tooltip="Fit timeline duration to window"
            onClick={() => {
              store.setZoom(1);
              store.setPanOffset(0);
            }}
          >
            Fit
          </button>
          <button
            class={`tool-btn ${state.snapEnabled ? 'active' : ''}`}
            id="btn-snap"
            data-tooltip="Magnetic 100ms and keyframe snap"
            onClick={() => store.setSnapEnabled(!state.snapEnabled)}
          >
            {state.snapEnabled ? 'Snap: ON' : 'Snap: OFF'}
          </button>
        </div>
        <div class="timeline-sep"></div>
        <div class="timeline-center">
          <span class="timeline-hint">Scrub ruler to seek · Ctrl+Wheel to zoom · Drag edges to trim</span>
        </div>
        <div class="timeline-tools">
          <span class="timeline-info" id="timeline-info">
            {timelineInfo()}
          </span>
        </div>
      </div>
      <div class="timeline-canvas-wrap">
        <canvas
          ref={canvasRef}
          id="timeline-canvas"
          role="slider"
          aria-label="Timeline scrubber"
          aria-valuemin={0}
          aria-valuemax={totalDuration()}
          aria-valuenow={state.playhead}
        />
      </div>
    </section>
  );
};
