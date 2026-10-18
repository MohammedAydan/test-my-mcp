import {
  ASSET_KINDS,
  BACKGROUND_VARIANTS,
  CAMERA_MOVES,
  CANVAS_SHAPES,
  CANVAS_SCALES,
  CARD_VARIANTS,
  EASINGS,
  EMPHASIS_PRESETS,
  ENTRANCE_PRESETS,
  EXIT_PRESETS,
  FONT_ROLES,
  FOREGROUND_FX_KINDS,
  LAYER_TYPES,
  LOGO_MASKS,
  SFX_NAMES,
  TRANSITION_KINDS,
  authoringDigest,
} from "@motionforge/scene-spec";
import { readFileSync, statSync } from "node:fs";

/**
 * Engine identity.
 *
 * Report 1 (I-12) asked for this: an agent that rendered with two different
 * builds could not tell which one produced a given MP4, so a "the fix didn't
 * work" report was unfalsifiable. `version` comes from the package manifest and
 * `buildTimestamp` from the mtime of the built runtime bundle — the artefact the
 * frames were actually rasterized from.
 */
export function engineIdentity(): { version: string; buildTimestamp: string; runtimeBuilt: boolean } {
  let version = "0.0.0";
  try {
    // resolve relative to this module so the lookup works identically from
    // `src/` (tsx) and `dist/` (node)
    version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? version;
  } catch {
    // fall through: an unreadable manifest must not break capabilities
  }
  try {
    const built = statSync(new URL("../../scene-runtime/dist/", import.meta.url).pathname);
    return { version, buildTimestamp: new Date(built.mtimeMs).toISOString(), runtimeBuilt: true };
  } catch {
    return { version, buildTimestamp: "", runtimeBuilt: false };
  }
}

/**
 * Every field of `camera.keyframes`, with the defaults and the safe range.
 *
 * Report 1 (I-1/I-2) showed the docs saying keyframes "inherit unset fields"
 * while the engine clamped nothing and the runtime only *accidentally*
 * inherited. The safe-range column is what an author needs to avoid the black
 * void the engine now warns about (`CAMERA_VIEWPORT_EXCEEDS_CANVAS`).
 */
export const CAMERA_KEYFRAME_FIELDS = [
  { field: "at", type: "number", unit: "ms", required: true, notes: "must be sorted ascending; <= scene.durationMs" },
  { field: "scale", type: "number", default: 1, safeRange: [0.1, 6], notes: "1 = canvas fills the frame; >1 crops in" },
  { field: "xPct", type: "number", default: 50, safeRange: [0, 100], notes: "canvas point the camera looks at; 50 = centered. At scale s the safe range is [50/s, 100-50/s] — outside it exposes black void." },
  { field: "yPct", type: "number", default: 50, safeRange: [0, 100], notes: "same as xPct on the vertical axis" },
  { field: "roll", type: "number", unit: "deg", default: 0, safeRange: [-360, 360] },
  { field: "pitch", type: "number", unit: "deg", default: 0, safeRange: [-89, 89], notes: "rotationX on the 2.5D rig" },
  { field: "yaw", type: "number", unit: "deg", default: 0, safeRange: [-89, 89], notes: "rotationY on the 2.5D rig" },
  { field: "ease", type: "string | {bezier}", notes: "ease of the tween FROM the previous keyframe TO this one; default power2.inOut" },
] as const;

/** How `camera.moves` compose with keyframes, and what each one peaks at. */
export const CAMERA_MOVE_SHAPES = {
  slowPushIn: {
    args: { move: "slowPushIn", at: "ms", durationMs: "ms (default 800)", strength: "0.1-3 (default 1)" },
    peak: "+0.12 * strength scale, ramped back out",
    envelope: "ramp-in 28% / hold / ramp-out 28%",
  },
  whipPanLeft: { args: { move: "whipPanLeft", at: "ms", durationMs: "ms", strength: "0.1-3" }, peak: "-26 * strength % horizontal pan, ramped back out", envelope: "ramp-in / hold / ramp-out (the same 3-stage envelope as every other move)" },
  whipPanRight: { args: { move: "whipPanRight", at: "ms", durationMs: "ms", strength: "0.1-3" }, peak: "+26 * strength % horizontal pan, ramped back out", envelope: "ramp-in / hold / ramp-out (the same 3-stage envelope as every other move)" },
  shakeImpact: { args: { move: "shakeImpact", at: "ms", durationMs: "ms", strength: "0.1-3" }, peak: "sin(p*pi*5)*(1-p)^2 decay on rotation + scale; exactly 0 at both ends", envelope: "sampled decay (no ramp — the impact snaps in and settles)" },
  focusTarget: {
    args: { move: "focusTarget", at: "ms", durationMs: "ms", targetLayerId: "layer id (REQUIRED — the move is skipped without it)", strength: "0.1-3" },
    peak: "scale 1.45 * strength centred on the layer's measured box",
    envelope: "ramp-in 28% / hold / ramp-out 28% — returns to the pre-move pose",
  },
} as const;

/**
 * Full parameter shape of every scene transition. Report 1 (I-4/I-5/I-6) sent
 * authors guessing `direction` for a kind that has none, and defaulting
 * `featherPx` onto a `glitch`.
 */
export const TRANSITION_SHAPES: Record<(typeof TRANSITION_KINDS)[number], Record<string, unknown>> = {
  wipe: {
    kind: "wipe",
    at: "ms (required)",
    durationMs: "ms (default 700)",
    direction: '"left" | "right" | "up" | "down" (default "right") — the edge the curtain enters from',
    featherPx: "0-400 (default 0) — softens the curtain edge",
    color: "CSS color for the curtain (default #000000)",
    shape: "2-phase bell: 0-48% expo.in covers the frame, 48-52% holds it fully covered (the seam swap happens here), 52-100% expo.out reveals",
  },
  glitch: {
    kind: "glitch",
    at: "ms (required)",
    durationMs: "ms (default 500)",
    intensity: "0-1 (default 0.6) — RGB split + slice displacement amplitude",
    shape: "stepped bell: 8 discrete steps per leg, high-contrast flash exactly at 50%, everything cleared at 100%",
  },
  whipPan: {
    kind: "whipPan",
    at: "ms (required)",
    durationMs: "ms (default 500)",
    direction: '"left" | "right" (default "left")',
    shape: "2-phase bell: 0-50% power3.in slams the stage to ±45%, the midpoint wraps to ∓45% under peak motion blur, 50-100% power3.out returns to exactly x:0 with streaks 1→0",
  },
  morph: {
    kind: "morph",
    at: "ms (required)",
    durationMs: "ms (default 800)",
    shape: "2-phase bell: 0-50% power2.inOut expands a radial iris from the centre to scale 1.05 with backdrop blur 0→24px, 50-100% contracts and dissolves to opacity 0 and blur 0",
  },
};

/** The nested shapes that are easy to get wrong (report 1 I-10/I-11). */
export const NESTED_FIELD_SHAPES = {
  "kineticText.box": {
    maxWidthPct: "number 0-100 (required when `box` is present)",
    paddingPx: "number — padding belongs HERE, not on box.chip",
    chip: {
      color: "CSS color — the chip fill",
      opacity: "0-1",
      radiusPx: "number — corner radius",
    },
  },
  "kineticText.highlight": {
    color: "CSS color — the pill painted behind each word",
    radiusPx: "number (default 8)",
    paddingPx: "number (default 6) — pill padding; the pill is INSIDE the animated word unit so it appears with the glyph",
  },
  "card.variant=callout": {
    accentColor: "CSS color (required)",
    accentSide: '"left" | "right" (default "left")',
    title: "string",
    body: "string",
    widthPx: "number",
    paddingPx: "number",
    radiusPx: "number",
    glass: "{ blurPx?, tintColor?, tintOpacity? }",
  },
  "card.variant=progressBar": {
    value: "number 0-100 (required)",
    fill: "CSS color or gradient object (required)",
    label: "string — rendered in the header row, opposite the percentage",
    trackColor: "CSS color",
    heightPx: "number",
    radiusPx: "number",
    showPercentage: "boolean — the percentage is laid out INSIDE the card's header row, never past the bar's right edge",
    widthPx: "number",
  },
} as const;

/**
 * The single source of truth for "what is possible", generated from the
 * scene-spec registries and the authoring digest derived from the Zod schemas —
 * this is what `get_motion_capabilities` returns, so the LLM can never
 * hallucinate an unsupported feature.
 *
 * STRUCTURE MATTERS, not just vocabulary: without `layerFieldGuide` /
 * `minimalValidScene` an LLM knows every legal name but still guesses wrong
 * about shapes (`variant: "meshGradient"` instead of an object, `preset:` instead
 * of `entrance: {name}`), and every guess is a 400. Those payloads are therefore
 * not optional decoration — they are the authoring contract.
 */
export function capabilities(): Record<string, unknown> {
  return {
    ...authoringDigest(),
    engine: engineIdentity(),
    // flat aliases, kept for callers written against the original shape
    layerTypes: LAYER_TYPES,
    backgroundVariants: BACKGROUND_VARIANTS,
    cardVariants: CARD_VARIANTS,
    foregroundFxKinds: FOREGROUND_FX_KINDS,
    presets: {
      entrance: ENTRANCE_PRESETS,
      emphasis: EMPHASIS_PRESETS,
      exit: EXIT_PRESETS,
    },
    easings: EASINGS,
    cameraMoves: CAMERA_MOVES,
    cameraKeyframeFields: CAMERA_KEYFRAME_FIELDS,
    cameraMoveShapes: CAMERA_MOVE_SHAPES,
    transitionShapes: TRANSITION_SHAPES,
    nestedFieldShapes: NESTED_FIELD_SHAPES,
    canvas: { shapes: CANVAS_SHAPES, scales: CANVAS_SCALES },
    sfxBank: SFX_NAMES,
    transitions: TRANSITION_KINDS,
    textRoles: FONT_ROLES,
    logoMasks: LOGO_MASKS,
    assetKinds: ASSET_KINDS,
  };
}