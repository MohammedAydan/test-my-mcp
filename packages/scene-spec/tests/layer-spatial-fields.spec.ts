import { describe, expect, it } from "vitest";
import {
  LAYER_TYPES,
  sanitizeSceneInput,
  sanitizeSceneInputWithReport,
  validateScene,
  type SceneSpecInput,
} from "../src/index.js";

/**
 * Universal spatial / NLE layer fields.
 *
 * The Studio is a direct-manipulation editor: it writes `position` (and the
 * rest of the spatial set) onto whichever layer the user grabbed. Before this
 * contract existed, a grab on the `background` — which is always `layers.0` —
 * produced:
 *
 *     Error occurred in handler for 'engine:invoke':
 *     Error: invalid scene: layers.0: Unrecognized key(s) in object: 'position'
 *
 * and every auto-save failed. These tests pin the fix: EVERY layer kind must
 * accept the spatial set, `layers.0` included.
 */

const BASE: SceneSpecInput = {
  schemaVersion: 1,
  name: "Spatial Fixture",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 4000,
  layers: [],
};

/** One representative layer per kind in the discriminated union. */
const LAYER_FIXTURES: Record<string, Record<string, unknown>> = {
  background: { id: "bg", type: "background", variant: { variant: "solid", color: "#05070d" } },
  imageLogo: { id: "logo", type: "imageLogo", assetId: "asset-1", widthPx: 200 },
  kineticText: { id: "title", type: "kineticText", text: "Hello", sizePx: 80 },
  card: {
    id: "card",
    type: "card",
    position: { xPct: 50, yPct: 50 },
    variant: { variant: "callout", accentColor: "#fff" },
  },
  lottie: { id: "lottie", type: "lottie", assetId: "asset-2" },
  foregroundFX: { id: "fx", type: "foregroundFX", effects: [{ kind: "vignette" }] },
  chart: {
    id: "chart",
    type: "chart",
    position: { xPct: 50, yPct: 50 },
    data: [
      { label: "A", value: 3 },
      { label: "B", value: 5 },
    ],
  },
  codeBlock: {
    id: "snippet",
    type: "codeBlock",
    position: { xPct: 50, yPct: 50 },
    code: "const a = 1;",
  },
  particleField: { id: "dust", type: "particleField" },
  cta: {
    id: "cta",
    type: "cta",
    position: { xPct: 50, yPct: 50 },
    label: "Start",
  },
  deviceMockup: {
    id: "mockup",
    type: "deviceMockup",
    titleOrUrl: "app.motionforge.ai",
  },
  cursorFlow: {
    id: "cursor",
    type: "cursorFlow",
    waypoints: [{ atMs: 0, xPct: 10, yPct: 10 }],
  },
};

const SPATIAL = {
  position: { xPct: 42.5, yPct: 61.25 },
  scale: 1.35,
  rotation: 45,
  opacity: 0.8,
  visible: true,
  locked: false,
  trackIndex: 2,
  blendMode: "screen",
} as const;

describe("universal spatial / NLE layer fields", () => {
  it("every layer kind accepts the full spatial set", () => {
    expect(Object.keys(LAYER_FIXTURES).sort()).toEqual([...LAYER_TYPES].sort());

    for (const [kind, fixture] of Object.entries(LAYER_FIXTURES)) {
      const result = validateScene({
        ...BASE,
        assets: [
          { id: "asset-1", kind: "image", src: "vault:a.png" },
          { id: "asset-2", kind: "lottie", src: "vault:b.json" },
        ],
        layers: [{ ...fixture, ...SPATIAL }],
      });
      expect(result.ok, `${kind} rejected the spatial set: ${result.ok ? "" : result.issues.join("; ")}`).toBe(
        true
      );
    }
  });

  it("a background at layers.0 accepts position — the exact reported failure", () => {
    const result = validateScene({
      ...BASE,
      layers: [{ ...LAYER_FIXTURES.background, position: { xPct: 50, yPct: 50 } }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) return;
    expect(result.issues.join(" ")).not.toContain("Unrecognized key");
  });

  it("the reported error message can no longer be produced by any layer kind", () => {
    for (const [kind, fixture] of Object.entries(LAYER_FIXTURES)) {
      const result = validateScene({ ...BASE, layers: [{ ...fixture, ...SPATIAL }] });
      if (result.ok) continue;
      expect(result.issues.join(" ")).not.toContain("Unrecognized key");
    }
  });

  it("position stays OPTIONAL on the kinds that do not require an anchor", () => {
    const result = validateScene({ ...BASE, layers: [{ ...LAYER_FIXTURES.background }] });
    expect(result.ok).toBe(true);
  });

  it("keeps `position` REQUIRED on card / imageLogo / lottie", () => {
    const result = validateScene({
      ...BASE,
      assets: [{ id: "asset-1", kind: "image", src: "vault:a.png" }],
      layers: [{ id: "logo", type: "imageLogo", assetId: "asset-1", widthPx: 200 }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an out-of-range spatial value (the schema still guards the range)", () => {
    const result = validateScene({
      ...BASE,
      layers: [{ ...LAYER_FIXTURES.background, opacity: 4 }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown blend mode", () => {
    const result = validateScene({
      ...BASE,
      layers: [{ ...LAYER_FIXTURES.background, blendMode: "darken" }],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts every declared blend mode", () => {
    for (const blendMode of ["normal", "multiply", "screen", "overlay", "plus-lighter"]) {
      const result = validateScene({
        ...BASE,
        layers: [{ ...LAYER_FIXTURES.background, blendMode }],
      });
      expect(result.ok, blendMode).toBe(true);
    }
  });

  it("rotation accepts a full multi-turn value", () => {
    const result = validateScene({
      ...BASE,
      layers: [{ ...LAYER_FIXTURES.background, rotation: 720 }],
    });
    expect(result.ok).toBe(true);
  });
});

describe("sanitizeSceneInput", () => {
  it("removes transient `_`-prefixed properties from every layer", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [{ ...LAYER_FIXTURES.background, _hidden: true, _locked: false, _ui: { x: 1 } }],
    }) as SceneSpecInput;

    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer._hidden).toBeUndefined();
    expect(layer._locked).toBeUndefined();
    expect(layer._ui).toBeUndefined();
  });

  it("heals legacy `_hidden` / `_locked` into the authored `visible` / `locked`", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [{ ...LAYER_FIXTURES.background, _hidden: true, _locked: true }],
    }) as SceneSpecInput;

    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer.visible).toBe(false);
    expect(layer.locked).toBe(true);
  });

  it("never mutates its input", () => {
    const input = {
      ...BASE,
      layers: [{ ...LAYER_FIXTURES.background, _hidden: true }],
    };
    const before = JSON.stringify(input);
    sanitizeSceneInput(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("clamps out-of-range spatial values instead of failing the save", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [{ ...LAYER_FIXTURES.background, opacity: 4, scale: 999, rotation: 99999 }],
    }) as SceneSpecInput;

    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer.opacity).toBe(1);
    expect(layer.scale).toBe(10);
    expect(layer.rotation).toBe(3600);
  });

  it("a clamped scene then validates", () => {
    const sanitized = sanitizeSceneInput({
      ...BASE,
      layers: [{ ...LAYER_FIXTURES.background, opacity: 4, position: { xPct: 900, yPct: -900 } }],
    });
    const result = validateScene(sanitized);
    expect(result.ok).toBe(true);
  });

  it("drops a malformed position so the schema reports the real problem", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [{ ...LAYER_FIXTURES.background, position: { xPct: "50", yPct: 20 } }],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer.position).toBeUndefined();
  });

  it("is idempotent", () => {
    const once = sanitizeSceneInput({
      ...BASE,
      layers: [{ ...LAYER_FIXTURES.background, _hidden: true, opacity: 4 }],
    });
    const twice = sanitizeSceneInput(once);
    expect(twice).toEqual(once);
  });

  it("keeps a genuinely unknown field so a hallucinated key still surfaces", () => {
    const out = sanitizeSceneInput({
      ...BASE,
      layers: [{ ...LAYER_FIXTURES.background, totallyMadeUp: 1 }],
    }) as SceneSpecInput;
    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer.totallyMadeUp).toBe(1);
    expect(validateScene(out).ok).toBe(false);
  });

  it("`dropUnknown` removes what the schema does not know (legacy disk healing)", () => {
    const out = sanitizeSceneInputWithReport(
      {
        ...BASE,
        legacyRootKey: true,
        layers: [{ ...LAYER_FIXTURES.background, legacyLayerKey: 1 }],
      },
      { dropUnknown: true }
    ).scene as SceneSpecInput;

    expect((out as unknown as Record<string, unknown>).legacyRootKey).toBeUndefined();
    const layer = out.layers[0] as unknown as Record<string, unknown>;
    expect(layer.legacyLayerKey).toBeUndefined();
    expect(validateScene(out).ok).toBe(true);
  });

  it("`dropUnknown` still leaves genuinely invalid VALUES alone", () => {
    // `name` has a minimum length the normalizer does not touch, so the
    // problem must survive the unknown-key removal.
    const out = sanitizeSceneInput(
      { ...BASE, name: "", layers: [{ ...LAYER_FIXTURES.background }] },
      { dropUnknown: true }
    ) as SceneSpecInput;
    expect(validateScene(out).ok).toBe(false);
  });

  it("reports what it healed and what it clamped", () => {
    const report = sanitizeSceneInputWithReport({
      ...BASE,
      layers: [{ ...LAYER_FIXTURES.background, _hidden: true, opacity: 4 }],
    });
    expect(report.healed.join(" ")).toContain("layers.0._hidden");
    expect(report.clamped.join(" ")).toContain("layers.0.opacity");
  });

  it("passes a non-object through untouched", () => {
    expect(sanitizeSceneInput(null)).toBeNull();
    expect(sanitizeSceneInput("nope")).toBe("nope");
  });
});
