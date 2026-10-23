import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SceneSpecInput } from "@motionforge/scene-spec";
import { resolveEnginePaths } from "../src/config.js";
import { EngineCore } from "../src/engine-core.js";
import { probeMedia } from "../src/media-probe.js";
import { ensureSfxBank } from "../src/sfx-bank.js";
import {
  planStoryboardCompose,
  type ComposeInput,
  type ComposeReport,
} from "../src/storyboard-composer.js";

describe("storyboard composer", () => {
  // -------------------------------------------------------------------------
  // Pure unit tests (no browser)
  // -------------------------------------------------------------------------
  describe("pure unit planning (no browser)", () => {
    // 1. Offset math: durations [2,2] + fade 0.5 -> total 3.5, video offset 1.5.
    it("computes offset math for durations [2,2] + fade 0.5 -> total 3.5, video offset 1.5", () => {
      const plan = planStoryboardCompose(
        [
          { sceneId: "scene-1", transitionToNext: "fade", transitionDurationMs: 500 },
          { sceneId: "scene-2" },
        ],
        [2, 2]
      );

      expect(plan.totalDurationSec).toBe(3.5);
      expect(plan.totalDuration).toBe(3.5);
      expect(plan.totalDurationMs).toBe(3500);
      expect(plan.offsets).toEqual([1.5]);
      expect(plan.transitions).toHaveLength(1);
      expect(plan.transitions[0]!.transition).toBe("fade");
      expect(plan.transitions[0]!.durationSec).toBe(0.5);
      expect(plan.transitions[0]!.offsetSec).toBe(1.5);
    });

    // 2. Three scenes [2,3,2] with fades [0.5,0.25] -> total 6.25, offsets 1.5 and 4.25.
    it("computes three scenes [2,3,2] with fades [0.5,0.25] -> total 6.25, offsets 1.5 and 4.25", () => {
      const plan = planStoryboardCompose(
        [
          { sceneId: "scene-1", transitionToNext: "fade", transitionDurationMs: 500 },
          { sceneId: "scene-2", transitionToNext: "fade", transitionDurationMs: 250 },
          { sceneId: "scene-3" },
        ],
        [2, 3, 2]
      );

      expect(plan.totalDurationSec).toBe(6.25);
      expect(plan.totalDuration).toBe(6.25);
      expect(plan.totalDurationMs).toBe(6250);
      expect(plan.offsets).toEqual([1.5, 4.25]);
      expect(plan.transitions).toHaveLength(2);
      expect(plan.transitions[0]!.offsetSec).toBe(1.5);
      expect(plan.transitions[1]!.offsetSec).toBe(4.25);
    });

    // 3. A transition longer than the adjacent scene is rejected.
    it("rejects a transition longer than the adjacent scene", () => {
      expect(() =>
        planStoryboardCompose(
          [
            { sceneId: "scene-1", transitionToNext: "fade", transitionDurationMs: 2000 },
            { sceneId: "scene-2" },
          ],
          [2000, 2000]
        )
      ).toThrow(/Transition duration \(2000ms\).*must be less than min\(adjacent scene durations\) - 100ms/);

      expect(() =>
        planStoryboardCompose(
          [
            { sceneId: "scene-1", transitionToNext: "fade", transitionDurationMs: 1950 },
            { sceneId: "scene-2" },
          ],
          [2000, 3000]
        )
      ).toThrow(/must be less than min\(adjacent scene durations\) - 100ms/);
    });

    // 4. `cut` between two segments keeps total = sum of durations.
    it("keeps total = sum of durations when using cut between segments", () => {
      const plan = planStoryboardCompose(
        [
          { sceneId: "scene-1", transitionToNext: "cut" },
          { sceneId: "scene-2" },
        ],
        [2, 2]
      );

      expect(plan.totalDurationSec).toBe(4);
      expect(plan.totalDuration).toBe(4);
      expect(plan.totalDurationMs).toBe(4000);
      expect(plan.offsets).toEqual([2]);
    });
  });

  // -------------------------------------------------------------------------
  // Integration tests (browser, sequential)
  // -------------------------------------------------------------------------
  describe("integration composition (browser)", () => {
    let workdir: string;
    let core: EngineCore;

    beforeAll(async () => {
      workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "mf-composer-int-"));
      const paths = resolveEnginePaths({ dataDir: workdir });
      await ensureSfxBank(paths);
      core = new EngineCore(
        { port: 4004, maxRenderWorkers: 1, paths },
        paths,
        { enableWatcher: false }
      );
      await core.init();

      // Seed two minimal 2-second scenes (background + kineticText, with one pop cue each)
      const scene1: SceneSpecInput = {
        schemaVersion: 1,
        id: "scene-comp-1",
        name: "Composer Scene 1",
        canvas: { shape: "16:9", scale: 1080 },
        durationMs: 2000,
        layers: [
          { id: "bg1", type: "background", variant: { variant: "solid", color: "#0a0f1d" } },
          {
            id: "text1",
            type: "kineticText",
            at: 200,
            text: "Scene One",
            sizePx: 72,
            fill: "#38bdf8",
            position: { xPct: 50, yPct: 50 },
          },
        ],
        audio: {
          cues: [{ id: "cue1", sfx: "pop", at: 300, gain: 0.8, pan: 0 }],
        },
      };
      await core.saveScene(scene1);

      const scene2: SceneSpecInput = {
        schemaVersion: 1,
        id: "scene-comp-2",
        name: "Composer Scene 2",
        canvas: { shape: "16:9", scale: 1080 },
        durationMs: 2000,
        layers: [
          { id: "bg2", type: "background", variant: { variant: "solid", color: "#160b22" } },
          {
            id: "text2",
            type: "kineticText",
            at: 200,
            text: "Scene Two",
            sizePx: 72,
            fill: "#ec4899",
            position: { xPct: 50, yPct: 50 },
          },
        ],
        audio: {
          cues: [{ id: "cue2", sfx: "pop", at: 300, gain: 0.8, pan: 0 }],
        },
      };
      await core.saveScene(scene2);
    });

    afterAll(async () => {
      if (core) {
        await core.dispose();
      }
      await fsp.rm(workdir, { recursive: true, force: true });
    });

    // 5. Two minimal 2-second scenes rendered at quality: preview, composed with 500 ms fade
    it(
      "renders and composes two scenes with 500ms fade into verified master MP4",
      async () => {
        const input: ComposeInput = {
          outputName: "test-master-5",
          quality: "preview",
          scenes: [
            { sceneId: "scene-comp-1", transitionToNext: "fade", transitionDurationMs: 500 },
            { sceneId: "scene-comp-2", transitionToNext: "cut" },
          ],
          wait: true,
        };

        const report = (await core.composeStoryboardVideo(input)) as ComposeReport;

        expect(report.outputPath).toMatch(/test-master-5\.mp4$/);
        expect(report.scenes).toHaveLength(2);
        expect(report.scenes[0]!.renderWallMs).toBeGreaterThan(0);
        expect(report.scenes[1]!.renderWallMs).toBeGreaterThan(0);
        expect(report.scenes[0]!.frames).toBeGreaterThan(0);
        expect(report.scenes[1]!.frames).toBeGreaterThan(0);

        // Probe verification
        const probe = await probeMedia(report.outputPath);
        expect(probe.durationSec).toBeGreaterThanOrEqual(3.35);
        expect(probe.durationSec).toBeLessThanOrEqual(3.65); // 3.5 s +/- 0.15

        const videoStream = probe.streams.find((s) => s.type === "video");
        const audioStream = probe.streams.find((s) => s.type === "audio");

        expect(videoStream).toBeDefined();
        expect(videoStream?.codec).toBe("h264");
        expect(videoStream?.width).toBe(640);
        expect(videoStream?.height).toBe(360);

        expect(audioStream).toBeDefined();
        expect(audioStream?.codec).toBe("aac");

        expect(probe.sizeBytes).toBeGreaterThan(10 * 1024); // > 10 KB
      },
      90_000
    );

    // 6. wait: false returns a jobId; getRenderStatus(jobId) eventually reports succeeded
    it(
      "supports wait: false, returning jobId and completing in background",
      async () => {
        const input: ComposeInput = {
          outputName: "test-master-6",
          quality: "preview",
          scenes: [
            { sceneId: "scene-comp-1", transitionToNext: "fade", transitionDurationMs: 500 },
            { sceneId: "scene-comp-2", transitionToNext: "cut" },
          ],
          wait: false,
        };

        const initRes = (await core.composeStoryboardVideo(input)) as {
          jobId: string;
          status: string;
        };

        expect(initRes.jobId).toMatch(/^compose-/);
        expect(initRes.status).toBe("running");

        const started = Date.now();
        let job = core.getRenderStatus(initRes.jobId);
        expect(job).toBeDefined();

        while (job && (job.status === "queued" || job.status === "running")) {
          if (Date.now() - started > 60_000) {
            throw new Error(`compose job ${initRes.jobId} timed out after 60s`);
          }
          await new Promise((r) => setTimeout(r, 500));
          job = core.getRenderStatus(initRes.jobId);
        }

        expect(job?.status).toBe("succeeded");
        expect(job?.result).toBeDefined();
        expect(job?.result?.mp4Path).toMatch(/test-master-6\.mp4$/);

        const stat = await fsp.stat(job!.result!.mp4Path);
        expect(stat.size).toBeGreaterThan(10 * 1024);

        // Verify getRenderResult works for the finished compose job
        const renderResult = await core.getRenderResult(initRes.jobId);
        expect(renderResult.status).toBe("succeeded");
        expect(renderResult.outputPath).toBe(job!.result!.mp4Path);
        expect(renderResult.probe).toBeDefined();
        expect(renderResult.probe?.durationSec).toBeGreaterThanOrEqual(3.35);
      },
      90_000
    );
  });
});
