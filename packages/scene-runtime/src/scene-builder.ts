import { gsap } from "gsap";
import type { AssetKind, FontRole, SceneSpec } from "@motionforge/scene-spec";
import type { Stage } from "./stage.js";
import {
  applyCamera,
  applyViewportClamp,
  cameraStateFromRig,
  type LayerAnchor,
  type ResolvedCameraState,
} from "./camera.js";
import { autoExitWindow, needsAutoExit, AUTO_EXIT_FADE_MS } from "./envelope.js";
import { PRESET_DEFAULTS, applyEmphasis, applyEntrance, applyExit, type PresetTarget } from "./presets.js";
import { renderLayer, type BuiltLayer } from "./layers/index.js";
import type { LayerContext } from "./layers/context.js";
import {
  createMotionWrappers,
  LayerLifecycle,
  planMotionSlots,
  type MotionSlotPlan,
  type SceneLayer,
} from "./motion-slots.js";
import {
  activeTransitionsAt,
  applyTransitions,
  type ActiveTransition,
  type TransitionOverlay,
} from "./transitions.js";
import type { Seekable } from "./types.js";

export interface SceneBuildOptions {
  fonts: Map<FontRole, string>;
  resolveAsset: (assetId: string) => string;
  assetKind: (assetId: string) => AssetKind | undefined;
  lottieData: (assetId: string) => unknown;
  registerSeekable: (seekable: Seekable) => void;
  /** natural pixel size of an image asset, when known */
  assetIntrinsicSize: (assetId: string) => { width: number; height: number } | undefined;
}

export interface BuiltScene {
  tl: gsap.core.Timeline;
  layerFocus: Map<string, HTMLElement>;
  lifecycle: LayerLifecycle;
  overlays: TransitionOverlay[];
  describeFrame: FrameDescriber;
}

// ---------------------------------------------------------------------------
// Frame description (feeds `inspect_scene_keyframes` framesMeta)
// ---------------------------------------------------------------------------

export type LifecyclePhase = "entrance" | "settled" | "emphasis" | "exit";

export interface LayerFrameInfo {
  id: string;
  type: string;
  lifecyclePhase: LifecyclePhase;
  phaseProgressPct: number;
  opacity: number;
  bbox: { x: number; y: number; width: number; height: number };
  textOverflow: boolean;
}

export interface FrameDescription {
  atMs: number;
  camera: ReturnType<typeof cameraStateFromRig>;
  activeTransitions: ActiveTransition[];
  layers: LayerFrameInfo[];
}

export type FrameDescriber = (timeMs: number) => FrameDescription;

/** The motion phase a layer is in at `timeMs`, and how far through it is. */
export function lifecyclePhaseAt(
  plan: MotionSlotPlan,
  timeMs: number
): { phase: LifecyclePhase; progressPct: number } {
  const within = (start: number, end: number): number =>
    end <= start ? 0 : Math.min(100, Math.max(0, ((timeMs - start) / (end - start)) * 100));
  if (plan.entrance && timeMs >= plan.entrance.startMs && timeMs < plan.entrance.endMs) {
    return { phase: "entrance", progressPct: within(plan.entrance.startMs, plan.entrance.endMs) };
  }
  if (plan.exit && timeMs >= plan.exit.startMs && timeMs < plan.exit.endMs) {
    return { phase: "exit", progressPct: within(plan.exit.startMs, plan.exit.endMs) };
  }
  if (plan.emphasis && timeMs >= plan.emphasis.startMs && timeMs < plan.emphasis.endMs) {
    return { phase: "emphasis", progressPct: within(plan.emphasis.startMs, plan.emphasis.endMs) };
  }
  return { phase: "settled", progressPct: 0 };
}

/** Sub-pixel tolerance before a scroll/size mismatch counts as overflow. */
export const TEXT_OVERFLOW_TOLERANCE_PX = 2;

export function isTextOverflow(el: HTMLElement, tolerance = TEXT_OVERFLOW_TOLERANCE_PX): boolean {
  return el.scrollWidth > el.clientWidth + tolerance || el.scrollHeight > el.clientHeight + tolerance;
}

// ---------------------------------------------------------------------------
// buildScene
// ---------------------------------------------------------------------------

/**
 * Builds the full DOM scene graph and one deterministic GSAP master timeline
 * (paused). The whole scene is seekable frame-by-frame; nothing runs on wall
 * clock. Each layer gets a nested entrance/emphasis/exit wrapper chain so the
 * three motion phases never write to the same element
 * (see `motion-slots.ts` for why that matters).
 */
export function buildScene(scene: SceneSpec, stage: Stage, opts: SceneBuildOptions): BuiltScene {
  const tl = gsap.timeline({ paused: true });
  // pad the timeline to the exact scene duration so scrubbing/clamping is stable
  tl.to({}, { duration: scene.durationMs / 1000 }, 0);

  const layerFocus = new Map<string, HTMLElement>();
  const lifecycle = new LayerLifecycle();
  const descriptors: LayerDescriptor[] = [];

  const sorted = scene.layers
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => (a.layer.z ?? 0) - (b.layer.z ?? 0) || a.index - b.index);

  sorted.forEach(({ layer, index }) => {
    const layerRoot = document.createElement("div");
    layerRoot.className = "mf-layer";
    layerRoot.dataset.layerId = layer.id;
    const baseZ = 10 + index * 10;
    layerRoot.style.zIndex = `${layer.type === "foregroundFX" ? baseZ + 400 : baseZ}`;
    stage.content.appendChild(layerRoot);

    const wrappers = createMotionWrappers(layerRoot);

    const ctx: LayerContext = {
      tl,
      scene,
      content: wrappers.content,
      stageContent: stage.content,
      rig: stage.rig,
      width: stage.width,
      height: stage.height,
      layerAtSec: layer.at / 1000,
      fonts: opts.fonts,
      resolveAsset: opts.resolveAsset,
      assetKind: opts.assetKind,
      lottieData: opts.lottieData,
      registerSeekable: opts.registerSeekable,
      assetIntrinsicSize: opts.assetIntrinsicSize,
    };

    const built = renderLayer(layer, ctx);
    const plan = applyLayerTiming(tl, scene, layer, built, wrappers, stage.rig, layerFocus, lifecycle);
    descriptors.push({ layer, built, wrappers, plan });
  });

  // The authored anchor of every layer: the canvas point its content is
  // centred on. `focusTarget` uses this instead of measuring the element,
  // because a measurement taken while the layer's entrance tween is still at
  // its "from" pose reports the WRONG position (a `springPop` at scale 0.4
  // moves its content a third of the way to the canvas centre).
  const layerAnchors = new Map<string, LayerAnchor>();
  for (const layer of scene.layers) {
    // `background` and `foregroundFX` are full-bleed and have no position
    const position = "position" in layer ? layer.position : undefined;
    if (position) {
      layerAnchors.set(layer.id, { xPct: position.xPct, yPct: position.yPct });
    }
  }

  const cameraInfo = applyCamera(tl, scene, stage.rig, layerAnchors);
  const overlays = applyTransitions(tl, scene, stage.rig);
  // The viewport clamp runs on the timeline's own `onUpdate`, so it observes
  // the pose that is actually rendered: keyframes + moves + drift + transitions.
  applyViewportClamp(tl, stage.rig, scene, cameraInfo);

  lifecycle.applyInitial();

  window.masterTimeline = tl;
  return { tl, layerFocus, lifecycle, overlays, describeFrame: makeFrameDescriber(scene, stage, overlays, descriptors) };
}

interface LayerDescriptor {
  layer: SceneLayer;
  built: BuiltLayer;
  wrappers: ReturnType<typeof createMotionWrappers>;
  plan: MotionSlotPlan;
}

function applyLayerTiming(
  tl: gsap.core.Timeline,
  scene: SceneSpec,
  layer: SceneLayer,
  built: BuiltLayer,
  wrappers: ReturnType<typeof createMotionWrappers>,
  rig: HTMLElement,
  layerFocus: Map<string, HTMLElement>,
  lifecycle: LayerLifecycle
): MotionSlotPlan {
  const plan = planMotionSlots(layer, scene.durationMs);
  const staggerMs =
    layer.entrance?.staggerMs ??
    (layer.type === "kineticText" ? (layer.animateBy === "char" ? 30 : 80) : 60);
  const direction = layer.type === "kineticText" ? layer.direction : undefined;

  lifecycle.register({
    id: layer.id,
    root: wrappers.root,
    startMs: plan.visibleStartMs,
    endMs: plan.visibleEndMs,
  });

  const slotTarget = (
    el: HTMLElement,
    window: { startMs: number; endMs: number }
  ): PresetTarget => ({
    el,
    // overlays (lightSweep) belong to the painted content, not the wrapper,
    // so the sweep keeps hugging the element's own box
    sweepHost: built.content,
    units: built.units,
    unitStaggerMs: staggerMs,
    startMs: window.startMs,
    endMs: window.endMs,
    rig,
    direction,
  });

  if (plan.entrance && layer.entrance) {
    applyEntrance(tl, layer.entrance, slotTarget(wrappers.entrance, plan.entrance));
  } else {
    gsap.set(wrappers.entrance, { autoAlpha: 1 });
  }

  if (plan.emphasis && layer.emphasis) {
    applyEmphasis(tl, layer.emphasis, slotTarget(wrappers.emphasis, plan.emphasis));
  }

  if (plan.exit && layer.exit) {
    applyExit(tl, layer.exit, slotTarget(wrappers.exit, plan.exit));
  } else if (needsAutoExit(layer, scene.durationMs)) {
    // Graceful layer auto-exit guard: a bounded layer that declares no exit
    // used to be force-hidden by the lifecycle registry at its end time, which
    // is a one-frame pop. Fade it out over the tail of its own window instead.
    const { startMs, endMs } = autoExitWindow(layer, scene.durationMs);
    if (endMs > startMs) {
      tl.fromTo(
        wrappers.exit,
        { autoAlpha: 1 },
        { autoAlpha: 0, duration: (endMs - startMs) / 1000, ease: "power2.in" },
        startMs / 1000
      );
    }
  }

  // camera `focusTarget` centers on the painted content, not the full-bleed wrapper
  layerFocus.set(layer.id, built.content);
  return plan;
}

// ---------------------------------------------------------------------------
// frame description
// ---------------------------------------------------------------------------

function makeFrameDescriber(
  scene: SceneSpec,
  stage: Stage,
  overlays: TransitionOverlay[],
  descriptors: readonly LayerDescriptor[]
): FrameDescriber {
  return (timeMs: number): FrameDescription => {
    const layers: LayerFrameInfo[] = [];
    for (const { layer, built, wrappers, plan } of descriptors) {
      const visible = timeMs >= plan.visibleStartMs && timeMs < plan.visibleEndMs;
      const { phase, progressPct } = lifecyclePhaseAt(plan, timeMs);
      const opacity = visible
        ? alphaOf(wrappers.root) * alphaOf(wrappers.entrance) * alphaOf(wrappers.emphasis) * alphaOf(wrappers.exit)
        : 0;
      const painted = built.content.firstElementChild as HTMLElement | null;
      const box = paintedBox(painted ?? wrappers.exit);
      layers.push({
        id: layer.id,
        type: layer.type,
        lifecyclePhase: phase,
        phaseProgressPct: Math.round(progressPct * 10) / 10,
        opacity: Math.round(opacity * 1000) / 1000,
        bbox: {
          x: Math.round(box.x * 10) / 10,
          y: Math.round(box.y * 10) / 10,
          width: Math.round(box.width * 10) / 10,
          height: Math.round(box.height * 10) / 10,
        },
        textOverflow: anyTextOverflow(wrappers.exit),
      });
    }
    return {
      atMs: timeMs,
      camera: cameraStateFromRig(stage.rig),
      activeTransitions: activeTransitionsAt(overlays, timeMs),
      layers,
    };
  };
}

function alphaOf(el: HTMLElement): number {
  const style = window.getComputedStyle(el);
  const opacity = Number.parseFloat(style.opacity);
  return Number.isFinite(opacity) ? opacity : 1;
}

/**
 * The painted bounding box of a layer.
 *
 * A layer's content host is often a zero-size positioning box (e.g. an
 * `imageLogo` host is `position:absolute` with only `left/top` set, and its
 * visible child is absolutely positioned inside it). Reporting the host's box
 * would then be `250x0` — a number that tells an agent nothing. The union of
 * the painted descendants is the box that actually matters.
 */
function paintedBox(root: HTMLElement): DOMRect {
  const own = root.getBoundingClientRect();
  if (own.width > 0 && own.height > 0) return own;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const child of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    const rect = child.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  if (!Number.isFinite(left)) return own;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    top,
    bottom,
    left,
    right,
    toJSON: () => ({}),
  } as DOMRect;
}

function anyTextOverflow(root: HTMLElement): boolean {
  if (root.scrollWidth > root.clientWidth + TEXT_OVERFLOW_TOLERANCE_PX) return true;
  for (const child of Array.from(root.querySelectorAll<HTMLElement>(".mf-unit, [data-mf-text]"))) {
    if (isTextOverflow(child)) return true;
  }
  return false;
}

/** Layers whose own window closes early, i.e. the ones the auto-exit guard touches. */
export function autoExitedLayerIds(scene: SceneSpec): string[] {
  return scene.layers.filter((layer) => needsAutoExit(layer, scene.durationMs)).map((layer) => layer.id);
}

export { AUTO_EXIT_FADE_MS };
export type { ResolvedCameraState };
export { PRESET_DEFAULTS };