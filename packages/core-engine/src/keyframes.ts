import { chromium, type Browser } from "playwright";
import { resolveCanvasSize, type SceneSpec } from "@motionforge/scene-spec";

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
  image: string;
  meta?: FrameMeta;
}

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
}): Promise<InspectedFrame[]> {
  const browserRef = await browser();
  const { width, height } = resolveCanvasSize(opts.scene.canvas);
  const context = await browserRef.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  try {
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
      // PNG (not JPEG): the stills are deliverable client assets — lossless, and
      // `saveStillsToDisk` on the project path writes them as .png files.
      const buffer = (await page.screenshot({ type: "png" })) as Buffer;
      frames.push({
        atMs,
        image: `data:image/png;base64,${buffer.toString("base64")}`,
        ...(meta && typeof meta === "object" ? { meta: { atMs, ...(meta as object) } as FrameMeta } : {}),
      });
    }
    return frames;
  } finally {
    await context.close();
  }
}
