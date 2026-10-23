import { z } from "zod";
import { idSchema, msSchema } from "./common.js";

/** The fixed SFX bank shipped with core-engine (real audio files, mixed at render). */
export const SFX_NAMES = [
  "whoosh",
  "pop",
  "click",
  "subImpact",
  "shimmer",
  "riser",
  "typingTick",
  "mouseClick",
  "notificationChime",
  "bassDrop",
  "glitchHit",
  "softSwoosh",
  "counterTick",
  "ambientPad",
] as const;
export type SfxName = (typeof SFX_NAMES)[number];

/**
 * Layer-level shorthand cue: fires relative to the layer's `at`.
 * Example: `{ "sfx": "whoosh", "offsetMs": 120 }`
 */
export const sfxTriggerSchema = z.strictObject({
  sfx: z.enum(SFX_NAMES),
  offsetMs: msSchema.default(0),
  gain: z.number().min(0).max(2).default(1),
  pan: z.number().min(-1).max(1).default(0),
});
export type SfxTrigger = z.infer<typeof sfxTriggerSchema>;

/** Scene-level absolute cue, exactly what the FFmpeg mixer schedules via adelay. */
export const audioCueSchema = z.strictObject({
  id: idSchema.optional(),
  at: msSchema,
  sfx: z.enum(SFX_NAMES),
  gain: z.number().min(0).max(2).default(1),
  pan: z.number().min(-1).max(1).default(0),
});
export type AudioCue = z.infer<typeof audioCueSchema>;

export const musicTrackSchema = z.strictObject({
  assetId: idSchema,
  gain: z.number().min(0).max(2).default(0.6),
  fadeInMs: msSchema.default(0),
  fadeOutMs: msSchema.default(0),
  /** loudness-normalize music so it sits under SFX cues */
  normalize: z.boolean().default(true),
});
export type MusicTrack = z.infer<typeof musicTrackSchema>;

export const audioSchema = z.strictObject({
  music: musicTrackSchema.optional(),
  cues: z.array(audioCueSchema).max(200).default([]),
});
export type Audio = z.infer<typeof audioSchema>;
