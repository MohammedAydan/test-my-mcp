import { z } from "zod";
import { hexColorSchema } from "../common.js";
import { layerBaseSchema } from "./base.js";

export const metricTickerLayerSchema = layerBaseSchema.extend({
  type: z.literal("metricTicker"),
  label: z.string().max(80),
  fromValue: z.number().finite().default(0),
  toValue: z.number().finite(),
  prefix: z.string().max(12).default(""),
  suffix: z.string().max(16).default(""),
  decimals: z.number().int().min(0).max(4).default(0),
  countDurationMs: z.number().min(200).max(10_000).default(1600),
  deltaBadge: z.string().max(24).optional(),
  accentColor: hexColorSchema.optional(),
});

export type MetricTickerLayer = z.infer<typeof metricTickerLayerSchema>;
