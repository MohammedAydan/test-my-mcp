import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { enginePaths } from "../src/config.js";
import { buildAudioGraph, profileFor } from "../src/encoder.js";
import { ensureSfxBank, sfxFilePath, SFX_BANK } from "../src/sfx-bank.js";
import { resolveAssetSource } from "../src/vault.js";
import { parseScene, type SceneSpecInput } from "@motionforge/scene-spec";

const sceneInput: SceneSpecInput = {
  schemaVersion: 1,
  name: "test",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 6000,
  layers: [
    {
      id: "a",
      type: "background",
      at: 0,
      variant: { variant: "solid", color: "#000000" },
      sfx: [{ sfx: "riser", offsetMs: 100 }],
    },
    {
      id: "b",
      type: "background",
      at: 2000,
      duration: 2000,
      variant: { variant: "solid", color: "#000" },
      sfx: [{ sfx: "click", offsetMs: 0, gain: 0.5 }],
    },
  ],
  audio: { cues: [{ at: 250, sfx: "whoosh" }, { at: 4000, sfx: "subImpact", gain: 1.4, pan: -0.5 }] },
};

describe("buildAudioGraph", () => {
  it("merges absolute + layer-relative cues, sorted by time", async () => {
    const paths = enginePaths();
    await ensureSfxBank(paths); // cue source resolution requires bank files
    const graph = buildAudioGraph(parseScene(sceneInput), paths, 6.0);
    expect(graph.outLabel).toBe("aout");
    expect(graph.filterComplex).toContain("amix=inputs=4");
    // sorted by `at`: 100 (layer a @0 +100) < 250 < 2000 (layer b) < 4000
    const i100 = graph.filterComplex.indexOf("adelay=100:");
    const i250 = graph.filterComplex.indexOf("adelay=250:");
    const i2000 = graph.filterComplex.indexOf("adelay=2000:");
    const i4000 = graph.filterComplex.indexOf("adelay=4000:");
    expect(i100).toBeGreaterThanOrEqual(0);
    expect(i100).toBeLessThan(i250);
    expect(i250).toBeLessThan(i2000);
    expect(i2000).toBeLessThan(i4000);
    expect(graph.filterComplex).toContain("volume=1.4");
    expect(graph.filterComplex).toContain("volume=0.5");
  });

  it("returns null output when the scene has no audio at all", () => {
    const silent: SceneSpecInput = {
      ...sceneInput,
      layers: [{ id: "a", type: "background", variant: { variant: "solid", color: "#000000" } }],
      audio: { cues: [] },
    };
    const graph = buildAudioGraph(parseScene(silent), enginePaths(), 6.0);
    expect(graph.outLabel).toBeNull();
    expect(graph.inputArgs).toEqual([]);
  });
});

describe("profileFor", () => {
  it("previews at 360p/12 with fast JPEG quality 85", () => {
    const p = profileFor("preview", parseScene({ ...sceneInput, canvas: { shape: "16:9", scale: 1080 } }));
    expect(p.fps).toBe(12);
    expect([p.outWidth, p.outHeight]).toEqual([640, 360]);
    expect(p.jpegQuality).toBe(85);
  });

  it("drafts at 720p/30 with fast JPEG quality 94 regardless of canvas scale", () => {
    const p = profileFor("draft", parseScene({ ...sceneInput, canvas: { shape: "16:9", scale: 1080 } }));
    expect(p.fps).toBe(30);
    expect([p.outWidth, p.outHeight]).toEqual([1280, 720]);
    expect(p.jpegQuality).toBe(94);
  });

  it("produces the full canvas at 60 fps in production with crisp quality 98", () => {
    const p = profileFor("production", parseScene({ ...sceneInput, canvas: { shape: "16:9", scale: 1080 } }));
    expect(p.fps).toBe(60);
    expect([p.outWidth, p.outHeight]).toEqual([1920, 1080]);
    expect(p.jpegQuality).toBe(98);
  });
});

describe("sfx bank", () => {
  it("synthesizes every bank entry into a tmp dir", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "mf-sfx-"));
    const paths = { ...enginePaths(), sfxDir: tmp };
    await ensureSfxBank(paths);
    for (const sfx of SFX_BANK) {
      const stat = await fsp.stat(sfxFilePath(paths, sfx.name));
      expect(stat.size).toBeGreaterThan(500);
    }
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("resolves vault sfx sources", async () => {
    const paths = enginePaths();
    await ensureSfxBank(paths);
    const file = resolveAssetSource(paths, "vault:_sfx/shimmer.ogg");
    expect(file).toContain("_sfx");
  });
});
