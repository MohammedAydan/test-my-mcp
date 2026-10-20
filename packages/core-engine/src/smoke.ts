/**
 * End-to-end smoke: runs entirely in-process using EngineCore, uploads a generated logo,
 * stores a small scene, inspects keyframes, renders it at DRAFT quality through the full
 * Playwright→pipe→FFmpeg pipeline, and verifies the output file with ffprobe.
 *
 *   npm run smoke -w @motionforge/core-engine
 */
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { createEngineCore } from "./engine-core.js";
import type { SceneSpecInput } from "@motionforge/scene-spec";

const exec = promisify(execFile);

async function ffprobeInfo(file: string): Promise<{ duration: number; videoCodec: string; audioCodec: string | null; width: number; height: number }> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=codec_name,width,height:format=duration", "-of", "json", file,
  ]);
  const json = JSON.parse(stdout) as {
    streams: Array<{ codec_name: string; width: number; height: number }>;
    format: { duration: string };
  };
  const audio = await exec("ffprobe", [
    "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "json", file,
  ]).then((r) => (JSON.parse(r.stdout) as { streams: Array<{ codec_name: string }> }).streams[0]?.codec_name ?? null);
  const v = json.streams[0];
  if (!v) throw new Error("no video stream in output");
  return {
    duration: Number(json.format.duration),
    videoCodec: v.codec_name,
    audioCodec: audio,
    width: v.width,
    height: v.height,
  };
}

async function main(): Promise<void> {
  const core = await createEngineCore({
    maxRenderWorkers: 2,
    log: (msg) => console.log(`[engine] ${msg}`),
  });

  // 1. generate a real brand-blue PNG via ffmpeg, upload it into the vault
  const pngPath = path.join(core.paths.vaultDir, "smoke-logo.png");
  await exec("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=0x1a2a6c:s=192x192,format=rgb24",
    "-frames:v", "1", "-y", pngPath,
  ]);
  await core.ingestAsset(await readFile(pngPath), "smoke-logo.png");

  // 2. store a compact scene (all layer types that need no external deps)
  const scene: SceneSpecInput = {
    schemaVersion: 1,
    id: "smoke-test",
    name: "Smoke Test",
    canvas: { shape: "16:9", scale: 720 },
    durationMs: 4000,
    assets: [{ id: "logo", kind: "image", src: "vault:smoke-logo.png" }],
    fonts: [{ role: "hero", family: "Inter", provider: "google", weights: [800] }],
    layers: [
      {
        id: "bg",
        type: "background",
        variant: {
          variant: "meshGradient",
          base: "#05070d",
          blobs: [
            { color: "#1a2a6c", xPct: 25, yPct: 30, radiusPct: 60, drift: 0.4 },
            { color: "#b21f1f", xPct: 75, yPct: 70, radiusPct: 55, drift: 0.3 },
          ],
        },
      },
      {
        id: "logo",
        type: "imageLogo",
        at: 200,
        duration: 3400,
        assetId: "logo",
        widthPx: 180,
        position: { xPct: 50, yPct: 30 },
        mask: "squircle",
        cornerRadiusPx: 32,
        lightSweep: { at: 1000, durationMs: 700 },
        entrance: { name: "springPop" },
        sfx: [{ sfx: "pop", offsetMs: 0 }],
      },
      {
        id: "headline",
        type: "kineticText",
        at: 800,
        duration: 2800,
        text: "Motion, engineered.",
        role: "hero",
        googleFamily: "Inter",
        fontWeight: 900,
        sizePx: 88,
        fill: { type: "linear", angleDeg: 120, stops: [{ color: "#ffffff", at: 0 }, { color: "#ffd166", at: 100 }] },
        entrance: { name: "smoothSlideUp", staggerMs: 100 },
        sfx: [{ sfx: "whoosh", offsetMs: 0 }],
      },
      {
        id: "grade",
        type: "foregroundFX",
        effects: [{ kind: "vignette", strength: 0.5 }, { kind: "filmGrain", opacity: 0.05 }],
      },
    ],
    camera: {
      keyframes: [
        { at: 0, scale: 1 },
        { at: 3200, scale: 1.3, ease: "power3.inOut" },
      ],
      moves: [],
    },
    transitions: [],
    audio: { cues: [{ at: 2000, sfx: "click" }] },
  };

  const stored = await core.saveScene(scene);
  if (stored.warnings && stored.warnings.length > 0) {
    console.log(`smoke: ${stored.warnings.length} warning(s) — ${stored.warnings.map((w) => w.code).join(", ")}`);
  }

  // 3. inspect keyframes (UI verification path)
  const kfs = await core.inspectKeyframes("smoke-test", { at: [500, 1500, 3000] });
  console.log(`smoke: ${kfs.frames.length} keyframe screenshots captured`);

  // 4. render draft
  const render = await core.startRender("smoke-test", "draft");
  const jobId = render.jobId;

  let job;
  for (let i = 0; i < 120; i++) {
    job = core.getRenderStatus(jobId);
    if (job && (job.status === "succeeded" || job.status === "failed")) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (job?.status !== "succeeded" || !job.result) {
    throw new Error(`render did not succeed: ${job?.status} ${job?.error ?? ""}`);
  }

  // 5. verify output
  const info = await ffprobeInfo(job.result.mp4Path);
  const bytes = statSync(job.result.mp4Path).size;
  console.log("smoke: render telemetry", job.result);
  console.log("smoke: output", info, `${(bytes / 1024).toFixed(0)} KiB`);

  const problems: string[] = [];
  if (Math.abs(info.duration - 4.0) > 0.35) problems.push(`duration ${info.duration.toFixed(2)}s != 4.0s ±0.35`);
  if (!info.videoCodec.startsWith("h264")) problems.push(`video codec ${info.videoCodec}`);
  if (!info.audioCodec) problems.push("audio stream missing");
  if (bytes < 20_000) problems.push("output suspiciously small");

  core.dispose();

  if (problems.length > 0) {
    console.error("smoke: FAILED", problems);
    process.exitCode = 1;
  } else {
    console.log("smoke: OK — full pipeline works end-to-end");
  }
  process.exit(process.exitCode ?? 0);
}

main().catch((error) => {
  console.error("smoke: fatal", error);
  process.exit(1);
});
