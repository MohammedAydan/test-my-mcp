import {
  ASSET_KINDS,
  CAMERA_MOVES,
  CANVAS_SHAPES,
  CANVAS_SCALES,
  EASINGS,
  EMPHASIS_PRESETS,
  ENTRANCE_PRESETS,
  EXIT_PRESETS,
  FONT_ROLES,
  LAYER_TYPES,
  LOGO_MASKS,
  SFX_NAMES,
  TRANSITION_KINDS,
} from "@motionforge/scene-spec";

/**
 * The single source of truth for "what is possible", generated from the
 * scene-spec registries — this is what `get_motion_capabilities` returns, so
 * the LLM can never hallucinate an unsupported feature.
 */
export function capabilities(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    layerTypes: LAYER_TYPES,
    backgroundVariants: ["solid", "meshGradient", "particles", "media"],
    cardVariants: ["glassCard", "callout", "progressBar", "counter"],
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
    notes: {
      rtl: 'set direction:"rtl" on kineticText; Arabic char-stagger degrades to word (shaping)',
      sfx: "cues fire relative to layer `at` (layer.sfx[].offsetMs) or absolute (audio.cues[].at)",
      timing: "all times are milliseconds; canvas positions are percent of canvas; sizes are design px",
    },
  };
}
