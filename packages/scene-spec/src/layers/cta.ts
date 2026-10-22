import { z } from "zod";
import { colorSchema, offsetSchema } from "../common.js";
import { layerBaseSchema } from "./base.js";

/**
 * The visual treatments a `cta` button can take.
 *
 * A CLOSED set, so the runtime's renderer is a switch with no fallback.
 */
export const CTA_VARIANTS = ["primary", "glass", "outline", "pill"] as const;
export type CtaVariant = (typeof CTA_VARIANTS)[number];

/**
 * The glyphs a `cta` can carry.
 *
 * VECTOR ONLY: the runtime draws them as inline SVG paths. The repository
 * forbids emoji anywhere (rule 11), so an icon is a name in a closed set and
 * never a character.
 */
export const CTA_ICONS = ["arrow", "sparkles", "play", "none"] as const;
export type CtaIcon = (typeof CTA_ICONS)[number];

/**
 * A CALL-TO-ACTION BUTTON layer.
 *
 * WHY IT EXISTS: the last frame of every promo is a button, and before this
 * kind a button was a `card` with a title that happened to say "Start now" —
 * which is a rectangle of text, not a button. This kind draws the actual
 * affordance: a filled / glassed / outlined / pill button with an optional
 * label, an optional sub-label and an optional vector glyph.
 */
export const ctaLayerSchema = layerBaseSchema.extend({
  type: z.literal("cta"),
  /** centre anchor of the button, percent of canvas */
  position: offsetSchema,
  /** the button's label — the only required field */
  label: z.string().min(1).max(80),
  /** an optional second line under the label */
  sublabel: z.string().max(120).optional(),
  /** the visual treatment */
  variant: z.enum(CTA_VARIANTS).default("primary"),
  /** the accent used by `primary`, the border of `outline` and the glow */
  accentColor: colorSchema.default("#38bdf8"),
  /** the button's own background (ignored by `primary`, which uses the accent) */
  bgColor: colorSchema.optional(),
  /** the label colour */
  textColor: colorSchema.optional(),
  /** the vector glyph beside the label */
  icon: z.enum(CTA_ICONS).default("arrow"),
  /** the button's own width, in design pixels */
  widthPx: z.number().min(80).max(1200).optional(),
  /** the button's own height, in design pixels */
  heightPx: z.number().min(32).max(400).default(76),
  /** corner radius, in design pixels (a pill uses half the height) */
  radiusPx: z.number().min(0).max(200).default(38),
  /** label font size, in design pixels */
  labelSizePx: z.number().min(10).max(96).default(30),
});
export type CtaLayer = z.infer<typeof ctaLayerSchema>;
