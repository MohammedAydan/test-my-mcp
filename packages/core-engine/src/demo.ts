/**
 * Full showcase E2E: generates real assets into the vault, composes the demo
 * SceneSpec (Arabic + English kinetic type, glass card, progress bar, counter,
 * camera moves, transitions, SFX), inspects keyframes visually, and renders a
 * draft MP4 through the production pipeline.
 *
 *   npm run demo -w @motionforge/core-engine
 */
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { EnginePaths } from "./config.js";
import { engineConfig } from "./config.js";
import { startEngine } from "./server.js";
import type { SceneSpecInput } from "@motionforge/scene-spec";

const exec = promisify(execFile);
const PORT = 4144;
const DURATION_MS = 12_000;
const QUALITY = process.env.DEMO_QUALITY === "production" ? "production" : "draft";

async function generateAsset(paths: EnginePaths, file: string, filter: string): Promise<void> {
  const out = path.join(paths.vaultDir, file);
  await exec("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", filter,
    "-frames:v", "1", "-y", out,
  ]);
  const info = await stat(out);
  if (info.size === 0) throw new Error(`demo asset ${file} is empty`);
}

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
  if (!v) throw new Error("no video stream in demo output");
  return { duration: Number(json.format.duration), videoCodec: v.codec_name, audioCodec: audio, width: v.width, height: v.height };
}

function demoScene(): SceneSpecInput {
  return {
    schemaVersion: 1,
    id: "showcase",
    name: "Showcase Demo",
    canvas: { shape: "16:9", scale: 1080 },
    durationMs: DURATION_MS,
    assets: [
      { id: "logo", kind: "image", src: "vault:demo-logo.png" },
      { id: "icon", kind: "image", src: "vault:demo-icon.png" },
    ],
    fonts: [
      { role: "hero", family: "Cairo", provider: "google", weights: [700, 900] },
      { role: "body", family: "Inter", provider: "google", weights: [400, 600, 800] },
    ],
    layers: [
      {
        id: "bg",
        type: "background",
        variant: {
          variant: "meshGradient",
          base: "#05070d",
          blobs: [
            { color: "#3b1f7a", xPct: 20, yPct: 28, radiusPct: 62, drift: 0.45 },
            { color: "#1b3a80", xPct: 80, yPct: 36, radiusPct: 55, drift: 0.3 },
            { color: "#0e5f63", xPct: 55, yPct: 82, radiusPct: 58, drift: 0.5 },
          ],
        },
      },
      {
        id: "logo",
        type: "imageLogo",
        at: 300,
        duration: 4200,
        assetId: "logo",
        name: "MotionForge",
        widthPx: 200,
        heightPx: 200,
        position: { xPct: 50, yPct: 24 },
        mask: "squircle",
        cornerRadiusPx: 52,
        ring: { widthPx: 4, color: "#7dd3fc", opacity: 0.8 },
        glass: { blurPx: 22, tintColor: "#ffffff", tintOpacity: 0.08 },
        glow: { color: "#38bdf8", strength: 0.6 },
        shadow: { color: "#000000", opacity: 0.5, blurPx: 28, offsetYpx: 18 },
        lightSweep: { at: 1400, durationMs: 800 },
        entrance: { name: "springPop" },
        emphasis: { name: "floatIdle", strength: 0.6 },
        exit: { name: "scaleDownFade" },
        sfx: [{ sfx: "pop", offsetMs: 0 }],
      },
      {
        id: "headline-ar",
        type: "kineticText",
        at: 1100,
        duration: 3400,
        text: "أهلاً بك في موشن فورج",
        direction: "rtl",
        role: "hero",
        googleFamily: "Cairo",
        fontWeight: 900,
        sizePx: 96,
        lineHeight: 1.25,
        box: { maxWidthPct: 72, paddingPx: 0 },
        position: { xPct: 50, yPct: 47 },
        fill: { type: "linear", angleDeg: 120, stops: [{ color: "#ffffff", at: 0 }, { color: "#a5f3fc", at: 100 }] },
        animateBy: "word",
        entrance: { name: "blurFadeIn", staggerMs: 140 },
        sfx: [{ sfx: "whoosh", offsetMs: 0 }],
      },
      {
        id: "headline-en",
        type: "kineticText",
        at: 2100,
        duration: 2600,
        text: "Motion, engineered. Frame-accurate.",
        role: "body",
        googleFamily: "Inter",
        fontWeight: 600,
        sizePx: 40,
        position: { xPct: 50, yPct: 60 },
        fill: "#93c5fd",
        animateBy: "word",
        entrance: { name: "smoothSlideUp", staggerMs: 90 },
        sfx: [{ sfx: "shimmer", offsetMs: 0, gain: 0.6 }],
      },
      {
        id: "card",
        type: "card",
        at: 5100,
        duration: 2700,
        position: { xPct: 50, yPct: 33 },
        variant: {
          variant: "glassCard",
          paddingPx: 34,
          radiusPx: 28,
          widthPx: 620,
          iconAssetId: "icon",
          glass: { blurPx: 26, tintColor: "#0ea5e9", tintOpacity: 0.16 },
          borderOpacity: 0.22,
          title: "Deterministic Pipeline",
          body: "Every frame seeked, captured and piped — identical on any machine.",
        },
        entrance: { name: "3dFlipIn", strength: 0.8 },
        sfx: [{ sfx: "subImpact", offsetMs: 0 }],
      },
      {
        id: "bar",
        type: "card",
        at: 8100,
        duration: 1900,
        position: { xPct: 50, yPct: 40 },
        variant: {
          variant: "progressBar",
          widthPx: 640,
          heightPx: 22,
          radiusPx: 11,
          trackColor: "rgba(255,255,255,0.14)",
          fill: { type: "linear", angleDeg: 90, stops: [{ color: "#22d3ee", at: 0 }, { color: "#a78bfa", at: 100 }] },
          value: 94,
          showPercentage: true,
          label: "Encoding pipeline",
        },
        entrance: { name: "maskRevealWipe" },
        sfx: [{ sfx: "riser", offsetMs: 0 }],
      },
      {
        id: "counter",
        type: "card",
        at: 10200,
        duration: 1800,
        position: { xPct: 50, yPct: 55 },
        variant: {
          variant: "counter",
          from: 0,
          to: 87,
          decimals: 0,
          suffix: "%",
          sizePx: 140,
          role: "hero",
        },
        entrance: { name: "springPop", strength: 0.7 },
        sfx: [{ sfx: "click", offsetMs: 60 }],
      },
      {
        id: "fgx",
        type: "foregroundFX",
        effects: [
          { kind: "vignette", strength: 0.5 },
          { kind: "filmGrain", opacity: 0.06 },
          { kind: "colorGrade", contrast: 0.06, saturation: 0.08, warmth: 0.12 },
        ],
      },
    ],
    camera: {
      keyframes: [
        { at: 0, scale: 1 },
        { at: 11000, scale: 1.28, ease: "power3.inOut" },
      ],
      drift: { amplitudePct: 0.5, periodMs: 5200 },
      moves: [
        { move: "slowPushIn", at: 3800, durationMs: 2200, strength: 0.9 },
        { move: "shakeImpact", at: 10250, strength: 0.5 },
      ],
    },
    transitions: [
      { kind: "wipe", at: 4600, direction: "left", durationMs: 700, color: "#0b1020", featherPx: 90 },
      { kind: "glitch", at: 7900, durationMs: 350, intensity: 0.7 },
      { kind: "morph", at: 11600, durationMs: 600 },
    ],
    audio: {
      cues: [{ at: 11900, sfx: "subImpact", gain: 1.2 }],
    },
  };
}

async function main(): Promise<void> {
  const config = engineConfig({ port: PORT, maxRenderWorkers: 2 });
  const engine = await startEngine({ config, log: (msg) => console.log(`[engine] ${msg}`) });
  const base = `http://127.0.0.1:${PORT}`;

  // 1. generate showcase assets straight into the vault
  await generateAsset(config.paths, "demo-logo.png", "gradients=s=512x512:c0=0x6d28d9:c1=0x2563eb:x0=96:y0=96:x1=416:y1=416:duration=0.05");
  await generateAsset(config.paths, "demo-icon.png", "gradients=s=256x256:c0=0x22d3ee:c1=0xa78bfa:x0=20:y0=20:x1=236:y1=236:duration=0.05");
  console.log("demo: vault assets generated");

  // 2. store the scene
  const stored = await fetch(`${base}/api/scenes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(demoScene()),
  });
  if (!stored.ok) throw new Error(`scene rejected: ${stored.status} ${await stored.text()}`);
  console.log("demo: scene stored as 'showcase'");

  // 3. visual inspection pass — the transport contract, end to end.
  //    `includeFullResolution` is what separates the two halves of the
  //    `inspect_scene_keyframes` payload: the inline JPEGs an agent (or this
  //    script) reads, and the full-resolution PNGs a client deliverable needs.
  //    Asking for neither used to print "0 KiB" without failing.
  const kf = await fetch(`${base}/api/scenes/showcase/keyframes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ at: [700, 1800, 3400, 6300, 9200, 10800], includeFullResolution: true }),
  });
  if (!kf.ok) throw new Error(`keyframes failed: ${kf.status}`);
  const inspected = (await kf.json()) as {
    frames: Array<{ atMs: number; image: string; preview: string }>;
  };
  for (const f of inspected.frames) {
    const size = (dataUrl: string): number =>
      Buffer.from(dataUrl.replace(/^data:image\/(?:jpeg|png);base64,/, ""), "base64").length;
    const previewKiB = size(f.preview);
    const fullKiB = size(f.image);
    // a frame that captured nothing is a broken pipeline, not a quiet success
    if (previewKiB === 0 || fullKiB === 0) {
      throw new Error(`keyframe ${f.atMs}ms captured nothing (preview ${previewKiB}B, full ${fullKiB}B)`);
    }
    console.log(
      `demo: keyframe ${f.atMs}ms → inline ${(previewKiB / 1024).toFixed(0)} KiB jpeg · ` +
        `full-res ${(fullKiB / 1024).toFixed(0)} KiB png`
    );
  }

  // 4. draft render through the full pipeline
  const enq = await fetch(`${base}/api/renders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sceneId: "showcase", quality: QUALITY }),
  });
  if (!enq.ok) throw new Error(`render enqueue failed: ${enq.status}`);
  const { jobId } = (await enq.json()) as { jobId: string };

  let job: { status: string; progress?: number; error?: string; result?: Record<string, unknown> } = {
    status: "queued",
  };
  for (let i = 0; i < 1800; i++) {
    job = (await (await fetch(`${base}/api/renders/${jobId}`)).json()) as { status: string; progress?: number; error?: string; result?: Record<string, unknown> };
    if (job.status === "succeeded" || job.status === "failed") break;
    if (i % 30 === 29) console.log(`demo: render ${((job.progress ?? 0) * 100) | 0}% after ${i + 1}s`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (job?.status !== "succeeded") throw new Error(`demo render failed: ${job?.status} ${job?.error ?? ""}`);
  console.log("demo: telemetry", JSON.stringify(job.result, null, 2));

  const info = await ffprobeInfo(job.result!.mp4Path as string);
  console.log("demo: output", info);

  const problems: string[] = [];
  if (Math.abs(info.duration - DURATION_MS / 1000) > 0.4) problems.push(`duration ${info.duration.toFixed(2)}s != ${(DURATION_MS / 1000).toFixed(1)}s ±0.4`);
  if (!info.videoCodec.startsWith("h264")) problems.push(`codec ${info.videoCodec}`);
  if (!info.audioCodec) problems.push("audio stream missing");

  if (problems.length > 0) {
    console.error("demo: FAILED", problems);
    process.exitCode = 1;
  } else {
    console.log("demo: OK — showcase scene rendered end-to-end");
  }
  await engine.app.close();
  process.exit(process.exitCode ?? 0);
}

main().catch((error) => {
  console.error("demo: fatal", error);
  process.exit(1);
});
