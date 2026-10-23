import { describe, expect, it } from "vitest";

import {
  CHART_TYPES,
  CODE_BLOCK_THEMES,
  CTA_ICONS,
  CTA_VARIANTS,
  LAYER_TYPES,
  PARTICLE_PATTERNS,
  sanitizeSceneInput,
  validateScene,
  type SceneSpecInput,
} from "../src/index.js";

/**
 * The four new layer kinds (chart, codeBlock, particleField, cta).
 *
 * These tests pin the contract an agent (and the Studio) depends on: the
 * shapes validate, the vocabularies are closed, the sanitizer heals the
 * `*Px` aliases, and a malformed payload degrades instead of failing the
 * whole scene.
 */

const BASE: SceneSpecInput = {
  schemaVersion: 1,
  name: "New Kinds Fixture",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 8000,
  layers: [],
};

describe("the layer-type registry", () => {
  it("now carries SIXTEEN kinds", () => {
    expect(LAYER_TYPES).toHaveLength(16);
    expect([...LAYER_TYPES]).toEqual([
      "background",
      "imageLogo",
      "kineticText",
      "card",
      "lottie",
      "foregroundFX",
      "chart",
      "codeBlock",
      "particleField",
      "cta",
      "deviceMockup",
      "cursorFlow",
      "bentoGrid",
      "connectorDiagram",
      "metricTicker",
      "comparisonSplit",
    ]);
  });
});

describe("chart", () => {
  const chart = {
    id: "chart",
    type: "chart",
    position: { xPct: 50, yPct: 50 },
    data: [
      { label: "Draft", value: 8.9 },
      { label: "Production", value: 4.2 },
    ],
  };

  it("validates a minimal chart", () => {
    const result = validateScene({ ...BASE, layers: [chart] });
    expect(result.ok, result.ok ? "" : result.issues.join("; ")).toBe(true);
  });

  it("accepts every chart type", () => {
    for (const chartType of CHART_TYPES) {
      const result = validateScene({ ...BASE, layers: [{ ...chart, chartType }] });
      expect(result.ok, chartType).toBe(true);
    }
  });

  it("rejects an unknown chart type", () => {
    const result = validateScene({ ...BASE, layers: [{ ...chart, chartType: "pie" }] });
    expect(result.ok).toBe(false);
  });

  it("needs at least two data points", () => {
    const result = validateScene({ ...BASE, layers: [{ ...chart, data: [{ label: "A", value: 1 }] }] });
    expect(result.ok).toBe(false);
  });

  it("requires a position", () => {
    const { position, ...noPosition } = chart;
    void position;
    const result = validateScene({ ...BASE, layers: [noPosition] });
    expect(result.ok).toBe(false);
  });

  it("rejects a hallucinated key", () => {
    const result = validateScene({
      ...BASE,
      layers: [{ ...chart, chartTyp: "bar" }],
    });
    expect(result.ok).toBe(false);
  });
});

describe("codeBlock", () => {
  const codeBlock = {
    id: "snippet",
    type: "codeBlock",
    position: { xPct: 50, yPct: 50 },
    code: "const a = 1;",
  };

  it("validates a minimal code block", () => {
    const result = validateScene({ ...BASE, layers: [codeBlock] });
    expect(result.ok, result.ok ? "" : result.issues.join("; ")).toBe(true);
  });

  it("accepts every theme", () => {
    for (const theme of CODE_BLOCK_THEMES) {
      const result = validateScene({ ...BASE, layers: [{ ...codeBlock, theme }] });
      expect(result.ok, theme).toBe(true);
    }
  });

  it("rejects an unknown theme", () => {
    const result = validateScene({ ...BASE, layers: [{ ...codeBlock, theme: "solarized" }] });
    expect(result.ok).toBe(false);
  });

  it("normalises the fontSizePx alias onto fontSize", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [{ ...codeBlock, fontSizePx: 30 }],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer.fontSize).toBe(30);
    expect(layer.fontSizePx).toBeUndefined();
    expect(validateScene(out).ok).toBe(true);
  });

  it("keeps the canonical fontSize when both spellings are present", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [{ ...codeBlock, fontSize: 18, fontSizePx: 40 }],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer.fontSize).toBe(18);
    expect(layer.fontSizePx).toBeUndefined();
  });
});

describe("particleField", () => {
  it("validates with no fields at all (every one has a default)", () => {
    const result = validateScene({ ...BASE, layers: [{ id: "dust", type: "particleField" }] });
    expect(result.ok, result.ok ? "" : result.issues.join("; ")).toBe(true);
  });

  it("accepts every pattern", () => {
    for (const pattern of PARTICLE_PATTERNS) {
      const result = validateScene({ ...BASE, layers: [{ id: "dust", type: "particleField", pattern }] });
      expect(result.ok, pattern).toBe(true);
    }
  });

  it("rejects an unknown pattern", () => {
    const result = validateScene({
      ...BASE,
      layers: [{ id: "dust", type: "particleField", pattern: "swirl" }],
    });
    expect(result.ok).toBe(false);
  });

  it("normalises the sizePx alias onto size", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [{ id: "dust", type: "particleField", sizePx: 4 }],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer.size).toBe(4);
    expect(layer.sizePx).toBeUndefined();
    expect(validateScene(out).ok).toBe(true);
  });

  it("clamps an out-of-range count", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [{ id: "dust", type: "particleField", count: 100000 }],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer.count).toBe(400);
  });
});

describe("cta", () => {
  const cta = {
    id: "cta",
    type: "cta",
    position: { xPct: 50, yPct: 70 },
    label: "Start free trial",
  };

  it("validates a minimal CTA", () => {
    const result = validateScene({ ...BASE, layers: [cta] });
    expect(result.ok, result.ok ? "" : result.issues.join("; ")).toBe(true);
  });

  it("accepts every variant and every icon", () => {
    for (const variant of CTA_VARIANTS) {
      for (const icon of CTA_ICONS) {
        const result = validateScene({ ...BASE, layers: [{ ...cta, variant, icon }] });
        expect(result.ok, `${variant}/${icon}`).toBe(true);
      }
    }
  });

  it("rejects an unknown variant", () => {
    const result = validateScene({ ...BASE, layers: [{ ...cta, variant: "neon" }] });
    expect(result.ok).toBe(false);
  });

  it("requires a label", () => {
    const { label, ...noLabel } = cta;
    void label;
    const result = validateScene({ ...BASE, layers: [noLabel] });
    expect(result.ok).toBe(false);
  });
});

describe("the sanitizer degrades a malformed new-kind payload", () => {
  it("drops a chart's non-object data points instead of failing the scene", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [
        {
          id: "chart",
          type: "chart",
          position: { xPct: 50, yPct: 50 },
          data: [{ label: "A", value: 1 }, "nope", null, { label: "B", value: 2 }],
        },
      ],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as { data: unknown[] };
    expect(layer.data).toHaveLength(2);
    expect(validateScene(out).ok).toBe(true);
  });

  it("drops a non-numeric chart value to 0 rather than failing", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [
        {
          id: "chart",
          type: "chart",
          position: { xPct: 50, yPct: 50 },
          data: [
            { label: "A", value: "x" as unknown as number },
            { label: "B", value: 2 },
          ],
        },
      ],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as { data: Array<{ value: number }> };
    expect(layer.data[0]?.value).toBe(0);
    expect(validateScene(out).ok).toBe(true);
  });

  it("drops a non-array chart data payload", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [{ id: "chart", type: "chart", position: { xPct: 50, yPct: 50 }, data: "nope" }],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer.data).toBeUndefined();
  });
});

describe("the particleField radius survives the sanitizer", () => {
  it("keeps a numeric `size` (it is the particle RADIUS, not a layout box)", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [{ id: "dust", type: "particleField", size: 3.5 }],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer.size).toBe(3.5);
    expect(validateScene(out).ok).toBe(true);
  });

  it("folds the sizePx alias into the canonical `size`", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [{ id: "dust", type: "particleField", sizePx: 2.5 }],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer.size).toBe(2.5);
    expect(layer.sizePx).toBeUndefined();
    expect(validateScene(out).ok).toBe(true);
  });

  it("still drops a numeric `size` on the kinds where `size` IS a layout box", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" }, size: 4 }],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer.size).toBeUndefined();
  });
});
