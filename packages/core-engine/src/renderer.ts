import { spawn } from "node:child_process";
import path from "node:path";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { resolveCanvasSize, type SceneSpec } from "@motionforge/scene-spec";

import type { EngineConfig } from "./config.js";
import type { RenderProfile } from "./encoder.js";
import { FfmpegError, encoderArgs, StdinWriter } from "./encoder.js";

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
    const page = await context.newPage();
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
