import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import type { EngineConfig, EnginePaths } from "./config.js";
import { profileFor } from "./encoder.js";
import { runFfmpeg } from "./encoder.js";
import { probeMedia } from "./media-probe.js";
import type { MediaProbeReport } from "@motionforge/scene-spec";
import type { RenderJob, RenderQuality, RenderRunner } from "./render-runner.js";
import type { SceneStore } from "./scene-store.js";

export const COMPOSE_TRANSITIONS = [
  "cut",
  "fade",
  "wipeleft",
  "slideright",
  "smoothleft",
  "circleopen",
] as const;

export type ComposeTransition = (typeof COMPOSE_TRANSITIONS)[number];

export const composeTransitionSchema = z.enum(COMPOSE_TRANSITIONS);

export interface ComposeSceneInput {
  sceneId: string;
  transitionToNext?: ComposeTransition; // default "fade"
  transitionDurationMs?: number; // 0..1500, default 500
}

export const composeSceneInputSchema = z.strictObject({
  sceneId: z.string().min(1).describe("The stored scene ID"),
  transitionToNext: composeTransitionSchema
    .default("fade")
    .describe("Transition into the next scene (default: fade)"),
  transitionDurationMs: z
    .number()
    .int()
    .min(0)
    .max(1500)
    .default(500)
    .describe("Transition duration in milliseconds (0..1500, default 500)"),
});

export interface ComposeInput {
  outputName?: string; // 1..80, default "storyboard-master"
  scenes: ComposeSceneInput[]; // 1..10
  quality?: "preview" | "draft" | "production"; // default "draft"
  wait?: boolean; // default true
}

export const composeInputSchema = z.strictObject({
  outputName: z
    .string()
    .min(1)
    .max(80)
    .default("storyboard-master")
    .describe("Output filename slug without extension (default: storyboard-master)"),
  scenes: z
    .array(composeSceneInputSchema)
    .min(1)
    .max(10)
    .describe("Sequential list of scenes to render and compose (1..10)"),
  quality: z
    .enum(["preview", "draft", "production"])
    .default("draft")
    .describe("Render quality profile: preview = 360p/12, draft = 720p/30, production = full canvas/60"),
  wait: z
    .boolean()
    .default(true)
    .describe("Wait for composition to complete (default true); false returns jobId immediately"),
});

export interface ComposeSceneResult {
  sceneId: string;
  mp4Path: string;
  durationMs: number;
  renderWallMs: number;
  frames: number;
  workerCount: number;
  capturedFrames: number;
  reusedStaticFrames: number;
  captureMsPerFrame: number;
  transitionToNext: ComposeTransition;
  transitionDurationMs: number;
}

export interface ComposeReport {
  jobId: string;
  outputPath: string;
  durationMs: number;
  totalWallMs: number;
  quality: string;
  scenes: ComposeSceneResult[];
  probe: MediaProbeReport;
  telemetry: {
    capturedFrames: number;
    reusedStaticFrames: number;
    captureMsPerFrame: number;
  };
}

export interface PlannedTransition {
  index: number;
  fromSceneId: string;
  toSceneId: string;
  transition: ComposeTransition;
  durationMs: number;
  durationSec: number;
  offsetSec: number;
  offsetMs: number;
}

export interface StoryboardPlan {
  totalDurationMs: number;
  totalDurationSec: number;
  totalDuration: number;
  offsets: number[];
  offsetsMs: number[];
  transitions: PlannedTransition[];
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "storyboard-master";
}

/**
 * Pure planner that computes total durations and every xfade offset across scenes.
 * Durations can be provided in milliseconds or seconds.
 */
export function planStoryboardCompose(
  input: ComposeInput | ComposeSceneInput[] | { scenes: ComposeSceneInput[] },
  durations: number[]
): StoryboardPlan {
  const scenes: ComposeSceneInput[] = Array.isArray(input) ? input : input.scenes;
  if (!scenes || scenes.length === 0) {
    throw new Error("Cannot plan composition with 0 scenes");
  }
  if (durations.length !== scenes.length) {
    throw new Error(
      `durations length (${durations.length}) must match scenes length (${scenes.length})`
    );
  }

  // Detect whether durations are passed in seconds or milliseconds
  // Scene durations in ms are never <= 60ms; if all are <= 60, they were passed in seconds.
  const isSeconds = durations.every((d) => d <= 60);
  const durationsSec = isSeconds ? [...durations] : durations.map((d) => d / 1000);
  const durationsMs = isSeconds ? durations.map((d) => Math.round(d * 1000)) : [...durations];

  if (scenes.length === 1) {
    const totalSec = Number(durationsSec[0]!.toFixed(3));
    const totalMs = durationsMs[0]!;
    return {
      totalDurationMs: totalMs,
      totalDurationSec: totalSec,
      totalDuration: totalSec,
      offsets: [],
      offsetsMs: [],
      transitions: [],
    };
  }

  const transitions: PlannedTransition[] = [];
  const offsets: number[] = [];
  const offsetsMs: number[] = [];

  let currentCompositeEndSec = durationsSec[0]!;

  for (let i = 0; i < scenes.length - 1; i++) {
    const sceneA = scenes[i]!;
    const sceneB = scenes[i + 1]!;
    const transType: ComposeTransition = sceneA.transitionToNext ?? "fade";

    let transDurationMs = sceneA.transitionDurationMs ?? 500;
    // If cut, effective transition duration for the timeline is 0
    if (transType === "cut") {
      transDurationMs = 0;
    } else {
      // Validate transitionDurationMs < min(adjacent scene durations) - 100
      const minAdjacentMs = Math.min(durationsMs[i]!, durationsMs[i + 1]!);
      if (transDurationMs >= minAdjacentMs - 100) {
        throw new Error(
          `Transition duration (${transDurationMs}ms) between scene ${i} ("${sceneA.sceneId}") and scene ${i + 1} ("${sceneB.sceneId}") must be less than min(adjacent scene durations) - 100ms (${minAdjacentMs - 100}ms)`
        );
      }
    }

    const transDurationSec = transDurationMs / 1000;

    // offset_k = sum(duration_0..k) - sum(transition_0..k-1) - transition_k
    const offsetSec = Number((currentCompositeEndSec - transDurationSec).toFixed(3));
    const offsetMs = Math.round(offsetSec * 1000);

    offsets.push(offsetSec);
    offsetsMs.push(offsetMs);

    transitions.push({
      index: i,
      fromSceneId: sceneA.sceneId,
      toSceneId: sceneB.sceneId,
      transition: transType,
      durationMs: transDurationMs,
      durationSec: transDurationSec,
      offsetSec,
      offsetMs,
    });

    currentCompositeEndSec = offsetSec + durationsSec[i + 1]!;
  }

  const totalDurationSec = Number(currentCompositeEndSec.toFixed(3));
  const totalDurationMs = Math.round(totalDurationSec * 1000);

  return {
    totalDurationMs,
    totalDurationSec,
    totalDuration: totalDurationSec,
    offsets,
    offsetsMs,
    transitions,
  };
}

export class StoryboardComposer {
  constructor(
    private readonly store: SceneStore,
    private readonly runner: RenderRunner,
    private readonly paths: EnginePaths,
    private readonly config: EngineConfig,
    private readonly log: (msg: string) => void
  ) {}

  async compose(
    input: ComposeInput,
    job?: RenderJob
  ): Promise<ComposeReport> {
    const started = Date.now();
    const scenes = input.scenes;
    if (!scenes || scenes.length === 0) {
      throw new Error("composeStoryboardVideo requires at least 1 scene");
    }
    if (scenes.length > 10) {
      throw new Error("composeStoryboardVideo allows at most 10 scenes");
    }

    const quality: RenderQuality = input.quality ?? "draft";
    const outNameSlug = slug(input.outputName ?? "storyboard-master");
    const outputPath = path.join(this.paths.rendersDir, `${outNameSlug}.mp4`);

    // Verify all scenes exist and validate pre-render durations
    const storedScenes = scenes.map((s) => this.store.require(s.sceneId).scene);
    const initialDurationsMs = storedScenes.map((s) => s.durationMs);
    planStoryboardCompose(scenes, initialDurationsMs);

    const firstScene = storedScenes[0]!;
    const profile = profileFor(quality, firstScene);

    const sceneResults: ComposeSceneResult[] = [];
    const tempFilesToClean: string[] = [];

    try {
      // Step 1: Render scenes strictly sequentially
      for (let i = 0; i < scenes.length; i++) {
        const sceneInput = scenes[i]!;
        this.log(
          `[StoryboardComposer] (${i + 1}/${scenes.length}) rendering "${sceneInput.sceneId}" at ${quality}`
        );

        if (job) {
          job.progress = Number(((i / scenes.length) * 0.8).toFixed(2));
        }

        const renderJob = this.runner.enqueue(sceneInput.sceneId, quality);

        // Await completion or failure of THIS specific job id
        await new Promise<void>((resolve, reject) => {
          if (renderJob.status === "succeeded") {
            resolve();
            return;
          }
          if (renderJob.status === "failed") {
            reject(new Error(renderJob.error || `Render job ${renderJob.id} failed`));
            return;
          }

          const onCompleted = (payload: { jobId: string; sceneId: string; outputPath: string; durationMs: number }) => {
            if (payload.jobId === renderJob.id) {
              cleanup();
              resolve();
            }
          };
          const onFailed = (payload: { jobId: string; sceneId: string; error: string }) => {
            if (payload.jobId === renderJob.id) {
              cleanup();
              reject(new Error(payload.error || `Render job ${renderJob.id} failed`));
            }
          };
          const cleanup = () => {
            this.runner.off("completed", onCompleted);
            this.runner.off("failed", onFailed);
          };

          this.runner.on("completed", onCompleted);
          this.runner.on("failed", onFailed);
        });

        if (!renderJob.result) {
          throw new Error(`Render job ${renderJob.id} completed without a result payload`);
        }

        const segProbe = await probeMedia(renderJob.result.mp4Path);
        const transToNext = sceneInput.transitionToNext ?? "fade";
        const transDurMs = transToNext === "cut" ? 0 : (sceneInput.transitionDurationMs ?? 500);

        sceneResults.push({
          sceneId: sceneInput.sceneId,
          mp4Path: renderJob.result.mp4Path,
          durationMs: Math.round(segProbe.durationSec * 1000),
          renderWallMs: renderJob.result.wallMs,
          frames: renderJob.result.frames,
          workerCount: renderJob.result.workerCount,
          capturedFrames: renderJob.result.capturedFrames,
          reusedStaticFrames: renderJob.result.reusedStaticFrames,
          captureMsPerFrame: renderJob.result.captureMsPerFrame,
          transitionToNext: transToNext,
          transitionDurationMs: transDurMs,
        });
      }

      if (job) {
        job.progress = 0.85;
      }

      // Step 2: Probe every segment for real duration and verify geometry consistency
      const probedSegments: Array<{
        path: string;
        probe: MediaProbeReport;
        hasAudio: boolean;
        durationSec: number;
        width: number;
        height: number;
        fps: number;
      }> = [];

      for (let i = 0; i < sceneResults.length; i++) {
        const res = sceneResults[i]!;
        const probe = await probeMedia(res.mp4Path);
        const vStream = probe.streams.find((s) => s.type === "video");
        if (!vStream || !vStream.width || !vStream.height || !vStream.fps) {
          throw new Error(
            `Rendered segment for "${res.sceneId}" has invalid video stream properties (${res.mp4Path})`
          );
        }

        if (i === 0) {
          probedSegments.push({
            path: res.mp4Path,
            probe,
            hasAudio: probe.streams.some((s) => s.type === "audio"),
            durationSec: probe.durationSec,
            width: vStream.width,
            height: vStream.height,
            fps: vStream.fps,
          });
        } else {
          const first = probedSegments[0]!;
          if (
            vStream.width !== first.width ||
            vStream.height !== first.height ||
            vStream.fps !== first.fps
          ) {
            throw new Error(
              `Rendered segment for "${res.sceneId}" geometry mismatch: ${vStream.width}x${vStream.height}@${vStream.fps}fps vs expected ${first.width}x${first.height}@${first.fps}fps`
            );
          }
          probedSegments.push({
            path: res.mp4Path,
            probe,
            hasAudio: probe.streams.some((s) => s.type === "audio"),
            durationSec: probe.durationSec,
            width: vStream.width,
            height: vStream.height,
            fps: vStream.fps,
          });
        }
      }

      // Re-plan with probed real durations
      const realDurationsMs = probedSegments.map((s) => Math.round(s.durationSec * 1000));
      const plan = planStoryboardCompose(scenes, realDurationsMs);

      // Step 3: Normalize missing audio inputs
      const normalizedSegments: Array<{
        path: string;
        durationSec: number;
        originallyHadAudio: boolean;
      }> = [];

      for (let i = 0; i < probedSegments.length; i++) {
        const seg = probedSegments[i]!;
        if (!seg.hasAudio) {
          const tempSilent = path.join(
            os.tmpdir(),
            `silent-${randomUUID().slice(0, 8)}-${i}.mp4`
          );
          tempFilesToClean.push(tempSilent);
          await runFfmpeg(
            [
              "-i",
              seg.path,
              "-f",
              "lavfi",
              "-t",
              String(seg.durationSec),
              "-i",
              "anullsrc=r=48000:cl=stereo",
              "-map",
              "0:v:0",
              "-map",
              "1:a:0",
              "-c:v",
              "copy",
              "-c:a",
              "aac",
              "-b:a",
              "192k",
              "-shortest",
              tempSilent,
            ],
            `normalize audio ${i}`
          );
          normalizedSegments.push({
            path: tempSilent,
            durationSec: seg.durationSec,
            originallyHadAudio: false,
          });
        } else {
          normalizedSegments.push({
            path: seg.path,
            durationSec: seg.durationSec,
            originallyHadAudio: true,
          });
        }
      }

      // Step 4: Stitching
      // Handle single-scene input
      if (scenes.length === 1) {
        const single = normalizedSegments[0]!;
        if (!single.originallyHadAudio) {
          await fsp.copyFile(single.path, outputPath);
        } else {
          await runFfmpeg(
            ["-i", single.path, "-c", "copy", "-movflags", "+faststart", outputPath],
            "copy single scene"
          );
        }
      } else {
        const allCuts = scenes
          .slice(0, -1)
          .every((s) => (s.transitionToNext ?? "fade") === "cut");
        const allOriginallyHadAudio = normalizedSegments.every((s) => s.originallyHadAudio);

        if (allCuts && allOriginallyHadAudio) {
          // Fast concat demuxer
          const partsTxtPath = path.join(
            os.tmpdir(),
            `parts-${randomUUID().slice(0, 8)}.txt`
          );
          tempFilesToClean.push(partsTxtPath);
          const partsBody = normalizedSegments
            .map((s) => `file '${s.path.replace(/'/g, "'\\''")}'`)
            .join("\n");
          await fsp.writeFile(partsTxtPath, partsBody, "utf8");

          await runFfmpeg(
            [
              "-f",
              "concat",
              "-safe",
              "0",
              "-i",
              partsTxtPath,
              "-c",
              "copy",
              "-movflags",
              "+faststart",
              outputPath,
            ],
            "concat scenes"
          );
        } else {
          // Filter complex with xfade and acrossfade
          const inputArgs: string[] = [];
          for (const s of normalizedSegments) {
            inputArgs.push("-i", s.path);
          }

          const videoFilters: string[] = [];
          const audioFilters: string[] = [];

          for (let i = 0; i < plan.transitions.length; i++) {
            const trans = plan.transitions[i]!;
            const inVLabel = i === 0 ? "0:v" : `v${i}`;
            const nextVLabel = `${i + 1}:v`;
            const outVLabel = `v${i + 1}`;

            const inALabel = i === 0 ? "0:a" : `a${i}`;
            const nextALabel = `${i + 1}:a`;
            const outALabel = `a${i + 1}`;

            let tName: string = trans.transition;
            let dSec = trans.durationSec;
            let oSec = trans.offsetSec;

            if (trans.transition === "cut") {
              tName = "fade";
              dSec = 0.001;
              oSec = Math.max(0, oSec - 0.001);
            }

            videoFilters.push(
              `[${inVLabel}][${nextVLabel}]xfade=transition=${tName}:duration=${dSec.toFixed(3)}:offset=${oSec.toFixed(3)}[${outVLabel}]`
            );
            audioFilters.push(
              `[${inALabel}][${nextALabel}]acrossfade=d=${dSec.toFixed(3)}:c1=tri:c2=tri[${outALabel}]`
            );
          }

          const lastVLabel = `v${plan.transitions.length}`;
          const lastALabel = `a${plan.transitions.length}`;
          const filterComplex = [...videoFilters, ...audioFilters].join(";");

          await runFfmpeg(
            [
              ...inputArgs,
              "-filter_complex",
              filterComplex,
              "-map",
              `[${lastVLabel}]`,
              "-map",
              `[${lastALabel}]`,
              "-c:v",
              "libx264",
              "-pix_fmt",
              "yuv420p",
              "-preset",
              "veryfast",
              "-crf",
              "20",
              "-c:a",
              "aac",
              "-b:a",
              "192k",
              "-movflags",
              "+faststart",
              outputPath,
            ],
            "stitch storyboard xfade"
          );
        }
      }

      // Step 5: Final probe and report assembly
      const finalProbe = await probeMedia(outputPath);
      const totalWallMs = Date.now() - started;
      const totalFrames = Math.max(
        1,
        Math.round(finalProbe.durationSec * profile.fps)
      );

      const capturedFrames = sceneResults.reduce((sum, scene) => sum + scene.capturedFrames, 0);
      const reusedStaticFrames = sceneResults.reduce((sum, scene) => sum + scene.reusedStaticFrames, 0);
      const captureMsTotal = sceneResults.reduce(
        (sum, scene) => sum + scene.captureMsPerFrame * scene.capturedFrames,
        0
      );
      const telemetry = {
        capturedFrames,
        reusedStaticFrames,
        captureMsPerFrame: capturedFrames > 0 ? captureMsTotal / capturedFrames : 0,
      };

      if (job) {
        job.status = "succeeded";
        job.progress = 1;
        job.result = {
          mp4Path: outputPath,
          mp4Url: `/api/renders/${job.id}/file`,
          frames: totalFrames,
          wallMs: totalWallMs,
          effectiveFps: Number((totalFrames / (totalWallMs / 1000)).toFixed(2)),
          encoder: "ffmpeg xfade",
          workerCount: 1,
          profile,
          ...telemetry,
        };
      }

      const report: ComposeReport = {
        jobId: job?.id ?? `compose-${randomUUID().slice(0, 8)}`,
        outputPath,
        durationMs: Math.round(finalProbe.durationSec * 1000),
        totalWallMs,
        quality,
        scenes: sceneResults,
        probe: finalProbe,
        telemetry,
      };

      return report;
    } catch (error) {
      if (job) {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : String(error);
      }
      throw error;
    } finally {
      await Promise.all(
        tempFilesToClean.map((f) => fsp.rm(f, { force: true }).catch(() => undefined))
      );
    }
  }
}
