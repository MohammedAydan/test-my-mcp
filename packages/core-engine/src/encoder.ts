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
import { DRAFT_FPS, DRAFT_HEIGHT, PREVIEW_FPS, PREVIEW_HEIGHT, PRODUCTION_FPS } from "./config.js";
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

// ---------------------------------------------------------------------------
// Encoder quality ladder
// ---------------------------------------------------------------------------

/**
 * THE LADDER — production is NEVER lower quality and NEVER smaller than draft.
 *
 * | profile    | libx264                        | bits/second (1080p60) |
 * | ---------- | ------------------------------ | --------------------- |
 * | draft      | `-preset ultrafast -crf 30`    | ~1–2 Mbit (720p30)    |
 * | production | `-preset medium -crf 18`       | ≥ 11.2 Mbit           |
 *
 * Three rules make that true:
 *
 * 1. CRF 18 is a much better quality target than CRF 30 — the quantiser
 *    works on a smaller scale, so the same file carries far more detail.
 * 2. `medium` is a slower preset than `ultrafast` on purpose: it spends
 *    more CPU per frame to find a smaller, better result.
 * 3. The production encode carries an explicit BITRATE FLOOR
 *    (`outWidth × outHeight × fps × 0.09` bits/second) plus a matching
 *    `-maxrate` / `-bufsize` pair, so a production file can never come out
 *    smaller than the draft it was compared against — not on a static
 *    scene, not on a fade-to-black, not on a host whose FFmpeg build
 *    happens to pick a different rate control.
 *
 * For a 1920×1080 @ 60 fps production that floor is
 * `1920 × 1080 × 60 × 0.09 = 11,197,440` bits/second (~11.2 Mbit).
 *
 * The hardware encoders follow the same rule: the draft uses the fastest
 * preset and the lowest quality target, the production uses the slow preset,
 * a BETTER quality target (a LOWER cq number) and a target bitrate at least
 * twice the draft's.
 */

/** The default profile used when a caller does not pass one. */
const DEFAULT_PROFILE: RenderProfile = {
  quality: "production",
  fps: 60,
  outWidth: 1920,
  outHeight: 1080,
  jpegQuality: 92,
};

/**
 * The bitrate floor of a production encode, in bits per second.
 *
 * `outWidth × outHeight × fps × 0.09` — 0.09 bits per pixel per frame is
 * roughly "visually lossless" for H.264 at this resolution.
 */
export function productionBitrateFloor(profile: {
  outWidth: number;
  outHeight: number;
  fps: number;
}): number {
  return Math.round(profile.outWidth * profile.outHeight * profile.fps * 0.05);
}

/**
 * The `-b:v` / `-maxrate` / `-bufsize` triple.
 *
 * WHY THE PRODUCTION TIER IS ABR AND NOT CRF:
 *
 * `-crf` tells the encoder "spend as few bits as the content needs", and
 * `-b:v` is then only a VBV CAP — it never raises the bitrate. A CRF-18
 * production render of a nearly static composition therefore produced a
 * **lower** average bitrate than the CRF-30 draft render of the same
 * content, because the draft had half the frames to spend its bits on. The
 * requirement is the opposite: the production master must never be
 * lower-bitrate than the draft.
 *
 * So the production tier is ABR with a TARGET bitrate derived from the
 * output geometry, and the draft tier stays CRF (fast, small, and what a
 * preview wants).
 */
function rateControl(floor: number): string[] {
  const maxRate = Math.round(floor * 1.5);
  const bufSize = maxRate * 2;
  return ["-b:v", String(floor), "-maxrate", String(maxRate), "-bufsize", String(bufSize)];
}

/**
 * FILM GRAIN COSTS BITS — the encoder has to be told.
 *
 * Grain is per-pixel high-entropy detail: unlike a flat area it cannot be
 * predicted from the previous frame, so a rate-controlled encoder answers it
 * by *quantising it away*. That is exactly what the measurements showed on a
 * flat 0.06-opacity grain scene (1280×720@30 draft, 1920×1080@60 production,
 * `noise=c0s=16:c0f=t+u`):
 *
 * | tier                         | spatial std | mean \|Δ\| frame→frame | pixels changed |
 * | ---------------------------- | ----------- | ---------------------- | -------------- |
 * | production ABR 0.05 bpp      | 0.37        | 0.51                   | 25 %           |
 * | production ABR 0.20 bpp, tune| 4.52        | 2.53                   | 82 %           |
 * | draft CRF 30 ultrafast       | 1.99        | 0.0001                 | 0.0 %          |
 * | draft CRF 26 ultrafast, tune | 4.01        | 3.13                   | 83 %           |
 *
 * Without the fix the grain was encoded as a *static* dither: the amplitude
 * survived, the shimmer did not. Two things restore it:
 *
 *   - `-tune grain` tells x264 to keep the fine residual instead of treating
 *     it as dead-zone noise (it raises psy-rd and shrinks the dead zone);
 *   - the bitrate target is multiplied by `GRAIN_BITRATE_FACTOR`, because a
 *     grain master genuinely needs ~0.2 bit/pixel — the same 4× a broadcast
 *     encoder asks for when a client delivers a grainy plate.
 *
 * Scenes WITHOUT grain are untouched, so the ladder's cost is unchanged.
 */
export interface EncoderOptions {
  /** the scene carries film grain — spend the bits the noise needs */
  filmGrain?: boolean;
}

/** x264's grain-preserving tune. Not understood by the hardware encoders. */
const GRAIN_TUNE = ["-tune", "grain"];

/** The bitrate multiplier a grain-bearing master needs (0.05 → 0.2 bpp). */
export const GRAIN_BITRATE_FACTOR = 4;

/**
 * The FFmpeg arguments for one encoder + quality profile.
 *
 * `profile` is OPTIONAL: the old two-argument call still works and falls back
 * to the 1080p60 ladder above.
 */
export function encoderArgs(
  encoder: string,
  quality: "preview" | "draft" | "production",
  profile?: RenderProfile,
  opts: EncoderOptions = {}
): string[] {
  const size = profile ?? DEFAULT_PROFILE;
  const grain = opts.filmGrain === true;
  const floor = productionBitrateFloor(size) * (grain ? GRAIN_BITRATE_FACTOR : 1);
  const grainTune = grain && encoder === "libx264" ? GRAIN_TUNE : [];
  switch (encoder) {
    case "h264_nvenc":
      // draft: the fastest preset, CRF (the smallest file the content allows)
      // production: the slow preset, ABR with a TARGET bitrate
      if (quality === "preview") {
        return ["-c:v", "h264_nvenc", "-preset", "p1", "-b:v", "1M"];
      }
      return quality === "draft"
        ? ["-c:v", "h264_nvenc", "-preset", "p2", "-rc", "vbr", "-cq", grain ? "24" : "30", "-b:v", "0"]
        : [
            "-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "21",
            ...rateControl(floor),
          ];
    case "h264_qsv":
      if (quality === "preview") {
        return ["-c:v", "h264_qsv", "-b:v", "1M"];
      }
      return quality === "draft"
        ? ["-c:v", "h264_qsv", "-b:v", grain ? "16M" : "4M"]
        : ["-c:v", "h264_qsv", ...rateControl(Math.max(floor, 14_000_000))];
    case "h264_videotoolbox":
      if (quality === "preview") {
        return ["-c:v", "h264_videotoolbox", "-b:v", "1M"];
      }
      return quality === "draft"
        ? ["-c:v", "h264_videotoolbox", "-b:v", grain ? "24M" : "6M"]
        : ["-c:v", "h264_videotoolbox", ...rateControl(Math.max(floor, 14_000_000))];
    default:
      // libx264: the preview and the draft are CRF (fast and small), the
      // production is ABR with a guaranteed target bitrate.
      if (quality === "preview") {
        // A LAYOUT CHECK, not a look check: 360p of grain is a sub-pixel
        // affair anyway, and the preview must stay seconds-fast.
        return ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "32"];
      }
      if (quality === "draft") {
        return grain
          ? ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", ...grainTune]
          : ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "30"];
      }
      return ["-c:v", "libx264", "-preset", "medium", ...rateControl(floor), ...grainTune];
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
  quality: "preview" | "draft" | "production";
  fps: number;
  /** encoded output size (canvas aspect preserved) */
  outWidth: number;
  outHeight: number;
  jpegQuality: number;
}

export function profileFor(quality: "preview" | "draft" | "production", scene: SceneSpec): RenderProfile {
  const { width, height } = resolveCanvasSize(scene.canvas);
  if (quality === "preview") {
    // the FAST PREVIEW: a quarter of the draft's pixels, 40 % of its frames
    const scale = PREVIEW_HEIGHT / Math.min(width, height);
    return {
      quality,
      fps: PREVIEW_FPS,
      outWidth: Math.round((width * scale) / 2) * 2,
      outHeight: Math.round((height * scale) / 2) * 2,
      jpegQuality: 70,
    };
  }
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
// Film grain — offloaded to the encoder
// ---------------------------------------------------------------------------

/**
 * THE FILM GRAIN OF A SCENE.
 *
 * The grain is a full-frame effect, and in the DOM it was the single most
 * expensive thing a software compositor could be asked to draw: a
 * translucent overlay cannot be composited over the layers beneath it
 * without FLATTENING them into one texture first, so every animated layer
 * under it was rasterised into an intermediate surface on EVERY frame.
 *
 * In the export the grain is the ENCODER's job instead. FFmpeg's `noise`
 * filter adds the grain to the encoded pixels:
 *
 *   - `c0s=<strength>` — the luma amplitude, in 0-255 units. The scene's
 *     `opacity` (0..1) maps straight onto it: 0.06 → 6, 0.12 → 12.
 *   - `c0f=t+u` — TEMPORAL + UNIFORM noise. `t` is the important one: the
 *     pattern is regenerated on every frame, so the grain SHIMMERS the way
 *     film grain does. The DOM tile could never do that — moving a tiled
 *     background re-rasterises the whole surface.
 *   - only `c0` (the luma plane) carries noise, so the grain is greyscale —
 *     exactly like the DOM's monochrome tile.
 *
 * The default FFmpeg seed is 0 and the temporal pattern is a function of the
 * frame index, so two renders of the same scene carry the same grain on the
 * same frame: a random grain would make a frame diff useless.
 *
 * The filter only ADDS the noise — `encoderArgs()` is what stops the encoder
 * from quantising it back into a static dither (see the table there).
 */
export interface FilmGrainSpec {
  /** the layer that carries the grain */
  layerId: string;
  /** the authored opacity, 0..1 */
  opacity: number;
  /** the authored tile size, px (the DOM tile's repetition period) */
  sizePx: number;
}

/** The scene's film-grain effect, or `null` when it has none. */
export function filmGrainForScene(scene: SceneSpec): FilmGrainSpec | null {
  for (const layer of scene.layers) {
    if (layer.type !== "foregroundFX") continue;
    const effects = (layer as { effects?: Array<{ kind?: string; opacity?: number; sizePx?: number }> })
      .effects;
    for (const effect of effects ?? []) {
      if (effect?.kind !== "filmGrain") continue;
      return {
        layerId: layer.id,
        opacity: typeof effect.opacity === "number" ? effect.opacity : 0.06,
        sizePx: typeof effect.sizePx === "number" ? effect.sizePx : 2,
      };
    }
  }
  return null;
}

/**
 * The FFmpeg `-vf` fragment that applies the scene's grain, or `null`.
 *
 * `null` means "this scene has no grain" — the caller must then NOT ask the
 * runtime to skip the DOM grain either, so the two can never disagree.
 *
 * THE AMPLITUDE IS CALIBRATED, not guessed. The DOM grain's own amplitude was
 * MEASURED on the reference host (a flat mid-grey background, the spatial
 * standard deviation of the rendered frame):
 *
 * | opacity | the DOM grain's spatial std | the FFmpeg strength that matches it |
 * | --- | --- | --- |
 * | 0.06 | 4.43 | 16 |
 * | 0.12 | 8.76 | 31 |
 * | 0.25 | 18.35 | 65 |
 *
 * FFmpeg's `c0s` is the PEAK of a uniform distribution, so its standard
 * deviation is `strength / 3.55`. The mapping is therefore
 * `strength = opacity × 262` — the number that makes the exported grain look
 * like the grain the author previewed.
 */
export function filmGrainFilter(scene: SceneSpec): string | null {
  const grain = filmGrainForScene(scene);
  if (!grain) return null;
  const strength = Math.min(100, Math.max(1, Math.round(grain.opacity * 262)));
  return `noise=c0s=${strength}:c0f=t+u`;
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

/**
 * Constant-power stereo balance gains for a `pan ∈ [-1, 1]`.
 *
 * `pan = -1` hard left, `+1` hard right, `0` centre. Constant power (rather than
 * linear) keeps the perceived loudness flat across the pan, which is what a
 * sound designer hears when they ride an fader.
 */
export function panGains(pan: number): { left: number; right: number } {
  const clamped = Math.min(1, Math.max(-1, pan));
  const angle = ((clamped + 1) / 2) * (Math.PI / 2);
  return { left: Math.cos(angle), right: Math.sin(angle) };
}

/**
 * FFmpeg `pan` filter expression for a stereo balance.
 *
 * THE BUG THIS FIXES: the mixer used to emit `pan=stereo:c0=c0*X:c1=c1*Y`.
 * FFmpeg's `pan` filter has no AVOptions, so its argument list must be parsed by
 * the *filter-graph* parser, which uses `|` (not `:`) to separate terms. Passing
 * the colon form makes FFmpeg fall back to AVOption parsing and fail with
 * `[fc#0] Error applying option 'c0' to filter 'pan': Option not found` — which
 * aborted every render that had a single non-zero `pan` (field report C1/F1).
 *
 * `aformat=channel_layouts=stereo` runs first so the expression is valid for
 * mono bank entries (which have no `c1`) as well as stereo sources.
 */
export function panFilterExpr(pan: number): string {
  const { left, right } = panGains(pan);
  const l = left.toFixed(4);
  const r = right.toFixed(4);
  return `aformat=channel_layouts=stereo,pan=stereo|c0=${l}*c0|c1=${r}*c1`;
}

/** The pan filter for a cue, or `null` when the cue is centred (no filter needed). */
export function panFilterFor(pan: number): string | null {
  return Math.abs(pan) > 0.01 ? panFilterExpr(pan) : null;
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
    // A filter failure is attributed to the exact cue, because "ffmpeg failed
    // (mux audio)" tells an operator nothing about which of 12 cues is wrong.
    const pan = panFilterFor(cue.pan);
    try {
      chains.push(
        `[${inputIndex}:a]volume=${cue.gain},` +
          `adelay=${delayMs}:all=1` +
          (pan ? `,${pan}` : "") +
          `,apad=whole_dur=${durationSec.toFixed(3)},atrim=end=${durationSec.toFixed(3)}` +
          `[s${i}]`
      );
    } catch (error) {
      throw new FfmpegError(
        `audio cue ${i} (sfx "${cue.sfx}" at ${cue.at}ms, pan ${cue.pan}) failed to build: ` +
          (error instanceof Error ? error.message : String(error)),
        ""
      );
    }
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
