import "./style.css";
import { resolveCanvasSize, type SceneSpec } from "@motionforge/scene-spec";
import { createStage } from "./stage.js";
import { loadSceneFonts } from "./fonts.js";
import { assetKindOf, fetchScene, preloadAssets, resolveAssetUrl } from "./api.js";
import { buildScene } from "./scene-builder.js";
import { mountTimelineUI } from "./timeline-ui.js";
import type { RenderConfig, Seekable } from "./types.js";

function showError(message: string): void {
  const box = document.getElementById("mf-error");
  const inner = box?.firstElementChild;
  if (box && inner) {
    inner.textContent = message;
    box.classList.remove("hidden");
    box.classList.add("flex");
  }
  console.error(`[motionforge] ${message}`);
}

async function nextPaint(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function boot(): Promise<void> {
  let readyResolve!: () => void;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  window.whenSceneReady = () => ready;

  const params = new URLSearchParams(window.location.search);
  const renderMode = params.get("render") === "1";
  const sceneId = params.get("scene");
  const fps = Number(params.get("fps") ?? 60);

  if (!sceneId) {
    showError('Missing "?scene=<id>" — pass the id of a scene stored in core-engine.');
    readyResolve();
    return;
  }

  let scene: SceneSpec;
  try {
    scene = await fetchScene(sceneId);
  } catch (error) {
    showError(
      `Could not load scene "${sceneId}": ${error instanceof Error ? error.message : String(error)}. ` +
        "Is core-engine running (default http://localhost:4000)?"
    );
    readyResolve();
    return;
  }

  const { width, height } = resolveCanvasSize(scene.canvas);
  const stage = createStage(width, height);

  try {
    const { lottieJson } = await preloadAssets(scene);

    const seekables: Seekable[] = [];
    const fonts = await loadSceneFonts(scene);
    const { tl } = buildScene(scene, stage, {
      fonts,
      resolveAsset: resolveAssetUrl,
      assetKind: assetKindOf(scene),
      lottieData: (assetId) => {
        const data = lottieJson.get(assetId);
        if (!data) throw new Error(`lottie data for "${assetId}" was not preloaded`);
        return data;
      },
      registerSeekable: (seekable) => seekables.push(seekable),
    });

    const totalFrames = Math.max(1, Math.round((scene.durationMs / 1000) * fps));
    const config: RenderConfig = {
      fps,
      width,
      height,
      durationMs: scene.durationMs,
      totalFrames,
    };
    window.renderConfig = config;

    window.seekToFrame = async (frame: number) => {
      const clamped = Math.min(totalFrames - 1, Math.max(0, Math.round(frame)));
      tl.pause();
      tl.seek(clamped / fps, false);
      await document.fonts.ready;
      const tSec = clamped / fps;
      await Promise.all(seekables.map((seek) => seek(tSec)));
      await nextPaint(); // let the compositor flush before capture
    };

    if (renderMode) {
      // headless render entry: settle on frame 0, then signal readiness
      await window.seekToFrame(0);
    } else {
      mountTimelineUI(tl, scene, fps);
      // live updates from the engine: refetch and rebuild the page
      const events = new EventSource(`/api/scenes/${encodeURIComponent(sceneId)}/events`);
      events.addEventListener("updated", () => window.location.reload());
      events.onerror = () => events.close(); // engine restarts must not spam the console
    }

    readyResolve();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    readyResolve();
  }
}

boot();
