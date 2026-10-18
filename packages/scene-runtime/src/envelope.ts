/**
 * Universal In → Active → Out envelope for every TEMPORARY effect.
 *
 * THE DEFECT THIS FIXES: emphasis presets (`pulseGlow`, `floatIdle`,
 * `lightSweep`, `cameraShakeImpact`) and temporary camera moves (`focusTarget`,
 * `slowPushIn`, …) were authored as one-shot tweens. They started smoothly from
 * identity and then *held* whatever the last frame of the tween wrote — so when
 * the window expired the element was stranded at a non-zero `y` / `scale` /
 * `drop-shadow`, and the next thing on the timeline (or nothing at all) cut to
 * it in one frame. Field renders showed elements "snapping" a third of a second
 * after they were supposed to have settled.
 *
 * The contract every effect now obeys, and the thing the tests assert:
 *
 *   delta(0) === identity   →   ramp-in   →   oscillation / hold
 *                                        →   ramp-out   →   delta(1) === identity
 *
 * Nothing here reaches for wall-clock time; every value is a pure function of a
 * normalized progress `p ∈ [0,1]`, so the same envelope holds under a seek to an
 * arbitrary frame.
 */
import { gsap } from "gsap";

/** Fraction of the effect window spent ramping up from identity (and down to it). */
export const ENVELOPE_RAMP_FRACTION = 0.2;

/** Guard band, in ms, before a layer's own end where an auto-exit fade may start. */
export const AUTO_EXIT_TAIL_GUARD_MS = 50;

/** Length of the implicit fade applied to a bounded layer that declares no exit. */
export const AUTO_EXIT_FADE_MS = 220;

// ---------------------------------------------------------------------------
// planEnvelope — the ramp-in / symmetric-cycle / ramp-out layout
// ---------------------------------------------------------------------------

export interface EnvelopePlan {
  /** total window length, seconds */
  windowSec: number;
  /** dedicated ramp from identity up to the peak (first 20% of the window) */
  rampInSec: number;
  /** one full up-and-down traversal of the oscillation */
  cycleSec: number;
  /** half of `cycleSec`: identity → peak (or peak → identity) */
  halfCycleSec: number;
  /**
   * GSAP `repeat` count for the yoyo block. Kept EVEN, which means the block
   * performs an ODD number of half-cycle traversals and therefore finishes at
   * the PEAK — exactly the pose the dedicated ramp-out needs in order to close
   * the window symmetrically back to identity.
   */
  repeats: number;
  /** number of half-cycle traversals the block performs (odd); 0 when no room */
  halfCycles: number;
  /** idle time at the peak between the last cycle and the ramp-out */
  holdSec: number;
  /** dedicated ramp from the peak back to identity (final 20% of the window) */
  rampOutSec: number;
  /** timeline offset (seconds, relative to the window start) where ramp-out begins */
  rampOutStartSec: number;
}

const MIN_HALF_CYCLE_SEC = 0.08;

/**
 * Lay an effect window out as ramp-in → symmetric yoyo cycles → ramp-out.
 *
 * The ramps take exactly the authored fraction (`ENVELOPE_RAMP_FRACTION`, 20%
 * each) so they always sit where a viewer expects them. Whatever is left in
 * the middle carries as many complete oscillations as fit, rounded to an odd
 * count so the block starts AND ends on the peak; a residual sliver becomes an
 * idle hold at the peak. The regions always tile the window exactly
 * (`rampIn + cycles + hold + rampOut === windowSec`), so an effect can never
 * overrun its own end time — the original cause of the visible cut.
 *
 * A window too short to hold even one half-cycle degenerates to a pure
 * ramp-in/ramp-out pair (each capped at half the window), which still satisfies
 * "zero delta at both ends".
 */
export function planEnvelope(
  windowSec: number,
  cycleSec: number,
  rampFraction: number = ENVELOPE_RAMP_FRACTION
): EnvelopePlan {
  const total = Math.max(0, windowSec);
  const cycle = Math.max(cycleSec, MIN_HALF_CYCLE_SEC * 2);
  const halfCycle = cycle / 2;

  let ramp = Math.min(total * rampFraction, total / 2);
  const middle = Math.max(0, total - ramp * 2);

  // Not enough room for a single half-cycle: straight ramp-in → ramp-out. This
  // is the degenerate but still-correct case — zero delta at both ends, with no
  // oscillation because there is no room for one.
  if (middle < halfCycle) {
    ramp = total / 2;
    return {
      windowSec: total,
      rampInSec: ramp,
      rampOutSec: ramp,
      halfCycleSec: halfCycle,
      cycleSec: cycle,
      repeats: 0,
      halfCycles: 0,
      holdSec: 0,
      rampOutStartSec: ramp,
    };
  }

  let traversals = Math.floor(middle / halfCycle);
  if (traversals % 2 === 0) traversals -= 1; // odd ⇒ ends on the peak
  const cyclesSec = traversals * halfCycle;
  const holdSec = Math.max(0, middle - cyclesSec);

  return {
    windowSec: total,
    rampInSec: ramp,
    rampOutSec: ramp,
    halfCycleSec: halfCycle,
    cycleSec: cycle,
    repeats: traversals - 1,
    halfCycles: traversals,
    holdSec,
    rampOutStartSec: ramp + cyclesSec + holdSec,
  };
}

// ---------------------------------------------------------------------------
// applyOscillatingEnvelope — drive `el` through the planned envelope
// ---------------------------------------------------------------------------

export interface OscillatingEnvelopeOptions {
  /** the element whose transform this effect owns (a phase wrapper, never a shared one) */
  el: HTMLElement;
  /** peak-state tween vars, e.g. `{ y: -12, scale: 1.03 }` */
  peak: gsap.TweenVars;
  /** timeline position of the window start, seconds */
  at: number;
  /** planned envelope (from `planEnvelope`) */
  plan: EnvelopePlan;
  /** ramp easing; defaults to `sine.inOut` */
  ease?: gsap.TweenVars["ease"];
}

/**
 * Write the three-part envelope onto `tl`. The element is at identity when this
 * returns; it will be at identity again once `at + plan.windowSec` has passed.
 */
export function applyOscillatingEnvelope(
  tl: gsap.core.Timeline,
  opts: OscillatingEnvelopeOptions
): void {
  const { el, peak, at, plan } = opts;
  const ease = opts.ease ?? "sine.inOut";
  const identity = identityOf(peak);

  // 1. ramp-in: exact identity → peak
  tl.fromTo(el, identity, { ...peak, duration: plan.rampInSec, ease }, at);
  // 2. symmetric yoyo cycles, ending back on the peak
  if (plan.halfCycles > 1 && plan.halfCycleSec > 0) {
    tl.to(
      el,
      {
        ...identity,
        duration: plan.halfCycleSec,
        ease,
        yoyo: true,
        repeat: plan.repeats,
      },
      at + plan.rampInSec
    );
  }
  // 3. ramp-out: peak → exact identity
  tl.to(el, { ...identity, duration: plan.rampOutSec, ease }, at + plan.rampOutStartSec);
}

/**
 * The rest value of every property a peak touches.
 *
 * `scale`, `opacity` and `autoAlpha` rest at **1**; displacements and rotations
 * rest at **0**; shadows/filters have string identities. Getting this wrong is
 * not cosmetic — ramping `scale` to 0 collapses the element to nothing instead
 * of returning it to its size, and a peak `boxShadow` without a matching
 * identity strands a glow on the layer for the rest of the scene.
 */
export function identityOf(peak: gsap.TweenVars): gsap.TweenVars {
  const identity: gsap.TweenVars = {};
  for (const key of Object.keys(peak)) identity[key] = identityValueFor(key);
  return identity;
}

/** Properties whose neutral value is 1 rather than 0. */
export const UNIT_IDENTITY_PROPS = new Set(["scale", "scaleX", "scaleY", "opacity", "autoAlpha", "zIndex"]);

/** Neutral value for the string-valued, GSAP-interpolated properties. */
export const IDENTITY_STRINGS: Record<string, string> = {
  boxShadow: "0px 0px 0px rgba(0,0,0,0)",
  textShadow: "0px 0px 0px rgba(0,0,0,0)",
  clipPath: "inset(0% 0% 0% 0%)",
  background: "rgba(0,0,0,0)",
  filter: "none",
};

function identityValueFor(key: string): number | string {
  const neutral = IDENTITY_STRINGS[key];
  if (neutral !== undefined) return neutral;
  return UNIT_IDENTITY_PROPS.has(key) ? 1 : 0;
}

/**
 * The single value an oscillating envelope reports at progress `p`, derived from
 * the same plan. Used by tests and by `describeFrame` to prove the envelope is
 * symmetric without having to sample a live GSAP timeline.
 */
export function envelopeAmplitudeAt(p: number, plan: EnvelopePlan): number {
  const clamped = Math.min(1, Math.max(0, p));
  const rampInEnd = plan.windowSec > 0 ? plan.rampInSec / plan.windowSec : 1;
  const rampOutStart = plan.windowSec > 0 ? plan.rampOutStartSec / plan.windowSec : 1;
  const rise = (from: number, to: number): number => {
    if (to <= from) return 1;
    // sine.inOut evaluated on the normalized position — matches the GSAP ease
    const x = (clamped - from) / (to - from);
    return 0.5 - 0.5 * Math.cos(Math.PI * x);
  };
  if (clamped <= rampInEnd) return rise(0, rampInEnd);
  if (clamped >= rampOutStart) return 1 - rise(rampOutStart, 1);
  if (plan.holdSec > 0) {
    const holdEnd = plan.windowSec > 0 ? (plan.rampOutStartSec - plan.holdSec) / plan.windowSec : 0;
    if (clamped <= holdEnd) return 1; // idle at the peak
  }
  // triangular oscillation between identity and the peak
  const span = Math.max(1e-6, rampOutStart - rampInEnd - plan.holdSec / Math.max(1e-6, plan.windowSec));
  const local = (clamped - rampInEnd) / span;
  const phase = (local * plan.halfCycles) % 2;
  return phase <= 1 ? phase : 2 - phase;
}

// ---------------------------------------------------------------------------
// decay envelope — cameraShakeImpact
// ---------------------------------------------------------------------------

/** Number of oscillation periods a shake completes across its window. */
export const SHAKE_WOBBLES = 5;

/** Samples per shake window; the shake is a sampled waveform, not an ease curve. */
export const SHAKE_SAMPLES = 24;

/**
 * Shake amplitude at progress `p`: a `sin` carrier multiplied by a quadratic
 * decay, so the impact snaps in and then settles — `0` at `p = 0` and at
 * `p = 1`, by construction rather than by cancellation.
 */
export function shakeDecayAt(p: number, wobbles: number = SHAKE_WOBBLES): number {
  const clamped = Math.min(1, Math.max(0, p));
  return Math.sin(clamped * Math.PI * wobbles) * Math.pow(1 - clamped, 2);
}

/**
 * Sample a decaying shake into explicit GSAP segments. Segment tweens (rather
 * than a single tween with an `ease`) are what make the waveform survivable
 * across arbitrary non-linear seeks: every frame is a real value on the
 * timeline, never an eased interpolation between two poses.
 */
export function applyDecayEnvelope(
  tl: gsap.core.Timeline,
  el: HTMLElement,
  opts: { at: number; windowSec: number; amplitude: gsap.TweenVars; wobbles?: number; samples?: number }
): void {
  const samples = Math.max(2, opts.samples ?? SHAKE_SAMPLES);
  const step = opts.windowSec / (samples - 1);
  const wobbles = opts.wobbles ?? SHAKE_WOBBLES;
  const amplitudeOf = (key: string): number =>
    typeof opts.amplitude[key] === "number" ? (opts.amplitude[key] as number) : 0;

  // tween 0 establishes exact identity, then each segment steps one sample
  const identity = identityOf(opts.amplitude);
  tl.set(el, identity, opts.at);

  for (let i = 1; i < samples; i++) {
    const p = i / (samples - 1);
    const k = shakeDecayAt(p, wobbles);
    const vars: gsap.TweenVars = { duration: step, ease: "none" };
    for (const key of Object.keys(opts.amplitude)) vars[key] = amplitudeOf(key) * k;
    tl.to(el, vars, opts.at + (i - 1) * step);
  }
}

// ---------------------------------------------------------------------------
// camera envelope — ramp-in / hold / ramp-out
// ---------------------------------------------------------------------------

export const CAMERA_ENVELOPE_IN_FRACTION = 0.28;

export interface CameraEnvelopePlan {
  inSec: number;
  holdSec: number;
  outSec: number;
  totalSec: number;
}

/**
 * Three-stage camera-move envelope. A camera move used to be a single
 * `power3.inOut` tween that *held* the zoom/pan until something else moved the
 * rig — so when `focusTarget` ended, the camera snapped back to its rest pose in
 * exactly one frame.
 */
export function planCameraEnvelope(
  durationSec: number,
  inFraction: number = CAMERA_ENVELOPE_IN_FRACTION
): CameraEnvelopePlan {
  const total = Math.max(0, durationSec);
  const inSec = total * inFraction;
  const outSec = total * inFraction;
  const holdSec = Math.max(0, total - inSec - outSec);
  return { inSec, holdSec, outSec, totalSec: total };
}

/**
 * Drive a camera move's delta through ramp-in → hold → ramp-out using *relative*
 * tweens, so the move composes with keyframes and drift instead of overwriting
 * them, and so the ramp-out returns the rig to the exact pre-move pose.
 */
export function applyCameraEnvelope(
  tl: gsap.core.Timeline,
  rig: HTMLElement,
  opts: {
    /** the state delta the move applies, e.g. `{ scale: 0.45, xPercent: -12 }` */
    delta: gsap.TweenVars;
    plan: CameraEnvelopePlan;
    at: number;
    inEase?: gsap.TweenVars["ease"];
    outEase?: gsap.TweenVars["ease"];
  }
): void {
  const { delta, plan, at } = opts;
  if (plan.totalSec <= 0 || Object.keys(delta).length === 0) return;
  const forward: gsap.TweenVars = {};
  const backward: gsap.TweenVars = {};
  for (const [key, value] of Object.entries(delta)) {
    forward[key] = typeof value === "number" ? `+=${value}` : value;
    backward[key] = typeof value === "number" ? `-=${Math.abs(value)}` : value;
  }
  tl.to(rig, { ...forward, duration: plan.inSec, ease: opts.inEase ?? "expo.out" }, at);
  tl.to(rig, { ...backward, duration: plan.outSec, ease: opts.outEase ?? "expo.inOut" }, at + plan.inSec + plan.holdSec);
}

// ---------------------------------------------------------------------------
// viewport safety
// ---------------------------------------------------------------------------

export interface ClampedPan {
  xPct: number;
  yPct: number;
  /** true when the requested pan was pulled back inside the canvas */
  clamped: boolean;
}

/**
 * Clamp a camera's look-at point so the canvas can never pan past its own edge.
 *
 * At `scale = s` the visible slice of the canvas is `100/s` percent wide, so a
 * look-at point below `50/s` (or above `100 - 50/s`) exposes black void outside
 * the frame. Below `scale = 1` nothing is ever exposed, so no clamping applies.
 */
export function clampCameraPan(scale: number, xPct: number, yPct: number): ClampedPan {
  if (!(scale > 1)) return { xPct, yPct, clamped: false };
  const margin = 50 / scale;
  const cx = Math.min(100 - margin, Math.max(margin, xPct));
  const cy = Math.min(100 - margin, Math.max(margin, yPct));
  return { xPct: cx, yPct: cy, clamped: cx !== xPct || cy !== yPct };
}

// ---------------------------------------------------------------------------
// graceful layer auto-exit
// ---------------------------------------------------------------------------

/**
 * True when a layer's own window ends early in the scene and no `exit` preset
 * was authored. Without this guard the lifecycle registry hides the layer at its
 * end time, which paints a one-frame pop instead of a fade.
 */
export function needsAutoExit(
  layer: { at: number; duration?: number; exit?: unknown },
  sceneDurationMs: number
): boolean {
  if (layer.exit) return false;
  if (layer.duration === undefined) return false;
  const endMs = layer.at + layer.duration;
  return endMs < sceneDurationMs - AUTO_EXIT_TAIL_GUARD_MS;
}

/** Where the implicit fade sits, in ms, relative to the layer's own window. */
export function autoExitWindow(
  layer: { at: number; duration?: number },
  sceneDurationMs: number
): { startMs: number; endMs: number } {
  const endMs = Math.min(
    layer.at + (layer.duration ?? sceneDurationMs),
    sceneDurationMs
  );
  const fadeMs = Math.min(AUTO_EXIT_FADE_MS, Math.max(0, endMs - layer.at));
  return { startMs: endMs - fadeMs, endMs };
}