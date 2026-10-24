import { describe, expect, it } from "vitest";
import {
  KEYFRAME_EASINGS,
  KEYFRAME_PROPERTIES,
  KEYFRAME_VALUE_RANGES,
  LAYER_FILTER_KEYS,
  layerFilterSchema,
  layerKeyframeSchema,
  sanitizeSceneInput,
  sanitizeSceneInputWithReport,
  validateScene,
  type SceneSpecInput,
} from "../src/index.js";

/**
 * The unified 2D transform contract: filters, flat keyframes and the layout
 * size, all on the layer base so EVERY kind accepts them.
 */

const BASE: SceneSpecInput = {
  schemaVersion: 1,
  name: "Unified Transform Fixture",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 4000,
  layers: [],
};

const LAYER = {
  id: "bg",
  type: "background",
  variant: { variant: "solid", color: "#05070d" },
};

describe("layer filters", () => {
  it("declares the closed filter vocabulary", () => {
    expect([...LAYER_FILTER_KEYS]).toEqual([
      "blur",
      "brightness",
      "contrast",
      "saturate",
      "shadowBlur",
      "shadowColor",
      "cornerRadius",
    ]);
  });

  it("accepts a full filter bag", () => {
    const result = layerFilterSchema.safeParse({
      blur: 12,
      brightness: 110,
      contrast: 90,
      saturate: 120,
      shadowBlur: 24,
      shadowColor: "#000000",
      cornerRadius: 18,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown filter key", () => {
    expect(layerFilterSchema.safeParse({ sepia: 1 }).success).toBe(false);
  });

  it("rejects an out-of-range filter value", () => {
    expect(layerFilterSchema.safeParse({ blur: 900 }).success).toBe(false);
    expect(layerFilterSchema.safeParse({ brightness: -1 }).success).toBe(false);
  });

  it("rejects an invalid shadow colour", () => {
    expect(layerFilterSchema.safeParse({ shadowColor: "not-a-colour" }).success).toBe(false);
  });

  it("is named `filters` — `effects` keeps its own meaning on foregroundFX", () => {
    const result = validateScene({
      ...BASE,
      layers: [{ ...LAYER, filters: { blur: 4 } }],
    });
    expect(result.ok).toBe(true);
  });
});

describe("layer keyframes", () => {
  it("declares the closed property and easing vocabularies", () => {
    expect([...KEYFRAME_PROPERTIES]).toEqual(["xPct", "yPct", "scale", "rotation", "opacity"]);
    expect(KEYFRAME_EASINGS).toContain("linear");
    expect(KEYFRAME_EASINGS).toContain("easeIn");
    expect(KEYFRAME_EASINGS).toContain("easeOut");
    expect(KEYFRAME_EASINGS).toContain("easeInOut");
    expect(KEYFRAME_EASINGS).toContain("cubic");
    expect(KEYFRAME_EASINGS).toContain("sine.inOut");
    expect(KEYFRAME_EASINGS).toContain("power2.out");
  });

  it("accepts standard GSAP easing vocabulary in layer keyframes", () => {
    const parsed = layerKeyframeSchema.parse({
      id: "k1",
      timeMs: 1000,
      property: "xPct",
      value: 40,
      easing: "sine.inOut",
    });
    expect(parsed.easing).toBe("sine.inOut");
  });

  it("accepts a keyframe and defaults the easing", () => {
    const parsed = layerKeyframeSchema.parse({
      id: "k1",
      timeMs: 1000,
      property: "xPct",
      value: 40,
    });
    expect(parsed.easing).toBe("easeInOut");
  });

  it("rejects an unknown property", () => {
    expect(
      layerKeyframeSchema.safeParse({ id: "k1", timeMs: 0, property: "blur", value: 1 }).success
    ).toBe(false);
  });

  it("rejects a value outside its property's range", () => {
    for (const [property, value] of [
      ["xPct", 900],
      ["yPct", -900],
      ["scale", 40],
      ["rotation", 9000],
      ["opacity", 4],
    ] as const) {
      const result = layerKeyframeSchema.safeParse({ id: "k1", timeMs: 0, property, value });
      expect(result.success, `${property}=${value} should be rejected`).toBe(false);
    }
  });

  it("accepts the boundary values", () => {
    for (const [property, range] of Object.entries(KEYFRAME_VALUE_RANGES)) {
      for (const value of [range.min, range.max]) {
        const result = layerKeyframeSchema.safeParse({ id: "k1", timeMs: 0, property, value });
        expect(result.success, `${property}=${value}`).toBe(true);
      }
    }
  });

  it("rides on every layer kind through the base schema", () => {
    const result = validateScene({
      ...BASE,
      layers: [
        {
          ...LAYER,
          keyframes: [{ id: "k1", timeMs: 0, property: "opacity", value: 0.5 }],
        },
      ],
    });
    expect(result.ok, result.ok ? "" : result.issues.join("; ")).toBe(true);
  });
});

describe("the new spatial fields", () => {
  it("accepts size, scaleX, scaleY and filters together", () => {
    const result = validateScene({
      ...BASE,
      layers: [
        {
          ...LAYER,
          size: { widthPct: 40, heightPct: 25 },
          scaleX: 1.2,
          scaleY: 0.8,
          filters: { blur: 3 },
          keyframes: [{ id: "k1", timeMs: 0, property: "scale", value: 1.5 }],
        },
      ],
    });
    expect(result.ok, result.ok ? "" : result.issues.join("; ")).toBe(true);
  });

  it("accepts a position beyond the old ±200 range", () => {
    const result = validateScene({
      ...BASE,
      layers: [{ ...LAYER, position: { xPct: -280, yPct: 260 } }],
    });
    expect(result.ok, result.ok ? "" : result.issues.join("; ")).toBe(true);
  });

  it("still rejects a position beyond ±300", () => {
    const result = validateScene({
      ...BASE,
      layers: [{ ...LAYER, position: { xPct: -400, yPct: 0 } }],
    });
    expect(result.ok).toBe(false);
  });
});

describe("sanitizeSceneInput — the unified transform fields", () => {
  it("clamps scale, scaleX and scaleY", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [{ ...LAYER, scale: 99, scaleX: 0.001, scaleY: 1000 }],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer.scale).toBe(10);
    expect(layer.scaleX).toBe(0.05);
    expect(layer.scaleY).toBe(10);
  });

  it("clamps the layout size", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [{ ...LAYER, size: { widthPct: 900, heightPct: -20 } }],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer.size).toEqual({ widthPct: 400, heightPct: 0 });
  });

  it("clamps a keyframe value into its property's range", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [
        {
          ...LAYER,
          keyframes: [
            { id: "k1", timeMs: 0, property: "opacity", value: 5 },
            { id: "k2", timeMs: 100, property: "xPct", value: -900 },
          ],
        },
      ],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as Record<string, unknown>;
    const keyframes = layer.keyframes as Array<Record<string, unknown>>;
    expect(keyframes[0]!.value).toBe(1);
    expect(keyframes[1]!.value).toBe(-300);
  });

  it("drops a keyframe whose property is unknown", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [
        {
          ...LAYER,
          keyframes: [
            { id: "k1", timeMs: 0, property: "opacity", value: 1 },
            { id: "k2", timeMs: 0, property: "sepia", value: 1 },
          ],
        },
      ],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect((layer.keyframes as unknown[]).length).toBe(1);
  });

  it("drops filter entries whose value is not a number", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [{ ...LAYER, filters: { blur: "8", contrast: 120, shadowColor: "#ffffff" } }],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer.filters).toEqual({ contrast: 120, shadowColor: "#ffffff" });
  });

  it("clamps an out-of-range filter value", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [{ ...LAYER, filters: { blur: 900, cornerRadius: 900 } }],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer.filters).toEqual({ blur: 200, cornerRadius: 400 });
  });

  it("clamps a position into the widened range", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [{ ...LAYER, position: { xPct: 900, yPct: -900 } }],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer.position).toEqual({ xPct: 300, yPct: -300 });
  });

  it("is idempotent", () => {
    const payload = {
      ...BASE,
      layers: [
        {
          ...LAYER,
          scale: 99,
          scaleX: 0.001,
          size: { widthPct: 900 },
          filters: { blur: 900 },
          keyframes: [{ id: "k1", timeMs: 0, property: "opacity", value: 5 }],
        },
      ],
    };
    const once = sanitizeSceneInput(payload);
    const twice = sanitizeSceneInput(once);
    expect(twice).toEqual(once);
  });

  it("reports what it clamped", () => {
    const report = sanitizeSceneInputWithReport({
      ...BASE,
      layers: [{ ...LAYER, scale: 99, keyframes: [{ id: "k1", timeMs: 0, property: "opacity", value: 5 }] }],
    });
    expect(report.clamped.join(" ")).toContain("layers.0.scale");
    expect(report.clamped.join(" ")).toContain("layers.0.keyframes.0.value");
  });

  it("a clamped scene then validates", () => {
    const sanitized = sanitizeSceneInput({
      ...BASE,
      layers: [
        {
          ...LAYER,
          scale: 99,
          size: { widthPct: 900 },
          filters: { blur: 900 },
          keyframes: [{ id: "k1", timeMs: 0, property: "opacity", value: 5 }],
        },
      ],
    });
    expect(validateScene(sanitized).ok).toBe(true);
  });
});
