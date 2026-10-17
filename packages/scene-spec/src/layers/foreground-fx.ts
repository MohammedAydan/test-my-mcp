import { z } from "zod";
import { colorSchema, unitSchema } from "../common.js";
import { layerBaseSchema } from "./base.js";

/** Discriminant values of each effect's `kind` union (authoring-facing registry). */
export const FOREGROUND_FX_KINDS = ["vignette", "filmGrain", "colorGrade"] as const;

/** Full-frame overlays applied above all content layers. */
export const foregroundFxLayerSchema = layerBaseSchema.extend({
  type: z.literal("foregroundFX"),
  effects: z
    .array(
      z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("vignette"),
          strength: unitSchema.default(0.5),
          color: colorSchema.default("#000000"),
        }),
        z.strictObject({
          kind: z.literal("filmGrain"),
          opacity: unitSchema.default(0.06),
          sizePx: z.number().min(1).max(6).default(2),
        }),
        z.strictObject({
          kind: z.literal("colorGrade"),
          warmth: z.number().min(-1).max(1).default(0),
          contrast: z.number().min(-1).max(1).default(0),
          saturation: z.number().min(-1).max(1).default(0),
          tint: z
            .strictObject({
              color: colorSchema,
              opacity: unitSchema.default(0.15),
            })
            .optional(),
        }),
      ])
    )
    .min(1)
    .max(6),
});
export type ForegroundFxLayer = z.infer<typeof foregroundFxLayerSchema>;
