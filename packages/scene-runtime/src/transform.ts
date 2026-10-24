/**
 * The unified 2D transform pipeline.
 *
 * THE BUG THIS FIXES: every layer renderer wrote its OWN `transform` string
 * into `style.cssText` (`translate(-50%,-50%) rotate(…)`), and the Studio's
 * live-drag handler in `index.ts` overwrote `contentEl.style.transform` with a
 * DIFFERENT string. Two writers, two formats, one element — so the preview
 * desynced from the scene the moment anything moved, and the Studio's gizmo
 * fought the renderer for the same property.
 *
 * There is now exactly ONE owner: this module. The renderers write the
 * anchor (`left` / `top`) and nothing else; the pipeline writes
 * `transform`, `opacity`, `filter` and the layout size, and it computes them
 * from ONE pure function — {@link resolveTransform} — so the value the Studio
 * previews is bit-for-bit the value the renderer draws.
 *
 * THE MATH IS SHARED, NOT APPROXIMATED. A keyframe is interpolated here with
 * the same easing functions the Studio uses, so a drag that lands on a
 * keyframed property does not jump when the scene is saved and pushed back.
 */
import type { gsap } from "gsap";
import {
  flatKeyframeSamples as sharedFlatKeyframeSamples,
  interpolateKeyframeSamples as sharedInterpolateKeyframeSamples,
  keyframeSamplesFor as sharedKeyframeSamplesFor,
  legacyEaseToKeyframeEasing as sharedLegacyEaseToKeyframeEasing,
  legacyKeyframeSamples as sharedLegacyKeyframeSamples,
  KEYFRAME_EASING_FUNCTIONS,
  LEGACY_PROPERTY_MAP as LEGACY_PROPERTY_MAP_SHARED,
  LAYOUT_SLOT_BOXES,
  type LayoutSlot,
  type LayerAnchor,
  type KeyframeEasing,
  type KeyframeProperty,
  type KeyframeTrack,
  type LayerKeyframe,
  type SceneSpec,
} from "@motionforge/scene-spec";

/** Any layer of the scene union. */
export type SceneLayer = SceneSpec["layers"][number];

/**
 * The FULL resolved state of a layer's 2D transform at one instant.
 *
 * `xPct` / `yPct` are the ANCHOR (the canvas point the content is centred
 * on), not a translation: the content is centred on the anchor by the
 * `translate(-50%,-50%)` inside {@link transformCss}.
 */
export interface ResolvedTransform {
  xPct: number;
  yPct: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  anchor?: LayerAnchor;
  /** layout width as a percent of the canvas (authored via `layer.size`) */
  widthPct?: number;
  /** layout height as a percent of the canvas (authored via `layer.size`) */
  heightPct?: number;
}

/** The neutral transform: the canvas centre, unscaled, unrotated, opaque. */
export const DEFAULT_TRANSFORM: ResolvedTransform = Object.freeze({
  xPct: 50,
  yPct: 50,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
  anchor: "center",
});

/**
 * The easing curves a unified keyframe may use.
 *
 * These are the curves the runtime implements EXACTLY. The names are a
 * closed set so the Studio can preview exactly what the renderer produces.
 */
const EASINGS: Record<KeyframeEasing, (t: number) => number> = KEYFRAME_EASING_FUNCTIONS;

/**
 * The GSAP ease a keyframe easing is rendered with.
 *
 * Only used for the PROXY tweens that put the keyframes on the master
 * timeline; the visual value always comes from {@link EASINGS}, so the two
 * can never disagree about the rendered pose.
 */
export const GSAP_EASES: Record<KeyframeEasing, string> = {
  linear: "none",
  easeIn: "power2.in",
  easeOut: "power2.out",
  easeInOut: "power2.inOut",
  cubic: "power3.in",
  "power1.in": "power1.in",
  "power1.out": "power1.out",
  "power1.inOut": "power1.inOut",
  "power2.in": "power2.in",
  "power2.out": "power2.out",
  "power2.inOut": "power2.inOut",
  "power3.in": "power3.in",
  "power3.out": "power3.out",
  "power3.inOut": "power3.inOut",
  "power4.in": "power4.in",
  "power4.out": "power4.out",
  "power4.inOut": "power4.inOut",
  "expo.in": "expo.in",
  "expo.out": "expo.out",
  "expo.inOut": "expo.inOut",
  "circ.in": "circ.in",
  "circ.out": "circ.out",
  "circ.inOut": "circ.inOut",
  "sine.in": "sine.in",
  "sine.out": "sine.out",
  "sine.inOut": "sine.inOut",
  "back.in(1.7)": "back.in(1.7)",
  "back.out(1.7)": "back.out(1.7)",
  "back.out(2.5)": "back.out(2.5)",
  "back.out(4)": "back.out(4)",
  "back.inOut(1.7)": "back.inOut(1.7)",
  "elastic.in(1,0.75)": "elastic.in(1,0.75)",
  "elastic.out(1,0.5)": "elastic.out(1,0.5)",
  "elastic.out(1,0.75)": "elastic.out(1,0.75)",
  "bounce.in": "bounce.in",
  "bounce.out": "bounce.out",
  "steps(12)": "steps(12)",
};

/** The legacy `tracks[].property` names the unified pipeline understands. */
const LEGACY_PROPERTY_MAP: Record<string, KeyframeProperty> = {
  ...LEGACY_PROPERTY_MAP_SHARED,
};

/** One interpolation sample — the shape both keyframe systems reduce to. */
export interface KeyframeSample {
  timeMs: number;
  value: number;
  easing: KeyframeEasing;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const clampScale = (value: number): number => clamp(value, 0.05, 10);

/**
 * Map a GSAP ease name onto one of the five keyframe easings.
 *
 * `linear` (and GSAP's `none`) is linear, `*.in` eases in, `*.out` eases out,
 * `*.inOut` does both, and anything unrecognised falls back to `easeInOut` —
 * the same default the flat keyframe schema declares.
 */
export function legacyEaseToKeyframeEasing(ease: string | undefined): KeyframeEasing {
  return sharedLegacyEaseToKeyframeEasing(ease);
}

/** The samples of the FLAT `layer.keyframes` array for one property. */
export function flatKeyframeSamples(
  keyframes: readonly LayerKeyframe[] | undefined,
  property: KeyframeProperty
): KeyframeSample[] {
  return sharedFlatKeyframeSamples(keyframes, property);
}

/**
 * The samples of the LEGACY `layer.tracks` system for one property.
 *
 * `at` becomes `timeMs` and the GSAP ease name is mapped onto one of the five
 * keyframe easings — the legacy system keeps working, it just speaks the
 * unified language at evaluation time.
 */
export function legacyKeyframeSamples(
  tracks: readonly KeyframeTrack[] | undefined,
  property: KeyframeProperty
): KeyframeSample[] {
  return sharedLegacyKeyframeSamples(tracks, property);
}

/**
 * The samples that drive one property, with the FLAT keyframes winning.
 *
 * PRECEDENCE: when a property is keyframed in BOTH systems, the flat
 * `keyframes` array wins — it is the newer, explicit surface, and mixing the
 * two would make the rendered value depend on which array happened to be
 * authored last.
 */
export function keyframeSamplesFor(layer: SceneLayer, property: KeyframeProperty): KeyframeSample[] {
  return sharedKeyframeSamplesFor(layer.keyframes, layer.tracks, property);
}

/** Interpolate a sorted list of samples at one time. */
function interpolateSamples(samples: readonly KeyframeSample[], timeMs: number): number | undefined {
  return sharedInterpolateKeyframeSamples(samples, timeMs);
}

/**
 * Interpolate the flat `keyframes` of a layer for ONE property at ONE time.
 *
 * - before the first keyframe → the first keyframe's value
 * - after the last keyframe → the last keyframe's value
 * - exactly on a keyframe → that keyframe's value
 * - between two keyframes → the LEFT keyframe's easing is applied to the
 *   normalized progress
 *
 * Returns `undefined` when the property is not keyframed at all.
 */
export function interpolateKeyframes(
  keyframes: LayerKeyframe[],
  property: KeyframeProperty,
  timeMs: number
): number | undefined {
  return interpolateSamples(flatKeyframeSamples(keyframes, property), timeMs);
}

/**
 * Resolve the FULL transform of a layer at a time.
 *
 * The authored values are the BASE; the keyframes (flat first, legacy second)
 * override them. `scale` is the uniform base for `scaleX` / `scaleY`, so an
 * authored `scaleX` wins over a `scale` keyframe on that axis only.
 */
export function resolveTransform(layer: SceneLayer, timeMs: number): ResolvedTransform {
  const position = layer.position;
  const authoredScale = typeof layer.scale === "number" ? clampScale(layer.scale) : 1;

  const pick = (property: KeyframeProperty): number | undefined =>
    interpolateSamples(keyframeSamplesFor(layer, property), timeMs);

  const scale = pick("scale");
  const uniform = scale === undefined ? authoredScale : clampScale(scale);

  const slotBox = layer.layoutSlot && layer.layoutSlot in LAYOUT_SLOT_BOXES
    ? LAYOUT_SLOT_BOXES[layer.layoutSlot as LayoutSlot]
    : undefined;

  const xPct = pick("xPct") ?? position?.xPct ?? slotBox?.xPct ?? DEFAULT_TRANSFORM.xPct;
  const yPct = pick("yPct") ?? position?.yPct ?? slotBox?.yPct ?? DEFAULT_TRANSFORM.yPct;
  const rotation = pick("rotation") ?? layer.rotation ?? DEFAULT_TRANSFORM.rotation;
  const opacity = pick("opacity") ?? layer.opacity ?? DEFAULT_TRANSFORM.opacity;

  const anchor = layer.anchor ?? "center";
  const resolved: ResolvedTransform = {
    xPct: clamp(xPct, -300, 300),
    yPct: clamp(yPct, -300, 300),
    scaleX: clampScale(layer.scaleX ?? uniform),
    scaleY: clampScale(layer.scaleY ?? uniform),
    rotation: clamp(rotation, -3600, 3600),
    opacity: clamp(opacity, 0, 1),
    anchor,
  };

  const size = layer.size;
  // `particleField` SHADOWS the universal layout-size bag with a numeric
  // particle radius (it is full-bleed, so it has no layout box). Only the
  // object shape carries a layout size.
  if (typeof size === "object" && size !== null) {
    const widthPct = size.widthPct ?? slotBox?.widthPct;
    const heightPct = size.heightPct ?? slotBox?.heightPct;
    if (widthPct !== undefined) resolved.widthPct = clamp(widthPct, 0, 400);
    if (heightPct !== undefined) resolved.heightPct = clamp(heightPct, 0, 400);
  } else if (slotBox && layer.type !== "particleField") {
    resolved.widthPct = clamp(slotBox.widthPct, 0, 400);
    resolved.heightPct = clamp(slotBox.heightPct, 0, 400);
  }

  return resolved;
}

export function anchorTranslation(anchor?: LayerAnchor): { xPct: number; yPct: number } {
  switch (anchor) {
    case "topLeft":
      return { xPct: 0, yPct: 0 };
    case "topRight":
      return { xPct: -100, yPct: 0 };
    case "bottomLeft":
      return { xPct: 0, yPct: -100 };
    case "bottomRight":
      return { xPct: -100, yPct: -100 };
    case "center":
    default:
      return { xPct: -50, yPct: -50 };
  }
}

export function anchorOrigin(anchor?: LayerAnchor): string {
  switch (anchor) {
    case "topLeft":
      return "0% 0%";
    case "topRight":
      return "100% 0%";
    case "bottomLeft":
      return "0% 100%";
    case "bottomRight":
      return "100% 100%";
    case "center":
    default:
      return "50% 50%";
  }
}

/**
 * The single CSS transform string used by every layer.
 *
 * Translate centers or aligns the content on its anchor according to `t.anchor`,
 * the scale is non-uniform, and rotation happens about the anchor.
 */
export function transformCss(t: ResolvedTransform): string {
  const { xPct, yPct } = anchorTranslation(t.anchor);
  return `translate(${xPct}%,${yPct}%) scale(${t.scaleX}, ${t.scaleY}) rotate(${t.rotation}deg)`;
}

/**
 * The CSS `filter` value from `layer.filters` (empty string when there are
 * none).
 */
export function filterCss(layer: SceneLayer): string {
  const filters = layer.filters;
  if (!filters) return "";
  const parts: string[] = [];
  if (filters.blur !== undefined) parts.push(`blur(${filters.blur}px)`);
  if (filters.brightness !== undefined) parts.push(`brightness(${filters.brightness}%)`);
  if (filters.contrast !== undefined) parts.push(`contrast(${filters.contrast}%)`);
  if (filters.saturate !== undefined) parts.push(`saturate(${filters.saturate}%)`);
  if (filters.shadowBlur !== undefined) {
    parts.push(`drop-shadow(0 0 ${filters.shadowBlur}px ${filters.shadowColor ?? "rgba(0,0,0,0.55)"})`);
  }
  return parts.join(" ");
}

/** The corner radius the layer's own box gets (empty string when unset). */
export function radiusCss(layer: SceneLayer): string {
  const radius = layer.filters?.cornerRadius;
  return radius === undefined ? "" : `${radius}px`;
}

/**
 * Layers that paint the WHOLE canvas.
 *
 * They are never translated, scaled or rotated by the pipeline: a background
 * that moves leaves a black edge, and a full-frame overlay that scales stops
 * covering the frame.
 */
export function isFullBleedLayer(layer: SceneLayer): boolean {
  return (
    layer.type === "background" ||
    layer.type === "foregroundFX" ||
    layer.type === "particleField"
  );
}

/**
 * A live override of the resolved transform — the Studio's direct
 * manipulation, applied on top of the scene until the scene is pushed back.
 */
export interface TransformOverride {
  xPct?: number;
  yPct?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  opacity?: number;
  widthPct?: number;
  heightPct?: number;
  /** legacy layout size, in design pixels */
  widthPx?: number;
  /** legacy layout size, in design pixels */
  heightPx?: number;
}

/** Merge an override onto a resolved transform. */
export function mergeOverride(base: ResolvedTransform, override: TransformOverride | undefined): ResolvedTransform {
  if (!override) return base;
  const scale = override.scale ?? base.scaleX;
  return {
    xPct: override.xPct ?? base.xPct,
    yPct: override.yPct ?? base.yPct,
    scaleX: clampScale(override.scaleX ?? scale),
    scaleY: clampScale(override.scaleY ?? scale),
    rotation: override.rotation ?? base.rotation,
    opacity: override.opacity ?? base.opacity,
    ...(override.widthPct !== undefined ? { widthPct: override.widthPct } : {}),
    ...(override.heightPct !== undefined ? { heightPct: override.heightPct } : {}),
  };
}

/**
 * Apply the transform, the filter and the opacity to an element — in ONE
 * place, so no renderer and no message handler can write a competing value.
 */
export function applyLayerTransform(el: HTMLElement, t: ResolvedTransform, layer: SceneLayer): void {
  if (isFullBleedLayer(layer)) {
    // full-bleed layers keep their own internal opacity handling
    el.style.transform = "none";
    return;
  }

  el.style.left = `${t.xPct}%`;
  el.style.top = `${t.yPct}%`;
  el.style.transform = transformCss(t);
  el.style.transformOrigin = anchorOrigin(t.anchor);
  el.style.opacity = String(t.opacity);

  const authored = el.dataset.mfAuthoredFilter ?? "";
  const filter = filterCss(layer);
  const combined = [authored, filter].filter(Boolean).join(" ");
  if (combined) el.style.filter = combined;
  else el.style.removeProperty("filter");

  const radius = radiusCss(layer);
  if (radius) el.style.borderRadius = radius;

  if (t.widthPct !== undefined) el.style.width = `${t.widthPct}%`;
  if (t.heightPct !== undefined) el.style.height = `${t.heightPct}%`;
}

/**
 * The owner of every layer's transform.
 *
 * It knows which element belongs to which layer (so the bounds report never
 * has to guess at the DOM), holds the live overrides, and applies the whole
 * scene's transforms from ONE timeline callback.
 */
export class TransformPipeline {
  private readonly entries = new Map<string, { layer: SceneLayer; el: HTMLElement }>();
  private readonly overrides = new Map<string, TransformOverride>();
  private readonly lastApplied = new Map<string, string>();
  /** the time the pipeline last applied — guards a redundant pass */
  private lastTimeMs = Number.NaN;

  /** Register a layer's content element — the element the pipeline owns. */
  register(layer: SceneLayer, el: HTMLElement): void {
    el.dataset.mfContent = "1";
    this.entries.set(layer.id, { layer, el });
    this.lastApplied.delete(layer.id);
  }

  /** The element the pipeline owns for a layer, if it is mounted. */
  elementFor(layerId: string): HTMLElement | undefined {
    return this.entries.get(layerId)?.el;
  }

  /** The layer the pipeline owns for a layer id. */
  layerFor(layerId: string): SceneLayer | undefined {
    return this.entries.get(layerId)?.layer;
  }

  /** Every layer the pipeline owns. */
  get layerIds(): string[] {
    return [...this.entries.keys()];
  }

  /** Replace the live override of a layer (the Studio's drag). */
  setOverride(layerId: string, override: TransformOverride): void {
    this.overrides.set(layerId, override);
    this.lastApplied.delete(layerId);
    this.lastTimeMs = Number.NaN;
  }

  /** The live override of a layer. */
  overrideFor(layerId: string): TransformOverride | undefined {
    return this.overrides.get(layerId);
  }

  /** Drop every live override (a new scene was pushed). */
  clearOverrides(): void {
    this.overrides.clear();
    this.lastApplied.clear();
    this.lastTimeMs = Number.NaN;
  }

  /** The resolved transform of a layer at a time, overrides included. */
  resolveAt(layerId: string, timeMs: number): ResolvedTransform | undefined {
    const entry = this.entries.get(layerId);
    if (!entry) return undefined;
    return mergeOverride(resolveTransform(entry.layer, timeMs), this.overrides.get(layerId));
  }

  /**
   * Apply every layer's transform at one instant.
   *
   * Idempotent and cheap: the pass is skipped entirely when the time has not
   * moved, and a layer whose resolved transform did not change is not written
   * again — so a 60 fps render does not thrash the style engine.
   */
  applyAt(timeMs: number): void {
    if (timeMs === this.lastTimeMs) return;
    this.lastTimeMs = timeMs;
    for (const [id, entry] of this.entries) {
      const resolved = mergeOverride(resolveTransform(entry.layer, timeMs), this.overrides.get(id));
      const signature = transformSignature(resolved);
      if (this.lastApplied.get(id) === signature) continue;
      this.lastApplied.set(id, signature);
      applyLayerTransform(entry.el, resolved, entry.layer);
      const override = this.overrides.get(id);
      if (override?.widthPx !== undefined) entry.el.style.width = `${override.widthPx}px`;
      if (override?.heightPx !== undefined) entry.el.style.height = `${override.heightPx}px`;
    }
  }

  /** Forget every cached signature (after a scene rebuild). */
  invalidate(): void {
    this.lastApplied.clear();
    this.lastTimeMs = Number.NaN;
  }

  /**
   * Install the pipeline as ONE writer on the master timeline.
   *
   * The timeline's `onUpdate` fires after every child has rendered, so the
   * transform of every layer is rewritten from the timeline's OWN time — the
   * same time the camera composes from. There is no second clock, and a
   * non-linear seek lands on exactly the same pose as a linear one.
   *
   * The previous `onUpdate` is chained, never replaced: the camera installs
   * its own writer and must keep working.
   */
  install(tl: gsap.core.Timeline): void {
    const pipeline = this;
    const previous = tl.eventCallback("onUpdate");
    tl.eventCallback("onUpdate", function composedOnUpdate(this: gsap.core.Timeline) {
      pipeline.applyAt(this.time() * 1000);
      if (typeof previous === "function") previous.call(this);
    });
    pipeline.applyAt(tl.time() * 1000);
  }
}

function transformSignature(t: ResolvedTransform): string {
  return [
    t.xPct,
    t.yPct,
    t.scaleX,
    t.scaleY,
    t.rotation,
    t.opacity,
    t.widthPct ?? "",
    t.heightPct ?? "",
  ].join("|");
}
