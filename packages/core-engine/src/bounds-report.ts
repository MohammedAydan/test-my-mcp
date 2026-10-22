/**
 * THE ZERO-RASTERISATION BOUNDS REPORT.
 *
 * Everything a layout check needs is a NUMBER: where a layer sits, whether
 * two layers collide, whether anything hangs off the canvas edge, where the
 * camera is pointing. None of that needs pixels — and paying for pixels was
 * the whole reason an inspection used to cost six seconds a frame.
 *
 * So this module turns the runtime's frame description into the shared
 * `BoundsFrameReport` contract. It is deliberately PURE: no browser, no I/O,
 * no clock. That makes it testable without a browser, and it makes the
 * engine's answer reproducible.
 */
import {
  isFullBleedLayerType,
  type BoundsCameraReport,
  type BoundsCompositionBox,
  type BoundsFrameReport,
  type BoundsLayerReport,
  type BoundsOffscreenReport,
  type BoundsOverlapReport,
} from "@motionforge/scene-spec";

/** A layer below this opacity is not painted — it cannot collide. */
export const VISIBLE_OPACITY = 0.01;

/** The runtime's per-frame description, as far as this report cares. */
export interface RuntimeFrameDescription {
  camera?: {
    scale?: number;
    xPct?: number;
    yPct?: number;
    roll?: number;
    yaw?: number;
    pitch?: number;
    clampedVoid?: boolean;
    unclampedXPct?: number;
    unclampedYPct?: number;
  };
  layers?: Array<{
    id?: string;
    type?: string;
    lifecyclePhase?: BoundsLayerReport["lifecyclePhase"];
    phaseProgressPct?: number;
    opacity?: number;
    bbox?: { x?: number; y?: number; width?: number; height?: number };
    textOverflow?: boolean;
  }>;
  foreground?: string[];
  activeTransitions?: Array<{ kind?: string; progressPct?: number; phase?: "in" | "peak" | "out" }>;
}

/** The composition box the runtime publishes for one layer. */
interface RuntimeLayerBox {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  cx?: number;
  cy?: number;
  rotation?: number;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalNum(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function box(value: unknown): { x: number; y: number; width: number; height: number } {
  const raw = (value ?? {}) as { x?: number; y?: number; width?: number; height?: number };
  return {
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    width: num(raw.width, 0),
    height: num(raw.height, 0),
  };
}

/** The camera pose of one frame. */
export function buildCameraReport(describe: RuntimeFrameDescription | null): BoundsCameraReport {
  const camera = describe?.camera ?? {};
  const unclampedX = optionalNum(camera.unclampedXPct);
  const unclampedY = optionalNum(camera.unclampedYPct);
  return {
    scale: num(camera.scale, 1),
    xPct: num(camera.xPct, 50),
    yPct: num(camera.yPct, 50),
    roll: num(camera.roll, 0),
    yaw: num(camera.yaw, 0),
    pitch: num(camera.pitch, 0),
    clampedVoid: camera.clampedVoid === true,
    ...(unclampedX !== undefined ? { unclampedXPct: unclampedX } : {}),
    ...(unclampedY !== undefined ? { unclampedYPct: unclampedY } : {}),
  };
}

/** The camera-independent composition box of one layer, when the page gave one. */
export function buildCompositionBox(raw: unknown): BoundsCompositionBox | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as RuntimeLayerBox;
  const x = optionalNum(source.x);
  const y = optionalNum(source.y);
  const width = optionalNum(source.width);
  const height = optionalNum(source.height);
  const cx = optionalNum(source.cx);
  const cy = optionalNum(source.cy);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  return {
    x,
    y,
    width,
    height,
    cx: cx ?? x + width / 2,
    cy: cy ?? y + height / 2,
    rotation: num(source.rotation, 0),
  };
}

/**
 * The pairs of VISIBLE layers whose boxes intersect.
 *
 * Full-bleed layers (`background`, `foregroundFX`, `particleField`) are
 * excluded from BOTH sides of every pair: a background is SUPPOSED to cover
 * the whole canvas, and calling that an overlap is a false positive.
 */
export function findOverlaps(layers: readonly BoundsLayerReport[]): BoundsOverlapReport[] {
  const candidates = layers.filter(
    (layer) => layer.opacity > VISIBLE_OPACITY && !isFullBleedLayerType(layer.type)
  );
  const overlaps: BoundsOverlapReport[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      const width =
        Math.min(a.bbox.x + a.bbox.width, b.bbox.x + b.bbox.width) - Math.max(a.bbox.x, b.bbox.x);
      const height =
        Math.min(a.bbox.y + a.bbox.height, b.bbox.y + b.bbox.height) - Math.max(a.bbox.y, b.bbox.y);
      if (width <= 0 || height <= 0) continue;
      overlaps.push({
        a: a.id,
        b: b.id,
        areaPx2: Math.round(width * height * 10) / 10,
        aBox: { ...a.bbox },
        bBox: { ...b.bbox },
      });
    }
  }
  return overlaps;
}

/**
 * The visible layers that hang off the canvas edge.
 *
 * Full-bleed layers are excluded for the same reason as in `findOverlaps`.
 */
export function findOffscreen(
  layers: readonly BoundsLayerReport[],
  canvas: { width: number; height: number }
): BoundsOffscreenReport[] {
  const offscreen: BoundsOffscreenReport[] = [];
  for (const layer of layers) {
    if (layer.opacity <= VISIBLE_OPACITY) continue;
    if (isFullBleedLayerType(layer.type)) continue;
    const edges: BoundsOffscreenReport["edges"] = [];
    if (layer.bbox.x < 0) edges.push("left");
    if (layer.bbox.x + layer.bbox.width > canvas.width) edges.push("right");
    if (layer.bbox.y < 0) edges.push("top");
    if (layer.bbox.y + layer.bbox.height > canvas.height) edges.push("bottom");
    if (edges.length === 0) continue;
    offscreen.push({ id: layer.id, type: layer.type, bbox: layer.bbox, edges });
  }
  return offscreen;
}

/**
 * Build the report of ONE frame.
 *
 * `describe` is whatever the runtime published for this frame; `bounds` is
 * the composition-space box of every mounted layer. A runtime that publishes
 * nothing degrades to an empty frame — it never throws.
 */
export function buildBoundsFrameReport(opts: {
  atMs: number;
  describe: unknown;
  bounds: Record<string, unknown>;
  canvas: { width: number; height: number };
}): BoundsFrameReport {
  const describe = (opts.describe ?? null) as RuntimeFrameDescription | null;
  const rawLayers = Array.isArray(describe?.layers) ? describe!.layers! : [];

  const layers: BoundsLayerReport[] = rawLayers.map((raw, index) => {
    const id = typeof raw.id === "string" ? raw.id : `layer-${index}`;
    const type = typeof raw.type === "string" ? raw.type : "unknown";
    const compositionBox = buildCompositionBox(opts.bounds?.[id]);
    return {
      id,
      type,
      lifecyclePhase: raw.lifecyclePhase ?? "settled",
      phaseProgressPct: num(raw.phaseProgressPct, 0),
      opacity: num(raw.opacity, 0),
      bbox: box(raw.bbox),
      textOverflow: raw.textOverflow === true,
      ...(compositionBox ? { compositionBox } : {}),
    };
  });

  const foreground = Array.isArray(describe?.foreground)
    ? describe!.foreground!.filter((id): id is string => typeof id === "string")
    : [];

  const activeTransitions = Array.isArray(describe?.activeTransitions)
    ? describe!.activeTransitions!.map((transition) => ({
        kind: typeof transition.kind === "string" ? transition.kind : "unknown",
        progressPct: num(transition.progressPct, 0),
        phase: (transition.phase ?? "in") as "in" | "peak" | "out",
      }))
    : undefined;

  return {
    atMs: opts.atMs,
    camera: buildCameraReport(describe),
    layers,
    foreground,
    overlaps: findOverlaps(layers),
    offscreen: findOffscreen(layers, opts.canvas),
    ...(activeTransitions ? { activeTransitions } : {}),
  };
}
