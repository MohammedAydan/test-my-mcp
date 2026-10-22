/**
 * THE FFPROBE VIEW OF A FINISHED FILE.
 *
 * "The render succeeded" is not the same statement as "the file is what the
 * caller asked for". A caller wants to know: how long is it, how big is it,
 * what codec is inside it, does it have an audio track, is the video stream
 * really 1920×1080 at 60 fps.
 *
 * So the engine probes the finished MP4 and reports the NUMBERS. The probe is
 * a separate module because it is a different failure mode from the render
 * itself: a missing `ffprobe` must never take the render job down with it.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

import type { MediaProbeReport, MediaStreamReport } from "@motionforge/scene-spec";

const execFileP = promisify(execFile);

interface FfprobeStream {
  index?: number;
  codec_name?: string;
  codec_type?: string;
  profile?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  bit_rate?: string;
  nb_frames?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: {
    format_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
  };
}

/** `"60/1"` → `60`. */
function parseRate(rate: string | undefined): number | undefined {
  if (!rate) return undefined;
  const [num, den] = rate.split("/");
  const numerator = Number(num);
  const denominator = den === undefined ? 1 : Number(den);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return undefined;
  }
  const value = numerator / denominator;
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : undefined;
}

function optionalNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Map one ffprobe stream onto the shared report contract. */
export function toStreamReport(stream: FfprobeStream, fallbackDuration?: number): MediaStreamReport {
  const type: MediaStreamReport["type"] =
    stream.codec_type === "video" ? "video" : stream.codec_type === "audio" ? "audio" : "other";
  const fps = parseRate(stream.r_frame_rate) ?? parseRate(stream.avg_frame_rate);
  const width = optionalNumber(stream.width);
  const height = optionalNumber(stream.height);
  const sampleRate = optionalNumber(stream.sample_rate);
  const channels = optionalNumber(stream.channels);
  const duration = optionalNumber(stream.duration) ?? fallbackDuration;
  const bitRate = optionalNumber(stream.bit_rate);
  const frameCount = optionalNumber(stream.nb_frames);
  return {
    index: typeof stream.index === "number" ? stream.index : 0,
    type,
    codec: stream.codec_name ?? "unknown",
    ...(typeof stream.profile === "string" && stream.profile ? { profile: stream.profile } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(fps !== undefined ? { fps } : {}),
    ...(sampleRate !== undefined ? { sampleRate } : {}),
    ...(channels !== undefined ? { channels } : {}),
    ...(duration !== undefined ? { durationSec: duration } : {}),
    ...(bitRate !== undefined ? { bitRate } : {}),
    ...(frameCount !== undefined ? { frameCount } : {}),
  };
}

/**
 * Probe a media file.
 *
 * Throws when the file is missing or `ffprobe` is unavailable — the caller
 * decides whether that is fatal.
 */
export async function probeMedia(filePath: string): Promise<MediaProbeReport> {
  const { stdout } = await execFileP("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);
  const parsed = JSON.parse(stdout) as FfprobeOutput;
  const format = parsed.format ?? {};
  const durationSec = optionalNumber(format.duration) ?? 0;
  const sizeBytes = optionalNumber(format.size) ?? (await fs.stat(filePath)).size;
  const bitRate = optionalNumber(format.bit_rate);
  return {
    path: filePath,
    sizeBytes,
    durationSec,
    format: format.format_name ?? "unknown",
    ...(bitRate !== undefined ? { bitRate } : {}),
    streams: (parsed.streams ?? []).map((stream) => toStreamReport(stream, durationSec)),
  };
}
