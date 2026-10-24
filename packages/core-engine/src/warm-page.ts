/**
 * THE WARM PAGE.
 *
 * WHY THIS EXISTS: the engine used to open a FRESH browser context for every
 * measurement, navigate to `/preview?scene=…`, wait for the network to go
 * quiet (`network-idle` — which cost ~940 ms of dead time per call) and only
 * then ask the runtime what the frame looked like. A ten-frame inspection
 * cost ~55 seconds (5938 ms/frame), and every millisecond of it was spent
 * re-launching a browser and re-loading a bundle that had not changed.
 *
 * The runtime already knows how to be re-used: `window.mountSceneFromHost(scene,
 * sceneId, fps)` mounts (or REPLACES) a scene in an ALREADY-LOADED page, with
 * no navigation, and re-publishes `window.renderConfig`, `window.describeFrame`
 * and `window.getLayerBounds()`. So the engine keeps ONE page alive for the
 * lifetime of the process and pushes scenes into it.
 *
 * The rules this class obeys:
 *
 * - ONE browser context, ONE page, created LAZILY and kept until `dispose()`.
 * - The page is loaded ONCE, with NO scene id, so the runtime boots empty.
 * - Every page operation is SERIALISED through one promise chain: two
 *   concurrent mounts would interleave and leave the page on a half-built
 *   scene.
 * - The page is reusable across DIFFERENT scenes — the runtime unmounts the
 *   previous one.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { resolveCanvasSize, type SceneSpec } from "@motionforge/scene-spec";

import type { EnginePaths } from "./config.js";
import { setupPlaywrightZeroPortRoutes } from "./renderer.js";
import { sceneHash, type SceneStore } from "./scene-store.js";

/**
 * THE INLINE PREVIEW — the maximum width, in device pixels, and the JPEG
 * quality.
 *
 * MCP over stdio is a PIPE: twelve full-resolution 1080p PNGs are ~15 MB of
 * base64, which overflows the pipe buffer, closes the client end and kills
 * the server with an unhandled `write EPIPE`. The preview is the same frame
 * at a fraction of the size, and the full-resolution original is still
 * written to disk.
 */
export const PREVIEW_MAX_WIDTH = 960;
export const PREVIEW_JPEG_QUALITY = 75;

/** The scene id the zero-port routes are registered under for the warm page. */
const WARM_SCENE_ID = "__warm__";

/** The default frame rate of a warm page. */
export const WARM_FPS = 60;

export interface WarmPageOptions {
  /** the engine origin — only used for the ONE navigation */
  baseUrl: string;
  /** engine paths — the zero-port routes serve the vault + runtime bundle */
  paths?: EnginePaths;
  /** the scene store — the zero-port `/api/scenes/:id` route answers from it */
  store?: SceneStore;
  log?: (msg: string) => void;
}

/** What the page reports for one timestamp. */
export interface WarmFrameReport {
  /** the runtime's numeric description of the frame (camera, layers, …) */
  describe: unknown;
  /** the composition-space box of every mounted layer, keyed by layer id */
  bounds: Record<string, unknown>;
}

/** One measured + captured frame — the inspection's answer. */
export interface WarmInspectedFrame {
  atMs: number;
  /** the lightweight inline preview (a JPEG data URL) */
  preview: string;
  /** the FULL-RESOLUTION PNG as a data URL (empty unless asked for) */
  image: string;
  /** the numeric frame description — the `framesMeta` sidecar */
  describe: unknown;
}

/**
 * The host-side view of the runtime's globals.
 *
 * The engine has no DOM lib, and Playwright serialises every `evaluate`
 * callback into the browser — so nothing from this module's scope reaches the
 * page. Every snippet below therefore casts `globalThis` itself.
 */
interface RuntimeGlobals {
  renderConfig?: { fps?: number; width?: number; height?: number; durationMs?: number };
  seekToFrame?: (frame: number) => Promise<void>;
  whenSceneReady?: () => Promise<unknown>;
  describeFrame?: (timeMs: number) => unknown;
  getLayerBounds?: () => Record<string, unknown>;
  mountSceneFromHost?: (scene: unknown, sceneId: string, fps?: number) => Promise<void>;
  seekToFrameForLayout?: (frame: number) => Promise<void>;
}

/**
 * One long-lived browser page that the engine pushes scenes into.
 */
export class WarmPage {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private boot: Promise<Page> | null = null;
  /** every page operation runs through this chain, one at a time */
  private chain: Promise<unknown> = Promise.resolve();
  /** the frame rate of the scene currently mounted */
  private mountedFps = WARM_FPS;
  /** the id + content hash of the scene currently mounted */
  private mountedKey: string | null = null;
  /** the viewport the page is currently sized to */
  private viewport: { width: number; height: number } | null = null;
  private disposed = false;

  constructor(private readonly opts: WarmPageOptions) {}

  /**
   * Mount (or REPLACE) the scene in the page.
   *
   * Two callers can never interleave a mount: the call is queued behind every
   * other page operation.
   *
   * Mounting the scene that is ALREADY mounted is a no-op: the page is warm
   * for that scene, and re-mounting it would cost a full rebuild (assets,
   * fonts, DOM) for the same picture.
   */
  async mount(scene: SceneSpec, sceneId: string, fps: number = WARM_FPS): Promise<void> {
    const page = await this.ensurePage();
    const key = `${sceneId}:${sceneHash(scene)}`;
    await this.serialise(async () => {
      if (this.mountedKey === key) return;
      // The stage is 1:1 in render mode and CENTRED in the viewport, so the
      // viewport has to be the canvas size for the runtime's screen-space
      // bounding boxes to be canvas-space boxes. A scene on another canvas
      // resizes the page first.
      const size = canvasOf(scene);
      if (!this.viewport || this.viewport.width !== size.width || this.viewport.height !== size.height) {
        await page.setViewportSize({ width: size.width, height: size.height });
        this.viewport = { ...size };
      }
      await this.mountOnPage(page, scene, sceneId, fps);
      this.mountedFps = fps;
      this.mountedKey = key;
    });
  }

  /**
   * Seek to `atMs` and read the frame's description + the layer boxes.
   *
   * NO SCREENSHOT: this is the zero-rasterisation path. Everything a layout
   * check needs is a number, and a number does not need pixels.
   */
  async frameReport(atMs: number): Promise<WarmFrameReport> {
    const reports = await this.measureFrames([atMs]);
    return reports[0] ?? { describe: null, bounds: {} };
  }

  /**
   * Measure a LIST of timestamps in ONE page round-trip.
   *
   * ONE round-trip, not one per timestamp: the per-call overhead of a
   * Playwright `evaluate` (serialise the callback, cross the process
   * boundary, deserialise the answer) is a large part of a cheap
   * measurement, and a layout question is always asked about several
   * timestamps at once.
   *
   * THE MEASUREMENT IS THE LAYOUT SETTLE — the same door `get_layer_bounds`
   * uses, and now the same door the inspection's sidecar uses. That is what
   * makes the two paths agree to the PIXEL: they are the same page, the same
   * settle and the same `describeFrame` call.
   */
  async measureFrames(atMs: number[]): Promise<WarmFrameReport[]> {
    if (atMs.length === 0) return [];
    const page = await this.ensurePage();
    return this.serialise(async () => {
      const fps = this.mountedFps;
      return await page.evaluate(
        async (payload: { atMs: number[]; fps: number }) => {
          const g = globalThis as unknown as RuntimeGlobals;
          const out: Array<{ describe: unknown; bounds: Record<string, unknown> }> = [];
          for (const stamp of payload.atMs) {
            const frame = Math.max(0, Math.round((stamp / 1000) * payload.fps));
            // THE LAYOUT DOOR when the runtime has it: the same geometry,
            // without the media resync and the image decode. A bounding box
            // does not depend on either.
            if (typeof g.seekToFrameForLayout === "function") {
              await g.seekToFrameForLayout(frame);
            } else if (typeof g.seekToFrame === "function") {
              await g.seekToFrame(frame);
            }
            const describe =
              typeof g.describeFrame === "function" ? g.describeFrame(stamp) : null;
            const bounds =
              typeof g.getLayerBounds === "function" ? g.getLayerBounds() : {};
            out.push({ describe, bounds: (bounds ?? {}) as Record<string, unknown> });
          }
          return out;
        },
        { atMs, fps }
      );
    });
  }

  /**
   * MEASURE and CAPTURE a list of timestamps — the inspection path.
   *
   * TWO PASSES, ON PURPOSE:
   *
   * 1. MEASURE every frame with the layout settle — the same measurement
   *    `get_layer_bounds` makes, on the same page. The numbers an agent reads
   *    are therefore the numbers the cheap oracle would have given it.
   * 2. CAPTURE the frames with the FULL settle (media resynced, images
   *    decoded) so the PICTURE is right.
   *
   * The capture pass resizes the viewport to render a smaller copy of the
   * frame, and restoring it can leave the page with a residual scroll offset
   * — which used to move the stage and make every frame after the first
   * disagree with the first. Measuring FIRST removes that contamination
   * entirely.
   */
  async inspectFrames(
    atMs: number[],
    opts: { width: number; height: number; includeFullResolution?: boolean }
  ): Promise<WarmInspectedFrame[]> {
    if (atMs.length === 0) return [];
    const measured = await this.measureFrames(atMs);
    const page = await this.ensurePage();
    return this.serialise(async () => {
      const fps = this.mountedFps;
      const frames: WarmInspectedFrame[] = [];
      for (const [index, stamp] of atMs.entries()) {
        const frame = Math.max(0, Math.round((stamp / 1000) * fps));
        // the FULL settle: the picture needs the media and the bitmaps
        await page.evaluate((f) => {
          return (globalThis as unknown as { seekToFrame(frame: number): Promise<void> }).seekToFrame(f);
        }, frame);
        const preview = await this.capturePreview(page, opts.width, opts.height);
        const image = opts.includeFullResolution
          ? `data:image/png;base64,${((await page.screenshot({ type: "png" })) as Buffer).toString("base64")}`
          : "";
        frames.push({
          atMs: stamp,
          preview,
          image,
          describe: measured[index]?.describe ?? null,
        });
      }
      return frames;
    });
  }

  /**
   * Capture the current frame as a small JPEG preview.
   *
   * The canvas keeps its exact LAYOUT — only the rasterization shrinks.
   * Playwright re-applies its own device metrics immediately before every
   * screenshot, so a CDP `deviceScaleFactor` override is silently discarded;
   * the stage's own fit-to-window transform is the one scale the page honours.
   */
  private async capturePreview(page: Page, width: number, height: number): Promise<string> {
    const scale = Math.min(1, PREVIEW_MAX_WIDTH / Math.max(1, width));
    if (scale >= 1) return "";
    const previewWidth = Math.round(width * scale);
    const previewHeight = Math.round(height * scale);

    // NOTE: every `page.evaluate` snippet below is SELF-CONTAINED. Playwright
    // serializes the callback into the browser, so nothing from this module's
    // scope reaches it — and the engine's tsconfig has no DOM lib, hence the
    // `globalThis` cast inside the snippet rather than a shared helper.
    const original = await page.evaluate(() => {
      const g = globalThis as unknown as {
        document: { getElementById(id: string): { style: { transform: string } } | null };
      };
      return g.document.getElementById("stage")?.style.transform ?? null;
    });
    try {
      await page.setViewportSize({ width: previewWidth, height: previewHeight });
      await page.evaluate((s) => {
        const g = globalThis as unknown as {
          document: { getElementById(id: string): { style: { transform: string } } | null };
        };
        const stage = g.document.getElementById("stage");
        if (stage) stage.style.transform = `translate(-50%, -50%) scale(${s})`;
      }, scale);
      const buffer = (await page.screenshot({ type: "jpeg", quality: PREVIEW_JPEG_QUALITY })) as Buffer;
      return `data:image/jpeg;base64,${buffer.toString("base64")}`;
    } catch {
      // a preview is a convenience — never fail an inspection over it
      return "";
    } finally {
      await page
        .evaluate((transform) => {
          if (transform === null) return;
          const g = globalThis as unknown as {
            document: { getElementById(id: string): { style: { transform: string } } | null };
          };
          const stage = g.document.getElementById("stage");
          if (stage) stage.style.transform = transform;
          // the viewport dance can leave the document scrolled — and a
          // scrolled document moves every box by the scroll offset
          const w = globalThis as unknown as { scrollTo?: (x: number, y: number) => void };
          w.scrollTo?.(0, 0);
        }, original)
        .catch(() => undefined);
      const canvas = this.viewport ?? { width, height };
      await page.setViewportSize({ width: canvas.width, height: canvas.height }).catch(() => undefined);
      await page
        .evaluate(() => {
          const w = globalThis as unknown as { scrollTo?: (x: number, y: number) => void };
          w.scrollTo?.(0, 0);
        })
        .catch(() => undefined);
    }
  }

  /** Close the context and the browser. The page is unusable afterwards. */
  async dispose(): Promise<void> {
    this.disposed = true;
    const context = this.context;
    const browser = this.browser;
    this.context = null;
    this.browser = null;
    this.page = null;
    this.boot = null;
    // let the queued work drain before the browser goes away
    await this.chain.catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  /** Run `op` after every other page operation has finished. */
  private serialise<T>(op: () => Promise<T>): Promise<T> {
    const run = this.chain.then(
      () => op(),
      () => op()
    );
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async ensurePage(): Promise<Page> {
    if (this.page) return this.page;
    if (this.disposed) throw new Error("warm page is disposed");
    this.boot ??= this.openPage();
    const page = await this.boot;
    this.page = page;
    return page;
  }

  private async openPage(): Promise<Page> {
    const browser = await chromium.launch({
      headless: true,
      args: [
        // identical rasterization flags to the render pipeline (renderer.ts), so
        // an inspected frame looks exactly like the delivered video
        "--disable-lcd-text",
        "--font-render-hinting=none",
        "--force-device-scale-factor=1",
        "--hide-scrollbars",
        "--use-gl=angle",
        "--use-angle=d3d11",
        "--enable-gpu-rasterization",
        "--enable-zero-copy",
        "--ignore-gpu-blocklist",
        "--disable-software-rasterizer",
      ],
    });
    this.browser = browser;
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      reducedMotion: "no-preference",
      colorScheme: "dark",
    });
    this.context = context;
    this.viewport = { width: 1920, height: 1080 };

    // Zero-port: the page, the vault and the runtime bundle are served from
    // memory/disk, so the warm page never needs the engine's HTTP origin.
    await setupPlaywrightZeroPortRoutes(context, {
      sceneId: WARM_SCENE_ID,
      ...(this.opts.store ? { store: this.opts.store } : {}),
      ...(this.opts.paths ? { paths: this.opts.paths } : {}),
    });

    const page = await context.newPage();
    page.on("pageerror", (err) => this.opts.log?.(`[warm-page] ${String(err)}`));

    // The ONE navigation. `network-idle` waited ~940 ms for a silence that
    // never came (the page holds an SSE channel open) — `domcontentloaded`
    // plus the explicit readiness probe below is both faster and stricter.
    await page.goto(`${this.opts.baseUrl}/preview?render=1&fps=${WARM_FPS}`, {
      waitUntil: "domcontentloaded",
    });

    // The runtime publishes its readiness promise, then its host door.
    await page.waitForFunction(
      () => typeof (globalThis as unknown as RuntimeGlobals).whenSceneReady === "function",
      null,
      { timeout: 30_000 }
    );
    await page.evaluate(async () => {
      const g = globalThis as unknown as RuntimeGlobals;
      await g.whenSceneReady?.();
    });

    // The host door (`window.mountSceneFromHost`) is what makes the page
    // reusable. A runtime that publishes it only after the first mount is
    // handled too: `mountOnPage` falls back to the runtime's own host
    // message, which installs the same door.
    await this.waitForHostDoor(page);

    this.opts.log?.("[warm-page] ready");
    return page;
  }

  /**
   * Wait (briefly) for `window.mountSceneFromHost` to be a function.
   *
   * The wait is BOUNDED on purpose: a runtime that publishes the door only
   * after the first mount must not stall the boot — the fallback path in
   * `mountOnPage` covers it, and the door is there from then on.
   */
  private async waitForHostDoor(page: Page): Promise<boolean> {
    try {
      await page.waitForFunction(
        () => typeof (globalThis as unknown as RuntimeGlobals).mountSceneFromHost === "function",
        null,
        { timeout: 1000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Push a scene into the page.
   *
   * The fast path is the runtime's own door. The fallback is the runtime's
   * `motionforge:initScene` message — the same door the Studio uses — for a
   * runtime that has not published `mountSceneFromHost` yet.
   */
  private async mountOnPage(page: Page, scene: SceneSpec, sceneId: string, fps: number): Promise<void> {
    const hasDoor = await page.evaluate(
      () => typeof (globalThis as unknown as RuntimeGlobals).mountSceneFromHost === "function"
    );

    if (hasDoor) {
      await page.evaluate(
        async (payload: { scene: unknown; sceneId: string; fps: number }) => {
          const g = globalThis as unknown as RuntimeGlobals;
          await g.mountSceneFromHost?.(payload.scene, payload.sceneId, payload.fps);
        },
        { scene, sceneId, fps }
      );
      await this.settle(page);
      return;
    }

    // FALLBACK — the runtime's own host message.
    //
    // `renderConfig` is a NEW object for every mount, so its identity is the
    // signal that the mount actually landed (the previous scene's config
    // object is still there while the new one is being built).
    const mounted = await page.evaluate(
      async (payload: { scene: unknown; sceneId: string }) => {
        const g = globalThis as unknown as RuntimeGlobals & {
          MessageEvent?: new (type: string, init: { data: unknown }) => unknown;
          dispatchEvent: (event: unknown) => boolean;
        };
        const before = g.renderConfig ?? null;
        const event = new g.MessageEvent!("message", {
          data: { type: "motionforge:initScene", scene: payload.scene, sceneId: payload.sceneId, atMs: 0 },
        });
        g.dispatchEvent(event);
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          if (
            g.renderConfig &&
            g.renderConfig !== before &&
            typeof g.describeFrame === "function" &&
            typeof g.getLayerBounds === "function"
          ) {
            return true;
          }
        }
        return false;
      },
      { scene, sceneId }
    );
    if (!mounted) {
      throw new Error(`warm page: the runtime did not mount scene "${sceneId}"`);
    }
    await this.settle(page);
  }

  /** Let the page finish the frame it just settled on. */
  private async settle(page: Page): Promise<void> {
    await page.evaluate(async () => {
      const g = globalThis as unknown as RuntimeGlobals;
      await g.whenSceneReady?.();
    });
  }
}

/** The canvas size of a scene, in pixels. */
function canvasOf(scene: SceneSpec): { width: number; height: number } {
  return resolveCanvasSize(scene.canvas);
}
