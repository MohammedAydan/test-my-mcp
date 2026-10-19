import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { EngineConfig, EnginePaths } from "./config.js";
import type { SceneSpec } from "@motionforge/scene-spec";
import {
  buildAudioGraph,
  FfmpegError,
  pickEncoder,
  profileFor,
  runFfmpeg,
  type RenderProfile,
} from "./encoder.js";
import { renderFramesParallel, RendererPool } from "./renderer.js";
import type { SceneStore } from "./scene-store.js";

export type RenderQuality = "draft" | "production";
export type RenderStatus = "queued" | "running" | "succeeded" | "failed";

export interface RenderJob {
  id: string;
  sceneId: string;
  quality: RenderQuality;
  status: RenderStatus;
  /** 0..1 */
  progress: number;
  error?: string;
  result?: {
    mp4Path: string;
    mp4Url: string;
    frames: number;
    wallMs: number;
    effectiveFps: number;
    encoder: string;
    workerCount: number;
    profile: RenderProfile;
  };
}

async function concatParts(parts: string[], jobDir: string): Promise<string> {
  // every part must be a fully-flushed, non-empty segment — an empty part here
  // means a worker lost frames, silently shortening the video
  const { statSync } = await import("node:fs");
  for (const part of parts) {
    const size = statSync(part).size;
    if (size === 0) {
      throw new FfmpegError(`worker part ${path.basename(part)} is empty (0 bytes)`, "");
    }
  }
  const listPath = path.join(jobDir, "parts.txt");
  const listBody = parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listPath, listBody, "utf8");
  const out = path.join(jobDir, "video.mp4");
  await runFfmpeg(
    ["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", out],
    "concat parts"
  );
  return out;
}

async function muxAudio(
  videoPath: string,
  graph: ReturnType<typeof buildAudioGraph>,
  outPath: string,
  scene?: SceneSpec
): Promise<void> {
  // audio inputs occupy indices 0..N-1 so filtergraph labels stay stable;
  // the (silent) video always lands right after them
  const videoIndex = graph.inputArgs.length / 2;
  const mapArgs = graph.outLabel
    ? ["-map", `${videoIndex}:v`, "-map", `[${graph.outLabel}]`, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
    : ["-map", "0:v", "-an", "-c:v", "copy"];
  try {
    await runFfmpeg(
      [
        ...graph.inputArgs,
        "-i", videoPath,
        ...(graph.outLabel ? ["-filter_complex", graph.filterComplex] : []),
        ...mapArgs,
        "-movflags", "+faststart",
        outPath,
      ],
      "mux audio"
    );
  } catch (error) {
    // "ffmpeg failed (mux audio): …" is unactionable. Name the scene, its cues
    // and the exact filtergraph so the operator knows which line to fix.
    const cues = scene?.audio.cues ?? [];
    const cueSummary =
      cues.length > 0
        ? `scene "${scene?.name}" cues: ` +
          cues.map((c, i) => `[${i}] ${c.sfx}@${c.at}ms gain=${c.gain} pan=${c.pan}`).join(", ")
        : "scene has no audio cues";
    throw new FfmpegError(
      `audio mix failed for ${cueSummary}\n` +
        `filtergraph: ${graph.filterComplex || "(none)"}\n` +
        `underlying error: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof FfmpegError ? error.stderrTail : ""
    );
  }
}

export class RenderRunner extends EventEmitter {
  private queue: RenderJob[] = [];
  private running = false;
  private readonly pool = new RendererPool();
  private readonly jobs = new Map<string, RenderJob>();

  constructor(
    private readonly config: EngineConfig,
    private readonly paths: EnginePaths,
    private readonly store: SceneStore,
    private readonly log: (msg: string) => void
  ) {
    super();
    this.setMaxListeners(0);
  }

  get jobsAll(): RenderJob[] {
    return [...this.jobs.values()].sort((a, b) => (a.id < b.id ? 1 : -1));
  }

  jobId(id: string): RenderJob | undefined {
    return this.jobs.get(id);
  }

  enqueue(sceneId: string, quality: RenderQuality): RenderJob {
    const job: RenderJob = {
      id: randomUUID().slice(0, 8),
      sceneId,
      quality,
      status: "queued",
      progress: 0,
    };
    this.jobs.set(job.id, job);
    this.queue.push(job);
    void this.drain();
    return job;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    const job = this.queue.shift();
    if (!job) return;
    this.running = true;
    try {
      job.status = "running";
      await this.execute(job);
      job.status = "succeeded";
      job.progress = 1;
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      this.log(`render ${job.id} failed: ${job.error}`);
      this.emit("failed", {
        jobId: job.id,
        sceneId: job.sceneId,
        error: job.error,
      });
    } finally {
      this.running = false;
      void this.drain();
    }
  }

  private async execute(job: RenderJob): Promise<void> {
    const started = Date.now();
    const { scene } = this.store.require(job.sceneId);
    const profile = profileFor(job.quality, scene);
    const encoder = await pickEncoder(job.quality);
    this.log(`render ${job.id}: ${scene.name} @ ${profile.outWidth}x${profile.outHeight}/${profile.fps}fps via ${encoder}`);

    const jobDir = path.join(this.paths.rendersDir, job.id);
    await mkdir(jobDir, { recursive: true });

    let framesDone = 0;
    const totalFrames = Math.max(1, Math.round((scene.durationMs / 1000) * profile.fps));
    try {
      const { partPaths, frames, workerCount } = await renderFramesParallel({
        pool: this.pool,
        scene,
        sceneId: job.sceneId,
        baseUrl: `http://127.0.0.1:${this.config.port}`,
        profile,
        encoder,
        jobDir,
        config: this.config,
        onProgress: (n) => {
          framesDone += n;
          job.progress = Math.min(0.9, framesDone / totalFrames);
          this.emit("progress", {
            jobId: job.id,
            sceneId: job.sceneId,
            progressPct: Math.round(job.progress * 100),
            currentFrame: framesDone,
            totalFrames,
          });
        },
      });

      // per-part sanity: frame counts straight from the encoded segments
      await Promise.all(
        partPaths.map(
          (p) =>
            new Promise<void>((resolve) => {
              execFile(
                "ffprobe",
                ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "default=nk=1:nw=1", p],
                (err, stdout) => {
                  this.log(
                    `render ${job.id}: ${path.basename(p)} frames=${(stdout || "").trim()}` +
                      (err ? " (probe failed)" : "")
                  );
                  resolve();
                }
              );
            })
        )
      );
      const concatPath = await concatParts(partPaths, jobDir);
      const graph = buildAudioGraph(scene, this.paths, scene.durationMs / 1000);
      const slug =
        scene.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "scene";
      const mp4Path = path.join(this.paths.rendersDir, `${job.quality}-${slug}-${job.id}.mp4`);
      await muxAudio(concatPath, graph, mp4Path, scene);

      const wallMs = Date.now() - started;
      job.result = {
        mp4Path,
        mp4Url: `/api/renders/${job.id}/file`,
        frames,
        wallMs,
        effectiveFps: Number((frames / (wallMs / 1000)).toFixed(2)),
        encoder,
        profile,
        workerCount,
      };
      this.emit("completed", {
        jobId: job.id,
        sceneId: job.sceneId,
        outputPath: mp4Path,
        durationMs: wallMs,
      });
    } finally {
      await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
