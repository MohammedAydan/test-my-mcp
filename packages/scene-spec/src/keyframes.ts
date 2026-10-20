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

/** The easing curves of the flat keyframe surface. */
export const KEYFRAME_EASING_FUNCTIONS: Record<KeyframeEasing, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) * (-2 * t + 2)) / 2),
  cubic: (t) => t * t * t,
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
