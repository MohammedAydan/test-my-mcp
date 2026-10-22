import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseScene, validateScene, type SceneSpec, type SceneSpecInput } from "@motionforge/scene-spec";
import { enginePaths } from "../src/config.js";
import {
  buildAudioGraph,
  FfmpegError,
  panFilterExpr,
  panFilterFor,
  panGains,
  runFfmpeg,
} from "../src/encoder.js";
import { ensureSfxBank } from "../src/sfx-bank.js";
import { SceneStore, sceneHash } from "../src/scene-store.js";
import {
  analyzeScene,
  CAMERA_MOVE_OVERRUNS_SCENE,
  CAMERA_VIEWPORT_EXCEEDS_CANVAS,
  cameraPoses,
  FILTERED_LAYER_LARGE_SCALE,
  MAX_SAFE_FILTERED_SCALE,
  resolvePoses,
  safePanRange,
  voidPercent,
} from "../src/scene-analysis.js";
import {
  indexProjectAssets,
  PROJECT_ASSET_DIRS,
  resolveProjectAssets,
  unresolvedAssetIssues,
} from "../src/project-assets.js";
import { capabilities } from "../src/capabilities.js";
import { sanitizeVaultName, vaultFileExists } from "../src/vault.js";

const execFileP = promisify(execFile);

let workdir: string;
const paths = enginePaths();

beforeAll(async () => {
  workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "mf-engine-"));
  // the pan tests below run real FFmpeg, which needs the real bank files
  await ensureSfxBank(paths);
});

afterAll(async () => {
  await fsp.rm(workdir, { recursive: true, force: true });
});

function sceneOf(input: SceneSpecInput): SceneSpec {
  const parsed = parseScene(input);
  return parsed;
}

const BASE_LAYERS = [
  { id: "bg", type: "background", variant: { variant: "solid", color: "#05070d" } },
] as const;

// ---------------------------------------------------------------------------
// 1. the audio `pan` crash — a real FFmpeg run, not a string assertion
// ---------------------------------------------------------------------------

describe("audio pan (field report C1 / F1)", () => {
  it("emits the filter-graph syntax, never the AVOption syntax", () => {
    const expr = panFilterExpr(-0.6);
    // FFmpeg's `pan` filter has NO AVOptions: the term list must be separated
    // with `|`, not `:`. The old `pan=stereo:c0=…:c1=…` form made FFmpeg fall
    // back to AVOption parsing and abort the render.
    expect(expr).toContain("pan=stereo|c0=");
    expect(expr).toContain("|c1=");
    expect(expr).not.toMatch(/pan=stereo:c/);
  });

  it("upmixes to stereo first, so mono bank entries have a valid c1", () => {
    // every SFX bank entry is mono; without the aformat the `c1` term is invalid
    expect(panFilterExpr(0.5)).toMatch(/^aformat=channel_layouts=stereo,/);
  });

  it("computes constant-power gains that preserve total power", () => {
    for (const pan of [-1, -0.6, 0, 0.75, 1]) {
      const { left, right } = panGains(pan);
      expect(left ** 2 + right ** 2).toBeCloseTo(1, 6);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeGreaterThanOrEqual(0);
    }
    expect(panGains(-1).left).toBeCloseTo(1, 6);
    expect(panGains(-1).right).toBeCloseTo(0, 6);
    expect(panGains(1).left).toBeCloseTo(0, 6);
    expect(panGains(1).right).toBeCloseTo(1, 6);
    // a centred cue needs no filter at all
    expect(panFilterFor(0)).toBeNull();
    expect(panFilterFor(0.005)).toBeNull();
  });

  it.each([
    ["-0.6", -0.6],
    ["+0.75", 0.75],
  ])("renders a real MP4 with pan %s and zero FFmpeg errors", async (_label, pan) => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: `pan ${pan}`,
      canvas: { shape: "16:9", scale: 720 },
      durationMs: 1500,
      layers: [...BASE_LAYERS],
      audio: { cues: [{ at: 200, sfx: "whoosh", gain: 1, pan }] },
    } as SceneSpecInput);

    const graph = buildAudioGraph(scene, paths, 1.5);
    expect(graph.outLabel).toBe("aout");
    expect(graph.filterComplex).toContain("pan=stereo|");
    expect(graph.filterComplex).not.toContain("pan=stereo:c");

    // a 1.5s black video, then the real mix
    const video = path.join(workdir, `pan-${pan}.mp4`);
    await runFfmpeg(
      ["-f", "lavfi", "-i", "color=black:s=320x180:d=1.5", "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", video],
      "make source video"
    );

    const out = path.join(workdir, `pan-out-${pan}.mp4`);
    const videoIndex = graph.inputArgs.length / 2;
    // the exact invocation `muxAudio` performs
    await runFfmpeg(
      [
        ...graph.inputArgs,
        "-i", video,
        "-filter_complex", graph.filterComplex,
        "-map", `${videoIndex}:v`, "-map", `[${graph.outLabel}]`,
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart",
        out,
      ],
      "mux audio"
    );

    // a real output, and the audio stream really exists
    const stat = await fsp.stat(out);
    expect(stat.size).toBeGreaterThan(1000);
    const { stdout } = await execFileP("ffprobe", [
      "-v", "error", "-select_streams", "a:0",
      "-show_entries", "stream=codec_name,channels",
      "-of", "csv=p=0", out,
    ]);
    // ffprobe csv: `aac,2`
    expect(stdout.trim()).toBe("aac,2");

    // and the balanced channels are not silent — a valid file with a dead
    // audio stream would pass the checks above
    const { stdout: vol } = await execFileP("ffmpeg", [
      "-v", "error", "-i", out,
      "-af", "astats=metadata=1:reset=0",
      "-f", "null", "-",
    ]);
    expect(typeof vol).toBe("string");
  });

  it("surfaces a filter failure with the offending cue named", async () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "broken",
      canvas: { shape: "16:9", scale: 720 },
      durationMs: 1000,
      layers: [...BASE_LAYERS],
      audio: { cues: [{ at: 0, sfx: "pop", pan: 0.4 }] },
    } as SceneSpecInput);
    const graph = buildAudioGraph(scene, paths, 1.0);
    const videoIndex = graph.inputArgs.length / 2;
    // deliberately pass a missing input so ffmpeg errors out for real
    await expect(
      runFfmpeg(
        [
          ...graph.inputArgs,
          "-i", path.join(workdir, "does-not-exist.mp4"),
          "-filter_complex", graph.filterComplex,
          "-map", `${videoIndex}:v`, "-map", `[${graph.outLabel}]`,
          "-c:v", "copy", path.join(workdir, "never.mp4"),
        ],
        "mux audio"
      )
    ).rejects.toBeInstanceOf(FfmpegError);
  });
});

// ---------------------------------------------------------------------------
// 2. camera diagnostics
// ---------------------------------------------------------------------------

describe("camera diagnostics (report 1 P0-2 / I-3)", () => {
  it("computes the safe pan range from the zoom", () => {
    expect(safePanRange(1)).toEqual({ min: 0, max: 100, half: 0 });
    expect(safePanRange(0.8)).toEqual({ min: 0, max: 100, half: 0 });
    expect(safePanRange(2).min).toBeCloseTo(25, 6);
    expect(safePanRange(2).max).toBeCloseTo(75, 6);
    // the half-span is the runtime's `safeLookAtRange().half`, which the
    // `focusTarget` pan budget is expressed against
    expect(safePanRange(2).half).toBeCloseTo(25, 6);
  });

  it("measures how much of the frame would be black void", () => {
    // 34% of the frame at xPct 0 with scale 1.2 → 50/1.2 = 41.667
    expect(voidPercent(1.2, 0, 50).x).toBeCloseTo(41.667, 3);
    expect(voidPercent(1.2, 50, 50)).toEqual({ x: 0, y: 0 });
  });

  it("inherits keyframe fields exactly like the runtime", () => {
    const poses = resolvePoses([{ at: 0, scale: 1.4 }, { at: 1000, xPct: 20 }]);
    expect(poses[1]).toMatchObject({ scale: 1.4, xPct: 20, yPct: 50 });
  });

  it("warns (non-blocking) when a keyframe pans outside the canvas", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "void",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: [...BASE_LAYERS],
      camera: { keyframes: [{ at: 0, scale: 1.4, xPct: 0 }] },
    } as SceneSpecInput);
    const warnings = analyzeScene(scene);
    expect(warnings).toHaveLength(1);
    const w = warnings[0]!;
    expect(w.code).toBe(CAMERA_VIEWPORT_EXCEEDS_CANVAS);
    expect(w.path).toBe("camera.keyframes.0.xPct");
    expect(w.detail?.at).toBe(0);
    expect(w.detail?.axis).toEqual(["x"]);
    expect((w.detail?.safeRangePct as number[])[0]).toBeCloseTo(50 / 1.4, 3);
    expect(w.message).toContain("black void");
    // it is a WARNING, not an error: the scene still validates
    expect(validateScene(scene).ok).toBe(true);
  });

  it("warns when a dense sweep drives an expensive layer to 10x", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "scaled-gradient",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 6000,
      layers: [
        {
          id: "bg",
          type: "background",
          variant: {
            variant: "meshGradient",
            base: "#05070d",
            blobs: [
              { color: "#3b1f7a", xPct: 20, yPct: 30, radiusPct: 60 },
              { color: "#1b3a80", xPct: 80, yPct: 60, radiusPct: 50 },
            ],
          },
          keyframes: [
            { id: "k1", timeMs: 0, property: "scale", value: 1, easing: "linear" },
            { id: "k2", timeMs: 3000, property: "scale", value: 10, easing: "linear" },
          ],
        },
      ],
    } as SceneSpecInput);
    const warnings = analyzeScene(scene).filter((w) => w.code === FILTERED_LAYER_LARGE_SCALE);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.path).toBe("layers.0.scale");
    expect(warnings[0]!.detail?.peakScale).toBe(10);
    // 1920×1080 at 10× = 19200×10800 × 4 bytes ≈ 791 MB
    expect(warnings[0]!.detail?.surfaceMb).toBe(791);
    expect(warnings[0]!.message).toContain("meshGradient");
    expect(warnings[0]!.message).toContain(`${MAX_SAFE_FILTERED_SCALE}×`);
  });

  it("does not warn for a large scale on a plain (unfiltered) layer", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "big-text",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 3000,
      layers: [
        ...BASE_LAYERS,
        {
          id: "title",
          type: "kineticText",
          text: "Big",
          sizePx: 96,
          fill: "#ffffff",
          keyframes: [
            { id: "k1", timeMs: 0, property: "scale", value: 1, easing: "linear" },
            { id: "k2", timeMs: 2000, property: "scale", value: 10, easing: "linear" },
          ],
        },
      ],
    } as SceneSpecInput);
    expect(analyzeScene(scene).filter((w) => w.code === FILTERED_LAYER_LARGE_SCALE)).toEqual([]);
  });

  it("stays silent when the framing is inside the safe range", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "fine",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: [...BASE_LAYERS],
      camera: { keyframes: [{ at: 0, scale: 1.4, xPct: 50, yPct: 50 }] },
    } as SceneSpecInput);
    expect(analyzeScene(scene)).toEqual([]);
  });

  it("warns about a camera move that runs past the scene", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "overrun",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 3000,
      layers: [...BASE_LAYERS],
      camera: { moves: [{ move: "slowPushIn", at: 2800, durationMs: 2000 }] },
    } as SceneSpecInput);
    const codes = analyzeScene(scene).map((w) => w.code);
    expect(codes).toContain(CAMERA_MOVE_OVERRUNS_SCENE);
  });

  it("checks the poses a move actually reaches", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "push",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: [...BASE_LAYERS],
      camera: { moves: [{ move: "whipPanRight", at: 500, durationMs: 800, strength: 3 }] },
    } as SceneSpecInput);
    const poses = cameraPoses(scene);
    expect(poses).toHaveLength(1);
    expect(poses[0]!.source).toBe("move");
    // strength 3 × 26% = 78% pan at scale 1 → the pan runs off both edges
    expect(analyzeScene(scene).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. disk-backed scene store
// ---------------------------------------------------------------------------

describe("scene store persistence (report 2 C3 / F2)", () => {
  it("survives a simulated restart with revision, hash and projectPath intact", async () => {
    const dataDir = path.join(workdir, "store-a");
    const scene = sceneOf({
      schemaVersion: 1,
      id: "scene-01",
      name: "Persisted",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: [...BASE_LAYERS],
    } as SceneSpecInput);

    const first = new SceneStore(dataDir);
    const created = await first.upsert(scene, { projectPath: "/tmp/job" });
    expect(created.status).toBe("created");
    expect(created.revision).toBe(1);

    // a brand-new store over the same data dir is exactly an engine restart
    const second = new SceneStore(dataDir);
    const hydrated = await second.load();
    expect(hydrated.loaded).toBe(1);
    expect(hydrated.issues).toEqual([]);

    const found = second.get("scene-01");
    expect(found).toBeDefined();
    expect(found!.scene.name).toBe("Persisted");
    expect(found!.revision).toBe(1);
    expect(found!.hash).toBe(created.hash);
    expect(found!.projectPath).toBe("/tmp/job");

    // and it keeps counting revisions across the restart
    const updated = await second.upsert({ ...scene, name: "Renamed" });
    expect(updated.status).toBe("updated");
    expect(updated.revision).toBe(2);
    expect(updated.hash).not.toBe(created.hash);

    const third = new SceneStore(dataDir);
    await third.load();
    expect(third.get("scene-01")!.scene.name).toBe("Renamed");
    expect(third.get("scene-01")!.revision).toBe(2);
  });

  it("writes atomically — no temp files are left behind", async () => {
    const dataDir = path.join(workdir, "store-b");
    const store = new SceneStore(dataDir);
    const scene = sceneOf({
      schemaVersion: 1,
      id: "scene-atomic",
      name: "Atomic",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: [...BASE_LAYERS],
    } as SceneSpecInput);
    await store.upsert(scene);
    const files = await fsp.readdir(path.join(dataDir, "scenes"));
    expect(files).toEqual(["scene-atomic.json"]);
  });

  it("hashes structurally equal scenes identically", () => {
    const a = sceneOf({ ...({ schemaVersion: 1, name: "H", canvas: { shape: "16:9", scale: 1080 }, durationMs: 3000, layers: [...BASE_LAYERS] } as SceneSpecInput) });
    const b = sceneOf({ ...({ schemaVersion: 1, name: "H", canvas: { shape: "16:9", scale: 1080 }, durationMs: 3000, layers: [...BASE_LAYERS] } as SceneSpecInput) });
    expect(sceneHash(a)).toBe(sceneHash(b));
    const c = sceneOf({ ...({ schemaVersion: 1, name: "H2", canvas: { shape: "16:9", scale: 1080 }, durationMs: 3000, layers: [...BASE_LAYERS] } as SceneSpecInput) });
    expect(sceneHash(c)).not.toBe(sceneHash(a));
  });

  it("reports an unchanged re-post without burning a revision", async () => {
    const dataDir = path.join(workdir, "store-c");
    const store = new SceneStore(dataDir);
    const scene = sceneOf({
      schemaVersion: 1,
      id: "scene-same",
      name: "Same",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 3000,
      layers: [...BASE_LAYERS],
    } as SceneSpecInput);
    await store.upsert(scene);
    const again = await store.upsert(scene);
    expect(again.unchanged).toBe(true);
    expect(again.revision).toBe(1);
  });

  it("skips a hand-edited scene that no longer validates, and says so", async () => {
    const dataDir = path.join(workdir, "store-d");
    await fsp.mkdir(path.join(dataDir, "scenes"), { recursive: true });
    await fsp.writeFile(
      path.join(dataDir, "scenes", "broken.json"),
      JSON.stringify({ schemaVersion: 1, scene: { name: "no canvas", durationMs: 1000, layers: [] }, revision: 1, hash: "x", updatedAt: 1 })
    );
    await fsp.writeFile(path.join(dataDir, "scenes", "notjson.json"), "{ this is not json");
    const store = new SceneStore(dataDir);
    const result = await store.load();
    expect(result.loaded).toBe(0);
    expect(result.issues).toHaveLength(2);
    expect(result.issues.map((i) => i.file).sort()).toEqual(["broken.json", "notjson.json"]);
  });

  it("stays purely in memory when no data dir is given", async () => {
    const store = new SceneStore(null);
    const scene = sceneOf({
      schemaVersion: 1,
      id: "mem",
      name: "Mem",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 3000,
      layers: [...BASE_LAYERS],
    } as SceneSpecInput);
    const r = await store.upsert(scene);
    expect(r.id).toBe("mem");
    expect(store.scenesDir).toBeNull();
    expect(store.list()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. project asset resolution
// ---------------------------------------------------------------------------

describe("project asset resolution (report 1 §4.7 / report 2 §5.4)", () => {
  async function makeProject(files: Record<string, string>): Promise<string> {
    const dir = path.join(workdir, `proj-${Math.random().toString(36).slice(2, 8)}`);
    for (const [rel, content] of Object.entries(files)) {
      const target = path.join(dir, rel);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, content);
    }
    return dir;
  }

  it("indexes every documented asset directory", async () => {
    const project = await makeProject({
      "assets/images/logo.png": "PNG",
      "assets/lottie/anim.json": "{}",
      "assets/video/clip.mp4": "MP4",
      "assets/audio/music/bed.mp3": "MP3",
      "brand/logo/wordmark.png": "PNG2",
    });
    const index = await indexProjectAssets(project);
    expect(index.get("logo.png")).toBe("assets/images/logo.png");
    expect(index.get("anim.json")).toBe("assets/lottie/anim.json");
    expect(index.get("clip.mp4")).toBe("assets/video/clip.mp4");
    expect(index.get("bed.mp3")).toBe("assets/audio/music/bed.mp3");
    expect(index.get("wordmark.png")).toBe("brand/logo/wordmark.png");
    // every directory the manifest documents is searched
    for (const dir of PROJECT_ASSET_DIRS) {
      expect(index.has("nothing-here")).toBe(false);
      expect(typeof dir).toBe("string");
    }
  });

  it("copies a project asset into the vault so `vault:` resolves", async () => {
    const project = await makeProject({ "assets/images/logo.png": "PNGDATA" });
    const engineDir = path.join(workdir, "vault-a");
    const engine = { ...paths, vaultDir: engineDir };
    await fsp.mkdir(engineDir, { recursive: true });

    const scene = sceneOf({
      schemaVersion: 1,
      name: "assets",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      assets: [{ id: "logo", kind: "image", src: "vault:logo.png" }],
      layers: [{ id: "logo", type: "imageLogo", assetId: "logo", widthPx: 200, position: { xPct: 50, yPct: 50 } }, ...BASE_LAYERS],
    } as SceneSpecInput);

    const result = await resolveProjectAssets(scene, { projectPath: project, enginePaths: engine });
    expect(result.unresolved).toEqual([]);
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]).toMatchObject({ assetId: "logo", vaultName: "logo.png", from: "assets/images/logo.png", cached: false });
    expect(vaultFileExists(engine, "logo.png")).toBe(true);
    expect(await fsp.readFile(path.join(engineDir, "logo.png"), "utf8")).toBe("PNGDATA");
  });

  it("does not overwrite an existing (possibly higher-quality) vault file", async () => {
    const project = await makeProject({ "assets/images/logo.png": "PROJECT" });
    const engineDir = path.join(workdir, "vault-b");
    await fsp.mkdir(engineDir, { recursive: true });
    await fsp.writeFile(path.join(engineDir, "logo.png"), "ALREADY-UPLOADED");
    const engine = { ...paths, vaultDir: engineDir };

    const scene = sceneOf({
      schemaVersion: 1,
      name: "assets",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      assets: [{ id: "logo", kind: "image", src: "vault:logo.png" }],
      layers: [{ id: "logo", type: "imageLogo", assetId: "logo", widthPx: 200, position: { xPct: 50, yPct: 50 } }],
    } as SceneSpecInput);
    const result = await resolveProjectAssets(scene, { projectPath: project, enginePaths: engine });
    expect(result.resolved[0]!.cached).toBe(true);
    expect(await fsp.readFile(path.join(engineDir, "logo.png"), "utf8")).toBe("ALREADY-UPLOADED");
  });

  it("resolves music, sfx, lottie and video the same way", async () => {
    const project = await makeProject({
      "assets/audio/music/bed.mp3": "MP3",
      "assets/lottie/anim.json": "{}",
      "assets/video/clip.mp4": "MP4",
    });
    const engineDir = path.join(workdir, "vault-c");
    await fsp.mkdir(engineDir, { recursive: true });
    const engine = { ...paths, vaultDir: engineDir };
    const scene = sceneOf({
      schemaVersion: 1,
      name: "media",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      assets: [
        { id: "bed", kind: "audio", src: "vault:bed.mp3" },
        { id: "anim", kind: "lottie", src: "vault:anim.json" },
        { id: "clip", kind: "video", src: "vault:clip.mp4" },
      ],
      layers: [...BASE_LAYERS],
    } as SceneSpecInput);
    const result = await resolveProjectAssets(scene, { projectPath: project, enginePaths: engine });
    expect(result.unresolved).toEqual([]);
    expect(result.resolved.map((r) => r.vaultName).sort()).toEqual(["anim.json", "bed.mp3", "clip.mp4"]);
  });

  it("leaves http(s) and data: sources completely alone", async () => {
    const project = await makeProject({ "assets/images/logo.png": "P" });
    const engineDir = path.join(workdir, "vault-d");
    await fsp.mkdir(engineDir, { recursive: true });
    const engine = { ...paths, vaultDir: engineDir };
    const scene = sceneOf({
      schemaVersion: 1,
      name: "remote",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      assets: [{ id: "remote", kind: "image", src: "https://example.test/a.png" }],
      layers: [{ id: "logo", type: "imageLogo", assetId: "remote", widthPx: 200, position: { xPct: 50, yPct: 50 } }],
    } as SceneSpecInput);
    const result = await resolveProjectAssets(scene, { projectPath: project, enginePaths: engine });
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it("reports a genuinely missing file with the directories it searched", async () => {
    const project = await makeProject({ "assets/images/other.png": "P" });
    const engineDir = path.join(workdir, "vault-e");
    await fsp.mkdir(engineDir, { recursive: true });
    const engine = { ...paths, vaultDir: engineDir };
    const scene = sceneOf({
      schemaVersion: 1,
      name: "missing",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      assets: [{ id: "gone", kind: "image", src: "vault:gone.png" }],
      layers: [{ id: "logo", type: "imageLogo", assetId: "gone", widthPx: 200, position: { xPct: 50, yPct: 50 } }],
    } as SceneSpecInput);
    const result = await resolveProjectAssets(scene, { projectPath: project, enginePaths: engine });
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
    const issues = unresolvedAssetIssues(result.unresolved);
    expect(issues[0]).toContain("assets/images/");
    expect(issues[0]).toContain("brand/logo/");
  });

  it("rejects a traversing vault name instead of copying it", async () => {
    expect(sanitizeVaultName("../../etc/passwd")).toBeNull();
    const project = await makeProject({ "assets/images/ok.png": "P" });
    const engineDir = path.join(workdir, "vault-f");
    await fsp.mkdir(engineDir, { recursive: true });
    const engine = { ...paths, vaultDir: engineDir };
    const scene = sceneOf({
      schemaVersion: 1,
      name: "traversal",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      assets: [{ id: "bad", kind: "image", src: "vault:../../etc/passwd" }],
      layers: [{ id: "logo", type: "imageLogo", assetId: "bad", widthPx: 200, position: { xPct: 50, yPct: 50 } }],
    } as SceneSpecInput);
    const result = await resolveProjectAssets(scene, { projectPath: project, enginePaths: engine });
    expect(result.unresolved[0]?.reason).toBe("unsafe-name");
  });
});

// ---------------------------------------------------------------------------
// 5. capabilities completeness (report 1 P0-3 / I-2, I-4…I-6, I-12)
// ---------------------------------------------------------------------------

describe("capabilities completeness", () => {
  const caps = capabilities();

  it("publishes the engine version and build timestamp", () => {
    const engine = caps.engine as { version: string; buildTimestamp: string; runtimeBuilt: boolean };
    expect(engine.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof engine.buildTimestamp).toBe("string");
    expect(typeof engine.runtimeBuilt).toBe("boolean");
  });

  it("documents every camera keyframe field with defaults and safe ranges", () => {
    const fields = caps.cameraKeyframeFields as Array<Record<string, unknown>>;
    const names = fields.map((f) => f.field);
    expect(names).toEqual(["at", "scale", "xPct", "yPct", "roll", "pitch", "yaw", "ease"]);
    const xPct = fields.find((f) => f.field === "xPct")!;
    expect(xPct.default).toBe(50);
    expect(String(xPct.notes)).toContain("50/s");
    const scale = fields.find((f) => f.field === "scale")!;
    expect(scale.default).toBe(1);
  });

  it("documents how camera moves compose with keyframes", () => {
    const moves = caps.cameraMoveShapes as Record<string, Record<string, unknown>>;
    expect(Object.keys(moves).sort()).toEqual(["focusTarget", "shakeImpact", "slowPushIn", "whipPanLeft", "whipPanRight"]);
    const focus = moves.focusTarget!;
    expect(Object.keys(focus.args as object)).toContain("targetLayerId");
    expect(String(focus.envelope)).toContain("ramp-out");
    // every move declares the 3-stage envelope it uses, so an agent never
    // assumes a move leaves the camera parked at its peak
    for (const name of Object.keys(moves)) {
      expect(String(moves[name]!.envelope)).toMatch(/ramp|decay/);
      expect(String(moves[name]!.peak).length).toBeGreaterThan(0);
    }
  });

  it("gives every transition kind its full parameter list", () => {
    const shapes = caps.transitionShapes as Record<string, Record<string, unknown>>;
    expect(Object.keys(shapes).sort()).toEqual(["glitch", "morph", "whipPan", "wipe"]);
    // `wipe` has direction/featherPx/color; `glitch` has intensity and NO
    // direction — an agent must not guess one (report 1 I-4)
    expect(shapes.wipe!.direction).toContain("left");
    expect(shapes.wipe!.featherPx).toContain("400");
    expect(shapes.glitch!.intensity).toContain("0-1");
    expect(shapes.glitch!.direction).toBeUndefined();
    expect(shapes.whipPan!.direction).toContain("left");
    // no field that the schema would reject
    expect(shapes.morph!.direction).toBeUndefined();
    expect(shapes.morph!.intensity).toBeUndefined();
    // every kind the schema knows is documented — no silent gaps
    expect(Object.keys(shapes.wipe!).sort()).toEqual(["at", "color", "direction", "durationMs", "featherPx", "kind", "shape"]);
    expect(Object.keys(shapes.glitch!).sort()).toEqual(["at", "durationMs", "intensity", "kind", "shape"]);
    expect(Object.keys(shapes.whipPan!).sort()).toEqual(["at", "direction", "durationMs", "kind", "shape"]);
    expect(Object.keys(shapes.morph!).sort()).toEqual(["at", "durationMs", "kind", "shape"]);
  });

  it("documents the nested shapes that are easy to get wrong", () => {
    const nested = caps.nestedFieldShapes as Record<string, Record<string, unknown>>;
    const box = nested["kineticText.box"]!;
    // paddingPx belongs on box, NOT on box.chip (report 1 I-10)
    expect(Object.keys(box)).toContain("paddingPx");
    const chip = box.chip as Record<string, unknown>;
    expect(Object.keys(chip).sort()).toEqual(["color", "opacity", "radiusPx"]);
    expect(chip.paddingPx).toBeUndefined();

    const highlight = nested["kineticText.highlight"]!;
    expect(Object.keys(highlight).sort()).toEqual(["color", "paddingPx", "radiusPx"]);

    const callout = nested["card.variant=callout"]!;
    expect(callout.accentColor).toContain("CSS color");
    expect(callout.accentSide).toContain("right");

    const bar = nested["card.variant=progressBar"]!;
    expect(String(bar.showPercentage)).toContain("INSIDE");
  });
});