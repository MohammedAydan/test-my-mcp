import { describe, expect, it } from "vitest";
import {
  KEYFRAME_EASINGS,
  KEYFRAME_PROPERTIES,
  KEYFRAME_VALUE_RANGES,
  LAYER_FILTER_KEYS,
  layerFilterSchema,
  layerKeyframeSchema,
  sanitizeSceneInput,
  type LayerFilter,
  type LayerKeyframe,
} from "../src/index.js";

describe("the public surface of @motionforge/scene-spec", () => {
  it("publishes the unified transform vocabulary", () => {
    expect(LAYER_FILTER_KEYS.length).toBeGreaterThan(0);
    expect(KEYFRAME_PROPERTIES.length).toBe(5);
    expect(KEYFRAME_EASINGS.length).toBe(5);
    expect(Object.keys(KEYFRAME_VALUE_RANGES).sort()).toEqual([...KEYFRAME_PROPERTIES].sort());
  });

  it("publishes the schemas and the inferred types", () => {
    const filter: LayerFilter = { blur: 4 };
    const keyframe: LayerKeyframe = layerKeyframeSchema.parse({
      id: "k1",
      timeMs: 0,
      property: "opacity",
      value: 1,
    });
    expect(layerFilterSchema.safeParse(filter).success).toBe(true);
    expect(keyframe.easing).toBe("easeInOut");
    expect(typeof sanitizeSceneInput).toBe("function");
  });
});
