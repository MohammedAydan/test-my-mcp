import { z } from "zod";
import { colorSchema, idSchema, msSchema } from "./common.js";
import { cameraSchema } from "./camera.js";
import { assetSchema, fontRefSchema, type AssetKind } from "./assets.js";
import { audioSchema } from "./audio.js";
import { backgroundLayerSchema } from "./layers/background.js";
import { imageLogoLayerSchema } from "./layers/image-logo.js";
import { kineticTextLayerSchema } from "./layers/kinetic-text.js";
import { cardLayerSchema } from "./layers/card.js";
import { lottieLayerSchema } from "./layers/lottie.js";
import { foregroundFxLayerSchema } from "./layers/foreground-fx.js";

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

export const CANVAS_SHAPES = ["16:9", "9:16", "1:1", "4:5"] as const;
export type CanvasShape = (typeof CANVAS_SHAPES)[number];

export const CANVAS_SCALES = [720, 1080, 1440, 2160] as const;
export type CanvasScale = (typeof CANVAS_SCALES)[number];

const SCALES_PER_SHAPE: Record<CanvasShape, readonly CanvasScale[]> = {
  "16:9": [720, 1080, 1440, 2160],
  "9:16": [720, 1080, 1440, 2160],
  "1:1": [1080, 2160],
  "4:5": [1080, 2160],
};

const SIZE_TABLE: Record<CanvasShape, Partial<Record<CanvasScale, readonly [number, number]>>> = {
  "16:9": { 720: [1280, 720], 1080: [1920, 1080], 1440: [2560, 1440], 2160: [3840, 2160] },
  "9:16": { 720: [720, 1280], 1080: [1080, 1920], 1440: [1440, 2560], 2160: [2160, 3840] },
  "1:1": { 1080: [1080, 1080], 2160: [2160, 2160] },
  "4:5": { 1080: [1080, 1350], 2160: [2160, 2700] },
};

/**
 * Canvas shape + scale, including the shape/scale pairing rule (1:1 and 4:5
 * have no 720p master). Exported unwrapped so other contracts — e.g. the
 * creative project manifest — validate a canvas with exactly the same rules
 * instead of restating them.
 */
export const canvasShapeScaleSchema = z
  .strictObject({
    shape: z.enum(CANVAS_SHAPES).default("16:9"),
    scale: z
      .union([z.literal(720), z.literal(1080), z.literal(1440), z.literal(2160)])
      .default(1080),
  })
  .superRefine((canvas, ctx) => {
    if (!SCALES_PER_SHAPE[canvas.shape].includes(canvas.scale)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scale"],
        message: `scale ${canvas.scale} is not valid for shape "${canvas.shape}" (allowed: ${SCALES_PER_SHAPE[canvas.shape].join(", ")})`,
      });
    }
  });

export const canvasSchema = canvasShapeScaleSchema;
export type Canvas = z.infer<typeof canvasSchema>;

/** Resolve a validated canvas to pixel dimensions. */
export function resolveCanvasSize(canvas: Canvas): { width: number; height: number } {
  const size = SIZE_TABLE[canvas.shape][canvas.scale];
  if (!size) {
    throw new Error(`invalid canvas ${canvas.shape} @${canvas.scale}`);
  }
  return { width: size[0], height: size[1] };
}

// ---------------------------------------------------------------------------
// Transitions (scene-level timeline events, not layers)
// ---------------------------------------------------------------------------

export const TRANSITION_KINDS = ["wipe", "glitch", "whipPan", "morph"] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];

export const transitionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("wipe"),
    at: msSchema,
    durationMs: msSchema.default(700),
    direction: z.enum(["left", "right", "up", "down"]).default("right"),
    featherPx: z.number().min(0).max(400).default(0),
    color: colorSchema.default("#000000"),
  }),
  z.strictObject({
    kind: z.literal("glitch"),
    at: msSchema,
    durationMs: msSchema.default(500),
    intensity: z.number().min(0).max(1).default(0.6),
  }),
  z.strictObject({
    kind: z.literal("whipPan"),
    at: msSchema,
    durationMs: msSchema.default(500),
    direction: z.enum(["left", "right"]).default("left"),
  }),
  z.strictObject({
    kind: z.literal("morph"),
    at: msSchema,
    durationMs: msSchema.default(800),
  }),
]);
export type Transition = z.infer<typeof transitionSchema>;

// ---------------------------------------------------------------------------
// Layer union
// ---------------------------------------------------------------------------

export const LAYER_TYPES = [
  "background",
  "imageLogo",
  "kineticText",
  "card",
  "lottie",
  "foregroundFX",
] as const;
export type LayerType = (typeof LAYER_TYPES)[number];

export const layerSchema = z.discriminatedUnion("type", [
  backgroundLayerSchema,
  imageLogoLayerSchema,
  kineticTextLayerSchema,
  cardLayerSchema,
  lottieLayerSchema,
  foregroundFxLayerSchema,
]);
export type Layer = z.infer<typeof layerSchema>;

// ---------------------------------------------------------------------------
// SceneSpec
// ---------------------------------------------------------------------------

/**
 * The structural SceneSpec shape WITHOUT the cross-field rules below.
 *
 * Exported separately so consumers that need to *advertise or pre-validate* the
 * structure (e.g. an MCP tool input schema, which must be a ZodObject to be
 * serialized) can use this, while `sceneSpecSchema` remains the full validator.
 * Both accept and produce identical fields — this is the same object, unwrapped.
 */
export const sceneShapeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: idSchema.optional(),
  name: z.string().min(1).max(120),
  canvas: canvasSchema,
  durationMs: z.number().int().min(300).max(600_000),
  assets: z.array(assetSchema).max(64).default([]),
  fonts: z.array(fontRefSchema).max(12).default([]),
  layers: z.array(layerSchema).max(40),
  camera: cameraSchema.default({}),
  transitions: z.array(transitionSchema).max(32).default([]),
  audio: audioSchema.default({}),
});

export const sceneSpecSchema = sceneShapeSchema
  .superRefine((scene, ctx) => {
    const fail = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    // unique ids
    const layerIds = new Set<string>();
    scene.layers.forEach((layer, i) => {
      if (layerIds.has(layer.id)) fail(["layers", i, "id"], `duplicate layer id "${layer.id}"`);
      layerIds.add(layer.id);
    });
    const assetIds = new Set<string>();
    scene.assets.forEach((asset, i) => {
      if (assetIds.has(asset.id)) fail(["assets", i, "id"], `duplicate asset id "${asset.id}"`);
      assetIds.add(asset.id);
    });
    const fontRoles = new Set<string>();
    scene.fonts.forEach((font, i) => {
      if (fontRoles.has(font.role)) fail(["fonts", i, "role"], `duplicate font role "${font.role}"`);
      fontRoles.add(font.role);
    });

    // timeline bounds
    scene.layers.forEach((layer, i) => {
      if (layer.at >= scene.durationMs) {
        fail(["layers", i, "at"], `layer starts at or after scene end (${scene.durationMs}ms)`);
      }
      if (layer.duration !== undefined && layer.at + layer.duration > scene.durationMs) {
        fail(["layers", i, "duration"], "layer window extends past scene end");
      }
    });
    scene.transitions.forEach((t, i) => {
      if (t.at >= scene.durationMs) {
        fail(["transitions", i, "at"], "transition at or after scene end");
      }
    });
    scene.audio.cues.forEach((cue, i) => {
      if (cue.at > scene.durationMs) {
        fail(["audio", "cues", i, "at"], "cue at or after scene end");
      }
    });
    scene.camera.keyframes.forEach((kf, i) => {
      if (kf.at > scene.durationMs) {
        fail(["camera", "keyframes", i, "at"], "keyframe at or after scene end");
      }
    });
    scene.camera.moves.forEach((m, i) => {
      if (m.at > scene.durationMs) {
        fail(["camera", "moves", i, "at"], "camera move at or after scene end");
      }
    });

    // asset references must resolve to declared assets of the right kind
    const byId = new Map(scene.assets.map((a) => [a.id, a]));
    const expectAsset = (assetId: string, path: (string | number)[], kinds: AssetKind[]) => {
      const asset = byId.get(assetId);
      if (!asset) {
        fail(path, `references undeclared asset id "${assetId}"`);
      } else if (!kinds.includes(asset.kind)) {
        fail(path, `asset "${assetId}" is kind "${asset.kind}", expected ${kinds.join("|")}`);
      }
    };

    scene.layers.forEach((layer, i) => {
      switch (layer.type) {
        case "background":
          if (layer.variant.variant === "media") {
            expectAsset(layer.variant.assetId, ["layers", i], ["image", "video"]);
          }
          break;
        case "imageLogo":
          expectAsset(layer.assetId, ["layers", i], ["image"]);
          break;
        case "lottie":
          expectAsset(layer.assetId, ["layers", i], ["lottie"]);
          break;
        case "card":
          if (layer.variant.variant === "glassCard" && layer.variant.iconAssetId) {
            expectAsset(layer.variant.iconAssetId, ["layers", i], ["image"]);
          }
          break;
        default:
          break;
      }
    });
    if (scene.audio.music) {
      expectAsset(scene.audio.music.assetId, ["audio", "music"], ["audio"]);
    }
  });

export type SceneSpec = z.infer<typeof sceneSpecSchema>;
