import {
  ASSET_KINDS,
  BACKGROUND_VARIANTS,
  CAMERA_MOVES,
  CANVAS_SHAPES,
  CANVAS_SCALES,
  CARD_VARIANTS,
  EASINGS,
  EMPHASIS_PRESETS,
  ENTRANCE_PRESETS,
  EXIT_PRESETS,
  FONT_ROLES,
  FOREGROUND_FX_KINDS,
  LAYER_TYPES,
  LOGO_MASKS,
  SFX_NAMES,
  TRANSITION_KINDS,
  authoringDigest,
} from "@motionforge/scene-spec";

/**
 * The single source of truth for "what is possible", generated from the
 * scene-spec registries and the authoring digest derived from the Zod schemas —
 * this is what `get_motion_capabilities` returns, so the LLM can never
 * hallucinate an unsupported feature.
 *
 * STRUCTURE MATTERS, not just vocabulary: without `layerFieldGuide` /
 * `minimalValidScene` an LLM knows every legal name but still guesses wrong
 * about shapes (`variant: "meshGradient"` instead of an object, `preset:` instead
 * of `entrance: {name}`), and every guess is a 400. Those payloads are therefore
 * not optional decoration — they are the authoring contract.
 */
export function capabilities(): Record<string, unknown> {
  return {
    ...authoringDigest(),
    // flat aliases, kept for callers written against the original shape
    layerTypes: LAYER_TYPES,
    backgroundVariants: BACKGROUND_VARIANTS,
    cardVariants: CARD_VARIANTS,
    foregroundFxKinds: FOREGROUND_FX_KINDS,
    presets: {
      entrance: ENTRANCE_PRESETS,
      emphasis: EMPHASIS_PRESETS,
      exit: EXIT_PRESETS,
    },
    easings: EASINGS,
    cameraMoves: CAMERA_MOVES,
    canvas: { shapes: CANVAS_SHAPES, scales: CANVAS_SCALES },
    sfxBank: SFX_NAMES,
    transitions: TRANSITION_KINDS,
    textRoles: FONT_ROLES,
    logoMasks: LOGO_MASKS,
    assetKinds: ASSET_KINDS,
  };
}