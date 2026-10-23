import { z } from "zod";
import { hexColorSchema } from "../common.js";
import { layerBaseSchema } from "./base.js";

export const BENTO_COLUMNS = [2, 3] as const;
export type BentoColumns = (typeof BENTO_COLUMNS)[number];

export const bentoCellSchema = z.strictObject({
  title: z.string().max(80),
  subtitle: z.string().max(140).optional(),
  metricValue: z.string().max(40).optional(),
  badge: z.string().max(32).optional(),
  spanCols: z.number().int().min(1).max(3).default(1),
  accentColor: hexColorSchema.optional(),
});
export type BentoCell = z.infer<typeof bentoCellSchema>;

export const bentoGridLayerSchema = layerBaseSchema.extend({
  type: z.literal("bentoGrid"),
  columns: z.union([z.literal(2), z.literal(3)]).default(3),
  cells: z.array(bentoCellSchema).min(2).max(6),
  staggerMs: z.number().min(0).max(600).default(110),
});
export type BentoGridLayer = z.infer<typeof bentoGridLayerSchema>;
