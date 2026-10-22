import { z } from "zod";
import { colorSchema } from "../common.js";
import { layerBaseSchema } from "./base.js";

/**
 * The motion patterns a `particleField` can follow.
 *
 * A CLOSED set, so the runtime's generator is a switch with no fallback.
 */
export const PARTICLE_PATTERNS = ["float", "grid", "constellation", "sparkle"] as const;
export type ParticlePattern = (typeof PARTICLE_PATTERNS)[number];

/**
 * A FIELD OF MOTION PARTICLES — a full-bleed decorative layer.
 *
 * WHY IT EXISTS: the `background.particles` variant is a hard-coded upward
 * drift and cannot be composed with anything else. This kind is a first-class
 * layer: it carries its own timing, its own motion presets, its own position
 * and its own filters, and it can sit in the middle of the stack.
 *
 * DETERMINISM IS THE POINT: every particle's position is a pure function of
 * `(timeMs, seed)`. Nothing reads the wall clock, nothing depends on the
 * order the DOM was built in, and a headless frame seek to t=4200 ms produces
 * the EXACT same pixels on every machine, every run.
 */
export const particleFieldLayerSchema = layerBaseSchema.extend({
  type: z.literal("particleField"),
  /** how many particles to draw (1..400) */
  count: z.number().int().min(1).max(400).default(80),
  /** the motion pattern */
  pattern: z.enum(PARTICLE_PATTERNS).default("float"),
  /** particle colour */
  color: colorSchema.default("#7dd3fc"),
  /** a second colour the particles interpolate towards */
  color2: colorSchema.optional(),
  /** movement speed multiplier (0.1..4) */
  speed: z.number().min(0.1).max(4).default(1),
  /**
   * Particle radius, in design pixels.
   *
   * NOTE: this field SHADOWS the universal `size` bag (the layout size in
   * canvas percent) that every other layer kind carries. A `particleField` is
   * FULL-BLEED — it has no layout box to size — so the shadowing costs
   * nothing, and the field keeps the plain name the authoring contract uses.
   * The `sizePx` spelling is accepted as an ALIAS (see the sanitizer).
   */
  size: z.number().min(0.5).max(40).default(3),
  sizePx: z.number().min(0.5).max(40).optional(),
  /** the seed of the deterministic generator — same seed, same field */
  seed: z.number().int().min(0).max(2_147_483_647).default(20260101),
  /** per-particle opacity ceiling (0..1) */
  opacity: z.number().min(0).max(1).default(0.75),
});
export type ParticleFieldLayer = z.infer<typeof particleFieldLayerSchema>;
