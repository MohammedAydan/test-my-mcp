import { z } from "zod";
import { colorSchema, msSchema } from "../common.js";
import { layerBaseSchema } from "./base.js";

export const editorialRuleLayerSchema = layerBaseSchema.extend({
  type: z.literal("editorialRule"),
  orientation: z.enum(["horizontal", "vertical"]).default("horizontal"),
  lengthPct: z.number().min(5).max(100).default(60),
  thicknessPx: z.number().min(1).max(20).default(2),
  color: colorSchema.default("#d4af37"),
  fadeEnds: z.boolean().default(true),
  centerOrnament: z.enum(["none", "diamond", "dot"]).default("diamond"),
  ornamentSizePx: z.number().min(2).max(40).default(8),
  drawDurationMs: msSchema.default(1200),
});

export type EditorialRuleLayer = z.infer<typeof editorialRuleLayerSchema>;
