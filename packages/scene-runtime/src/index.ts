import "./style.css";
import type { gsap } from "gsap";
import { resolveCanvasSize, type SceneSpec } from "@motionforge/scene-spec";
import { createStage, resetStage, type Stage } from "./stage.js";
import { loadSceneFonts } from "./fonts.js";
import { assetKindOf, fetchScene, preloadAssets, resolveAssetUrl } from "./api.js";
import { buildScene, type FrameDescription } from "./scene-builder.js";
import { mountTimelineUI, type TimelineUIHandle } from "./timeline-ui.js";
import {
  clampFrame,
  configureDeterministicGsap,
  createFrameSettler,
  decodeImages,
  flushLayout,
  IMAGE_LOAD_GRACE_MS,
  nextPaintFrame,
  type FrameSettler,
} from "./determinism.js";
import type { LayerLifecycle } from "./motion-slots.js";
import type { RenderConfig, Seekable } from "./types.js";

// Must run before any timeline exists: disables GSAP's clock compensation and
// forced 3D promotion (see determinism.ts for why each one matters).
configureDeterministicGsap();

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

interface MountedScene {
  sceneId: string;
  scene: SceneSpec;
  fps: number;
  totalFrames: number;
  tl: gsap.core.Timeline;
  lifecycle: LayerLifecycle;
  describeFrame: (timeMs: number) => FrameDescription;
  settle: FrameSettler;
  ui: TimelineUIHandle | null;
}

let stage: Stage | null = null;
let mounted: MountedScene | null = null;

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
  stage = createStage(width, height);

  // one frame-index → one timeline-time mapping, independent of what was
  // captured before; the engine drives it exclusively
  window.seekToFrame = async (frame: number): Promise<void> => {
    if (!mounted) return;
    await mounted.settle(clampFrame(frame, mounted.totalFrames) / mounted.fps);
  };

  try {
    await mountScene(scene, sceneId, fps, renderMode);
    readyResolve();
    // Notify parent window that runtime is mounted and ready for sync
    window.parent?.postMessage(
      { type: "motionforge:ready", fps, durationMs: scene.durationMs },
      "*"
    );
    const initialBounds = computeLayerBounds();
    window.parent?.postMessage(
      { type: "layerBounds", frame: 0, bounds: initialBounds },
      "*"
    );
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    readyResolve();
    return;
  }

  // Handle postMessage communication from MotionForge Studio UI
  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "motionforge:seek" && typeof data.atMs === "number") {
      const activeFps = window.renderConfig?.fps ?? fps;
      const targetFrame = Math.round((data.atMs / 1000) * activeFps);
      if (window.seekToFrame) {
        await window.seekToFrame(targetFrame);
      }
      const bounds = computeLayerBounds();
      window.parent?.postMessage(
        { type: "layerBounds", frame: targetFrame, bounds },
        "*"
      );
    } else if (data.type === "motionforge:play") {
      if (mounted) {
        mounted.tl.play();
      }
    } else if (data.type === "motionforge:pause") {
      if (mounted) {
        mounted.tl.pause();
      }
    } else if (data.type === "getLayerBounds" || data.type === "motionforge:getLayerBounds") {
      if (typeof data.frame === "number" && window.seekToFrame) {
        await window.seekToFrame(data.frame);
      }
      const bounds = computeLayerBounds();
      window.parent?.postMessage(
        {
          type: "layerBounds",
          frame: data.frame ?? 0,
          bounds,
        },
        "*"
      );
    } else if (data.type === "ephemeralTransform" || data.type === "motionforge:ephemeralTransform") {
      const { layerId, xPct, yPct, rotation, widthPx, heightPx } = data;
      const layerEl = stage?.content.querySelector<HTMLElement>(`.mf-layer[data-layer-id="${layerId}"]`);
      if (layerEl) {
        const exitWrapper = layerEl.querySelector<HTMLElement>(".mf-exit");
        const contentEl = (exitWrapper?.firstElementChild ?? exitWrapper ?? layerEl) as HTMLElement;
        if (typeof xPct === "number") contentEl.style.left = `${xPct}%`;
        if (typeof yPct === "number") contentEl.style.top = `${yPct}%`;
        if (typeof widthPx === "number") contentEl.style.width = `${widthPx}px`;
        if (typeof heightPx === "number") contentEl.style.height = `${heightPx}px`;
        if (typeof rotation === "number") {
          contentEl.style.transform = `translate(-50%, -50%)${rotation ? ` rotate(${rotation}deg)` : ""}`;
        }
        const bounds = computeLayerBounds();
        window.parent?.postMessage({ type: "layerBounds", bounds }, "*");
      }
    }
  });

  if (!renderMode) {
    // Live preview: rebuild in place when the engine pushes an update. A full
    // page reload would drop the scrubber position and flash a blank stage;
    // more importantly, a rebuild MUST start from a clean stage or the previous
    // scene's DOM and inline camera styles bleed into the new one.
    const events = new EventSource(`/api/scenes/${encodeURIComponent(sceneId)}/events`);
    let pending: Promise<void> = Promise.resolve();
    events.addEventListener("updated", () => {
      pending = pending.then(() => void rebuild(sceneId, fps)).catch(() => undefined);
    });
    events.onerror = () => events.close(); // engine restarts must not spam the console
  }
}

async function mountScene(
  scene: SceneSpec,
  sceneId: string,
  fps: number,
  renderMode: boolean
): Promise<void> {
  if (!stage) throw new Error("stage not created");

  const { width, height } = resolveCanvasSize(scene.canvas);
  stage.setSize(width, height);

  const { lottieJson, imageSizes } = await preloadAssets(scene);
  const fonts = await loadSceneFonts(scene);
  // assetId → engine URL (the LLM references ids; the runtime needs srcs)
  const srcById = new Map(scene.assets.map((asset) => [asset.id, asset.src]));

  const seekables: Seekable[] = [];
  const { tl, lifecycle, describeFrame } = buildScene(scene, stage, {
    fonts,
    resolveAsset: (assetId) => {
      const src = srcById.get(assetId);
      if (src === undefined) throw new Error(`asset "${assetId}" is not declared in scene.assets`);
      return resolveAssetUrl(src);
    },
    assetKind: assetKindOf(scene),
    lottieData: (assetId) => {
      const data = lottieJson.get(assetId);
      if (!data) throw new Error(`lottie data for "${assetId}" was not preloaded`);
      return data;
    },
    registerSeekable: (seekable) => seekables.push(seekable),
    assetIntrinsicSize: (assetId) => imageSizes.get(assetId),
  });
  // `focusTarget` camera moves measure element boxes, so the rig must be laid
  // out before the first keyframe tween is evaluated
  flushLayout(stage.stage);

  const totalFrames = Math.max(1, Math.round((scene.durationMs / 1000) * fps));
  const config: RenderConfig = {
    fps,
    width,
    height,
    durationMs: scene.durationMs,
    totalFrames,
  };
  window.renderConfig = config;

  let targetTimeSec = 0;
  const settle: FrameSettler = createFrameSettler({
    seekTimeline: () => {
      // suppressEvents = false → onUpdate callbacks (counters, progress bars,
      // Lottie scrubbing) run on every seek, including non-linear jumps
      tl.seek(targetTimeSec, false);
    },
    applyLifecycle: (timeSec) => lifecycle.apply(timeSec * 1000),
    runSeekables: async (timeSec) => {
      for (const seek of seekables) await seek(timeSec);
    },
    fontsReady: () => document.fonts.ready.then(() => undefined),
    decodeImages: () => decodeImages(stage!.content),
    imageLoadGraceMs: IMAGE_LOAD_GRACE_MS,
    flushLayout: () => flushLayout(stage!.stage),
    nextFrame: nextPaintFrame,
  });

  mounted = {
    sceneId,
    scene,
    fps,
    totalFrames,
    tl,
    lifecycle,
    describeFrame,
    settle: async (timeSec: number) => {
      targetTimeSec = timeSec;
      await settle(timeSec);
    },
    ui: null,
  };
  // numeric per-frame description for `inspect_scene_keyframes`
  window.describeFrame = describeFrame;
  window.getLayerBounds = computeLayerBounds;

  if (renderMode) {
    // headless render entry: settle on frame 0, then signal readiness
    await mounted.settle(0);
  } else {
    mounted.ui = mountTimelineUI(tl, scene, fps);
  }
}

export function computeLayerBounds(): Record<
  string,
  { x: number; y: number; width: number; height: number; rotation: number }
> {
  if (!stage || !mounted) return {};
  const stageBox = stage.stage.getBoundingClientRect();
  const designW = stage.width || 1;
  const scale = stageBox.width / designW || 1;

  const result: Record<
    string,
    { x: number; y: number; width: number; height: number; rotation: number }
  > = {};
  const sceneLayers = new Map(mounted.scene.layers.map((l) => [l.id, l]));

  const layerElements = stage.content.querySelectorAll<HTMLElement>(".mf-layer[data-layer-id]");
  for (const layerEl of Array.from(layerElements)) {
    const id = layerEl.dataset.layerId;
    if (!id) continue;
    const layer = sceneLayers.get(id);
    const rotation =
      layer && "rotation" in layer && typeof layer.rotation === "number"
        ? layer.rotation
        : 0;

    const exitWrapper = layerEl.querySelector<HTMLElement>(".mf-exit");
    const content =
      (exitWrapper?.firstElementChild as HTMLElement | null) ?? exitWrapper ?? layerEl;

    const rect = content.getBoundingClientRect();
    result[id] = {
      x: Math.round(((rect.left - stageBox.left) / scale) * 10) / 10,
      y: Math.round(((rect.top - stageBox.top) / scale) * 10) / 10,
      width: Math.round((rect.width / scale) * 10) / 10,
      height: Math.round((rect.height / scale) * 10) / 10,
      rotation,
    };
  }

  return result;
}

function unmountScene(): void {
  if (!mounted || !stage) return;
  mounted.ui?.dispose();
  mounted.tl.kill();
  mounted.lifecycle.clear();
  window.describeFrame = undefined;
  window.getLayerBounds = undefined;
  resetStage(stage);
  mounted = null;
}

async function rebuild(sceneId: string, fps: number): Promise<void> {
  try {
    const next = await fetchScene(sceneId);
    const previousFrame = mounted ? mounted.tl.time() : 0;
    unmountScene();
    await mountScene(next, sceneId, fps, false);
    // keep the operator where they were instead of jumping back to frame 0
    if (mounted) await mounted.settle(previousFrame);
  } catch (error) {
    showError(`Could not apply scene update: ${error instanceof Error ? error.message : String(error)}`);
  }
}

void boot();
