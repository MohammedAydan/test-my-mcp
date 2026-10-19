/**
 * Scene transitions — every one of them is a symmetric two-phase bell curve.
 *
 * THE DEFECTS THIS FIXES (field audit of `scene-01`):
 *
 *  - `whipPan` painted a full-frame `repeating-linear-gradient(90deg, …)` band,
 *    i.e. literal vertical bars, over a stage that had already emptied — so the
 *    cut rendered as prison bars on a black screen;
 *  - `wipe` was a flat rectangle in the scene's own background colour, which on
 *    a dark scene is indistinguishable from a dead frame;
 *  - every kind held its peak for an unbounded share of the window, and the
 *    outgoing act had already finished exiting before the cover arrived.
 *
 * The contract, identical for all four kinds:
 *
 *        p=0            p=0.5           p=1
 *   ──────╭──────────────╮──────────────╮──────
 *        │  PHASE "in"   │    "peak"     │  "out" │      intensity
 *   ──────╰──────────────╯──────────────╯──────
 *
 * The cover reaches full extent exactly at the midpoint — the only place the
 * outgoing and incoming content can swap without being seen — and the peak is
 * held for {@link PEAK_HOLD_MS} and never longer, so a transition reads as a
 * cut, not as a pause. All values are pure functions of `p`, so a seek to an
 * arbitrary frame lands on a well-defined state.
 *
 * NOTHING here writes the camera rig. A transition's contribution to the camera
 * (a `whipPan`'s stage translation and the headroom it must buy, a `glitch`'s
 * jitter) is a pure function evaluated by `camera.ts` inside the single camera
 * composition, so overlays and camera can no longer fight over one transform.
 */
import { gsap } from "gsap";
import type { SceneSpec, Transition, TransitionKind } from "@motionforge/scene-spec";

// ---------------------------------------------------------------------------
// The bell curve
// ---------------------------------------------------------------------------

/**
 * The bell curve is part of the SceneSpec CONTRACT, so it is defined once in
 * `scene-spec` and re-exported here for the overlay builders and `framesMeta`.
 */
import {
  PEAK_HOLD_MS,
  bellAmountAt,
  bellPhaseAt,
  legProgressAt,
  peakHoldMs,
  peakWindow,
  type TransitionPhase,
} from "@motionforge/scene-spec";
export {
  PEAK_HOLD_MS,
  bellAmountAt,
  bellPhaseAt,
  legProgressAt,
  peakHoldMs,
  peakWindow,
  type TransitionPhase,
};

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
export function wipeClipAt(direction: WipeDirection, p: number, durationMs = 0): string {
  const amount = bellAmountAt("wipe", p, durationMs);
  const value = amount >= 1 ? "0px" : amount <= 0 ? "100%" : `${((1 - amount) * 100).toFixed(3)}%`;
  const { outStart } = peakWindow("wipe", durationMs);
  const hidden = p <= outStart ? trailingEdge(direction) : LEADING_EDGE[direction];
  return HIDDEN_EDGE[hidden](value);
}

/**
 * How far a `whipPan` throws the stage, in percent of the canvas.
 *
 * The stage accelerates out to ±`amplitude` and, at the midpoint, has already
 * wrapped to the far side — at peak motion speed, which is exactly where a
 * discontinuity is invisible. It then decelerates home to exact zero.
 */
export const whipPanAmplitudePct = 50;

export function whipPanOffsetAt(
  p: number,
  direction: "left" | "right",
  amplitude = whipPanAmplitudePct
): number {
  const sign = direction === "left" ? -1 : 1;
  const { inEnd, outStart } = peakWindow("whipPan", 0);
  const clamped = Math.min(1, Math.max(0, p));
  const power3In = (x: number): number => Math.pow(Math.min(1, Math.max(0, x)), 3);
  // phase in: accelerate into the slam
  if (clamped <= inEnd) return sign * amplitude * power3In(inEnd > 0 ? clamped / inEnd : 1);
  // midpoint: the stage has wrapped to the far side at peak motion blur
  if (clamped <= outStart) return sign * amplitude;
  // phase out: decelerate from −amplitude back to exact zero
  const x = (clamped - outStart) / (1 - outStart);
  return -sign * amplitude * (1 - power3In(x));
}

/** Motion-blur / streak overlay opacity, `0 → 1 → 0` around the midpoint. */
export function whipPanStreakAt(p: number, durationMs = 0): number {
  return bellAmountAt("whipPan", p, durationMs);
}

/**
 * `glitch` intensity. Continuous bell for the RGB split; the slice bars use the
 * same value quantised into discrete steps, because a glitch that glides is not
 * a glitch.
 */
export function glitchIntensityAt(p: number, intensity: number, durationMs = 0): number {
  return bellAmountAt("glitch", p, durationMs) * intensity;
}

/** Slice-bar displacement for bar `i` at progress `p`, in percent of width. */
export function glitchSliceAt(
  p: number,
  index: number,
  count: number,
  intensity: number,
  durationMs = 0
): number {
  if (count <= 0) return 0;
  const bell = bellAmountAt("glitch", p, durationMs);
  const step = Math.floor(bell * 7) % 7;
  // a fixed, reproducible ladder: no Math.random, so a seek always matches
  const ladder = [0, 1, -1, 0.6, -0.4, 0.25, -0.75, 0];
  const amp = ladder[(step + index) % ladder.length] ?? 0;
  return amp * intensity * 18;
}

/**
 * The whole-frame jitter a `glitch` adds to the camera, in PIXELS.
 *
 * `camera.ts` folds this into the single camera composition (converting it to a
 * translation percent against the render width) instead of writing `rig.x` from
 * a competing tween, which is how the rig used to be left jittering after the
 * window closed.
 */
export function glitchRigOffsetPxAt(p: number, intensity: number, durationMs = 0): number {
  return glitchSliceAt(p, 0, 1, intensity, durationMs) * 0.5;
}

const MORPH_MAX_SCALE = 1.05;
export const MORPH_MAX_BLUR_PX = 24;
export const WHIP_PAN_MAX_BLUR_PX = 16;

/** `morph` portal geometry. Scales out of the centre to envelop the frame at 50%. */
export function morphScaleAt(p: number, durationMs = 0): number {
  return MORPH_MAX_SCALE * bellAmountAt("morph", p, durationMs);
}

/** `morph` veil opacity — up into the cover, back down out of it. */
export function morphOpacityAt(p: number, durationMs = 0): number {
  return bellAmountAt("morph", p, durationMs);
}

/** Frosted-glass blur that resolves to `0px` by the end of the window. */
export function morphBlurAt(p: number, durationMs = 0): number {
  const { inEnd, outStart } = peakWindow("morph", durationMs);
  const clamped = Math.min(1, Math.max(0, p));
  if (clamped <= inEnd) return inEnd > 0 ? MORPH_MAX_BLUR_PX * (clamped / inEnd) : MORPH_MAX_BLUR_PX;
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
 * Build and schedule every transition's OVERLAY. Returns the overlays so
 * `describeFrame` can report which transition (and which phase) is live at a
 * given timestamp.
 *
 * The camera side of a transition is NOT built here — `camera.ts` folds it into
 * the single composed pose. See `stageOffsetAt`.
 */
export function applyTransitions(
  tl: gsap.core.Timeline,
  scene: SceneSpec,
  rig: HTMLElement
): TransitionOverlay[] {
  const overlays: TransitionOverlay[] = [];

  for (const tr of (scene.transitions ?? [])) {
    const atSec = tr.at / 1000;
    const durSec = tr.durationMs / 1000;
    const { inEnd, outStart } = peakWindow(tr.kind, tr.durationMs);
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

/** Angle of the studio shutter's slanted leading edge, in degrees. */
export const WIPE_SKEW_DEG = -10;

/**
 * How much wider (or taller) than the canvas the shutter is drawn.
 *
 * `skewX` pushes the top edge left and the bottom edge right by
 * `tan(|skew|) · height / 2` — ~95 px each way on a 1920×1080 canvas. A curtain
 * at exactly 100% width therefore leaves an unpainted sliver at two corners, and
 * a hard 90° edge never reads as a studio graphic. 1.18 buys comfortably more
 * than the skew consumes.
 */
export const WIPE_SPAN_FACTOR = 1.18;

/**
 * An ANGLED MULTI-RIBBON STUDIO SHUTTER.
 *
 * THE DEFECT THIS FIXES (field audit of `scene-01`, 00:08.000): `wipe` was one
 * flat rectangle in the scene's own background colour with a hard 90° vertical
 * edge — on a dark scene that is literally a black box sliding across a black
 * screen, which reads as a rendering fault rather than as a cut.
 *
 * It is now built as a broadcast graphic:
 *
 *   - the body is skewed ({@link WIPE_SKEW_DEG}) and over-wide
 *     ({@link WIPE_SPAN_FACTOR}), so the leading edge is a clean diagonal that
 *     covers the corners at full extent;
 *   - the body is a deep slate → accent-tinted gradient (never a flat fill)
 *     edged by a crisp 2px luminous accent line;
 *   - the leading edge carries a vibrant accent ribbon with a soft 40px glow,
 *     plus a thinner echo behind it for the multi-ribbon read.
 *
 * The cover reaches full extent exactly at the seam midpoint — the same instant
 * `SEAM_INCOMING_FRACTION` reveals the incoming act underneath it.
 */
function buildWipe(
  rig: HTMLElement,
  tl: gsap.core.Timeline,
  tr: Extract<Transition, { kind: "wipe" }>,
  at: number,
  inSec: number,
  holdSec: number,
  outSec: number
): void {
  const vertical = tr.direction === "up" || tr.direction === "down";
  const along = vertical ? "0deg" : "90deg";
  const accent = tr.color;
  // the diagonal leans away from the direction of travel
  const skew = vertical
    ? `skewY(${WIPE_SKEW_DEG}deg) scaleY(${WIPE_SPAN_FACTOR})`
    : `skewX(${WIPE_SKEW_DEG}deg) scaleX(${WIPE_SPAN_FACTOR})`;

  // ---- core shutter body ----------------------------------------------------
  const cover = mk([
    "z-index:900;",
    "transform-origin:center center;",
    `transform:${skew};`,
    // deep rich slate, tinted toward the accent as the head reaches full cover
    `background:linear-gradient(${along}, #0b1120 0%, color-mix(in srgb, ${accent} 26%, #0b1120) 40%, ` +
      `color-mix(in srgb, ${accent} 62%, #0b1120) 74%, ${accent} 100%);`,
    // the crisp luminous accent line, and the soft studio glow around the shutter
    `box-shadow:inset 0 0 0 2px ${accent}, 0 0 40px ${accent};`,
  ]);
  rig.appendChild(cover);
  if (tr.featherPx > 0) {
    // feather is authored in design px; the mask gradient works in percentages,
    // so scale it against the canvas the scene will be rendered at
    const softness = Math.min(50, (tr.featherPx / 1080) * 50);
    const gradient =
      vertical === true
        ? `linear-gradient(0deg, #000 ${(50 - softness / 2).toFixed(1)}%, transparent ${(50 + softness / 2).toFixed(1)}%)`
        : `linear-gradient(90deg, #000 ${(50 - softness / 2).toFixed(1)}%, transparent ${(50 + softness / 2).toFixed(1)}%)`;
    cover.style.maskImage = gradient;
    cover.style.webkitMaskImage = gradient;
  }

  // ---- leading edge: vibrant accent ribbon + a thinner echo behind it --------
  const leadingAtStart = tr.direction === "left" || tr.direction === "up";
  const edgeBox = vertical
    ? leadingAtStart
      ? "left:-4%;right:-4%;top:0;height:26%;"
      : "left:-4%;right:-4%;bottom:0;height:26%;"
    : leadingAtStart
      ? "top:-4%;bottom:-4%;left:0;width:26%;"
      : "top:-4%;bottom:-4%;right:0;width:26%;";
  const edgeGrad = vertical
    ? leadingAtStart
      ? `linear-gradient(0deg, ${accent} 0%, ${accent} 30%, rgba(255,255,255,0) 100%)`
      : `linear-gradient(180deg, ${accent} 0%, ${accent} 30%, rgba(255,255,255,0) 100%)`
    : leadingAtStart
      ? `linear-gradient(90deg, ${accent} 0%, ${accent} 30%, rgba(255,255,255,0) 100%)`
      : `linear-gradient(270deg, ${accent} 0%, ${accent} 30%, rgba(255,255,255,0) 100%)`;

  const edge = mk([
    "z-index:901;",
    edgeBox,
    `background:${edgeGrad};`,
    `box-shadow:0 0 40px ${accent};`,
  ]);
  cover.appendChild(edge);

  const echo = mk([
    "z-index:901;",
    edgeBox,
    vertical ? "height:9%;" : "width:9%;",
    `background:${edgeGrad};`,
  ]);
  cover.appendChild(echo);

  prepare(tl, cover, at, inSec + holdSec + outSec);

  const { entering, full, leaving } = wipeClips(tr.direction);

  // phase in: cover grows from the leading edge to full frame
  tl.fromTo(cover, { clipPath: entering, autoAlpha: 1 }, { clipPath: full, duration: inSec, ease: "expo.in", immediateRender: false }, at);
  // the seam swaps under a fully opaque cover
  if (holdSec > 0) tl.set(cover, { clipPath: full }, at + inSec);
  // phase out: cover retracts past the same edge, back to exact identity
  tl.to(cover, { clipPath: leaving, duration: outSec, ease: "expo.out" }, at + inSec + holdSec);
  tl.set(cover, { clipPath: full }, at + inSec + holdSec + outSec);

  // the ribbons ignite with the curtain and die with it, so the shutter never
  // shows a bare rectangle at either end of the window
  for (const [ribbon, peak] of [
    [edge, 1],
    [echo, 0.6],
  ] as const) {
    tl.fromTo(ribbon, { autoAlpha: peak * 0.25 }, { autoAlpha: peak, duration: inSec, ease: "expo.in", immediateRender: false }, at);
    tl.to(ribbon, { autoAlpha: 0, duration: outSec, ease: "expo.out" }, at + inSec + holdSec);
    tl.set(ribbon, { autoAlpha: 0 }, at + inSec + holdSec + outSec);
  }
}

// --- whipPan ----------------------------------------------------------------

/**
 * A CINEMATIC WHIP: luminous horizontal streaks, not vertical bars.
 *
 * The previous overlay was `repeating-linear-gradient(90deg, …)` — evenly
 * spaced vertical bars over the whole frame, which read as a rendering fault
 * rather than as motion. This is a soft directional smear (two accent streaks
 * plus a real horizontal backdrop blur) that is invisible at both ends of the
 * window and maximal exactly at the midpoint, where the stage has wrapped and
 * the acts swap.
 *
 * The stage translation itself lives in `camera.ts` (`stageOffsetAt`) so it
 * composes with the keyframes instead of fighting them.
 */
function buildWhipPan(
  rig: HTMLElement,
  tl: gsap.core.Timeline,
  tr: Extract<Transition, { kind: "whipPan" }>,
  at: number,
  inSec: number,
  holdSec: number,
  outSec: number
): void {
  const dir = tr.direction === "left" ? -1 : 1;

  const band = mk([
    "z-index:900;opacity:0;",
    // a horizontal smear: bright at the leading edge, nothing at the trailing one
    `background:linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(125,211,252,0.20) ${dir < 0 ? 22 : 70}%, ` +
      `rgba(255,255,255,0.44) 50%, rgba(167,139,250,0.20) ${dir < 0 ? 70 : 22}%, rgba(255,255,255,0) 100%);`,
    `backdrop-filter:blur(${WHIP_PAN_MAX_BLUR_PX}px);-webkit-backdrop-filter:blur(${WHIP_PAN_MAX_BLUR_PX}px);`,
  ]);
  rig.appendChild(band);

  // two thin accent streaks riding the direction of travel — the "luminous
  // accent" that sells the pan, spaced so they never read as a repeating band
  for (const atPct of [34, 62]) {
    const streak = mk([
      "position:absolute;top:0;bottom:0;",
      `left:${atPct - 3}%;width:6%;`,
      "background:linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.5), rgba(255,255,255,0));",
      "filter:blur(2px);",
    ]);
    band.appendChild(streak);
    tl.fromTo(
      streak,
      { xPercent: dir * 120, autoAlpha: 0.2 },
      { xPercent: dir * -120, autoAlpha: 1, duration: Math.max(0.01, inSec + holdSec), ease: "power2.in", immediateRender: false },
      at
    );
    tl.to(streak, { autoAlpha: 0, duration: Math.max(0.01, outSec), ease: "power2.out" }, at + inSec + holdSec);
  }

  prepare(tl, band, at, inSec + holdSec + outSec);

  // the smear itself: 0 at both ends, full at the seam midpoint
  tl.fromTo(
    band,
    { opacity: 1, backdropFilter: "blur(0px)", WebkitBackdropFilter: "blur(0px)" },
    { opacity: 1, duration: Math.max(0.01, inSec), ease: "power2.in", immediateRender: false },
    at
  );  tl.fromTo(
    band,
    { opacity: 1, backdropFilter: `blur(${WHIP_PAN_MAX_BLUR_PX}px)`, WebkitBackdropFilter: `blur(${WHIP_PAN_MAX_BLUR_PX}px)` },
    { opacity: 0, backdropFilter: "blur(0px)", WebkitBackdropFilter: "blur(0px)", duration: Math.max(0.01, outSec), ease: "power2.out", immediateRender: false },
    at + inSec + holdSec
  );
  tl.set(band, { opacity: 0, backdropFilter: "blur(0px)", WebkitBackdropFilter: "blur(0px)" }, at + inSec + holdSec + outSec);
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
  const durMs = tr.durationMs;
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
    tl.set(fringe, { opacity: glitchIntensityAt(pIn, peak, durMs) }, at + inSec * pIn);
    tl.set(flash, { opacity: i === steps ? 0.55 : 0 }, at + inSec * pIn);
  }
  for (let i = 0; i <= steps; i++) {
    const pOut = 0.5 + (i / steps) * 0.5;
    tl.set(fringe, { opacity: glitchIntensityAt(pOut, peak, durMs) }, at + inSec + outSec * (i / steps));
    tl.set(flash, { opacity: 0 }, at + inSec + outSec * (i / steps));
  }
  sliceEls.forEach((bar, i) => {
    for (let step = 0; step <= steps; step++) {
      const pIn = step / steps;
      tl.set(bar, { xPercent: glitchSliceAt(pIn, i, slices, peak, durMs) }, at + inSec * pIn);
      const pOut = 0.5 + (step / steps) * 0.5;
      tl.set(bar, { xPercent: glitchSliceAt(pOut, i, slices, peak, durMs) }, at + inSec + outSec * (step / steps));
    }
  });
  // nothing may survive the window
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
  // Opaque CORE. The portal used to top out at 0.72–0.95 alpha, so the frame
  // it was supposed to hide stayed faintly visible through it — the acts were
  // swapped in plain sight at the seam. The core is now fully opaque and only
  // the outer rim feathers.
  const portal = mk([
    "z-index:900;opacity:0;",
    "background:radial-gradient(circle at 50% 50%, rgba(8,12,24,1) 0%, rgba(8,12,24,1) 58%, rgba(8,12,24,0.94) 100%);",
    "backdrop-filter:blur(0px);-webkit-backdrop-filter:blur(0px);",
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
      phase: bellPhaseAt(overlay.kind, p, overlay.durationMs),
    });
  }
  return out.sort((a, b) => a.progressPct - b.progressPct);
}
