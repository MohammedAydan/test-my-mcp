import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { resolveCanvasSize, type SceneSpec } from "@motionforge/scene-spec";

import type { EngineConfig, EnginePaths } from "./config.js";
import { resolveEnginePaths } from "./config.js";
import type { RenderProfile } from "./encoder.js";
import { FfmpegError, encoderArgs, StdinWriter } from "./encoder.js";
import type { SceneStore } from "./scene-store.js";
import { mimeFor } from "./vault.js";

// ---------------------------------------------------------------------------
// Browser lifecycle
// ---------------------------------------------------------------------------

export class RendererPool {
  /**
   * One Chromium PER RENDER PAGE: headless renderers share GPU/raster threads
   * within a browser process, so N pages in one browser would serialize frame
   * capture. Separate browsers == true parallel workers.
   */
  private browsers: Browser[] = [];

  async openRenderPage(opts: {
    baseUrl: string;
    sceneId: string;
    profile: RenderProfile;
    viewportWidth: number;
    viewportHeight: number;
    fit: boolean;
    /** engine paths — the vault + runtime bundle the zero-port routes serve */
    paths?: EnginePaths;
    /** the scene store — lets the zero-port `/api/scenes/:id` route answer */
    store?: SceneStore;
    /** the scene being rendered — answered by the zero-port `/api/scenes/:id` route */
    scene?: SceneSpec;
  }): Promise<IPage> {
    const browser = await chromium.launch({
      headless: true,
      args: [
        // grayscale AA + no subpixel fringing: identical glyph rasterization on
        // every machine and every worker, so parallel parts never disagree
        "--disable-lcd-text",
        "--font-render-hinting=none",
        // one device pixel per CSS pixel, whatever the host display scale is
        "--force-device-scale-factor=1",
        "--hide-scrollbars",
      ],
    });
    this.browsers.push(browser);
    // Viewport lock: the screenshot is exactly `viewportWidth × viewportHeight`
    // CSS pixels at DSF 1. Production renders the canvas 1:1; draft renders a
    // uniform downscale of it. Any scrollbar or body margin would crop frames —
    // the runtime zeroes those in `style.css`.
    const context = await browser.newContext({
      viewport: { width: opts.viewportWidth, height: opts.viewportHeight },
      deviceScaleFactor: 1,
      reducedMotion: "no-preference",
      colorScheme: "dark",
    });
    // Zero-port: the page, the scene and the vault are served from memory, so
    // the browser never needs the engine's HTTP origin to be up. Registered
    // BEFORE the first navigation — otherwise the document request would race
    // the route handler and hit a port that may not exist.
    await setupPlaywrightZeroPortRoutes(context, {
      sceneId: opts.sceneId,
      ...(opts.scene ? { scene: opts.scene } : {}),
      ...(opts.store ? { store: opts.store } : {}),
      ...(opts.paths ? { paths: opts.paths } : {}),
    });
    const page = await context.newPage();
    page.on("console", (msg) => console.log(`[renderer:console] ${msg.text()}`));
    page.on("pageerror", (err) => console.error(`[renderer:pageerror]`, err));
    const url =
      `${opts.baseUrl}/preview?scene=${encodeURIComponent(opts.sceneId)}` +
      `&render=1&fps=${opts.profile.fps}` +
      (opts.fit ? "&fit=1" : "");
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction(
      // scene loaded, fonts settled, timeline built
      () => {
        const g = globalThis as unknown as { renderConfig?: object; seekToFrame?: unknown };
        return typeof g.renderConfig === "object" && typeof g.seekToFrame === "function";
      },
      null,
      { timeout: 30_000 }
    );
    await page.evaluate(() =>
      (globalThis as unknown as { whenSceneReady?: () => Promise<unknown> }).whenSceneReady?.()
    );
    return { page, close: () => context.close() };
  }

  async close(): Promise<void> {
    await Promise.all(
      this.browsers.splice(0).map((b) => b.close().catch(() => undefined))
    );
  }
}

export interface IPage {
  page: Page;
  close: () => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Zero-port route interception
// ---------------------------------------------------------------------------

/**
 * MIME types for the built runtime bundle.
 *
 * The bundle is served straight off disk, so the browser has to be told what
 * it is looking at: a `.js` served as `text/plain` is refused by the module
 * loader, and a `.css` served as `application/octet-stream` is ignored
 * entirely (a silently unstyled frame is worse than a failed render).
 */
const RUNTIME_MIME: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
};

function mimeForRuntimeFile(file: string): string {
  return RUNTIME_MIME[path.extname(file).toLowerCase()] ?? mimeFor(file);
}

/** Read a file, or `null` when it does not exist — a missing file is not fatal. */
async function readFileOrNull(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

/**
 * Normalize a request path into a safe relative file name.
 *
 * Rejects absolute paths, `..` traversal and malformed percent-encoding: a
 * served file must never escape the directory it was resolved against.
 */
function safeRelativePath(name: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    return null;
  }
  const cleaned = decoded.replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("..") || cleaned.includes("\0")) return null;
  return cleaned;
}

/** True when `file` resolves inside `root` (or is `root` itself). */
function insideRoot(root: string, file: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(file);
  return resolvedFile === resolvedRoot || resolvedFile.startsWith(resolvedRoot + path.sep);
}

/**
 * Serve the headless page, the scene and the vault WITHOUT an HTTP origin.
 *
 * The zero-port architecture (see `docs/15_UNIFIED_ARCHITECTURE_BLUEPRINT.md`)
 * removes the engine's listening socket: the domain logic lives in the host
 * process, and the headless browser has to reach it somehow. Playwright's
 * `context.route` is that bridge — every request the runtime makes is
 * answered from memory/disk inside the engine process:
 *
 *   | request                              | answered with                        |
 *   | ------------------------------------ | ------------------------------------ |
 *   | `/preview`                           | `scene-runtime/dist/index.html`      |
 *   | `/assets/*`                          | `scene-runtime/dist/assets/*`        |
 *   | `/api/scenes/:id`                    | the scene (memory) as JSON           |
 *   | `/api/scenes/:id/events`             | an open SSE stream (`:ok`)           |
 *   | `/api/assets/vault/*`, `mf-vault://` | the vault file on disk               |
 *   | anything else                        | `route.fallback()` — the network     |
 *
 * The last row matters: `fallback()` (rather than a synthetic 404) keeps the
 * HTTP-hosted mode working. When the engine IS listening, an unmatched
 * request still reaches the real server, and a vault file that is not on disk
 * is served by the engine rather than failing the render.
 */
export async function setupPlaywrightZeroPortRoutes(
  context: BrowserContext,
  opts: {
    sceneId: string;
    scene?: SceneSpec;
    store?: SceneStore;
    paths?: EnginePaths;
  }
): Promise<void> {
  // The engine's own resolution order (explicit paths → env vars → canonical
  // home) — the same one `EngineCore` uses, so the vault the headless page
  // reads is the vault the engine writes.
  const paths = opts.paths ?? resolveEnginePaths();
  const runtimeDistDir = paths.runtimeDistDir;
  const vaultDir = paths.vaultDir;

  /** The scene for a requested id: the caller's scene first, then the store. */
  const sceneFor = (id: string): SceneSpec | undefined => {
    if (id === opts.sceneId && opts.scene) return opts.scene;
    const stored = opts.store?.get(id)?.scene;
    if (stored) return stored;
    return opts.scene;
  };

  await context.route("**/*", async (route: Route) => {
    const url = route.request().url();

    try {
      // ------------------------------------------------------------------
      // `mf-vault://` — the privileged scheme the zero-port host uses for
      // vault files. `mf-vault://logo.png` puts the name in the host, and
      // `mf-vault://_sfx/whoosh.ogg` splits it across host + path.
      // ------------------------------------------------------------------
      if (url.startsWith("mf-vault://")) {
        const name = safeRelativePath(url.slice("mf-vault://".length));
        if (!name) {
          await route.fulfill({
            status: 400,
            contentType: "text/plain; charset=utf-8",
            body: "invalid vault name",
          });
          return;
        }
        await serveVaultFile(route, vaultDir, name);
        return;
      }

      let pathname: string;
      try {
        pathname = new URL(url).pathname;
      } catch {
        await route.fallback();
        return;
      }

      // ------------------------------------------------------------------
      // the runtime bundle
      // ------------------------------------------------------------------
      if (pathname === "/preview" || pathname === "/preview/") {
        const html = await readFileOrNull(path.join(runtimeDistDir, "index.html"));
        if (!html) {
          await route.fulfill({
            status: 500,
            contentType: "text/plain; charset=utf-8",
            body: `scene-runtime bundle not found at ${runtimeDistDir}`,
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: html,
        });
        return;
      }

      // ------------------------------------------------------------------
      // the scene — checked BEFORE the vault/assets rules, because
      // `/api/assets/vault/…` also contains `/assets/`.
      // ------------------------------------------------------------------
      const eventsMatch = /^\/api\/scenes\/([^/]+)\/events\/?$/.exec(pathname);
      if (eventsMatch) {
        // The live-preview SSE channel. The headless page never subscribes
        // (render mode skips it), but the route must exist so a preview page
        // opened against the zero-port host gets a well-formed stream
        // instead of a connection error.
        await route.fulfill({
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            "access-control-allow-origin": "*",
          },
          body: ":ok\n\n",
        });
        return;
      }

      const sceneMatch = /^\/api\/scenes\/([^/]+)\/?$/.exec(pathname);
      if (sceneMatch) {
        const id = safeRelativePath(sceneMatch[1] ?? "");
        const scene = id ? sceneFor(id) : undefined;
        if (!scene) {
          // Nothing in memory — let the network have it (the engine serves it
          // when it IS listening).
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json; charset=utf-8",
          body: JSON.stringify(scene),
        });
        return;
      }

      // ------------------------------------------------------------------
      // the asset vault
      // ------------------------------------------------------------------
      const vaultMatch = /^\/api\/assets\/vault\/(.+)$/.exec(pathname);
      if (vaultMatch) {
        const name = safeRelativePath(vaultMatch[1] ?? "");
        if (!name) {
          await route.fulfill({
            status: 400,
            contentType: "text/plain; charset=utf-8",
            body: "invalid vault name",
          });
          return;
        }
        await serveVaultFile(route, vaultDir, name);
        return;
      }

      // ------------------------------------------------------------------
      // the runtime's own static assets (the hashed JS/CSS bundle)
      //
      // The page is served at `/preview`, so the bundle's relative
      // `./assets/…` URLs resolve against the origin root — `/assets/…`.
      // ------------------------------------------------------------------
      if (pathname.startsWith("/assets/") || pathname.includes("/assets/")) {
        const marker = "/assets/";
        const index = pathname.indexOf(marker);
        const relative = pathname.slice(index + marker.length);
        const name = safeRelativePath(relative);
        const assetsRoot = path.join(runtimeDistDir, "assets");
        const file = name ? path.join(assetsRoot, name) : null;
        if (!file || !insideRoot(assetsRoot, file)) {
          await route.fallback();
          return;
        }
        const body = await readFileOrNull(file);
        if (!body) {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: mimeForRuntimeFile(file),
          body,
        });
        return;
      }

      // Anything under `/api/` that is not one of the routes above belongs
      // to the engine — never to the runtime bundle directory.
      if (pathname.startsWith("/api/")) {
        await route.fallback();
        return;
      }

      await route.fallback();
    } catch (error) {
      await route
        .fulfill({
          status: 500,
          contentType: "text/plain; charset=utf-8",
          body: error instanceof Error ? error.message : String(error),
        })
        .catch(() => undefined);
    }
  });
}

/**
 * Answer a vault request from disk.
 *
 * A file that is not on disk is NOT an error here: the engine may be running
 * with a different vault root, so the request is handed back to the network
 * (`fallback`) and the engine's own route serves it.
 */
async function serveVaultFile(route: Route, vaultDir: string, name: string): Promise<void> {
  const file = path.join(vaultDir, name);
  if (!insideRoot(vaultDir, file)) {
    await route.fulfill({
      status: 400,
      contentType: "text/plain; charset=utf-8",
      body: "invalid vault path",
    });
    return;
  }
  const body = await readFileOrNull(file);
  if (!body) {
    await route.fallback();
    return;
  }
  await route.fulfill({
    status: 200,
    contentType: mimeFor(name),
    body,
  });
}

/**
 * Frame screenshot, JPEG in memory.
 *
 * `seekToFrame` only resolves once the frame is fully settled (timeline seek →
 * layer lifecycle → media resync → fonts → image decode → layout flush → two
 * committed animation frames), so the very next screenshot is that frame. The
 * screenshot is clipped to the viewport, never full-page: a full-page capture
 * would silently change resolution if the document ever overflowed.
 */
async function captureFrame(page: Page, frame: number, jpegQuality: number): Promise<Buffer> {
  await page.evaluate((f) => {
    return (globalThis as unknown as { seekToFrame(frame: number): Promise<void> }).seekToFrame(f);
  }, frame);
  return (await page.screenshot({ type: "jpeg", quality: jpegQuality, fullPage: false })) as Buffer;
}

// ---------------------------------------------------------------------------
// Worker pool
// ---------------------------------------------------------------------------

function splitRanges(total: number, workers: number): Array<[number, number]> {
  const perWorker = Math.ceil(total / workers);
  const ranges: Array<[number, number]> = [];
  for (let start = 0; start < total; start += perWorker) {
    ranges.push([start, Math.min(total, start + perWorker)]);
  }
  return ranges;
}

export interface ParallelRenderResult {
  partPaths: string[];
  frames: number;
  workerCount: number;
}

/**
 * N workers over contiguous frame ranges; each pipes JPEG buffers straight into
 * its own FFmpeg `image2pipe` encoder. Frames never touch the disk — only small
 * MP4 fragments do (concatenated later with `-c copy`).
 */
export async function renderFramesParallel(opts: {
  pool: RendererPool;
  scene: SceneSpec;
  sceneId: string;
  baseUrl: string;
  profile: RenderProfile;
  encoder: string;
  jobDir: string;
  config: EngineConfig;
  /** engine paths — the zero-port routes serve the vault + runtime bundle */
  paths?: EnginePaths;
  /** the scene store — the zero-port `/api/scenes/:id` route answers from it */
  store?: SceneStore;
  onProgress?: (framesDone: number) => void;
}): Promise<ParallelRenderResult> {
  const { scene, profile, config } = opts;
  const totalFrames = Math.max(1, Math.round((scene.durationMs / 1000) * profile.fps));
  const ranges = splitRanges(totalFrames, Math.min(config.maxRenderWorkers, totalFrames));

  const canvasSize = resolveCanvasSize(scene.canvas);
  // draft mode captures a downscaled fit; production captures the canvas 1:1
  const fit = profile.outWidth !== canvasSize.width;

  const workers = ranges.map(async ([from, to], i) => {
    const partPath = path.join(opts.jobDir, `part_${String(i).padStart(2, "0")}.mp4`);
    await renderFrameRange({
      pool: opts.pool,
      sceneId: opts.sceneId,
      baseUrl: opts.baseUrl,
      profile,
      encoder: opts.encoder,
      from,
      to,
      partPath,
      fit,
      viewportWidth: profile.outWidth,
      viewportHeight: profile.outHeight,
      scene,
      ...(opts.paths ? { paths: opts.paths } : {}),
      ...(opts.store ? { store: opts.store } : {}),
      onFrameDone: opts.onProgress,
    });
    return partPath;
  });

  const partPaths = await Promise.all(workers);
  return { partPaths, frames: totalFrames, workerCount: ranges.length };
}

async function renderFrameRange(opts: {
  pool: RendererPool;
  sceneId: string;
  baseUrl: string;
  profile: RenderProfile;
  encoder: string;
  from: number;
  to: number;
  partPath: string;
  fit: boolean;
  viewportWidth: number;
  viewportHeight: number;
  /** the scene being rendered — served by the zero-port scene route */
  scene?: SceneSpec;
  /** engine paths — the zero-port routes serve the vault + runtime bundle */
  paths?: EnginePaths;
  /** the scene store — the zero-port `/api/scenes/:id` route answers from it */
  store?: SceneStore;
  onFrameDone?: (framesDone: number) => void;
}): Promise<void> {
  const { profile } = opts;
  const { page, close } = await opts.pool.openRenderPage({
    baseUrl: opts.baseUrl,
    sceneId: opts.sceneId,
    profile,
    viewportWidth: opts.viewportWidth,
    viewportHeight: opts.viewportHeight,
    fit: opts.fit,
    ...(opts.scene ? { scene: opts.scene } : {}),
    ...(opts.paths ? { paths: opts.paths } : {}),
    ...(opts.store ? { store: opts.store } : {}),
  });
  try {
    const proc = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "image2pipe", "-framerate", String(profile.fps), "-c:v", "mjpeg", "-i", "pipe:0",
      "-vf", `fps=${profile.fps},format=yuv420p`,
      ...encoderArgs(opts.encoder, profile.quality),
      "-pix_fmt", "yuv420p",
      "-f", "mp4",
      opts.partPath,
    ]);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += String(d)));
    const encodeDone = new Promise<void>((resolve, reject) => {
      proc.on("error", (e) => reject(new FfmpegError(`encoder spawn failed: ${e.message}`, "")));
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new FfmpegError(`encoder exited ${code} for ${path.basename(opts.partPath)}`, stderr.slice(-1200)));
      });
    });

    const writer = new StdinWriter(proc);
    for (let frame = opts.from; frame < opts.to; frame++) {
      const buffer = await captureFrame(page, frame, profile.jpegQuality);
      await writer.write(buffer);
      opts.onFrameDone?.(1);
    }
    proc.stdin.end();
    await encodeDone;
  } finally {
    await close();
  }
}
