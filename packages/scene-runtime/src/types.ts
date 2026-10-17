/**
 * Deterministic render/preview contract between the runtime and core-engine.
 * The engine waits for `whenSceneReady()`, then drives frames exclusively via
 * `seekToFrame(n)` — never wall-clock time.
 */
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
  }
}
