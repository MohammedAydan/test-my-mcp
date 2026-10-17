import { z } from "zod";
import { idSchema, offsetSchema } from "../common.js";
import { layerBaseSchema } from "./base.js";

/** Lottie JSON animation, scrubbed by timeline progress (deterministic rendering). */
export const lottieLayerSchema = layerBaseSchema.extend({
  type: z.literal("lottie"),
  assetId: idSchema,
  widthPx: z.number().min(16).max(4000).optional(),
  position: offsetSchema,
});
export type LottieLayer = z.infer<typeof lottieLayerSchema>;
