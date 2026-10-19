import { describe, expect, it } from "vitest";
import { validateScene, type SceneSpecInput } from "../src/index.js";

const BASE_SCENE: SceneSpecInput = {
  schemaVersion: 1,
  name: "Track Lanes Test Scene",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 10000,
  layers: [
    {
      id: "bg",
      type: "background",
      at: 0,
      duration: 10000,
      variant: { variant: "solid", color: "#111111" },
    },
    {
      id: "clip-1",
      type: "kineticText",
      at: 1000,
      duration: 3000,
      text: "First Clip",
      sizePx: 64,
    },
  ],
};

describe("TrackLane & trackIndex Schema Support (BE-001)", () => {
  it("backward compatibility: existing scene without trackIndex or trackLanes parses cleanly", () => {
    const result = validateScene(BASE_SCENE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.trackLanes).toBeUndefined();
    expect(result.scene.layers[0]!.trackIndex).toBeUndefined();
    expect(result.scene.layers[1]!.trackIndex).toBeUndefined();
  });

  it("allows non-overlapping sequential clips to share the same trackIndex", () => {
    const scene: SceneSpecInput = {
      ...BASE_SCENE,
      layers: [
        {
          id: "bg",
          type: "background",
          at: 0,
          duration: 10000,
          variant: { variant: "solid", color: "#111111" },
        },
        {
          id: "clip-1",
          type: "kineticText",
          at: 0,
          duration: 3000,
          trackIndex: 1,
          text: "Clip 1 (0-3s)",
          sizePx: 64,
        },
        {
          id: "clip-2",
          type: "kineticText",
          at: 4000,
          duration: 3000,
          trackIndex: 1,
          text: "Clip 2 (4-7s)",
          sizePx: 64,
        },
      ],
    };

    const result = validateScene(scene);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.layers[1]!.trackIndex).toBe(1);
    expect(result.scene.layers[2]!.trackIndex).toBe(1);
  });

  it("allows abutting cuts (clip B starts exactly when clip A ends)", () => {
    const scene: SceneSpecInput = {
      ...BASE_SCENE,
      layers: [
        {
          id: "bg",
          type: "background",
          at: 0,
          duration: 10000,
          variant: { variant: "solid", color: "#111111" },
        },
        {
          id: "clip-1",
          type: "kineticText",
          at: 1000,
          duration: 2000, // 1000 - 3000ms
          trackIndex: 2,
          text: "Clip 1",
          sizePx: 64,
        },
        {
          id: "clip-2",
          type: "kineticText",
          at: 3000, // starts exactly at 3000ms
          duration: 2000,
          trackIndex: 2,
          text: "Clip 2",
          sizePx: 64,
        },
      ],
    };

    const result = validateScene(scene);
    expect(result.ok).toBe(true);
  });

  it("supports trackLane as an authoring alias for trackIndex", () => {
    const scene: SceneSpecInput = {
      ...BASE_SCENE,
      layers: [
        {
          id: "bg",
          type: "background",
          at: 0,
          duration: 10000,
          variant: { variant: "solid", color: "#111111" },
        },
        {
          id: "clip-1",
          type: "kineticText",
          at: 500,
          duration: 2000,
          trackLane: 3,
          text: "Clip 1",
          sizePx: 64,
        },
        {
          id: "clip-2",
          type: "kineticText",
          at: 3000,
          duration: 2000,
          trackLane: 3,
          text: "Clip 2",
          sizePx: 64,
        },
      ],
    };

    const result = validateScene(scene);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.layers[1]!.trackLane).toBe(3);
  });

  it("rejects overlapping clips assigned to the same trackIndex", () => {
    const scene: SceneSpecInput = {
      ...BASE_SCENE,
      layers: [
        {
          id: "bg",
          type: "background",
          at: 0,
          duration: 10000,
          variant: { variant: "solid", color: "#111111" },
        },
        {
          id: "clip-1",
          type: "kineticText",
          at: 1000,
          duration: 4000, // 1000 - 5000ms
          trackIndex: 1,
          text: "Clip 1",
          sizePx: 64,
        },
        {
          id: "clip-2",
          type: "kineticText",
          at: 3000, // 3000 - 6000ms (overlaps 3000-5000ms)
          duration: 3000,
          trackIndex: 1,
          text: "Clip 2",
          sizePx: 64,
        },
      ],
    };

    const result = validateScene(scene);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.includes("trackIndex") && i.includes("overlaps layer \"clip-1\""))).toBe(true);
  });

  it("rejects overlapping clips when layer has no duration (extends to scene end)", () => {
    const scene: SceneSpecInput = {
      ...BASE_SCENE,
      layers: [
        {
          id: "bg",
          type: "background",
          at: 0,
          duration: 10000,
          variant: { variant: "solid", color: "#111111" },
        },
        {
          id: "clip-1",
          type: "kineticText",
          at: 1000,
          // no duration specified => extends to 10000ms
          trackIndex: 1,
          text: "Clip 1",
          sizePx: 64,
        },
        {
          id: "clip-2",
          type: "kineticText",
          at: 4000,
          duration: 2000,
          trackIndex: 1,
          text: "Clip 2",
          sizePx: 64,
        },
      ],
    };

    const result = validateScene(scene);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.includes("trackIndex") && i.includes("overlaps layer \"clip-1\""))).toBe(true);
  });

  it("rejects invalid trackIndex values (negative, float, out of range, string)", () => {
    // Negative
    expect(
      validateScene({
        ...BASE_SCENE,
        layers: [
          BASE_SCENE.layers[0],
          { ...BASE_SCENE.layers[1], trackIndex: -1 },
        ],
      }).ok
    ).toBe(false);

    // Float
    expect(
      validateScene({
        ...BASE_SCENE,
        layers: [
          BASE_SCENE.layers[0],
          { ...BASE_SCENE.layers[1], trackIndex: 1.5 },
        ],
      }).ok
    ).toBe(false);

    // Out of bounds (>99)
    expect(
      validateScene({
        ...BASE_SCENE,
        layers: [
          BASE_SCENE.layers[0],
          { ...BASE_SCENE.layers[1], trackIndex: 100 },
        ],
      }).ok
    ).toBe(false);

    // Non-number
    expect(
      validateScene({
        ...BASE_SCENE,
        layers: [
          BASE_SCENE.layers[0],
          { ...BASE_SCENE.layers[1], trackIndex: "track-1" as unknown as number },
        ],
      }).ok
    ).toBe(false);
  });

  it("validates top-level trackLanes definitions with kinds, locked, and muted flags", () => {
    const scene: SceneSpecInput = {
      ...BASE_SCENE,
      trackLanes: [
        { id: "lane-bg", name: "Background Lane", kind: "video", locked: true },
        { id: "lane-overlay", name: "Text Overlays", kind: "video", collapsed: false },
        { id: "lane-audio", name: "SFX Bed", kind: "audio", muted: true },
      ],
    };

    const result = validateScene(scene);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.trackLanes).toBeDefined();
    expect(result.scene.trackLanes).toHaveLength(3);
    const lanes = result.scene.trackLanes!;
    expect(lanes[0]!.locked).toBe(true);
    expect(lanes[2]!.kind).toBe("audio");
    expect(lanes[2]!.muted).toBe(true);
  });

  it("rejects duplicate trackLane IDs", () => {
    const scene: SceneSpecInput = {
      ...BASE_SCENE,
      trackLanes: [
        { id: "lane-1", name: "Lane A", kind: "video" },
        { id: "lane-1", name: "Lane B with duplicate id", kind: "video" },
      ],
    };

    const result = validateScene(scene);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.includes("duplicate trackLane id"))).toBe(true);
  });
});
