/**
 * Multi-frame keyframe inspection — the path that used to kill the MCP server.
 *
 * The failure was a transport failure, not a rendering one: MCP over stdio is a
 * PIPE with a bounded buffer, and twelve full-resolution 1080p PNGs come back as
 * ~15 MB of base64. That overflowed the pipe, the client closed its end, and the
 * server died with an unhandled `write EPIPE` — losing the stills AND the
 * `framesMeta` that had already been computed.
 *
 * So the contract this file locks down has two halves that must BOTH hold:
 *
 *   1. the INLINE response stays small (previews, not PNGs), and
 *   2. the FULL-RESOLUTION frames + the numeric sidecar still land on disk.
 *
 * It drives a REAL listening engine, because the frame renderer loads the
 * preview page over HTTP — `app.inject` cannot exercise this path.
 *
 * Skipped (not failed) when Chromium is unavailable, so the suite stays green on
 * a bare machine — but it RUNS wherever the bug appeared.
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";

import { validateScene, type SceneSpecInput } from "@motionforge/scene-spec";
import { enginePaths } from "../src/config.js";
import { PREVIEW_JPEG_QUALITY, PREVIEW_MAX_WIDTH } from "../src/keyframes.js";
import { registerPreviewRoutes, registerProjectRoutes, registerSceneRoutes } from "../src/server.js";
import { SceneStore } from "../src/scene-store.js";

let workdir: string;
let project: string;
let baseUrl: string;
let hasChromium = true;
let app: Fastify.FastifyInstance | undefined;

const FRAMES = 12;

beforeAll(async () => {
  workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "mf-inspect-"));
  project = path.join(workdir, "project");
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    await browser.close();
  } catch {
    hasChromium = false;
    return;
  }

  const paths = { ...enginePaths(), dataDir: path.join(workdir, "data") };
  const store = new SceneStore(paths.dataDir);
  app = Fastify();
  expect(
    await registerPreviewRoutes(app, paths.runtimeDistDir),
    "scene-runtime must be built before inspecting frames"
  ).toBe(true);
  await registerSceneRoutes(app, { store, port: 0, paths });
  await registerProjectRoutes(app, { store, port: 0, paths });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  baseUrl = typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : "";

  const init = await app.inject({
    method: "POST",
    url: "/projects/init",
    payload: { name: "inspect-project", targetPath: project },
  });
  if (init.statusCode !== 201) throw new Error(`init -> ${init.statusCode}: ${init.body}`);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await fsp.rm(workdir, { recursive: true, force: true });
});

const SCENE: SceneSpecInput = {
  schemaVersion: 1,
  id: "inspect-12",
  name: "Twelve Frame Inspection",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 6000,
  assets: [],
  fonts: [],
  layers: [
    { id: "bg", type: "background", variant: { variant: "solid", color: "#0b1020" } },
    {
      id: "title",
      type: "kineticText",
      at: 200,
      text: "فحص الإطارات",
      direction: "rtl",
      sizePx: 96,
      position: { xPct: 50, yPct: 45 },
      fill: "#ffffff",
      animateBy: "word",
      highlight: { color: "#22d3ee", radiusPx: 12, paddingPx: 8 },
      entrance: { name: "blurFadeIn", staggerMs: 100 },
    },
  ],
  camera: { keyframes: [{ at: 0, scale: 1.04 }] },
  transitions: [],
  audio: { cues: [] },
};

const STAMPS = Array.from({ length: FRAMES }, (_, i) => Math.round(i * 500 + 250));

interface InspectBody {
  frames: Array<{ atMs: number; image: string; preview: string }>;
  framesMeta: Array<{ atMs: number; camera: { scale: number; clampedVoid: boolean } }>;
}

async function inspect(includeFullResolution: boolean): Promise<InspectBody> {
  const res = await fetch(`${baseUrl}/api/scenes/inspect-12/keyframes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ at: STAMPS, includeFullResolution }),
  });
  if (res.status !== 200) {
    throw new Error(`inspect ${includeFullResolution} -> ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  return (await res.json()) as InspectBody;
}

describe("inspect_scene_keyframes: a twelve-frame inspection", () => {
  it("stores the scene so the inspection can run against it", () => {
    if (!hasChromium) return;
    const parsed = validateScene(SCENE);
    expect(parsed.ok).toBe(true);
  });

  it("returns a lightweight inline preview for every frame", async () => {
    if (!hasChromium) return;
    const parsed = validateScene(SCENE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const stored = await app!.inject({
      method: "POST",
      url: "/api/scenes",
      payload: { ...parsed.scene, projectPath: project },
    });
    expect(stored.statusCode).toBe(201);

    const body = await inspect(false);
    expect(body.frames).toHaveLength(FRAMES);
    for (const frame of body.frames) {
      expect(frame.preview, `frame ${frame.atMs} has no preview`).toMatch(/^data:image\/jpeg;base64,/);
      // the full-resolution PNG is opt-in — an inline caller never receives one
      expect(frame.image).toBe("");
    }
    for (const meta of body.framesMeta) {
      expect(meta.camera).toBeDefined();
      expect(meta.camera.scale).toBeCloseTo(1.04, 2);
    }
  }, 180_000);

  it("keeps the inline payload under 1 MB (a 12-frame stdio response)", async () => {
    if (!hasChromium) return;
    const body = await inspect(false);
    const inlineBytes = body.frames.reduce(
      (sum, f) => sum + Buffer.from(f.preview.split(",")[1] ?? "", "base64").length,
      0
    );
    expect(
      inlineBytes,
      `inline payload was ${Math.round(inlineBytes / 1024)} KB`
    ).toBeLessThan(1024 * 1024);

    // …and the previews really are smaller RENDITIONS, not re-encoded PNGs.
    // Asserting on byte counts alone would be content-dependent — PNG beats
    // JPEG on a flat background — so the invariant is stated in pixels: an
    // inline preview may never carry more than the configured budget.
    for (const frame of body.frames) {
      const dims = jpegDimensions(Buffer.from(frame.preview.split(",")[1] ?? "", "base64"));
      expect(dims.width, `preview at ${frame.atMs}ms is ${dims.width}px wide`).toBeLessThanOrEqual(PREVIEW_MAX_WIDTH);
      expect(dims.height, `preview at ${frame.atMs}ms is ${dims.height}px tall`).toBeLessThanOrEqual(600);
    }
  }, 180_000);

  it("only produces a full-resolution PNG when the caller asks for one", async () => {
    if (!hasChromium) return;
    const inline = await inspect(false);
    const full = await inspect(true);
    expect(inline.frames.every((f) => f.image === "")).toBe(true);
    expect(full.frames.every((f) => f.image.startsWith("data:image/png;base64,"))).toBe(true);
    // the preview is present either way — it is the inspection, not the artefact
    expect(full.frames.every((f) => f.preview.startsWith("data:image/jpeg;base64,"))).toBe(true);
  }, 180_000);

  it("writes full-resolution stills AND a frames-meta sidecar to the project", async () => {
    if (!hasChromium) return;
    const body = await inspect(true);
    const saved = await app!.inject({
      method: "POST",
      url: "/projects/stills",
      headers: { "x-motionforge-project": project },
      payload: { sceneId: "inspect-12", frames: body.frames, framesMeta: body.framesMeta },
    });
    if (saved.statusCode !== 201) throw new Error(`stills -> ${saved.statusCode}: ${saved.body}`);
    const savedBody = saved.json() as { files: string[]; metaFile?: string };

    const stillsDir = path.join(project, "renders", "stills");
    const onDisk = await fsp.readdir(stillsDir);
    for (const atMs of STAMPS) {
      expect(onDisk, `missing still for ${atMs}ms`).toContain(`inspect-12-${atMs}ms.png`);
    }
    expect(savedBody.metaFile).toBe("renders/stills/inspect-12-frames-meta.json");
    expect(onDisk).toContain("inspect-12-frames-meta.json");

    const meta = JSON.parse(
      await fsp.readFile(path.join(stillsDir, "inspect-12-frames-meta.json"), "utf8")
    ) as { sceneId: string; frames: Array<{ atMs: number; camera: { scale: number } }> };
    expect(meta.sceneId).toBe("inspect-12");
    expect(meta.frames).toHaveLength(FRAMES);
    expect(meta.frames[0]?.camera.scale).toBeCloseTo(1.04, 2);

    // the stills on disk are REAL full-resolution PNGs, not the inline previews
    const header = await fsp.readFile(path.join(stillsDir, `inspect-12-${STAMPS[0]}ms.png`));
    expect(header.subarray(1, 4).toString("latin1")).toBe("PNG");
  }, 180_000);

  it("documents the preview budget so it cannot silently drift", () => {
    expect(PREVIEW_MAX_WIDTH).toBeLessThanOrEqual(1024);
    expect(PREVIEW_JPEG_QUALITY).toBeGreaterThanOrEqual(50);
    expect(PREVIEW_JPEG_QUALITY).toBeLessThanOrEqual(85);
  });
});
/**
 * Read a JPEG's pixel dimensions straight out of its SOF marker.
 *
 * Deliberately dependency-free: the assertion is about the transport contract
 * (an inline preview is a bounded-size rendition), and a test that needed an
 * image library to prove that would be a worse test.
 */
function jpegDimensions(buf: Buffer): { width: number; height: number } {
  let offset = 2; // SOI
  while (offset < buf.length - 9) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buf[offset + 1]!;
    // SOF0/1/2 carry the frame size; anything else is skipped by its length
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    offset += 2 + buf.readUInt16BE(offset + 2);
  }
  throw new Error("not a JPEG (no SOF marker)");
}
