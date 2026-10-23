import { z } from "zod";
import { hexColorSchema } from "../common.js";
import { layerBaseSchema } from "./base.js";

export const comparisonSplitLayerSchema = layerBaseSchema.extend({
  type: z.literal("comparisonSplit"),
  leftTitle: z.string().max(60),
  leftItems: z.array(z.string().max(100)).min(1).max(6),
  rightTitle: z.string().max(60),
  rightItems: z.array(z.string().max(100)).min(1).max(6),
  leftAccent: hexColorSchema.default("#ef4444"),
  rightAccent: hexColorSchema.default("#10b981"),
  vsBadge: z.string().max(12).default("VS"),
});

export type ComparisonSplitLayer = z.infer<typeof comparisonSplitLayerSchema>;
