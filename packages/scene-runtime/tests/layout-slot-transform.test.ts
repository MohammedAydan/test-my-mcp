// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { resolveTransform, type SceneLayer } from "../src/transform.js";

describe("layout-slot runtime transform resolution", () => {
  it("1. a layer with layoutSlot: 'topHeader' and no position resolves to x=50, y=16", () => {
    const layer = {
      id: "l1",
      type: "kineticText",
      text: "Header text",
      layoutSlot: "topHeader",
    } as SceneLayer;

    const t = resolveTransform(layer, 0);
    expect(t.xPct).toBe(50);
    expect(t.yPct).toBe(16);
    expect(t.widthPct).toBe(82);
    expect(t.heightPct).toBe(14);
  });

  it("2. an explicit position.xPct still wins", () => {
    const layer = {
      id: "l2",
      type: "kineticText",
      text: "Header text",
      layoutSlot: "topHeader",
      position: { xPct: 24 },
    } as SceneLayer;

    const t = resolveTransform(layer, 0);
    expect(t.xPct).toBe(24);
    expect(t.yPct).toBe(16);
  });

  it("3. a keyframe on xPct still wins over the slot", () => {
    const layer = {
      id: "l3",
      type: "kineticText",
      text: "Header text",
      layoutSlot: "topHeader",
      position: { xPct: 24 },
      keyframes: [
        {
          id: "k1",
          property: "xPct",
          timeMs: 0,
          value: 85,
        },
      ],
    } as SceneLayer;

    const t = resolveTransform(layer, 0);
    expect(t.xPct).toBe(85);
    expect(t.yPct).toBe(16);
  });
});
