import { gsap } from "gsap";
import {
  bridgedWindow,
  foregroundDeadGaps,
  isForegroundContent,
  LEGACY_PROPERTY_MAP,
  MAX_DEAD_GAP_MS,
  planSeamBridges,
  type ActWindow,
  type DeadGap,
} from "@motionforge/scene-spec";
import type {
  AssetKind,
  FontRole,
  KeyframeProperty,
  SceneSpec,
  KeyframeTrack,
} from "@motionforge/scene-spec";
import type { Stage } from "./stage.js";
import {
  applyCamera,
  cameraStateFromRig,
  emptyCameraContext,
  type CameraContext,
  type LayerAnchor,
  type ResolvedCameraState,
  type RigShake,
} from "./camera.js";
import { needsAutoExit, AUTO_EXIT_FADE_MS } from "./envelope.js";
import { PRESET_DEFAULTS, applyEmphasis, applyEntrance, applyExit, type PresetTarget } from "./presets.js";
import { renderLayer, type BuiltLayer } from "./layers/index.js";
import type { LayerContext } from "./layers/context.js";
import {
  applyLayerStatics,
  createMotionWrappers,
  LayerLifecycle,
  planMotionSlots,
  type MotionSlotPlan,
  type PlannedWindow,
  type SceneLayer,
} from "./motion-slots.js";
import {
  activeTransitionsAt,
  applyTransitions,
  type ActiveTransition,
  type TransitionOverlay,
} from "./transitions.js";
import {
  GSAP_EASES,
  keyframeSamplesFor,
  TransformPipeline,
} from "./transform.js";
import type { Seekable } from "./types.js";

export interface SceneBuildOptions {
  fonts: Map<FontRole, string>;
  resolveAsset: (assetId: string) => string;
  assetKind: (assetId: string) => AssetKind | undefined;
  lottieData: (assetId: string) => unknown;
  registerSeekable: (seekable: Seekable) => void;
  /** natural pixel size of an image asset, when known */
  assetIntrinsicSize: (assetId: string) => { width: number; height: number } | undefined;
  /**
   * Leave the film grain out of the DOM — the encoder applies it instead.
   *
   * See `RenderConfig.offloadFilmGrainToEncoder` for why the export path asks
   * for this. Defaults to false: the interactive preview paints the grain.
   */
  offloadFilmGrainToEncoder?: boolean;
}

export interface BuiltScene {
  tl: gsap.core.Timeline;
  layerFocus: Map<string, HTMLElement>;
  lifecycle: LayerLifecycle;
  overlays: TransitionOverlay[];
  describeFrame: FrameDescriber;
  /** seam bridges applied at build time, for `framesMeta` / diagnostics */
  coverage: CoverageReport;
  /**
   * The unified 2D transform pipeline.
   *
   * It owns the element every layer's transform is written on, and it holds
   * the live overrides the Studio's direct manipulation produces.
   */
  pipeline: TransformPipeline;
  /** Motion plans for every layer, keyed by layer id. Used for static-frame detection. */
  plans: Map<string, MotionSlotPlan>;
}

/**
 * What the frame actually has on it, and when.
 *
 * `deadGaps` is the rule the brief calls for, made observable: a production
 * cut may hide the stage only for its own peak cover, never for a run of
 * screen time with nothing on it. The list is empty for a healthy scene.
 */
export interface CoverageReport {
  windows: Record<string, ActWindow>;
  /** interior runs with no foreground content, longer than the permitted gap */
  deadGaps: DeadGap[];
  /** true when no gap exceeds {@link MAX_DEAD_GAP_MS} */
  ok: boolean;
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
  /** visible foreground content on this frame; empty ⇒ the stage is bare */
  foreground: string[];
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
  const pipeline = new TransformPipeline();

  /**
   * SEAM BRIDGING — decided before a single tween exists.
   *
   * Layer windows are authored independently of the transitions that cut
   * between them, so an act can legally finish 500 ms before the next one
   * begins: the frame is empty for that whole run, and nothing warns about it.
   * Pinning each bounded layer to the seam it belongs to — held to the midpoint
   * on the way out, started at the midpoint on the way in — is what keeps the
   * stage populated on both sides of every cut.
   */
  const bridges = new Map(planSeamBridges(scene).map((b) => [b.layerId, b]));
  const windows: Record<string, ActWindow> = {};
  for (const layer of scene.layers) {
    windows[layer.id] = bridgedWindow(scene, layer, bridges.get(layer.id));
  }
  const deadGaps = foregroundDeadGaps(scene).filter((g) => g.durationMs > MAX_DEAD_GAP_MS);

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

    // The layer's authored, non-animated properties (opacity, scale, blend
    // mode, visibility) live on their own wrapper, OUTSIDE the motion chain,
    // so a preset that fades the layer in still ends at the authored opacity.
    applyLayerStatics(wrappers.static, layer);

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
      offloadFilmGrainToEncoder: opts.offloadFilmGrainToEncoder === true,
    };

    const built = renderLayer(layer, ctx);
    // The pipeline owns this element's transform from here on: no renderer and
    // no message handler may write a competing value on it.
    pipeline.register(layer, built.content);
    const bridge = bridges.get(layer.id);
    const planned: PlannedWindow = {
      startMs: windows[layer.id]!.startMs,
      endMs: windows[layer.id]!.endMs,
      // an outgoing act that is being HELD is removed by the transition's own
      // cover, so its exit (authored or auto) must not run as well
      suppressExit: bridge?.mode === "holdOutgoing",
    };
    const plan = applyLayerTiming(
      tl,
      scene,
      layer,
      built,
      wrappers,
      stage.rig,
      layerFocus,
      lifecycle,
      planned,
      pipeline
    );
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

  // `cameraShakeImpact` is a camera move expressed as a layer emphasis, so its
  // absolute window is resolved here and handed to the camera composition.
  // The rig has exactly one writer (the composition), so an emphasis can no
  // longer tween the rig behind its back.
  const shakes: RigShake[] = [];
  for (const { layer, plan } of descriptors) {
    if (layer.emphasis?.name !== "cameraShakeImpact" || !plan.emphasis) continue;
    shakes.push({
      atSec: plan.emphasis.startMs / 1000,
      windowSec: (plan.emphasis.endMs - plan.emphasis.startMs) / 1000,
      strength: layer.emphasis.strength ?? 1,
    });
  }

  const cameraCtx: CameraContext = { ...emptyCameraContext(), layerAnchors, shakes, widthPx: stage.width, heightPx: stage.height };
  // The transform pipeline is installed BEFORE the camera, so the camera's
  // composed `onUpdate` (which must be the LAST thing applied in a frame)
  // chains ON TOP of it instead of replacing it.
  pipeline.install(tl);
  applyCamera(tl, scene, stage.rig, cameraCtx);
  const overlays = applyTransitions(tl, scene, stage.rig);

  lifecycle.applyInitial();

  // Collect motion plans for static-frame signature
  const plans = new Map<string, MotionSlotPlan>();
  for (const { layer, plan } of descriptors) {
    plans.set(layer.id, plan);
  }

  window.masterTimeline = tl;
  return {
    tl,
    layerFocus,
    lifecycle,
    overlays,
    coverage: { windows, deadGaps, ok: deadGaps.length === 0 },
    describeFrame: makeFrameDescriber(scene, stage, overlays, descriptors),
    pipeline,
    plans,
  };
}

interface LayerDescriptor {
  layer: SceneLayer;
  built: BuiltLayer;
  wrappers: ReturnType<typeof createMotionWrappers>;
  plan: MotionSlotPlan;
}

/**
 * The legacy properties the unified transform pipeline owns.
 *
 * A legacy track that keyframes one of these is NOT applied here: the
 * pipeline resolves those properties from the scene on every frame, so a
 * second writer would fight it (and the two would disagree about the pose
 * whenever the seek order changed).
 */
export const PIPELINE_OWNED_PROPERTIES: readonly string[] = [
  "opacity",
  "scale",
  "rotation",
  "position.xPct",
  "position.yPct",
];

/**
 * The unified property names the pipeline owns.
 *
 * The legacy `tracks` array accepts ANY property string, and the two
 * spellings of a transform property coexist in the wild: the dotted legacy
 * form (`position.yPct`) and the flat unified form (`yPct`). They name the
 * SAME value, so the pipeline must own BOTH.
 */
const PIPELINE_OWNED_UNIFIED: ReadonlySet<string> = new Set([
  "opacity",
  "scale",
  "rotation",
  "xPct",
  "yPct",
]);

/**
 * True when the unified transform pipeline owns this property.
 *
 * WHY THIS EXISTS: a legacy track that says `yPct` (instead of
 * `position.yPct`) used to fall through to the element-tween path, which
 * called `gsap.set(el, { yPct: 40 })`. GSAP has no CSS plugin for `yPct` —
 * it is a Pixi property — so the write was REJECTED ("Invalid property yPct
 * set to 40 Missing plugin? gsap.registerPlugin()") and the value was
 * silently dropped, while the pipeline was simultaneously animating the very
 * same property. Two writers, one of them broken.
 */
export function isPipelineOwnedProperty(property: string): boolean {
  if (PIPELINE_OWNED_UNIFIED.has(property)) return true;
  const unified = LEGACY_PROPERTY_MAP[property];
  return unified !== undefined && PIPELINE_OWNED_UNIFIED.has(unified);
}

/**
 * Apply the legacy `tracks` of a layer — for the properties the unified
 * transform pipeline does NOT own.
 *
 * `widthPx` / `heightPx` (and any custom property) still travel the old
 * route: they are layout writes, not transform writes.
 */
export function applyKeyframeTracks(
  tl: gsap.core.Timeline,
  tracks: KeyframeTrack[],
  target: HTMLElement
): void {
  for (const track of tracks) {
    if (!track.keyframes || track.keyframes.length === 0) continue;
    if (isPipelineOwnedProperty(track.property)) continue;
    const sorted = [...track.keyframes].sort((a, b) => a.at - b.at);
    const prop = track.property;

    const mapProp = (val: number | string) => {
      switch (prop) {
        case "widthPx":
          return { width: `${val}px` };
        case "heightPx":
          return { height: `${val}px` };
        default:
          return { [prop]: val };
      }
    };

    const first = sorted[0];
    if (!first) return;
    gsap.set(target, mapProp(first.value));

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (!prev || !curr) continue;
      const durationSec = Math.max(0.001, (curr.at - prev.at) / 1000);
      const startSec = prev.at / 1000;
      const ease = curr.ease || "power2.inOut";

      tl.to(
        target,
        {
          ...mapProp(curr.value),
          duration: durationSec,
          ease,
        },
        startSec
      );
    }
  }
}

/**
 * Put a layer's keyframes ON the master timeline.
 *
 * THE RUNTIME IS A SEEKED TIMELINE. A keyframe that lives in a
 * `requestAnimationFrame` loop renders a different frame on every machine; a
 * keyframe that lives on the GSAP master timeline is seeked, captured and
 * reproduced exactly.
 *
 * The tween target is a PLAIN OBJECT — never the element. GSAP would write a
 * `transform` on the element and fight the pipeline for it; on a plain proxy
 * it can only write numbers.
 *
 * The rendered VALUE never comes from the proxy: it comes from
 * `resolveTransform(layer, t)`, which is the same pure function the Studio
 * uses. The proxy exists so the keyframes are part of the timeline's own
 * structure (and so the timeline reports them), not to be a second source of
 * truth for the pose.
 */
export function applyLayerKeyframes(
  tl: gsap.core.Timeline,
  layer: SceneLayer,
  pipeline: TransformPipeline,
  sceneDurationMs: number
): void {
  const properties: readonly KeyframeProperty[] = ["xPct", "yPct", "scale", "rotation", "opacity"];
  const proxy: Record<string, number> = {
    xPct: 0,
    yPct: 0,
    scale: 1,
    rotation: 0,
    opacity: 1,
    __t: 0,
  };

  let animated = false;
  for (const property of properties) {
    const samples = keyframeSamplesFor(layer, property);
    if (samples.length === 0) continue;
    const first = samples[0]!;
    // the value BEFORE the first keyframe IS the first keyframe's value
    proxy[property] = first.value;
    for (let i = 1; i < samples.length; i++) {
      const left = samples[i - 1]!;
      const right = samples[i]!;
      animated = true;
      tl.to(
        proxy,
        {
          [property]: right.value,
          duration: Math.max(0.001, (right.timeMs - left.timeMs) / 1000),
          ease: GSAP_EASES[left.easing],
          onUpdate: () => {
            proxy.__t = tl.time() * 1000;
            pipeline.applyAt(proxy.__t);
          },
        } as gsap.TweenVars,
        left.timeMs / 1000
      );
    }
  }

  if (!animated) return;

  // A driver that spans the WHOLE scene.
  //
  // The per-segment tweens only render inside their own window, so the
  // transform would be stale before the first keyframe and after the last one.
  // The driver keeps the pipeline in step with the timeline at EVERY instant.
  tl.to(
    proxy,
    {
      __t: 1,
      duration: Math.max(0.001, sceneDurationMs / 1000),
      ease: "none",
      onUpdate: () => {
        proxy.__t = tl.time() * 1000;
        pipeline.applyAt(proxy.__t);
      },
    } as gsap.TweenVars,
    0
  );
}

function applyLayerTiming(
  tl: gsap.core.Timeline,
  scene: SceneSpec,
  layer: SceneLayer,
  built: BuiltLayer,
  wrappers: ReturnType<typeof createMotionWrappers>,
  rig: HTMLElement,
  layerFocus: Map<string, HTMLElement>,
  lifecycle: LayerLifecycle,
  planned: PlannedWindow,
  pipeline: TransformPipeline
): MotionSlotPlan {
  const plan = planMotionSlots(layer, scene.durationMs, planned);
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
    lines: built.lines,
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
  } else if (plan.exitSuppressedBySeam) {
    // A transition seam is covering this cut and will remove the layer itself.
    // Running an exit here as well would empty the stage BEFORE the cover
    // arrives — the exact "everything leaves, then a blank frame" defect.
  } else if (needsAutoExit(layer, scene.durationMs)) {
    // Graceful layer auto-exit guard: a bounded layer that declares no exit
    // used to be force-hidden by the lifecycle registry at its end time, which
    // is a one-frame pop. Fade it out over the tail of its own window instead.
    // The fade is anchored to the BRIDGED end, so a held layer stays put.
    const endMs = Math.min(layer.at + (layer.duration ?? scene.durationMs), scene.durationMs);
    const fadeMs = Math.min(AUTO_EXIT_FADE_MS, Math.max(0, endMs - plan.visibleStartMs));
    const startMs = endMs - fadeMs;
    if (endMs > startMs && startMs >= plan.visibleStartMs) {
      tl.fromTo(
        wrappers.exit,
        { autoAlpha: 1 },
        { autoAlpha: 0, duration: (endMs - startMs) / 1000, ease: "power2.in" },
        startMs / 1000
      );
    }
  }

  if (layer.tracks && layer.tracks.length > 0) {
    // only the properties the pipeline does NOT own travel this road
    applyKeyframeTracks(tl, layer.tracks, built.content);
  }

  // The unified keyframes (flat `keyframes` OR legacy `tracks`) live ON the
  // master timeline, so the renderer seeks them exactly like everything else.
  applyLayerKeyframes(tl, layer, pipeline, scene.durationMs);

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
    // the stage's origin, so every box below is in the stage's space
    const stageRect = stage.stage.getBoundingClientRect();
    const stageOrigin = { x: stageRect.left, y: stageRect.top };
    for (const { layer, built, wrappers, plan } of descriptors) {
      const visible = timeMs >= plan.visibleStartMs && timeMs < plan.visibleEndMs;
      const { phase, progressPct } = lifecyclePhaseAt(plan, timeMs);
      const opacity = visible
        ? alphaOf(wrappers.root) * alphaOf(wrappers.entrance) * alphaOf(wrappers.emphasis) * alphaOf(wrappers.exit)
        : 0;
      const painted = built.content.firstElementChild as HTMLElement | null;
      // The stage's own origin: the boxes are reported in the STAGE's
      // coordinate space, so a measurement does not move when the page
      // scrolls or the viewport changes size.
      const box = paintedBox(painted ?? wrappers.exit, stageOrigin);
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
      // the ids of every VISIBLE foreground content layer on this frame — the
      // per-frame half of the "no dead frame" rule. An empty list means the
      // frame is background and grade only, which is a defect unless a
      // transition is mid-peak.
      foreground: layers
        .filter(
          (l, i) =>
            l.opacity > 0.01 &&
            isForegroundContent(descriptors[i]!.layer) &&
            !lifecycleHidden(descriptors[i]!.plan, timeMs)
        )
        .map((l) => l.id),
      layers,
    };
  };
}

function lifecycleHidden(plan: MotionSlotPlan, timeMs: number): boolean {
  return timeMs < plan.visibleStartMs || timeMs >= plan.visibleEndMs;
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
function paintedBox(root: HTMLElement, origin?: { x: number; y: number }): DOMRect {
  // THE ORIGIN IS SUBTRACTED FROM EVERY RECT.
  //
  // `getBoundingClientRect()` is SCREEN space: it moves when the page
  // scrolls, when the viewport is resized, and when the page is laid out
  // differently. The sidecar is a LAYOUT report — a number an agent
  // compares against the canvas — so it is reported in the STAGE's space,
  // where the canvas is exactly (0, 0) to (width, height).
  //
  // Without this, two measurements of the SAME frame on two different pages
  // disagreed by 3.8 px, and the frames after the first drifted.
  const ox = origin?.x ?? 0;
  const oy = origin?.y ?? 0;
  const own = root.getBoundingClientRect();
  if (own.width > 0 && own.height > 0) {
    return shiftRect(own, ox, oy);
  }
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
  if (!Number.isFinite(left)) return shiftRect(own, ox, oy);
  return {
    x: left - ox,
    y: top - oy,
    width: right - left,
    height: bottom - top,
    top: top - oy,
    bottom: bottom - oy,
    left: left - ox,
    right: right - ox,
    toJSON: () => ({}),
  } as DOMRect;
}

/** A copy of `rect` with its origin moved by (-dx, -dy). */
function shiftRect(rect: DOMRect, dx: number, dy: number): DOMRect {
  if (dx === 0 && dy === 0) return rect;
  return {
    x: rect.x - dx,
    y: rect.y - dy,
    width: rect.width,
    height: rect.height,
    top: rect.top - dy,
    bottom: rect.bottom - dy,
    left: rect.left - dx,
    right: rect.right - dx,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * Does this layer's content overflow its box in a way that CLIPS TEXT?
 *
 * THE BUG THIS FIXES: the old implementation checked the ROOT element's
 * `scrollWidth`/`clientWidth` for EVERY layer. A background whose gradient
 * blobs extend past the canvas, or a full-bleed overlay with a negative
 * inset, overflows its root — and the flag, which the MCP surfaces to an
 * agent as "TEXT OVERFLOW (clipped content)", fired for a layer that has no
 * text at all. An agent debugging its scene would be told its headline was
 * clipped when the headline was fine.
 *
 * So the root check now applies ONLY to a root that actually holds text, and
 * the per-child check (the real text nodes) is unchanged.
 */
function anyTextOverflow(root: HTMLElement): boolean {
  const holdsText = root.matches(".mf-unit, [data-mf-text]") ||
    root.querySelector(".mf-unit, [data-mf-text]") !== null;
  if (holdsText && isTextOverflow(root)) return true;
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