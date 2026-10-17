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
  /** primary element the preset animates */
  el: HTMLElement;
  /** optional split units (word/char spans) that receive staggered versions */
  units?: HTMLElement[];
  unitStaggerMs: number;
  /** absolute ms window this preset slot occupies in the scene */
  startMs: number;
  endMs: number;
  rig: HTMLElement;
}

interface Vars {
  from: gsap.TweenVars;
  to: gsap.TweenVars;
}

const ENTRANCE_VARS: Record<EntrancePreset, Vars> = {
  springPop: { from: { scale: 0.4, autoAlpha: 0 }, to: { scale: 1, autoAlpha: 1 } },
  smoothSlideUp: { from: { y: 90, autoAlpha: 0 }, to: { y: 0, autoAlpha: 1 } },
  maskRevealWipe: {
    from: { clipPath: "inset(0% 100% 0% 0%)", autoAlpha: 1 },
    to: { clipPath: "inset(0% 0% 0% 0%)", autoAlpha: 1 },
  },
  elasticScale: { from: { scale: 0.55, autoAlpha: 0 }, to: { scale: 1, autoAlpha: 1 } },
  blurFadeIn: { from: { filter: "blur(28px)", autoAlpha: 0 }, to: { filter: "blur(0px)", autoAlpha: 1 } },
  "3dFlipIn": {
    from: { rotationY: -85, transformPerspective: 1200, autoAlpha: 0 },
    to: { rotationY: 0, transformPerspective: 1200, autoAlpha: 1 },
  },
};

const EXIT_VARS: Record<ExitPreset, Vars> = {
  scaleDownFade: { from: {}, to: { scale: 0.82, autoAlpha: 0 } },
  whipOutLeft: { from: {}, to: { xPercent: -70, autoAlpha: 0, filter: "blur(12px)" } },
  collapseMask: { from: {}, to: { clipPath: "inset(0% 50% 0% 50%)", autoAlpha: 0 } },
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

  if (target.units && target.units.length > 1) {
    tl.fromTo(
      target.units,
      withStrength({ ...vars.from }, strength),
      { ...vars.to, duration: dur, ease, stagger: target.unitStaggerMs / 1000 },
      at
    );
  } else {
    tl.fromTo(
      target.el,
      withStrength({ ...vars.from }, strength),
      { ...vars.to, duration: dur, ease },
      at
    );
  }
}

export function applyExit(tl: gsap.core.Timeline, ref: PresetRef, target: PresetTarget): void {
  const def = PRESET_DEFAULTS[ref.name as ExitPreset] ?? null;
  if (!def) throw new Error(`"${ref.name}" is not an exit preset`);
  const vars = EXIT_VARS[ref.name as ExitPreset];
  const dur = refDurationMs(ref, def) / 1000;
  const at = Math.max(0, target.endMs / 1000 - dur) + (ref.delayMs ?? 0) / 1000;
  tl.to(target.el, { ...vars.to, duration: dur, ease: refEase(ref, def) }, at);
}

export function applyEmphasis(tl: gsap.core.Timeline, ref: PresetRef, target: PresetTarget): void {
  const def = PRESET_DEFAULTS[ref.name as EmphasisPreset] ?? null;
  if (!def) throw new Error(`"${ref.name}" is not an emphasis preset`);
  const strength = ref.strength ?? 1;
  const windowSec = Math.max(0, (target.endMs - target.startMs) / 1000);
  const at = target.startMs / 1000 + (ref.delayMs ?? 0) / 1000;

  switch (ref.name as EmphasisPreset) {
    case "pulseGlow": {
      const cycle = refDurationMs(ref, def) / 1000;
      const repeats = Math.max(2, Math.floor(windowSec / cycle));
      tl.to(
        target.el,
        {
          scale: 1 + 0.03 * strength,
          duration: cycle / 2,
          ease: "sine.inOut",
          yoyo: true,
          repeat: repeats % 2 === 0 ? repeats : repeats + 1,
        },
        at
      );
      break;
    }
    case "floatIdle": {
      const cycle = refDurationMs(ref, def) / 1000;
      const repeats = Math.max(2, Math.floor(windowSec / cycle));
      tl.to(
        target.el,
        {
          y: `-=${10 * strength}`,
          duration: cycle / 2,
          ease: "sine.inOut",
          yoyo: true,
          repeat: repeats % 2 === 0 ? repeats : repeats + 1,
        },
        at
      );
      break;
    }
    case "lightSweep": {
      applySweepOverlay(target.el, tl, {
        at: target.startMs,
        durationMs: refDurationMs(ref, def),
        angleDeg: 25,
        color: "#ffffff",
        widthFactor: 0.35,
      });
      break;
    }
    case "cameraShakeImpact": {
      // even repeat count + yoyo guarantees the rig returns to its rest pose
      tl.to(
        target.rig,
        {
          rotation: `+=${1.4 * strength}`,
          duration: 0.05,
          repeat: 9,
          yoyo: true,
          ease: "none",
        },
        at
      );
      tl.to(
        target.rig,
        {
          scale: `+=${0.02 * strength}`,
          duration: 0.05,
          repeat: 9,
          yoyo: true,
          ease: "none",
        },
        at
      );
      break;
    }
  }
}

/** Diagonal specular band that sweeps across `host` (host must clip overflow). */
export function applySweepOverlay(
  host: HTMLElement,
  tl: gsap.core.Timeline,
  opts: { at: number; durationMs: number; angleDeg: number; color: string; widthFactor: number }
): void {
  const sweep = document.createElement("div");
  sweep.className = "mf-sweep";
  sweep.style.left = "0";
  sweep.style.transform = `rotate(${opts.angleDeg}deg)`;
  sweep.style.width = `${opts.widthFactor * 100}%`;
  sweep.style.background = `linear-gradient(90deg, transparent, ${opts.color}, transparent)`;
  sweep.style.opacity = "0.55";
  host.appendChild(sweep);

  tl.fromTo(
    sweep,
    { xPercent: -260, autoAlpha: 1 },
    { xPercent: 320, duration: opts.durationMs / 1000, ease: "power2.inOut" },
    opts.at / 1000
  );
  tl.set(sweep, { autoAlpha: 0 }, (opts.at + opts.durationMs) / 1000);
}
