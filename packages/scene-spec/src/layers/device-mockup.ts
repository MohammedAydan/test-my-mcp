import { z } from "zod";
import { hexColorSchema } from "../common.js";
import { layerBaseSchema } from "./base.js";

export const DEVICE_TYPES = ["browser", "macbook", "iphone", "terminal"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const DEVICE_THEMES = ["dark", "light"] as const;
export type DeviceTheme = (typeof DEVICE_THEMES)[number];

export const DEVICE_CONTENT_VARIANTS = ["dashboard", "code", "metrics", "analytics", "blank"] as const;
export type DeviceContentVariant = (typeof DEVICE_CONTENT_VARIANTS)[number];

export const deviceMockupLayerSchema = layerBaseSchema.extend({
  type: z.literal("deviceMockup"),
  deviceType: z.enum(DEVICE_TYPES).default("browser"),
  titleOrUrl: z.string().max(160).default("app.motionforge.ai"),
  theme: z.enum(DEVICE_THEMES).default("dark"),
  contentVariant: z.enum(DEVICE_CONTENT_VARIANTS).default("dashboard"),
  headline: z.string().max(120).optional(),
  accentColor: hexColorSchema.optional(),
  tiltDeg: z
    .strictObject({
      rotateX: z.number().min(-35).max(35).default(0),
      rotateY: z.number().min(-35).max(35).default(0),
    })
    .optional(),
});

export type DeviceMockupLayer = z.infer<typeof deviceMockupLayerSchema>;
