import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEngineCore, type EngineCore } from "../src/index.js";
import { SceneStore } from "../src/scene-store.js";

/**
 * Save-path hardening.
 *
 * The Studio is a direct-manipulation editor. It writes spatial and NLE
 * properties onto whichever layer the user grabbed — including the
 * `background` at `layers.0`. Before the contract was widened, every
 * auto-save failed with:
 *
 *     invalid scene: layers.0: Unrecognized key(s) in object: 'position'
 *
 * These tests pin the fix at the engine boundary, which is the last line of
 * defence for every client (the Studio, the MCP server, the CLI).
 */

let workdir: string;
let engine: EngineCore;

const BASE = {
  schemaVersion: 1 as const,
  name: "Save Path Fixture",
  canvas: { shape: "16:9" as const, scale: 1080 as const },
  durationMs: 4000,
};

/** The exact payload the Studio produces after a drag on the background. */
function uiDirtyScene() {
  return {
    ...BASE,
    id: "ui-dirty-scene",
    layers: [
      {
        id: "bg",
        type: "background" as const,
        variant: { variant: "solid" as const, color: "#05070d" },
        position: { xPct: 50, yPct: 50 },
        scale: 1.2,
        rotation: 15,
        opacity: 0.8,
        visible: true,
        locked: false,
        trackIndex: 0,
        blendMode: "normal" as const,
        // legacy UI bookkeeping the Studio used to keep
        _hidden: false,
        _locked: false,
      },
      {
        id: "title",
        type: "kineticText" as const,
        text: "Hello",
        sizePx: 80,
        position: { xPct: 50, yPct: 45 },
      },
    ],
  };
}

beforeAll(async () => {
  workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "mf-save-path-"));
  engine = await createEngineCore({
    dataDir: path.join(workdir, "data"),
    storageDir: path.join(workdir, "scenes"),
    vaultDir: path.join(workdir, "vault"),
    enableWatcher: false,
  });
});

afterAll(async () => {
  await engine?.dispose();
  await fsp.rm(workdir, { recursive: true, force: true });
});

describe("engine save path", () => {
  it("accepts a UI-dirty scene (the exact reported failure)", async () => {
    const res = await engine.saveScene(uiDirtyScene());
    expect(res.id).toBe("ui-dirty-scene");
    expect(res.status).toBe("created");
  });

  it("strips transient UI bookkeeping before the scene reaches the store", async () => {
    await engine.saveScene(uiDirtyScene());
    const stored = await engine.getScene("ui-dirty-scene");
    expect(stored).not.toBeNull();
    const layer = stored!.layers[0] as unknown as Record<string, unknown>;
    expect(layer._hidden).toBeUndefined();
    expect(layer._locked).toBeUndefined();
  });

  it("keeps the authored spatial values", async () => {
    await engine.saveScene(uiDirtyScene());
    const stored = await engine.getScene("ui-dirty-scene");
    const layer = stored!.layers[0] as unknown as Record<string, unknown>;
    expect(layer.position).toEqual({ xPct: 50, yPct: 50 });
    expect(layer.scale).toBe(1.2);
    expect(layer.opacity).toBe(0.8);
    expect(layer.trackIndex).toBe(0);
  });

  it("persists the sanitized scene to disk", async () => {
    await engine.saveScene(uiDirtyScene());
    const file = path.join(workdir, "scenes", "ui-dirty-scene.json");
    const raw = await fsp.readFile(file, "utf8");
    expect(raw).not.toContain("_hidden");
    expect(raw).not.toContain("_locked");
    expect(raw).toContain("position");
  });

  it("still rejects a scene whose VALUES are genuinely illegal", async () => {
    await expect(
      engine.saveScene({ ...BASE, id: "bad-scene", name: "", durationMs: 4000, layers: [] })
    ).rejects.toThrow(/invalid scene/);
  });

  it("still rejects a hallucinated top-level field", async () => {
    await expect(
      engine.saveScene({ ...BASE, id: "hallucinated", totallyMadeUp: true, layers: [] })
    ).rejects.toThrow(/invalid scene/);
  });

  it("clamps an out-of-range spatial value instead of failing the save", async () => {
    const scene = uiDirtyScene();
    (scene.layers[0] as unknown as Record<string, unknown>).opacity = 4;
    const res = await engine.saveScene(scene);
    const stored = await engine.getScene(res.id);
    const layer = stored!.layers[0] as unknown as Record<string, unknown>;
    expect(layer.opacity).toBe(1);
  });
});

describe("legacy scene healing on load", () => {
  it("loads a scene file that carries retired keys", async () => {
    const scenesDir = path.join(workdir, "scenes");
    const legacy = {
      ...BASE,
      // a DISTINCT name: the store de-duplicates by name, and this fixture is
      // about legacy healing — not about being the newest of a group
      name: "Legacy Fixture",
      id: "legacy-scene",
      layers: [
        {
          id: "bg",
          type: "background",
          variant: { variant: "solid", color: "#05070d" },
          _hidden: true,
          _locked: true,
          someRetiredKey: 42,
        },
      ],
    };
    await fsp.writeFile(path.join(scenesDir, "legacy-scene.json"), JSON.stringify(legacy), "utf8");

    const store = new SceneStore({ dataDir: path.join(workdir, "data"), scenesDir });
    const result = await store.load();
    expect(result.issues.filter((i) => i.file === "legacy-scene.json")).toHaveLength(0);

    const hydrated = store.get("legacy-scene");
    expect(hydrated).toBeDefined();
    const layer = hydrated!.scene.layers[0] as unknown as Record<string, unknown>;
    // the retired UI markers became real authored fields
    expect(layer.visible).toBe(false);
    expect(layer.locked).toBe(true);
    // the retired unknown key is gone
    expect(layer.someRetiredKey).toBeUndefined();
  });
});
