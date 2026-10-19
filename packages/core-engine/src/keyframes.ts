import { chromium, type Browser } from "playwright";
import { resolveCanvasSize, type SceneSpec } from "@motionforge/scene-spec";

import type { EnginePaths } from "./config.js";
import { setupPlaywrightZeroPortRoutes } from "./renderer.js";
import type { SceneStore } from "./scene-store.js";

let browserPromise: Promise<Browser> | null = null;

async function browser(): Promise<Browser> {
  browserPromise ??= chromium.launch({
    headless: true,
    args: [
      // identical rasterization flags to the render pipeline (renderer.ts), so
      // an inspected frame looks exactly like the delivered video
      "--disable-lcd-text",
      "--font-render-hinting=none",
      "--force-device-scale-factor=1",
      "--hide-scrollbars",
    ],
  });
  return browserPromise;
}

/**
 * Insider screenshots at exact timestamps for visual verification — the tool
 * behind `inspect_scene_keyframes`. Reuses one pooled browser; contexts are
 * cheap and disposable.
 */
/**
 * Numeric per-frame description produced by the runtime (see
 * `scene-runtime/src/scene-builder.ts`). Kept as a loose shape here because the
 * runtime owns the contract; the fields are all optional so a runtime older than
 * the engine degrades to "no metadata" instead of breaking inspection.
 */
export interface FrameMeta {
  atMs: number;
  camera?: {
    scale: number;
    xPct: number;
    yPct: number;
    roll: number;
    yaw: number;
    pitch: number;
    /** the runtime held the camera inside the canvas because the pose exceeded it */
    clampedVoid: boolean;
  };
  activeTransitions?: Array<{ kind: string; progressPct: number; phase: "in" | "peak" | "out" }>;
  layers?: Array<{
    id: string;
    type: string;
    lifecyclePhase: "entrance" | "settled" | "emphasis" | "exit";
    phaseProgressPct: number;
    opacity: number;
    bbox: { x: number; y: number; width: number; height: number };
    textOverflow: boolean;
  }>;
}

export interface InspectedFrame {
  atMs: number;
  /** the FULL-RESOLUTION PNG (data:image/png;base64,…) — the client deliverable */
  image: string;
  /**
   * A lightweight preview (data:image/jpeg;base64,…) for INLINE transport.
   *
   * The inline copy is what an MCP tool result carries, and MCP over stdio is a
   * PIPE: twelve full-resolution 1080p PNGs are ~15 MB of base64, which
   * overflows the pipe buffer, closes the client end and kills the server with
   * an unhandled `write EPIPE`. The preview is the same frame at a fraction of
   * the size, and the full-resolution original is still written to disk.
   */
  preview: string;
  meta?: FrameMeta;
}

/** The maximum width of an inline preview, in device pixels. */
export const PREVIEW_MAX_WIDTH = 960;

/** JPEG quality of an inline preview. */
export const PREVIEW_JPEG_QUALITY = 75;

/**
 * Insider screenshots at exact timestamps for visual verification — the tool
 * behind `inspect_scene_keyframes`. Reuses one pooled browser; contexts are
 * cheap and disposable.
 *
 * Every frame also carries a numeric `meta` sidecar read from the runtime's
 * `window.describeFrame`. That sidecar is what turns "the frame looks wrong"
 * into "layer `headline` is mid-entrance at 62%" or "layer `card` is
 * text-overflowing" — the class of judgement an agent previously had to make by
 * eyeballing pixels (report 1 P0-5 / §4.4-4.5).
 */
export async function inspectKeyframes(opts: {
  scene: SceneSpec;
  sceneId: string;
  baseUrl: string;
  at: number[];
  /**
   * Capture the full-resolution PNG as well. Off by default: the inline
   * preview is enough for visual verification, and the full-res original is
   * only needed when the frames are about to be written to disk.
   */
  includeFullResolution?: boolean;
  /**
   * Engine paths. The zero-port routes serve the runtime bundle and the
   * asset vault from disk, so an inspection needs no listening engine.
   */
  paths?: EnginePaths;
  /** The scene store — the zero-port `/api/scenes/:id` route answers from it. */
  store?: SceneStore;
}): Promise<InspectedFrame[]> {
  const browserRef = await browser();
  const { width, height } = resolveCanvasSize(opts.scene.canvas);
  const context = await browserRef.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  try {
    // Zero-port: the page, the scene and the vault are served from memory, so
    // the inspection never depends on the engine's HTTP origin being up.
    await setupPlaywrightZeroPortRoutes(context, {
      sceneId: opts.sceneId,
      scene: opts.scene,
      ...(opts.store ? { store: opts.store } : {}),
      ...(opts.paths ? { paths: opts.paths } : {}),
    });
    const page = await context.newPage();
    await page.goto(
      `${opts.baseUrl}/preview?scene=${encodeURIComponent(opts.sceneId)}&render=1&fps=60`,
      { waitUntil: "networkidle" }
    );
    await page.waitForFunction(
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

    const frames: InspectedFrame[] = [];
    for (const atMs of opts.at) {
      // the runtime clamps to its own totalFrames internally
      const frame = Math.max(0, Math.round((atMs / 1000) * 60));
      await page.evaluate((f) => {
        return (globalThis as unknown as { seekToFrame(frame: number): Promise<void> }).seekToFrame(f);
      }, frame);
      const meta = await page.evaluate((ms) => {
        const describe = (globalThis as unknown as {
          describeFrame?: (t: number) => unknown;
        }).describeFrame;
        // a runtime without the sidecar yields undefined, not a throw
        return typeof describe === "function" ? (describe(ms) as unknown) : undefined;
      }, atMs);
      // The inline preview: the same frame rendered at a lower device pixel
      // ratio, which keeps the composition identical (the CSS layout is
      // untouched — only the rasterization density changes) while shrinking
      // the payload by an order of magnitude.
      const preview = await capturePreview(page, width, height);
      // PNG (not JPEG): the stills are deliverable client assets — lossless, and
      // `saveStillsToDisk` on the project path writes them as .png files.
      const buffer = opts.includeFullResolution
        ? ((await page.screenshot({ type: "png" })) as Buffer)
        : null;
      frames.push({
        atMs,
        image: buffer ? `data:image/png;base64,${buffer.toString("base64")}` : "",
        preview,
        ...(meta && typeof meta === "object" ? { meta: { atMs, ...(meta as object) } as FrameMeta } : {}),
      });
    }
    return frames;
  } finally {
    await context.close();
  }
}

/**
 * Capture the current frame as a small JPEG preview.
 *
 * The canvas keeps its exact 1920×1080 LAYOUT — only the rasterization shrinks.
 * Playwright re-applies its own device metrics immediately before every
 * screenshot, so a CDP `deviceScaleFactor` override is silently discarded; the
 * stage's own fit-to-window transform is the one scale the page honours.
 */
async function capturePreview(
  page: import("playwright").Page,
  width: number,
  height: number
): Promise<string> {
  const scale = Math.min(1, PREVIEW_MAX_WIDTH / Math.max(1, width));
  if (scale >= 1) return "";
  const previewWidth = Math.round(width * scale);
  const previewHeight = Math.round(height * scale);

  // NOTE: every `page.evaluate` snippet below is SELF-CONTAINED. Playwright
  // serializes the callback into the browser, so nothing from this module's
  // scope reaches it — and the engine's tsconfig has no DOM lib, hence the
  // `globalThis` cast inside the snippet rather than a shared helper.
  const original = await page.evaluate(() => {
    const g = globalThis as unknown as { document: { getElementById(id: string): { style: { transform: string } } | null } };
    return g.document.getElementById("stage")?.style.transform ?? null;
  });
  try {
    await page.setViewportSize({ width: previewWidth, height: previewHeight });
    // the canvas keeps its authored pixel size; only the stage shrinks
    await page.evaluate((s) => {
      const g = globalThis as unknown as { document: { getElementById(id: string): { style: { transform: string } } | null } };
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
        const g = globalThis as unknown as { document: { getElementById(id: string): { style: { transform: string } } | null } };
        const stage = g.document.getElementById("stage");
        if (stage) stage.style.transform = transform;
      }, original)
      .catch(() => undefined);
    await page.setViewportSize({ width, height }).catch(() => undefined);
  }
}

export interface LayerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/**
 * Extract layer bounding boxes on the server side via Playwright.
 */
export async function getFrameBounds(opts: {
  scene: SceneSpec;
  sceneId: string;
  baseUrl: string;
  frameIndex: number;
  /**
   * Engine paths. The zero-port routes serve the runtime bundle and the
   * asset vault from disk, so no listening engine is required.
   */
  paths?: EnginePaths;
  /** The scene store — the zero-port `/api/scenes/:id` route answers from it. */
  store?: SceneStore;
}): Promise<Record<string, LayerBounds>> {
  const browserRef = await browser();
  const { width, height } = resolveCanvasSize(opts.scene.canvas);
  const context = await browserRef.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  try {
    // Zero-port: the page, the scene and the vault are served from memory.
    await setupPlaywrightZeroPortRoutes(context, {
      sceneId: opts.sceneId,
      scene: opts.scene,
      ...(opts.store ? { store: opts.store } : {}),
      ...(opts.paths ? { paths: opts.paths } : {}),
    });
    const page = await context.newPage();
    await page.goto(
      `${opts.baseUrl}/preview?scene=${encodeURIComponent(opts.sceneId)}&render=1&fps=60`,
      { waitUntil: "networkidle" }
    );
    await page.waitForFunction(
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

    await page.evaluate((f) => {
      return (globalThis as unknown as { seekToFrame(frame: number): Promise<void> }).seekToFrame(f);
    }, opts.frameIndex);

    const bounds = await page.evaluate(() => {
      const g = globalThis as unknown as { getLayerBounds?: () => unknown };
      if (typeof g.getLayerBounds === "function") {
        return g.getLayerBounds();
      }
      return {};
    });

    return (bounds as Record<string, LayerBounds>) || {};
  } finally {
    await context.close();
  }
}

