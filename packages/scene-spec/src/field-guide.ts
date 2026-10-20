/**
 * Machine-readable authoring guidance, derived from the schemas in this package.
 *
 * WHY THIS FILE EXISTS: an LLM that only sees the registry lists (layer types,
 * preset names, SFX names) still guesses wrong about *structure* — e.g. it emits
 * `variant: "meshGradient"` as a bare string, or `preset: "springPop"` instead of
 * `entrance: { name: "springPop" }`. Those guesses are rejected by the strict
 * schemas, and the resulting issues used to be invisible to the caller.
 *
 * Everything here is a compile-time-typed `SceneSpecInput` / layer input, so the
 * examples cannot drift away from the schemas — `tests/field-guide.spec.ts`
 * parses every example through `parseScene()`.
 */
import { z } from "zod";

import { ASSET_KINDS, FONT_ROLES } from "./assets.js";
import { EASINGS } from "./common.js";
import { CAMERA_MOVES } from "./camera.js";
import { SFX_NAMES } from "./audio.js";
import { EMPHASIS_PRESETS, ENTRANCE_PRESETS, EXIT_PRESETS } from "./motion.js";
import { backgroundLayerSchema, BACKGROUND_VARIANTS } from "./layers/background.js";
import { CARD_VARIANTS, cardLayerSchema } from "./layers/card.js";
import { FOREGROUND_FX_KINDS, foregroundFxLayerSchema } from "./layers/foreground-fx.js";
import { imageLogoLayerSchema, LOGO_MASKS } from "./layers/image-logo.js";
import { kineticTextLayerSchema } from "./layers/kinetic-text.js";
import { lottieLayerSchema } from "./layers/lottie.js";
import {
  KEYFRAME_EASINGS,
  KEYFRAME_PROPERTIES,
  LAYER_FILTER_KEYS,
  layerBaseSchema,
} from "./layers/base.js";
import { CANVAS_SCALES, CANVAS_SHAPES, LAYER_TYPES, TRANSITION_KINDS, type LayerType } from "./scene.js";
import type { SceneSpecInput } from "./validate.js";

export type BackgroundLayerInput = z.input<typeof backgroundLayerSchema>;
export type ImageLogoLayerInput = z.input<typeof imageLogoLayerSchema>;
export type KineticTextLayerInput = z.input<typeof kineticTextLayerSchema>;
export type CardLayerInput = z.input<typeof cardLayerSchema>;
export type LottieLayerInput = z.input<typeof lottieLayerSchema>;
export type ForegroundFxLayerInput = z.input<typeof foregroundFxLayerSchema>;

export type AnyLayerInput =
  | BackgroundLayerInput
  | ImageLogoLayerInput
  | KineticTextLayerInput
  | CardLayerInput
  | LottieLayerInput
  | ForegroundFxLayerInput;

/** Keys every layer needs, plus the timing/motion knobs shared by all of them. */
export const COMMON_LAYER_REQUIRED = ["id", "type"] as const;

export const COMMON_LAYER_OPTIONAL = [
  "name (human label)",
  "z (stacking order, 0-999; default = array order)",
  "at (start time in ms, default 0)",
  "duration (visible window in ms, default: until scene end)",
  "trackIndex (0-indexed timeline track lane; non-overlapping clips sharing a trackIndex share a row)",
  "position ({ xPct, yPct } — center anchor in percent of the canvas; -300..300 so a layer can start off-screen)",
  "scale (uniform multiplier, 0.05-10) / scaleX / scaleY (non-uniform; scaleX/scaleY win over scale)",
  "size ({ widthPct?, heightPct? } — LAYOUT size in percent of the canvas)",
  "filters ({ blur?, brightness?, contrast?, saturate?, shadowBlur?, shadowColor?, cornerRadius? } — VISUAL filters on the painted content)",
  "keyframes ([{ id, timeMs, property, value, easing? }] — the unified animation surface; property is xPct | yPct | scale | rotation | opacity)",
  "entrance ({ name: <preset>, strength?, staggerMs?, durationMs?, ease?, delayMs? })",
  "emphasis ({ name: <preset>, ... })",
  "exit ({ name: <preset>, ... })",
  "sfx ([{ sfx: <bank name>, offsetMs?, gain?, pan? }] — fires relative to `at`)",
] as const;

export interface LayerFieldGuideEntry {
  /** keys that MUST be present (beyond the common id/type) */
  required: string[];
  /** keys worth knowing; all are optional or defaulted */
  optional: string[];
  /** minimal example that passes the real Zod schema */
  example: AnyLayerInput;
}

export const LAYER_FIELD_GUIDE: Record<LayerType, LayerFieldGuideEntry> = {
  background: {
    required: ["variant (OBJECT, discriminated by its own `variant` key)"],
    optional: [
      "variant=solid: { color }",
      "variant=meshGradient: { base?, blobs: [{ color, xPct, yPct, radiusPct, drift? }] } (2-6 blobs)",
      "variant=particles: { count, color?, sizePx?, speed?, direction? }",
      "variant=media: { assetId (must be declared in assets), blurPx?, dimOpacity?, kenBurns? }",
    ],
    example: {
      id: "bg",
      type: "background",
      variant: { variant: "solid", color: "#05070d" },
    },
  },
  imageLogo: {
    required: ["assetId (declared in assets)", "widthPx", "position { xPct, yPct }"],
    optional: [
      "heightPx",
      "mask: rect | circle | squircle | hexagon | blob",
      "cornerRadiusPx",
      "shadow { color?, opacity?, blurPx?, offsetYpx? }",
      "ring { widthPx, color, opacity? }",
      "glass { blurPx?, tintColor?, tintOpacity? }",
      "glow { color, strength? }",
      "lightSweep { at, durationMs?, angleDeg?, color?, widthFactor? }",
    ],
    example: {
      id: "logo",
      type: "imageLogo",
      at: 300,
      duration: 4000,
      assetId: "logo",
      widthPx: 200,
      position: { xPct: 50, yPct: 24 },
      mask: "squircle",
      ring: { widthPx: 4, color: "#7dd3fc" },
      entrance: { name: "springPop" },
      sfx: [{ sfx: "pop", offsetMs: 0 }],
    },
  },
  kineticText: {
    required: ["text", "sizePx"],
    optional: [
      "direction: ltr | rtl (use rtl for Arabic/Hebrew)",
      "role: hero | headline | body | accent | metric (pairs with fonts[])",
      "googleFamily",
      "fontWeight (100-900, default 800)",
      "lineHeight, letterSpacingPx, align: left | center | right",
      "position { xPct, yPct } (default canvas center)",
      "box { maxWidthPct, paddingPx?, chip? }",
      "fill: CSS color string OR { type: 'linear', angleDeg, stops: [{ color, at }] }",
      "stroke { color, widthPx }, shadow { ... }, highlight { color, radiusPx?, paddingPx? }",
      "animateBy: word | char | line (drives the staggered entrance)",
    ],
    example: {
      id: "headline",
      type: "kineticText",
      at: 800,
      text: "Motion, engineered.",
      sizePx: 88,
      direction: "ltr",
      role: "hero",
      position: { xPct: 50, yPct: 45 },
      fill: { type: "linear", angleDeg: 120, stops: [{ color: "#ffffff", at: 0 }, { color: "#a5f3fc", at: 100 }] },
      animateBy: "word",
      entrance: { name: "blurFadeIn", staggerMs: 120 },
    },
  },
  card: {
    required: ["position { xPct, yPct }", "variant (OBJECT, discriminated by its own `variant` key)"],
    optional: [
      "variant=glassCard: { title?, body?, iconAssetId?, widthPx?, paddingPx?, radiusPx?, glass?, borderOpacity? }",
      "variant=callout: { accentColor, accentSide?, title?, body?, ... }",
      "variant=progressBar: { value (0-100), fill (paint), label?, trackColor?, heightPx?, radiusPx?, showPercentage?, widthPx? }",
      "variant=counter: { from, to, decimals?, prefix?, suffix?, locale?, role?, sizePx? }",
    ],
    example: {
      id: "card",
      type: "card",
      at: 3000,
      position: { xPct: 50, yPct: 40 },
      variant: {
        variant: "glassCard",
        title: "Deterministic Pipeline",
        body: "Every frame seeked, captured and piped.",
      },
      entrance: { name: "3dFlipIn" },
      sfx: [{ sfx: "subImpact", offsetMs: 0 }],
    },
  },
  lottie: {
    required: ["assetId (kind 'lottie', declared in assets)", "position { xPct, yPct }"],
    optional: ["widthPx"],
    example: {
      id: "anim",
      type: "lottie",
      at: 500,
      assetId: "anim",
      widthPx: 420,
      position: { xPct: 50, yPct: 30 },
    },
  },
  foregroundFX: {
    required: ["effects (1-6 overlay effects)"],
    optional: [
      "{ kind: 'vignette', strength?, color? }",
      "{ kind: 'filmGrain', opacity?, sizePx? }",
      "{ kind: 'colorGrade', warmth?, contrast?, saturation?, tint? }",
    ],
    example: {
      id: "fgx",
      type: "foregroundFX",
      effects: [
        { kind: "vignette", strength: 0.5 },
        { kind: "filmGrain", opacity: 0.06 },
      ],
    },
  },
};

/**
 * The structural rules that registry lists cannot express — the exact class of
 * mistakes an LLM makes when authoring a scene from scratch.
 */
export const NESTED_SHAPE_NOTES: string[] = [
  'Every layer REQUIRES `id` (unique, [A-Za-z0-9_-]) and `type` (one of the layerTypes).',
  '`background.variant` is an OBJECT discriminated by its own `variant` key, not a string: {"variant":"solid","color":"#000"}. Same for `card.variant`: {"variant":"glassCard", ...}.',
  'Motion is objects, never a bare string: `entrance`, `emphasis` and `exit` take `{ "name": "<preset>" }` plus optional strength / staggerMs / durationMs / ease / delayMs. There is no `preset` field.',
  'Positions are OBJECTS of canvas percent: `"position": { "xPct": 50, "yPct": 45 }`. Sizes carry a unit suffix in the key: `sizePx`, `widthPx`, `heightPx`, `blurPx`, `radiusPx`, `paddingPx`.',
  'The VISUAL filter bag is `filters` (an object), NOT `effects`: `filters: { "blur": 6, "saturate": 120 }`. `effects` on a `foregroundFX` layer is a different thing entirely — an ARRAY of vignette / filmGrain / colorGrade overlays.',
  'A unified keyframe is `{ "id": "k1", "timeMs": 1200, "property": "xPct", "value": 40, "easing": "easeInOut" }` — `property` is one of xPct | yPct | scale | rotation | opacity, and `value` must be inside that property\'s range (xPct/yPct -300..300, scale 0.05..10, rotation -3600..3600, opacity 0..1).',
  'ALL times are milliseconds: `at`, `durationMs`, `delayMs`, `audio.cues[].at`, `camera.moves[].at`.',
  'Gradients are objects: `{ "type": "linear", "angleDeg": 90, "stops": [{ "color": "#fff", "at": 0 }, ...] }`; a plain string is a solid color.',
  'Assets must be declared in `scene.assets` ({id, kind, src}) before a layer can reference them by id. `src` starts with https://, data: or vault:.',
  'Fonts are declared per role in `scene.fonts` ({role, family, provider, weights}); a kineticText layer picks the role (and optionally googleFamily).',
  'Camera keyframes inherit unset fields from the previous keyframe and MUST be sorted by `at`. Camera moves use `{ "move": "<name>", "at": ms, ... }`.',
  'Camera framing: at `scale: s` the visible slice of the canvas is `100/s` percent wide, so `xPct`/`yPct` must stay inside `[50/s, 100 - 50/s]`. Outside that range the frame shows black void — the engine warns with `CAMERA_VIEWPORT_EXCEEDS_CANVAS` and the runtime clamps it automatically.',
  'Camera moves are TEMPORARY: each one ramps in, holds, and ramps back out. A `focusTarget` returns the camera to its previous pose; it never leaves the rig parked at the zoom.',
  'Effects are TEMPORARY: `pulseGlow`/`floatIdle` start at the baseline and return to it. `lightSweep` is a soft white overlay that can only ADD light — it never darkens the pixels beneath it.',
  'SFX come in two equivalent forms: `layer.sfx[]` (fires at `layer.at + offsetMs`) and `scene.audio.cues[]` (absolute `at`). Both use the same fixed bank names.',
  'Scene timing must fit: a layer may not start at/after durationMs, and `at + duration` must not exceed it. The same bound applies to transitions, cues and camera keyframes/moves.',
  'Unknown keys are REJECTED everywhere (strict schemas) — a typo like `preset` or `positionX` fails with an "Unrecognized key" issue naming the exact path.',
  'AT MOST ONE TRANSITION at a time. Two transitions whose `[at, at+durationMs)` windows overlap are rejected by the schema — at one cut, two overlays and two camera offsets read as "two broken transitions happening at once".',
  'A transition hides the stage only while its cover is at full extent, and never for more than ~120ms around its midpoint (`at + durationMs / 2`). Keep `durationMs` in the 350–550ms range; the engine warns with `TRANSITION_PEAK_TOO_LONG` past that.',
  'A cut must be covered from BOTH sides: an act that ends inside 300ms before a transition is held to its midpoint, and an act that starts within 300ms after one begins AT its midpoint. Put a transition whose midpoint sits inside any hole longer than 200ms — otherwise the engine warns with `FOREGROUND_COVERAGE_GAP` and the render shows a dead dark frame.',
  'Mask reveals (`maskRevealWipe`, `collapseMask`) clip the whole TEXT LINE along the reading direction — never a single word. Per-word clips slice every word of an Arabic sentence open at once, so the line reads as fragments for most of the wipe.',
  'For an OUTRO headline, keep the entrance short: `durationMs: 450` or less. A slow multi-word wipe means the closing line is still being revealed while the scene is ending.',
  'A `highlight` on a kineticText layer paints ONE soft pill behind the whole LINE (borderless, `border-radius: 0.28em`) — not a bordered box per word. Per-word boxes read as separate compartments and chop an Arabic phrase into segments.',
  'A `focusTarget` is a gentle nudge, not a zoom solve: it adds at most +0.14x to the current scale and pans toward the layer within 80% of the safe headroom. To actually reframe, use a camera keyframe instead.',
];

/** Smallest scene that passes `validateScene()` — post it as-is to confirm the round trip. */
export const MINIMAL_VALID_SCENE: SceneSpecInput = {
  schemaVersion: 1,
  name: "Minimal Demo",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 6000,
  layers: [
    {
      id: "bg",
      type: "background",
      variant: { variant: "solid", color: "#05070d" },
    },
    {
      id: "title",
      type: "kineticText",
      at: 400,
      text: "Hello MotionForge",
      sizePx: 96,
      position: { xPct: 50, yPct: 50 },
      fill: "#ffffff",
      entrance: { name: "smoothSlideUp" },
    },
  ],
};

/**
 * A complete, asset-free scene that exercises every layer type that needs no
 * external file. Post it verbatim to see the whole feature surface working.
 */
export const SHOWCASE_SCENE_SKETCH: SceneSpecInput = {
  schemaVersion: 1,
  name: "Showcase Sketch",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 10_000,
  fonts: [{ role: "hero", family: "Cairo", provider: "google", weights: [700, 900] }],
  layers: [
    {
      id: "bg",
      type: "background",
      variant: {
        variant: "meshGradient",
        base: "#05070d",
        blobs: [
          { color: "#3b1f7a", xPct: 20, yPct: 28, radiusPct: 62, drift: 0.45 },
          { color: "#1b3a80", xPct: 80, yPct: 36, radiusPct: 55, drift: 0.3 },
        ],
      },
    },
    {
      id: "headline-ar",
      type: "kineticText",
      at: 600,
      text: "أهلاً بك في موشن فورج",
      direction: "rtl",
      role: "hero",
      googleFamily: "Cairo",
      sizePx: 96,
      position: { xPct: 50, yPct: 45 },
      fill: { type: "linear", angleDeg: 120, stops: [{ color: "#ffffff", at: 0 }, { color: "#a5f3fc", at: 100 }] },
      animateBy: "word",
      entrance: { name: "blurFadeIn", staggerMs: 140 },
      sfx: [{ sfx: "whoosh", offsetMs: 0 }],
    },
    {
      id: "headline-en",
      type: "kineticText",
      at: 1600,
      text: "Motion, engineered.",
      sizePx: 44,
      position: { xPct: 50, yPct: 60 },
      fill: "#93c5fd",
      entrance: { name: "smoothSlideUp", staggerMs: 90 },
    },
    {
      id: "card",
      type: "card",
      at: 3200,
      position: { xPct: 50, yPct: 32 },
      variant: {
        variant: "glassCard",
        title: "Deterministic Pipeline",
        body: "Every frame seeked, captured and piped.",
      },
      entrance: { name: "3dFlipIn" },
      sfx: [{ sfx: "subImpact", offsetMs: 0 }],
    },
    {
      id: "bar",
      type: "card",
      at: 5400,
      position: { xPct: 50, yPct: 62 },
      variant: {
        variant: "progressBar",
        label: "Encoding pipeline",
        value: 94,
        fill: { type: "linear", angleDeg: 90, stops: [{ color: "#22d3ee", at: 0 }, { color: "#a78bfa", at: 100 }] },
        showPercentage: true,
        widthPx: 640,
      },
      entrance: { name: "maskRevealWipe" },
      sfx: [{ sfx: "riser", offsetMs: 0 }],
    },
    {
      id: "counter",
      type: "card",
      at: 7200,
      position: { xPct: 50, yPct: 40 },
      variant: { variant: "counter", from: 0, to: 87, suffix: "%", sizePx: 140 },
      entrance: { name: "springPop" },
    },
    {
      id: "fgx",
      type: "foregroundFX",
      effects: [
        { kind: "vignette", strength: 0.5 },
        { kind: "filmGrain", opacity: 0.06 },
        { kind: "colorGrade", contrast: 0.06, saturation: 0.08, warmth: 0.12 },
      ],
    },
  ],
  camera: {
    keyframes: [
      { at: 0, scale: 1 },
      { at: 9000, scale: 1.28, ease: "power3.inOut" },
    ],
    drift: { amplitudePct: 0.5, periodMs: 5200 },
    moves: [{ move: "slowPushIn", at: 3000, durationMs: 2200, strength: 0.9 }],
  },
  transitions: [
    { kind: "wipe", at: 2800, direction: "left", durationMs: 700, color: "#0b1020", featherPx: 90 },
    { kind: "morph", at: 9400, durationMs: 600 },
  ],
  audio: { cues: [{ at: 2000, sfx: "click" }] },
};

/** Top-level shape of a SceneSpec, for hosts that want it without the full schema. */
export const SCENE_TOP_LEVEL_REQUIRED = ["schemaVersion", "name", "canvas", "durationMs", "layers"] as const;

export const SCENE_TOP_LEVEL_OPTIONAL = [
  "id (stable id — re-posting the same id updates the scene in place)",
  "assets ([] — declare every file referenced by a layer)",
  "fonts ([] — one entry per typography role)",
  "camera ({ perspective?, drift?, keyframes?, moves? })",
  "transitions ([])",
  "audio ({ music?, cues? })",
] as const;

/**
 * The single authoring digest. `core-engine` publishes it inside
 * `get_motion_capabilities`, and the MCP server serves it as the
 * `motionforge://scenespec/v1` resource — one source, no drift.
 *
 * It is deliberately self-sufficient: structure guidance AND the closed
 * vocabularies, so an LLM can author a valid scene from this alone, offline.
 */
export function authoringDigest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    units: {
      time: "milliseconds everywhere (at, durationMs, delayMs, cues[].at)",
      position: "canvas percent objects { xPct, yPct }",
      size: "design-space pixels via *Px keys (sizePx, widthPx, blurPx, radiusPx)",
      color: "CSS color string, or a linear gradient object for `fill`",
    },
    sceneTopLevel: {
      required: SCENE_TOP_LEVEL_REQUIRED,
      optional: SCENE_TOP_LEVEL_OPTIONAL,
    },
    commonLayerRequired: COMMON_LAYER_REQUIRED,
    commonLayerOptional: COMMON_LAYER_OPTIONAL,
    layerFieldGuide: LAYER_FIELD_GUIDE,
    nestedShapeNotes: NESTED_SHAPE_NOTES,
    minimalValidScene: MINIMAL_VALID_SCENE,
    fullShowcaseSketch: SHOWCASE_SCENE_SKETCH,
    registries: {
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
      layerFilterKeys: LAYER_FILTER_KEYS,
      keyframeProperties: KEYFRAME_PROPERTIES,
      keyframeEasings: KEYFRAME_EASINGS,
    },
    notes: {
      howToStart:
        "Copy minimalValidScene, change name/text, then call create_or_update_scene. Post fullShowcaseSketch to exercise every feature. On a rejected scene the response lists every field-level issue — fix exactly those paths. An ACCEPTED scene may still carry warnings[] (e.g. a camera that would show black void) — read them too.",
      rtl: 'set direction:"rtl" on kineticText; Arabic char-stagger degrades to word (shaping)',
      sfx: "cues fire relative to layer `at` (layer.sfx[].offsetMs) or absolute (audio.cues[].at)",
      timing: "all times are milliseconds; canvas positions are percent of canvas; sizes are design px",
      strictness: "unknown keys are rejected everywhere — do not invent field names",
      camera: "keyframes inherit unset fields from the previous keyframe; at scale s the safe pan range is [50/s, 100-50/s]",
      effects: "emphasis presets and camera moves are temporary — they return to the baseline when their window ends",
      inspection: "inspect_scene_keyframes returns framesMeta[] (camera pose, transition phase, per-layer lifecycle/opacity/bbox/textOverflow) — read it before judging a frame",
    },
  };
}

export { layerBaseSchema };