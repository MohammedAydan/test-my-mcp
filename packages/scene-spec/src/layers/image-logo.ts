import { z } from "zod";
import { colorSchema, idSchema, msSchema, offsetSchema, unitSchema } from "../common.js";
import { layerBaseSchema } from "./base.js";

export const LOGO_MASKS = ["rect", "circle", "squircle", "hexagon", "blob"] as const;
export type LogoMask = (typeof LOGO_MASKS)[number];

const shadowSchema = z.strictObject({
  color: colorSchema.default("#000000"),
  opacity: unitSchema.default(0.45),
  blurPx: z.number().min(0).max(120).default(24),
  offsetYpx: z.number().min(-200).max(200).default(10),
});
export type Shadow = z.infer<typeof shadowSchema>;

export const imageLogoLayerSchema = layerBaseSchema.extend({
  type: z.literal("imageLogo"),
  assetId: idSchema,
  widthPx: z.number().min(16).max(4000),
  heightPx: z.number().min(16).max(4000).optional(),
  /** center anchor of the logo, percent of canvas */
  position: offsetSchema,
  /** SVG clip-path shape applied to the image */
  mask: z.enum(LOGO_MASKS).default("rect"),
  cornerRadiusPx: z.number().min(0).max(400).optional(),
  shadow: shadowSchema.optional(),
  ring: z
    .strictObject({
      widthPx: z.number().min(1).max(40),
      color: colorSchema,
      opacity: unitSchema.optional(),
    })
    .optional(),
  /** frosted-glass chip behind the logo */
  glass: z
    .strictObject({
      blurPx: z.number().min(0).max(60).default(18),
      tintColor: colorSchema.default("#ffffff"),
      tintOpacity: unitSchema.default(0.08),
    })
    .optional(),
  glow: z
    .strictObject({
      color: colorSchema,
      strength: z.number().min(0).max(2).default(1),
    })
    .optional(),
  /** diagonal specular band that sweeps across the logo at absolute time `at` */
  lightSweep: z
    .strictObject({
      at: msSchema,
      durationMs: msSchema.default(900),
      angleDeg: z.number().min(-180).max(180).default(25),
      color: colorSchema.default("#ffffff"),
      widthFactor: z.number().min(0.1).max(1).default(0.35),
    })
    .optional(),
});
export type ImageLogoLayer = z.infer<typeof imageLogoLayerSchema>;
