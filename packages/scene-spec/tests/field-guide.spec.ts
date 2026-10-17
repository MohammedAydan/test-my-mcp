import { describe, expect, it } from "vitest";

import {
  BACKGROUND_VARIANTS,
  CARD_VARIANTS,
  FOREGROUND_FX_KINDS,
  LAYER_FIELD_GUIDE,
  LAYER_TYPES,
  MINIMAL_VALID_SCENE,
  SHOWCASE_SCENE_SKETCH,
  authoringDigest,
  backgroundLayerSchema,
  cardLayerSchema,
  foregroundFxLayerSchema,
  layerSchema,
  validateScene,
  type SceneSpecInput,
} from "@motionforge/scene-spec";

/**
 * These tests are the drift guard for the LLM authoring surface: every example
 * the capabilities payload advertises MUST validate against the real schema.
 * If a schema changes and the guidance does not, this fails.
 */
describe("field guide examples", () => {
  it("covers every layer type exactly once", () => {
    expect(Object.keys(LAYER_FIELD_GUIDE).sort()).toEqual([...LAYER_TYPES].sort());
  });

  for (const layerType of LAYER_TYPES) {
    it(`ships a schema-valid example for "${layerType}"`, () => {
      const entry = LAYER_FIELD_GUIDE[layerType];
      expect(entry.required.length).toBeGreaterThan(0);
      expect(entry.optional.length).toBeGreaterThan(0);
      // the example layer itself must satisfy the real discriminated union
      const parsed = layerSchema.safeParse(entry.example);
      if (!parsed.success) {
        throw new Error(
          `field guide example for "${layerType}" is invalid: ${JSON.stringify(parsed.error.issues, null, 2)}`
        );
      }
      expect(parsed.data.id).toBe(entry.example.id);
      expect(parsed.data.type).toBe(layerType);
    });
  }
});

describe("minimalValidScene", () => {
  it("passes validateScene() with zero issues", () => {
    const result = validateScene(MINIMAL_VALID_SCENE);
    if (!result.ok) throw new Error(`minimalValidScene invalid: ${JSON.stringify(result.issues)}`);
    expect(result.scene.durationMs).toBe(MINIMAL_VALID_SCENE.durationMs);
  });

  it("contains at least one background and one kineticText layer", () => {
    const types = MINIMAL_VALID_SCENE.layers.map((l) => l.type);
    expect(types).toContain("background");
    expect(types).toContain("kineticText");
  });
});

describe("fullShowcaseSketch", () => {
  it("passes validateScene() with zero issues", () => {
    const result = validateScene(SHOWCASE_SCENE_SKETCH);
    if (!result.ok) throw new Error(`showcase sketch invalid: ${JSON.stringify(result.issues)}`);
  });

  it("needs no vault assets (postable as-is)", () => {
    const referenced = SHOWCASE_SCENE_SKETCH.layers.flatMap((layer) => {
      if (layer.type === "imageLogo" || layer.type === "lottie") return [layer.assetId];
      if (layer.type === "background" && layer.variant.variant === "media") return [layer.variant.assetId];
      if (layer.type === "card" && layer.variant.variant === "glassCard" && layer.variant.iconAssetId) {
        return [layer.variant.iconAssetId];
      }
      return [];
    });
    expect(referenced).toEqual([]);
    expect(SHOWCASE_SCENE_SKETCH.assets).toBeUndefined();
  });
});

describe("registry drift guards", () => {
  /** Read the literal discriminants straight out of the discriminated unions. */
  const unionDiscriminants = (union: unknown): string[] => {
    const options = (union as { options: Array<{ shape: Record<string, unknown> }> }).options;
    return options.map((option) => String((option.shape["variant"] ?? option.shape["kind"]) && (
      (option.shape["variant"] ?? option.shape["kind"]) as { value: string }
    ).value));
  };

  it("BACKGROUND_VARIANTS matches the background union", () => {
    expect(unionDiscriminants(backgroundLayerSchema.shape.variant)).toEqual([...BACKGROUND_VARIANTS]);
  });

  it("CARD_VARIANTS matches the card union", () => {
    expect(unionDiscriminants(cardLayerSchema.shape.variant)).toEqual([...CARD_VARIANTS]);
  });

  it("FOREGROUND_FX_KINDS matches the effects union", () => {
    const effectsSchema = foregroundFxLayerSchema.shape.effects as unknown as {
      element: unknown;
    };
    expect(unionDiscriminants(effectsSchema.element)).toEqual([...FOREGROUND_FX_KINDS]);
  });
});

describe("authoringDigest", () => {
  const digest = authoringDigest() as Record<string, unknown>;

  it("is self-sufficient for offline authoring", () => {
    for (const key of [
      "layerFieldGuide",
      "nestedShapeNotes",
      "minimalValidScene",
      "fullShowcaseSketch",
      "registries",
      "units",
      "sceneTopLevel",
      "commonLayerRequired",
      "notes",
    ]) {
      expect(digest[key], `missing ${key}`).toBeDefined();
    }
  });

  it("states the structural rules that caused opaque authoring failures", () => {
    const notes = digest.nestedShapeNotes as string[];
    const joined = notes.join(" ");
    expect(joined).toContain("background.variant");
    expect(joined).toContain("card.variant");
    expect(joined).toContain("entrance");
    expect(joined).toContain("xPct");
    expect(joined).toContain("milliseconds");
  });

  it("carries a minimalValidScene that is itself valid", () => {
    const result = validateScene(digest.minimalValidScene as SceneSpecInput);
    expect(result.ok).toBe(true);
  });
});