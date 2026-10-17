import { z } from "zod";
import { easeSchema, idSchema, msSchema, pctSchema } from "./common.js";

/** High-level camera actions; the runtime expands these into rig tweens. */
export const CAMERA_MOVES = [
  "slowPushIn",
  "whipPanLeft",
  "whipPanRight",
  "shakeImpact",
  "focusTarget",
] as const;
export type CameraMoveName = (typeof CAMERA_MOVES)[number];

/**
 * Canonical camera keyframe. Fields are optional and inherit from the previous
 * keyframe (first keyframe inherits the neutral rig: scale 1, centered, no rotation).
 * Keyframes must be sorted by `at`.
 */
export const cameraKeyframeSchema = z.strictObject({
  at: msSchema,
  ease: easeSchema.optional(),
  scale: z.number().min(0.1).max(6).optional(),
  xPct: pctSchema.optional(),
  yPct: pctSchema.optional(),
  roll: z.number().min(-360).max(360).optional(),
  pitch: z.number().min(-89).max(89).optional(),
  yaw: z.number().min(-89).max(89).optional(),
});
export type CameraKeyframe = z.infer<typeof cameraKeyframeSchema>;

export const cameraMoveSchema = z.strictObject({
  move: z.enum(CAMERA_MOVES),
  at: msSchema,
  durationMs: msSchema.optional(),
  /** for `focusTarget`: layer id to zoom onto */
  targetLayerId: idSchema.optional(),
  strength: z.number().min(0.1).max(3).optional(),
});
export type CameraMove = z.infer<typeof cameraMoveSchema>;

export const cameraSchema = z
  .strictObject({
    /** perspective distance (px) for the 3D rig (pitch/yaw) */
    perspective: z.number().min(200).max(4000).default(1200),
    /** subtle handheld drift to avoid static-frame stiffness */
    drift: z
      .strictObject({
        amplitudePct: z.number().min(0).max(3),
        periodMs: msSchema,
        seed: z.number().int().optional(),
      })
      .optional(),
    keyframes: z.array(cameraKeyframeSchema).max(64).default([]),
    moves: z.array(cameraMoveSchema).max(32).default([]),
  })
  .superRefine((cam, ctx) => {
    for (let i = 1; i < cam.keyframes.length; i++) {
      const prev = cam.keyframes[i - 1];
      const curr = cam.keyframes[i];
      if (prev && curr && curr.at < prev.at) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["keyframes", i, "at"],
          message: "camera keyframes must be sorted by `at`",
        });
      }
    }
  });
export type Camera = z.infer<typeof cameraSchema>;
