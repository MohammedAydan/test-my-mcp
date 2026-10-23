import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SFX_NAMES, type SceneSpecInput } from "@motionforge/scene-spec";
import { resolveEnginePaths } from "../src/config.js";
import { EngineCore } from "../src/engine-core.js";
import {
  ensureSfxBank,
  missingSfxFiles,
  SFX_BANK,
  sfxFilePath,
} from "../src/sfx-bank.js";

describe("audio choreography and SFX bank", () => {
  let workdir: string;
  let core: EngineCore;

  beforeAll(async () => {
    workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "mf-audio-choreography-"));
    const paths = resolveEnginePaths({ dataDir: workdir });
    core = new EngineCore(
      { port: 4001, maxRenderWorkers: 1, paths },
      paths,
      { enableWatcher: false }
    );
    await core.init();
  });

  afterAll(async () => {
    if (core) {
      await core.dispose();
    }
    await fsp.rm(workdir, { recursive: true, force: true });
  });

  // 1. ensureSfxBank on a temp EnginePaths produces all 14 files, each > 1 KB, and a second run is idempotent (mtime unchanged)
  it("ensureSfxBank produces all 14 files (>1 KB) and is idempotent", async () => {
    const sfxTmp = await fsp.mkdtemp(path.join(os.tmpdir(), "mf-sfx-temp-"));
    try {
      const paths = resolveEnginePaths({ dataDir: sfxTmp });
      expect(SFX_BANK).toHaveLength(14);
      expect(missingSfxFiles(paths)).toHaveLength(14);

      await ensureSfxBank(paths);
      expect(missingSfxFiles(paths)).toHaveLength(0);

      const mtimesBefore: number[] = [];
      for (const sfx of SFX_BANK) {
        const filePath = sfxFilePath(paths, sfx.name);
        expect(fs.existsSync(filePath), `file ${sfx.name}.ogg must exist`).toBe(true);
        const stat = await fsp.stat(filePath);
        expect(stat.size, `${sfx.name}.ogg size must be > 1 KB`).toBeGreaterThan(1024);
        mtimesBefore.push(stat.mtimeMs);
      }

      // Second run is idempotent (mtime unchanged)
      await ensureSfxBank(paths);
      for (let i = 0; i < SFX_BANK.length; i++) {
        const sfx = SFX_BANK[i]!;
        const stat = await fsp.stat(sfxFilePath(paths, sfx.name));
        expect(stat.mtimeMs).toBe(mtimesBefore[i]);
      }
    } finally {
      await fsp.rm(sfxTmp, { recursive: true, force: true });
    }
  }, 45000);

  // 2. Choreography on a scene containing: kineticText at 0, card at 800, codeBlock at 1600,
  //    metricTicker at 2400, cta at 3200, cursorFlow with clicks at 500 and 1200, and durationMs 5000.
  //    Assert the exact cue set: bassDrop at 0 (0.55), shimmer at 0 (0.30), whoosh at 0 (0.65),
  //    softSwoosh at 800 (0.6), typingTick at 1800 (0.55), counterTick at 2550 (0.5), notificationChime at 3300 (0.65),
  //    subImpact at 3300 (0.35), mouseClick at 500 and 1200 (0.75), riser at 3600 (0.45), ambientPad at 0 (0.18).
  //    Assert the two mouseClick cues are NOT deduplicated (they are 700 ms apart).
  it("choreographs exact cue set for test scene 2 and preserves distinct mouse clicks", async () => {
    const sceneInput: SceneSpecInput = {
      schemaVersion: 1,
      id: "test-scene-2",
      name: "Test Scene 2",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 5000,
      layers: [
        {
          id: "bg",
          type: "background",
          variant: { variant: "solid", color: "#000000" },
        },
        {
          id: "layer-text",
          type: "kineticText",
          text: "Headline",
          sizePx: 48,
          at: 0,
          duration: 5000,
          position: { xPct: 50, yPct: 50 },
        },
        {
          id: "layer-card",
          type: "card",
          variant: { variant: "glassCard", title: "Feature", widthPx: 400 },
          at: 800,
          duration: 4200,
          position: { xPct: 50, yPct: 50 },
        },
        {
          id: "layer-code",
          type: "codeBlock",
          code: "console.log('hi');",
          language: "typescript",
          at: 1600,
          duration: 3400,
          position: { xPct: 50, yPct: 50 },
        },
        {
          id: "layer-metric",
          type: "metricTicker",
          toValue: 99.9,
          label: "Uptime",
          at: 2400,
          duration: 2600,
          position: { xPct: 50, yPct: 50 },
        },
        {
          id: "layer-cta",
          type: "cta",
          label: "Get Started",
          at: 3200,
          duration: 1800,
          position: { xPct: 50, yPct: 50 },
        },
        {
          id: "layer-cursor",
          type: "cursorFlow",
          at: 0,
          duration: 5000,
          waypoints: [
            { atMs: 500, xPct: 30, yPct: 30, action: "click" },
            { atMs: 1200, xPct: 70, yPct: 70, action: "click" },
          ],
        },
      ],
    };

    await core.saveScene(sceneInput);
    const report = await core.autoChoreographAudio("test-scene-2");

    expect(report.sceneId).toBe("test-scene-2");
    expect(report.cuesAdded).toBe(12);
    expect(report.totalCues).toBe(12);
    expect(report.ambientIncluded).toBe(true);
    expect(report.skipped).toEqual([]);

    const updated = await core.getScene("test-scene-2");
    expect(updated).not.toBeNull();
    const cues = updated!.audio?.cues ?? [];
    expect(cues).toHaveLength(12);

    // Exact cue set assertion:
    // bassDrop at 0 (0.55), shimmer at 0 (0.30), whoosh at 0 (0.65), softSwoosh at 800 (0.6),
    // typingTick at 1800 (0.55), counterTick at 2550 (0.5), notificationChime at 3300 (0.65),
    // subImpact at 3300 (0.35), mouseClick at 500 and 1200 (0.75), riser at 3600 (0.45), ambientPad at 0 (0.18).
    expect(cues[0]).toMatchObject({ sfx: "bassDrop", at: 0, gain: 0.55 });
    expect(cues[1]).toMatchObject({ sfx: "shimmer", at: 0, gain: 0.30 });
    expect(cues[2]).toMatchObject({ sfx: "whoosh", at: 0, gain: 0.65 });
    expect(cues[3]).toMatchObject({ sfx: "softSwoosh", at: 800, gain: 0.6 });
    expect(cues[4]).toMatchObject({ sfx: "typingTick", at: 1800, gain: 0.55 });
    expect(cues[5]).toMatchObject({ sfx: "counterTick", at: 2550, gain: 0.5 });
    expect(cues[6]).toMatchObject({ sfx: "notificationChime", at: 3300, gain: 0.65 });
    expect(cues[7]).toMatchObject({ sfx: "subImpact", at: 3300, gain: 0.35 });
    expect(cues[8]).toMatchObject({ sfx: "mouseClick", at: 500, gain: 0.75 });
    expect(cues[9]).toMatchObject({ sfx: "mouseClick", at: 1200, gain: 0.75 });
    expect(cues[10]).toMatchObject({ sfx: "riser", at: 3600, gain: 0.45 });
    expect(cues[11]).toMatchObject({ sfx: "ambientPad", at: 0, gain: 0.18 });

    // Assert the two mouseClick cues are NOT deduplicated (they are 700 ms apart)
    const mouseClicks = cues.filter((c) => c.sfx === "mouseClick");
    expect(mouseClicks).toHaveLength(2);
    expect(mouseClicks[0]!.at).toBe(500);
    expect(mouseClicks[1]!.at).toBe(1200);
    expect(mouseClicks[1]!.at - mouseClicks[0]!.at).toBe(700);
  });

  // 3. All-14 coverage on a second scene: deviceMockup (terminal) at 0, kineticText at 0,
  //    bentoGrid at 1000, comparisonSplit at 1500, chart at 1800, cta at 2200,
  //    cursorFlow with a hover at 2500 and a click at 2700, durationMs 4000.
  //    Assert Object.keys(bySfx).sort() equals the 14 SFX_NAMES sorted, and every cue's gain is within 0..2.
  it("covers all 14 bank entries on second test scene with gains in 0..2", async () => {
    const sceneInput: SceneSpecInput = {
      schemaVersion: 1,
      id: "test-scene-3",
      name: "Test Scene 3",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: [
        {
          id: "bg",
          type: "background",
          variant: { variant: "solid", color: "#000000" },
        },
        {
          id: "layer-device",
          type: "deviceMockup",
          deviceType: "terminal",
          at: 0,
          duration: 4000,
          position: { xPct: 50, yPct: 50 },
        },
        {
          id: "layer-text",
          type: "kineticText",
          text: "Terminal Mode",
          sizePx: 48,
          at: 0,
          duration: 4000,
          position: { xPct: 50, yPct: 50 },
        },
        {
          id: "layer-bento",
          type: "bentoGrid",
          columns: 2,
          cells: [{ title: "Cell 1" }, { title: "Cell 2" }],
          at: 1000,
          duration: 3000,
          position: { xPct: 50, yPct: 50 },
        },
        {
          id: "layer-split",
          type: "comparisonSplit",
          leftTitle: "Legacy",
          leftItems: ["Slow", "Manual"],
          rightTitle: "MotionForge",
          rightItems: ["Fast", "Autonomous"],
          at: 1500,
          duration: 2500,
          position: { xPct: 50, yPct: 50 },
        },
        {
          id: "layer-chart",
          type: "chart",
          chartType: "bar",
          data: [
            { label: "Q1", value: 30 },
            { label: "Q2", value: 85 },
          ],
          at: 1800,
          duration: 2200,
          position: { xPct: 50, yPct: 50 },
        },
        {
          id: "layer-cta",
          type: "cta",
          label: "Deploy Now",
          at: 2200,
          duration: 1800,
          position: { xPct: 50, yPct: 50 },
        },
        {
          id: "layer-cursor",
          type: "cursorFlow",
          at: 0,
          duration: 4000,
          waypoints: [
            { atMs: 2500, xPct: 40, yPct: 40, action: "hover" },
            { atMs: 2700, xPct: 60, yPct: 60, action: "click" },
          ],
        },
      ],
    };

    await core.saveScene(sceneInput);
    const report = await core.autoChoreographAudio("test-scene-3");

    expect(Object.keys(report.bySfx).sort()).toEqual([...SFX_NAMES].sort());

    const updated = await core.getScene("test-scene-3");
    expect(updated).not.toBeNull();
    const cues = updated!.audio?.cues ?? [];
    expect(cues).toHaveLength(14);

    for (const cue of cues) {
      expect(cue.gain).toBeGreaterThanOrEqual(0);
      expect(cue.gain).toBeLessThanOrEqual(2);
    }
  });

  // 4. Deduplication: two clicks 60 ms apart -> exactly one mouseClick, one entry in skipped
  it("deduplicates two clicks 60 ms apart into exactly one mouseClick and one entry in skipped", async () => {
    const sceneInput: SceneSpecInput = {
      schemaVersion: 1,
      id: "test-scene-4",
      name: "Test Scene 4",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 3000,
      layers: [
        {
          id: "bg",
          type: "background",
          variant: { variant: "solid", color: "#000000" },
        },
        {
          id: "layer-cursor",
          type: "cursorFlow",
          at: 0,
          duration: 3000,
          waypoints: [
            { atMs: 500, xPct: 20, yPct: 20, action: "click" },
            { atMs: 560, xPct: 25, yPct: 25, action: "click" },
          ],
        },
      ],
    };

    await core.saveScene(sceneInput);
    const report = await core.autoChoreographAudio("test-scene-4", {
      includeAmbientBed: false,
    });

    expect(report.bySfx.mouseClick).toBe(1);
    expect(report.skipped).toEqual(["mouseClick at 560ms: duplicate within 120ms"]);

    const updated = await core.getScene("test-scene-4");
    const mouseClicks = (updated!.audio?.cues ?? []).filter((c) => c.sfx === "mouseClick");
    expect(mouseClicks).toHaveLength(1);
    expect(mouseClicks[0]!.at).toBe(500);
  });

  // 5. masterGain: 0.5 halves every gain; includeAmbientBed: false removes ambientPad
  it("halves every gain with masterGain: 0.5 and removes ambientPad when includeAmbientBed: false", async () => {
    const sceneInput: SceneSpecInput = {
      schemaVersion: 1,
      id: "test-scene-5",
      name: "Test Scene 5",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 5000,
      layers: [
        {
          id: "bg",
          type: "background",
          variant: { variant: "solid", color: "#000000" },
        },
        {
          id: "layer-text",
          type: "kineticText",
          text: "Headline",
          sizePx: 48,
          at: 0,
          duration: 5000,
          position: { xPct: 50, yPct: 50 },
        },
        {
          id: "layer-card",
          type: "card",
          variant: { variant: "glassCard", title: "Feature", widthPx: 400 },
          at: 800,
          duration: 4200,
          position: { xPct: 50, yPct: 50 },
        },
      ],
    };

    await core.saveScene(sceneInput);

    // Normal baseline (masterGain: 1, includeAmbientBed: true)
    const reportNormal = await core.autoChoreographAudio("test-scene-5", {
      masterGain: 1,
      includeAmbientBed: true,
      overwriteExisting: true,
    });
    expect(reportNormal.ambientIncluded).toBe(true);
    const sceneNormal = (await core.getScene("test-scene-5"))!;
    const normalCues = sceneNormal.audio?.cues ?? [];
    expect(normalCues.some((c) => c.sfx === "ambientPad")).toBe(true);

    // Half gain and no ambient (masterGain: 0.5, includeAmbientBed: false)
    const reportHalf = await core.autoChoreographAudio("test-scene-5", {
      masterGain: 0.5,
      includeAmbientBed: false,
      overwriteExisting: true,
    });
    expect(reportHalf.ambientIncluded).toBe(false);
    expect(reportHalf.bySfx.ambientPad).toBeUndefined();

    const sceneHalf = (await core.getScene("test-scene-5"))!;
    const halfCues = sceneHalf.audio?.cues ?? [];
    expect(halfCues.some((c) => c.sfx === "ambientPad")).toBe(false);

    // Every gain is exactly halved
    const normalNonAmbient = normalCues.filter((c) => c.sfx !== "ambientPad");
    expect(halfCues).toHaveLength(normalNonAmbient.length);
    for (let i = 0; i < halfCues.length; i++) {
      expect(halfCues[i]!.sfx).toBe(normalNonAmbient[i]!.sfx);
      expect(halfCues[i]!.at).toBe(normalNonAmbient[i]!.at);
      expect(halfCues[i]!.gain).toBeCloseTo(normalNonAmbient[i]!.gain * 0.5, 4);
    }
  });

  // 6. overwriteExisting: false on a scene with an existing whoosh cue at 0 keeps it and does
  //    not add a second whoosh within 120 ms; true replaces the cue list
  it("keeps existing cues and skips duplicates when overwriteExisting: false; replaces cue list when true", async () => {
    const sceneInput: SceneSpecInput = {
      schemaVersion: 1,
      id: "test-scene-6",
      name: "Test Scene 6",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 3000,
      layers: [
        {
          id: "bg",
          type: "background",
          variant: { variant: "solid", color: "#000000" },
        },
        {
          id: "layer-text",
          type: "kineticText",
          text: "Headline",
          sizePx: 48,
          at: 0,
          duration: 3000,
          position: { xPct: 50, yPct: 50 },
        },
      ],
      audio: {
        cues: [
          {
            id: "custom-whoosh",
            at: 0,
            sfx: "whoosh",
            gain: 0.88,
            pan: 0,
          },
        ],
      },
    };

    await core.saveScene(sceneInput);

    // overwriteExisting: false keeps custom-whoosh and does not add a second whoosh within 120 ms
    const reportFalse = await core.autoChoreographAudio("test-scene-6", {
      overwriteExisting: false,
    });
    expect(reportFalse.skipped).toContain("whoosh at 0ms: duplicate within 120ms");
    expect(reportFalse.bySfx.whoosh).toBe(1);

    const sceneAfterFalse = (await core.getScene("test-scene-6"))!;
    const whooshCuesFalse = (sceneAfterFalse.audio?.cues ?? []).filter((c) => c.sfx === "whoosh");
    expect(whooshCuesFalse).toHaveLength(1);
    expect(whooshCuesFalse[0]!.id).toBe("custom-whoosh");
    expect(whooshCuesFalse[0]!.gain).toBe(0.88);

    // overwriteExisting: true replaces the cue list
    const reportTrue = await core.autoChoreographAudio("test-scene-6", {
      overwriteExisting: true,
    });
    const sceneAfterTrue = (await core.getScene("test-scene-6"))!;
    const whooshCuesTrue = (sceneAfterTrue.audio?.cues ?? []).filter((c) => c.sfx === "whoosh");
    expect(whooshCuesTrue).toHaveLength(1);
    expect(whooshCuesTrue[0]!.id).not.toBe("custom-whoosh");
    expect(whooshCuesTrue[0]!.gain).toBe(0.65);
  });
});
