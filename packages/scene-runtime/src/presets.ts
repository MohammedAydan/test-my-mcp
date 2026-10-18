import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import type {
  Ease,
  EmphasisPreset,
  EntrancePreset,
  ExitPreset,
  MotionPreset,
  PresetRef,
} from "@motionforge/scene-spec";
import {
  applyCameraEnvelope,
  applyDecayEnvelope,
  applyOscillatingEnvelope,
  planCameraEnvelope,
  planEnvelope,
  SHAKE_SAMPLES,
} from "./envelope.js";

gsap.registerPlugin(CustomEase);

/** Map a scene-spec ease (named string or cubic-bezier) to a GSAP ease value. */
const easeCache = new Map<string, gsap.TweenVars["ease"]>();
export function easeToGsap(ease: Ease): gsap.TweenVars["ease"] {
  if (typeof ease === "string") {
    // registry names are valid GSAP ease strings by construction
    return ease as unknown as gsap.TweenVars["ease"];
  }
  const [x1, y1, x2, y2] = ease.bezier;
  const key = `bezier(${x1},${y1},${x2},${y2})`;
  const cached = easeCache.get(key);
  if (cached) return cached;
  const created = CustomEase.create(
    `mf-ease-${easeCache.size}`,
    `M0,0 C${x1},${y1} ${x2},${y2} 1,1`
  );
  easeCache.set(key, created);
  return created;
}

/**
 * Motion preset registry — the single implementation site for every preset name
 * advertised by `scene-spec`. Each preset declares curated defaults (already
 * professional); spec refs may override duration/ease/stagger/strength.
 */
interface PresetDef {
  durationMs: number;
  ease: Ease;
}

export const PRESET_DEFAULTS: Record<MotionPreset, PresetDef> = {
  // entrances
  springPop: { durationMs: 900, ease: "back.out(1.7)" },
  smoothSlideUp: { durationMs: 900, ease: "expo.out" },
  maskRevealWipe: { durationMs: 800, ease: "power4.inOut" },
  elasticScale: { durationMs: 1200, ease: "elastic.out(1,0.75)" },
  blurFadeIn: { durationMs: 900, ease: "expo.out" },
  "3dFlipIn": { durationMs: 1000, ease: "back.out(2.5)" },
  // emphasis
  pulseGlow: { durationMs: 1600, ease: "sine.inOut" },
  floatIdle: { durationMs: 2400, ease: "sine.inOut" },
  lightSweep: { durationMs: 1000, ease: "power2.inOut" },
  cameraShakeImpact: { durationMs: 500, ease: "power2.out" },
  // exits
  scaleDownFade: { durationMs: 500, ease: "power2.in" },
  whipOutLeft: { durationMs: 600, ease: "power3.in" },
  collapseMask: { durationMs: 600, ease: "power4.inOut" },
};

export interface PresetTarget {
  /** the element this slot owns — one of the nested phase wrappers */
  el: HTMLElement;
  /**
   * the painted layer content. Overlays (lightSweep) attach here so they hug
   * the content box rather than the full-bleed wrapper.
   */
  sweepHost: HTMLElement;
  /** optional split units (word/char spans) that receive staggered versions */
  units?: HTMLElement[];
  unitStaggerMs: number;
  /** absolute ms window this preset slot occupies in the scene */
  startMs: number;
  endMs: number;
  rig: HTMLElement;
  /** text direction of the layer — mask reveals must wipe the correct way */
  direction?: "ltr" | "rtl";
}

interface Vars {
  from: gsap.TweenVars;
  to: gsap.TweenVars;
  /**
   * Properties that must be hard-reset at the end of the tween. A tween that
   * ends on `blur(0px)` leaves a blurred raster texture behind in Chromium; the
   * compositor only drops the filter when it is set to `none`.
   */
  clearOnEnd?: gsap.TweenVars;
}

/**
 * `clip-path` inset presets.
 *
 * A mask reveal must NEVER animate `width`/`height`: both force the browser to
 * re-wrap and re-layout the text on every frame, which is how `"Render
 * pipeline"` became `"ender pipeline"` mid-tween in a delivered render. The
 * element keeps its full box and only the visible slice changes.
 */
const NO_ANIMATED_LAYOUT = ["width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight"] as const;

/**
 * Direction-aware mask reveal. An RTL line must be wiped from its own leading
 * edge, which is the right-hand one — sweeping left-to-right would uncover the
 * end of the Arabic sentence first.
 */
function maskRevealClip(direction: "ltr" | "rtl"): { from: gsap.TweenVars; to: gsap.TweenVars } {
  return direction === "rtl"
    ? { from: { clipPath: "inset(0% 0% 0% 100%)" }, to: { clipPath: "inset(0% 0% 0% 0%)" } }
    : { from: { clipPath: "inset(0% 100% 0% 0%)" }, to: { clipPath: "inset(0% 0% 0% 0%)" } };
}

const ENTRANCE_VARS: Record<EntrancePreset, Vars> = {
  springPop: { from: { scale: 0.4, autoAlpha: 0 }, to: { scale: 1, autoAlpha: 1 } },
  smoothSlideUp: { from: { y: 90, autoAlpha: 0 }, to: { y: 0, autoAlpha: 1 } },
  maskRevealWipe: { from: { autoAlpha: 1 }, to: { autoAlpha: 1 } },
  elasticScale: { from: { scale: 0.55, autoAlpha: 0 }, to: { scale: 1, autoAlpha: 1 } },
  blurFadeIn: {
    from: { filter: "blur(28px)", autoAlpha: 0 },
    to: { filter: "blur(0px)", autoAlpha: 1 },
    // `blur(0px)` is NOT the same as `filter: none` for Chromium's compositor:
    // the element stays on a filtered layer and can pop mid-sentence. Drop the
    // filter entirely the instant the entrance completes.
    clearOnEnd: { filter: "none" },
  },
  "3dFlipIn": {
    from: { rotationY: -85, transformPerspective: 1200, autoAlpha: 0 },
    to: { rotationY: 0, transformPerspective: 1200, autoAlpha: 1 },
  },
};

const EXIT_VARS: Record<ExitPreset, Vars> = {
  scaleDownFade: { from: {}, to: { scale: 0.82, autoAlpha: 0 } },
  whipOutLeft: { from: {}, to: { xPercent: -70, autoAlpha: 0, filter: "blur(12px)" } },
  // `collapseMask` is driven explicitly in `applyExit` (it needs a `fromTo`), so
// only the fade half lives here.
collapseMask: { from: {}, to: { autoAlpha: 1 } },
};

/** Scale numeric displacement in `vars` by `strength` (blur strings included). */
function withStrength(vars: gsap.TweenVars, strength: number): gsap.TweenVars {
  if (strength === 1) return vars;
  const out: gsap.TweenVars = {};
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value === "number" && key !== "transformPerspective") {
      out[key] = value * strength;
    } else if (typeof value === "string" && value.startsWith("blur(")) {
      const px = parseFloat(value.replace(/[^\d.]/g, ""));
      out[key] = `blur(${px * strength}px)`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function refEase(ref: PresetRef, def: PresetDef): gsap.TweenVars["ease"] {
  return easeToGsap(typeof ref.ease === "string" ? ref.ease : def.ease);
}

function refDurationMs(ref: PresetRef, def: PresetDef): number {
  return ref.durationMs ?? def.durationMs;
}

export function applyEntrance(tl: gsap.core.Timeline, ref: PresetRef, target: PresetTarget): void {
  const def = PRESET_DEFAULTS[ref.name as EntrancePreset] ?? null;
  if (!def) throw new Error(`"${ref.name}" is not an entrance preset`);
  const vars = ENTRANCE_VARS[ref.name as EntrancePreset];
  const dur = refDurationMs(ref, def) / 1000;
  const at = target.startMs / 1000 + (ref.delayMs ?? 0) / 1000;
  const ease = refEase(ref, def);
  const strength = ref.strength ?? 1;
  const endAt = at + dur;

  // `maskRevealWipe` is the one preset whose tween vars depend on the layer, so
  // the rest share a single scaled pair.
  const scaled =
    ref.name === "maskRevealWipe"
      ? null
      : { from: withStrength({ ...vars.from }, strength), to: withStrength({ ...vars.to }, strength) };
  // fixed box: only the clip changes, so nothing can reflow
  const maskVars: Vars = maskRevealClip(target.direction ?? "ltr");

  if (target.units && target.units.length > 1) {
    // staggered units carry their own opacity — the container only gates visibility
    tl.set(target.el, { autoAlpha: 1 }, at);
    tl.fromTo(
      target.units,
      scaled?.from ?? maskVars.from,
      { ...(scaled?.to ?? maskVars.to), duration: dur, ease, stagger: target.unitStaggerMs / 1000 },
      at
    );
  } else {
    tl.fromTo(
      target.el,
      scaled?.from ?? maskVars.from,
      { ...(scaled?.to ?? maskVars.to), duration: dur, ease },
      at
    );
  }
  if (vars.clearOnEnd) {
    tl.set(target.el, vars.clearOnEnd, endAt);
  }
  const guard: gsap.TweenVars = scaled ? { ...scaled.from, ...scaled.to } : {};
  assertNoLayoutTweening(ref.name, guard);
}

export function applyExit(tl: gsap.core.Timeline, ref: PresetRef, target: PresetTarget): void {
  const def = PRESET_DEFAULTS[ref.name as ExitPreset] ?? null;
  if (!def) throw new Error(`"${ref.name}" is not an exit preset`);
  const vars = EXIT_VARS[ref.name as ExitPreset];
  const dur = refDurationMs(ref, def) / 1000;
  const at = Math.max(0, target.endMs / 1000 - dur) + (ref.delayMs ?? 0) / 1000;
  const strength = ref.strength ?? 1;
  const direction = target.direction ?? "ltr";

  if (ref.name === "collapseMask") {
    // An explicit `fromTo` is required: GSAP would otherwise interpolate the
    // clip from whatever the browser reports (identity), which produces a
    // visible "un-collapse" flash at the very start of the exit.
    tl.fromTo(
      target.el,
      { clipPath: "inset(0% 0% 0% 0%)" },
      {
        clipPath: direction === "rtl" ? "inset(0% 0% 0% 50%)" : "inset(0% 50% 0% 50%)",
        autoAlpha: 1,
        duration: dur,
        ease: refEase(ref, def),
      },
      at
    );
    // the box is only ever clipped, never resized: no reflow, no sliced words
    tl.set(target.el, { clipPath: "inset(0% 100% 0% 100%)" }, at + dur);
    assertNoLayoutTweening(ref.name, { clipPath: "inset(0% 50% 0% 50%)" });
    return;
  }

  const to = withStrength(vars.to, strength);
  tl.to(target.el, { ...to, duration: dur, ease: refEase(ref, def) }, at);
  assertNoLayoutTweening(ref.name, to);
}

/**
 * Emphasis presets are *temporary* effects: they own a bounded window inside the
 * layer's lifetime and must be back at exact identity when that window ends —
 * otherwise the next frame (or the next layer) inherits a stranded `y`, `scale`
 * or `drop-shadow`. See `envelope.ts` for the shared In → Active → Out shape.
 */
export function applyEmphasis(tl: gsap.core.Timeline, ref: PresetRef, target: PresetTarget): void {
  const def = PRESET_DEFAULTS[ref.name as EmphasisPreset] ?? null;
  if (!def) throw new Error(`"${ref.name}" is not an emphasis preset`);
  const strength = ref.strength ?? 1;
  const windowSec = Math.max(0, (target.endMs - target.startMs) / 1000);
  const at = target.startMs / 1000 + (ref.delayMs ?? 0) / 1000;

  switch (ref.name as EmphasisPreset) {
    case "pulseGlow": {
      const cycle = refDurationMs(ref, def) / 1000;
      const plan = planEnvelope(windowSec, cycle);
      // The emphasis wrapper is full-bleed, so the pulse is a *scale* — a
      // shadow here would glow the whole canvas. The envelope guarantees the
      // element is back at exact identity when the window ends: scale 1, and
      // any shadow/filter the peak introduced unwound to its neutral value.
      applyOscillatingEnvelope(tl, {
        el: target.el,
        peak: { scale: 1 + 0.03 * strength },
        at,
        plan,
      });
      break;
    }
    case "floatIdle": {
      const cycle = refDurationMs(ref, def) / 1000;
      const plan = planEnvelope(windowSec, cycle);
      applyOscillatingEnvelope(tl, {
        el: target.el,
        peak: { y: -10 * strength },
        at,
        plan,
      });
      break;
    }
    case "lightSweep": {
      // The sweep is an overlay, so the effect "returns to identity" by
      // becoming fully transparent again — `applySweepOverlay` owns that ramp.
      applySweepOverlay(target.sweepHost, tl, {
        at: target.startMs,
        durationMs: Math.max(1, Math.min(refDurationMs(ref, def), target.endMs - target.startMs)),
        angleDeg: 25,
        color: "#ffffff",
        widthFactor: 0.35,
      });
      break;
    }
    case "cameraShakeImpact": {
      // sin(p·π·n)·(1−p)² — snaps in, settles to x/y/rotation/scale 0 by p = 1
      applyDecayEnvelope(tl, target.rig, {
        at,
        windowSec: windowSec,
        amplitude: {
          x: 16 * strength,
          y: 12 * strength,
          rotation: 1.4 * strength,
          scale: 0.02 * strength,
        },
        samples: SHAKE_SAMPLES,
      });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// lightSweep
// ---------------------------------------------------------------------------

/**
 * A soft specular band that sweeps across `host`.
 *
 * THE BLOCKY-DARK-BAND DEFECT (field report I-9): the sweep used to be an
 * ordinary gradient painted over the content with the default blend mode. Any
 * transparent-to-transparent interpolation still multiplies the underlying
 * pixels by < 1 at the band's flanks, so a `progressBar` track visibly darkened
 * behind it — a hard-edged black rectangle that read as a bug.
 *
 * The fix is structural rather than cosmetic: the band is an isolated overlay
 * that is `mix-blend-mode: screen` (which can only ever *add* light, never
 * subtract), `pointer-events: none`, clipped by its host, and built purely from
 * white/accent stops. Its opacity runs 0 → 1 over the first 20%, sweeps
 * −110% → 110% across the whole window on `power2.inOut`, and returns to 0 over
 * the last 20% — so it is invisible before and after, with no cut.
 */
export function applySweepOverlay(
  host: HTMLElement,
  tl: gsap.core.Timeline,
  opts: { at: number; durationMs: number; angleDeg: number; color: string; widthFactor: number }
): void {
  const durationMs = Math.max(1, opts.durationMs);

  // The band lives in its own clipping wrapper, so it can never spill onto the
  // background around the element it sweeps. (The logo layer already supplies a
  // clipped host; nesting a second clip is harmless and keeps the guarantee
  // uniform for every layer type.)
  const clip = document.createElement("div");
  clip.className = "mf-sweep-clip";
  clip.style.cssText = [
    "position:absolute",
    "inset:0",
    "overflow:hidden",
    "pointer-events:none",
    "border-radius:inherit",
  ].join(";");
  host.appendChild(clip);

  const sweep = document.createElement("div");
  sweep.className = "mf-sweep";
  sweep.style.left = "0";
  sweep.style.top = "0";
  sweep.style.transform = `rotate(${opts.angleDeg}deg)`;
  sweep.style.width = `${opts.widthFactor * 100}%`;
  // screen blend + pure light stops: the underlying pixels can only get brighter
  sweep.style.background = `linear-gradient(90deg, transparent 0%, ${rgbaOf(opts.color, 0.35)} 35%, ${opts.color} 50%, ${rgbaOf(opts.color, 0.35)} 65%, transparent 100%)`;
  // asserted inline as well as in `style.css`, so the guarantee survives a
  // stylesheet that fails to load (and so tests can see it)
  sweep.style.mixBlendMode = "screen";
  sweep.style.pointerEvents = "none";
  sweep.style.opacity = "0";
  sweep.style.visibility = "hidden";
  clip.appendChild(sweep);

  const atSec = opts.at / 1000;
  const durSec = durationMs / 1000;
  const fadeSec = durSec * 0.2;

  tl.set(sweep, { visibility: "visible", autoAlpha: 0 }, atSec);
  tl.to(sweep, { opacity: 1, duration: fadeSec, ease: "power2.inOut" }, atSec);
  tl.fromTo(
    sweep,
    { xPercent: -110 },
    { xPercent: 110, duration: durSec, ease: "power2.inOut", immediateRender: false },
    atSec
  );
  tl.to(sweep, { opacity: 0, duration: fadeSec, ease: "power2.inOut" }, atSec + durSec - fadeSec);
  // the overlay must not survive its window under any seek
  tl.set(sweep, { opacity: 0, autoAlpha: 0, visibility: "hidden", clearProps: "transform,filter" }, atSec + durSec);
}

function rgbaOf(color: string, alpha: number): string {
  if (!color.startsWith("#")) return color;
  let hex = color.slice(1);
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Guard against reintroducing layout-animating mask presets. Text reflow — and
 * therefore sliced words — is the failure mode; width/height on a text or card
 * element is the cause.
 */
function assertNoLayoutTweening(preset: string, vars: gsap.TweenVars): void {
  for (const key of NO_ANIMATED_LAYOUT) {
    if (key in vars) {
      throw new Error(
        `preset "${preset}" animates "${key}" — masks must animate clip-path so the text box never reflows`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// camera move envelopes (shared with camera.ts)
// ---------------------------------------------------------------------------

/**
 * Temporary camera moves get the same In → Hold → Out treatment as every other
 * bounded effect, so a `focusTarget` no longer leaves the camera stranded at
 * 1.45× zoom once its window closes.
 */
export function applyCameraMoveEnvelope(
  tl: gsap.core.Timeline,
  rig: HTMLElement,
  opts: { delta: gsap.TweenVars; atSec: number; durationSec: number }
): void {
  applyCameraEnvelope(tl, rig, {
    delta: opts.delta,
    plan: planCameraEnvelope(opts.durationSec),
    at: opts.atSec,
  });
}