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
    getLayerBounds?(): Record<string, { x: number; y: number; width: number; height: number; rotation: number }>;
  }
}