import { z } from "zod";
import {
  colorSchema,
  msSchema,
  offsetSchema,
  unitSchema,
  type Paint,
  paintSchema,
} from "../common.js";
import { FONT_ROLES } from "../assets.js";
import { layerBaseSchema } from "./base.js";
import type { Shadow } from "./image-logo.js";

const chipSchema = z.strictObject({
  color: colorSchema,
  opacity: unitSchema.default(0.14),
  radiusPx: z.number().min(0).max(200).default(18),
});

export const kineticTextLayerSchema = layerBaseSchema.extend({
  type: z.literal("kineticText"),
  text: z.string().min(1).max(600),
  /** Arabic/Hebrew etc. set "rtl"; inline numerals stay LTR automatically */
  direction: z.enum(["ltr", "rtl"]).default("ltr"),
  role: z.enum(FONT_ROLES).default("headline"),
  /** optional explicit Google Fonts family; defaults resolve from the role map */
  googleFamily: z.string().max(120).optional(),
  fontWeight: z.number().int().min(100).max(900).default(800),
  sizePx: z.number().min(8).max(600),
  lineHeight: z.number().min(0.7).max(2.5).default(1.15),
  letterSpacingPx: z.number().min(-10).max(60).default(0),
  align: z.enum(["left", "center", "right"]).default("center"),
  /** center anchor of the text block, percent of canvas (defaults to center) */
  position: offsetSchema.default({ xPct: 50, yPct: 50 }),
  box: z
    .strictObject({
      maxWidthPct: z.number().min(10).max(100).default(70),
      paddingPx: z.number().min(0).max(200).default(0),
      chip: chipSchema.optional(),
    })
    .optional(),
  fill: paintSchema.default("#ffffff"),
  stroke: z
    .strictObject({ color: colorSchema, widthPx: z.number().min(0.5).max(20) })
    .optional(),
  shadow: z
    .strictObject({
      color: colorSchema.default("#000000"),
      opacity: unitSchema.default(0.45),
      blurPx: z.number().min(0).max(120).default(24),
      offsetYpx: z.number().min(-200).max(200).default(10),
    })
    .optional(),
  /** granularity of the staggered entrance/emphasis animation */
  animateBy: z.enum(["word", "char", "line"]).default("word"),
  /** marker-style highlight box behind the text, wiped in with the stagger */
  highlight: z
    .strictObject({
      color: colorSchema,
      radiusPx: z.number().min(0).max(120).default(12),
      paddingPx: z.number().min(0).max(120).default(8),
    })
    .optional(),
});
export type KineticTextLayer = z.infer<typeof kineticTextLayerSchema>;
export type { Paint };
