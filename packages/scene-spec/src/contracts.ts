/**
 * SHARED REPORT CONTRACTS.
 *
 * WHY THIS FILE EXISTS: the reports below are produced by the ENGINE, consumed
 * by the MCP SERVER and by the STUDIO, and asserted on by the benchmarks.
 * When three packages each spelled the same field three ways, every consumer
 * grew a private fallback — and a fallback is where a silent wrong value hides.
 *
 * So the shapes live in `@motionforge/scene-spec`: the one package every other
 * package already depends on, and the package that owns the SceneSpec itself.
 * The engine, the MCP server and the Studio all import these types, so a
 * rename is a compile error in every consumer at once.
 *
 * These are DATA contracts (plain JSON shapes), not Zod schemas — they are
 * produced by the engine and consumed by tools, not authored by a human.
 */

/**
 * The camera-INDEPENDENT composition box of a layer.
 *
 * The `bbox` in a layer report is the PAINTED box — what the camera rig
 * actually put on screen, so it moves when the camera moves. This box is the
 * layer's own geometry in composition (design-space) pixels: the anchor, the
 * visual size and the rotation, with no camera applied.
 *
 * A consumer that wants to reason about the AUTHORED layout (does this card
 * fit the canvas? where did the author put it?) reads this box; a consumer
 * that wants to reason about the FRAME (is anything colliding right now?)
 * reads `bbox`.
 */
export interface BoundsCompositionBox {
  /** UNROTATED local box LEFT, composition px */
  x: number;
  /** UNROTATED local box TOP, composition px */
  y: number;
  /** VISUAL width, composition px */
  width: number;
  /** VISUAL height, composition px */
  height: number;
  /** the transformed centre x, composition px */
  cx: number;
  /** the transformed centre y, composition px */
  cy: number;
  /** the current rotation, in degrees */
  rotation: number;
}

/** One layer's state on one frame. */
export interface BoundsLayerReport {
  id: string;
  type: string;
  lifecyclePhase: "entrance" | "settled" | "emphasis" | "exit";
  phaseProgressPct: number;
  opacity: number;
  /** UNROTATED box, in composition px */
  bbox: { x: number; y: number; width: number; height: number };
  /** the layer's own text is clipped by its box */
  textOverflow: boolean;
  /**
   * The camera-independent composition box, when the measurement could read
   * one. Optional: a runtime older than the warm page does not publish it.
   */
  compositionBox?: BoundsCompositionBox;
}

/** Two layers whose boxes intersect on a frame. */
export interface BoundsOverlapReport {
  a: string;
  b: string;
  /** the intersection area, in square composition px */
  areaPx2: number;
  /**
   * The box of `a` and the box of `b`.
   *
   * WHY THEY ARE HERE: a consumer that wants to FIX an overlap needs the
   * geometry, not just the fact of one. Which of the two is the upper box,
   * how deep the intersection is and how far the lower one has to move are
   * all answers that need the boxes — and the agent that has to author the
   * fix should not have to ask a second question to get them.
   */
  aBox: { x: number; y: number; width: number; height: number };
  bBox: { x: number; y: number; width: number; height: number };
}

/** A layer that extends past the canvas edge on a frame. */
export interface BoundsOffscreenReport {
  id: string;
  type: string;
  bbox: { x: number; y: number; width: number; height: number };
  /** which edges the box crosses */
  edges: Array<"left" | "right" | "top" | "bottom">;
}

/** The camera pose on a frame. */
export interface BoundsCameraReport {
  scale: number;
  xPct: number;
  yPct: number;
  roll: number;
  yaw: number;
  pitch: number;
  /** the runtime held the camera inside the canvas because the pose exceeded it */
  clampedVoid: boolean;
  /** the look-at the scene ASKED for, when the renderer could not honour it */
  unclampedXPct?: number;
  unclampedYPct?: number;
}

/** Everything the engine knows about ONE frame — no pixels involved. */
export interface BoundsFrameReport {
  atMs: number;
  camera: BoundsCameraReport;
  layers: BoundsLayerReport[];
  /** the ids of the layers that carry visible content on this frame */
  foreground: string[];
  /** pairs of visible layers whose boxes intersect */
  overlaps: BoundsOverlapReport[];
  /** visible layers that extend past the canvas edge */
  offscreen: BoundsOffscreenReport[];
  /** the active transitions and their phase */
  activeTransitions?: Array<{ kind: string; progressPct: number; phase: "in" | "peak" | "out" }>;
}

/**
 * The ZERO-RASTERISATION layout report of a scene.
 *
 * This is the payload of `get_layer_bounds`: the numbers a layout check needs,
 * computed in the page in milliseconds, with no screenshot anywhere.
 */
export interface SceneBoundsReport {
  sceneId: string;
  canvas: { width: number; height: number };
  frames: BoundsFrameReport[];
  /** how long the measurement took, in ms */
  elapsedMs: number;
  /** true when the measurement came from a warm (already-mounted) page */
  warm: boolean;
}

/** A feature that makes a frame expensive to rasterise. */
export interface HeavyEffectReport {
  /** the layer id the effect belongs to */
  layerId: string;
  layerType: string;
  /** the effect's name — "meshGradient", "filmGrain", "blur", "blendMode"… */
  effect: string;
  /** the per-frame cost multiplier this effect adds, e.g. 1.95 */
  multiplier: number;
  /** why it is expensive, in one sentence */
  reason: string;
}

/** The estimated cost of rendering a scene. */
export interface SceneCostReport {
  /** the combined per-frame cost multiplier (1 = a plain scene) */
  perFrameMultiplier: number;
  /** the estimated milliseconds per frame on THIS host */
  estimatedFrameMs: number;
  /** the estimated total render time, in ms */
  estimatedTotalMs: number;
  /** the number of frames the estimate covers */
  frames: number;
  /** the worker budget the engine will use for this scene */
  workerBudget: number;
  /** the individual expensive features, biggest first */
  heavyEffects: HeavyEffectReport[];
  /** the host facts the estimate is based on */
  host: { cpus: number; totalMemGb: number; softwareRasterised: boolean };
  /** human-readable reasons for the estimate */
  notes: string[];
}

/** A non-blocking problem the engine found in a scene. */
export interface AnalysisWarningReport {
  code: string;
  path: string;
  message: string;
  detail?: Record<string, unknown>;
}

/** The full static + dynamic analysis of a scene. */
export interface SceneAnalysisReport {
  sceneId: string;
  layerCount: number;
  durationMs: number;
  warnings: AnalysisWarningReport[];
  cost: SceneCostReport;
  /**
   * Which keyframe array wins when a layer carries both.
   *
   * Documented in the contract so an agent never has to guess: the flat
   * `keyframes` array is canonical.
   */
  keyframePrecedence: {
    canonical: "keyframes";
    legacy: "tracks";
    rule: string;
    /** the layers that carry BOTH arrays, with the conflict spelled out */
    conflicts: Array<{ layerId: string; canonicalProperties: string[]; legacyProperties: string[] }>;
  };
}

/** One stream of an encoded file. */
export interface MediaStreamReport {
  index: number;
  type: "video" | "audio" | "other";
  codec: string;
  profile?: string;
  width?: number;
  height?: number;
  fps?: number;
  sampleRate?: number;
  channels?: number;
  durationSec?: number;
  bitRate?: number;
  frameCount?: number;
}

/** The ffprobe view of an encoded file. */
export interface MediaProbeReport {
  path: string;
  sizeBytes: number;
  durationSec: number;
  format: string;
  bitRate?: number;
  streams: MediaStreamReport[];
}

/** The full result of a finished render. */
export interface RenderResultReport {
  jobId: string;
  sceneId: string;
  quality: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  error?: string;
  /** the file the render produced */
  outputPath?: string;
  /** the ffprobe view of that file (present once the render succeeded) */
  probe?: MediaProbeReport;
  /** the render telemetry */
  telemetry?: {
    frames: number;
    wallMs: number;
    effectiveFps: number;
    encoder: string;
    workerCount: number;
    profile: { quality: string; fps: number; outWidth: number; outHeight: number; jpegQuality: number };
  };
}
