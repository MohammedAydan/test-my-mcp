import { describe, expect, it } from "vitest";
import { sceneSpecSchema, type SceneSpec } from "@motionforge/scene-spec";
import { planMotionSlots, type MotionSlotPlan } from "../src/motion-slots.js";
import type { BuiltScene } from "../src/scene-builder.js";
import { getSceneFrameSignature } from "../src/frame-signature.js";

function makeScene(raw: unknown): SceneSpec {
  return sceneSpecSchema.parse({
    name: "Frame Signature Test",
    assets: [],
    fonts: [],
    audio: { cues: [] },
    transitions: [],
    ...((raw ?? {}) as Record<string, unknown>),
  });
}

function createSceneBuilder(scene: SceneSpec) {
  const plans = new Map<string, MotionSlotPlan>(
    scene.layers.map((layer) => [layer.id, planMotionSlots(layer, scene.durationMs)])
  );
  const built = { plans, overlays: [] } as unknown as BuiltScene;
  return { built };
}

describe("getSceneFrameSignature", () => {
  it("returns non-null signature for static kineticText after entrance", () => {
    const scene = makeScene({
      schemaVersion: 1,
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 2000,
      layers: [
        {
          id: "bg",
          type: "background",
          variant: { variant: "solid", color: "#000000" },
          at: 0,
          direction: "ltr",
        },
        {
          id: "text",
          type: "kineticText",
          text: "Static Text",
          sizePx: 64,
          fill: "#ffffff",
          position: { xPct: 50, yPct: 50 },
          at: 0,
          duration: 2000,
          direction: "ltr",
          role: "headline",
          fontWeight: 800,
          lineHeight: 1.15,
          letterSpacingPx: 0,
          align: "center",
          animateBy: "word",
        },
      ],
    });

    const { built } = createSceneBuilder(scene);
    // At 1000ms (well after any entrance), should be static
    const sig1 = getSceneFrameSignature(scene, built, 1000);
    expect(sig1).toBe("static");

    // Same signature at different hold timestamp
    const sig2 = getSceneFrameSignature(scene, built, 1500);
    expect(sig2).toBe("static");
    expect(sig1).toBe(sig2);
  });

  it("returns null for kineticText with keyframe on xPct", () => {
    const scene = makeScene({
      schemaVersion: 1,
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 2000,
      layers: [
        {
          id: "bg",
          type: "background",
          variant: { variant: "solid", color: "#000000" },
          at: 0,
          direction: "ltr",
        },
        {
          id: "text",
          type: "kineticText",
          text: "Moving Text",
          sizePx: 64,
          fill: "#ffffff",
          position: { xPct: 50, yPct: 50 },
          at: 0,
          duration: 2000,
          direction: "ltr",
          role: "headline",
          fontWeight: 800,
          lineHeight: 1.15,
          letterSpacingPx: 0,
          align: "center",
          animateBy: "word",
          keyframes: [
            { id: "kf1", timeMs: 0, property: "xPct", value: 10, easing: "linear" },
            { id: "kf2", timeMs: 2000, property: "xPct", value: 90, easing: "linear" },
          ],
        },
      ],
    });

    const { built } = createSceneBuilder(scene);
    // Inside the keyframe span
    const sig = getSceneFrameSignature(scene, built, 1000);
    expect(sig).toBeNull();
  });

  it("returns null for scene with camera move", () => {
    const scene = makeScene({
      schemaVersion: 1,
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 2000,
      camera: {
        moves: [
          { at: 0, move: "slowPushIn", durationMs: 2000 },
        ],
      },
      layers: [
        {
          id: "bg",
          type: "background",
          variant: { variant: "solid", color: "#000000" },
          at: 0,
          direction: "ltr",
        },
        {
          id: "text",
          type: "kineticText",
          text: "Static Text",
          sizePx: 64,
          fill: "#ffffff",
          position: { xPct: 50, yPct: 50 },
          at: 0,
          duration: 2000,
          direction: "ltr",
          role: "headline",
          fontWeight: 800,
          lineHeight: 1.15,
          letterSpacingPx: 0,
          align: "center",
          animateBy: "word",
        },
      ],
    });

    const { built } = createSceneBuilder(scene);
    const sig = getSceneFrameSignature(scene, built, 1000);
    expect(sig).toBeNull();
  });

  it("returns null for particleField", () => {
    const scene = makeScene({
      schemaVersion: 1,
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 2000,
      layers: [
        {
          id: "bg",
          type: "background",
          variant: { variant: "solid", color: "#000000" },
          at: 0,
          direction: "ltr",
        },
        {
          id: "particles",
          type: "particleField",
          pattern: "float",
          count: 50,
          size: 4,
          color: "#ffffff",
          speed: 1,
          seed: 1,
          opacity: 0.75,
          at: 0,
          duration: 2000,
          direction: "ltr",
        },
      ],
    });

    const { built } = createSceneBuilder(scene);
    const sig = getSceneFrameSignature(scene, built, 1000);
    expect(sig).toBeNull();
  });

  it("returns null for cursorFlow", () => {
    const scene = makeScene({
      schemaVersion: 1,
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 2000,
      layers: [
        {
          id: "bg",
          type: "background",
          variant: { variant: "solid", color: "#000000" },
          at: 0,
          direction: "ltr",
        },
        {
          id: "cursor",
          type: "cursorFlow",
          waypoints: [
            { xPct: 10, yPct: 10, atMs: 0, action: "move" },
            { xPct: 90, yPct: 90, atMs: 2000, action: "move" },
          ],
          cursorStyle: "pointer",
          accentColor: "#38bdf8",
          cursorScale: 1.2,
          at: 0,
          duration: 2000,
          direction: "ltr",
        },
      ],
    });

    const { built } = createSceneBuilder(scene);
    const sig = getSceneFrameSignature(scene, built, 1000);
    expect(sig).toBeNull();
  });

  it("returns null when transition is active", () => {
    const scene = makeScene({
      schemaVersion: 1,
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 2000,
      transitions: [
        { kind: "wipe", at: 900, durationMs: 300, direction: "right", featherPx: 0, color: "#000000" },
      ],
      layers: [
        {
          id: "bg",
          type: "background",
          variant: { variant: "solid", color: "#000000" },
          at: 0,
          direction: "ltr",
        },
        {
          id: "layer1",
          type: "kineticText",
          text: "Layer 1",
          sizePx: 64,
          fill: "#ffffff",
          position: { xPct: 50, yPct: 50 },
          at: 0,
          duration: 1000,
          direction: "ltr",
          role: "headline",
          fontWeight: 800,
          lineHeight: 1.15,
          letterSpacingPx: 0,
          align: "center",
          animateBy: "word",
        },
        {
          id: "layer2",
          type: "kineticText",
          text: "Layer 2",
          sizePx: 64,
          fill: "#ffffff",
          position: { xPct: 50, yPct: 50 },
          at: 1000,
          duration: 1000,
          direction: "ltr",
          role: "headline",
          fontWeight: 800,
          lineHeight: 1.15,
          letterSpacingPx: 0,
          align: "center",
          animateBy: "word",
        },
      ],
    });

    const { built } = createSceneBuilder(scene);
    built.overlays = [{ kind: "wipe", at: 900, durationMs: 300, el: {} as HTMLElement }];
    // At transition midpoint (~1000ms), transition is active
    const sig = getSceneFrameSignature(scene, built, 1000);
    expect(sig).toBeNull();
  });

  it("returns null when entrance is still running", () => {
    const scene = makeScene({
      schemaVersion: 1,
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 2000,
      layers: [
        {
          id: "bg",
          type: "background",
          variant: { variant: "solid", color: "#000000" },
          at: 0,
          direction: "ltr",
        },
        {
          id: "text",
          type: "kineticText",
          text: "Entering Text",
          sizePx: 64,
          fill: "#ffffff",
          position: { xPct: 50, yPct: 50 },
          at: 0,
          duration: 2000,
          direction: "ltr",
          role: "headline",
          fontWeight: 800,
          lineHeight: 1.15,
          letterSpacingPx: 0,
          align: "center",
          animateBy: "word",
          entrance: { name: "springPop", durationMs: 1000 },
        },
      ],
    });

    const { built } = createSceneBuilder(scene);
    // At 500ms, entrance is still running
    const sig = getSceneFrameSignature(scene, built, 500);
    expect(sig).toBeNull();
  });

  it("returns null when layer becomes visible within next frame", () => {
    const scene = makeScene({
      schemaVersion: 1,
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 2000,
      layers: [
        {
          id: "bg",
          type: "background",
          variant: { variant: "solid", color: "#000000" },
          at: 0,
          direction: "ltr",
        },
        {
          id: "text",
          type: "kineticText",
          text: "Late Text",
          sizePx: 64,
          fill: "#ffffff",
          position: { xPct: 50, yPct: 50 },
          at: 1000,
          duration: 1000,
          direction: "ltr",
          role: "headline",
          fontWeight: 800,
          lineHeight: 1.15,
          letterSpacingPx: 0,
          align: "center",
          animateBy: "word",
        },
      ],
    });

    const { built } = createSceneBuilder(scene);
    // At 990ms, next frame (at 60fps = ~1006ms) the layer becomes visible
    const sig = getSceneFrameSignature(scene, built, 990);
    expect(sig).toBeNull();
  });

  it("returns null for background with non-solid variant", () => {
    const scene = makeScene({
      schemaVersion: 1,
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 2000,
      layers: [
        {
          id: "bg",
          type: "background",
          variant: { variant: "meshGradient", base: "#000000", blobs: [
            { color: "#102030", xPct: 30, yPct: 30, radiusPct: 30, drift: 0 },
            { color: "#203040", xPct: 70, yPct: 70, radiusPct: 30, drift: 0 },
          ] },
          at: 0,
          direction: "ltr",
        },
      ],
    });

    const { built } = createSceneBuilder(scene);
    const sig = getSceneFrameSignature(scene, built, 1000);
    expect(sig).toBeNull();
  });
});
