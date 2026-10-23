import { z } from "zod";
import { hexColorSchema } from "../common.js";
import { layerBaseSchema } from "./base.js";

export const diagramNodeSchema = z.strictObject({
  id: z.string().min(1).max(40),
  label: z.string().max(60),
  sublabel: z.string().max(80).optional(),
  xPct: z.number().min(5).max(95),
  yPct: z.number().min(5).max(95),
  accentColor: hexColorSchema.optional(),
});
export type DiagramNode = z.infer<typeof diagramNodeSchema>;

export const diagramEdgeSchema = z.strictObject({
  from: z.string(),
  to: z.string(),
  label: z.string().max(40).optional(),
  animatedPulse: z.boolean().default(true),
});
export type DiagramEdge = z.infer<typeof diagramEdgeSchema>;

export const connectorDiagramLayerSchema = layerBaseSchema.extend({
  type: z.literal("connectorDiagram"),
  nodes: z.array(diagramNodeSchema).min(2).max(8),
  edges: z.array(diagramEdgeSchema).min(1).max(12),
});
export type ConnectorDiagramLayer = z.infer<typeof connectorDiagramLayerSchema>;
