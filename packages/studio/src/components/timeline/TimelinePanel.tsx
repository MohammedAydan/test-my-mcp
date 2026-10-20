import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import type { KeyframeProperty, LayerKeyframe } from '@motionforge/scene-spec';
import { store } from '../../state/store.js';
import type { StudioLayer } from '../../types.js';
import { formatTimecode } from '../../state/timecode.js';
import { AudioVuMeter } from './AudioVuMeter.js';
import { readAssetPayload } from '../../services/drag-payload.js';
import {
  IconEye,
  IconEyeOff,
  IconFit,
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
import {
  readFont,
  readMetrics,
  readPalette,
  resolveCssColor,
  withAlpha,
  type TimelineMetrics,
  type TimelinePalette,
} from './timeline-tokens.js';

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
 *
 * The lane layout comes from `store.resolveTrackLanes()` — the ONE grouping
 * authority: a clip that declares no `trackIndex` never shares a row with an
 * OVERLAPPING clip, and a clip that declares one always lands on that row.
 * The left-hand track headers are rendered from the very same array the
 * painter uses, so the two can never drift apart.
 */

/** The Studio's authoring frame rate. */
const FPS = 30;

/** the gap between two lane rows */
const LANE_GAP = 3;

/** the gap between the ruler and the first lane row */
const LANE_TOP_PAD = 4;

/** the trim-handle hit zone, in CSS pixels */
const EDGE_ZONE = 10;

/** the magnetic snap radius, in CSS pixels */
const SNAP_RADIUS_PX = 10;

/** the keyframe-diamond hit radius, in CSS pixels */
const KEYFRAME_HIT_PX = 7;

/** the in/out bracket hit zone, in CSS pixels */
const BRACKET_HIT_PX = 8;

/** the shortest a clip may be trimmed to */
const MIN_CLIP_MS = 100;

/** the layer-kind swatch tokens (the After Effects column-label convention) */
const KIND_TOKENS: Record<string, string> = {
  background: '--mf-kind-background',
  kineticText: '--mf-kind-kineticText',
  card: '--mf-kind-card',
  imageLogo: '--mf-kind-imageLogo',
  lottie: '--mf-kind-lottie',
  foregroundFX: '--mf-kind-foregroundFX',
};

/** One row of the timeline. */
interface TimelineLane {
  /** the `trackIndex` this row maps to */
  index: number;
  /** the header label — `V1`, `V2`, … or `A1` */
  name: string;
  kind: 'video' | 'audio';
  /** the clips on this row */
  layers: StudioLayer[];
  /** the Y origin inside the scrollable content */
  y: number;
  /** the row height */
  h: number;
}

/** One clip, resolved into canvas geometry. */
interface ClipBox {
  layer: StudioLayer;
  lane: TimelineLane;
  x: number;
  w: number;
  y: number;
  h: number;
  startMs: number;
  endMs: number;
}

/** One audio cue, resolved into canvas geometry. */
interface CueBox {
  cue: { id?: string; at: number; sfx: string; gain?: number };
  x: number;
  w: number;
  y: number;
  h: number;
}

/** A keyframe under the pointer. */
interface KeyframeHit {
  layerId: string;
  keyframeId: string;
  property: string;
  x: number;
  y: number;
}

type DragMode =
  | 'move'
  | 'trim-left'
  | 'trim-right'
  | 'keyframe'
  | 'scrub'
  | 'in'
  | 'out'
  | 'pan'
  | null;

export const TimelinePanel: Component = () => {
  const state = store.state;
  let canvasRef: HTMLCanvasElement | undefined;
  let ctx: CanvasRenderingContext2D | null = null;

  const [metrics, setMetrics] = createSignal<TimelineMetrics>(readMetrics());
  const [palette, setPalette] = createSignal<TimelinePalette>(readPalette());
  const [canvasWidth, setCanvasWidth] = createSignal(800);
  const [canvasHeight, setCanvasHeight] = createSignal(240);

  const [isDragOver, setIsDragOver] = createSignal(false);
  const [dropTime, setDropTime] = createSignal<number | null>(null);
  const [hoverLayerId, setHoverLayerId] = createSignal<string | null>(null);
  const [hoverKeyframe, setHoverKeyframe] = createSignal<KeyframeHit | null>(null);
  const [dropLaneIndex, setDropLaneIndex] = createSignal<number | null>(null);
  const [snapIndicatorX, setSnapIndicatorX] = createSignal<number | null>(null);
  const [razorX, setRazorX] = createSignal<number | null>(null);
  const [razorLaneIndex, setRazorLaneIndex] = createSignal<number | null>(null);

  let dragMode: DragMode = null;
  let dragLayer: StudioLayer | null = null;
  let dragKeyframe: KeyframeHit | null = null;
  let dragStartClientX = 0;
  let dragStartClientY = 0;
  let dragInitialAt = 0;
  let dragInitialDuration = 0;
  /** the neighbours of the dragged clip on its original lane, at gesture start */
  let dragNeighbours: Array<{ start: number; end: number }> = [];
  /** the lane the clip was last reassigned to during this gesture */
  let dragAssignedLaneIndex = -1;
  let dragHasMoved = false;
  let tooltip: { x: number; y: number; text: string } | null = null;
  let panStartX = 0;
  let initialPan = 0;

  const totalDuration = () => state.scene?.durationMs ?? 10000;

  /* ── time <-> x ──────────────────────────────────────────────────────── */

  const pxPerMs = () => {
    const width = canvasWidth();
    if (width <= 0) return 0.1;
    return (width * state.zoom) / totalDuration();
  };

  const timeToX = (ms: number) => ms * pxPerMs() + state.panOffset;

  /** The RAW time under an X coordinate — no snapping. */
  const xToRawTime = (x: number) => {
    const raw = (x - state.panOffset) / pxPerMs();
    return Math.max(0, Math.min(raw, totalDuration()));
  };

  /* ── magnetic snapping ───────────────────────────────────────────────── */

  /** Every time a dragged edge may magnetise to. */
  const snapCandidates = (excludeLayerId?: string): number[] => {
    const list: number[] = [0, totalDuration(), state.playhead];
    if (state.inPoint !== null) list.push(state.inPoint);
    if (state.outPoint !== null) list.push(state.outPoint);
    for (const layer of state.scene?.layers ?? []) {
      if (layer.id === excludeLayerId) continue;
      const start = layer.at ?? 0;
      list.push(start);
      list.push(start + (layer.duration ?? 0));
    }
    return list;
  };

  /**
   * Snap a raw time to the closest magnet.
   *
   * The playhead, the scene start, the scene end, the work-area edges and
   * the in/out edges of every other clip are magnets. When none is in range
   * the time is quantised to the frame grid, so the playhead still lands on
   * a real frame.
   */
  const snapTime = (raw: number, excludeLayerId?: string): { time: number; snapped: boolean } => {
    if (!state.snapEnabled) return { time: raw, snapped: false };
    const threshold = SNAP_RADIUS_PX / pxPerMs();
    let best: number | null = null;
    let bestDistance = Infinity;
    for (const candidate of snapCandidates(excludeLayerId)) {
      const distance = Math.abs(raw - candidate);
      if (distance <= threshold && distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (best !== null) return { time: best, snapped: true };
    const frame = 1000 / FPS;
    return { time: Math.round(raw / frame) * frame, snapped: false };
  };

  /** The snapped time under a pointer, with the indicator X when it magnetised. */
  const snappedTimeAt = (x: number, excludeLayerId?: string) => {
    const result = snapTime(xToRawTime(x), excludeLayerId);
    return { time: result.time, snapped: result.snapped, x: timeToX(result.time) };
  };

  /* ── lane layout ─────────────────────────────────────────────────────── */

  const lanes = createMemo<TimelineLane[]>(() => {
    const m = metrics();
    const resolved = store.resolveTrackLanes();
    const result: TimelineLane[] = [];

    for (const lane of resolved) {
      if (lane.kind === 'audio') continue;
      result.push({
        index: lane.index,
        name: `V${result.length + 1}`,
        kind: 'video',
        layers: lane.layers,
        y: 0,
        h: m.trackH,
      });
    }

    // the audio lane is ALWAYS the last row
    const audioLayers = resolved
      .filter((lane) => lane.kind === 'audio')
      .flatMap((lane) => lane.layers);
    result.push({
      index: result.length,
      name: 'A1',
      kind: 'audio',
      layers: audioLayers,
      y: 0,
      h: m.audioTrackH,
    });

    let y = m.rulerH + LANE_TOP_PAD;
    for (const lane of result) {
      lane.y = y;
      y += lane.h + LANE_GAP;
    }
    return result;
  });

  /** The scrollable content height (ruler + every lane row). */
  const contentHeight = () => {
    const list = lanes();
    const m = metrics();
    if (list.length === 0) return m.rulerH + LANE_TOP_PAD;
    const last = list[list.length - 1]!;
    return last.y + last.h + LANE_GAP;
  };

  /** The lane whose row contains a content-space Y. */
  const laneAtContentY = (contentY: number): TimelineLane | null => {
    for (const lane of lanes()) {
      if (contentY >= lane.y && contentY <= lane.y + lane.h) return lane;
    }
    return null;
  };

  /* ── clip geometry ───────────────────────────────────────────────────── */

  const clipBoxes = createMemo<ClipBox[]>(() => {
    const boxes: ClipBox[] = [];
    for (const lane of lanes()) {
      if (lane.kind === 'audio') continue;
      for (const layer of lane.layers) {
        const start = layer.at ?? 0;
        const duration = layer.duration ?? Math.max(0, totalDuration() - start);
        const x1 = timeToX(start);
        const x2 = timeToX(start + duration);
        boxes.push({
          layer,
          lane,
          x: x1,
          w: Math.max(3, x2 - x1),
          y: lane.y,
          h: lane.h,
          startMs: start,
          endMs: start + duration,
        });
      }
    }
    return boxes;
  });

  const audioCueBoxes = createMemo<CueBox[]>(() => {
    const audioLane = lanes().find((lane) => lane.kind === 'audio');
    if (!audioLane) return [];
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
      return {
        cue,
        x: x1,
        w: Math.max(18, x2 - x1),
        y: audioLane.y,
        h: audioLane.h,
      };
    });
  });

  /* ── keyframes ───────────────────────────────────────────────────────── */

  /** The Y of the keyframe row inside a clip. */
  const keyframeCenterY = (box: ClipBox) => box.y + box.h - 8;

  /** The index of a keyframe inside its property group. */
  const keyframeIndex = (layerId: string, keyframe: LayerKeyframe): number => {
    const list = store.layerKeyframes(layerId, keyframe.property as KeyframeProperty);
    return list.findIndex((candidate) => candidate.id === keyframe.id);
  };

  /** True when the keyframe is the selected one. */
  const isKeyframeSelected = (layerId: string, keyframe: LayerKeyframe): boolean => {
    const selected = state.selectedKeyframe;
    if (!selected) return false;
    if (selected.layerId !== layerId) return false;
    if (selected.property !== keyframe.property) return false;
    return selected.index === keyframeIndex(layerId, keyframe);
  };

  /** The keyframe under the pointer, if any. */
  const hitTestKeyframe = (x: number, contentY: number): KeyframeHit | null => {
    let best: KeyframeHit | null = null;
    let bestDistance = Infinity;
    for (const box of clipBoxes()) {
      if (contentY < box.y || contentY > box.y + box.h) continue;
      const centerY = keyframeCenterY(box);
      for (const keyframe of store.layerKeyframes(box.layer.id)) {
        const kx = timeToX(keyframe.timeMs);
        if (kx < box.x - 2 || kx > box.x + box.w + 2) continue;
        const distance = Math.abs(kx - x);
        if (distance > KEYFRAME_HIT_PX) continue;
        if (Math.abs(centerY - contentY) > box.h / 2) continue;
        if (distance < bestDistance) {
          best = {
            layerId: box.layer.id,
            keyframeId: keyframe.id,
            property: keyframe.property,
            x: kx,
            y: centerY,
          };
          bestDistance = distance;
        }
      }
    }
    return best;
  };

  /* ── canvas painting ─────────────────────────────────────────────────── */

  /**
   * The layer-kind swatches, resolved once per theme change.
   *
   * `resolveCssColor` reads the computed style, so it must NOT run per clip
   * per frame — the palette signal is the dependency that invalidates it.
   */
  const kindColors = createMemo<Record<string, string>>(() => {
    palette();
    const colors: Record<string, string> = {};
    for (const [type, token] of Object.entries(KIND_TOKENS)) {
      colors[type] = resolveCssColor(`var(${token})`, '#888888');
    }
    return colors;
  });

  /** The font stacks, resolved once per theme change. */
  const fonts = createMemo(() => {
    palette();
    return {
      mono: readFont('--mf-font-mono', 'monospace'),
      ui: readFont('--mf-font-ui', 'sans-serif'),
    };
  });

  const kindColor = (type: string): string =>
    kindColors()[type] ?? resolveCssColor('var(--mf-warning)', '#f59e0b');

  const draw = () => {
    const canvas = canvasRef;
    const context = ctx;
    if (!canvas || !context) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return;

    const p = palette();
    const m = metrics();
    const fontMono = fonts().mono;
    const fontUi = fonts().ui;

    context.clearRect(0, 0, w, h);
    context.fillStyle = p.bgSunken;
    context.fillRect(0, 0, w, h);

    const inX = state.inPoint !== null ? timeToX(state.inPoint) : 0;
    const outX = state.outPoint !== null ? timeToX(state.outPoint) : w;
    const hasWorkArea = state.inPoint !== null || state.outPoint !== null;

    /* ── the lane rows ── */
    context.save();
    context.beginPath();
    context.rect(0, m.rulerH, w, Math.max(0, h - m.rulerH));
    context.clip();
    context.translate(0, -state.timelineScrollY);

    lanes().forEach((lane, index) => {
      const bandAlpha = lane.kind === 'audio' ? 0.05 : index % 2 === 0 ? 0.035 : 0.018;
      context.fillStyle = withAlpha(lane.kind === 'audio' ? p.audio : p.text1, bandAlpha);
      roundRectPath(context, 0, lane.y, w, lane.h, 4);
      context.fill();

      context.strokeStyle = p.border;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, lane.y + lane.h + 0.5);
      context.lineTo(w, lane.y + lane.h + 0.5);
      context.stroke();

      // the live drop target
      if (dropLaneIndex() === lane.index && lane.kind === 'video') {
        context.fillStyle = withAlpha(p.accent, 0.16);
        roundRectPath(context, 0, lane.y, w, lane.h, 4);
        context.fill();
        context.strokeStyle = p.accent;
        context.lineWidth = 1.5;
        roundRectPath(context, 0.75, lane.y + 0.75, w - 1.5, lane.h - 1.5, 4);
        context.stroke();
      }
    });

    /* ── the work area ── */
    if (hasWorkArea) {
      if (state.inPoint !== null) {
        context.fillStyle = withAlpha(p.bgGutter, 0.6);
        context.fillRect(0, m.rulerH, Math.max(0, inX), h - m.rulerH);
      }
      if (state.outPoint !== null) {
        context.fillStyle = withAlpha(p.bgGutter, 0.6);
        context.fillRect(outX, m.rulerH, Math.max(0, w - outX), h - m.rulerH);
      }
      context.fillStyle = withAlpha(p.keyframe, 0.06);
      context.fillRect(inX, m.rulerH, Math.max(0, outX - inX), h - m.rulerH);
    }

    /* ── the clips ── */
    for (const box of clipBoxes()) {
      const layer = box.layer;
      const selected =
        state.selectedLayerIds.includes(layer.id) || state.selectedLayerId === layer.id;
      const hovered = hoverLayerId() === layer.id;
      const dim = layer.visible === false;
      const base = kindColor(layer.type);
      const clipTop = box.y + 1;
      const clipHeight = box.h - 3;

      // body
      context.fillStyle = dim
        ? withAlpha(p.text1, 0.05)
        : withAlpha(base, selected ? 0.34 : hovered ? 0.28 : 0.2);
      roundRectPath(context, box.x, clipTop, box.w, clipHeight, 6);
      context.fill();

      // the header strip + the bright top highlight, clipped to the body
      context.save();
      roundRectPath(context, box.x, clipTop, box.w, clipHeight, 6);
      context.clip();
      context.fillStyle = dim ? withAlpha(p.text1, 0.1) : withAlpha(base, selected ? 0.95 : 0.7);
      context.fillRect(box.x, clipTop, box.w, 5);
      context.fillStyle = withAlpha('#ffffff', 0.28);
      context.fillRect(box.x, clipTop, box.w, 1);
      context.restore();

      // the border
      context.strokeStyle = selected ? p.accent : dim ? p.border : withAlpha(base, 0.6);
      context.lineWidth = selected ? 1.5 : 1;
      roundRectPath(context, box.x + 0.5, clipTop + 0.5, box.w - 1, clipHeight - 1, 6);
      context.stroke();

      // the trim caps
      if ((selected || hovered) && box.w > 18) {
        context.fillStyle = '#ffffff';
        roundRectPath(context, box.x + 1.5, clipTop + 7, 3, clipHeight - 14, 1.5);
        context.fill();
        roundRectPath(context, box.x + box.w - 4.5, clipTop + 7, 3, clipHeight - 14, 1.5);
        context.fill();
      }

      // the label
      if (box.w > 34) {
        context.font = `500 10px ${fontUi}`;
        context.textBaseline = 'middle';
        context.fillStyle = dim ? p.text3 : p.text1;
        context.fillText(layer.name ?? layer.id, box.x + 8, clipTop + 12);
      }

      // the keyframe diamonds
      const centerY = keyframeCenterY(box);
      for (const keyframe of store.layerKeyframes(layer.id)) {
        const kx = timeToX(keyframe.timeMs);
        if (kx < box.x - 2 || kx > box.x + box.w + 2) continue;
        const isSelected = isKeyframeSelected(layer.id, keyframe);
        const isHovered =
          hoverKeyframe()?.layerId === layer.id && hoverKeyframe()?.keyframeId === keyframe.id;
        const radius = isSelected || isHovered ? 4.5 : 3.5;
        drawDiamond(
          context,
          kx,
          centerY,
          radius,
          isSelected ? '#ffffff' : p.keyframe,
          isSelected ? p.accent : null
        );
      }
    }

    /* ── the audio cues ── */
    for (const box of audioCueBoxes()) {
      context.fillStyle = withAlpha(p.audio, 0.16);
      roundRectPath(context, box.x, box.y + 1, box.w, box.h - 3, 4);
      context.fill();
      context.strokeStyle = withAlpha(p.audio, 0.75);
      context.lineWidth = 1;
      roundRectPath(context, box.x + 0.5, box.y + 1.5, box.w - 1, box.h - 4, 4);
      context.stroke();

      const centerY = box.y + box.h / 2 + 2;
      const spacing = 3;
      const bars = Math.floor(box.w / spacing);
      context.fillStyle = p.audio;
      for (let i = 0; i < bars; i++) {
        const progress = bars > 0 ? i / bars : 0;
        const envelope = Math.sin(progress * Math.PI);
        const noise = Math.sin(i * 12.9898 + (box.cue.at % 100)) * 0.5 + 0.5;
        const height = Math.max(
          2,
          box.h * 0.36 * envelope * (0.35 + 0.65 * noise) * (box.cue.gain ?? 1)
        );
        context.fillRect(box.x + i * spacing, centerY - height / 2, 1.5, height);
      }

      if (box.w > 34) {
        context.font = `500 9px ${fontMono}`;
        context.textBaseline = 'top';
        context.fillStyle = p.text1;
        context.fillText(box.cue.sfx, box.x + 5, box.y + 3);
      }
    }

    /* ── the razor cut line ── */
    const cutX = razorX();
    if (cutX !== null && state.activeTool === 'razor') {
      const lane = lanes().find((candidate) => candidate.index === razorLaneIndex());
      const top = lane ? lane.y : m.rulerH;
      const bottom = lane ? lane.y + lane.h : h;
      context.strokeStyle = p.record;
      context.lineWidth = 1;
      context.setLineDash([4, 3]);
      context.beginPath();
      context.moveTo(cutX, top);
      context.lineTo(cutX, bottom);
      context.stroke();
      context.setLineDash([]);
    }

    context.restore();

    /* ── the ruler ── */
    context.fillStyle = p.bgHeader;
    context.fillRect(0, 0, w, m.rulerH);
    context.fillStyle = withAlpha(p.text1, 0.08);
    context.fillRect(0, m.rulerH - 1, w, 1);

    const step = tickStep();
    const minorCount = step % 5 === 0 ? 5 : 4;
    const first = Math.floor(Math.max(0, xToRawTime(0)) / step) * step;
    const last = Math.min(totalDuration(), xToRawTime(w));

    context.font = `9px ${fontMono}`;
    context.textBaseline = 'middle';

    for (let t = first; t <= last + step; t += step) {
      const x = timeToX(t);
      if (x < -80 || x > w + 80) continue;
      for (let i = 1; i < minorCount; i++) {
        const mx = timeToX(t + (step / minorCount) * i);
        context.fillStyle = withAlpha(p.text1, 0.16);
        context.fillRect(mx, m.rulerH - 5, 1, 5);
      }
      context.fillStyle = withAlpha(p.text1, 0.32);
      context.fillRect(x, m.rulerH - 10, 1, 10);
      context.fillStyle = p.text2;
      context.fillText(formatTimecode(t, FPS), x + 4, m.rulerH / 2 - 2);
    }

    /* ── the in / out brackets ── */
    if (state.inPoint !== null) {
      const x = timeToX(state.inPoint);
      context.fillStyle = p.keyframe;
      context.fillRect(x - 1, 0, 2, m.rulerH);
      context.beginPath();
      context.moveTo(x - 7, 0);
      context.lineTo(x + 7, 5);
      context.lineTo(x - 7, 10);
      context.closePath();
      context.fill();
    }
    if (state.outPoint !== null) {
      const x = timeToX(state.outPoint);
      context.fillStyle = p.keyframe;
      context.fillRect(x - 1, 0, 2, m.rulerH);
      context.beginPath();
      context.moveTo(x + 7, 0);
      context.lineTo(x - 7, 5);
      context.lineTo(x + 7, 10);
      context.closePath();
      context.fill();
    }

    /* ── the snap indicator ── */
    const snapX = snapIndicatorX();
    if (snapX !== null) {
      context.strokeStyle = p.keyframe;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(snapX + 0.5, 0);
      context.lineTo(snapX + 0.5, h);
      context.stroke();
      context.fillStyle = p.keyframe;
      context.beginPath();
      context.moveTo(snapX - 5, 0);
      context.lineTo(snapX + 5, 0);
      context.lineTo(snapX, 8);
      context.closePath();
      context.fill();
    }

    /* ── the playhead ── */
    const playheadX = timeToX(state.playhead);
    context.strokeStyle = p.record;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(playheadX + 0.5, m.rulerH - 6);
    context.lineTo(playheadX + 0.5, h);
    context.stroke();

    context.fillStyle = p.record;
    context.beginPath();
    context.moveTo(playheadX - 6, 0);
    context.lineTo(playheadX + 6, 0);
    context.lineTo(playheadX + 6, m.rulerH - 8);
    context.lineTo(playheadX, m.rulerH);
    context.lineTo(playheadX - 6, m.rulerH - 8);
    context.closePath();
    context.fill();

    /* ── the drag tooltip ── */
    if (tooltip) {
      context.font = `600 10px ${fontMono}`;
      const width = context.measureText(tooltip.text).width + 14;
      const x = Math.max(6, Math.min(w - width - 6, tooltip.x - width / 2));
      const y = Math.max(m.rulerH + 4, tooltip.y - 26);
      context.fillStyle = p.bgElevated;
      context.strokeStyle = p.accent;
      context.lineWidth = 1;
      roundRectPath(context, x, y, width, 20, 4);
      context.fill();
      context.stroke();
      context.fillStyle = p.accentText;
      context.textBaseline = 'middle';
      context.fillText(tooltip.text, x + 7, y + 10);
    }
  };

  /** The major tick step of the ruler, in milliseconds. */
  const tickStep = () => {
    const width = canvasWidth() || 800;
    const visible = totalDuration() / state.zoom;
    const target = (visible * 90) / width;
    const candidates = [
      100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000,
    ];
    for (const candidate of candidates) {
      if (candidate >= target) return candidate;
    }
    return 600000;
  };

  // the painter reads all of these — the effect tracks them explicitly so a
  // repaint is scheduled whenever any of them changes.
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
    state.selectedKeyframe;
    // every clip's timing — a patch writes the leaves, not the scene object
    const clipSignature = (state.scene?.layers ?? [])
      .map(
        (layer) =>
          `${layer.id}:${layer.at ?? 0}:${layer.duration ?? 0}:${layer.trackIndex ?? -1}:${
            layer.visible !== false
          }:${layer.keyframes?.length ?? 0}`
      )
      .join('|');
    clipSignature;
    hoverLayerId();
    hoverKeyframe();
    dropLaneIndex();
    snapIndicatorX();
    razorX();
    razorLaneIndex();
    metrics();
    palette();
    canvasWidth();
    canvasHeight();
    requestAnimationFrame(draw);
  });

  const resize = () => {
    const canvas = canvasRef;
    if (!canvas) return;
    const rect = canvas.parentElement?.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect?.width ?? canvas.clientWidth));
    const height = Math.max(1, Math.round(rect?.height ?? canvas.clientHeight));
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx = canvas.getContext('2d');
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    setCanvasWidth(width);
    setCanvasHeight(height);
    draw();
  };

  /**
   * The wheel over the timeline.
   *
   *  - `Ctrl` / `Alt` + wheel: horizontal ZOOM, anchored at the cursor — the
   *    time under the pointer stays under the pointer.
   *  - `Shift` + wheel: horizontal PAN.
   *  - plain wheel: vertical SCROLL over the lane rows.
   */
  const onWheel = (event: WheelEvent) => {
    if (!canvasRef) return;
    event.preventDefault();
    const rect = canvasRef.getBoundingClientRect();
    const mouseX = Math.max(0, event.clientX - rect.left);

    if (event.ctrlKey || event.metaKey || event.altKey) {
      const timeAtMouse = (mouseX - state.panOffset) / pxPerMs();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      const zoom = Math.max(0.2, Math.min(12, state.zoom * factor));
      store.setZoom(zoom);
      const newPxPerMs = (canvasWidth() * zoom) / totalDuration();
      store.setPanOffset(mouseX - timeAtMouse * newPxPerMs);
      return;
    }

    if (event.shiftKey) {
      const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY;
      store.setPanOffset(state.panOffset - delta);
      return;
    }

    const visible = canvasHeight() - metrics().rulerH;
    const maxScroll = Math.max(0, contentHeight() - visible);
    store.setTimelineScrollY(
      Math.max(0, Math.min(maxScroll, state.timelineScrollY + event.deltaY))
    );
  };

  onMount(() => {
    resize();
    window.addEventListener('resize', resize);

    // the design tokens can change under us (a theme swap) — re-read them
    const observer = new MutationObserver(() => {
      setMetrics(readMetrics());
      setPalette(readPalette());
      draw();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    observer.observe(document.head, { childList: true, subtree: true });

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

      if (event.shiftKey && key === 'z') {
        event.preventDefault();
        zoomToFit();
      } else if (key === 'l') {
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

    // the Delete key removes the SELECTED KEYFRAME, not the layer — the
    // capture phase lets the timeline win over the global layer delete.
    const handleKeyDownCapture = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const selected = state.selectedKeyframe;
      if (!selected) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const list = store.layerKeyframes(selected.layerId, selected.property as KeyframeProperty);
      const target = list[selected.index];
      if (target) {
        store.removeLayerKeyframe(selected.layerId, target.id);
        store.addToast(`Deleted keyframe at ${formatTimecode(target.timeMs, FPS)}`, 'info');
      }
    };

    window.addEventListener('keydown', handleKeyDownCapture, true);

    const pointer = (event: MouseEvent) => {
      const rect = canvasRef?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0, contentY: 0 };
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      return { x, y, contentY: y + state.timelineScrollY };
    };

    /** The clip under the pointer. */
    const hitTestClip = (x: number, contentY: number): ClipBox | null => {
      for (const box of clipBoxes()) {
        if (contentY < box.y || contentY > box.y + box.h) continue;
        if (x < box.x - EDGE_ZONE || x > box.x + box.w + EDGE_ZONE) continue;
        return box;
      }
      return null;
    };

    const onMouseDown = (event: MouseEvent) => {
      if (!canvasRef || event.button === 2) return;
      const { x, y, contentY } = pointer(event);
      const m = metrics();

      // the hand tool and the middle button pan
      if (state.activeTool === 'hand' || event.button === 1) {
        dragMode = 'pan';
        panStartX = event.clientX;
        initialPan = state.panOffset;
        event.preventDefault();
        return;
      }

      /* ── the ruler ── */
      if (y <= m.rulerH) {
        if (state.inPoint !== null && Math.abs(x - timeToX(state.inPoint)) <= BRACKET_HIT_PX) {
          dragMode = 'in';
          return;
        }
        if (state.outPoint !== null && Math.abs(x - timeToX(state.outPoint)) <= BRACKET_HIT_PX) {
          dragMode = 'out';
          return;
        }
        dragMode = 'scrub';
        store.setPlayhead(snappedTimeAt(x).time);
        return;
      }

      /* ── the razor ── */
      if (state.activeTool === 'razor') {
        const box = hitTestClip(x, contentY);
        if (box) {
          const at = snappedTimeAt(x).time;
          if (store.razorSplitLayerAt(box.layer.id, at)) {
            store.addToast(
              `Split ${box.layer.name ?? box.layer.id} at ${formatTimecode(at, FPS)}`,
              'success'
            );
            void store.executeSave().catch(() => undefined);
          }
        }
        return;
      }

      /* ── a keyframe diamond ── */
      const keyframeHit = hitTestKeyframe(x, contentY);
      if (keyframeHit) {
        if (event.altKey) {
          store.removeLayerKeyframe(keyframeHit.layerId, keyframeHit.keyframeId);
          store.addToast('Deleted keyframe', 'info');
          return;
        }
        const layer = state.scene?.layers.find((candidate) => candidate.id === keyframeHit.layerId);
        const target = (layer?.keyframes ?? []).find(
          (candidate) => candidate.id === keyframeHit.keyframeId
        );
        if (target) {
          store.setSelectedKeyframe({
            layerId: keyframeHit.layerId,
            property: keyframeHit.property,
            index: keyframeIndex(keyframeHit.layerId, target as LayerKeyframe),
          });
          store.selectLayer(keyframeHit.layerId);
        }
        dragMode = 'keyframe';
        dragKeyframe = keyframeHit;
        dragStartClientX = event.clientX;
        dragStartClientY = event.clientY;
        dragHasMoved = false;
        return;
      }

      /* ── a clip ── */
      const box = hitTestClip(x, contentY);
      if (box) {
        const isMulti = event.shiftKey || event.ctrlKey || event.metaKey;
        store.selectLayer(box.layer.id, isMulti);

        dragLayer = box.layer;
        dragStartClientX = event.clientX;
        dragStartClientY = event.clientY;
        dragInitialAt = box.layer.at ?? 0;
        dragInitialDuration = box.layer.duration ?? Math.max(0, totalDuration() - dragInitialAt);
        dragNeighbours = box.lane.layers
          .filter((layer) => layer.id !== box.layer.id)
          .map((layer) => {
            const start = layer.at ?? 0;
            return { start, end: start + (layer.duration ?? 0) };
          });
        dragHasMoved = false;
        dragAssignedLaneIndex = -1;

        const x1 = timeToX(box.startMs);
        const x2 = timeToX(box.endMs);
        if (Math.abs(x - x1) <= EDGE_ZONE) dragMode = 'trim-left';
        else if (Math.abs(x - x2) <= EDGE_ZONE) dragMode = 'trim-right';
        else dragMode = 'move';
        return;
      }

      /* ── empty space scrubs ── */
      dragMode = 'scrub';
      store.setPlayhead(snappedTimeAt(x).time);
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!canvasRef) return;
      const { x, y, contentY } = pointer(event);

      if (dragMode === 'pan') {
        store.setPanOffset(initialPan + (event.clientX - panStartX));
        return;
      }

      if (dragMode === 'scrub') {
        store.setPlayhead(snappedTimeAt(x).time);
        return;
      }

      if (dragMode === 'in') {
        const time = snappedTimeAt(x).time;
        const limit = state.outPoint ?? totalDuration();
        store.setInPoint(Math.min(time, limit));
        setSnapIndicatorX(null);
        return;
      }

      if (dragMode === 'out') {
        const time = snappedTimeAt(x).time;
        const limit = state.inPoint ?? 0;
        store.setOutPoint(Math.max(time, limit));
        setSnapIndicatorX(null);
        return;
      }

      if (dragMode === 'keyframe' && dragKeyframe) {
        if (!dragHasMoved) {
          if (Math.abs(event.clientX - dragStartClientX) < 2) return;
          dragHasMoved = true;
          store.pushHistory('Timeline: move keyframe');
        }
        const snapped = snappedTimeAt(x, dragKeyframe.layerId);
        store.moveLayerKeyframe(dragKeyframe.layerId, dragKeyframe.keyframeId, snapped.time);
        setSnapIndicatorX(snapped.snapped ? snapped.x : null);
        tooltip = {
          x,
          y,
          text: `Key ${formatTimecode(snapped.time, FPS)}`,
        };
        return;
      }

      if ((dragMode === 'move' || dragMode === 'trim-left' || dragMode === 'trim-right') && dragLayer) {
        const dx = event.clientX - dragStartClientX;
        const dy = event.clientY - dragStartClientY;
        if (!dragHasMoved) {
          if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
          dragHasMoved = true;
          store.pushHistory(
            dragMode === 'move' ? 'Timeline: move clip' : 'Timeline: trim clip'
          );
        }

        const deltaMs = dx / pxPerMs();

        // the collision clamp — a clip never moves over its neighbour
        let minBoundary = 0;
        let maxBoundary = totalDuration();
        for (const neighbour of dragNeighbours) {
          if (neighbour.start < dragInitialAt) {
            minBoundary = Math.max(minBoundary, neighbour.end);
          } else if (neighbour.start > dragInitialAt) {
            maxBoundary = Math.min(maxBoundary, neighbour.start);
          }
        }

        if (dragMode === 'move') {
          const snapped = snappedTimeAt(timeToX(dragInitialAt + deltaMs), dragLayer.id);
          const maxAt = Math.max(minBoundary, maxBoundary - dragInitialDuration);
          const newAt = Math.max(minBoundary, Math.min(maxAt, snapped.time));
          store.moveClip(dragLayer.id, Math.round(newAt), false);
          setSnapIndicatorX(snapped.snapped ? snapped.x : null);
          tooltip = {
            x,
            y,
            text: `In: ${formatTimecode(newAt, FPS)} | Dur: ${formatDurationShort(dragInitialDuration)}`,
          };

          // the vertical component — reassign the clip to another lane
          const hoveredLane = laneAtContentY(contentY);
          const currentLane = lanes().find((lane) =>
            lane.layers.some((layer) => layer.id === dragLayer!.id)
          );
          if (hoveredLane && hoveredLane.kind === 'video') {
            setDropLaneIndex(hoveredLane.index);
            if (
              hoveredLane.index !== currentLane?.index &&
              hoveredLane.index !== dragAssignedLaneIndex
            ) {
              dragAssignedLaneIndex = hoveredLane.index;
              store.moveClipToTrack(dragLayer.id, hoveredLane.index);
            }
          }
        } else if (dragMode === 'trim-left') {
          const snapped = snappedTimeAt(timeToX(dragInitialAt + deltaMs), dragLayer.id);
          const maxAt = dragInitialAt + dragInitialDuration - MIN_CLIP_MS;
          const newAt = Math.max(minBoundary, Math.min(maxAt, snapped.time));
          const newDuration = dragInitialAt + dragInitialDuration - newAt;
          store.patchLayer(dragLayer.id, { at: Math.round(newAt), duration: Math.round(newDuration) });
          setSnapIndicatorX(snapped.snapped ? snapped.x : null);
          tooltip = {
            x,
            y,
            text: `In: ${formatTimecode(newAt, FPS)} | Dur: ${formatDurationShort(newDuration)}`,
          };
        } else {
          const snapped = snappedTimeAt(timeToX(dragInitialAt + deltaMs), dragLayer.id);
          const maxDuration = Math.max(MIN_CLIP_MS, maxBoundary - dragInitialAt);
          const newDuration = Math.max(
            MIN_CLIP_MS,
            Math.min(maxDuration, dragInitialDuration + (snapped.time - dragInitialAt))
          );
          store.patchLayer(dragLayer.id, { duration: Math.round(newDuration) });
          setSnapIndicatorX(snapped.snapped ? snapped.x : null);
          tooltip = {
            x,
            y,
            text: `In: ${formatTimecode(dragInitialAt, FPS)} | Dur: ${formatDurationShort(newDuration)}`,
          };
        }
        return;
      }

      /* ── hover feedback ── */
      const hoveredKeyframe = hitTestKeyframe(x, contentY);
      setHoverKeyframe(hoveredKeyframe);

      if (state.activeTool === 'razor') {
        const box = hitTestClip(x, contentY);
        setRazorX(box ? x : null);
        setRazorLaneIndex(box ? box.lane.index : null);
        if (canvasRef) canvasRef.style.cursor = box ? 'col-resize' : 'default';
        setHoverLayerId(box ? box.layer.id : null);
        return;
      }

      const box = hitTestClip(x, contentY);
      setHoverLayerId(box ? box.layer.id : null);

      let cursor = 'default';
      if (hoveredKeyframe) {
        cursor = 'pointer';
      } else if (box) {
        const x1 = timeToX(box.startMs);
        const x2 = timeToX(box.endMs);
        if (Math.abs(x - x1) <= EDGE_ZONE || Math.abs(x - x2) <= EDGE_ZONE) cursor = 'ew-resize';
        else cursor = 'grab';
      } else if (y <= metrics().rulerH) {
        cursor = 'pointer';
      }
      if (canvasRef) canvasRef.style.cursor = cursor;
    };

    const onMouseUp = () => {
      if (dragHasMoved && dragMode && dragMode !== 'scrub' && dragMode !== 'pan') {
        void store.executeSave().catch(() => undefined);
      }
      dragHasMoved = false;
      tooltip = null;
      dragMode = null;
      dragLayer = null;
      dragKeyframe = null;
      dragAssignedLaneIndex = -1;
      setSnapIndicatorX(null);
      setDropLaneIndex(null);
    };

    const onContextMenu = (event: MouseEvent) => {
      if (!canvasRef) return;
      // the timeline is an application surface — the native menu never shows
      event.preventDefault();
      const { x, contentY } = pointer(event);
      const hit = hitTestKeyframe(x, contentY);
      if (!hit) return;
      store.removeLayerKeyframe(hit.layerId, hit.keyframeId);
      store.addToast('Deleted keyframe', 'info');
    };

    canvasRef?.addEventListener('mousedown', onMouseDown);
    canvasRef?.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keydown', handleKeyDownCapture, true);
      canvasRef?.removeEventListener('mousedown', onMouseDown);
      canvasRef?.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    });
  });

  /* ── drag & drop from the project bin ────────────────────────────────── */

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    if (canvasRef) {
      const rect = canvasRef.getBoundingClientRect();
      setDropTime(
        Math.max(0, Math.min(totalDuration(), Math.round(xToRawTime(event.clientX - rect.left))))
      );
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
    const at = Math.max(
      0,
      Math.min(totalDuration(), Math.round(xToRawTime(event.clientX - rect.left)))
    );

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
      void store.executeSave().catch(() => undefined);
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
    void store.executeSave().catch(() => undefined);
  };

  /* ── toolbar actions ─────────────────────────────────────────────────── */

  /** Fit the whole composition into the timeline width. */
  const zoomToFit = () => {
    const width = canvasWidth();
    const duration = totalDuration();
    if (width <= 0 || duration <= 0) return;
    store.setZoom(Math.max(0.2, Math.min(12, duration / width)));
    store.setPanOffset(0);
    store.addToast('Timeline zoomed to fit', 'info');
  };

  const addVideoTrack = () => {
    if (!state.scene) {
      store.addToast('Load a composition before adding a track', 'warning');
      return;
    }
    const videoLanes = store.resolveTrackLanes().filter((lane) => lane.kind === 'video');
    const nextNumber =
      videoLanes.reduce((max, lane) => Math.max(max, lane.index + 1), 1) + 1;
    store.mutateScene((scene) => {
      const declared = scene.trackLanes ?? [];
      scene.trackLanes = [
        ...declared,
        { id: `track-v${nextNumber}`, name: `V${nextNumber}`, kind: 'video' },
      ];
    }, `Add video track V${nextNumber}`);
    store.addToast(`Added video track V${nextNumber}`, 'success');
    void store.executeSave().catch(() => undefined);
  };

  const addAudioCue = () => {
    if (!state.scene) {
      store.addToast('Load a composition before adding an audio cue', 'warning');
      return;
    }
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
    void store.executeSave().catch(() => undefined);
  };

  return (
    <section class="mf-panel" data-panel="timeline" aria-label="Timeline">
      <div class="mf-timeline-toolbar" id="timeline-toolbar" role="toolbar" aria-label="Timeline tools">
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
          id="timeline-zoom-slider"
          min={0.2}
          max={12}
          step="any"
          value={state.zoom}
          aria-label="Timeline zoom"
          title={`Timeline zoom — ${Math.round(state.zoom * 100)}%`}
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
        <button
          class="mf-btn is-icon"
          id="timeline-zoom-fit"
          title="Zoom to fit (Shift+Z)"
          aria-label="Zoom to fit"
          onClick={zoomToFit}
        >
          <IconFit size={13} />
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
        {/* the track headers — one row per lane, in lock-step with the canvas */}
        <div
          class="mf-track-headers"
          id="timeline-track-headers"
          style={{ 'overflow-y': 'hidden', 'overflow-x': 'hidden' }}
          onWheel={onWheel}
        >
          <div
            id="timeline-track-headers-inner"
            style={{ transform: `translateY(${-state.timelineScrollY}px)` }}
          >
            <div style={{ height: `${metrics().rulerH + LANE_TOP_PAD}px` }} />
            <For each={lanes()}>
              {(lane) => {
                const isAudio = () => lane.kind === 'audio';
                const first = () => lane.layers[0];
                return (
                  <div
                    class={`mf-track-header ${first() && state.selectedLayerId === first()!.id ? 'is-selected' : ''}`}
                    data-track-index={lane.index}
                    data-track-name={lane.name}
                    data-track-kind={lane.kind}
                    style={{ height: `${lane.h}px`, 'margin-bottom': `${LANE_GAP}px` }}
                    onClick={() => {
                      const layer = first();
                      if (layer) store.selectLayer(layer.id);
                    }}
                  >
                    <span
                      class="mf-track-label"
                      style={isAudio() ? { color: 'var(--mf-audio)' } : undefined}
                    >
                      {lane.name}
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
        </div>

        {/* the canvas */}
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
          onWheel={onWheel}
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

/** Round a path — with a manual fallback for engines without `roundRect`. */
function roundRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, width, height, r);
    return;
  }
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

/** A crisp keyframe diamond. */
function drawDiamond(
  context: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  fill: string,
  stroke: string | null
): void {
  context.beginPath();
  context.moveTo(cx, cy - radius);
  context.lineTo(cx + radius, cy);
  context.lineTo(cx, cy + radius);
  context.lineTo(cx - radius, cy);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 1.5;
    context.stroke();
  }
}

/** `mm:ss` — the compact duration a clip tooltip reads. */
function formatDurationShort(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
