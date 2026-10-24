import { z } from "zod";
import { colorSchema, msSchema } from "../common.js";
import { layerBaseSchema } from "./base.js";

export const waypointSchema = z.strictObject({
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  label: z.string().max(80).optional(),
});
export type Waypoint = z.infer<typeof waypointSchema>;

export const routePinSchema = z.strictObject({
  label: z.string().max(80).optional(),
  color: colorSchema.default("#d4af37"),
  radiusPx: z.number().min(2).max(40).default(8),
  pulse: z.boolean().default(true),
});
export type RoutePin = z.infer<typeof routePinSchema>;

export const cartographicRouteLayerSchema = layerBaseSchema.extend({
  type: z.literal("cartographicRoute"),
  waypoints: z.array(waypointSchema).min(2).max(16),
  strokeColor: colorSchema.default("#d4af37"),
  strokeWidthPx: z.number().min(1).max(20).default(3.5),
  dashed: z.boolean().default(true),
  dashArray: z.string().default("8 6"),
  haloColor: colorSchema.default("#0a0a0c"),
  haloWidthPx: z.number().min(0).max(40).default(8),
  haloOpacity: z.number().min(0).max(1).default(0.75),
  curved: z.boolean().default(true),
  startPin: routePinSchema.optional(),
  endPin: routePinSchema.optional(),
  drawDurationMs: msSchema.default(1800),
});

export type CartographicRouteLayer = z.infer<typeof cartographicRouteLayerSchema>;
