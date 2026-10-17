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
export async function inspectKeyframes(opts: {
  scene: SceneSpec;
  sceneId: string;
  baseUrl: string;
  at: number[];
}): Promise<Array<{ atMs: number; image: string }>> {
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

    const frames: Array<{ atMs: number; image: string }> = [];
    for (const atMs of opts.at) {
      // the runtime clamps to its own totalFrames internally
      const frame = Math.max(0, Math.round((atMs / 1000) * 60));
      await page.evaluate((f) => {
        return (globalThis as unknown as { seekToFrame(frame: number): Promise<void> }).seekToFrame(f);
      }, frame);
      const buffer = (await page.screenshot({ type: "jpeg", quality: 88 })) as Buffer;
      frames.push({ atMs, image: `data:image/jpeg;base64,${buffer.toString("base64")}` });
    }
    return frames;
  } finally {
    await context.close();
  }
}
