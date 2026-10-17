/**
 * Determinism controls for the render runtime.
 *
 * Two distinct problems are solved here:
 *
 * 1. **Wall-clock leakage.** GSAP's lag smoothing rewrites the global clock
 *    after a slow tick, so a paused timeline that was seeked while the tab
 *    stalled can "catch up" to a different time than the frame that was asked
 *    for. `lagSmoothing(0)` disables that entirely — a frame index maps to
 *    exactly one timeline time, always.
 *
 * 2. **Capture races.** `timeline.seek()` only mutates style; the pixels
 *    Chromium will screenshot are produced later, by the compositor. The
 *    settler below defines the *whole* contract: after it resolves, fonts are
 *    loaded, images are decoded, media is resynced, layout is flushed and two
 *    animation frames have been committed. Only then is a screenshot of that
 *    frame guaranteed to be correct.
 *
 * The settler takes its side effects as injected dependencies so the ordering
 * guarantee is unit-testable without a browser
 * (`packages/scene-runtime/tests/visual-stability.test.ts`).
 */
import { gsap } from "gsap";

/**
 * Global, immutable GSAP configuration for deterministic rendering.
 * Called exactly once, before any timeline is built.
 *
 * - `lagSmoothing(0)`: no clock compensation, ever (see above).
 * - `force3D: false`: GSAP must not promote elements to composited layers with
 *   `translate3d`. A promoted text/SVG element gets rasterized once and then
 *   stretched when the camera scales it — text turns to mush. Elements that
 *   genuinely need 3D (`3dFlipIn`, the camera rig) declare it explicitly via
 *   `rotationX/Y/Z`, `transformPerspective` and `transform-style: preserve-3d`,
 *   which keep working with forced 3D disabled.
 * - `nullTargetWarn: false`: GSAP would otherwise warn about tweens whose
 *   target was detached mid-seek (scene rebuilds); that is expected here.
 */
export function configureDeterministicGsap(): void {
  gsap.ticker.lagSmoothing(0);
  gsap.config({ force3D: false, nullTargetWarn: false });
}

export interface SettleDeps {
  /** Seek the master timeline. MUST pass `suppressEvents = false` so callbacks fire. */
  seekTimeline(): void;
  /** Force deterministic per-layer visibility for this time (lifecycle windows). */
  applyLifecycle(timeSec: number): void;
  /** Resync media that is driven by timeline position (video, Lottie). */
  runSeekables(timeSec: number): Promise<void>;
  /** `document.fonts.ready` */
  fontsReady(): Promise<void>;
  /** Decode every image so no frame captures a half-painted bitmap. */
  decodeImages(): Promise<void>;
  /**
   * Grace period for images that have not finished loading. The engine
   * preloads every declared asset before the timeline exists, so in practice
   * images are already `complete`; this only bounds the pathological case of a
   * hang, which must degrade to "capture what is painted" rather than wedge the
   * whole render. 0 disables the grace period (tests).
   */
  imageLoadGraceMs?: number;
  /** Synchronous style/layout flush (`void el.offsetHeight`). */
  flushLayout(): void;
  /** One `requestAnimationFrame` tick. */
  nextFrame(): Promise<void>;
}

export type FrameSettler = (timeSec: number) => Promise<void>;

/**
 * Map an arbitrary requested frame onto a real frame of the scene. Workers ask
 * for range bounds that can sit one past the end, so this clamps instead of
 * throwing — and rounds, because a fractional frame index means nothing on a
 * discrete timeline.
 */
export function clampFrame(frame: number, totalFrames: number): number {
  return Math.min(totalFrames - 1, Math.max(0, Math.round(frame)));
}

/**
 * The order matters and is the contract:
 * seek → lifecycle → media → fonts → images → layout flush → rAF → rAF.
 * The second rAF is not redundant: the first tick runs the callback, the
 * second proves the compositor committed the resulting frame before capture.
 */
export const SETTLE_STEPS = [
  "seekTimeline",
  "applyLifecycle",
  "runSeekables",
  "fontsReady",
  "decodeImages",
  "flushLayout",
  "nextFrame",
  "nextFrame",
] as const;

/** Default grace period for images that have not finished loading. */
export const IMAGE_LOAD_GRACE_MS = 2000;

export function createFrameSettler(deps: SettleDeps): FrameSettler {
  return async (timeSec: number): Promise<void> => {
    deps.seekTimeline();
    deps.applyLifecycle(timeSec);
    await deps.runSeekables(timeSec);
    await deps.fontsReady();
    if (deps.imageLoadGraceMs === 0) {
      await deps.decodeImages();
    } else {
      // A hung image must not stall the capture forever: give it a bounded
      // grace period, then paint whatever is on screen.
      await Promise.race([
        deps.decodeImages(),
        new Promise<void>((resolve) => setTimeout(resolve, deps.imageLoadGraceMs ?? 2000)),
      ]);
    }
    deps.flushLayout();
    await deps.nextFrame();
    await deps.nextFrame();
  };
}

/** Resolves after the browser has run one animation-frame callback. */
export function nextPaintFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** Force a synchronous style recalc + layout (`void el.offsetHeight`). */
export function flushLayout(el: HTMLElement): void {
  void el.offsetHeight;
}

/**
 * Decode every `<img>` under `root`. Images that never load are skipped rather
 * than rejected: a broken asset must surface as a visible hole in the frame,
 * never as a wedged render.
 */
export async function decodeImages(root: ParentNode): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      if (!img.complete) {
        await new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        });
      }
      if (img.naturalWidth > 0) {
        await img.decode().catch(() => undefined);
      }
    })
  );
}

/** Crisp, hint-free typography shared by the stage and every text layer. */
export const CRISP_TEXT_CSS = [
  "-webkit-font-smoothing:antialiased",
  "-moz-osx-font-smoothing:grayscale",
  "text-rendering:geometricPrecision",
  "font-kerning:normal",
].join(";");

/**
 * Vertical breathing room for animated text units.
 *
 * Mask-reveal presets clip with `clip-path: inset(...)`, which cuts glyphs off
 * at the element box. Arabic ascenders/descenders and diacritics (ب، ت، ي، ق، ن، أ)
 * routinely exceed the nominal line box, so units get padding *and* the
 * compensating negative margins, which keeps the layout box unchanged while the
 * painted box grows.
 */
export const TEXT_UNIT_GUARD_CSS = [
  "padding-top:0.15em",
  "padding-bottom:0.2em",
  "margin-top:-0.15em",
  "margin-bottom:-0.2em",
  "line-height:1.35",
  "white-space:pre",
  "unicode-bidi:isolate",
].join(";");
