import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AudioCue, MusicTrack } from "@motionforge/scene-spec";

const execFileP = promisify(execFile);
import { resolveCanvasSize, type SceneSpec } from "@motionforge/scene-spec";
import type { EnginePaths } from "./config.js";
import { DRAFT_FPS, DRAFT_HEIGHT, PRODUCTION_FPS } from "./config.js";
import { resolveAssetSource } from "./vault.js";

// ---------------------------------------------------------------------------
// Run helper
// ---------------------------------------------------------------------------

export class FfmpegError extends Error {
  constructor(message: string, readonly stderrTail: string) {
    super(message);
    this.name = "FfmpegError";
  }
}

export function runFfmpeg(args: string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += String(d)));
    proc.on("error", (e) => reject(new FfmpegError(`ffmpeg spawn failed (${label}): ${e.message}`, "")));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new FfmpegError(`ffmpeg failed (${label}): ${stderr.slice(-600)}`, stderr.slice(-2000)));
    });
  });
}

/** Write a frame buffer to an ffmpeg stdin with backpressure. */
export class StdinWriter {
  private drained = true;

  constructor(private readonly proc: ReturnType<typeof spawn>) {}

  async write(chunk: Buffer): Promise<void> {
    const stdin = this.proc.stdin;
    if (!stdin || stdin.destroyed) throw new Error("encoder stdin closed");
    this.drained = stdin.write(chunk);
    if (!this.drained) {
      await new Promise<void>((resolve) => stdin.once("drain", resolve));
    }
  }
}

// ---------------------------------------------------------------------------
// Hardware encoder detection
// ---------------------------------------------------------------------------

export function encoderArgs(encoder: string, quality: "draft" | "production"): string[] {
  switch (encoder) {
    case "h264_nvenc":
      return ["-c:v", "h264_nvenc", "-preset", quality === "draft" ? "p2" : "p5", "-rc", "vbr", "-cq", quality === "draft" ? "30" : "21", "-b:v", "0"];
    case "h264_qsv":
      return quality === "draft" ? ["-c:v", "h264_qsv", "-b:v", "4M"] : ["-c:v", "h264_qsv", "-b:v", "14M"];
    case "h264_videotoolbox":
      return quality === "draft" ? ["-c:v", "h264_videotoolbox", "-b:v", "6M"] : ["-c:v", "h264_videotoolbox", "-b:v", "14M"];
    default:
      return quality === "draft"
        ? ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "28"]
        : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "19"];
  }
}

export async function availableEncoders(): Promise<string[]> {
  // vaapi is omitted: it needs explicit VADevice plumbing, not just an encoder probe
  const preference = ["h264_nvenc", "h264_qsv", "h264_videotoolbox", "libx264"];
  const listing = await new Promise<string>((resolve) => {
    const proc = spawn("ffmpeg", ["-hide_banner", "-encoders"]);
    let out = "";
    proc.stdout.on("data", (d) => (out += String(d)));
    proc.stderr.on("data", (d) => (out += String(d)));
    proc.on("close", () => resolve(out));
    proc.on("error", () => resolve(""));
  });
  return preference.filter((enc) => listing.includes(enc));
}

/**
 * Pick the best encoder, verifying hardware encoders with a real round-trip:
 * 15 frames to a temp file, then ffprobe frame-count verification. Listing an
 * encoder (or seeing encoded bytes) is not enough — a broken driver must fall
 * through to the next candidate.
 */
export async function pickEncoder(quality: "draft" | "production"): Promise<string> {
  const candidates = await availableEncoders();
  if (candidates.length === 0) {
    throw new FfmpegError("no H.264 encoders available", "ffmpeg -encoders returned nothing");
  }
  for (const encoder of candidates) {
    if (encoder === "libx264") return encoder;
    const probeOut = path.join(os.tmpdir(), `mf-enc-probe-${randomUUID()}.mp4`);
    try {
      await runFfmpeg(
        [
          "-f", "lavfi", "-i", "color=black:s=192x108:d=0.5", "-r", "30",
          ...encoderArgs(encoder, quality),
          "-pix_fmt", "yuv420p", "-frames:v", "15",
          probeOut,
        ],
        `probe ${encoder}`
      );
      const { stdout } = await execFileP("ffprobe", [
        "-v", "error", "-count_frames", "-select_streams", "v:0",
        "-show_entries", "stream=nb_read_frames", "-of", "default=nk=1:nw=1", probeOut,
      ]);
      if (Number(stdout.trim()) >= 15) return encoder;
    } catch {
      // fall through to the next candidate
    } finally {
      await rm(probeOut, { force: true }).catch(() => undefined);
    }
  }
  return "libx264";
}

// ---------------------------------------------------------------------------
// Quality profiles
// ---------------------------------------------------------------------------

export interface RenderProfile {
  quality: "draft" | "production";
  fps: number;
  /** encoded output size (canvas aspect preserved) */
  outWidth: number;
  outHeight: number;
  jpegQuality: number;
}

export function profileFor(quality: "draft" | "production", scene: SceneSpec): RenderProfile {
  const { width, height } = resolveCanvasSize(scene.canvas);
  if (quality === "draft") {
    // scale the short side to DRAFT_HEIGHT, keep aspect, even-ify for yuv420p
    const scale = DRAFT_HEIGHT / Math.min(width, height);
    return {
      quality,
      fps: DRAFT_FPS,
      outWidth: Math.round((width * scale) / 2) * 2,
      outHeight: Math.round((height * scale) / 2) * 2,
      jpegQuality: 80,
    };
  }
  return {
    quality,
    fps: PRODUCTION_FPS,
    outWidth: width,
    outHeight: height,
    jpegQuality: 92,
  };
}

// ---------------------------------------------------------------------------
// Audio graph (music + millisecond SFX cues)
// ---------------------------------------------------------------------------

export interface AudioGraph {
  inputArgs: string[];
  filterComplex: string;
  /** output label of the mixed audio, or null when the scene has no audio */
  outLabel: string | null;
}

export function buildAudioGraph(
  scene: SceneSpec,
  paths: EnginePaths,
  durationSec: number
): AudioGraph {
  const music: MusicTrack | undefined = scene.audio.music;
  // absolute cues + layer-relative shorthand cues, merged and sorted by time
  const cues: AudioCue[] = [
    ...scene.audio.cues,
    ...scene.layers.flatMap((layer) =>
      (layer.sfx ?? []).map((trigger) => ({
        at: layer.at + trigger.offsetMs,
        sfx: trigger.sfx,
        gain: trigger.gain,
        pan: trigger.pan,
      }))
    ),
  ].sort((a, b) => a.at - b.at);

  if (!music && cues.length === 0) {
    return { inputArgs: [], filterComplex: "", outLabel: null };
  }

  const inputArgs: string[] = [];
  const chains: string[] = [];
  let inputIndex = 0;

  if (music) {
    const src = resolveAssetSource(paths, scene.assets.find((a) => a.id === music.assetId)?.src ?? "");
    inputArgs.push("-i", src);
    const fades: string[] = [];
    if (music.fadeInMs > 0) fades.push(`afade=t=in:st=0:d=${(music.fadeInMs / 1000).toFixed(3)}`);
    if (music.fadeOutMs > 0) {
      fades.push(`afade=t=out:st=${Math.max(0, durationSec - music.fadeOutMs / 1000).toFixed(3)}:d=${(music.fadeOutMs / 1000).toFixed(3)}`);
    }
    const chain =
      `[${inputIndex}:a]` +
      `atrim=0:${durationSec.toFixed(3)},` +
      (music.normalize ? "loudnorm=I=-21:TP=-1.5:LRA=11," : "") +
      `volume=${music.gain},` +
      fades.join(",") +
      // pad short music, clamp long music — every chain spans the scene exactly
      `,apad=whole_dur=${durationSec.toFixed(3)},atrim=end=${durationSec.toFixed(3)}` +
      `[m${inputIndex}]`;
    chains.push(chain);
    inputIndex++;
  }

  for (const [i, cue] of cues.entries()) {
    const delayMs = cue.at;
    const file = resolveAssetSource(paths, `vault:_sfx/${cue.sfx}.ogg`);
    inputArgs.push("-i", file);
    chains.push(
      `[${inputIndex}:a]volume=${cue.gain},` +
        `adelay=${delayMs}:all=1` +
        (Math.abs(cue.pan) > 0.01 ? `,pan=stereo:c0=c0*${1 - Math.max(0, cue.pan) * 0.7}:c1=c1*${1 - Math.max(0, -cue.pan) * 0.7}` : "") +
        `,apad=whole_dur=${durationSec.toFixed(3)},atrim=end=${durationSec.toFixed(3)}` +
        `[s${i}]`
    );
    inputIndex++;
  }

  const mixLabels: string[] = [];
  if (music) mixLabels.push("[m0]");
  cues.forEach((_, i) => mixLabels.push(`[s${i}]`));

  if (mixLabels.length === 1) {
    // single source: no amix needed — alias it as the output
    return {
      inputArgs,
      filterComplex: chains.join(";").replace(/\[(m0|s0)\]$/, "[aout]"),
      outLabel: "aout",
    };
  }

  return {
    inputArgs,
    filterComplex:
      `${chains.join(";")};${mixLabels.join("")}` +
      `amix=inputs=${mixLabels.length}:normalize=0:duration=longest,` +
      `loudnorm=I=-16:TP=-1.5:LRA=11,` +
      // pad to the scene length, then hard-clamp (loudnorm adds a few frames of latency)
      `apad=whole_dur=${durationSec.toFixed(3)},atrim=end=${durationSec.toFixed(3)}[aout]`,
    outLabel: "aout",
  };
}
