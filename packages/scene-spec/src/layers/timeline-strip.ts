import { z } from "zod";
import { colorSchema, msSchema } from "../common.js";
import { layerBaseSchema } from "./base.js";

export const timelineEventSchema = z.strictObject({
  date: z.string().min(1).max(40),
  title: z.string().min(1).max(80),
  description: z.string().max(160).optional(),
  active: z.boolean().default(false),
});
export type TimelineEvent = z.infer<typeof timelineEventSchema>;

export const timelineStripLayerSchema = layerBaseSchema.extend({
  type: z.literal("timelineStrip"),
  events: z.array(timelineEventSchema).min(2).max(8),
  lineColor: colorSchema.default("#d4af37"),
  markerColor: colorSchema.default("#ffffff"),
  activeMarkerColor: colorSchema.default("#d4af37"),
  textColor: colorSchema.default("#ffffff"),
  accentColor: colorSchema.default("#d4af37"),
  widthPct: z.number().min(20).max(100).default(85),
  staggerMs: msSchema.default(250),
  showDescriptions: z.boolean().default(true),
});

export type TimelineStripLayer = z.infer<typeof timelineStripLayerSchema>;
