import { z } from "zod";

/** Every time value in a SceneSpec is milliseconds. */
export const msSchema = z.number().finite().min(0);

/** Percent of canvas (or of a parent box). Positions may slightly overshoot. */
export const pctSchema = z.number().finite().min(-200).max(200);

/** 0..1 opacity-style scalar. */
export const unitSchema = z.number().min(0).max(1);

/** Identifiers for layers, assets, cues. URL/CLI safe. */
export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "must be alphanumeric with - or _");

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_COLOR = /^rgba?\(\s*[-\d.]+%?(\s*,\s*[-\d.]+%?){2,3}\s*\)$/i;
const HSL_COLOR = /^hsla?\(\s*[-\d.]+(?:deg)?(\s*,\s*[-\d.]+%?){2,3}\s*\)$/i;

export const colorSchema = z
  .string()
  .max(64)
  .refine((v) => HEX_COLOR.test(v) || RGB_COLOR.test(v) || HSL_COLOR.test(v) || v === "transparent", {
    message: "must be a CSS color (hex, rgb()/rgba(), hsl()/hsla(), or 'transparent')",
  });

export const gradientStopSchema = z.strictObject({
  color: colorSchema,
  /** stop position 0..100 along the gradient line */
  at: z.number().min(0).max(100),
  opacity: unitSchema.optional(),
});

export const gradientSchema = z.strictObject({
  type: z.literal("linear"),
  angleDeg: z.number().min(0).max(360).default(90),
  stops: z.array(gradientStopSchema).min(2).max(8),
});

/** Solid CSS color or a linear gradient definition. */
export const paintSchema = z.union([colorSchema, gradientSchema]);
export type Paint = z.infer<typeof paintSchema>;

/** { xPct, yPct } anchor/offset in percent of canvas. */
export const offsetSchema = z.strictObject({
  xPct: pctSchema,
  yPct: pctSchema,
});
export type Offset = z.infer<typeof offsetSchema>;

/**
 * Easing registry — a curated, professional subset of GSAP eases, plus an optional
 * cubic-bezier escape hatch. Kept as a closed set so the capabilities tool can
 * enumerate exactly what the runtime supports.
 */
export const EASINGS = [
  "linear",
  "power1.in", "power1.out", "power1.inOut",
  "power2.in", "power2.out", "power2.inOut",
  "power3.in", "power3.out", "power3.inOut",
  "power4.in", "power4.out", "power4.inOut",
  "expo.in", "expo.out", "expo.inOut",
  "circ.in", "circ.out", "circ.inOut",
  "sine.in", "sine.out", "sine.inOut",
  "back.in(1.7)", "back.out(1.7)", "back.out(2.5)", "back.out(4)", "back.inOut(1.7)",
  "elastic.in(1,0.75)", "elastic.out(1,0.5)", "elastic.out(1,0.75)",
  "bounce.in", "bounce.out",
  "steps(12)",
] as const;

export const easingNameSchema = z.enum(EASINGS);

export const bezierSchema = z.strictObject({
  bezier: z.tuple([z.number().min(0).max(1), z.number(), z.number().min(0).max(1), z.number()]),
});

export const easeSchema = z.union([easingNameSchema, bezierSchema]);
export type Ease = z.infer<typeof easeSchema>;
