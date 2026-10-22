/**
 * Deterministic render/preview contract between the runtime and core-engine.
 * The engine waits for `whenSceneReady()`, then drives frames exclusively via
 * `seekToFrame(n)` — never wall-clock time.
 */
import type { FrameDescription } from "./scene-builder.js";

export interface RenderConfig {
  fps: number;
  width: number;
  height: number;
  durationMs: number;
  totalFrames: number;
}

/**
 * The EXACT geometry of one layer, in composition (design-space) pixels.
 *
 * THE BUG THIS FIXES: the report used to be the element's SCREEN rectangle —
 * which is the ROTATED box, measured in screen pixels. The Studio then
 * applied `rotate()` to that box AGAIN, so the gizmo was double-rotated, its
 * centre was wrong, and the box escaped the stage.
 *
 * So the report separates the two things a consumer actually needs:
 *
 * - `x` / `y` / `width` / `height` — the UNROTATED local box, centred on the
 *   layer's anchor, sized by the layer's VISUAL scale,
 * - `rotation` / `scaleX` / `scaleY` — the transform that has to be applied
 *   to that box to get the on-screen shape.
 *
 * `cx` / `cy` are the exact transformed centre — the anchor, because the
 * content is centred on it.
 */
export interface LayerBoundsReport {
  /** UNROTATED local box LEFT, in composition px */
  x: number;
  /** UNROTATED local box TOP, in composition px */
  y: number;
  /** VISUAL width (layout width × scaleX), composition px */
  width: number;
  /** VISUAL height (layout height × scaleY), composition px */
  height: number;
  /** unscaled layout width, composition px */
  layoutWidth: number;
  /** unscaled layout height, composition px */
  layoutHeight: number;
  /** exact transformed CENTER x, composition px */
  cx: number;
  /** exact transformed CENTER y, composition px */
  cy: number;
  /** current rotation, degrees */
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export type Seekable = (timeSec: number) => Promise<void>;

declare global {
  interface Window {
    renderConfig?: RenderConfig;
    masterTimeline?: unknown;
    seekToFrame(frame: number): Promise<void>;
    whenSceneReady(): Promise<void>;
    /**
     * Numeric description of the scene at a timestamp: camera pose, live
     * transition phase and per-layer lifecycle / opacity / bbox / overflow.
     *
     * Read by `inspect_scene_keyframes` so an agent can distinguish "this layer
     * is mid-entrance" from "this layer is broken" — and so a clipped word or an
     * off-canvas camera is reported as data instead of having to be spotted in
     * the pixels.
     */
    describeFrame?(timeMs: number): FrameDescription;
    /**
     * The exact geometry of every mounted layer, in composition pixels.
     *
     * The report is UNROTATED plus a rotation value, so a consumer can draw
     * the gizmo itself without rotating the box twice.
     */
    getLayerBounds?(): Record<string, LayerBoundsReport>;
    /**
     * Mount (or REPLACE) a scene in the ALREADY-LOADED page — no navigation.
     *
     * WHY THIS EXISTS: the engine's inspection path used to open a fresh
     * browser context, navigate, wait for the network to go quiet and THEN
     * measure the scene. That whole dance cost ~1.5 s per call and dominated
     * every measurement. With a warm page the engine pushes the scene JSON
     * straight in here and gets its numbers back in milliseconds.
     *
     * The contract:
     * - the previous scene is unmounted first (no ghosting),
     * - the scene is parsed with the real schema (a malformed scene degrades,
     *   it never throws),
     * - `renderConfig` / `describeFrame` / `getLayerBounds` are re-published,
     * - the promise resolves when the scene is mounted and settled on frame 0.
     */
    mountSceneFromHost?(scene: unknown, sceneId: string, fps?: number): Promise<void>;
    /**
     * Seek to a frame for a LAYOUT measurement.
     *
     * The same geometry as `seekToFrame`, without the media resync and the
     * image decode — a bounding box does not depend on a video's currentTime
     * or on a bitmap's pixels. The engine's warm page uses this for the
     * zero-rasterisation layout report, which is the difference between a
     * sub-second query and a two-second one.
     */
    seekToFrameForLayout?(frame: number): Promise<void>;
  }
}