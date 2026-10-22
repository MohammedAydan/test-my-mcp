import { Component, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { store } from '../../state/store.js';
import type { StudioLayer } from '../../types.js';
import { layerLayoutSize, layerVariant } from '../../types.js';
import { updateCardVariant } from '../../services/card-variant.js';
import { capturePointer } from '../../services/pointer-capture.js';
import type { NewLayerKind } from '../../services/layer-factory.js';
import { resolveCompositionSize } from './geometry.js';
import { InlineTextEditor, type EditableField } from './InlineTextEditor.js';
import { IconPencil } from '../icons/NleIcons.js';

/**
 * The Program Monitor's direct-manipulation overlay.
 *
 * A transparent SVG layer over the `mf-runtime://` iframe:
 *  - a TRUE 1:1 gizmo: one `<g>` that carries the layer's rotation, with the
 *    bounding box drawn AROUND the exact transformed centre the runtime
 *    reports,
 *  - eight resize handles, a rotation stem and a centre anchor,
 *  - magnetic SMART ALIGNMENT GUIDES snapped to the canvas centre, the safe
 *    margins and every other visible layer's edges and centres,
 *  - a live coordinate HUD,
 *  - hand-tool panning and Ctrl+wheel zooming,
 *  - an INLINE text editor for text and card layers.
 *
 * THE GEOMETRY RULE: the rotation is applied EXACTLY ONCE. The runtime
 * reports an UNROTATED box plus the rotation as a number, so the gizmo draws
 * the box in its own local frame and lets the single `<g>` rotate it. The old
 * code rotated a screen rectangle that was ALREADY rotated, which is why the
 * box escaped the element it belonged to.
 *
 * THE LIVE-OVERRIDE RULE: `ephemeralTransform` is posted ONLY while a layer
 * is being manipulated. A live override PINS the property it carries and
 * wins over that property's keyframes, so posting it from an effect that
 * fires on every scene change would kill the position keyframes.
 */

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SnapGuide {
  axis: 'x' | 'y';
  pos: number;
  label?: string;
  kind: 'canvas' | 'layer';
}

/** The exact geometry of one layer, in composition pixels. */
interface LayerBox {
  /** the transformed centre */
  cx: number;
  cy: number;
  /** the VISUAL size (layout × scale) */
  width: number;
  height: number;
  /** the unscaled layout size */
  layoutWidth: number;
  layoutHeight: number;
  /** degrees */
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/** The stage → screen mapping of one frame. */
interface Metrics {
  compW: number;
  compH: number;
  /** screen px per composition px */
  scale: number;
  /** the composition's top-left, in overlay-local px */
  stageLeft: number;
  stageTop: number;
  stageW: number;
  stageH: number;
  viewportW: number;
  viewportH: number;
}

/** The composition wrapper's box, in overlay-local px. */
export interface StageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

type DragMode = 'none' | 'move' | 'resize' | 'rotate' | 'marquee' | 'pan';

/** The captured state of one manipulation gesture. */
/**
 * The tool → layer-kind map for the CREATION tools.
 *
 * The Text tool and the Card tool create a layer when the user clicks the
 * canvas. Every other tool (select, hand, razor) manipulates what is already
 * there.
 */
const CREATION_TOOL_KINDS: Partial<Record<string, NewLayerKind>> = {
  text: 'kineticText',
  shape: 'card',
};

interface Gesture {  layerId: string;
  mode: 'move' | 'resize' | 'rotate';
  handle: string;
  box: LayerBox;
  /** the pointer at gesture start, in overlay-local px */
  startLocal: Point;
  /** the pointer at gesture start, in composition px */
  startComp: Point;
  /** the rotation offset, so grabbing the handle never snaps the layer */
  rotationOffset: number;
  /** the distance from the centre at gesture start (corner scaling) */
  r0: number;
  init: {
    xPct: number;
    yPct: number;
    scale?: number;
    scaleX?: number;
    scaleY?: number;
    rotation: number;
    sizePx?: number;
  };
  /** the properties the gesture touched (for the keyframe sync) */
  properties: string[];
  moved: boolean;
}

const HANDLE_SIZE = 7;
const ROTATE_STEM = 24;
const ANCHOR_SIZE = 6;
const SNAP_THRESHOLD_PX = 6;

/**
 * The layer kinds that paint the WHOLE canvas.
 *
 * They have no centre anchor and no meaningful box, so the gizmo never grabs
 * them and the marquee never selects them — a background is SUPPOSED to
 * cover everything.
 */
const FULL_BLEED_TYPES = new Set(['background', 'foregroundFX', 'particleField']);

/** True when the layer paints the whole canvas. */
const isFullBleed = (layer: StudioLayer): boolean => FULL_BLEED_TYPES.has(layer.type);

/** The eight resize handles, in the gizmo's local frame (fractions of the box). */
const HANDLE_LAYOUT: Array<{ k: string; fx: number; fy: number; cursor: string }> = [
  { k: 'nw', fx: -0.5, fy: -0.5, cursor: 'cursor-nwse-resize' },
  { k: 'ne', fx: 0.5, fy: -0.5, cursor: 'cursor-nesw-resize' },
  { k: 'se', fx: 0.5, fy: 0.5, cursor: 'cursor-nwse-resize' },
  { k: 'sw', fx: -0.5, fy: 0.5, cursor: 'cursor-nesw-resize' },
  { k: 'n', fx: 0, fy: -0.5, cursor: 'cursor-ns-resize' },
  { k: 's', fx: 0, fy: 0.5, cursor: 'cursor-ns-resize' },
  { k: 'e', fx: 0.5, fy: 0, cursor: 'cursor-ew-resize' },
  { k: 'w', fx: -0.5, fy: 0, cursor: 'cursor-ew-resize' },
];

export interface CanvasOverlayProps {
  /** the panel element (`.mf-monitor-stage`, id `monitor-viewport`) */
  viewportRef: () => HTMLDivElement | undefined;
  /** the composition wrapper's box, in overlay-local px (reactive) */
  stageBox: () => StageBox;
  /** the runtime iframe */
  iframeRef: () => HTMLIFrameElement | undefined;
  /** the monitor's zoom actions */
  onZoom?: (value: number | 'fit') => void;
}

export const CanvasOverlay: Component<CanvasOverlayProps> = (props) => {
  const state = store.state;

  const [dragMode, setDragMode] = createSignal<DragMode>('none');
  const [toolClick, setToolClick] = createSignal<Point | null>(null);
  const [activeGuides, setActiveGuides] = createSignal<SnapGuide[]>([]);
  const [marqueeRect, setMarqueeRect] = createSignal<Rect | null>(null);
  const [hoveredLayerId, setHoveredLayerId] = createSignal<string | null>(null);
  const [hud, setHud] = createSignal<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const [editing, setEditing] = createSignal<{ layerId: string; field: EditableField } | null>(null);

  let gesture: Gesture | null = null;
  let isSpacePressed = false;
  let marqueeStart: Point = { x: 0, y: 0 };
  let panStart: Point = { x: 0, y: 0 };

  /* ── geometry ────────────────────────────────────────────────────────── */

  const composition = createMemo(() => resolveCompositionSize(state.scene?.canvas));

  const getMetrics = (): Metrics => {
    const viewport = props.viewportRef();
    const box = props.stageBox();
    const comp = composition();
    const vRect = viewport?.getBoundingClientRect();
    const viewportW = vRect?.width ?? 0;
    const viewportH = vRect?.height ?? 0;
    const stageW = box.width || viewportW;
    const stageH = box.height || viewportH;
    const scale = comp.width > 0 && stageW > 0 ? stageW / comp.width : 1;
    return {
      compW: comp.width,
      compH: comp.height,
      scale,
      stageLeft: box.left,
      stageTop: box.top,
      stageW,
      stageH,
      viewportW,
      viewportH,
    };
  };

  /** A client point, in overlay-local px. */
  const toLocal = (event: { clientX: number; clientY: number }): Point => {
    const viewport = props.viewportRef();
    const rect = viewport?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  };

  /** A composition point, in overlay-local px. */
  const compToLocal = (x: number, y: number): Point => {
    const m = getMetrics();
    return { x: m.stageLeft + x * m.scale, y: m.stageTop + y * m.scale };
  };

  /** An overlay-local point, in composition px. */
  const localToComp = (point: Point): Point => {
    const m = getMetrics();
    if (!m.scale || !m.stageW) return { x: point.x, y: point.y };
    return {
      x: (point.x - m.stageLeft) / m.scale,
      y: (point.y - m.stageTop) / m.scale,
    };
  };

  const findLayer = (layerId: string): StudioLayer | undefined =>
    (state.scene?.layers ?? []).find((l) => l.id === layerId);

  /**
   * The layer's geometry.
   *
   * The runtime's bounds report is authoritative — it is the EXACT box the
   * renderer drew. The fallback computes the box from the layer's own
   * properties so the gizmo is never invisible before the first report.
   */
  const getLayerBox = (layer: StudioLayer): LayerBox => {
    const cached = state.layerBounds[layer.id];
    if (cached) {
      return {
        cx: cached.cx,
        cy: cached.cy,
        width: cached.width,
        height: cached.height,
        layoutWidth: cached.layoutWidth,
        layoutHeight: cached.layoutHeight,
        rotation: cached.rotation,
        scaleX: cached.scaleX,
        scaleY: cached.scaleY,
      };
    }

    const comp = composition();
    const position = layer.position ?? { xPct: 50, yPct: 50 };
    const cx = (position.xPct / 100) * comp.width;
    const cy = (position.yPct / 100) * comp.height;
    const uniform = typeof layer.scale === 'number' ? layer.scale : 1;
    const scaleX = typeof layer.scaleX === 'number' ? layer.scaleX : uniform;
    const scaleY = typeof layer.scaleY === 'number' ? layer.scaleY : uniform;

    let layoutWidth = 300;
    let layoutHeight = 100;
    if (isFullBleed(layer)) {
      // a full-bleed layer paints the WHOLE canvas — it has no layout box
      layoutWidth = comp.width;
      layoutHeight = comp.height;
    } else if (layer.type === 'kineticText') {
      const size = layer.sizePx ?? 64;
      layoutWidth = Math.min(comp.width * 0.7, (layer.text?.length ?? 10) * size * 0.55);
      layoutHeight = size * 1.3;
    } else if (layer.type === 'card') {
      const variantWidth = layerVariant(layer).widthPx;
      layoutWidth = typeof variantWidth === 'number' ? variantWidth : 360;
      layoutHeight = 120;
    } else if (layer.type === 'chart') {
      layoutWidth = Number(layer.widthPx ?? 760);
      layoutHeight = Number(layer.heightPx ?? 420);
    } else if (layer.type === 'codeBlock') {
      layoutWidth = Number(layer.widthPx ?? 880);
      layoutHeight = Math.max(80, layoutWidth * 0.42);
    } else if (layer.type === 'cta') {
      layoutWidth = Number(layer.widthPx ?? 320);
      layoutHeight = Number(layer.heightPx ?? 76);
    } else if (layer.type === 'imageLogo' || layer.type === 'lottie') {
      layoutWidth = layer.widthPx ?? 200;
      layoutHeight = layer.heightPx ?? layoutWidth;
    }

    // an explicit layout size wins over the kind's default
    const layout = layerLayoutSize(layer);
    if (layout?.widthPct !== undefined) layoutWidth = (layout.widthPct / 100) * comp.width;
    if (layout?.heightPct !== undefined) layoutHeight = (layout.heightPct / 100) * comp.height;

    return {
      cx,
      cy,
      width: layoutWidth * scaleX,
      height: layoutHeight * scaleY,
      layoutWidth,
      layoutHeight,
      rotation: layer.rotation ?? 0,
      scaleX,
      scaleY,
    };
  };

  const selectedLayers = createMemo(() => {
    const ids =
      state.selectedLayerIds.length > 0
        ? state.selectedLayerIds
        : state.selectedLayerId
          ? [state.selectedLayerId]
          : [];
    return (state.scene?.layers ?? []).filter((l) => ids.includes(l.id));
  });

  const primarySelectedLayer = createMemo(() => selectedLayers()[0] ?? null);

  const isEditable = (layer: StudioLayer | null): boolean =>
    !!layer && (layer.type === 'kineticText' || layer.type === 'card');

  /* ── smart alignment guides ──────────────────────────────────────────── */

  const findSnaps = (
    targetX: number,
    targetY: number,
    targetW: number,
    targetH: number,
    ignoreLayerId: string,
    threshold: number
  ) => {
    if (!state.snapEnabled) return { x: targetX, y: targetY, guides: [] as SnapGuide[] };

    const guides: SnapGuide[] = [];
    const comp = composition();

    const targetCenterX = targetX + targetW / 2;
    const targetCenterY = targetY + targetH / 2;
    const targetRight = targetX + targetW;
    const targetBottom = targetY + targetH;

    const canvasX = [
      { val: 0, label: 'Canvas Left', kind: 'canvas' as const },
      { val: comp.width / 2, label: 'Canvas Center', kind: 'canvas' as const },
      { val: comp.width, label: 'Canvas Right', kind: 'canvas' as const },
    ];
    const canvasY = [
      { val: 0, label: 'Canvas Top', kind: 'canvas' as const },
      { val: comp.height / 2, label: 'Canvas Center', kind: 'canvas' as const },
      { val: comp.height, label: 'Canvas Bottom', kind: 'canvas' as const },
    ];

    const layerX: Array<{ val: number; label: string; kind: 'layer' }> = [];
    const layerY: Array<{ val: number; label: string; kind: 'layer' }> = [];
    for (const layer of state.scene?.layers ?? []) {
      if (layer.id === ignoreLayerId) continue;
      if (isFullBleed(layer)) continue;
      if (layer.visible === false) continue;
      const box = getLayerBox(layer);
      const label = layer.name ?? layer.id;
      layerX.push(
        { val: box.cx - box.width / 2, label, kind: 'layer' },
        { val: box.cx, label, kind: 'layer' },
        { val: box.cx + box.width / 2, label, kind: 'layer' }
      );
      layerY.push(
        { val: box.cy - box.height / 2, label, kind: 'layer' },
        { val: box.cy, label, kind: 'layer' },
        { val: box.cy + box.height / 2, label, kind: 'layer' }
      );
    }

    const snapX = [...canvasX, ...layerX];
    const snapY = [...canvasY, ...layerY];

    let snappedX = targetX;
    let snappedY = targetY;

    for (const candidate of snapX) {
      if (Math.abs(targetCenterX - candidate.val) < threshold) {
        snappedX = candidate.val - targetW / 2;
        guides.push({ axis: 'x', pos: candidate.val, label: candidate.label, kind: candidate.kind });
        break;
      }
      if (Math.abs(targetX - candidate.val) < threshold) {
        snappedX = candidate.val;
        guides.push({ axis: 'x', pos: candidate.val, label: candidate.label, kind: candidate.kind });
        break;
      }
      if (Math.abs(targetRight - candidate.val) < threshold) {
        snappedX = candidate.val - targetW;
        guides.push({ axis: 'x', pos: candidate.val, label: candidate.label, kind: candidate.kind });
        break;
      }
    }

    for (const candidate of snapY) {
      if (Math.abs(targetCenterY - candidate.val) < threshold) {
        snappedY = candidate.val - targetH / 2;
        guides.push({ axis: 'y', pos: candidate.val, label: candidate.label, kind: candidate.kind });
        break;
      }
      if (Math.abs(targetY - candidate.val) < threshold) {
        snappedY = candidate.val;
        guides.push({ axis: 'y', pos: candidate.val, label: candidate.label, kind: candidate.kind });
        break;
      }
      if (Math.abs(targetBottom - candidate.val) < threshold) {
        snappedY = candidate.val - targetH;
        guides.push({ axis: 'y', pos: candidate.val, label: candidate.label, kind: candidate.kind });
        break;
      }
    }

    return { x: snappedX, y: snappedY, guides };
  };

  /* ── keyboard ────────────────────────────────────────────────────────── */

  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      // the inline editor is a contenteditable — its keys belong to the text
      if (target?.isContentEditable) return;

      if (event.code === 'Space') {
        isSpacePressed = true;
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === 'v') store.setActiveTool('select');
        else if (key === 'h') store.setActiveTool('hand');
        else if (key === 'c') store.setActiveTool('razor');
        else if (key === 't') store.setActiveTool('text');
        else if (key === 'r') store.setActiveTool('shape');
      } else if (event.ctrlKey || event.metaKey) {
        if (event.key === '0') {
          event.preventDefault();
          props.onZoom?.('fit');
        } else if (event.key === '1') {
          event.preventDefault();
          props.onZoom?.(1);
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') isSpacePressed = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    });
  });

  /* ── runtime sync ────────────────────────────────────────────────────── */

  /**
   * Post a LIVE transform override.
   *
   * ONLY the changed fields travel: the runtime merges the message onto the
   * override it already holds, so sending everything would pin properties the
   * gesture never touched.
   */
  const postTransform = (payload: Record<string, unknown>) => {
    const iframe = props.iframeRef();
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({ type: 'ephemeralTransform', ...payload }, '*');
  };

  /* ── hit testing ─────────────────────────────────────────────────────── */

  const hitTest = (local: Point): StudioLayer | null => {
    const comp = localToComp(local);
    const layers = state.scene?.layers ?? [];
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer) continue;
      if (isFullBleed(layer)) continue;
      if (layer.visible === false) continue;
      const box = getLayerBox(layer);
      const dx = comp.x - box.cx;
      const dy = comp.y - box.cy;
      const theta = (-box.rotation * Math.PI) / 180;
      const lx = dx * Math.cos(theta) - dy * Math.sin(theta);
      const ly = dx * Math.sin(theta) + dy * Math.cos(theta);
      if (Math.abs(lx) <= box.width / 2 && Math.abs(ly) <= box.height / 2) return layer;
    }
    return null;
  };

  /* ── gestures ────────────────────────────────────────────────────────── */

  const round1 = (value: number): number => Math.round(value * 10) / 10;

  const startMove = (layer: StudioLayer, local: Point) => {
    const box = getLayerBox(layer);
    gesture = {
      layerId: layer.id,
      mode: 'move',
      handle: '',
      box,
      startLocal: local,
      startComp: localToComp(local),
      rotationOffset: 0,
      r0: 0,
      init: {
        xPct: layer.position?.xPct ?? 50,
        yPct: layer.position?.yPct ?? 50,
        scale: layer.scale,
        scaleX: layer.scaleX,
        scaleY: layer.scaleY,
        rotation: box.rotation,
        sizePx: layer.sizePx,
      },
      properties: ['xPct', 'yPct'],
      moved: false,
    };
    setDragMode('move');
  };

  const startResize = (layer: StudioLayer, handle: string, local: Point) => {
    const box = getLayerBox(layer);
    const comp = localToComp(local);
    const dx = comp.x - box.cx;
    const dy = comp.y - box.cy;
    const theta = (-box.rotation * Math.PI) / 180;
    const dxLocal = dx * Math.cos(theta) - dy * Math.sin(theta);
    const dyLocal = dx * Math.sin(theta) + dy * Math.cos(theta);
    gesture = {
      layerId: layer.id,
      mode: 'resize',
      handle,
      box,
      startLocal: local,
      startComp: comp,
      rotationOffset: 0,
      r0: Math.max(1, Math.hypot(dxLocal, dyLocal)),
      init: {
        xPct: layer.position?.xPct ?? 50,
        yPct: layer.position?.yPct ?? 50,
        scale: layer.scale,
        scaleX: layer.scaleX,
        scaleY: layer.scaleY,
        rotation: box.rotation,
        sizePx: layer.sizePx,
      },
      properties: handle.length === 2 ? ['scale'] : [],
      moved: false,
    };
    setDragMode('resize');
  };

  const startRotate = (layer: StudioLayer, local: Point) => {
    const box = getLayerBox(layer);
    const comp = localToComp(local);
    const angle = (Math.atan2(comp.y - box.cy, comp.x - box.cx) * 180) / Math.PI + 90;
    gesture = {
      layerId: layer.id,
      mode: 'rotate',
      handle: 'rotate',
      box,
      startLocal: local,
      startComp: comp,
      rotationOffset: box.rotation - angle,
      r0: 0,
      init: {
        xPct: layer.position?.xPct ?? 50,
        yPct: layer.position?.yPct ?? 50,
        scale: layer.scale,
        scaleX: layer.scaleX,
        scaleY: layer.scaleY,
        rotation: box.rotation,
        sizePx: layer.sizePx,
      },
      properties: ['rotation'],
      moved: false,
    };
    setDragMode('rotate');
  };

  const applyMove = (g: Gesture, local: Point, event: PointerEvent) => {
    const m = getMetrics();
    const comp = localToComp(local);
    let dx = comp.x - g.startComp.x;
    let dy = comp.y - g.startComp.y;
    if (event.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }

    let boxX = g.box.cx + dx - g.box.width / 2;
    let boxY = g.box.cy + dy - g.box.height / 2;

    if (!event.altKey && state.snapEnabled) {
      const snap = findSnaps(
        boxX,
        boxY,
        g.box.width,
        g.box.height,
        g.layerId,
        SNAP_THRESHOLD_PX / (m.scale || 1)
      );
      boxX = snap.x;
      boxY = snap.y;
      setActiveGuides(snap.guides);
    } else {
      setActiveGuides([]);
    }

    const xPct = round1(((boxX + g.box.width / 2) / m.compW) * 100);
    const yPct = round1(((boxY + g.box.height / 2) / m.compH) * 100);

    store.patchLayer(g.layerId, { position: { xPct, yPct } });
    postTransform({ layerId: g.layerId, xPct, yPct });

    setHud({
      x: xPct,
      y: yPct,
      dx: round1(xPct - g.init.xPct),
      dy: round1(yPct - g.init.yPct),
    });
  };

  /** The scale patch + the live payload for a new pair of scale factors. */
  const scaleChange = (
    g: Gesture,
    newScaleX: number,
    newScaleY: number
  ): { patch: Partial<StudioLayer>; live: Record<string, number> } => {
    const hasX = typeof g.init.scaleX === 'number';
    const hasY = typeof g.init.scaleY === 'number';
    const uniform = typeof g.init.scale === 'number' ? g.init.scale : 1;
    if (hasX || hasY) {
      const patch: Partial<StudioLayer> = {
        scaleX: newScaleX,
        scaleY: newScaleY,
      };
      const live: Record<string, number> = { scaleX: newScaleX, scaleY: newScaleY };
      if (typeof g.init.scale === 'number') patch.scale = uniform;
      return { patch, live };
    }
    const s = Math.min(10, Math.max(0.05, (newScaleX + newScaleY) / 2));
    return { patch: { scale: s }, live: { scale: s } };
  };

  const applyResize = (g: Gesture, local: Point, event: PointerEvent) => {
    const layer = findLayer(g.layerId);
    if (!layer) return;
    const m = getMetrics();
    const comp = localToComp(local);

    // the pointer, relative to the layer's centre, in the layer's UNROTATED axes
    const dx = comp.x - g.box.cx;
    const dy = comp.y - g.box.cy;
    const theta = (-g.box.rotation * Math.PI) / 180;
    const dxLocal = dx * Math.cos(theta) - dy * Math.sin(theta);
    const dyLocal = dx * Math.sin(theta) + dy * Math.cos(theta);

    const handle = g.handle;
    const isCorner = handle.length === 2;

    if (isCorner) {
      // proportional scaling around the centre
      const r = Math.hypot(dxLocal, dyLocal);
      const factor = Math.min(10, Math.max(0.05, r / (g.r0 || 1)));
      const baseX = typeof g.init.scaleX === 'number' ? g.init.scaleX : (g.init.scale ?? 1);
      const baseY = typeof g.init.scaleY === 'number' ? g.init.scaleY : (g.init.scale ?? 1);
      const change = scaleChange(
        g,
        Math.min(10, Math.max(0.05, baseX * factor)),
        Math.min(10, Math.max(0.05, baseY * factor))
      );
      store.patchLayer(g.layerId, change.patch);
      postTransform({ layerId: g.layerId, ...change.live });
      return;
    }

    // EDGE handles — the size, not the scale
    const horizontal = handle === 'e' || handle === 'w';
    const vertical = handle === 'n' || handle === 's';
    const deltaW = horizontal ? (handle === 'e' ? dxLocal : -dxLocal) : 0;
    const deltaH = vertical ? (handle === 's' ? dyLocal : -dyLocal) : 0;

    let newVisualW = Math.max(8, g.box.width + deltaW);
    let newVisualH = Math.max(8, g.box.height + deltaH);

    // SHIFT keeps the aspect ratio of the layer
    if (event.shiftKey && horizontal && !vertical && g.box.width > 0) {
      newVisualH = Math.max(8, g.box.height * (newVisualW / g.box.width));
    } else if (event.shiftKey && vertical && !horizontal && g.box.height > 0) {
      newVisualW = Math.max(8, g.box.width * (newVisualH / g.box.height));
    }

    const scaleX = g.box.scaleX || 1;
    const scaleY = g.box.scaleY || 1;
    const targetLayoutW = g.box.layoutWidth + (newVisualW - g.box.width) / scaleX;
    const targetLayoutH = g.box.layoutHeight + (newVisualH - g.box.height) / scaleY;

    const patch: Partial<StudioLayer> = {};
    const live: Record<string, number> = {};

    const layout = layerLayoutSize(layer);
    const hasExplicitSize =
      (layout?.widthPct !== undefined || layout?.heightPct !== undefined) &&
      layer.type !== 'card';

    if (hasExplicitSize) {
      const size = { ...(layout ?? {}) };
      if (horizontal) {
        const widthPct = Math.max(1, (targetLayoutW / m.compW) * 100);
        size.widthPct = widthPct;
        live.widthPct = widthPct;
      }
      if (vertical) {
        const heightPct = Math.max(1, (targetLayoutH / m.compH) * 100);
        size.heightPct = heightPct;
        live.heightPct = heightPct;
      }
      patch.size = size;
    } else if (layer.type === 'kineticText') {
      // the font size IS the layout size of a text layer
      const factor = horizontal
        ? newVisualW / (g.box.width || 1)
        : newVisualH / (g.box.height || 1);
      const sizePx = Math.max(8, Math.round((g.init.sizePx ?? 64) * factor));
      patch.sizePx = sizePx;
      const uniform = typeof g.init.scale === 'number' ? g.init.scale : 1;
      live.scale = Math.min(10, Math.max(0.05, uniform * factor));
      if (typeof g.init.scaleX === 'number') {
        live.scaleX = Math.min(10, Math.max(0.05, g.init.scaleX * factor));
        live.scaleY = Math.min(10, Math.max(0.05, (g.init.scaleY ?? g.init.scaleX) * factor));
      }
    } else if (layer.type === 'card') {
      // a card's width lives in its variant; the live preview scales it
      const variant = { ...layerVariant(layer) };
      if (horizontal) variant.widthPx = Math.max(40, Math.round(targetLayoutW));
      if (vertical && typeof variant.heightPx === 'number') {
        variant.heightPx = Math.max(24, Math.round(targetLayoutH));
      }
      patch.variant = variant;
      live.scaleX = Math.min(10, Math.max(0.05, g.box.scaleX * (newVisualW / (g.box.width || 1))));
      live.scaleY = Math.min(10, Math.max(0.05, g.box.scaleY * (newVisualH / (g.box.height || 1))));
    } else if (layer.type === 'imageLogo' || layer.type === 'lottie') {
      if (horizontal) {
        const widthPx = Math.max(8, Math.round(targetLayoutW));
        patch.widthPx = widthPx;
        live.widthPx = widthPx;
      }
      if (vertical) {
        const heightPx = Math.max(8, Math.round(targetLayoutH));
        patch.heightPx = heightPx;
        live.heightPx = heightPx;
      }
    } else {
      // no explicit size — scale the layer on the dragged axis
      const factorX = newVisualW / (g.box.width || 1);
      const factorY = newVisualH / (g.box.height || 1);
      const change = scaleChange(
        g,
        Math.min(10, Math.max(0.05, g.box.scaleX * factorX)),
        Math.min(10, Math.max(0.05, g.box.scaleY * factorY))
      );
      Object.assign(patch, change.patch);
      Object.assign(live, change.live);
    }

    store.patchLayer(g.layerId, patch);
    postTransform({ layerId: g.layerId, ...live });
  };

  const applyRotate = (g: Gesture, local: Point, event: PointerEvent) => {
    const comp = localToComp(local);
    const angle = (Math.atan2(comp.y - g.box.cy, comp.x - g.box.cx) * 180) / Math.PI + 90;
    let rotation = angle + g.rotationOffset;
    while (rotation > 180) rotation -= 360;
    while (rotation < -180) rotation += 360;
    if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
    rotation = round1(rotation);

    store.patchLayer(g.layerId, { rotation });
    postTransform({ layerId: g.layerId, rotation });
  };

  /**
   * Keep the KEYFRAMES in step with the gesture.
   *
   * A live override pins the property it carries, so a keyframed position
   * would stay frozen at the dragged value. Writing the final value into the
   * keyframe at the playhead releases the pin (the scene is pushed back, the
   * override is dropped) and keeps the drag meaningful.
   */
  const syncKeyframes = (g: Gesture) => {
    const layer = findLayer(g.layerId);
    if (!layer) return;
    const keyframes = layer.keyframes ?? [];
    const touched = g.properties.filter(
      (property) =>
        keyframes.some(
          (kf) => kf.property === property && Math.abs(kf.timeMs - state.playhead) < 20
        )
    );
    if (touched.length === 0) return;

    const finalPosition = layer.position ?? { xPct: 50, yPct: 50 };
    const finalRotation = layer.rotation ?? 0;
    const finalScale = layer.scale ?? 1;

    const valueFor = (property: string): number => {
      if (property === 'xPct') return finalPosition.xPct;
      if (property === 'yPct') return finalPosition.yPct;
      if (property === 'rotation') return finalRotation;
      if (property === 'scale') return finalScale;
      return 0;
    };

    store.updateSceneWithoutHistory((scene) => {
      const target = scene.layers.find((l) => l.id === g.layerId);
      if (!target) return;

      // the flat, unified keyframe surface
      if (target.keyframes?.length) {
        target.keyframes = target.keyframes.map((kf) =>
          touched.includes(kf.property) && Math.abs(kf.timeMs - state.playhead) < 20
            ? { ...kf, value: valueFor(kf.property) }
            : kf
        );
      }

      // the legacy track surface (the runtime still reads it)
      const legacy = target.tracks as
        | Array<{ property?: string; keyframes?: Array<{ at?: number; value?: number }> }>
        | undefined;
      if (legacy?.length) {
        const propertyMap: Record<string, string> = {
          xPct: 'position.xPct',
          yPct: 'position.yPct',
          scale: 'scale',
          rotation: 'rotation',
        };
        target.tracks = legacy.map((track) => {
          const property = track.property ?? '';
          const source = Object.entries(propertyMap).find(([, legacyName]) => legacyName === property);
          if (!source) return track;
          const [flatName] = source;
          if (!touched.includes(flatName)) return track;
          return {
            ...track,
            keyframes: (track.keyframes ?? []).map((kf) =>
              typeof kf.at === 'number' && Math.abs(kf.at - state.playhead) < 20
                ? { ...kf, value: valueFor(flatName) }
                : kf
            ),
          };
        }) as never;
      }
    });
  };

  const handlePointerDown = (event: PointerEvent) => {
    const viewport = props.viewportRef();
    if (!viewport) return;
    const local = toLocal(event);

    if (state.activeTool === 'hand' || isSpacePressed || event.button === 1) {
      setDragMode('pan');
      panStart = local;
      capturePointer(event.currentTarget as HTMLElement, event.pointerId);
      return;
    }

    // THE CREATION TOOLS.
    //
    // The Text tool and the Card tool used to only ARM themselves: clicking
    // the canvas with either one selected nothing and created nothing, which
    // made them look broken. A creation tool now records the click and the
    // layer appears WHERE THE USER CLICKED.
    const creationKind = CREATION_TOOL_KINDS[state.activeTool];
    if (creationKind) {
      setToolClick(local);
      setDragMode('marquee');
      marqueeStart = local;
      setMarqueeRect({ x: local.x, y: local.y, width: 0, height: 0 });
      capturePointer(event.currentTarget as HTMLElement, event.pointerId);
      return;
    }

    const target = event.target as Element | null;
    const handle = target?.getAttribute?.('data-handle');
    if (handle) {
      const selected = primarySelectedLayer();
      if (selected) {
        if (selected.locked) {
          store.addToast(`Layer "${selected.name ?? selected.id}" is locked`, 'warning');
          return;
        }
        if (handle === 'rotate') startRotate(selected, local);
        else startResize(selected, handle, local);
        capturePointer(event.currentTarget as HTMLElement, event.pointerId);
      }
      return;
    }

    // the selection box carries its layer id: clicking it always moves THAT
    // layer, even when another layer overlaps it
    const clickedLayerId = target?.getAttribute?.('data-layer-id');
    const hit = clickedLayerId ? (findLayer(clickedLayerId) ?? null) : hitTest(local);
    if (hit) {
      if (hit.locked) {
        store.addToast(`Layer "${hit.name ?? hit.id}" is locked`, 'warning');
        return;
      }
      if (!selectedLayers().some((l) => l.id === hit.id)) {
        store.selectLayer(hit.id, event.shiftKey);
      }
      startMove(hit, local);
      capturePointer(event.currentTarget as HTMLElement, event.pointerId);
      return;
    }

    if (!event.shiftKey) store.selectLayer(null);
    setDragMode('marquee');
    marqueeStart = localToComp(local);
    setMarqueeRect({ x: marqueeStart.x, y: marqueeStart.y, width: 0, height: 0 });
    capturePointer(event.currentTarget as HTMLElement, event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent) => {
    const mode = dragMode();

    if (mode === 'none') {
      if (state.scene?.layers && state.activeTool === 'select') {
        setHoveredLayerId(hitTest(toLocal(event))?.id ?? null);
      }
      return;
    }

    if (mode === 'pan') {
      const local = toLocal(event);
      const dx = local.x - panStart.x;
      const dy = local.y - panStart.y;
      panStart = local;
      store.setViewportPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      return;
    }

    if (mode === 'marquee') {
      const current = localToComp(toLocal(event));
      setMarqueeRect({
        x: Math.min(marqueeStart.x, current.x),
        y: Math.min(marqueeStart.y, current.y),
        width: Math.abs(current.x - marqueeStart.x),
        height: Math.abs(current.y - marqueeStart.y),
      });
      return;
    }

    const g = gesture;
    if (!g) return;
    const local = toLocal(event);

    if (!g.moved) {
      const moved = Math.hypot(local.x - g.startLocal.x, local.y - g.startLocal.y);
      if (moved < 2) return;
      g.moved = true;
      // ONE undo entry for the whole gesture
      store.pushHistory(
        g.mode === 'move'
          ? `Move layer: ${findLayer(g.layerId)?.name ?? g.layerId}`
          : g.mode === 'rotate'
            ? `Rotate layer: ${findLayer(g.layerId)?.name ?? g.layerId}`
            : `Transform layer: ${findLayer(g.layerId)?.name ?? g.layerId}`
      );
    }

    if (g.mode === 'move') applyMove(g, local, event);
    else if (g.mode === 'resize') applyResize(g, local, event);
    else if (g.mode === 'rotate') applyRotate(g, local, event);
  };

  const handlePointerUp = () => {
    const g = gesture;
    const mode = dragMode();
    gesture = null;

    setDragMode('none');
    setActiveGuides([]);
    setHud(null);

    // THE CREATION TOOLS — a click (not a drag) creates the layer.
    const click = toolClick();
    setToolClick(null);
    if (click) {
      const kind = CREATION_TOOL_KINDS[state.activeTool];
      if (kind) {
        const comp = localToComp(click);
        const metrics = getMetrics();
        const xPct = metrics.stageW ? (comp.x / metrics.stageW) * 100 : 50;
        const yPct = metrics.stageH ? (comp.y / metrics.stageH) * 100 : 50;
        const id = store.addLayerOfKindAt(kind, xPct, yPct);
        if (id) {
          // the new layer becomes the selection, and the inspector shows it
          store.selectLayer(id);
          void store.executeSave().catch(() => undefined);
        }
        return;
      }
    }

    if (mode === 'marquee') {
      const m = marqueeRect();
      setMarqueeRect(null);
      if (m && m.width > 5 && m.height > 5 && state.scene?.layers) {
        const intersected: string[] = [];
        for (const layer of state.scene.layers) {
          if (isFullBleed(layer)) continue;
          const box = getLayerBox(layer);
          if (
            box.cx - box.width / 2 < m.x + m.width &&
            box.cx + box.width / 2 > m.x &&
            box.cy - box.height / 2 < m.y + m.height &&
            box.cy + box.height / 2 > m.y
          ) {
            intersected.push(layer.id);
          }
        }
        if (intersected.length > 0) {
          store.selectLayer(intersected[0] ?? null);
          for (const id of intersected.slice(1)) store.selectLayer(id, true);
        }
      }
      return;
    }

    if (!g || !g.moved) return;

    // release the live override where a keyframe would otherwise stay pinned
    // (this rewrites the scene, so it runs BEFORE the save snapshots it)
    syncKeyframes(g);
    // ONE atomic save for the whole gesture
    void store.executeSave().catch(() => undefined);
  };

  const handlePointerCancel = () => {
    gesture = null;
    setDragMode('none');
    setActiveGuides([]);
    setMarqueeRect(null);
    setHud(null);
  };

  /* ── inline text editing ─────────────────────────────────────────────── */

  /**
   * Open the inline editor on a layer.
   *
   * A CARD opens the SAME editor as a text layer — the editor is not a
   * second implementation, it is the same contenteditable, styled like the
   * layer. The card's `variant.title` and `variant.body` are the two fields
   * it edits, and the editor's field switcher offers exactly the ones the
   * card's CURRENT treatment declares.
   */
  const openEditor = (layer: StudioLayer) => {
    if (layer.type === 'kineticText') {
      setEditing({ layerId: layer.id, field: 'text' });
      return;
    }
    if (layer.type === 'card') {
      const variant = layerVariant(layer);
      const hasTitle = typeof variant.title === 'string';
      const hasBody = typeof variant.body === 'string';
      const field: EditableField = hasTitle ? 'title' : hasBody ? 'body' : 'title';
      setEditing({ layerId: layer.id, field });
    }
  };

  const handleDoubleClick = (event: MouseEvent) => {
    const target = event.target as Element | null;
    if (target?.getAttribute?.('data-handle')) return;
    const hit = hitTest(toLocal(event));
    if (!hit) return;
    if (!isEditable(hit)) return;
    event.preventDefault();
    store.selectLayer(hit.id);
    openEditor(hit);
  };

  const handleWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.1 : 0.1;
      const next = Math.max(0.25, Math.min(4, Math.round((state.viewportZoom + delta) * 100) / 100));
      props.onZoom?.(next);
    }
  };

  const commitEdit = (field: EditableField, value: string) => {
    const target = editing();
    setEditing(null);
    if (!target) return;
    const layer = findLayer(target.layerId);
    if (!layer) return;
    if (field === 'text') {
      if ((layer.text ?? '') === value) return;
      store.updateLayer(layer.id, { text: value }, `Edit text: ${layer.name ?? layer.id}`);
    } else {
      const variant = layerVariant(layer);
      if ((variant[field] ?? '') === value) return;
      // the card's variant is a DISCRIMINATED union — it is REBUILT, never
      // spread, so the edit can never carry a key the treatment rejects
      const next = updateCardVariant(variant, { [field]: value });
      store.updateLayer(
        layer.id,
        { variant: next },
        field === 'title' ? `Edit card title: ${layer.name ?? layer.id}` : `Edit card body: ${layer.name ?? layer.id}`
      );
    }
    void store.executeSave().catch(() => undefined);
  };

  /* ── rendering ───────────────────────────────────────────────────────── */

  const cursorClass = () => {
    if (state.activeTool === 'hand' || isSpacePressed) {
      return dragMode() === 'pan' ? 'is-panning' : 'is-hand';
    }
    if (state.activeTool === 'razor') return 'is-razor';
    return '';
  };

  /** The gizmo of one layer, in overlay-local px. */
  const gizmoFor = (layer: StudioLayer) => {
    const m = getMetrics();
    const box = getLayerBox(layer);
    return {
      cx: m.stageLeft + box.cx * m.scale,
      cy: m.stageTop + box.cy * m.scale,
      w: box.width * m.scale,
      h: box.height * m.scale,
      rotation: box.rotation,
      box,
    };
  };

  const editingLayer = createMemo(() => {
    const target = editing();
    if (!target) return null;
    const layer = findLayer(target.layerId);
    return layer ? { layer, field: target.field } : null;
  });

  const editingRect = createMemo(() => {
    const target = editingLayer();
    if (!target) return null;
    const m = getMetrics();
    const box = getLayerBox(target.layer);
    const left = m.stageLeft + (box.cx - box.width / 2) * m.scale;
    const top = m.stageTop + (box.cy - box.height / 2) * m.scale;
    return {
      left,
      top,
      width: box.width * m.scale,
      height: box.height * m.scale,
      rotation: box.rotation,
    };
  });

  return (
    <div
      id="canvas-overlay"
      class={`mf-viewport-overlay ${cursorClass()}`}
      style={{ 'pointer-events': 'auto' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDblClick={handleDoubleClick}
      onWheel={handleWheel}
    >
      <svg class="w-full h-full overflow-visible pointer-events-none">
        {/* smart alignment guides */}
        <For each={activeGuides()}>
          {(guide) => {
            const color = guide.kind === 'canvas' ? 'var(--mf-keyframe)' : 'var(--mf-warning)';
            if (guide.axis === 'x') {
              const pt = compToLocal(guide.pos, 0);
              return (
                <g class="snap-guide-group">
                  <line
                    x1={pt.x}
                    y1={0}
                    x2={pt.x}
                    y2="100%"
                    stroke={color}
                    stroke-width="1"
                    stroke-dasharray="4 3"
                  />
                  <Show when={guide.label}>
                    <rect
                      x={pt.x + 4}
                      y={4}
                      width={guide.label!.length * 6 + 8}
                      height={14}
                      rx={2}
                      fill="var(--mf-bg-gutter)"
                      fill-opacity="0.9"
                      stroke={color}
                      stroke-width="0.75"
                    />
                    <text
                      x={pt.x + 8}
                      y={14}
                      fill={color}
                      font-size="9"
                      font-family="var(--mf-font-mono)"
                    >
                      {guide.label}
                    </text>
                  </Show>
                </g>
              );
            }
            const pt = compToLocal(0, guide.pos);
            return (
              <g class="snap-guide-group">
                <line
                  x1={0}
                  y1={pt.y}
                  x2="100%"
                  y2={pt.y}
                  stroke={color}
                  stroke-width="1"
                  stroke-dasharray="4 3"
                />
                <Show when={guide.label}>
                  <rect
                    x={4}
                    y={pt.y - 18}
                    width={guide.label!.length * 6 + 8}
                    height={14}
                    rx={2}
                    fill="var(--mf-bg-gutter)"
                    fill-opacity="0.9"
                    stroke={color}
                    stroke-width="0.75"
                  />
                  <text
                    x={8}
                    y={pt.y - 7}
                    fill={color}
                    font-size="9"
                    font-family="var(--mf-font-mono)"
                  >
                    {guide.label}
                  </text>
                </Show>
              </g>
            );
          }}
        </For>

        {/* marquee */}
        <Show when={marqueeRect()}>
          {(() => {
            const m = marqueeRect()!;
            const tl = compToLocal(m.x, m.y);
            const br = compToLocal(m.x + m.width, m.y + m.height);
            return (
              <rect
                x={tl.x}
                y={tl.y}
                width={Math.max(1, br.x - tl.x)}
                height={Math.max(1, br.y - tl.y)}
                fill="var(--mf-gizmo-fill)"
                stroke="var(--mf-keyframe)"
                stroke-width="1"
                stroke-dasharray="3 3"
              />
            );
          })()}
        </Show>

        {/* hovered layer outline */}
        <Show
          when={
            hoveredLayerId() &&
            !selectedLayers().some((l) => l.id === hoveredLayerId()) &&
            state.scene?.layers
          }
        >
          {(() => {
            const layer = state.scene!.layers.find((x) => x.id === hoveredLayerId());
            if (!layer) return null;
            const g = gizmoFor(layer);
            return (
              <g transform={`translate(${g.cx} ${g.cy}) rotate(${g.rotation})`}>
                <rect
                  x={-g.w / 2}
                  y={-g.h / 2}
                  width={g.w}
                  height={g.h}
                  fill="none"
                  stroke="var(--mf-keyframe)"
                  stroke-opacity="0.5"
                  stroke-width="1"
                  stroke-dasharray="3 3"
                />
              </g>
            );
          })()}
        </Show>

        {/* secondary selections */}
        <For each={selectedLayers().slice(1)}>
          {(layer) => {
            const g = createMemo(() => gizmoFor(layer));
            return (
              <g
                class="mf-gizmo-secondary"
                data-layer-id={layer.id}
                transform={`translate(${g().cx} ${g().cy}) rotate(${g().rotation})`}
              >
                <rect
                  x={-g().w / 2}
                  y={-g().h / 2}
                  width={g().w}
                  height={g().h}
                  fill="none"
                  stroke="var(--mf-gizmo-soft)"
                  stroke-width="1"
                  stroke-dasharray="4 3"
                />
              </g>
            );
          }}
        </For>

        {/* THE gizmo — one <g>, one rotation, applied exactly once */}
        <Show when={primarySelectedLayer()}>
          {(layer) => {
            const g = createMemo(() => gizmoFor(layer()));
            return (
              <g
                id="selection-gizmo"
                class="mf-gizmo"
                data-layer-id={layer().id}
                data-rotation={g().rotation}
                data-handle-count={HANDLE_LAYOUT.length + 1}
                transform={`translate(${g().cx} ${g().cy}) rotate(${g().rotation})`}
                style={{ filter: 'drop-shadow(0 0 3px rgba(59, 130, 246, 0.5))' }}
              >
                <rect
                  id="selection-bounding-box"
                  data-layer-id={layer().id}
                  x={-g().w / 2}
                  y={-g().h / 2}
                  width={g().w}
                  height={g().h}
                  fill="var(--mf-gizmo-fill)"
                  stroke="var(--mf-gizmo)"
                  stroke-width="1"
                  class="cursor-move pointer-events-auto"
                />

                {/* the rotation stem */}
                <line
                  x1={0}
                  y1={-g().h / 2}
                  x2={0}
                  y2={-g().h / 2 - ROTATE_STEM}
                  stroke="var(--mf-gizmo)"
                  stroke-width="1"
                />
                <circle
                  cx={0}
                  cy={-g().h / 2 - ROTATE_STEM}
                  r={5}
                  fill="var(--mf-gizmo)"
                  stroke="#ffffff"
                  stroke-width="1.25"
                  data-handle="rotate"
                  class="cursor-crosshair pointer-events-auto"
                />

                {/* the eight resize handles */}
                <For each={HANDLE_LAYOUT}>
                  {(handle) => (
                    <rect
                      x={handle.fx * g().w - HANDLE_SIZE / 2}
                      y={handle.fy * g().h - HANDLE_SIZE / 2}
                      width={HANDLE_SIZE}
                      height={HANDLE_SIZE}
                      rx={2.5}
                      fill="#ffffff"
                      stroke="var(--mf-gizmo)"
                      stroke-width="1.25"
                      data-handle={handle.k}
                      class={`${handle.cursor} pointer-events-auto`}
                    />
                  )}
                </For>

                {/* the centre anchor */}
                <g class="mf-gizmo-anchor" style={{ 'pointer-events': 'none' }}>
                  <line
                    x1={-ANCHOR_SIZE}
                    y1={0}
                    x2={ANCHOR_SIZE}
                    y2={0}
                    stroke="var(--mf-gizmo)"
                    stroke-width="1"
                  />
                  <line
                    x1={0}
                    y1={-ANCHOR_SIZE}
                    x2={0}
                    y2={ANCHOR_SIZE}
                    stroke="var(--mf-gizmo)"
                    stroke-width="1"
                  />
                </g>
              </g>
            );
          }}
        </Show>
      </svg>

      {/* the discoverable "edit this text" affordance */}
      <Show when={primarySelectedLayer()}>
        {(layer) => (
          <Show when={isEditable(layer()) && !editing()}>
            {(() => {
              const g = createMemo(() => gizmoFor(layer()));
              return (
                <div
                  class="mf-canvas-edit-toolbar"
                  id="canvas-edit-toolbar"
                  style={{
                    position: 'absolute',
                    left: `${g().cx - g().w / 2}px`,
                    top: `${g().cy - g().h / 2 - 26}px`,
                    display: 'flex',
                    'align-items': 'center',
                    gap: '2px',
                    padding: '2px',
                    background: 'var(--mf-bg-elevated)',
                    border: '1px solid var(--mf-border-focus)',
                    'border-radius': 'var(--mf-radius-xs, var(--radius-xs, 4px))',
                    'box-shadow': 'var(--shadow-sm)',
                    'z-index': '25',
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    id="canvas-edit-button"
                    class="mf-btn is-icon"
                    title="Edit text (double-click the layer)"
                    aria-label="Edit text"
                    style={{ width: '20px', height: '18px', color: 'var(--mf-accent-text)' }}
                    onClick={() => openEditor(layer())}
                  >
                    <IconPencil size={12} />
                  </button>
                </div>
              );
            })()}
          </Show>
        )}
      </Show>

      {/* the inline editor */}
      <Show when={editingLayer() && editingRect()}>
        {(() => {
          const target = editingLayer()!;
          const rect = editingRect()!;
          return (
            <InlineTextEditor
              layer={target.layer}
              field={target.field}
              rect={rect}
              scale={getMetrics().scale}
              onCommit={commitEdit}
              onCancel={() => setEditing(null)}
              onFieldChange={(field) => setEditing({ layerId: target.layer.id, field })}
            />
          );
        })()}
      </Show>

      {/* live coordinate HUD */}
      <Show when={hud()}>
        {(value) => (
          <div class="mf-hud" id="canvas-hud">
            <span>X: {value().x.toFixed(1)}%</span>
            <span>Y: {value().y.toFixed(1)}%</span>
            <span>
              ΔX: {value().dx >= 0 ? '+' : ''}
              {value().dx.toFixed(1)}
            </span>
            <span>
              ΔY: {value().dy >= 0 ? '+' : ''}
              {value().dy.toFixed(1)}
            </span>
          </div>
        )}
      </Show>
    </div>
  );
};
