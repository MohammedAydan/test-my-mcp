import { z } from "zod";
import { colorSchema, idSchema, offsetSchema, unitSchema } from "../common.js";
import { paintSchema } from "../common.js";
import { FONT_ROLES } from "../assets.js";
import { layerBaseSchema } from "./base.js";

const glassSchema = z.strictObject({
  blurPx: z.number().min(0).max(80).default(22),
  tintColor: colorSchema.default("#0b0f1a"),
  tintOpacity: unitSchema.default(0.35),
});
export type CardGlass = z.infer<typeof glassSchema>;

/** Shared text fields for card variants that can have a title/body. */
const titleSchema = z.string().max(200).optional();
const bodySchema = z.string().max(800).optional();

export const cardLayerSchema = layerBaseSchema.extend({
  type: z.literal("card"),
  /** center anchor of the card, percent of canvas */
  position: offsetSchema,
  variant: z.discriminatedUnion("variant", [
    z.strictObject({
      variant: z.literal("glassCard"),
      title: titleSchema,
      body: bodySchema,
      iconAssetId: idSchema.optional(),
      widthPx: z.number().min(80).max(2000).optional(),
      paddingPx: z.number().min(8).max(200).default(36),
      radiusPx: z.number().min(0).max(200).default(28),
      glass: glassSchema.default({ blurPx: 22, tintColor: "#0b0f1a", tintOpacity: 0.35 }),
      borderOpacity: unitSchema.default(0.25),
    }),
    z.strictObject({
      variant: z.literal("callout"),
      accentSide: z.enum(["left", "right"]).default("left"),
      accentColor: colorSchema,
      title: titleSchema,
      body: bodySchema,
      widthPx: z.number().min(80).max(2000).optional(),
      paddingPx: z.number().min(8).max(200).default(32),
      radiusPx: z.number().min(0).max(200).default(24),
      glass: glassSchema.default({ blurPx: 22, tintColor: "#0b0f1a", tintOpacity: 0.35 }),
    }),
    z.strictObject({
      variant: z.literal("progressBar"),
      label: titleSchema,
      /** animated to this value (percent 0..100) */
      value: z.number().min(0).max(100),
      trackColor: colorSchema.default("rgba(255,255,255,0.12)"),
      fill: paintSchema,
      heightPx: z.number().min(4).max(120).default(18),
      radiusPx: z.number().min(0).max(200).default(120),
      showPercentage: z.boolean().default(false),
      widthPx: z.number().min(80).max(2000).optional(),
    }),
    z.strictObject({
      variant: z.literal("counter"),
      from: z.number().finite(),
      to: z.number().finite(),
      decimals: z.number().int().min(0).max(4).default(0),
      prefix: z.string().max(12).default(""),
      suffix: z.string().max(12).default(""),
      /** BCP-47 locale used for number formatting, e.g. "ar-EG", "en-US" */
      locale: z.string().max(12).optional(),
      role: z.enum(FONT_ROLES).default("metric"),
      sizePx: z.number().min(12).max(600).default(120),
    }),
  ]),
});
export type CardLayer = z.infer<typeof cardLayerSchema>;
