/**
 * Scene transitions — every one of them is a symmetric two-phase bell curve.
 *
 * THE DEFECT THIS FIXES: the four transitions were each one asymmetric animation.
 * `wipe` slid a solid cover off the frame (never covering the seam), `whipPan`
 * pushed the stage and let the drift term push back, `glitch` stepped the rig
 * from `x = -16` to `x = 0` with no decaying tail, and `morph` was a flat
 * opacity dip. In delivered videos they read as warped, one-sided or as a flash
 * that never resolved.
 *
 * The contract, identical for all four kinds:
 *
 *        p=0            p=0.5           p=1
 *   ──────╭──────────────╮──────────────╮──────
 *        │  PHASE "in"   │    "peak"     │  "out" │      intensity
 *   ──────╰──────────────╯──────────────╯──────
 *
 * The cover reaches full extent exactly at the midpoint — which is the only
 * place the outgoing and incoming content can swap without being seen — and
 * returns to exact identity at both ends. All values are pure functions of `p`,
 * so a seek to an arbitrary frame lands on a well-defined state.
 */
import { gsap } from "gsap";
import type { SceneSpec, Transition, TransitionKind } from "@motionforge/scene-spec";

// ---------------------------------------------------------------------------
// The bell curve
// ---------------------------------------------------------------------------

export type TransitionPhase = "in" | "peak" | "out";

/**
 * Fraction of the window spent covering. `wipe` needs a hair wider hold (its
 * curtain must be 100% opaque *while* the seam swaps); the other three swap on
 * the midpoint itself.
 */
const PEAK_WINDOW: Record<TransitionKind, { inEnd: number; outStart: number }> = {
  wipe: { inEnd: 0.48, outStart: 0.52 },
  whipPan: { inEnd: 0.5, outStart: 0.5 },
  glitch: { inEnd: 0.5, outStart: 0.5 },
  morph: { inEnd: 0.5, outStart: 0.5 },
};

export function peakWindow(kind: TransitionKind): { inEnd: number; outStart: number } {
  return PEAK_WINDOW[kind];
}

/** Which third of the bell a normalized progress falls in. */
export function bellPhaseAt(kind: TransitionKind, p: number): TransitionPhase {
  const { inEnd, outStart } = PEAK_WINDOW[kind];
  const clamped = Math.min(1, Math.max(0, p));
  if (clamped < inEnd) return "in";
  if (clamped > outStart) return "out";
  return "peak";
}

/**
 * Normalized bell value: `0` at both ends, `1` at the midpoint. `power2.inOut`
 * per leg, so each phase accelerates into the cover and decelerates out of it.
 */
export function bellAmountAt(kind: TransitionKind, p: number): number {
  const { inEnd, outStart } = PEAK_WINDOW[kind];
  const clamped = Math.min(1, Math.max(0, p));
  const leg = (from: number, to: number): number => {
    const x = Math.min(1, Math.max(0, (clamped - from) / Math.max(1e-6, to - from)));
    return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  };
  if (clamped <= inEnd) return leg(0, inEnd);
  if (clamped >= outStart) return 1 - leg(outStart, 1);
  return 1;
}

/** Normalized position inside the current leg — what the tween eases run on. */
export function legProgressAt(kind: TransitionKind, p: number): number {
  const { inEnd, outStart } = PEAK_WINDOW[kind];
  const clamped = Math.min(1, Math.max(0, p));
  if (clamped < inEnd) return clamped / inEnd;
  if (clamped > outStart) return (clamped - outStart) / (1 - outStart);
  return 1;
}

// ---------------------------------------------------------------------------
// Pure per-kind curves (the shapes the tweens below are built from)
// ---------------------------------------------------------------------------

export type WipeDirection = "left" | "right" | "up" | "down";

/** Exact identity for a full-frame cover: nothing clipped away on any edge. */
export const WIPE_FULL_CLIP = "inset(0px 0px 0px 0px)";

/** Which canvas edge stays painted, for a given clipped inset of `value`. */
const HIDDEN_EDGE: Record<WipeDirection, (value: string) => string> = {
  left: (v) => `inset(0px 0px 0px ${v})`,
  right: (v) => `inset(0px ${v} 0px 0px)`,
  up: (v) => `inset(${v} 0px 0px 0px)`,
  down: (v) => `inset(0px 0px ${v} 0px)`,
};

/** The edge the cover *grows from* on phase "in", and retracts toward on "out". */
const LEADING_EDGE: Record<WipeDirection, WipeDirection> = {
  left: "left",
  right: "right",
  up: "up",
  down: "down",
};

/** The edge that is clipped away while the cover is growing in. */
function trailingEdge(direction: WipeDirection): WipeDirection {
  return direction === "left" ? "right" : direction === "right" ? "left" : direction === "up" ? "down" : "up";
}

/**
 * The three clip-path poses a wipe passes through.
 *
 * - `entering`: nothing painted — the cover is fully clipped away.
 * - `full`: the frame is 100% covered, so the seam swap is invisible.
 * - `leaving`: painted on the edge it came in through, so the curtain exits
 *   symmetrically instead of teleporting away.
 */
export function wipeClips(direction: WipeDirection): {
  entering: string;
  full: string;
  leaving: string;
} {
  return {
    entering: HIDDEN_EDGE[trailingEdge(direction)]("100%"),
    full: WIPE_FULL_CLIP,
    leaving: HIDDEN_EDGE[LEADING_EDGE[direction]]("100%"),
  };
}

/**
 * `wipe` clip-path at normalized progress `p`: the leading edge sweeps in over
 * phase "in" and back out over phase "out", holding a fully-open frame across
 * the midpoint where the seam swaps.
 */
export function wipeClipAt(direction: WipeDirection, p: number): string {
  // the clipped inset is the *complement* of the bell: 100% inset (nothing
  // painted) at p = 0, 0px inset (frame fully covered) at the midpoint
  const amount = bellAmountAt("wipe", p);
  const value = amount >= 1 ? "0px" : amount <= 0 ? "100%" : `${((1 - amount) * 100).toFixed(3)}%`;
  const hidden = p <= PEAK_WINDOW.wipe.outStart ? trailingEdge(direction) : LEADING_EDGE[direction];
  return HIDDEN_EDGE[hidden](value);
}

export const WHIP_PAN_AMPLITUDE_PCT = 45;

/**
 * `whipPan` stage offset. Rises to `±amplitude` on `power3.in`, wraps to `∓` at
 * the midpoint (at peak motion blur, where the discontinuity is invisible) and
 * decelerates back to exact zero.
 */
export function whipPanOffsetAt(p: number, direction: "left" | "right", amplitude = WHIP_PAN_AMPLITUDE_PCT): number {
  const sign = direction === "left" ? -1 : 1;
  const { inEnd, outStart } = PEAK_WINDOW.whipPan;
  const clamped = Math.min(1, Math.max(0, p));
  const power3In = (x: number): number => Math.pow(Math.min(1, Math.max(0, x)), 3);
  // phase in: accelerate into the slam
  if (clamped <= inEnd) return sign * amplitude * power3In(clamped / inEnd);
  // midpoint: the stage has wrapped to the far side at peak motion blur
  if (clamped <= outStart) return sign * amplitude;
  // phase out: decelerate from ∓amplitude back to exact zero
  const x = (clamped - outStart) / (1 - outStart);
  return -sign * amplitude * (1 - power3In(x));
}

/** Motion-blur / streak overlay opacity, `0 → 1 → 0` around the midpoint. */
export function whipPanStreakAt(p: number): number {
  return bellAmountAt("whipPan", p);
}

/**
 * `glitch` intensity. Continuous bell for the RGB split; the slice bars use the
 * same value quantised into discrete steps, because a glitch that glides is not
 * a glitch.
 */
export function glitchIntensityAt(p: number, intensity: number): number {
  return bellAmountAt("glitch", p) * intensity;
}

/** Slice-bar displacement for bar `i` at progress `p`, in percent of width. */
export function glitchSliceAt(p: number, index: number, count: number, intensity: number): number {
  if (count <= 0) return 0;
  const bell = bellAmountAt("glitch", p);
  const step = Math.floor(bell * 7) % 7;
  // a fixed, reproducible ladder: no Math.random, so a seek always matches
  const ladder = [0, 1, -1, 0.6, -0.4, 0.25, -0.75, 0];
  const amp = ladder[(step + index) % ladder.length] ?? 0;
  return amp * intensity * 18;
}

const MORPH_MAX_SCALE = 1.05;
export const MORPH_MAX_BLUR_PX = 24;

/** `morph` portal geometry. Scales out of the centre to envelop the frame at 50%. */
export function morphScaleAt(p: number): number {
  return MORPH_MAX_SCALE * bellAmountAt("morph", p);
}

/** `morph` veil opacity — up into the cover, back down out of it. */
export function morphOpacityAt(p: number): number {
  return bellAmountAt("morph", p);
}

/** Frosted-glass blur that resolves to `0px` by the end of the window. */
export function morphBlurAt(p: number): number {
  const { inEnd, outStart } = PEAK_WINDOW.morph;
  const clamped = Math.min(1, Math.max(0, p));
  if (clamped <= inEnd) return MORPH_MAX_BLUR_PX * (clamped / inEnd);
  if (clamped <= outStart) return MORPH_MAX_BLUR_PX;
  return MORPH_MAX_BLUR_PX * (1 - (clamped - outStart) / (1 - outStart));
}

// ---------------------------------------------------------------------------
// Overlay construction
// ---------------------------------------------------------------------------

export interface TransitionOverlay {
  kind: TransitionKind;
  /** the primary animated element (curtain / streak / fringe / portal) */
  el: HTMLElement;
  at: number;
  durationMs: number;
}

const OVERLAY_BASE =
  "position:absolute;inset:0;pointer-events:none;will-change:transform,opacity,clip-path,filter;";

function mk(styles: string[]): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = [OVERLAY_BASE, ...styles].join(";");
  return el;
}

/**
 * Overlay must be hidden at every time outside `[at, at + duration]` — a solid
 * curtain painted over the opening frames is exactly the regression that
 * non-linear seeking exposed. An explicit `tl.set` at `at` avoids
 * `fromTo`'s implicit `immediateRender`.
 *
 * The closing `set` deliberately does NOT use `clearProps`: clearing *all*
 * inline styles would also drop the `display:none` that hides the overlay, so
 * the cover would become visible again at frame 0 of the next seek. Each
 * transition resets its own animated properties to identity instead.
 */
function prepare(tl: gsap.core.Timeline, el: HTMLElement, atSec: number, durSec: number): void {
  el.style.display = "none";
  tl.set(el, { display: "block" }, atSec);
  tl.set(el, { display: "none" }, atSec + durSec + 0.001);
}

/**
 * Build and schedule every transition in the scene. Returns the overlays so
 * `describeFrame` can report which transition (and which phase) is live at a
 * given timestamp.
 */
export function applyTransitions(
  tl: gsap.core.Timeline,
  scene: SceneSpec,
  rig: HTMLElement
): TransitionOverlay[] {
  const overlays: TransitionOverlay[] = [];

  for (const tr of scene.transitions) {
    const atSec = tr.at / 1000;
    const durSec = tr.durationMs / 1000;
    const { inEnd, outStart } = PEAK_WINDOW[tr.kind];
    const inSec = durSec * inEnd;
    const holdSec = durSec * (outStart - inEnd);
    const outSec = durSec * (1 - outStart);

    if (tr.kind === "wipe") {
      buildWipe(rig, tl, tr, atSec, inSec, holdSec, outSec);
    } else if (tr.kind === "whipPan") {
      buildWhipPan(rig, tl, tr, atSec, inSec, holdSec, outSec);
    } else if (tr.kind === "glitch") {
      buildGlitch(rig, tl, tr, atSec, inSec, outSec);
    } else {
      buildMorph(rig, tl, tr, atSec, inSec, outSec);
    }

    const el = rig.lastElementChild as HTMLElement | null;
    if (el) overlays.push({ kind: tr.kind, el, at: tr.at, durationMs: tr.durationMs });
  }

  return overlays;
}

// --- wipe -------------------------------------------------------------------

function buildWipe(
  rig: HTMLElement,
  tl: gsap.core.Timeline,
  tr: Extract<Transition, { kind: "wipe" }>,
  at: number,
  inSec: number,
  holdSec: number,
  outSec: number
): void {
  const cover = mk([`z-index:900;background:${tr.color}`]);
  if (tr.featherPx > 0) {
    // feather is authored in design px; the mask gradient works in percentages,
    // so scale it against the canvas the scene will be rendered at
    const softness = Math.min(50, (tr.featherPx / 1080) * 50);
    const gradient = tr.direction === "left" || tr.direction === "right"
      ? `linear-gradient(90deg, #000 ${(50 - softness / 2).toFixed(1)}%, transparent ${(50 + softness / 2).toFixed(1)}%)`
      : `linear-gradient(0deg, #000 ${(50 - softness / 2).toFixed(1)}%, transparent ${(50 + softness / 2).toFixed(1)}%)`;
    cover.style.maskImage = gradient;
    cover.style.webkitMaskImage = gradient;
  }
  // glowing leading edge, so the wipe reads as a light sweep rather than a slab
  const edge = mk(["z-index:901;background:linear-gradient(90deg, transparent, rgba(125,211,252,0.55))"]);
  edge.style.width = "18%";
  cover.appendChild(edge);
  rig.appendChild(cover);
  prepare(tl, cover, at, inSec + holdSec + outSec);

  const { entering, full, leaving } = wipeClips(tr.direction);
  const vertical = tr.direction === "up" || tr.direction === "down";
  const growing = tr.direction === "left" || tr.direction === "up";

  // phase in: cover grows from the leading edge to full frame
  tl.fromTo(cover, { clipPath: entering, autoAlpha: 1 }, { clipPath: full, duration: inSec, ease: "expo.in", immediateRender: false }, at);
  // the seam swaps under a fully opaque cover
  if (holdSec > 0) tl.set(cover, { clipPath: full }, at + inSec);
  // phase out: cover retracts past the same edge, back to exact identity
  tl.to(cover, { clipPath: leaving, duration: outSec, ease: "expo.out" }, at + inSec + holdSec);
  tl.set(cover, { clipPath: full }, at + inSec + holdSec + outSec);
  // the edge glow tracks the curtain front and dies with it
  if (vertical) {
    edge.style.cssText = [edge.style.cssText, "width:100%;height:18%"].join(";");
    tl.fromTo(edge, { yPercent: growing ? 400 : -400, autoAlpha: 0.9 }, { yPercent: 0, autoAlpha: 0.4, duration: inSec, ease: "expo.in", immediateRender: false }, at);
  } else {
    tl.fromTo(edge, { xPercent: growing ? 400 : -400, autoAlpha: 0.9 }, { xPercent: 0, autoAlpha: 0.4, duration: inSec, ease: "expo.in", immediateRender: false }, at);
  }
  tl.to(edge, { autoAlpha: 0, duration: outSec, ease: "expo.out" }, at + inSec + holdSec);
}

// --- whipPan ----------------------------------------------------------------

function buildWhipPan(
  rig: HTMLElement,
  tl: gsap.core.Timeline,
  tr: Extract<Transition, { kind: "whipPan" }>,
  at: number,
  inSec: number,
  holdSec: number,
  outSec: number
): void {
  const band = mk([
    "z-index:900;opacity:0;mix-blend-mode:screen;",
    "background:repeating-linear-gradient(90deg, rgba(255,255,255,0.16) 0 40px, transparent 40px 120px);",
    "backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);",
  ]);
  rig.appendChild(band);
  prepare(tl, band, at, inSec + holdSec + outSec);

  const amp = WHIP_PAN_AMPLITUDE_PCT;
  const sign = tr.direction === "left" ? -1 : 1;
  // phase in: slam the stage to +amp, streaks ramp in behind it
  tl.fromTo(
    rig,
    { xPercent: 0, skewX: 0 },
    { xPercent: sign * amp, skewX: sign * -2, duration: inSec, ease: "power3.in", immediateRender: false },
    at
  );
  tl.fromTo(band, { opacity: 1 }, { opacity: 1, duration: Math.max(0.01, inSec), ease: "none", immediateRender: false }, at);
  // midpoint: wrap to -amp while the blur is at full strength
  tl.to(rig, { xPercent: -sign * amp, skewX: 0, duration: Math.max(0.001, holdSec), ease: "none" }, at + inSec);
  // phase out: decelerate home and clear every inline transform
  tl.to(rig, { xPercent: 0, skewX: 0, duration: outSec, ease: "power3.out" }, at + inSec + holdSec);
  tl.fromTo(band, { opacity: 1 }, { opacity: 0, duration: Math.max(0.01, outSec), ease: "none", immediateRender: false }, at + inSec + holdSec);
  tl.set(rig, { xPercent: 0, skewX: 0 }, at + inSec + holdSec + outSec);
  tl.set(band, { opacity: 0, xPercent: 0 }, at + inSec + holdSec + outSec);
}

// --- glitch -----------------------------------------------------------------

function buildGlitch(
  rig: HTMLElement,
  tl: gsap.core.Timeline,
  tr: Extract<Transition, { kind: "glitch" }>,
  at: number,
  inSec: number,
  outSec: number
): void {
  const peak = Math.max(0.05, tr.intensity);
  const fringe = mk([
    "z-index:900;opacity:0;mix-blend-mode:screen;",
    "background:repeating-linear-gradient(0deg, rgba(255,0,60,0.18) 0 3px, transparent 3px 7px, rgba(0,255,255,0.16) 7px 9px, transparent 9px 14px);",
  ]);
  rig.appendChild(fringe);

  const slices = 4;
  const sliceEls: HTMLElement[] = [];
  for (let i = 0; i < slices; i++) {
    const bar = mk(["z-index:901;opacity:0;background:rgba(125,211,252,0.10);mix-blend-mode:overlay"]);
    bar.style.left = "-10%";
    bar.style.right = "-10%";
    bar.style.top = `${(i / slices) * 100}%`;
    bar.style.height = `${100 / slices - 1}%`;
    fringe.appendChild(bar);
    sliceEls.push(bar);
  }
  const flash = mk(["z-index:902;opacity:0;background:#e0f2fe"]);
  fringe.appendChild(flash);

  prepare(tl, fringe, at, inSec + outSec);

  // stepped bell — 8 discrete steps per leg, then a hard cut back to identity
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const pIn = i / steps;
    const intensity = glitchIntensityAt(pIn, peak);
    tl.set(fringe, { opacity: intensity }, at + inSec * pIn);
    tl.set(flash, { opacity: i === steps ? 0.55 : 0 }, at + inSec * pIn);
    tl.set(rig, { x: Math.round(glitchSliceAt(pIn, 0, slices, peak)) }, at + inSec * pIn);
  }
  for (let i = 0; i <= steps; i++) {
    const pOut = 0.5 + (i / steps) * 0.5;
    const intensity = glitchIntensityAt(pOut, peak);
    tl.set(fringe, { opacity: intensity }, at + inSec + outSec * (i / steps));
    tl.set(flash, { opacity: 0 }, at + inSec + outSec * (i / steps));
    tl.set(rig, { x: Math.round(glitchSliceAt(pOut, 0, slices, peak)) }, at + inSec + outSec * (i / steps));
  }
  sliceEls.forEach((bar, i) => {
    for (let step = 0; step <= steps; step++) {
      const pIn = step / steps;
      tl.set(bar, { xPercent: glitchSliceAt(pIn, i, slices, peak) }, at + inSec * pIn);
      const pOut = 0.5 + (step / steps) * 0.5;
      tl.set(bar, { xPercent: glitchSliceAt(pOut, i, slices, peak) }, at + inSec + outSec * (step / steps));
    }
  });
  // nothing may survive the window: rig jitter, slice offsets, fringe opacity
  tl.set(rig, { x: 0 }, at + inSec + outSec);
  tl.set(fringe, { opacity: 0 }, at + inSec + outSec);
  sliceEls.forEach((bar) => tl.set(bar, { xPercent: 0, opacity: 0 }, at + inSec + outSec));
}

// --- morph ------------------------------------------------------------------

function buildMorph(
  rig: HTMLElement,
  tl: gsap.core.Timeline,
  tr: Extract<Transition, { kind: "morph" }>,
  at: number,
  inSec: number,
  outSec: number
): void {
  const portal = mk([
    "z-index:900;opacity:0;background:radial-gradient(circle at 50% 50%, rgba(8,12,24,0.72) 0%, rgba(8,12,24,0.95) 100%);",
    `backdrop-filter:blur(0px);-webkit-backdrop-filter:blur(0px);`,
  ]);
  rig.appendChild(portal);
  prepare(tl, portal, at, inSec + outSec);

  // phase in: the iris expands from the centre until it swallows the frame
  tl.fromTo(
    portal,
    { opacity: 0, scale: 0, backdropFilter: "blur(0px)", WebkitBackdropFilter: "blur(0px)" },
    { opacity: 1, scale: MORPH_MAX_SCALE, duration: inSec, ease: "power2.inOut", immediateRender: false },
    at
  );
  // phase out: the portal contracts and dissolves; blur resolves to exactly 0
  tl.to(
    portal,
    { opacity: 0, scale: MORPH_MAX_SCALE * 0.4, duration: outSec, ease: "power2.inOut", backdropFilter: "blur(0px)", WebkitBackdropFilter: "blur(0px)" },
    at + inSec
  );
  tl.set(portal, { opacity: 0, scale: 0 }, at + inSec + outSec);
}

// ---------------------------------------------------------------------------
// Live-phase reporting (feeds `inspect_scene_keyframes` framesMeta)
// ---------------------------------------------------------------------------

export interface ActiveTransition {
  kind: TransitionKind;
  /** 0..1 across the whole window */
  progressPct: number;
  phase: TransitionPhase;
}

/** Which transitions are on screen at `timeMs`, and how far along they are. */
export function activeTransitionsAt(
  overlays: readonly TransitionOverlay[],
  timeMs: number
): ActiveTransition[] {
  const out: ActiveTransition[] = [];
  for (const overlay of overlays) {
    const elapsed = timeMs - overlay.at;
    if (elapsed < 0 || elapsed >= overlay.durationMs) continue;
    const p = elapsed / overlay.durationMs;
    out.push({
      kind: overlay.kind,
      progressPct: Math.round(p * 1000) / 10,
      phase: bellPhaseAt(overlay.kind, p),
    });
  }
  return out.sort((a, b) => a.progressPct - b.progressPct);
}