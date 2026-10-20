/**
 * SMPTE timecode.
 *
 * Non-drop-frame. The Studio authors in milliseconds, but every professional
 * surface (the transport readout, the timeline ruler, the clip tooltips)
 * speaks timecode, so the conversion lives in ONE place.
 *
 *   formatTimecode(21500, 30) → "00:00:00:21"
 *   formatFrameCount(21500, 30) → "00021f"
 */

/** The default frame rate of the Studio. */
export const DEFAULT_FPS = 30;

/** Clamp a frame rate into the range a timecode can actually express. */
function safeFps(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return DEFAULT_FPS;
  return Math.max(1, Math.min(120, Math.round(fps)));
}

/**
 * Format milliseconds as `HH:MM:SS:FF`.
 *
 * Hours are NOT wrapped at 24 — a long composition still reads `01:02:03:04`.
 */
export function formatTimecode(ms: number, fps: number = DEFAULT_FPS): string {
  const rate = safeFps(fps);
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const totalFrames = Math.floor((safeMs / 1000) * rate + 1e-6);

  const frames = totalFrames % rate;
  const totalSeconds = Math.floor(totalFrames / rate);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

/**
 * Format milliseconds as a frame counter, e.g. `00075f`.
 *
 * This is the readout a compositor watches while scrubbing: it advances one
 * step per frame with no ambiguity about rounding.
 */
export function formatFrameCount(ms: number, fps: number = DEFAULT_FPS): string {
  const rate = safeFps(fps);
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const totalFrames = Math.floor((safeMs / 1000) * rate + 1e-6);
  return `${String(totalFrames).padStart(5, '0')}f`;
}

/** Format milliseconds as a compact human duration, e.g. `00:08.500`. */
export function formatDuration(ms: number): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const totalSeconds = Math.floor(safeMs / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const millis = Math.floor(safeMs % 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** The frame index of a millisecond position. */
export function msToFrame(ms: number, fps: number = DEFAULT_FPS): number {
  const rate = safeFps(fps);
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  return Math.floor((safeMs / 1000) * rate + 1e-6);
}

/** The millisecond position of a frame index. */
export function frameToMs(frame: number, fps: number = DEFAULT_FPS): number {
  const rate = safeFps(fps);
  return (Math.max(0, frame) / rate) * 1000;
}
