import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { store } from '../../state/store.js';
import type { StudioLayer } from '../../types.js';
import { formatTimecode } from '../../state/timecode.js';
import { AudioVuMeter } from './AudioVuMeter.js';
import { readAssetPayload } from '../../services/drag-payload.js';
import { layerKindColor } from '../hierarchy/LayerStackPanel.js';
import {
  IconEye,
  IconEyeOff,
  IconLock,
  IconMagnet,
  IconMute,
  IconPlus,
  IconRazor,
  IconSolo,
  IconUnlock,
  IconWaveform,
  IconZoomIn,
  IconZoomOut,
} from '../icons/NleIcons.js';

/**
 * The multi-track NLE timeline.
 *
 * Everything is drawn on ONE high-DPI canvas, because that is what a
 * professional timeline is: a dense, continuous surface where the eye
 * tracks clips, not a DOM list.
 *
 * The geometry has exactly one source of truth — `zoom`, `panOffset` and
 * `timelineScrollY` in the store — so the ruler, the clips, the playhead and
 * the drop targets can never disagree.
 */

const RULER_H = 28;
const TRACK_H = 28;
const SUBTRACK_H = 20;
const TRACK_GAP = 3;
const EDGE_ZONE = 6;

interface Track {
  index: number;
  name: string;
  kind: 'video' | 'audio';
  layers: StudioLayer[];
  y: number;
  h: number;
}

interface ClipBox {
  layer: StudioLayer;
  x: number;
  w: number;
  y: number;
  h: number;
  trackIndex: number;
  isAudio: boolean;
}

const FPS = 30;

export const TimelinePanel: Component = () => {
  const state = store.state;
  let canvasRef: HTMLCanvasElement | undefined;
  let ctx: CanvasRenderingContext2D | null = null;
  let scrollRef: HTMLDivElement | undefined;

  const [isDragOver, setIsDragOver] = createSignal(false);
  const [dropTime, setDropTime] = createSignal<number | null>(null);
  const [razorX, setRazorX] = createSignal<number | null>(null);

  let dragMode: 'move' | 'trim-left' | 'trim-right' | 'keyframe' | null = null;
  let dragLayer: StudioLayer | null = null;
  let dragStartX = 0;
  let dragInitialAt = 0;
  let dragInitialDuration = 0;
  let hasDragged = false;
  let tooltip: { x: number; y: number; text: string } | null = null;
  let isPanning = false;
  let panStartX = 0;
  let initialPan = 0;

  const totalDuration = () => state.scene?.durationMs ?? 10000;

  /* ── time <-> x ──────────────────────────────────────────────────────── */

  const pxPerMs = () => {
    if (!canvasRef) return 0.1;
    return (canvasRef.clientWidth * state.zoom) / totalDuration();
  };

  const timeToX = (ms: number) => ms * pxPerMs() + state.panOffset;

  const xToTime = (x: number) => {
    const raw = (x - state.panOffset) / pxPerMs();
    if (!state.snapEnabled) return Math.max(0, Math.min(raw, totalDuration()));

    const candidates: number[] = [
      state.playhead,
      state.inPoint ?? -1,
      state.outPoint ?? -1,
      0,
      totalDuration(),
    ];
    for (const layer of state.scene?.layers ?? []) {
      candidates.push(layer.at ?? 0);
      candidates.push((layer.at ?? 0) + (layer.duration ?? 3000));
    }

    const threshold = 12 / pxPerMs();
    let snapped = Math.round(raw / 100) * 100;
    for (const candidate of candidates) {
      if (candidate >= 0 && Math.abs(raw - candidate) < threshold) {
        snapped = candidate;
        break;
      }
    }
    return Math.max(0, Math.min(snapped, totalDuration()));
  };

  const tickMs = () => {
    const visible = totalDuration() / state.zoom;
    if (visible <= 1000) return 100;
    if (visible <= 2500) return 250;
    if (visible <= 5000) return 500;
    if (visible <= 10000) return 1000;
    if (visible <= 30000) return 2000;
    return 5000;
  };

  /* ── track layout ────────────────────────────────────────────────────── */

  const tracks = createMemo<Track[]>(() => {
    const layers = state.scene?.layers ?? [];
    const byIndex = new Map<number, StudioLayer[]>();

    for (const layer of layers) {
      const index = layer.trackIndex ?? layer.trackLane ?? 0;
      const bucket = byIndex.get(index) ?? [];
      bucket.push(layer);
      byIndex.set(index, bucket);
    }

    const result: Track[] = [];
    for (const [index, bucket] of Array.from(byIndex.entries()).sort((a, b) => a[0] - b[0])) {
      bucket.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
      result.push({ index, name: `V${index + 1}`, kind: 'video', layers: bucket, y: 0, h: TRACK_H });
    }

    const cues = state.scene?.audio?.cues ?? [];
    if (cues.length > 0) {
      result.push({
        index: result.length,
        name: `A1`,
        kind: 'audio',
        layers: [],
        y: 0,
        h: TRACK_H,
      });
    }

    let y = RULER_H + 4;
    for (const track of result) {
      track.y = y;
      y += track.h + TRACK_GAP;
    }
    return result;
  });

  const totalHeight = () => RULER_H + 8 + tracks().length * (TRACK_H + TRACK_GAP) + 40;

  /* ── clip geometry ───────────────────────────────────────────────────── */

  const clipBoxes = createMemo<ClipBox[]>(() => {
    const boxes: ClipBox[] = [];
    for (const track of tracks()) {
      if (track.kind === 'audio') continue;
      for (const layer of track.layers) {
        const start = layer.at ?? 0;
        const duration = layer.duration ?? totalDuration() - start;
        const x1 = timeToX(start);
        const x2 = timeToX(start + duration);
        boxes.push({
          layer,
          x: x1,
          w: Math.max(4, x2 - x1),
          y: track.y,
          h: TRACK_H,
          trackIndex: track.index,
          isAudio: false,
        });
      }
    }
    return boxes;
  });

  const audioCueBoxes = createMemo(() => {
    const audioTrack = tracks().find((t) => t.kind === 'audio');
    if (!audioTrack) return [];
    const durations: Record<string, number> = {
      whoosh: 1200,
      riser: 3000,
      shimmer: 2200,
      pop: 500,
      subImpact: 1800,
      click: 300,
    };
    return (state.scene?.audio?.cues ?? []).map((cue) => {
      const duration = durations[cue.sfx] ?? 1500;
      const x1 = timeToX(cue.at);
      const x2 = timeToX(cue.at + duration);
      return { cue, x: x1, w: Math.max(24, x2 - x1), y: audioTrack.y, h: audioTrack.h };
    });
  });

  /* ── canvas painting ─────────────────────────────────────────────────── */

  const draw = () => {
    if (!canvasRef || !ctx) return;
    const w = canvasRef.clientWidth;
    const h = canvasRef.clientHeight;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#0f1114';
    ctx.fillRect(0, 0, w, h);

    // in / out shading
    if (state.inPoint !== null && state.inPoint > 0) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, RULER_H, timeToX(state.inPoint), h - RULER_H);
    }
    if (state.outPoint !== null && state.outPoint < totalDuration()) {
      const outX = timeToX(state.outPoint);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(outX, RULER_H, w - outX, h - RULER_H);
    }

    // tracks
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, RULER_H, w, Math.max(0, h - RULER_H));
    ctx.clip();
    ctx.translate(0, -state.timelineScrollY);

    for (const track of tracks()) {
      ctx.fillStyle = 'rgba(255,255,255,0.018)';
      ctx.fillRect(0, track.y, w, track.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.moveTo(0, track.y + track.h);
      ctx.lineTo(w, track.y + track.h);
      ctx.stroke();
    }

    for (const box of clipBoxes()) {
      const layer = box.layer;
      const selected =
        state.selectedLayerIds.includes(layer.id) || state.selectedLayerId === layer.id;
      const base = layerKindColor(layer.type);
      const dim = layer.visible === false;

      // clip body
      ctx.fillStyle = dim ? 'rgba(255,255,255,0.04)' : hexToRgba(base, selected ? 0.34 : 0.2);
      ctx.fillRect(box.x, box.y, box.w, box.h - 2);

      // header strip
      ctx.fillStyle = dim ? 'rgba(255,255,255,0.08)' : hexToRgba(base, selected ? 0.95 : 0.62);
      ctx.fillRect(box.x, box.y, box.w, 5);

      // border
      ctx.strokeStyle = selected ? '#2d8ceb' : hexToRgba(base, 0.55);
      ctx.lineWidth = selected ? 1.5 : 1;
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 3);

      // trim handles
      if (selected && box.w > 20) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(box.x + 1, box.y + 7, 2, box.h - 12);
        ctx.fillRect(box.x + box.w - 3, box.y + 7, 2, box.h - 12);
      }

      // label
      if (box.w > 34) {
        ctx.fillStyle = '#e6e9ef';
        ctx.font = '500 10px Inter, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(layer.name ?? layer.id, box.x + 7, box.y + 12);
      }
    }

    // audio clips with waveforms
    for (const box of audioCueBoxes()) {
      ctx.fillStyle = 'rgba(16, 185, 129, 0.16)';
      ctx.fillRect(box.x, box.y + 1, box.w, box.h - 2);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x + 0.5, box.y + 1.5, box.w - 1, box.h - 3);

      const centerY = box.y + box.h / 2 + 2;
      const spacing = 3;
      const bars = Math.floor(box.w / spacing);
      ctx.fillStyle = '#34d399';
      for (let i = 0; i < bars; i++) {
        const progress = bars > 0 ? i / bars : 0;
        const envelope = Math.sin(progress * Math.PI);
        const noise = Math.sin(i * 12.9898 + (box.cue.at % 100)) * 0.5 + 0.5;
        const height = Math.max(
          2,
          box.h * 0.36 * envelope * (0.35 + 0.65 * noise) * (box.cue.gain ?? 1)
        );
        ctx.fillRect(box.x + i * spacing, centerY - height / 2, 1.5, height);
      }

      if (box.w > 34) {
        ctx.fillStyle = '#e6e9ef';
        ctx.font = '500 9px JetBrains Mono, monospace';
        ctx.textBaseline = 'top';
        ctx.fillText(box.cue.sfx, box.x + 5, box.y + 3);
      }
    }

    // razor cut line
    const cutX = razorX();
    if (cutX !== null && state.activeTool === 'razor') {
      ctx.strokeStyle = '#ff4b4b';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(cutX, RULER_H);
      ctx.lineTo(cutX, h);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();

    // ruler
    ctx.fillStyle = '#1a1d23';
    ctx.fillRect(0, 0, w, RULER_H);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, RULER_H - 1, w, 1);

    const step = tickMs();
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textBaseline = 'middle';

    const first = Math.floor(Math.max(0, xToTime(0)) / step) * step;
    const last = Math.min(totalDuration(), xToTime(w));

    for (let t = first; t <= last + step; t += step) {
      const x = timeToX(t);
      if (x < -60 || x > w + 60) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x, RULER_H - 8, 1, 8);
      ctx.fillStyle = '#9aa3b2';
      ctx.fillText(formatTimecode(t, FPS), x + 4, RULER_H / 2 - 2);
    }

    // in / out brackets
    if (state.inPoint !== null) {
      const x = timeToX(state.inPoint);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(x - 1, 0, 3, RULER_H);
      ctx.fillRect(x, RULER_H - 4, 8, 4);
    }
    if (state.outPoint !== null) {
      const x = timeToX(state.outPoint);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(x - 2, 0, 3, RULER_H);
      ctx.fillRect(x - 8, RULER_H - 4, 8, 4);
    }

    // playhead
    const playheadX = timeToX(state.playhead);
    ctx.strokeStyle = '#ff4b4b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, h);
    ctx.stroke();

    ctx.fillStyle = '#ff4b4b';
    ctx.beginPath();
    ctx.moveTo(playheadX - 6, 0);
    ctx.lineTo(playheadX + 6, 0);
    ctx.lineTo(playheadX + 6, RULER_H - 6);
    ctx.lineTo(playheadX, RULER_H);
    ctx.lineTo(playheadX - 6, RULER_H - 6);
    ctx.closePath();
    ctx.fill();

    // drag tooltip
    if (tooltip) {
      ctx.font = '600 10px JetBrains Mono, monospace';
      const width = ctx.measureText(tooltip.text).width + 14;
      const x = Math.max(6, Math.min(w - width - 6, tooltip.x - width / 2));
      const y = Math.max(RULER_H + 4, tooltip.y - 26);
      ctx.fillStyle = '#20242c';
      ctx.strokeStyle = '#2d8ceb';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(x, y, width, 20);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#8cc2ff';
      ctx.textBaseline = 'middle';
      ctx.fillText(tooltip.text, x + 7, y + 10);
    }
  };

  createEffect(() => {
    state.playhead;
    state.zoom;
    state.panOffset;
    state.timelineScrollY;
    state.scene;
    state.selectedLayerId;
    state.selectedLayerIds.length;
    state.inPoint;
    state.outPoint;
    state.snapEnabled;
    state.activeTool;
    requestAnimationFrame(draw);
  });

  const resize = () => {
    if (!canvasRef) return;
    const rect = canvasRef.parentElement?.getBoundingClientRect();
    if (!rect) return;
    canvasRef.width = Math.max(1, rect.width * window.devicePixelRatio);
    canvasRef.height = Math.max(1, rect.height * window.devicePixelRatio);
    ctx = canvasRef.getContext('2d');
    ctx?.scale(window.devicePixelRatio, window.devicePixelRatio);
    draw();
  };

  onMount(() => {
    resize();
    window.addEventListener('resize', resize);

    const handleKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const key = event.key.toLowerCase();

      if (event.ctrlKey || event.metaKey) {
        if (key === 'k') {
          event.preventDefault();
          store.razorSplitAtPlayhead();
        }
        return;
      }

      if (key === 'l') {
        const rate =
          state.playing && state.playbackRate >= 1
            ? state.playbackRate === 1
              ? 2
              : state.playbackRate === 2
              ? 4
              : 1
            : 1;
        store.setPlaybackRate(rate);
        store.setPlaying(true);
      } else if (key === 'k') {
        store.setPlaying(false);
        store.setPlaybackRate(1);
      } else if (key === 'j') {
        const rate =
          state.playing && state.playbackRate <= -1
            ? state.playbackRate === -1
              ? -2
              : state.playbackRate === -2
              ? -4
              : -1
            : -1;
        store.setPlaybackRate(rate);
        store.setPlaying(true);
      } else if (key === 'i') {
        store.setInPoint(state.playhead);
      } else if (key === 'o') {
        store.setOutPoint(state.playhead);
      } else if (key === 'x') {
        const selected = state.scene?.layers?.find((l) => l.id === state.selectedLayerId);
        if (selected) {
          const at = selected.at ?? 0;
          store.setInPoint(at);
          store.setOutPoint(at + (selected.duration ?? 3000));
        }
      } else if (event.shiftKey && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        store.rippleDeleteSelected();
      } else if (event.key === 'Home') {
        event.preventDefault();
        store.setPlayhead(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        store.setPlayhead(totalDuration());
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        store.setPlayhead(state.playhead - (event.shiftKey ? 1000 : 1000 / FPS));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        store.setPlayhead(state.playhead + (event.shiftKey ? 1000 : 1000 / FPS));
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    const onMouseDown = (event: MouseEvent) => {
      if (!canvasRef) return;
      const rect = canvasRef.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      if (y <= RULER_H) {
        store.setPlayhead(xToTime(x));
        return;
      }

      if (event.button === 1 || event.altKey) {
        isPanning = true;
        panStartX = event.clientX;
        initialPan = state.panOffset;
        return;
      }

      const unshiftedY = y + state.timelineScrollY;

      // razor tool: split the clip under the pointer
      if (state.activeTool === 'razor') {
        for (const box of clipBoxes()) {
          if (unshiftedY < box.y || unshiftedY > box.y + box.h) continue;
          if (x < box.x || x > box.x + box.w) continue;
          const at = xToTime(x);
          if (store.razorSplitLayerAt(box.layer.id, at)) {
            store.addToast(`Split ${box.layer.name ?? box.layer.id} at ${formatTimecode(at, FPS)}`, 'success');
          }
          return;
        }
        return;
      }

      for (const box of clipBoxes()) {
        if (unshiftedY < box.y || unshiftedY > box.y + box.h) continue;
        const x1 = timeToX(box.layer.at ?? 0);
        const x2 = timeToX((box.layer.at ?? 0) + (box.layer.duration ?? 3000));
        if (x < x1 - EDGE_ZONE || x > x2 + EDGE_ZONE) continue;

        const isMulti = event.shiftKey || event.ctrlKey || event.metaKey;
        store.selectLayer(box.layer.id, isMulti);

        hasDragged = false;
        dragLayer = box.layer;
        dragStartX = event.clientX;
        dragInitialAt = box.layer.at ?? 0;
        dragInitialDuration = box.layer.duration ?? totalDuration() - dragInitialAt;

        if (Math.abs(x - x1) <= EDGE_ZONE) dragMode = 'trim-left';
        else if (Math.abs(x - x2) <= EDGE_ZONE) dragMode = 'trim-right';
        else dragMode = 'move';
        return;
      }

      store.setPlayhead(xToTime(x));
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!canvasRef) return;
      const rect = canvasRef.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      if (isPanning) {
        store.setPanOffset(initialPan + (event.clientX - panStartX));
        return;
      }

      // razor hover line
      if (state.activeTool === 'razor') {
        const unshiftedY = y + state.timelineScrollY;
        const over = clipBoxes().some(
          (box) =>
            unshiftedY >= box.y &&
            unshiftedY <= box.y + box.h &&
            x >= box.x &&
            x <= box.x + box.w
        );
        setRazorX(over ? x : null);
        if (canvasRef) canvasRef.style.cursor = over ? 'col-resize' : 'default';
      }

      if (dragMode && dragLayer) {
        const dx = event.clientX - dragStartX;
        if (!hasDragged) {
          if (Math.abs(dx) < 2) return;
          hasDragged = true;
          store.pushHistory(`Timeline edit: ${dragMode}`);
        }

        const deltaMs = Math.round(dx / pxPerMs());

        // collision clamping against the other clips on the same track
        let minBoundary = 0;
        let maxBoundary = totalDuration();
        const track = tracks().find((t) => t.layers.some((l) => l.id === dragLayer!.id));
        if (track) {
          for (const other of track.layers) {
            if (other.id === dragLayer.id) continue;
            const otherAt = other.at ?? 0;
            const otherEnd = otherAt + (other.duration ?? totalDuration() - otherAt);
            if (otherAt < dragInitialAt) {
              minBoundary = Math.max(minBoundary, otherEnd);
            } else if (otherAt > dragInitialAt) {
              maxBoundary = Math.min(maxBoundary, otherAt);
            }
          }
        }

        if (dragMode === 'move') {
          const maxAt = Math.max(minBoundary, maxBoundary - dragInitialDuration);
          const newAt = Math.max(minBoundary, Math.min(maxAt, dragInitialAt + deltaMs));
          store.patchLayer(dragLayer.id, { at: newAt });
          tooltip = {
            x,
            y,
            text: `${deltaMs >= 0 ? '+' : ''}${deltaMs}ms (${(newAt / 1000).toFixed(2)}s)`,
          };
        } else if (dragMode === 'trim-left') {
          const maxAt = dragInitialAt + dragInitialDuration - 100;
          const newAt = Math.max(minBoundary, Math.min(maxAt, dragInitialAt + deltaMs));
          const newDuration = dragInitialAt + dragInitialDuration - newAt;
          store.patchLayer(dragLayer.id, { at: newAt, duration: newDuration });
          tooltip = {
            x,
            y,
            text: `In ${(newAt / 1000).toFixed(2)}s (+${deltaMs}ms)`,
          };
        } else if (dragMode === 'trim-right') {
          const maxDuration = Math.max(100, maxBoundary - dragInitialAt);
          const newDuration = Math.max(100, Math.min(maxDuration, dragInitialDuration + deltaMs));
          store.patchLayer(dragLayer.id, { duration: newDuration });
          tooltip = {
            x,
            y,
            text: `Out ${((dragInitialAt + newDuration) / 1000).toFixed(2)}s (+${deltaMs}ms)`,
          };
        }
        return;
      }

      if (y <= RULER_H) {
        if (canvasRef) canvasRef.style.cursor = 'pointer';
        return;
      }

      const unshiftedY = y + state.timelineScrollY;
      let cursor = state.activeTool === 'razor' ? 'col-resize' : 'default';
      for (const box of clipBoxes()) {
        if (unshiftedY < box.y || unshiftedY > box.y + box.h) continue;
        const x1 = timeToX(box.layer.at ?? 0);
        const x2 = timeToX((box.layer.at ?? 0) + (box.layer.duration ?? 3000));
        if (Math.abs(x - x1) <= EDGE_ZONE || Math.abs(x - x2) <= EDGE_ZONE) {
          cursor = 'col-resize';
        } else if (x >= x1 && x <= x2) {
          cursor = 'move';
        }
        break;
      }
      if (canvasRef) canvasRef.style.cursor = cursor;
    };

    const onMouseUp = () => {
      if (hasDragged && dragMode) {
        // ONE atomic save for the whole gesture
        void store.executeSave();
      }
      hasDragged = false;
      tooltip = null;
      isPanning = false;
      dragMode = null;
      dragLayer = null;
    };

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        if (!canvasRef) return;
        const rect = canvasRef.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const timeAtMouse = xToTime(mouseX);
        const factor = event.deltaY < 0 ? 1.15 : 0.85;
        store.setZoom(state.zoom * factor);
        const newX = timeToX(timeAtMouse);
        store.setPanOffset(state.panOffset + (mouseX - newX));
      } else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault();
        store.setPanOffset(state.panOffset - (event.deltaX || event.deltaY));
      } else {
        event.preventDefault();
        const visible = (canvasRef?.clientHeight ?? 200) - RULER_H;
        const maxScroll = Math.max(0, totalHeight() - visible);
        store.setTimelineScrollY(state.timelineScrollY + event.deltaY);
      }
    };

    canvasRef?.addEventListener('mousedown', onMouseDown);
    canvasRef?.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    onCleanup(() => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', handleKeyDown);
      canvasRef?.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvasRef?.removeEventListener('wheel', onWheel);
    });
  });

  /* ── drag & drop from the project bin ────────────────────────────────── */

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    if (canvasRef) {
      const rect = canvasRef.getBoundingClientRect();
      setDropTime(Math.max(0, Math.min(totalDuration(), Math.round(xToTime(event.clientX - rect.left)))));
    }
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    setDropTime(null);

    if (!state.scene) {
      store.addToast('Load a composition before dropping assets', 'warning');
      return;
    }
    if (!canvasRef) return;
    const rect = canvasRef.getBoundingClientRect();
    const at = Math.max(0, Math.min(totalDuration(), Math.round(xToTime(event.clientX - rect.left))));

    const payload = readAssetPayload(event);
    if (!payload) {
      store.addToast('Unrecognized asset dropped onto the timeline', 'warning');
      return;
    }

    if (payload.kind === 'audio') {
      const valid = ['whoosh', 'pop', 'click', 'subImpact', 'shimmer', 'riser'];
      const sfx = valid.includes(payload.assetId) ? payload.assetId : 'pop';
      store.mutateScene((scene) => {
        if (!scene.audio) scene.audio = { cues: [] };
        const cues = scene.audio.cues ?? [];
        cues.push({ id: `cue-${Math.random().toString(36).slice(2, 7)}`, at, sfx: sfx as never, gain: 1, pan: 0 });
        scene.audio.cues = cues;
      }, `Add audio cue "${sfx}" at ${at}ms`);
      store.addToast(`Added audio cue "${sfx}" at ${formatTimecode(at, FPS)}`, 'success');
      void store.executeSave();
      return;
    }

    const layerId = `${payload.kind}-${Math.random().toString(36).slice(2, 7)}`;
    store.mutateScene((scene) => {
      if (!scene.assets) scene.assets = [];
      if (!scene.assets.some((a) => a.id === payload.assetId)) {
        scene.assets.push({
          id: payload.assetId,
          kind: (payload.kind === 'lottie' ? 'lottie' : 'image') as never,
          src: payload.src ?? '',
          name: payload.name,
        });
      }
      scene.layers.push({
        id: layerId,
        name: payload.name ?? layerId,
        type: payload.kind === 'lottie' ? 'lottie' : 'imageLogo',
        assetId: payload.assetId,
        widthPx: 300,
        position: { xPct: 50, yPct: 50 },
        at,
        duration: 3000,
      });
    }, `Drop ${payload.name ?? payload.assetId} at ${at}ms`);
    store.selectLayer(layerId);
    store.addToast(`Added ${payload.name ?? payload.assetId} at ${formatTimecode(at, FPS)}`, 'success');
    void store.executeSave();
  };

  /* ── toolbar actions ─────────────────────────────────────────────────── */

  const addVideoTrack = () => {
    const layers = state.scene?.layers ?? [];
    const maxIndex = layers.reduce((max, layer) => Math.max(max, layer.trackIndex ?? 0), 0);
    store.addToast(`Video track V${maxIndex + 2} is available`, 'info');
  };

  const addAudioCue = () => {
    if (!state.scene) return;
    store.mutateScene((scene) => {
      if (!scene.audio) scene.audio = { cues: [] };
      const cues = scene.audio.cues ?? [];
      cues.push({
        id: `cue-${Math.random().toString(36).slice(2, 7)}`,
        at: state.playhead,
        sfx: 'pop' as never,
        gain: 1,
        pan: 0,
      });
      scene.audio.cues = cues;
    }, 'Add audio cue');
    void store.executeSave();
  };

  return (
    <section class="mf-panel" data-panel="timeline" aria-label="Timeline">
      <div class="mf-timeline-toolbar">
        <span class="mf-timecode" id="timeline-timecode">
          {formatTimecode(state.playhead, FPS)}
        </span>
        <span class="mf-chip" id="timeline-active-tool">
          {state.activeTool.toUpperCase()}
        </span>

        <div class="mf-transport-sep" />

        <button
          class={`mf-btn is-icon ${state.activeTool === 'razor' ? 'is-active' : ''}`}
          id="timeline-razor"
          title="Razor split at the playhead (Ctrl+K)"
          aria-label="Razor split at the playhead"
          aria-pressed={state.activeTool === 'razor'}
          onClick={() => {
            store.setActiveTool(state.activeTool === 'razor' ? 'select' : 'razor');
            store.razorSplitAtPlayhead();
          }}
        >
          <IconRazor size={13} />
        </button>
        <button
          class={`mf-btn is-icon ${state.snapEnabled ? 'is-active' : ''}`}
          id="timeline-snap"
          title="Magnetic snapping (S)"
          aria-label="Magnetic snapping"
          aria-pressed={state.snapEnabled}
          onClick={() => store.setSnapEnabled(!state.snapEnabled)}
        >
          <IconMagnet size={13} />
        </button>

        <div class="mf-transport-sep" />

        <button
          class="mf-btn is-icon"
          id="timeline-zoom-out"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => store.setZoom(state.zoom / 1.25)}
        >
          <IconZoomOut size={13} />
        </button>
        <input
          type="range"
          min={0.2}
          max={8}
          step={0.05}
          value={state.zoom}
          aria-label="Timeline zoom"
          style={{ width: '110px', 'accent-color': 'var(--mf-accent)' }}
          onInput={(e) => store.setZoom(Number(e.currentTarget.value))}
        />
        <button
          class="mf-btn is-icon"
          id="timeline-zoom-in"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => store.setZoom(state.zoom * 1.25)}
        >
          <IconZoomIn size={13} />
        </button>

        <div style={{ flex: '1' }} />

        <button class="mf-btn" id="timeline-add-track" onClick={addVideoTrack}>
          <IconPlus size={12} />
          <span>Video Track</span>
        </button>
        <button class="mf-btn" id="timeline-add-audio" onClick={addAudioCue}>
          <IconWaveform size={12} />
          <span>Audio Cue</span>
        </button>
      </div>

      <div class="mf-timeline-body">
        {/* track headers */}
        <div class="mf-track-headers" id="timeline-track-headers" ref={scrollRef}>
          <div style={{ height: `${RULER_H}px` }} />
          <For each={tracks()}>
            {(track) => {
              const isAudio = () => track.kind === 'audio';
              const first = () => track.layers[0];
              return (
                <div
                  class={`mf-track-header ${first() && state.selectedLayerId === first()!.id ? 'is-selected' : ''}`}
                  data-track-index={track.index}
                  style={{ height: `${track.h}px`, 'margin-bottom': `${TRACK_GAP}px` }}
                >
                  <span class="mf-track-label" style={isAudio() ? { color: 'var(--mf-audio)' } : undefined}>
                    {track.name}
                  </span>
                  <Show
                    when={!isAudio() && first()}
                    fallback={
                      <span style={{ flex: '1' }} />
                    }
                  >
                    {(layer) => (
                      <>
                        <button
                          class={`mf-icon-btn ${layer().visible !== false ? 'is-on' : ''}`}
                          title="Toggle visibility"
                          aria-label="Toggle visibility"
                          onClick={(e) => {
                            e.stopPropagation();
                            store.toggleLayerVisibility(layer().id);
                          }}
                        >
                          {layer().visible !== false ? <IconEye size={12} /> : <IconEyeOff size={12} />}
                        </button>
                        <button
                          class="mf-icon-btn"
                          title="Solo"
                          aria-label="Solo track"
                          onClick={(e) => {
                            e.stopPropagation();
                            store.selectLayer(layer().id);
                          }}
                        >
                          <IconSolo size={12} />
                        </button>
                        <button
                          class={`mf-icon-btn ${layer().locked ? 'is-locked' : ''}`}
                          title="Toggle lock"
                          aria-label="Toggle lock"
                          onClick={(e) => {
                            e.stopPropagation();
                            store.toggleLayerLock(layer().id);
                          }}
                        >
                          {layer().locked ? <IconLock size={12} /> : <IconUnlock size={12} />}
                        </button>
                        <span class="mf-track-name" title={layer().name ?? layer().id}>
                          {layer().name ?? layer().id}
                        </span>
                      </>
                    )}
                  </Show>
                  <Show when={isAudio()}>
                    <span class="mf-track-name">
                      {state.scene?.audio?.cues?.length ?? 0} cues
                    </span>
                    <button class="mf-icon-btn" title="Mute track" aria-label="Mute track">
                      <IconMute size={12} />
                    </button>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>

        {/* canvas */}
        <div
          class="mf-timeline-canvas-wrap"
          id="timeline-canvas-container"
          style={isDragOver() ? { outline: '1px solid var(--mf-accent)' } : undefined}
          onDragOver={handleDragOver}
          onDragEnter={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={(e) => {
            const current = e.currentTarget as HTMLElement;
            if (current === e.target || !current.contains(e.relatedTarget as Node)) {
              setIsDragOver(false);
              setDropTime(null);
            }
          }}
          onDrop={handleDrop}
        >
          <Show when={isDragOver() && dropTime() !== null}>
            <div
              style={{
                position: 'absolute',
                top: '0',
                bottom: '0',
                width: '1px',
                background: 'var(--mf-accent)',
                'pointer-events': 'none',
                'z-index': '5',
                left: `${timeToX(dropTime()!)}px`,
              }}
            />
          </Show>
          <canvas
            ref={canvasRef}
            id="timeline-canvas"
            class={`mf-timeline-canvas ${state.activeTool === 'razor' ? 'is-razor' : ''}`}
            role="slider"
            aria-label="Timeline scrubber"
            aria-valuemin={0}
            aria-valuemax={totalDuration()}
            aria-valuenow={state.playhead}
          />
        </div>

        <AudioVuMeter />
      </div>
    </section>
  );
};

/** Convert a CSS colour (hex or var()) into an rgba string with an alpha. */
function hexToRgba(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex.slice(0, 6);
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  // `var(--mf-…)` tokens: fall back to the token's own colour with a tint
  const fallback: Record<string, string> = {
    'var(--mf-kind-background)': '#6b7280',
    'var(--mf-kind-kineticText)': '#f43f5e',
    'var(--mf-kind-card)': '#14b8a6',
    'var(--mf-kind-imageLogo)': '#f59e0b',
    'var(--mf-kind-lottie)': '#22c55e',
    'var(--mf-kind-foregroundFX)': '#3b82f6',
  };
  const hex = fallback[color] ?? '#2d8ceb';
  return hexToRgba(hex, alpha);
}
