import { describe, expect, it } from "vitest";
import {
  LAYOUT_SLOTS,
  LAYOUT_SLOT_BOXES,
  MINIMAL_VALID_SCENE,
  resolveLayoutSlot,
  sanitizeSceneInput,
  sanitizeSceneInputWithReport,
  sceneSpecSchema,
  type SceneSpecInput,
} from "@motionforge/scene-spec";

describe("Smart Layout Slot Positioning (layoutSlot)", () => {
  it("1. all 12 slots exist with finite values inside 0..100 (heightPct/widthPct > 0)", () => {
    expect(LAYOUT_SLOTS).toHaveLength(12);
    for (const slot of LAYOUT_SLOTS) {
      const box = LAYOUT_SLOT_BOXES[slot];
      expect(box, `missing box definition for ${slot}`).toBeDefined();

      expect(Number.isFinite(box.xPct)).toBe(true);
      expect(box.xPct).toBeGreaterThanOrEqual(0);
      expect(box.xPct).toBeLessThanOrEqual(100);

      expect(Number.isFinite(box.yPct)).toBe(true);
      expect(box.yPct).toBeGreaterThanOrEqual(0);
      expect(box.yPct).toBeLessThanOrEqual(100);

      expect(Number.isFinite(box.widthPct)).toBe(true);
      expect(box.widthPct).toBeGreaterThan(0);
      expect(box.widthPct).toBeLessThanOrEqual(100);

      expect(Number.isFinite(box.heightPct)).toBe(true);
      expect(box.heightPct).toBeGreaterThan(0);
      expect(box.heightPct).toBeLessThanOrEqual(100);
    }
  });

  it("2. explicit position wins over the slot (both axes independently)", () => {
    // resolveLayoutSlot helper: explicit xPct wins, yPct fills from slot
    const resX = resolveLayoutSlot({
      layoutSlot: "topHeader",
      position: { xPct: 22 },
    });
    expect(resX.position.xPct).toBe(22);
    expect(resX.position.yPct).toBe(LAYOUT_SLOT_BOXES.topHeader.yPct);
    expect(resX.size.widthPct).toBe(LAYOUT_SLOT_BOXES.topHeader.widthPct);
    expect(resX.size.heightPct).toBe(LAYOUT_SLOT_BOXES.topHeader.heightPct);
    expect(resX.used).toBe(true);

    // resolveLayoutSlot helper: explicit yPct wins, xPct fills from slot
    const resY = resolveLayoutSlot({
      layoutSlot: "topHeader",
      position: { yPct: 41 },
    });
    expect(resY.position.xPct).toBe(LAYOUT_SLOT_BOXES.topHeader.xPct);
    expect(resY.position.yPct).toBe(41);
    expect(resY.used).toBe(true);

    // Sanitizer check for independent axes
    const sceneX: Record<string, unknown> = {
      ...MINIMAL_VALID_SCENE,
      layers: [
        {
          id: "t1",
          type: "kineticText",
          text: "Header",
          sizePx: 80,
          layoutSlot: "topHeader",
          position: { xPct: 22 },
        },
      ],
    };
    const repX = sanitizeSceneInputWithReport(sceneX);
    const layerOutX = (repX.scene as { layers: Array<{ position: { xPct: number; yPct: number } }> }).layers[0]!;
    expect(layerOutX.position.xPct).toBe(22);
    expect(layerOutX.position.yPct).toBe(LAYOUT_SLOT_BOXES.topHeader.yPct);
    expect(repX.resolved).toContain("layers.0.position.yPct");
    expect(repX.resolved).not.toContain("layers.0.position.xPct");

    const sceneY: Record<string, unknown> = {
      ...MINIMAL_VALID_SCENE,
      layers: [
        {
          id: "t2",
          type: "kineticText",
          text: "Header",
          sizePx: 80,
          layoutSlot: "topHeader",
          position: { yPct: 41 },
        },
      ],
    };
    const repY = sanitizeSceneInputWithReport(sceneY);
    const layerOutY = (repY.scene as { layers: Array<{ position: { xPct: number; yPct: number } }> }).layers[0]!;
    expect(layerOutY.position.xPct).toBe(LAYOUT_SLOT_BOXES.topHeader.xPct);
    expect(layerOutY.position.yPct).toBe(41);
    expect(repY.resolved).toContain("layers.0.position.xPct");
    expect(repY.resolved).not.toContain("layers.0.position.yPct");
  });

  it("3. sanitizeSceneInputWithReport() fills missing position and size from the slot and reports the paths in resolved; does not fill when explicit values exist", () => {
    // Slot with no position and no size -> all 4 filled
    const sceneMissing: Record<string, unknown> = {
      ...MINIMAL_VALID_SCENE,
      layers: [
        {
          id: "t1",
          type: "kineticText",
          text: "Header",
          sizePx: 80,
          layoutSlot: "topHeader",
        },
      ],
    };
    const repMissing = sanitizeSceneInputWithReport(sceneMissing);
    expect(repMissing.resolved).toEqual([
      "layers.0.position.xPct",
      "layers.0.position.yPct",
      "layers.0.size.widthPct",
      "layers.0.size.heightPct",
    ]);
    const lMissing = (repMissing.scene as {
      layers: Array<{
        position: { xPct: number; yPct: number };
        size: { widthPct: number; heightPct: number };
      }>;
    }).layers[0]!;
    expect(lMissing.position).toEqual({
      xPct: LAYOUT_SLOT_BOXES.topHeader.xPct,
      yPct: LAYOUT_SLOT_BOXES.topHeader.yPct,
    });
    expect(lMissing.size).toEqual({
      widthPct: LAYOUT_SLOT_BOXES.topHeader.widthPct,
      heightPct: LAYOUT_SLOT_BOXES.topHeader.heightPct,
    });

    // Explicit position and size -> none filled
    const sceneExplicit: Record<string, unknown> = {
      ...MINIMAL_VALID_SCENE,
      layers: [
        {
          id: "t2",
          type: "kineticText",
          text: "Header",
          sizePx: 80,
          layoutSlot: "topHeader",
          position: { xPct: 35, yPct: 45 },
          size: { widthPct: 60, heightPct: 20 },
        },
      ],
    };
    const repExplicit = sanitizeSceneInputWithReport(sceneExplicit);
    expect(repExplicit.resolved).toEqual([]);
    const lExplicit = (repExplicit.scene as {
      layers: Array<{
        position: { xPct: number; yPct: number };
        size: { widthPct: number; heightPct: number };
      }>;
    }).layers[0]!;
    expect(lExplicit.position).toEqual({ xPct: 35, yPct: 45 });
    expect(lExplicit.size).toEqual({ widthPct: 60, heightPct: 20 });
  });

  it("4. bounding boxes: topHeader + topSubhead + bottomCenterCta have ZERO pairwise overlap", () => {
    // Note: The zero-overlap test intentionally covers topHeader + topSubhead + bottomCenterCta.
    // centerStage is a container slot that intentionally spans the middle.
    const scene: Record<string, unknown> = {
      ...MINIMAL_VALID_SCENE,
      layers: [
        {
          id: "header",
          type: "kineticText",
          text: "Main Headline",
          sizePx: 80,
          layoutSlot: "topHeader",
        },
        {
          id: "subhead",
          type: "kineticText",
          text: "Secondary Subtitle",
          sizePx: 40,
          layoutSlot: "topSubhead",
        },
        {
          id: "cta",
          type: "cta",
          label: "Get Started",
          layoutSlot: "bottomCenterCta",
        },
      ],
    };

    const sanitized = sanitizeSceneInput(scene) as {
      layers: Array<{
        position: { xPct: number; yPct: number };
        size: { widthPct: number; heightPct: number };
      }>;
    };
    const computeAABB = (layer: {
      position: { xPct: number; yPct: number };
      size: { widthPct: number; heightPct: number };
    }) => {
      const x = layer.position.xPct;
      const y = layer.position.yPct;
      const w = layer.size.widthPct;
      const h = layer.size.heightPct;
      return {
        left: x - w / 2,
        right: x + w / 2,
        top: y - h / 2,
        bottom: y + h / 2,
      };
    };

    const boxHeader = computeAABB(sanitized.layers[0]!);
    const boxSubhead = computeAABB(sanitized.layers[1]!);
    const boxCta = computeAABB(sanitized.layers[2]!);

    const doesOverlap = (
      b1: { left: number; right: number; top: number; bottom: number },
      b2: { left: number; right: number; top: number; bottom: number }
    ) => {
      const xOverlap = Math.max(0, Math.min(b1.right, b2.right) - Math.max(b1.left, b2.left));
      const yOverlap = Math.max(0, Math.min(b1.bottom, b2.bottom) - Math.max(b1.top, b2.top));
      return xOverlap > 0 && yOverlap > 0;
    };

    expect(doesOverlap(boxHeader, boxSubhead)).toBe(false);
    expect(doesOverlap(boxHeader, boxCta)).toBe(false);
    expect(doesOverlap(boxSubhead, boxCta)).toBe(false);
  });

  it("5. centerStage is a container slot contained inside the 4%..96% safe margin and contains the scene centre point (50, 50)", () => {
    // centerStage (y 56, h 58 -> 27..85) intentionally overlaps topSubhead (24..34)
    // and bottomCenterCta (78..90) as it is a central container slot.
    const box = LAYOUT_SLOT_BOXES.centerStage;
    const left = box.xPct - box.widthPct / 2;
    const right = box.xPct + box.widthPct / 2;
    const top = box.yPct - box.heightPct / 2;
    const bottom = box.yPct + box.heightPct / 2;

    // Inside 4%..96% safe margin
    expect(left).toBeGreaterThanOrEqual(4);
    expect(right).toBeLessThanOrEqual(96);
    expect(top).toBeGreaterThanOrEqual(4);
    expect(bottom).toBeLessThanOrEqual(96);

    // Contains center (50, 50)
    expect(left).toBeLessThanOrEqual(50);
    expect(right).toBeGreaterThanOrEqual(50);
    expect(top).toBeLessThanOrEqual(50);
    expect(bottom).toBeGreaterThanOrEqual(50);
  });

  it("6. a layer without layoutSlot is untouched (byte-identical sanitize output)", () => {
    const untouchedScene: SceneSpecInput = {
      ...MINIMAL_VALID_SCENE,
      layers: [
        {
          id: "bg",
          type: "background",
          variant: { variant: "solid", color: "#111827" },
        },
        {
          id: "title",
          type: "kineticText",
          text: "No slot",
          sizePx: 80,
          position: { xPct: 50, yPct: 40 },
          size: { widthPct: 80, heightPct: 20 },
        },
      ],
    };

    const out = sanitizeSceneInput(untouchedScene);
    expect(JSON.stringify(out)).toBe(JSON.stringify(untouchedScene));
  });

  it("7. an unknown slot name is rejected by sceneSpecSchema", () => {
    const sceneWithUnknownSlot = {
      ...MINIMAL_VALID_SCENE,
      layers: [
        {
          id: "title",
          type: "kineticText",
          text: "Unknown Slot",
          sizePx: 80,
          layoutSlot: "completelyInvalidSlotName",
        },
      ],
    };
    const parsed = sceneSpecSchema.safeParse(sceneWithUnknownSlot);
    expect(parsed.success).toBe(false);
  });
});
