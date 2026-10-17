import { z } from "zod";
import { colorSchema, idSchema, msSchema, offsetSchema, pctSchema, unitSchema } from "../common.js";
import { layerBaseSchema } from "./base.js";

const blobSchema = z.strictObject({
  color: colorSchema,
  xPct: pctSchema,
  yPct: pctSchema,
  radiusPct: z.number().min(5).max(200),
  /** 0..2 — how much the blob wanders over the scene */
  drift: z.number().min(0).max(2).default(0.3),
});

const kenBurnsSchema = z.strictObject({
  fromScale: z.number().min(1).max(2),
  toScale: z.number().min(1).max(2.5),
  panFrom: offsetSchema.optional(),
  panTo: offsetSchema.optional(),
});

export const backgroundLayerSchema = layerBaseSchema.extend({
  type: z.literal("background"),
  variant: z.discriminatedUnion("variant", [
    z.strictObject({ variant: z.literal("solid"), color: colorSchema }),
    z.strictObject({
      variant: z.literal("meshGradient"),
      base: colorSchema.default("#05070d"),
      blobs: z.array(blobSchema).min(2).max(6),
    }),
    z.strictObject({
      variant: z.literal("particles"),
      count: z.number().int().min(40).max(600),
      color: colorSchema.default("#8ab4ff"),
      sizePx: z.number().min(1).max(12).default(2.5),
      speed: z.number().min(0.1).max(3).default(1),
      direction: z.enum(["up", "down", "radial", "sideways"]).default("up"),
    }),
    z.strictObject({
      variant: z.literal("media"),
      assetId: idSchema,
      blurPx: z.number().min(0).max(60).default(0),
      dimOpacity: unitSchema.default(0),
      kenBurns: kenBurnsSchema.optional(),
    }),
  ]),
});
export type BackgroundLayer = z.infer<typeof backgroundLayerSchema>;
