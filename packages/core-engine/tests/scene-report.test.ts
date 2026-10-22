/**
 * THE REPORTS.
 *
 * The three report paths (`get_layer_bounds`, `analyze_scene`,
 * `get_render_result`) are the numbers an agent reasons about, so their
 * ARITHMETIC is tested here — not their plumbing.
 *
 * Everything in this file is pure or uses a temporary engine workspace: no
 * browser is ever launched, and the user's own workspace is never touched.
 */
import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseScene, type SceneSpecInput } from "@motionforge/scene-spec";
import { buildBoundsFrameReport } from "../src/bounds-report.js";
import {
  computeWorkerBudget,
  detectHeavyEffects,
  HEAVY_EFFECT_MULTIPLIERS,
  MAX_PER_FRAME_MULTIPLIER,
  perFrameMultiplier,
  sceneHasHeavyEffects,
} from "../src/cost-analysis.js";
import { encoderArgs, productionBitrateFloor, profileFor } from "../src/encoder.js";
import { createEngineCore, type EngineCore } from "../src/index.js";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const PLAIN_SCENE: SceneSpecInput = {
  schemaVersion: 1,
  name: "plain",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 4000,
  layers: [
    { id: "bg", type: "background", variant: { variant: "solid", color: "#05070d" } },
    {
      id: "title",
      type: "kineticText",
      text: "Hello",
      sizePx: 96,
      position: { xPct: 50, yPct: 50 },
      fill: "#ffffff",
    },
  ],
  audio: { cues: [] },
};

const HEAVY_SCENE: SceneSpecInput = {
  schemaVersion: 1,
  name: "heavy",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 4000,
  layers: [
    {
      id: "bg",
      type: "background",
      variant: {
        variant: "meshGradient",
        base: "#05070d",
        blobs: [
          { color: "#ff0055", xPct: 20, yPct: 30, radiusPct: 40, drift: 0.2 },
          { color: "#00d4ff", xPct: 70, yPct: 60, radiusPct: 50, drift: 0.3 },
        ],
      },
    },
    {
      id: "grain",
      type: "foregroundFX",
      effects: [{ kind: "filmGrain", opacity: 0.06, sizePx: 2 }],
    },
    {
      id: "blurry",
      type: "kineticText",
      text: "Blur",
      sizePx: 64,
      position: { xPct: 50, yPct: 30 },
      fill: "#ffffff",
      filters: { blur: 50 },
    },
    {
      id: "blended",
      type: "kineticText",
      text: "Blend",
      sizePx: 64,
      position: { xPct: 50, yPct: 70 },
      fill: "#ffffff",
      blendMode: "screen",
    },
    {
      id: "dust",
      type: "particleField",
      count: 200,
      pattern: "float",
      color: "#7dd3fc",
    },
  ],
  audio: { cues: [] },
};

// ---------------------------------------------------------------------------
// 1. the heavy-effect detection and its arithmetic
// ---------------------------------------------------------------------------

describe("detectHeavyEffects", () => {
  it("finds nothing in a plain scene", () => {
    const effects = detectHeavyEffects(parseScene(PLAIN_SCENE));
    expect(effects).toEqual([]);
    expect(perFrameMultiplier(effects)).toBe(1);
    expect(sceneHasHeavyEffects(parseScene(PLAIN_SCENE))).toBe(false);
  });

  it("names every expensive feature with its own multiplier", () => {
    const effects = detectHeavyEffects(parseScene(HEAVY_SCENE));
    const byEffect = new Map(effects.map((effect) => [effect.effect, effect]));

    expect([...byEffect.keys()].sort()).toEqual([
      "blendMode",
      "blur",
      "filmGrain",
      "meshGradient",
      "particleField",
    ]);

    expect(byEffect.get("meshGradient")?.multiplier).toBe(HEAVY_EFFECT_MULTIPLIERS.meshGradient);
    expect(byEffect.get("meshGradient")?.layerId).toBe("bg");
    expect(byEffect.get("filmGrain")?.multiplier).toBe(HEAVY_EFFECT_MULTIPLIERS.filmGrain);
    expect(byEffect.get("filmGrain")?.layerId).toBe("grain");
    expect(byEffect.get("blur")?.multiplier).toBe(HEAVY_EFFECT_MULTIPLIERS.blur);
    expect(byEffect.get("blur")?.layerId).toBe("blurry");
    expect(byEffect.get("blendMode")?.multiplier).toBe(HEAVY_EFFECT_MULTIPLIERS.blendMode);
    expect(byEffect.get("blendMode")?.layerId).toBe("blended");
    expect(byEffect.get("particleField")?.multiplier).toBe(HEAVY_EFFECT_MULTIPLIERS.particleField);
    expect(byEffect.get("particleField")?.layerId).toBe("dust");

    // every effect explains itself in one sentence
    for (const effect of effects) {
      expect(effect.reason.length).toBeGreaterThan(10);
    }
  });

  it("ignores the cheap neighbours of every threshold", () => {
    const cheap: SceneSpecInput = {
      ...PLAIN_SCENE,
      layers: [
        { id: "bg", type: "background", variant: { variant: "solid", color: "#000000" } },
        {
          id: "soft",
          type: "kineticText",
          text: "Soft",
          sizePx: 32,
          position: { xPct: 50, yPct: 50 },
          fill: "#ffffff",
          filters: { blur: 12 },
        },
        {
          id: "normal",
          type: "kineticText",
          text: "Normal",
          sizePx: 32,
          position: { xPct: 30, yPct: 50 },
          fill: "#ffffff",
          blendMode: "normal",
        },
        { id: "few", type: "particleField", count: 100, pattern: "float", color: "#fff" },
      ],
    };
    expect(detectHeavyEffects(parseScene(cheap))).toEqual([]);
  });

  it("multiplies the individual multipliers", () => {
    const effects = detectHeavyEffects(parseScene(HEAVY_SCENE));
    // The multipliers are the ISOLATED, MEASURED costs (Phase 7):
    //   meshGradient x1.10 · filmGrain x1.11 · blur x1.14 · blendMode x1.25
    //   · particleField x1.20
    // 1.10 × 1.11 × 1.14 × 1.25 × 1.20 = 2.09
    expect(perFrameMultiplier(effects)).toBe(2.09);
    // …and the product of a scene with EVERY effect is still capped
    expect(perFrameMultiplier(effects)).toBeLessThanOrEqual(MAX_PER_FRAME_MULTIPLIER);

    const pair = detectHeavyEffects(
      parseScene({
        ...PLAIN_SCENE,
        layers: [
          {
            id: "bg",
            type: "background",
            variant: {
              variant: "meshGradient",
              base: "#05070d",
              blobs: [
                { color: "#ff0055", xPct: 20, yPct: 30, radiusPct: 40, drift: 0.2 },
                { color: "#00d4ff", xPct: 70, yPct: 60, radiusPct: 50, drift: 0.3 },
              ],
            },
          },
          { id: "grain", type: "foregroundFX", effects: [{ kind: "filmGrain" }] },
        ],
      })
    );
    // 1.10 × 1.11 = 1.221 → 1.22
    expect(perFrameMultiplier(pair)).toBe(1.22);
  });
});

// ---------------------------------------------------------------------------
// 2. the RAM-aware worker budget
// ---------------------------------------------------------------------------

describe("computeWorkerBudget", () => {
  it("never exceeds the core count", () => {
    expect(computeWorkerBudget({ cpus: 2, totalMemGb: 32, heavy: false })).toBe(2);
    expect(computeWorkerBudget({ cpus: 1, totalMemGb: 32, heavy: false })).toBe(1);
  });

  it("caps at four workers on a big host", () => {
    expect(computeWorkerBudget({ cpus: 32, totalMemGb: 64, heavy: false })).toBe(4);
  });

  it("drops to one worker on a low-memory host", () => {
    expect(computeWorkerBudget({ cpus: 16, totalMemGb: 3.8, heavy: false })).toBe(1);
    expect(computeWorkerBudget({ cpus: 16, totalMemGb: 4.5, heavy: false })).toBe(1);
    expect(computeWorkerBudget({ cpus: 16, totalMemGb: 4.6, heavy: false })).toBe(4);
  });

  it("drops to one worker for a scene with heavy effects", () => {
    expect(computeWorkerBudget({ cpus: 16, totalMemGb: 64, heavy: true })).toBe(1);
  });

  it("never returns zero", () => {
    expect(computeWorkerBudget({ cpus: 0, totalMemGb: 0, heavy: true })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. the bounds report (no pixels involved)
// ---------------------------------------------------------------------------

describe("buildBoundsFrameReport", () => {
  const canvas = { width: 1920, height: 1080 };

  it("reports the camera, the layers and the foreground", () => {
    const frame = buildBoundsFrameReport({
      atMs: 1200,
      describe: {
        camera: { scale: 1.2, xPct: 40, yPct: 60, roll: 0, yaw: 0, pitch: 0, clampedVoid: false },
        layers: [
          {
            id: "title",
            type: "kineticText",
            lifecyclePhase: "entrance",
            phaseProgressPct: 62.5,
            opacity: 1,
            bbox: { x: 100, y: 200, width: 400, height: 120 },
            textOverflow: false,
          },
        ],
        foreground: ["title"],
        activeTransitions: [{ kind: "wipe", progressPct: 40, phase: "in" }],
      },
      bounds: {
        title: { x: 100, y: 200, width: 400, height: 120, cx: 300, cy: 260, rotation: 15 },
      },
      canvas,
    });

    expect(frame.atMs).toBe(1200);
    expect(frame.camera.scale).toBe(1.2);
    expect(frame.camera.xPct).toBe(40);
    expect(frame.foreground).toEqual(["title"]);
    expect(frame.activeTransitions?.[0]?.kind).toBe("wipe");
    expect(frame.layers[0]?.lifecyclePhase).toBe("entrance");
    expect(frame.layers[0]?.phaseProgressPct).toBe(62.5);
    // the camera-INDEPENDENT box travels beside the painted one
    expect(frame.layers[0]?.compositionBox).toEqual({
      x: 100,
      y: 200,
      width: 400,
      height: 120,
      cx: 300,
      cy: 260,
      rotation: 15,
    });
  });

  it("reports the overlapping pairs of VISIBLE layers", () => {
    const frame = buildBoundsFrameReport({
      atMs: 0,
      describe: {
        layers: [
          { id: "a", type: "kineticText", opacity: 1, bbox: { x: 0, y: 0, width: 100, height: 100 } },
          { id: "b", type: "kineticText", opacity: 1, bbox: { x: 50, y: 50, width: 100, height: 100 } },
          { id: "c", type: "kineticText", opacity: 0.001, bbox: { x: 0, y: 0, width: 100, height: 100 } },
        ],
      },
      bounds: {},
      canvas,
    });
    expect(frame.overlaps).toEqual([{ a: "a", b: "b", areaPx2: 2500 }]);
  });

  it("excludes full-bleed layers from BOTH sides of an overlap", () => {
    const frame = buildBoundsFrameReport({
      atMs: 0,
      describe: {
        layers: [
          { id: "bg", type: "background", opacity: 1, bbox: { x: 0, y: 0, width: 1920, height: 1080 } },
          { id: "grain", type: "foregroundFX", opacity: 1, bbox: { x: 0, y: 0, width: 1920, height: 1080 } },
          { id: "title", type: "kineticText", opacity: 1, bbox: { x: 10, y: 10, width: 100, height: 100 } },
        ],
      },
      bounds: {},
      canvas,
    });
    expect(frame.overlaps).toEqual([]);
    expect(frame.offscreen).toEqual([]);
  });

  it("reports the layers that hang off the canvas edge", () => {
    const frame = buildBoundsFrameReport({
      atMs: 0,
      describe: {
        layers: [
          { id: "left", type: "kineticText", opacity: 1, bbox: { x: -20, y: 10, width: 100, height: 50 } },
          {
            id: "corner",
            type: "kineticText",
            opacity: 1,
            bbox: { x: 1900, y: 1070, width: 100, height: 50 },
          },
        ],
      },
      bounds: {},
      canvas,
    });
    expect(frame.offscreen).toHaveLength(2);
    expect(frame.offscreen[0]?.edges).toEqual(["left"]);
    expect(frame.offscreen[1]?.edges.sort()).toEqual(["bottom", "right"]);
  });

  it("degrades to an empty frame when the runtime published nothing", () => {
    const frame = buildBoundsFrameReport({ atMs: 0, describe: null, bounds: {}, canvas });
    expect(frame.layers).toEqual([]);
    expect(frame.overlaps).toEqual([]);
    expect(frame.offscreen).toEqual([]);
    expect(frame.camera.scale).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. the encoder ladder — production is never worse than draft
// ---------------------------------------------------------------------------

describe("encoderArgs", () => {
  const production = profileFor("production", parseScene(PLAIN_SCENE));
  const draft = profileFor("draft", parseScene(PLAIN_SCENE));

  it("keeps the old two-argument call working", () => {
    expect(() => encoderArgs("libx264", "draft")).not.toThrow();
    expect(() => encoderArgs("libx264", "production")).not.toThrow();
    expect(encoderArgs("libx264", "draft")).toContain("ultrafast");
  });

  it("never lets production be a lower quality target than draft", () => {
    const draftArgs = encoderArgs("libx264", "draft", draft);
    const productionArgs = encoderArgs("libx264", "production", production);
    expect(draftArgs).toContain("ultrafast");
    expect(draftArgs).toContain("30");
    // the production tier is ABR with a TARGET bitrate, not CRF: a CRF
    // target is a "spend as little as the content allows" instruction, and
    // `-b:v` beside it is only a cap — it never raises the bitrate
    expect(productionArgs).toContain("medium");
    expect(productionArgs).not.toContain("-crf");
  });

  it("gives production an explicit bitrate TARGET (not a CRF with a cap)", () => {
    const productionArgs = encoderArgs("libx264", "production", production);
    const floor = productionBitrateFloor(production);
    expect(floor).toBe(Math.round(1920 * 1080 * 60 * 0.05));
    expect(productionArgs).toContain("-b:v");
    expect(productionArgs[productionArgs.indexOf("-b:v") + 1]).toBe(String(floor));
    expect(productionArgs).toContain("-maxrate");
    expect(productionArgs).toContain("-bufsize");
    // the target is far above anything a CRF draft of the same content
    // reaches, so the master can never be the smaller file
    expect(floor).toBeGreaterThan(2_000_000);
  });

  it("raises the hardware encoder targets for production", () => {
    for (const encoder of ["h264_nvenc", "h264_qsv", "h264_videotoolbox"]) {
      const draftArgs = encoderArgs(encoder, "draft", draft);
      const productionArgs = encoderArgs(encoder, "production", production);
      const draftBitrate = Number(draftArgs[draftArgs.indexOf("-b:v") + 1]?.replace("M", "000000"));
      const productionBitrate = Number(
        productionArgs[productionArgs.indexOf("-b:v") + 1]
      );
      expect(productionBitrate).toBeGreaterThan(draftBitrate);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. the engine's own analysis report
// ---------------------------------------------------------------------------

describe("EngineCore.analyzeScene", () => {
  let tempDir: string;
  let core: EngineCore;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `mf-report-test-${randomUUID().slice(0, 8)}`);
    await fsp.mkdir(tempDir, { recursive: true });
    core = await createEngineCore({ dataDir: tempDir, enableWatcher: false });
  });

  afterEach(async () => {
    await core.dispose();
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("lists the layers that carry BOTH keyframe arrays", async () => {
    await core.saveScene({
      ...PLAIN_SCENE,
      id: "both-arrays",
      layers: [
        { id: "bg", type: "background", variant: { variant: "solid", color: "#05070d" } },
        {
          id: "title",
          type: "kineticText",
          text: "Both",
          sizePx: 96,
          position: { xPct: 50, yPct: 50 },
          fill: "#ffffff",
          keyframes: [
            { id: "k1", timeMs: 0, property: "xPct", value: 20 },
            { id: "k2", timeMs: 400, property: "opacity", value: 1 },
          ],
          tracks: [
            { property: "xPct", keyframes: [{ at: 0, value: 10 }] },
            { property: "rotation", keyframes: [{ at: 0, value: 5 }] },
          ],
        },
        {
          id: "legacy-only",
          type: "kineticText",
          text: "Legacy",
          sizePx: 48,
          position: { xPct: 50, yPct: 80 },
          fill: "#ffffff",
          tracks: [{ property: "yPct", keyframes: [{ at: 0, value: 70 }] }],
        },
      ],
    } satisfies SceneSpecInput);

    const report = await core.analyzeScene("both-arrays");
    expect(report.keyframePrecedence.canonical).toBe("keyframes");
    expect(report.keyframePrecedence.legacy).toBe("tracks");
    expect(report.keyframePrecedence.rule).toMatch(/wins/i);
    expect(report.keyframePrecedence.conflicts).toEqual([
      {
        layerId: "title",
        canonicalProperties: ["opacity", "xPct"],
        legacyProperties: ["rotation", "xPct"],
      },
    ]);
  });

  it("reports no conflict when only one array is present", async () => {
    await core.saveScene({ ...PLAIN_SCENE, id: "one-array" } satisfies SceneSpecInput);
    const report = await core.analyzeScene("one-array");
    expect(report.keyframePrecedence.conflicts).toEqual([]);
    expect(report.layerCount).toBe(2);
    expect(report.durationMs).toBe(4000);
    expect(Array.isArray(report.warnings)).toBe(true);
  });

  it("prices a heavy scene and picks a one-worker budget for it", async () => {
    await core.saveScene({ ...HEAVY_SCENE, id: "heavy-scene" } satisfies SceneSpecInput);
    const report = await core.analyzeScene("heavy-scene");
    expect(report.cost.heavyEffects.length).toBe(5);
    // the MEASURED, ISOLATED multipliers: 1.10 × 1.11 × 1.14 × 1.25 × 1.20
    expect(report.cost.perFrameMultiplier).toBe(2.09);
    expect(report.cost.perFrameMultiplier).toBeLessThanOrEqual(MAX_PER_FRAME_MULTIPLIER);
    expect(report.cost.workerBudget).toBe(1);
    expect(report.cost.frames).toBe(240);
    expect(report.cost.estimatedTotalMs).toBe(report.cost.estimatedFrameMs * 240);
    expect(report.cost.host.cpus).toBeGreaterThan(0);
    expect(report.cost.host.softwareRasterised).toBe(true);
    expect(report.cost.notes.length).toBeGreaterThan(0);
  });

  it("throws a 404-ish error for an unknown scene", async () => {
    await expect(core.analyzeScene("nope")).rejects.toThrow(/unknown scene/i);
  });
});
