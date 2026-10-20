import "./style.css";
import type { gsap } from "gsap";
import { resolveCanvasSize, sceneSpecSchema, type Canvas, type SceneSpec } from "@motionforge/scene-spec";
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
import { TransformPipeline, type TransformOverride } from "./transform.js";
import type { LayerBoundsReport, RenderConfig, Seekable } from "./types.js";

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
  /** the single owner of every layer's transform */
  pipeline: TransformPipeline;
  settle: FrameSettler;
  ui: TimelineUIHandle | null;
}

let stage: Stage | null = null;
let mounted: MountedScene | null = null;

/** Bounding box of every mounted layer, in design-space pixels. */
export type LayerBounds = Record<string, LayerBoundsReport>;

/**
 * The `ephemeralTransform` message the Studio sends for live manipulation.
 *
 * EVERY field except `layerId` is optional, and ONLY the supplied fields are
 * overridden. A message that carries no transform field at all CLEARS the
 * layer's live override.
 *
 * The message is a LIVE override: it applies until the scene is pushed back
 * (`motionforge:initScene` / `motionforge:updateScene`) or until a later
 * message for the same layer replaces the fields it carries.
 */
export interface EphemeralTransformMessage {
  layerId?: string;
  /** anchor x, in percent of the canvas */
  xPct?: number;
  /** anchor y, in percent of the canvas */
  yPct?: number;
  /** uniform scale multiplier */
  scale?: number;
  /** non-uniform scale on X (wins over `scale`) */
  scaleX?: number;
  /** non-uniform scale on Y (wins over `scale`) */
  scaleY?: number;
  /** rotation, in degrees */
  rotation?: number;
  /** opacity, 0..1 */
  opacity?: number;
  /** layout width, in percent of the canvas */
  widthPct?: number;
  /** layout height, in percent of the canvas */
  heightPct?: number;
  /** LEGACY layout width, in design pixels */
  widthPx?: number;
  /** LEGACY layout height, in design pixels */
  heightPx?: number;
}

/** Canvas used before any scene is known (zero-port boot without an id). */
const DEFAULT_CANVAS: Canvas = { shape: "16:9", scale: 1080 };

/**
 * Publish layer bounds to the host.
 *
 * Two event names are emitted for the same payload: `layerBounds` is the
 * legacy name, `layerBoundsReport` the one the Studio UI listens for. Sending
 * both keeps every listener working regardless of which name it expects.
 */
function postBoundsReport(bounds: LayerBounds, frame?: number): void {
  const payload = frame === undefined ? { bounds } : { frame, bounds };
  window.parent?.postMessage({ type: "layerBounds", ...payload }, "*");
  window.parent?.postMessage({ type: "layerBoundsReport", ...payload }, "*");
}

/**
 * one frame-index → one timeline-time mapping, independent of what was
 * captured before; the engine drives it exclusively
 */
function installSeekToFrame(): void {
  window.seekToFrame = async (frame: number): Promise<void> => {
    if (!mounted) return;
    await mounted.settle(clampFrame(frame, mounted.totalFrames) / mounted.fps);
  };
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

  // A zero-port host has no engine HTTP origin to subscribe to — it pushes
  // scene updates over postMessage instead (`motionforge:updateScene`).
  //
  // Reading a property off a cross-origin parent throws a SecurityError
  // ("Blocked a frame with origin … from accessing a cross-origin frame"), so
  // the probe is guarded: a Studio page may frame the runtime from an origin
  // of its own, and the runtime must not die on the way in.
  const isLocal = (() => {
    if (typeof window === "undefined") return false;
    if (window.location.protocol === "mf-runtime:" || window.location.protocol === "file:") {
      return true;
    }
    try {
      return Boolean((window.parent as unknown as { motionforgeEngine?: unknown })?.motionforgeEngine);
    } catch {
      // Cross-origin parent: no bridge to reach, but the host can still push
      // the scene over postMessage.
      return false;
    }
  })();

  if (sceneId) {
    let scene: SceneSpec | null = null;
    try {
      scene = await fetchScene(sceneId);
    } catch (error) {
      if (isLocal) {
        // A zero-port host owns the engine in-process: there is no HTTP
        // origin to fetch the scene from, and a cross-origin parent cannot be
        // reached over the bridge either. The host hands the scene down over
        // postMessage (`motionforge:initScene` / `motionforge:updateScene`),
        // so the scene is still on its way — this is not an error.
        console.warn(
          `[motionforge] scene "${sceneId}" is not reachable over HTTP — waiting for the host to push it`
        );
        // Announce readiness so a host that only pushes the scene once the
        // runtime is up answers with it.
        window.parent?.postMessage({ type: "motionforge:ready", fps, durationMs: 0 }, "*");
      } else {
        showError(
          `Could not load scene "${sceneId}": ${error instanceof Error ? error.message : String(error)}.`
        );
      }
    }

    if (scene) {
      const { width, height } = resolveCanvasSize(scene.canvas);
      stage = createStage(width, height);
      installSeekToFrame();

      try {
        await mountScene(scene, sceneId, fps, renderMode);
        readyResolve();
        // Notify parent window that runtime is mounted and ready for sync
        window.parent?.postMessage(
          { type: "motionforge:ready", fps, durationMs: scene.durationMs },
          "*"
        );
        postBoundsReport(computeLayerBounds(), 0);
      } catch (error) {
        showError(error instanceof Error ? error.message : String(error));
        readyResolve();
      }
    } else {
      readyResolve();
    }
  } else {
    // Monolithic zero-port execution: the host owns the engine in-process and
    // pushes the scene over postMessage (`motionforge:initScene`). Booting
    // without an id is a valid state — not an error — so the stage is prepared
    // and the host is told we are ready to receive a scene.
    if (!stage) {
      const { width, height } = resolveCanvasSize(DEFAULT_CANVAS);
      stage = createStage(width, height);
    }
    installSeekToFrame();
    readyResolve();
    window.parent?.postMessage({ type: "motionforge:ready", fps, durationMs: 0 }, "*");
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
      postBoundsReport(computeLayerBounds(), targetFrame);
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
      postBoundsReport(computeLayerBounds(), data.frame ?? 0);
    } else if (data.type === "ephemeralTransform" || data.type === "motionforge:ephemeralTransform") {
      applyEphemeralTransform(data as EphemeralTransformMessage);
    } else if (
      data.type === "motionforge:initScene" ||
      data.type === "motionforge:updateScene"
    ) {
      if (data.scene) {
        const nextScene = data.scene as SceneSpec;
        const nextId = nextScene.id || sceneId || "scene";
        if (!stage) {
          const { width, height } = resolveCanvasSize(nextScene.canvas);
          stage = createStage(width, height);
        }
        unmountScene();
        await mountScene(nextScene, nextId, fps, false);
        if (typeof data.atMs === "number" && window.seekToFrame) {
          const activeFps = window.renderConfig?.fps ?? fps;
          await window.seekToFrame(Math.round((data.atMs / 1000) * activeFps));
        }
        const bounds = computeLayerBounds();
        postBoundsReport(bounds);
      }
    }
  });
}

async function mountScene(
  rawScene: SceneSpec,
  sceneId: string,
  fps: number,
  renderMode: boolean
): Promise<void> {
  let scene: SceneSpec;
  try {
    scene = sceneSpecSchema.parse(rawScene);
  } catch {
    scene = rawScene;
  }
  if (!stage) throw new Error("stage not created");

  const { width, height } = resolveCanvasSize(scene.canvas);
  stage.setSize(width, height);

  const { lottieJson, imageSizes } = await preloadAssets(scene);
  const fonts = await loadSceneFonts(scene);
  // assetId → engine URL (the LLM references ids; the runtime needs srcs)
  const srcById = new Map((scene.assets ?? []).map((asset) => [asset.id, asset.src]));

  const seekables: Seekable[] = [];
  const { tl, lifecycle, describeFrame, pipeline } = buildScene(scene, stage, {
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
    pipeline,
    settle: async (timeSec: number) => {
      targetTimeSec = timeSec;
      await settle(timeSec);
    },
    ui: null,
  };
  // numeric per-frame description for `inspect_scene_keyframes`
  window.describeFrame = describeFrame;
  window.getLayerBounds = computeLayerBounds;

  // A web font changes the size of the text it renders, so every text layer's
  // box changes with it. The bounds report is re-published once the fonts are
  // in, or the Studio's gizmo would sit on the pre-font box forever.
  void document.fonts.ready
    .then(() => undefined)
    .then(() => {
      if (!mounted || mounted.sceneId !== sceneId) return;
      postBoundsReport(computeLayerBounds(), Math.round(mounted.tl.time() * fps));
    })
    .catch(() => undefined);

  if (renderMode) {
    // headless render entry: settle on frame 0, then signal readiness
    await mounted.settle(0);
  } else if (!isEmbedded()) {
    // The Studio's Program Monitor provides its own SMPTE transport, so the
    // runtime's scrubber is only mounted when the runtime is opened STANDALONE
    // (a browser tab). Inside the Studio it would be a second, conflicting
    // transport sitting on top of the composition.
    mounted.ui = mountTimelineUI(tl, scene, fps);
  }
}

/**
 * True when the runtime is embedded in a host application (the Studio).
 *
 * Detected from the URL (`?embedded=1`, which the Studio sets) and from the
 * frame heuristic (`window.self !== window.top`).
 */
function isEmbedded(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('embedded') === '1') return true;
  } catch {
    /* a malformed query string is not an embedding */
  }
  try {
    return window.self !== window.top;
  } catch {
    // a cross-origin parent throws on access — that IS an embedding
    return true;
  }
}

/**
 * Apply a live manipulation override from the Studio.
 *
 * THE ZERO-JUMP RULE: this path and the scene path use the SAME math
 * ({@link resolveTransform} + {@link applyLayerTransform}), so the values the
 * Studio previews are the values the renderer draws. When the Studio saves the
 * scene and pushes it back, the authored values ARE the dragged values — the
 * layer does not move by a pixel.
 *
 * The override is stored on the pipeline (not written straight onto the
 * element) so the master timeline cannot overwrite it on the next tick: a
 * direct style write was fought by the very next frame whenever the timeline
 * was playing.
 */
function applyEphemeralTransform(message: EphemeralTransformMessage): void {
  if (!mounted) return;
  const layerId = typeof message.layerId === "string" ? message.layerId : undefined;
  if (!layerId) return;

  const pipeline = mounted.pipeline;
  const layer = pipeline.layerFor(layerId);
  const element = pipeline.elementFor(layerId);
  if (!layer || !element) return;

  const override: TransformOverride = { ...(pipeline.overrideFor(layerId) ?? {}) };
  let touched = false;

  const take = <K extends keyof TransformOverride>(key: K, value: unknown): void => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    override[key] = value as TransformOverride[K];
    touched = true;
  };

  take("xPct", message.xPct);
  take("yPct", message.yPct);
  take("scale", message.scale);
  take("scaleX", message.scaleX);
  take("scaleY", message.scaleY);
  take("rotation", message.rotation);
  take("opacity", message.opacity);
  take("widthPct", message.widthPct);
  take("heightPct", message.heightPct);
  take("widthPx", message.widthPx);
  take("heightPx", message.heightPx);

  if (!touched) {
    // a message that carries no transform field CLEARS the override
    pipeline.setOverride(layerId, {});
    pipeline.applyAt(mounted.tl.time() * 1000);
    postBoundsReport(computeLayerBounds());
    return;
  }

  pipeline.setOverride(layerId, override);
  pipeline.applyAt(mounted.tl.time() * 1000);
  postBoundsReport(computeLayerBounds());
}

/**
 * The EXACT geometry of every mounted layer, in composition pixels.
 *
 * NOTHING IS MEASURED OFF THE SCREEN. The rotated screen rectangle is
 * useless to a consumer that wants to draw a gizmo: it is already rotated,
 * it is in screen pixels, and applying the rotation to it again produces the
 * double-rotation that made the selection box escape the stage.
 *
 * So the box is computed from the LAYOUT size (`offsetWidth` /
 * `offsetHeight`, which transforms do not affect) and the resolved transform:
 *
 *   centre = the anchor (the content is centred on it)
 *   size   = layout size × the visual scale
 *   box    = the centre minus half the size — UNROTATED
 *
 * The rotation travels alongside as a NUMBER, so the consumer applies it once.
 */
export function computeLayerBounds(): LayerBounds {
  if (!stage || !mounted) return {};
  const designW = stage.width || 1;
  const designH = stage.height || 1;
  const timeMs = mounted.tl.time() * 1000;

  const result: LayerBounds = {};
  const pipeline = mounted.pipeline;

  for (const layerId of pipeline.layerIds) {
    const element = pipeline.elementFor(layerId);
    if (!element) continue;
    const resolved = pipeline.resolveAt(layerId, timeMs);
    if (!resolved) continue;

    const layoutWidth = element.offsetWidth;
    const layoutHeight = element.offsetHeight;
    const width = layoutWidth * resolved.scaleX;
    const height = layoutHeight * resolved.scaleY;
    const cx = (resolved.xPct / 100) * designW;
    const cy = (resolved.yPct / 100) * designH;

    result[layerId] = {
      x: round1(cx - width / 2),
      y: round1(cy - height / 2),
      width: round1(width),
      height: round1(height),
      layoutWidth: round1(layoutWidth),
      layoutHeight: round1(layoutHeight),
      cx: round1(cx),
      cy: round1(cy),
      rotation: round1(resolved.rotation),
      scaleX: round1(resolved.scaleX),
      scaleY: round1(resolved.scaleY),
    };
  }

  return result;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
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
