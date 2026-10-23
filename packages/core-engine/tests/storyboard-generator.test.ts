import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FOREGROUND_LAYER_TYPES,
  sceneSpecSchema,
} from "@motionforge/scene-spec";
import { resolveEnginePaths } from "../src/config.js";
import { EngineCore } from "../src/engine-core.js";
import {
  storyboardBriefSchema,
  type StoryboardBrief,
} from "../src/storyboard-generator.js";

describe("storyboard generator from brief", () => {
  let workdir: string;
  let core: EngineCore;

  const defaultBrief: StoryboardBrief = {
    projectTitle: "Acme Cloud",
    productName: "Acme Engine",
    tagline: "High-performance video infrastructure for modern apps",
  };

  beforeAll(async () => {
    workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "mf-storyboard-test-"));
    const paths = resolveEnginePaths({ dataDir: workdir });
    core = new EngineCore(
      { port: 4002, maxRenderWorkers: 1, paths },
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

  // 1. Default brief -> 3 scenes, each sceneDurationMs 4000, ids -s1..-s3, total 12000
  it("generates 3 scenes with default 4000ms duration, ids -s1..-s3, total 12000ms", async () => {
    const report = await core.generateStoryboardFromBrief(defaultBrief);

    expect(report.projectTitle).toBe("Acme Cloud");
    expect(report.themePreset).toBe("linearMinimal");
    expect(report.scenes).toHaveLength(3);
    expect(report.totalDurationMs).toBe(12000);

    expect(report.scenes[0]!.sceneId).toBe("acme-cloud-s1");
    expect(report.scenes[1]!.sceneId).toBe("acme-cloud-s2");
    expect(report.scenes[2]!.sceneId).toBe("acme-cloud-s3");

    for (const sceneSummary of report.scenes) {
      expect(sceneSummary.durationMs).toBe(4000);
      expect(sceneSummary.layerKinds.length).toBeGreaterThan(0);
    }

    expect(report.manifest).toEqual([
      { sceneId: "acme-cloud-s1", index: 0, role: "hook", transitionToNext: "fade" },
      { sceneId: "acme-cloud-s2", index: 1, role: "product", transitionToNext: "fade" },
      { sceneId: "acme-cloud-s3", index: 2, role: "proof", transitionToNext: "cut" },
    ]);
  });

  // 2. sceneCount: 2 and 5 produce exactly that many; 1 and 6 are rejected by the MCP schema
  it("supports sceneCount 2 and 5, while 1 and 6 are rejected by the schema", async () => {
    const report2 = await core.generateStoryboardFromBrief({
      ...defaultBrief,
      sceneCount: 2,
    });
    expect(report2.scenes).toHaveLength(2);
    expect(report2.manifest).toHaveLength(2);
    expect(report2.manifest[0]!.transitionToNext).toBe("fade");
    expect(report2.manifest[1]!.transitionToNext).toBe("cut");
    expect(report2.totalDurationMs).toBe(8000);

    const report5 = await core.generateStoryboardFromBrief({
      ...defaultBrief,
      sceneCount: 5,
    });
    expect(report5.scenes).toHaveLength(5);
    expect(report5.manifest).toHaveLength(5);
    expect(report5.manifest[3]!.transitionToNext).toBe("fade");
    expect(report5.manifest[4]!.transitionToNext).toBe("cut");
    expect(report5.totalDurationMs).toBe(20000);

    expect(() =>
      storyboardBriefSchema.parse({ ...defaultBrief, sceneCount: 1 })
    ).toThrow();
    expect(() =>
      storyboardBriefSchema.parse({ ...defaultBrief, sceneCount: 6 })
    ).toThrow();
  });

  // 3. Every generated scene validates (sceneSpecSchema) and has at least one foreground layer in every 250 ms sample window (no dead air)
  it("ensures every generated scene validates against sceneSpecSchema with zero dead air", async () => {
    const report = await core.generateStoryboardFromBrief({
      ...defaultBrief,
      sceneCount: 5,
      sceneDurationMs: 4000,
    });

    for (const summary of report.scenes) {
      const stored = core.store.require(summary.sceneId);
      const parsed = sceneSpecSchema.parse(stored.scene);
      expect(parsed.id).toBe(summary.sceneId);

      const durationMs = stored.scene.durationMs;
      const foregroundLayers = stored.scene.layers.filter((l) =>
        (FOREGROUND_LAYER_TYPES as readonly string[]).includes(l.type)
      );
      expect(foregroundLayers.length).toBeGreaterThan(0);

      // Sample every 250 ms across the timeline
      for (let t = 0; t <= durationMs; t += 250) {
        const activeForeground = foregroundLayers.filter((l) => {
          const at = l.at ?? 0;
          const duration = l.duration ?? durationMs - at;
          return t >= at && t <= at + duration;
        });
        expect(
          activeForeground.length,
          `Dead air at ${t}ms in scene ${summary.sceneId}`
        ).toBeGreaterThanOrEqual(1);
      }
    }
  });

  // 4. All scenes share the requested themePreset
  it("ensures all generated scenes share the requested themePreset", async () => {
    const report = await core.generateStoryboardFromBrief({
      ...defaultBrief,
      themePreset: "emeraldFintech",
      sceneCount: 3,
    });

    expect(report.themePreset).toBe("emeraldFintech");
    for (const summary of report.scenes) {
      const stored = core.store.require(summary.sceneId);
      expect(stored.scene.themePreset).toBe("emeraldFintech");
    }
  });

  // 5. With autoCritiqueAndFix: false the report score is the critic's scoreBefore; with true it is >= 95
  it("reports critic scoreBefore when autoCritiqueAndFix: false, and >= 95 when true", async () => {
    const reportFalse = await core.generateStoryboardFromBrief({
      ...defaultBrief,
      projectTitle: "Critique False Project",
      autoCritiqueAndFix: false,
      sceneCount: 3,
    });

    for (const s of reportFalse.scenes) {
      const critique = await core.critiqueAndAutofixScene(s.sceneId, {
        autoApplyFixes: false,
      });
      expect(s.score).toBe(critique.scoreBefore);
    }

    const reportTrue = await core.generateStoryboardFromBrief({
      ...defaultBrief,
      projectTitle: "Critique True Project",
      autoCritiqueAndFix: true,
      sceneCount: 3,
    });

    for (const s of reportTrue.scenes) {
      expect(s.score).toBeGreaterThanOrEqual(95);
    }
  });

  // 6. With autoChoreographAudio: true every scene has cueCount >= 3
  it("choreographs audio cues so every scene has cueCount >= 3", async () => {
    const report = await core.generateStoryboardFromBrief({
      ...defaultBrief,
      autoChoreographAudio: true,
      sceneCount: 3,
    });

    for (const s of report.scenes) {
      expect(s.cueCount).toBeGreaterThanOrEqual(3);
      const stored = core.store.require(s.sceneId);
      expect(stored.scene.audio?.cues?.length).toBe(s.cueCount);
    }
  });

  // 8. A one-metric / one-feature brief is normalized before the layer schemas see it.
  it("normalizes a single metric and a single feature into valid chart, bento and connector data", async () => {
    const report = await core.generateStoryboardFromBrief({
      ...defaultBrief,
      projectTitle: "Normalize One",
      keyMetrics: [{ label: "Only Metric", value: "42x" }],
      features: [{ title: "Only Feature", description: "The one feature the brief names" }],
      sceneCount: 5,
      autoCritiqueAndFix: false,
    });

    for (const summary of report.scenes) {
      expect(() => sceneSpecSchema.parse(core.store.require(summary.sceneId).scene)).not.toThrow();
    }

    const hook = core.store.require("normalize-one-s1").scene;
    const ticker = hook.layers.find((l) => l.type === "metricTicker");
    const bento = hook.layers.find((l) => l.type === "bentoGrid");
    expect(ticker && ticker.type === "metricTicker" ? ticker.toValue : null).toBe(42);
    expect(bento && bento.type === "bentoGrid" ? bento.cells.length : 0).toBeGreaterThanOrEqual(2);

    const product = core.store.require("normalize-one-s2").scene;
    const connector = product.layers.find((l) => l.type === "connectorDiagram");
    expect(connector && connector.type === "connectorDiagram" ? connector.nodes.length : 0).toBeGreaterThanOrEqual(2);

    const proof = core.store.require("normalize-one-s3").scene;
    const chart = proof.layers.find((l) => l.type === "chart");
    expect(chart && chart.type === "chart" ? chart.data.length : 0).toBeGreaterThanOrEqual(2);
    expect(chart && chart.type === "chart" ? chart.data[0]!.value : null).toBe(42);
  });

  // 7. Determinism: same brief twice -> identical scene structure (ids, layer kinds, timings), ignoring revisions
  it("is deterministic: same brief produces identical scene structure and timings", async () => {
    const brief: StoryboardBrief = {
      projectTitle: "Deterministic Reel",
      productName: "Forge Studio",
      tagline: "Build cinematic product videos with deterministic code",
      keyMetrics: [
        { label: "Rendering Speed", value: "120 FPS", numericValue: 120, delta: "+50%" },
        { label: "Latency", value: "2ms", numericValue: 2 },
      ],
      features: [
        { title: "Browser Engine", description: "In-process Chromium runner" },
        { title: "Audio SFX", description: "14-cue spatial sound design" },
      ],
      sceneCount: 3,
      sceneDurationMs: 4000,
    };

    const run1 = await core.generateStoryboardFromBrief(brief);
    const run2 = await core.generateStoryboardFromBrief(brief);

    expect(run1.projectTitle).toBe(run2.projectTitle);
    expect(run1.totalDurationMs).toBe(run2.totalDurationMs);
    expect(run1.themePreset).toBe(run2.themePreset);

    expect(run1.scenes.map((s) => s.sceneId)).toEqual(run2.scenes.map((s) => s.sceneId));
    expect(run1.scenes.map((s) => s.layerKinds)).toEqual(run2.scenes.map((s) => s.layerKinds));
    expect(run1.scenes.map((s) => s.durationMs)).toEqual(run2.scenes.map((s) => s.durationMs));
    expect(run1.manifest).toEqual(run2.manifest);

    for (let i = 0; i < run1.scenes.length; i++) {
      const scene1 = core.store.require(run1.scenes[i]!.sceneId).scene;
      const scene2 = core.store.require(run2.scenes[i]!.sceneId).scene;

      expect(scene1.layers.length).toBe(scene2.layers.length);
      for (let j = 0; j < scene1.layers.length; j++) {
        const l1 = scene1.layers[j]!;
        const l2 = scene2.layers[j]!;
        expect(l1.id).toBe(l2.id);
        expect(l1.type).toBe(l2.type);
        expect(l1.at).toBe(l2.at);
        expect(l1.duration).toBe(l2.duration);
      }
    }
  });
});
