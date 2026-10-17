import { gsap } from "gsap";
import type { AssetKind, FontRole, SceneSpec } from "@motionforge/scene-spec";
import type { Stage } from "./stage.js";
import { applyCamera } from "./camera.js";
import { PRESET_DEFAULTS, applyEmphasis, applyEntrance, applyExit, type PresetTarget } from "./presets.js";
import { renderLayer, type BuiltLayer } from "./layers/index.js";
import type { LayerContext } from "./layers/context.js";
import {
  createMotionWrappers,
  LayerLifecycle,
  planMotionSlots,
  type SceneLayer,
} from "./motion-slots.js";
import type { Seekable } from "./types.js";

export interface SceneBuildOptions {
  fonts: Map<FontRole, string>;
  resolveAsset: (assetId: string) => string;
  assetKind: (assetId: string) => AssetKind | undefined;
  lottieData: (assetId: string) => unknown;
  registerSeekable: (seekable: Seekable) => void;
}

export interface BuiltScene {
  tl: gsap.core.Timeline;
  layerFocus: Map<string, HTMLElement>;
  lifecycle: LayerLifecycle;
}

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
    };

    const built = renderLayer(layer, ctx);
    applyLayerTiming(tl, scene, layer, built, wrappers, stage.rig, layerFocus, lifecycle);
  });

  applyCamera(tl, scene, stage.rig, layerFocus);
  applyTransitions(tl, scene, stage.rig);

  lifecycle.applyInitial();

  window.masterTimeline = tl;
  return { tl, layerFocus, lifecycle };
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
): void {
  const plan = planMotionSlots(layer, scene.durationMs);
  const staggerMs =
    layer.entrance?.staggerMs ??
    (layer.type === "kineticText" ? (layer.animateBy === "char" ? 30 : 80) : 60);

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
  }

  // camera `focusTarget` centers on the painted content, not the full-bleed wrapper
  layerFocus.set(layer.id, built.content);
}

/**
 * Scene-level transition overlays (they sit above every layer, below the UI).
 * All are timeline tweens → frame-deterministic.
 *
 * Every overlay starts `display: none` and is switched on with an explicit
 * `tl.set` at its `at` time, instead of relying on `fromTo`'s implicit
 * `immediateRender`. That keeps overlays hidden at every time before `at`
 * under arbitrary (non-linear) seeking — otherwise a solid wipe cover can be
 * painted over the opening frames.
 */
function applyTransitions(tl: gsap.core.Timeline, scene: SceneSpec, rig: HTMLElement): void {
  const prepare = (el: HTMLElement, at: number, dur: number): void => {
    el.style.display = "none";
    tl.set(el, { display: "block" }, at);
    tl.set(el, { display: "none" }, at + dur + 0.001);
  };

  for (const tr of scene.transitions) {
    const at = tr.at / 1000;
    const dur = tr.durationMs / 1000;

    if (tr.kind === "wipe") {
      const cover = document.createElement("div");
      cover.style.cssText = `position:absolute;inset:0;background:${tr.color};z-index:900;`;
      if (tr.featherPx > 0) {
        const softness = (tr.featherPx / Math.max(scene.canvas.scale, 1)) * 12;
        cover.style.webkitMaskImage =
          tr.direction === "left" || tr.direction === "right"
            ? `linear-gradient(90deg, #000 ${(50 - softness / 2).toFixed(1)}%, transparent ${(50 + softness / 2).toFixed(1)}%)`
            : `linear-gradient(0deg, #000 ${(50 - softness / 2).toFixed(1)}%, transparent ${(50 + softness / 2).toFixed(1)}%)`;
        cover.style.maskImage = cover.style.webkitMaskImage ?? "";
      }
      rig.appendChild(cover);
      prepare(cover, at, dur);

      const from = { xPercent: 0, yPercent: 0 };
      const to = { xPercent: 0, yPercent: 0 };
      if (tr.direction === "left") { from.xPercent = -130; to.xPercent = 130; }
      if (tr.direction === "right") { from.xPercent = 130; to.xPercent = -130; }
      if (tr.direction === "up") { from.yPercent = -130; to.yPercent = 130; }
      if (tr.direction === "down") { from.yPercent = 130; to.yPercent = -130; }
      tl.fromTo(cover, from, { ...to, duration: dur, ease: "power4.inOut", immediateRender: false }, at);
    } else if (tr.kind === "glitch") {
      // stepped RGB-fringe flicker + rig jitter, fully stepped (deterministic)
      const fringe = document.createElement("div");
      fringe.style.cssText = [
        "position:absolute;inset:0;z-index:900;pointer-events:none;mix-blend-mode:screen;opacity:0;",
        "background:repeating-linear-gradient(0deg, rgba(255,0,60,0.16) 0 3px, transparent 3px 7px, rgba(0,255,255,0.14) 7px 9px, transparent 9px 14px);",
      ].join(";");
      rig.appendChild(fringe);
      prepare(fringe, at, dur);

      const steps = 8;
      const jitters = [-1, 1, -0.6, 0.8, -0.3, 0.5, -0.2, 0].map((k) => k * 16 * tr.intensity);
      jitters.forEach((j, i) => {
        tl.set(rig, { x: j }, at + (dur * i) / steps);
        tl.set(fringe, { opacity: i % 2 === 0 ? 0.9 : 0.3 }, at + (dur * i) / steps);
      });
      tl.set(rig, { x: 0 }, at + dur);
    } else if (tr.kind === "whipPan") {
      const band = document.createElement("div");
      band.style.cssText = [
        "position:absolute;inset:0;z-index:900;pointer-events:none;opacity:0;",
        "background:repeating-linear-gradient(90deg, rgba(255,255,255,0.08) 0 40px, transparent 40px 120px);",
        "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);",
      ].join(";");
      rig.appendChild(band);
      prepare(band, at, dur);

      const dir = tr.direction === "left" ? -1 : 1;
      tl.to(rig, { xPercent: `+=${dir * 24}`, duration: dur / 2, ease: "power2.in" }, at);
      tl.to(rig, { xPercent: `-=${dir * 24}`, duration: dur / 2, ease: "power2.out" }, at + dur / 2);
      tl.fromTo(band, { opacity: 0 }, { opacity: 1, duration: dur * 0.3, ease: "none", immediateRender: false }, at);
      tl.to(band, { opacity: 0, duration: dur * 0.7, ease: "none" }, at + dur * 0.3);
    } else {
      // morph: blur-dissolve veil
      const veil = document.createElement("div");
      veil.style.cssText = [
        "position:absolute;inset:0;z-index:900;pointer-events:none;opacity:0;",
        "background:rgba(0,0,0,0.25);",
        "backdrop-filter:blur(50px);-webkit-backdrop-filter:blur(50px);",
      ].join(";");
      rig.appendChild(veil);
      prepare(veil, at, dur);

      tl.to(veil, { opacity: 1, duration: dur / 2, ease: "sine.in" }, at);
      tl.to(veil, { opacity: 0, duration: dur / 2, ease: "sine.out" }, at + dur / 2);
    }
  }
}
