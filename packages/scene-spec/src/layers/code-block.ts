import { z } from "zod";
import { colorSchema, offsetSchema } from "../common.js";
import { layerBaseSchema } from "./base.js";

/**
 * The colour themes a `codeBlock` can paint itself in.
 *
 * A CLOSED set: the runtime maps every value onto a real palette, and the
 * field guide can advertise the exact vocabulary.
 */
export const CODE_BLOCK_THEMES = ["dark", "midnight", "matrix"] as const;
export type CodeBlockTheme = (typeof CODE_BLOCK_THEMES)[number];

/**
 * A SYNTAX-HIGHLIGHTED SOURCE SNIPPET layer.
 *
 * WHY IT EXISTS: a developer keynote needs real code on screen, not a
 * screenshot of code. Before this kind the only way to show a snippet was a
 * `card` with a body of text — which is monospaced-at-best and has no
 * highlighting, no window chrome and no line numbers.
 *
 * The highlighter is a tiny, dependency-free TOKENISER: it knows the
 * punctuation and a handful of keywords for each language, which is enough to
 * read a snippet at video speed and costs nothing at render time (it is a
 * pure function of the source string).
 */
export const codeBlockLayerSchema = layerBaseSchema.extend({
  type: z.literal("codeBlock"),
  /** centre anchor of the snippet block, percent of canvas */
  position: offsetSchema,
  /** the source language, e.g. "typescript", "python", "bash" */
  language: z.string().min(1).max(40).default("typescript"),
  /** the source itself */
  code: z.string().max(8000),
  /** optional title in the window chrome */
  title: z.string().max(160).optional(),
  /** colour theme */
  theme: z.enum(CODE_BLOCK_THEMES).default("dark"),
  /** 1-indexed line numbers to emphasise */
  highlightLines: z.array(z.number().int().min(1).max(400)).max(80).optional(),
  /**
   * Font size of the code, in design pixels.
   *
   * The `*Px` spelling is accepted as an ALIAS (see the sanitizer): the
   * repository convention is that every size carries a unit suffix, and a
   * scene written by hand should not fail validation over the spelling.
   * `fontSize` is canonical; when both are present `fontSize` wins.
   */
  fontSize: z.number().min(8).max(96).default(22),
  fontSizePx: z.number().min(8).max(96).optional(),
  /** the block's own width, in design pixels */
  widthPx: z.number().min(160).max(2400).default(880),
  /** show the window chrome (the title bar with the traffic lights) */
  showChrome: z.boolean().default(true),
  /** show the 1-indexed line numbers in the gutter */
  showLineNumbers: z.boolean().default(true),
});
export type CodeBlockLayer = z.infer<typeof codeBlockLayerSchema>;
