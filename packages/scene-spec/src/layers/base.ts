import { z } from "zod";
import { idSchema, msSchema } from "../common.js";
import { presetRefSchema } from "../motion.js";
import { sfxTriggerSchema } from "../audio.js";

/**
 * Fields shared by every layer. Timing: a layer exists from `at` for `duration`
 * ms (default: until the end of the scene). SFX triggers fire relative to `at`.
 */
export const layerBaseSchema = z.strictObject({
  id: idSchema,
  name: z.string().max(120).optional(),
  z: z.number().int().min(0).max(999).optional(),
  at: msSchema.default(0),
  duration: msSchema.optional(),
  entrance: presetRefSchema.optional(),
  emphasis: presetRefSchema.optional(),
  exit: presetRefSchema.optional(),
  sfx: z.array(sfxTriggerSchema).max(12).optional(),
});
export type LayerBase = z.infer<typeof layerBaseSchema>;
