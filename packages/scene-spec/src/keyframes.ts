import type { KeyframeEasing, KeyframeProperty, LayerKeyframe, KeyframeTrack } from "./layers/base.js";

/**
 * Keyframe evaluation.
 *
 * ONE implementation, shared by the runtime (which renders) and the Studio
 * (which shows the value in the inspector). If the two disagreed, the
 * inspector would display a number the preview does not draw — the exact
 * "the field and the preview disagree" defect.
 *
 * The legacy `layer.tracks` system is reduced to the same sample shape, so
 * both keyframe surfaces speak one language.
 */

/** One interpolation sample — the shape both keyframe systems reduce to. */
export interface KeyframeSample {
  timeMs: number;
  value: number;
  easing: KeyframeEasing;
}

function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  let p = t;
  if (p < 1 / d1) return n1 * p * p;
  if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75;
  if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375;
  return n1 * (p -= 2.625 / d1) * p + 0.984375;
}

/** The easing curves of the flat keyframe surface. */
export const KEYFRAME_EASING_FUNCTIONS: Record<KeyframeEasing, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) * (-2 * t + 2)) / 2),
  cubic: (t) => t * t * t,
  "power1.in": (t) => t * t,
  "power1.out": (t) => 1 - (1 - t) * (1 - t),
  "power1.inOut": (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  "power2.in": (t) => t * t * t,
  "power2.out": (t) => 1 - Math.pow(1 - t, 3),
  "power2.inOut": (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  "power3.in": (t) => Math.pow(t, 4),
  "power3.out": (t) => 1 - Math.pow(1 - t, 4),
  "power3.inOut": (t) => (t < 0.5 ? 8 * Math.pow(t, 4) : 1 - Math.pow(-2 * t + 2, 4) / 2),
  "power4.in": (t) => Math.pow(t, 5),
  "power4.out": (t) => 1 - Math.pow(1 - t, 5),
  "power4.inOut": (t) => (t < 0.5 ? 16 * Math.pow(t, 5) : 1 - Math.pow(-2 * t + 2, 5) / 2),
  "expo.in": (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  "expo.out": (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  "expo.inOut": (t) =>
    t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  "circ.in": (t) => 1 - Math.sqrt(1 - Math.pow(t, 2)),
  "circ.out": (t) => Math.sqrt(1 - Math.pow(t - 1, 2)),
  "circ.inOut": (t) =>
    t < 0.5
      ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
      : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2,
  "sine.in": (t) => 1 - Math.cos((t * Math.PI) / 2),
  "sine.out": (t) => Math.sin((t * Math.PI) / 2),
  "sine.inOut": (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  "back.in(1.7)": (t) => 2.70158 * t * t * t - 1.70158 * t * t,
  "back.out(1.7)": (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  "back.out(2.5)": (t) => 1 + 3.5 * Math.pow(t - 1, 3) + 2.5 * Math.pow(t - 1, 2),
  "back.out(4)": (t) => 1 + 5 * Math.pow(t - 1, 3) + 4 * Math.pow(t - 1, 2),
  "back.inOut(1.7)": (t) => {
    const c = 1.70158 * 1.525;
    return t < 0.5
      ? (Math.pow(2 * t, 2) * ((c + 1) * 2 * t - c)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c + 1) * (t * 2 - 2) + c) + 2) / 2;
  },
  "elastic.in(1,0.75)": (t) =>
    t === 0
      ? 0
      : t === 1
      ? 1
      : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3)),
  "elastic.out(1,0.5)": (t) =>
    t === 0
      ? 0
      : t === 1
      ? 1
      : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  "elastic.out(1,0.75)": (t) =>
    t === 0
      ? 0
      : t === 1
      ? 1
      : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  "bounce.in": (t) => 1 - bounceOut(1 - t),
  "bounce.out": (t) => bounceOut(t),
  "steps(12)": (t) => Math.floor(t * 12) / 12,
};

/** The legacy `tracks` property names mapped onto the unified property set. */
export const LEGACY_PROPERTY_MAP: Record<string, KeyframeProperty> = {
  "position.xPct": "xPct",
  "position.yPct": "yPct",
  xPct: "xPct",
  yPct: "yPct",
  scale: "scale",
  rotation: "rotation",
  opacity: "opacity",
};

/**
 * Map a GSAP ease name onto one of the five keyframe easings.
 *
 * `linear` (and GSAP's `none`) is linear, `*.in` eases in, `*.out` eases out,
 * `*.inOut` does both, and anything unrecognised falls back to `easeInOut` —
 * the same default the flat keyframe schema declares.
 */
export function legacyEaseToKeyframeEasing(ease: string | undefined): KeyframeEasing {
  if (!ease) return "easeInOut";
  const name = ease.trim().toLowerCase();
  if (name === "none" || name === "linear") return "linear";
  if (name.endsWith(".inout") || name.endsWith("_inout")) return "easeInOut";
  if (name.endsWith(".in")) return "easeIn";
  if (name.endsWith(".out")) return "easeOut";
  return "easeInOut";
}

/** The samples of the FLAT `layer.keyframes` array for one property. */
export function flatKeyframeSamples(
  keyframes: readonly LayerKeyframe[] | undefined,
  property: KeyframeProperty
): KeyframeSample[] {
  if (!keyframes || keyframes.length === 0) return [];
  return keyframes
    .filter(
      (kf) =>
        kf &&
        kf.property === property &&
        typeof kf.value === "number" &&
        Number.isFinite(kf.value) &&
        typeof kf.timeMs === "number" &&
        Number.isFinite(kf.timeMs)
    )
    .map((kf) => ({
      timeMs: kf.timeMs,
      value: kf.value,
      easing: kf.easing ?? "easeInOut",
    }))
    .sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * The samples of the LEGACY `layer.tracks` system for one property.
 *
 * `at` becomes `timeMs` and the GSAP ease name is mapped onto one of the five
 * keyframe easings — the legacy system keeps working, it just speaks the
 * unified language at evaluation time.
 */
export function legacyKeyframeSamples(
  tracks: readonly KeyframeTrack[] | undefined,
  property: KeyframeProperty
): KeyframeSample[] {
  if (!tracks || tracks.length === 0) return [];
  const out: KeyframeSample[] = [];
  for (const track of tracks) {
    if (!track || LEGACY_PROPERTY_MAP[track.property] !== property) continue;
    const samples = track.keyframes
      .filter((kf) => typeof kf.value === "number" && Number.isFinite(kf.value))
      .map((kf) => ({
        timeMs: kf.at,
        value: kf.value as number,
        easing: legacyEaseToKeyframeEasing(kf.ease),
      }))
      .sort((a, b) => a.timeMs - b.timeMs);
    out.push(...samples);
  }
  return out.sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * The samples that drive one property, with the FLAT keyframes winning.
 *
 * PRECEDENCE: when a property is keyframed in BOTH systems, the flat
 * `keyframes` array wins — it is the newer, explicit surface, and mixing the
 * two would make the rendered value depend on which array happened to be
 * authored last.
 */
export function keyframeSamplesFor(
  keyframes: readonly LayerKeyframe[] | undefined,
  tracks: readonly KeyframeTrack[] | undefined,
  property: KeyframeProperty
): KeyframeSample[] {
  const flat = flatKeyframeSamples(keyframes, property);
  if (flat.length > 0) return flat;
  return legacyKeyframeSamples(tracks, property);
}

/** Interpolate a sorted list of samples at one time. */
export function interpolateKeyframeSamples(
  samples: readonly KeyframeSample[],
  timeMs: number
): number | undefined {
  if (samples.length === 0) return undefined;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  if (timeMs <= first.timeMs) return first.value;
  if (timeMs >= last.timeMs) return last.value;
  for (let i = 0; i < samples.length - 1; i++) {
    const left = samples[i]!;
    const right = samples[i + 1]!;
    if (timeMs < left.timeMs || timeMs > right.timeMs) continue;
    const span = right.timeMs - left.timeMs;
    if (span <= 0) return right.value;
    const t = (timeMs - left.timeMs) / span;
    const eased = KEYFRAME_EASING_FUNCTIONS[left.easing](t);
    return left.value + (right.value - left.value) * eased;
  }
  return last.value;
}

/**
 * The value of a keyframed property at one time.
 *
 * - before the first keyframe → the first keyframe's value
 * - after the last keyframe → the last keyframe's value
 * - exactly on a keyframe → that keyframe's value
 * - between two keyframes → the LEFT keyframe's easing over the progress
 *
 * Returns `undefined` when the property is not keyframed at all, so the caller
 * falls back to the authored value.
 */
export function interpolateKeyframeValue(
  keyframes: readonly LayerKeyframe[] | undefined,
  tracks: readonly KeyframeTrack[] | undefined,
  property: KeyframeProperty,
  timeMs: number
): number | undefined {
  return interpolateKeyframeSamples(keyframeSamplesFor(keyframes, tracks, property), timeMs);
}
