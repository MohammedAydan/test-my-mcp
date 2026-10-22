import { z } from "zod";
import { colorSchema, idSchema, offsetSchema, unitSchema } from "../common.js";
import { layerBaseSchema } from "./base.js";

/**
 * The chart shapes a `chart` layer can draw.
 *
 * A CLOSED set, so the runtime's renderer is a switch with no fallback branch
 * and the field guide can advertise the exact vocabulary.
 */
export const CHART_TYPES = ["bar", "line", "donut"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/**
 * One datum of a chart.
 *
 * `value` is unit-free on purpose: a bar chart plots percentages, a line
 * chart plots units. The renderer scales to the largest value it is given, so
 * the author never has to normalise anything.
 */
export const chartDatumSchema = z.strictObject({
  label: z.string().max(80),
  value: z.number().finite(),
  /** overrides the layer's `accentColor` for this datum only */
  color: colorSchema.optional(),
});
export type ChartDatum = z.infer<typeof chartDatumSchema>;

/**
 * A DATA VISUALISATION layer.
 *
 * WHY IT EXISTS: a keynote deck needs a chart, and before this kind the only
 * way to express one was a `card` with a body of text — which cannot show a
 * trend, a share, or a comparison. This kind draws real geometry (SVG bars,
 * an SVG polyline, an SVG arc) so the numbers are readable at a glance.
 *
 * The renderer is pure SVG: crisp at any rasterisation density, deterministic
 * (no layout measurement, no wall-clock), and free of the `chart` npm
 * dependency the rest of the engine does not have.
 */
export const chartLayerSchema = layerBaseSchema.extend({
  type: z.literal("chart"),
  /** centre anchor of the chart block, percent of canvas */
  position: offsetSchema,
  /** which shape to draw */
  chartType: z.enum(CHART_TYPES).default("bar"),
  /** optional heading drawn above the plot */
  title: z.string().max(160).optional(),
  /** the plotted values — 2..12 points */
  data: z.array(chartDatumSchema).min(2).max(12),
  /** the base colour of the plot; per-datum `color` wins */
  accentColor: colorSchema.default("#38bdf8"),
  /** draw the numeric value above each bar / point */
  showValues: z.boolean().default(false),
  /** opacity of the grid lines behind the plot (0 hides them) */
  gridOpacity: unitSchema.default(0.16),
  /** label colour */
  labelColor: colorSchema.default("#cbd5e1"),
  /** the plot's own width, in design pixels */
  widthPx: z.number().min(120).max(2000).default(760),
  /** the plot's own height, in design pixels */
  heightPx: z.number().min(80).max(1200).default(420),
  /** font size of the axis labels and values, in design pixels */
  labelSizePx: z.number().min(8).max(72).default(18),
});
export type ChartLayer = z.infer<typeof chartLayerSchema>;
