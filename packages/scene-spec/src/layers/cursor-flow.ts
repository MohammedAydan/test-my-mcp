import { z } from "zod";
import { hexColorSchema } from "../common.js";
import { layerBaseSchema } from "./base.js";

export const CURSOR_STYLES = ["macos", "pointer", "collaborator"] as const;
export type CursorStyle = (typeof CURSOR_STYLES)[number];

export const CURSOR_ACTIONS = ["move", "click", "hover"] as const;
export type CursorAction = (typeof CURSOR_ACTIONS)[number];

export const cursorWaypointSchema = z.strictObject({
  atMs: z.number().min(0),
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  action: z.enum(CURSOR_ACTIONS).default("move"),
  label: z.string().max(60).optional(),
});
export type CursorWaypoint = z.infer<typeof cursorWaypointSchema>;

export const cursorFlowLayerSchema = layerBaseSchema.extend({
  type: z.literal("cursorFlow"),
  waypoints: z.array(cursorWaypointSchema).min(1).max(20),
  cursorStyle: z.enum(CURSOR_STYLES).default("macos"),
  accentColor: hexColorSchema.default("#38bdf8"),
  cursorScale: z.number().min(0.5).max(3).default(1.2),
});

export type CursorFlowLayer = z.infer<typeof cursorFlowLayerSchema>;
