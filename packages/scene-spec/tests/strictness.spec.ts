import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  sceneShapeSchema,
  sceneSpecSchema,
  validateScene,
  type SceneSpecInput,
} from "../src/index.js";

/**
 * Top-level strictness (report 2 / C5-F5).
 *
 * The scene schema is `strict()`, so an unknown TOP-LEVEL key must be rejected
 * with the same surgical path error a nested key gets. A gap here is silently
 * destructive: a typo like `duratioMs` would be dropped, the scene would render
 * with the default duration, and the author would never learn why.
 */
const VALID: SceneSpecInput = {
  schemaVersion: 1,
  name: "Strictness Fixture",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 4000,
  layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#05070d" } }],
};

describe("top-level schema strictness", () => {
  it("accepts a valid scene", () => {
    const result = validateScene(VALID);
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown top-level key with a (root) path error", () => {
    const result = validateScene({ ...VALID, wrongKey: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/^\(root\): Unrecognized key/);
    expect(result.issues[0]).toContain("wrongKey");
  });

  it("rejects a misspelled top-level field (duratioMs) just as hard", () => {
    const result = validateScene({ ...VALID, duratioMs: 8000 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toContain("duratioMs");
  });

  it("treats a nested unknown key with the same strictness", () => {
    const result = validateScene({
      ...VALID,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" }, preset: "springPop" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatch(/^layers\.0/);
    expect(result.issues[0]).toContain("preset");
  });

  it("the advertised MCP input schema is strict at the top level too", () => {
    // `sceneShapeSchema` is what the MCP tool advertises; `.extend()` must not
    // silently relax `strict()`
    const extended = sceneShapeSchema.extend({ projectPath: z.string().optional() });
    const result = extended.safeParse({ ...VALID, wrongKey: true });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual([]);
    expect(result.error.issues[0]?.message).toContain("wrongKey");
  });

  it("the full validator is strict at the top level", () => {
    const result = sceneSpecSchema.safeParse({ ...VALID, wrongKey: true });
    expect(result.success).toBe(false);
  });

  it("still accepts the optional top-level fields", () => {
    const result = validateScene({
      ...VALID,
      id: "scene-01",
      assets: [],
      fonts: [],
      camera: {},
      transitions: [],
      audio: {},
    });
    expect(result.ok).toBe(true);
  });
});
