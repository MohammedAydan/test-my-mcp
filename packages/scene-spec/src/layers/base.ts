import { z } from "zod";
import { idSchema, msSchema, offsetSchema } from "../common.js";
import { presetRefSchema } from "../motion.js";
import { sfxTriggerSchema } from "../audio.js";

/**
 * CSS blend modes a layer root may be composited with.
 *
 * Kept as a closed set so the runtime can map every value onto a real
 * `mix-blend-mode` without a fallback branch.
 */
export const LAYER_BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "plus-lighter",
] as const;
export type LayerBlendMode = (typeof LAYER_BLEND_MODES)[number];

export const keyframeSchema = z.strictObject({
  at: msSchema,
  value: z.union([z.number(), z.string()]),
  ease: z.string().optional(),
});
export type Keyframe = z.infer<typeof keyframeSchema>;

export const keyframeTrackSchema = z.strictObject({
  property: z.string().min(1).max(80),
  keyframes: z.array(keyframeSchema).min(1),
});
export type KeyframeTrack = z.infer<typeof keyframeTrackSchema>;

/**
 * Fields shared by every layer. Timing: a layer exists from `at` for `duration`
 * ms (default: until the end of the scene). SFX triggers fire relative to `at`.
 */
export const layerBaseSchema = z.strictObject({
  id: idSchema,
  name: z.string().max(120).optional(),
  z: z.number().int().min(0).max(999).optional(),
  at: msSchema.default(0),
  duration: msSchema.optional(),
  /**
   * 0-indexed timeline track lane assignment.
   * Non-overlapping clips assigned the same trackIndex render on the same timeline track row.
   * If omitted, the layer renders on its own sequential visual track row.
   */
  trackIndex: z.number().int().min(0).max(99).optional(),
  /** Authoring alias for trackIndex */
  trackLane: z.number().int().min(0).max(99).optional(),
  /** Rotation in degrees (-3600 to 3600) around layer center */
  rotation: z.number().min(-3600).max(3600).optional(),
  /**
   * Center anchor of the layer, in percent of the canvas.
   *
   * Optional here so it can be declared by EVERY layer kind — the Studio's
   * direct-manipulation overlay writes `position` onto whichever layer the
   * user grabbed, and a `background` at `layers.0` is the most common target.
   * Kinds that require an anchor (`kineticText`, `card`, `imageLogo`,
   * `lottie`) re-declare it with their own required/defaulted shape.
   */
  position: offsetSchema.optional(),
  /** Uniform scale multiplier (1 = the authored size). */
  scale: z.number().min(0.05).max(10).optional(),
  /** Opacity multiplier (1 = fully opaque). */
  opacity: z.number().min(0).max(1).optional(),
  /** Authored visibility — `false` hides the layer without deleting it. */
  visible: z.boolean().optional(),
  /** Authored lock — the layer is not editable in the Studio. */
  locked: z.boolean().optional(),
  /** CSS blend mode applied to the layer root. */
  blendMode: z.enum(LAYER_BLEND_MODES).optional(),
  /** Optional keyframe property animation tracks */
  tracks: z.array(keyframeTrackSchema).optional(),
  /**
   * Reading direction for this layer's own copy.
   *
   * Arabic/Hebrew layers set `"rtl"`; the runtime ALSO infers it from the text
   * itself (Arabic script anywhere in the layer's copy), so a card lays out
   * right-to-left without the author having to remember. Inline numerals stay
   * LTR automatically — that is the bidi algorithm's job, not this flag's.
   */
  direction: z.enum(["ltr", "rtl"]).default("ltr"),
  entrance: presetRefSchema.optional(),
  emphasis: presetRefSchema.optional(),
  exit: presetRefSchema.optional(),
  sfx: z.array(sfxTriggerSchema).max(12).optional(),
});
export type LayerBase = z.infer<typeof layerBaseSchema>;
