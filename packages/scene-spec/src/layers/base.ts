import { z } from "zod";
import { colorSchema, EASINGS, idSchema, msSchema, offsetSchema } from "../common.js";
import { presetRefSchema } from "../motion.js";
import { sfxTriggerSchema } from "../audio.js";
import { layoutSlotSchema } from "../layout-slots.js";

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

export const LAYER_ANCHORS = [
  "center",
  "topLeft",
  "topRight",
  "bottomLeft",
  "bottomRight",
] as const;
export type LayerAnchor = (typeof LAYER_ANCHORS)[number];
export const layerAnchorSchema = z.enum(LAYER_ANCHORS);

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
 * Visual filters a layer's painted content can carry.
 *
 * NAMING: this bag is called `filters`, NOT `effects`. `foregroundFX.effects`
 * already means something else entirely (an array of vignette / filmGrain /
 * colorGrade overlays), and two sibling layer kinds reading `effects` with two
 * different shapes is a bug farm. `foregroundFX.effects` stays exactly as it is.
 */
export const LAYER_FILTER_KEYS = [
  "blur",
  "brightness",
  "contrast",
  "saturate",
  "shadowBlur",
  "shadowColor",
  "cornerRadius",
] as const;
export type LayerFilterKey = (typeof LAYER_FILTER_KEYS)[number];

export const layerFilterSchema = z.strictObject({
  /** Gaussian blur radius, in pixels. */
  blur: z.number().min(0).max(200).optional(),
  /** Brightness, in percent (100 = unchanged). */
  brightness: z.number().min(0).max(400).optional(),
  /** Contrast, in percent (100 = unchanged). */
  contrast: z.number().min(0).max(400).optional(),
  /** Saturation, in percent (100 = unchanged). */
  saturate: z.number().min(0).max(400).optional(),
  /** Drop-shadow blur radius, in pixels. */
  shadowBlur: z.number().min(0).max(200).optional(),
  /** Drop-shadow colour. */
  shadowColor: colorSchema.optional(),
  /** Corner radius of the layer's own box, in pixels. */
  cornerRadius: z.number().min(0).max(400).optional(),
});
export type LayerFilter = z.infer<typeof layerFilterSchema>;

/** The properties a unified keyframe can drive. */
export const KEYFRAME_PROPERTIES = ["xPct", "yPct", "scale", "rotation", "opacity"] as const;
export type KeyframeProperty = (typeof KEYFRAME_PROPERTIES)[number];

/**
 * The closed easing set a unified keyframe may use.
 *
 * Deliberately small: these are the curves the runtime implements EXACTLY, so
 * the value the Studio previews is the value the renderer produces.
 */
export const KEYFRAME_EASINGS = [
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
  "cubic",
  ...EASINGS.filter((e) => e !== "linear"),
] as const;
export type KeyframeEasing = (typeof KEYFRAME_EASINGS)[number];

/** The legal range of a keyframe's value, per property. */
export const KEYFRAME_VALUE_RANGES: Record<KeyframeProperty, { min: number; max: number }> = {
  xPct: { min: -300, max: 300 },
  yPct: { min: -300, max: 300 },
  scale: { min: 0.05, max: 10 },
  rotation: { min: -3600, max: 3600 },
  opacity: { min: 0, max: 1 },
};

/**
 * ONE unified keyframe.
 *
 * The legacy `tracks` system (an array of `{ property, keyframes: [{ at, value,
 * ease }] }`) stays supported, but this flat shape is the surface the Studio
 * and the runtime both speak: a keyframe is a property, a time and a value.
 */
export const layerKeyframeSchema = z
  .strictObject({
    id: idSchema,
    /** absolute time on the scene timeline, in milliseconds */
    timeMs: msSchema,
    property: z.enum(KEYFRAME_PROPERTIES),
    value: z.number().finite(),
    easing: z.enum(KEYFRAME_EASINGS).default("easeInOut"),
  })
  .superRefine((keyframe, ctx) => {
    const range = KEYFRAME_VALUE_RANGES[keyframe.property];
    if (!range) return;
    if (keyframe.value < range.min || keyframe.value > range.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message:
          `keyframe value ${keyframe.value} is out of range for "${keyframe.property}" ` +
          `(allowed: ${range.min}..${range.max})`,
      });
    }
  });
export type LayerKeyframe = z.infer<typeof layerKeyframeSchema>;

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
  /**
   * Named layout slot preset. Provides default canvas position and size.
   * Explicit position and size override slot values independently.
   */
  layoutSlot: layoutSlotSchema.optional(),
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
  /**
   * Spatial anchor point of the layer. Default: "center".
   * For left-aligned editorial text with maxWidthPct, "topLeft" ensures
   * deterministic left margin alignment from position.xPct.
   */
  anchor: layerAnchorSchema.default("center").optional(),
  /** Uniform scale multiplier (1 = the authored size). */
  scale: z.number().min(0.05).max(10).optional(),
  /** Non-uniform scale on the X axis. Overrides the uniform `scale`. */
  scaleX: z.number().min(0.05).max(10).optional(),
  /** Non-uniform scale on the Y axis. Overrides the uniform `scale`. */
  scaleY: z.number().min(0.05).max(10).optional(),
  /**
   * Layout size of the layer, as a percentage of the canvas.
   *
   * Separate from the visual filters: `size` changes the LAYOUT box, filters
   * change how the painted box looks.
   */
  size: z
    .strictObject({
      widthPct: z.number().min(0).max(400).optional(),
      heightPct: z.number().min(0).max(400).optional(),
    })
    .optional(),
  /** Visual filters applied to the layer's painted content. */
  filters: layerFilterSchema.optional(),
  /** Unified keyframes — the flat animation surface for this layer. */
  keyframes: z.array(layerKeyframeSchema).max(200).optional(),
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
