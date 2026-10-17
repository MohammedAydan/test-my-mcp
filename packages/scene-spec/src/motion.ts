import { z } from "zod";
import { easeSchema, msSchema } from "./common.js";

/**
 * Motion preset registry — the closed vocabulary of studio-grade animations the
 * runtime implements in `scene-runtime/src/presets.ts`. The LLM may only use
 * these names; the registry is surfaced verbatim by `get_motion_capabilities`.
 */
export const ENTRANCE_PRESETS = [
  "springPop",
  "smoothSlideUp",
  "maskRevealWipe",
  "elasticScale",
  "blurFadeIn",
  "3dFlipIn",
] as const;

export const EMPHASIS_PRESETS = [
  "pulseGlow",
  "floatIdle",
  "lightSweep",
  "cameraShakeImpact",
] as const;

export const EXIT_PRESETS = [
  "scaleDownFade",
  "whipOutLeft",
  "collapseMask",
] as const;

export const MOTION_PRESETS = [
  ...ENTRANCE_PRESETS,
  ...EMPHASIS_PRESETS,
  ...EXIT_PRESETS,
] as const;

export type EntrancePreset = (typeof ENTRANCE_PRESETS)[number];
export type EmphasisPreset = (typeof EMPHASIS_PRESETS)[number];
export type ExitPreset = (typeof EXIT_PRESETS)[number];
export type MotionPreset = (typeof MOTION_PRESETS)[number];

/**
 * Reference to a preset with generic knobs. Each preset has its own professional
 * defaults; `strength` scales its base intensity (0.2–2), `staggerMs` applies to
 * word/char text splits and multi-element layers, `ease` overrides the preset's
 * curated default.
 */
export const presetRefSchema = z.strictObject({
  name: z.enum(MOTION_PRESETS),
  durationMs: msSchema.optional(),
  delayMs: msSchema.optional(),
  ease: easeSchema.optional(),
  staggerMs: msSchema.optional(),
  strength: z.number().min(0.2).max(2).optional(),
});
export type PresetRef = z.infer<typeof presetRefSchema>;
