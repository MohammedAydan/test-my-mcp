import { describe, expect, it } from "vitest";

import { capabilities } from "../src/capabilities.js";
import { LAYER_TYPES, validateScene, type SceneSpecInput } from "@motionforge/scene-spec";

describe("capabilities() authoring contract", () => {
  const caps = capabilities() as Record<string, unknown>;

  it("carries the structural payloads, not just registries", () => {
    expect(caps.layerFieldGuide).toBeDefined();
    expect(caps.nestedShapeNotes).toBeDefined();
    expect(caps.minimalValidScene).toBeDefined();
    expect(caps.fullShowcaseSketch).toBeDefined();
  });

  it("has a field guide entry for every layer type", () => {
    const guide = caps.layerFieldGuide as Record<string, unknown>;
    for (const layerType of LAYER_TYPES) {
      expect(guide[layerType], `missing guide for ${layerType}`).toBeDefined();
    }
  });

  it("publishes a minimalValidScene that validates against scene-spec", () => {
    const result = validateScene(caps.minimalValidScene as SceneSpecInput);
    if (!result.ok) throw new Error(`minimalValidScene invalid: ${JSON.stringify(result.issues)}`);
  });

  it("publishes a fullShowcaseSketch that validates against scene-spec", () => {
    const result = validateScene(caps.fullShowcaseSketch as SceneSpecInput);
    if (!result.ok) throw new Error(`showcase sketch invalid: ${JSON.stringify(result.issues)}`);
  });

  it("still exposes the original flat registry keys (back-compat)", () => {
    expect(caps.layerTypes).toEqual(LAYER_TYPES);
    expect(caps.presets).toHaveProperty("entrance");
    expect(caps.sfxBank).toContain("whoosh");
    expect(caps.cameraMoves).toContain("slowPushIn");
    expect(caps.backgroundVariants).toContain("meshGradient");
    expect(caps.cardVariants).toContain("glassCard");
  });

  it("explains how to recover from a rejected scene", () => {
    const notes = caps.notes as Record<string, string>;
    expect(notes.howToStart).toMatch(/minimalValidScene/);
    expect(notes.strictness).toMatch(/rejected/i);
  });
});