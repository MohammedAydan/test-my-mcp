import { z } from "zod";
import { idSchema } from "./common.js";

export const ASSET_KINDS = ["image", "video", "audio", "lottie"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

const ASSET_SRC_PATTERN = /^(https?:\/\/|data:|vault:)\S+$/;

/**
 * An external resource. `src` accepts:
 *  - `https://…` / `http://…`  — remote URL
 *  - `data:…`                  — inline data URI
 *  - `vault:filename`          — a file previously uploaded to the engine's asset vault
 */
export const assetSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(ASSET_KINDS),
  src: z.string().min(1).max(2048).refine((v) => ASSET_SRC_PATTERN.test(v), {
    message: "src must start with https://, http://, data: or vault:",
  }),
  mime: z.string().max(120).optional(),
  name: z.string().max(120).optional(),
});
export type Asset = z.infer<typeof assetSchema>;

/** Typography roles — text layers pick one, fonts[] declares one entry per role. */
export const FONT_ROLES = ["hero", "headline", "body", "accent", "metric"] as const;
export type FontRole = (typeof FONT_ROLES)[number];

export const fontRefSchema = z.strictObject({
  role: z.enum(FONT_ROLES),
  family: z.string().min(1).max(120),
  provider: z.enum(["google", "system"]).default("google"),
  weights: z
    .array(z.number().int().min(100).max(900))
    .min(1)
    .max(6)
    .default([400, 800]),
});
export type FontRef = z.infer<typeof fontRefSchema>;
