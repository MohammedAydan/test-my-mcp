// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { gsap } from "gsap";
import { parseScene, type SceneSpecInput } from "@motionforge/scene-spec";

import {
  AUTO_EXIT_FADE_MS,
  autoExitWindow,
  identityOf,
  clampCameraPan,
  envelopeAmplitudeAt,
  needsAutoExit,
  planCameraEnvelope,
  planEnvelope,
  SHAKE_SAMPLES,
  shakeDecayAt,
  ENVELOPE_RAMP_FRACTION,
} from "../src/envelope.js";
import {
  applyCamera,
  CAMERA_BASELINE,
  cameraExceedsCanvas,
  cameraStateAt,
  clampCameraTranslation,
  composeCameraAt,
  emptyCameraContext,
  FOCUS_MAX_SCALE,
  lookAtPct,
  requiredScaleForPan,
  resolveCameraKeyframes,
  safeLookAtRange,
  translationForLookAt,
  type CameraContext,
  type LayerAnchor,
} from "../src/camera.js";
import {
  activeTransitionsAt,
  applyTransitions,
  bellAmountAt,
  bellPhaseAt,
  glitchIntensityAt,
  morphBlurAt,
  morphOpacityAt,
  morphScaleAt,
  peakWindow,
  whipPanOffsetAt,
  whipPanStreakAt,
  wipeClipAt,
  wipeClips,
  WIPE_FULL_CLIP,
  type TransitionOverlay,
} from "../src/transitions.js";
import { PRESET_DEFAULTS, applyEmphasis, applyEntrance, applyExit } from "../src/presets.js";
import { renderCard } from "../src/layers/card.js";
import type { SceneSpec } from "@motionforge/scene-spec";

/**
 * Locks the two visual contracts that field renders violated:
 *
 * 1. Every temporary effect starts AND ends at exact identity (In → Active → Out).
 * 2. Every scene transition is a symmetric bell curve that leaves no residue.
 *
 * Both are asserted against the live GSAP timeline wherever possible, because a
 * pure-function test cannot catch a preset that simply forgets to call the
 * envelope.
 */

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sceneOf(input: SceneSpecInput): SceneSpec {
  return parseScene(input);
}

function rigAndMap(): { rig: HTMLElement; focus: Map<string, LayerAnchor> } {
  const rig = document.createElement("div");
  document.body.appendChild(rig);
  return { rig, focus: new Map<string, LayerAnchor>() };
}

/** Build the timeline for a scene with real keyframes/moves on a real rig. */
function buildCamera(scene: SceneSpec, rig: HTMLElement, focus: Map<string, LayerAnchor>): gsap.core.Timeline {
  const tl = gsap.timeline({ paused: true });
  tl.to({}, { duration: scene.durationMs / 1000 }, 0);
  // `applyCamera` installs the single per-frame composition: keyframes, moves,
  // drift and transitions in one pass, then the viewport clamp. There is no
  // separate clamp hook any more — one writer, one owner.
  applyCamera(tl, scene, rig, { ...emptyCameraContext(), layerAnchors: focus });
  return tl;
}

const emphasisNames = Object.keys(PRESET_DEFAULTS).filter(
  (name) => name === "pulseGlow" || name === "floatIdle" || name === "lightSweep" || name === "cameraShakeImpact"
) as Array<"pulseGlow" | "floatIdle" | "lightSweep" | "cameraShakeImpact">;

// ---------------------------------------------------------------------------
// 1. the envelope planner itself
// ---------------------------------------------------------------------------

describe("envelope planning", () => {
  it("spends the first and last 20% on dedicated ramps", () => {
    const plan = planEnvelope(4, 1.2);
    expect(plan.rampInSec).toBeCloseTo(4 * ENVELOPE_RAMP_FRACTION, 5);
    expect(plan.rampOutSec).toBeCloseTo(4 * ENVELOPE_RAMP_FRACTION, 5);
    expect(plan.rampInSec).toBeGreaterThan(0);
    expect(plan.rampOutSec).toBeGreaterThan(0);
  });

  it("tiles the window exactly — ramps plus cycles can never overrun the end", () => {
    for (const window of [0.5, 1, 2.4, 4, 7.3, 12]) {
      const plan = planEnvelope(window, 1.6);
      const covered =
        plan.rampInSec + plan.halfCycles * plan.halfCycleSec + plan.holdSec + plan.rampOutSec;
      expect(covered).toBeCloseTo(window, 5);
      expect(plan.rampOutStartSec).toBeLessThanOrEqual(window + 1e-9);
      expect(plan.rampInSec).toBeGreaterThan(0);
      expect(plan.rampOutSec).toBeGreaterThan(0);
    }
  });

  it("uses an EVEN repeat count so the yoyo block finishes on the peak", () => {
    for (const window of [1, 2.4, 4, 9]) {
      const plan = planEnvelope(window, 1.2);
      expect(plan.repeats % 2).toBe(0);
      // an even `repeat` means an ODD number of traversals: peak → base → peak
      expect(plan.halfCycles % 2).toBe(1);
    }
  });

  it("degenerates to pure ramps when the window is too short for a cycle", () => {
    const plan = planEnvelope(0.1, 2.4);
    expect(plan.halfCycles).toBe(0);
    // each ramp takes half the window, so they still meet exactly in the middle
    expect(plan.rampInSec).toBeCloseTo(0.05, 6);
    expect(plan.rampOutSec).toBeCloseTo(0.05, 6);
    expect(plan.rampOutStartSec).toBeCloseTo(plan.rampInSec, 6);
    expect(plan.windowSec).toBeCloseTo(0.1, 6);
  });

  it("reports zero amplitude at both ends and a positive amplitude inside", () => {
    const plan = planEnvelope(4, 1.2);
    expect(envelopeAmplitudeAt(0, plan)).toBeCloseTo(0, 6);
    expect(envelopeAmplitudeAt(1, plan)).toBeCloseTo(0, 6);
    let peak = 0;
    for (let p = 0; p <= 1; p += 0.01) peak = Math.max(peak, envelopeAmplitudeAt(p, plan));
    expect(peak).toBeGreaterThan(0.9);
  });

  it("is symmetric about the midpoint of the ramp regions", () => {
    const plan = planEnvelope(4, 1.2);
    for (const p of [0.05, 0.1, 0.15, 0.19]) {
      expect(envelopeAmplitudeAt(p, plan)).toBeCloseTo(envelopeAmplitudeAt(1 - p, plan), 6);
    }
  });

  it("never exceeds the peak", () => {
    const plan = planEnvelope(3, 0.9);
    for (let p = 0; p <= 1; p += 0.005) {
      const a = envelopeAmplitudeAt(p, plan);
      expect(a).toBeGreaterThanOrEqual(-1e-9);
      expect(a).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe("shake decay", () => {
  it("is exactly zero at both ends and bounded inside", () => {
    expect(shakeDecayAt(0)).toBe(0);
    expect(shakeDecayAt(1)).toBe(0);
    let peak = 0;
    for (let p = 0; p <= 1; p += 0.002) peak = Math.max(peak, Math.abs(shakeDecayAt(p)));
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("decays monotonically in energy as the impact settles", () => {
    const early = Math.max(...[0.05, 0.1, 0.15, 0.2, 0.25].map((p) => Math.abs(shakeDecayAt(p))));
    const late = Math.max(...[0.75, 0.8, 0.85, 0.9, 0.95].map((p) => Math.abs(shakeDecayAt(p))));
    expect(late).toBeLessThan(early);
  });

  it("samples densely enough to look like an impact, not a blur", () => {
    expect(SHAKE_SAMPLES).toBeGreaterThanOrEqual(12);
  });
});

// ---------------------------------------------------------------------------
// 2. emphasis presets on a live timeline
// ---------------------------------------------------------------------------

describe("emphasis presets return to exact identity", () => {
  /**
   * `lightSweep` is an overlay, not a transform on the element, so its
   * "returned to identity" state is `opacity: 0`. The other three own a
   * transform and must land back on exact rest values.
   */
    const TRANSFORM_PRESETS = ["pulseGlow", "floatIdle"] as const;

  it.each(TRANSFORM_PRESETS)("%s starts and ends at the baseline on the live timeline", (name) => {
    const el = document.createElement("div");
    const rig = document.createElement("div");
    document.body.append(el, rig);
    const tl = gsap.timeline({ paused: true });
    const startMs = 1000;
    const endMs = 5000;
    applyEmphasis(tl, { name }, {
      el,
      sweepHost: el,
      startMs,
      endMs,
      rig,
      unitStaggerMs: 0,
    });

    const window = (endMs - startMs) / 1000;
    tl.seek(startMs / 1000, false);
    const atStart = {
      y: Number(gsap.getProperty(el, "y")),
      scale: Number(gsap.getProperty(el, "scale")),
      rotation: Number(gsap.getProperty(rig, "rotation")),
      x: Number(gsap.getProperty(rig, "x")),
    };

    tl.seek((startMs + endMs) / 2000, false);
    // mid-window the effect must actually be doing something
    const midScale = Number(gsap.getProperty(el, "scale"));
    const midY = Number(gsap.getProperty(el, "y"));
    const midRotation = Number(gsap.getProperty(rig, "rotation"));

    tl.seek(endMs / 1000, false);
    const atEnd = {
      y: Number(gsap.getProperty(el, "y")),
      scale: Number(gsap.getProperty(el, "scale")),
      rotation: Number(gsap.getProperty(rig, "rotation")),
      x: Number(gsap.getProperty(rig, "x")),
    };

    expect(window).toBeGreaterThan(0);
    // identity at the start
    expect(atStart.y).toBeCloseTo(0, 4);
    expect(atStart.scale).toBeCloseTo(1, 4);
    expect(atStart.rotation).toBeCloseTo(0, 4);
    expect(atStart.x).toBeCloseTo(0, 4);
    // identity at the end — this is the assertion that failed in the field
    expect(atEnd.y).toBeCloseTo(0, 3);
    expect(atEnd.scale).toBeCloseTo(1, 3);
    expect(atEnd.rotation).toBeCloseTo(0, 3);
    expect(atEnd.x).toBeCloseTo(0, 3);

    // …and the window is not a no-op: something moved in between
    const moved =
      Math.abs(midScale - 1) > 1e-4 ||
      Math.abs(midY) > 0.05 ||
      Math.abs(midRotation) > 1e-4;
    expect(moved).toBe(true);
  });

  /**
   * `cameraShakeImpact` is a CAMERA move, and the camera has exactly one writer.
   * The emphasis no longer tweens the rig (that was a competing writer — the same
   * class of defect as the camera double-pump); the composition owns the decay
   * now, so it is asserted there.
   */
  it("cameraShakeImpact rings around the camera pose and returns to it", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "shake",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 6000,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
      camera: { keyframes: [{ at: 0, scale: 1.2, xPct: 50, yPct: 44 }] },
    } as SceneSpecInput);
    const shake = { atSec: 1, windowSec: 1, strength: 1 };
    const ctx: CameraContext = { ...emptyCameraContext(), layerAnchors: new Map(), shakes: [shake] };

    const baseline = composeCameraAt(scene, 0.2, ctx);
    const atStart = composeCameraAt(scene, 1, ctx);
    expect(atStart.scale).toBeCloseTo(baseline.scale, 6);
    expect(atStart.roll).toBeCloseTo(baseline.roll, 6);

    // mid-window the decay is doing something — on top of the keyframed pose
    const mid = composeCameraAt(scene, 1.5, ctx);
    expect(Math.abs(mid.scale - baseline.scale)).toBeGreaterThan(0.0005);
    expect(Math.abs(mid.roll - baseline.roll)).toBeGreaterThan(0.005);

    // and the pan is a real displacement, not a no-op
    expect(Math.abs(mid.xPct - baseline.xPct)).toBeGreaterThan(0.05);

    const atEnd = composeCameraAt(scene, 2, ctx);
    expect(atEnd.scale).toBeCloseTo(baseline.scale, 6);
    expect(atEnd.roll).toBeCloseTo(baseline.roll, 6);
  });

  it("pulses mid-window and leaves no scale or shadow residue at the end", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const rig = document.createElement("div");
    const tl = gsap.timeline({ paused: true });
    applyEmphasis(tl, { name: "pulseGlow" }, {
      el, sweepHost: el, startMs: 0, endMs: 3000, rig, unitStaggerMs: 0,
    });

    tl.seek(1.5, false);
    expect(Number(gsap.getProperty(el, "scale"))).not.toBeCloseTo(1, 3);

    tl.seek(3, false);
    // back on the baseline
    expect(Number(gsap.getProperty(el, "scale"))).toBeCloseTo(1, 3);
    // …and no shadow / filter was left hanging on the element
    const shadow = el.style.boxShadow;
    expect(shadow === "" || /0px 0px 0px rgba\(0, ?0, ?0, ?0\)/.test(shadow)).toBe(true);
    const filter = el.style.filter;
    expect(filter === "" || filter === "none" || filter === "blur(0px)").toBe(true);
  });

  it("unwinds a shadow peak back to its neutral value (structural guarantee)", () => {
    // The identity map covers the string-valued properties, so a preset that
    // peaks a shadow can never strand it on the element.
    const identity = identityOf({ scale: 1.03, boxShadow: "0px 0px 30px rgba(125,211,252,0.9)" });
    expect(identity.scale).toBe(1);
    expect(identity.boxShadow).toBe("0px 0px 0px rgba(0,0,0,0)");
    const withFilter = identityOf({ filter: "blur(10px)" });
    expect(withFilter.filter).toBe("none");
  });

  it("hides the lightSweep band completely before and after its window", () => {
    const host = document.createElement("div");
    const rig = document.createElement("div");
    const tl = gsap.timeline({ paused: true });
    // the sweep lasts the emphasis window: 1000 → 3000 ms
    applyEmphasis(tl, { name: "lightSweep", durationMs: 2000 }, {
      el: host, sweepHost: host, startMs: 1000, endMs: 3000, rig, unitStaggerMs: 0,
    });
    const sweep = host.querySelector<HTMLElement>(".mf-sweep");
    expect(sweep).not.toBeNull();
    const opacity = (): number => Number(sweep!.style.opacity || gsap.getProperty(sweep!, "opacity"));

    tl.seek(0, false);
    expect(opacity()).toBeCloseTo(0, 4);
    tl.seek(2, false); // midpoint: fully lit
    expect(opacity()).toBeGreaterThan(0.5);
    tl.seek(3.1, false);
    expect(opacity()).toBeCloseTo(0, 4);
  });

  it("gives the lightSweep band a screen blend and pure light stops (never dark)", () => {
    const host = document.createElement("div");
    const rig = document.createElement("div");
    const tl = gsap.timeline({ paused: true });
    applyEmphasis(tl, { name: "lightSweep" }, {
      el: host, sweepHost: host, startMs: 0, endMs: 2000, rig, unitStaggerMs: 0,
    });
    const sweep = host.querySelector<HTMLElement>(".mf-sweep") as HTMLElement;
    expect(sweep.style.mixBlendMode).toBe("screen");
    expect(sweep.style.pointerEvents).toBe("none");
    // a dark stop would dim the bar underneath — the blocky-band defect
    expect(sweep.style.background).not.toMatch(/rgba\(\s*0\s*,\s*0\s*,\s*0/);
    expect(sweep.style.background).not.toContain("#000");
    expect(sweep.style.background).toContain("#ffffff");
  });

  it("clips the lightSweep band to the element it sweeps", () => {
    const host = document.createElement("div");
    const rig = document.createElement("div");
    const tl = gsap.timeline({ paused: true });
    applyEmphasis(tl, { name: "lightSweep" }, {
      el: host, sweepHost: host, startMs: 0, endMs: 2000, rig, unitStaggerMs: 0,
    });
    const clip = host.querySelector<HTMLElement>(".mf-sweep-clip") as HTMLElement;
    expect(clip).not.toBeNull();
    expect(clip.style.overflow).toBe("hidden");
    expect(clip.style.pointerEvents).toBe("none");
    // the band lives INSIDE the clip, so it can never spill onto the background
    expect(clip.querySelector(".mf-sweep")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. camera keyframe inheritance + viewport safety
// ---------------------------------------------------------------------------

describe("camera keyframe inheritance", () => {
  it("inherits every omitted field from the previous keyframe", () => {
    const resolved = resolveCameraKeyframes([
      { at: 0, scale: 1.2 },
      { at: 1000, xPct: 40 },
      { at: 2000, roll: 5 },
    ]);
    expect(resolved[0]).toMatchObject({ at: 0, scale: 1.2, xPct: 50, yPct: 50, roll: 0 });
    expect(resolved[1]).toMatchObject({ at: 1000, scale: 1.2, xPct: 40, yPct: 50, roll: 0 });
    expect(resolved[2]).toMatchObject({ at: 2000, scale: 1.2, xPct: 40, yPct: 50, roll: 5 });
  });

  it("starts from the documented baseline, not from zero", () => {
    const [first] = resolveCameraKeyframes([{ at: 500, yPct: 30 }]);
    expect(first).toMatchObject({ scale: 1, xPct: 50, roll: 0, pitch: 0, yaw: 0 });
    expect(CAMERA_BASELINE).toMatchObject({ scale: 1, xPct: 50, yPct: 50, roll: 0, pitch: 0, yaw: 0 });
  });

  it("resolves the pose in effect at a timestamp, with the authored ease", () => {
    const kfs = [{ at: 0, scale: 1 }, { at: 2000, scale: 1.5 }];
    expect(cameraStateAt(kfs, 0).scale).toBe(1);
    // the default ease is power2.inOut, so the midpoint of the segment is 0.5
    expect(cameraStateAt(kfs, 1000).scale).toBeCloseTo(1.25, 6);
    expect(cameraStateAt(kfs, 2000).scale).toBe(1.5);
    expect(cameraStateAt(kfs, 9999).scale).toBe(1.5);
  });

  it("writes the inherited pose onto the rig at a mid-tween seek", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "cam",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
      camera: { keyframes: [{ at: 0, scale: 1.2, xPct: 50 }, { at: 2000, xPct: 46 }] },
    } as SceneSpecInput);
    const { rig, focus } = rigAndMap();
    const tl = buildCamera(scene, rig, focus);
    tl.seek(2, false);
    // the second keyframe omits `scale`, so it must still be 1.2
    expect(Number(gsap.getProperty(rig, "scale"))).toBeCloseTo(1.2, 3);
    // …and the rig really looks at `xPct: 46` (the translate is expressed in
    // the SCALED frame, so it must be (50 − 46) · 1.2 = 4.8)
    expect(Number(gsap.getProperty(rig, "xPercent"))).toBeCloseTo(4.8, 3);
    expect(lookAtPct(1.2, Number(gsap.getProperty(rig, "xPercent")))).toBeCloseTo(46, 3);
    // `xPct: 46` is inside the safe range at 1.2× (41.67 – 58.33), so the
    // viewport clamp must leave it alone
    expect(rig.dataset.mfCameraClamped).toBeUndefined();
  });
});

describe("camera viewport safety", () => {
  it("never clamps below scale 1 (nothing is exposed there)", () => {
    const r = clampCameraPan(0.8, 0, 0);
    expect(r.clamped).toBe(false);
    expect(r.xPct).toBe(0);
  });

  it("clamps a pan that would expose void, and reports it", () => {
    // xPct 0 at scale 1.2 → safe range is [41.67, 58.33]
    const r = clampCameraPan(1.2, 0, 50);
    expect(r.clamped).toBe(true);
    expect(r.xPct).toBeCloseTo(50 / 1.2, 5);
    expect(r.yPct).toBe(50);
  });

  it("leaves an in-range pan alone", () => {
    const r = clampCameraPan(1.45, 50, 50);
    expect(r.clamped).toBe(false);
  });

  it("computes the safe range that the engine reports as a warning", () => {
    const check = cameraExceedsCanvas({ scale: 1.4, xPct: 0, yPct: 50 });
    expect(check.x).toBe(true);
    expect(check.y).toBe(false);
    expect(check.safeX[0]).toBeCloseTo(50 / 1.4, 6);
    expect(check.safeX[1]).toBeCloseTo(100 - 50 / 1.4, 6);
  });

  it("clamps the live rig so an off-canvas keyframe never renders black void", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "void",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
      camera: { keyframes: [{ at: 0, scale: 1.4 }, { at: 2000, xPct: 0 }] },
    } as SceneSpecInput);
    const { rig, focus } = rigAndMap();
    const tl = buildCamera(scene, rig, focus);
    tl.seek(2, false);
    // the RENDERED look-at must be inside the safe band
    const lookAt = lookAtPct(1.4, Number(gsap.getProperty(rig, "xPercent")));
    expect(lookAt).toBeGreaterThanOrEqual(50 / 1.4 - 1e-3);
    // …and the pixel-space limit must hold exactly: |ΔX| ≤ w·(S−1)/2
    const limit = 50 * (1.4 - 1);
    expect(Math.abs(Number(gsap.getProperty(rig, "xPercent")))).toBeLessThanOrEqual(limit + 1e-6);
    expect(rig.dataset.mfCameraClamped).toBe("1");
    // the authored (unclamped) pose is still reported, so the metadata can say
    // what the author asked for next to what was rendered
    expect(Number(rig.dataset.mfCameraUnclampedX)).toBeCloseTo(0, 2);
  });

  it("clears the clamp flag when the pose is back in bounds", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "ok",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
      camera: { keyframes: [{ at: 0, scale: 1 }] },
    } as SceneSpecInput);
    const { rig, focus } = rigAndMap();
    const tl = buildCamera(scene, rig, focus);
    tl.seek(1, false);
    expect(rig.dataset.mfCameraClamped).toBeUndefined();
  });
});

describe("camera move envelopes", () => {
  it("splits a move into ramp-in / hold / ramp-out", () => {
    const plan = planCameraEnvelope(2);
    expect(plan.inSec).toBeCloseTo(2 * 0.28, 5);
    expect(plan.outSec).toBeCloseTo(2 * 0.28, 5);
    expect(plan.holdSec).toBeCloseTo(2 - 1.12, 5);
    expect(plan.inSec + plan.holdSec + plan.outSec).toBeCloseTo(2, 6);
  });

  it("returns focusTarget to the exact pre-move scale when its window ends", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "focus",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 6000,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
      camera: { keyframes: [{ at: 0, scale: 1 }], moves: [{ move: "slowPushIn", at: 1000, durationMs: 2000 }] },
    } as SceneSpecInput);
    const { rig, focus } = rigAndMap();
    const tl = buildCamera(scene, rig, focus);

    tl.seek(0.999, false);
    const before = Number(gsap.getProperty(rig, "scale"));
    tl.seek(2, false);
    const peak = Number(gsap.getProperty(rig, "scale"));
    expect(peak).toBeGreaterThan(before + 0.05);

    // the defect: the old rig sat at the peak forever after the move ended
    tl.seek(3.5, false);
    expect(Number(gsap.getProperty(rig, "scale"))).toBeCloseTo(before, 2);
  });

  it("returns slowPushIn to the rest pose even after the scene has moved on", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "push",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 6000,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
      camera: { moves: [{ move: "slowPushIn", at: 500, durationMs: 1500, strength: 2 }] },
    } as SceneSpecInput);
    const { rig, focus } = rigAndMap();
    const tl = buildCamera(scene, rig, focus);
    tl.seek(5, false);
    expect(Number(gsap.getProperty(rig, "scale"))).toBeCloseTo(1, 3);
  });

  it("settles the rig shake to zero after a shakeImpact move", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "shake",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 6000,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
      camera: { moves: [{ move: "shakeImpact", at: 500, durationMs: 600 }] },
    } as SceneSpecInput);
    const { rig, focus } = rigAndMap();
    const tl = buildCamera(scene, rig, focus);
    tl.seek(0.55, false);
    expect(Math.abs(Number(gsap.getProperty(rig, "rotation")))).toBeGreaterThan(0);
    tl.seek(1.5, false);
    expect(Number(gsap.getProperty(rig, "rotation"))).toBeCloseTo(0, 3);
  });
});

// ---------------------------------------------------------------------------
// 4. transitions: the 2-phase bell curve
// ---------------------------------------------------------------------------

const KINDS = ["wipe", "whipPan", "glitch", "morph"] as const;

describe.each(KINDS)("%s transition bell curve", (kind) => {
  it("declares a peak window with the in-phase first", () => {
    const { inEnd, outStart } = peakWindow(kind);
    expect(inEnd).toBeGreaterThan(0);
    expect(inEnd).toBeLessThanOrEqual(0.5);
    expect(outStart).toBeGreaterThanOrEqual(0.5);
    expect(outStart).toBeLessThan(1);
    expect(outStart).toBeGreaterThanOrEqual(inEnd);
  });

  it("reads as in → peak → out", () => {
    expect(bellPhaseAt(kind, 0)).toBe("in");
    expect(bellPhaseAt(kind, 0.25)).toBe("in");
    expect(bellPhaseAt(kind, 0.5)).toBe("peak");
    expect(bellPhaseAt(kind, 0.75)).toBe("out");
    expect(bellPhaseAt(kind, 1)).toBe("out");
  });

  it("is zero at both ends and one at the midpoint", () => {
    expect(bellAmountAt(kind, 0)).toBeCloseTo(0, 6);
    expect(bellAmountAt(kind, 1)).toBeCloseTo(0, 6);
    expect(bellAmountAt(kind, 0.5)).toBeCloseTo(1, 6);
  });

  it("is monotonic up to the peak and monotonic back down", () => {
    const { inEnd } = peakWindow(kind);
    for (let p = 0; p < inEnd - 1e-6; p += 0.01) {
      expect(bellAmountAt(kind, p + 0.01)).toBeGreaterThanOrEqual(bellAmountAt(kind, p) - 1e-9);
    }
    const { outStart } = peakWindow(kind);
    for (let p = outStart + 1e-6; p < 1; p += 0.01) {
      expect(bellAmountAt(kind, p + 0.01)).toBeLessThanOrEqual(bellAmountAt(kind, p) + 1e-9);
    }
  });
});

describe("wipe geometry", () => {
  it("starts fully clipped away and ends fully revealed", () => {
    for (const dir of ["left", "right", "up", "down"] as const) {
      expect(wipeClipAt(dir, 0)).toBe(wipeClips(dir).entering);
      expect(wipeClipAt(dir, 1)).toBe(wipeClips(dir).leaving);
    }
  });

  it("fully covers the frame at the midpoint (the seam swap is invisible)", () => {
    for (const dir of ["left", "right", "up", "down"] as const) {
      expect(wipeClipAt(dir, 0.5)).toBe(WIPE_FULL_CLIP);
      expect(wipeClips(dir).full).toBe(WIPE_FULL_CLIP);
    }
  });

  it("wipes and exits along the two different edges of its direction", () => {
    const left = wipeClips("left");
    expect(left.entering).toBe("inset(0px 100% 0px 0px)"); // grows left → right
    expect(left.leaving).toBe("inset(0px 0px 0px 100%)"); // retreats to the left
    const right = wipeClips("right");
    expect(right.entering).toBe("inset(0px 0px 0px 100%)");
    expect(right.leaving).toBe("inset(0px 100% 0px 0px)");
  });
});

describe("whipPan geometry", () => {
  // The whip throws the stage a FULL half-frame out and back — the pan needs
  // headroom the camera then has to buy (`|x| ≤ 50·(S−1)`), and a half-frame is
  // what makes the wrap at the midpoint read as a cut rather than a slide.
  it("ramps to ±50% and comes back to exactly zero", () => {
    expect(whipPanOffsetAt(0, "left")).toBeCloseTo(0, 6);
    expect(whipPanOffsetAt(1, "left")).toBeCloseTo(0, 6);
    expect(Math.abs(whipPanOffsetAt(0.5, "left"))).toBeCloseTo(50, 6);
    expect(Math.abs(whipPanOffsetAt(0.5, "right"))).toBeCloseTo(50, 6);
  });

  it("flips sign across the midpoint wrap", () => {
    expect(Math.sign(whipPanOffsetAt(0.49, "left"))).toBe(-1);
    expect(Math.sign(whipPanOffsetAt(0.51, "left"))).toBe(1);
  });

  it("ramps streaks 0 → 1 → 0", () => {
    expect(whipPanStreakAt(0)).toBeCloseTo(0, 6);
    expect(whipPanStreakAt(0.5)).toBeCloseTo(1, 6);
    expect(whipPanStreakAt(1)).toBeCloseTo(0, 6);
  });
});

describe("glitch geometry", () => {
  it("peaks in the middle and decays to nothing", () => {
    expect(glitchIntensityAt(0, 0.6)).toBeCloseTo(0, 6);
    expect(glitchIntensityAt(0.5, 0.6)).toBeCloseTo(0.6, 6);
    expect(glitchIntensityAt(1, 0.6)).toBeCloseTo(0, 6);
  });
});

describe("morph geometry", () => {
  it("expands to envelop the frame, then dissolves to nothing", () => {
    expect(morphScaleAt(0)).toBeCloseTo(0, 6);
    expect(morphScaleAt(0.5)).toBeCloseTo(1.05, 6);
    expect(morphOpacityAt(0)).toBeCloseTo(0, 6);
    expect(morphOpacityAt(0.5)).toBeCloseTo(1, 6);
    expect(morphOpacityAt(1)).toBeCloseTo(0, 6);
  });

  it("resolves the frosted blur to exactly 0px", () => {
    expect(morphBlurAt(0)).toBeCloseTo(0, 6);
    expect(morphBlurAt(0.5)).toBeCloseTo(24, 6);
    expect(morphBlurAt(1)).toBeCloseTo(0, 6);
  });
});

// ---------------------------------------------------------------------------
// 5. transitions on the live timeline
// ---------------------------------------------------------------------------

describe("transitions leave no residue on the live timeline", () => {
  function transitionScene(kind: (typeof KINDS)[number]): SceneSpec {
    return sceneOf({
      schemaVersion: 1,
      name: `tr-${kind}`,
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 6000,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
      transitions: [kind === "glitch" ? { kind, at: 2000, durationMs: 800, intensity: 0.8 } : { kind, at: 2000, durationMs: 800 }] as never,
    } as SceneSpecInput);
  }

  it.each(KINDS)("%s overlay is hidden before, live during, hidden after", (kind) => {
    const rig = document.createElement("div");
    const tl = gsap.timeline({ paused: true });
    applyTransitions(tl, transitionScene(kind), rig);
    const overlay = rig.lastElementChild as HTMLElement;

    tl.seek(1, false);
    expect(overlay.style.display).toBe("none");
    tl.seek(2.4, false);
    expect(overlay.style.display).toBe("block");
    tl.seek(5, false);
    expect(overlay.style.display).toBe("none");
  });

  it.each(KINDS)("%s leaves the rig transform clean after the window", (kind) => {
    const rig = document.createElement("div");
    const tl = gsap.timeline({ paused: true });
    applyTransitions(tl, transitionScene(kind), rig);
    tl.seek(2.4, false);
    tl.seek(5.5, false);
    const transform = String(gsap.getProperty(rig, "xPercent"));
    expect(Number(transform) || 0).toBeCloseTo(0, 3);
    expect(Number(gsap.getProperty(rig, "skewX")) || 0).toBeCloseTo(0, 3);
  });

  it("wipe is 100% covering the seam at the exact midpoint", () => {
    const rig = document.createElement("div");
    const tl = gsap.timeline({ paused: true });
    applyTransitions(tl, transitionScene("wipe"), rig);
    const cover = rig.lastElementChild as HTMLElement;
    tl.seek(2.4, false);
    const clip = String(gsap.getProperty(cover, "clipPath"));
    expect(clip).toBe("inset(0px 0px 0px 0px)");
  });

  it("reports active transitions and their phase from the overlay registry", () => {
    const rig = document.createElement("div");
    const tl = gsap.timeline({ paused: true });
    const overlays: TransitionOverlay[] = applyTransitions(tl, transitionScene("morph"), rig);
    expect(overlays).toHaveLength(1);
    expect(activeTransitionsAt(overlays, 1000)).toHaveLength(0);
    // 2200ms of an 800ms window starting at 2000ms → p = 0.25 → phase "in"
    const mid = activeTransitionsAt(overlays, 2200);
    expect(mid).toHaveLength(1);
    expect(mid[0]).toMatchObject({ kind: "morph", phase: "in" });
    expect(activeTransitionsAt(overlays, 5000)).toHaveLength(0);
  });

  it("reports the peak phase at the midpoint", () => {
    const rig = document.createElement("div");
    const tl = gsap.timeline({ paused: true });
    const overlays = applyTransitions(tl, transitionScene("wipe"), rig);
    const atPeak = activeTransitionsAt(overlays, 2400);
    expect(atPeak[0]?.phase).toBe("peak");
    expect(atPeak[0]?.progressPct).toBeCloseTo(50, 0);
  });
});

// ---------------------------------------------------------------------------
// 6. masks never reflow text; blurFadeIn never leaves a blurred raster
// ---------------------------------------------------------------------------

describe("mask presets animate clip-path, never layout", () => {
  function entranceFor(name: "maskRevealWipe" | "collapseMask", direction: "ltr" | "rtl" = "ltr"): gsap.core.Timeline {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const tl = gsap.timeline({ paused: true });
    const ref = { name, durationMs: 800 } as const;
    const target = {
      el,
      sweepHost: el,
      startMs: 0,
      endMs: 4000,
      rig: document.createElement("div"),
      unitStaggerMs: 0,
      direction,
    };
    if (name === "maskRevealWipe") applyEntrance(tl, ref, target);
    else applyExit(tl, ref, target);
    return tl;
  }

  it("maskRevealWipe drives clip-path only", () => {
    const tl = entranceFor("maskRevealWipe");
    // walk every tween on the timeline and assert none of them writes a layout
    // property: animating width/height forces a re-wrap every frame, which is
    // how "Render pipeline" became "ender pipeline" in a delivered render
    const walk = (child: gsap.core.Animation): gsap.core.Animation[] => {
      const timeline = child as gsap.core.Timeline;
      const nested = typeof timeline.getChildren === "function" ? timeline.getChildren(false, true, false) : [];
      return [child, ...nested.flatMap(walk)];
    };
    const animations = tl.getChildren(false, true, true).flatMap(walk);
    expect(animations.length).toBeGreaterThan(0);
    for (const animation of animations) {
      const vars = (animation as gsap.core.Tween).vars ?? {};
      for (const key of ["width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight"]) {
        expect(vars).not.toHaveProperty(key);
      }
      if ("clipPath" in vars) expect(String(vars.clipPath)).toMatch(/^inset\(/);
    }
  });

  it("maskRevealWipe wipes along the reading direction, mirrored for RTL", () => {
    const ltr = document.createElement("div");
    document.body.appendChild(ltr);
    const rtl = document.createElement("div");
    document.body.appendChild(rtl);
    const build = (el: HTMLElement, direction: "ltr" | "rtl"): gsap.core.Timeline => {
      const tl = gsap.timeline({ paused: true });
      applyEntrance(tl, { name: "maskRevealWipe", durationMs: 800 }, {
        el, sweepHost: el, startMs: 0, endMs: 4000, rig: document.createElement("div"), unitStaggerMs: 0, direction,
      });
      return tl;
    };
    const tlLtr = build(ltr, "ltr");
    const tlRtl = build(rtl, "rtl");

    tlLtr.seek(0.001, false);
    tlRtl.seek(0.001, false);
    // LTR opens from the left edge (its leading edge); RTL from the right
    expect(String(gsap.getProperty(ltr, "clipPath"))).toBe("inset(-15% 100% -20% 0%)");
    expect(String(gsap.getProperty(rtl, "clipPath"))).toBe("inset(-15% 0% -20% 100%)");

    tlLtr.seek(0.8, false);
    tlRtl.seek(0.8, false);
    expect(String(gsap.getProperty(ltr, "clipPath"))).toBe("inset(-15% 0% -20% 0%)");
    expect(String(gsap.getProperty(rtl, "clipPath"))).toBe("inset(-15% 0% -20% 0%)");
  });

  it("collapseMask retreats along the reading direction and uses clip-path only", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const tl = gsap.timeline({ paused: true });
    applyExit(tl, { name: "collapseMask", durationMs: 600 }, {
      el, sweepHost: el, startMs: 0, endMs: 4000, rig: document.createElement("div"), unitStaggerMs: 0, direction: "ltr",
    });
    // the exit occupies the last 600ms of the window
    tl.seek(3.4, false);
    expect(String(gsap.getProperty(el, "clipPath"))).toBe("inset(-15% 0% -20% 0%)");
    tl.seek(3.7, false); // halfway through
    // closing from the left edge (the leading edge for LTR)
    expect(String(gsap.getProperty(el, "clipPath"))).toBe("inset(-15% 50% -20% 0%)");
    tl.seek(4, false);
    // fully closed: the box keeps its layout size, only the visible slice goes
    expect(String(gsap.getProperty(el, "clipPath"))).toBe("inset(-15% 100% -20% 0%)");
    expect(el.style.width).toBe("");
    expect(el.style.height).toBe("");
  });

  it("mirrors collapseMask for RTL text", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const tl = gsap.timeline({ paused: true });
    applyExit(tl, { name: "collapseMask", durationMs: 600 }, {
      el, sweepHost: el, startMs: 0, endMs: 4000, rig: document.createElement("div"), unitStaggerMs: 0, direction: "rtl",
    });
    tl.seek(3.7, false);
    // RTL retreats from the right edge
    expect(String(gsap.getProperty(el, "clipPath"))).toBe("inset(-15% 0% -20% 50%)");
  });

  it("drops the blur filter the instant blurFadeIn completes (no compositor snap)", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const tl = gsap.timeline({ paused: true });
    applyEntrance(tl, { name: "blurFadeIn", durationMs: 900 }, {
      el, sweepHost: el, startMs: 0, endMs: 4000, rig: document.createElement("div"), unitStaggerMs: 0,
    });
    tl.seek(0.45, false);
    expect(el.style.filter).toMatch(/blur\(/);
    expect(el.style.filter).not.toMatch(/blur\(0px\)$/);
    tl.seek(0.9, false);
    // `blur(0px)` leaves the element on a filtered layer; `none` removes it
    expect(el.style.filter).toBe("none");
  });

  it("keeps the progressBar percentage inside the card box", () => {
    // guarded structurally in card.ts: the label and the percentage share one
    // flex header row, so neither can escape the card width
    const ctx = {
      tl: gsap.timeline({ paused: true }),
      content: document.createElement("div"),
      stageContent: document.createElement("div"),
      rig: document.createElement("div"),
      width: 1920,
      height: 1080,
      layerAtSec: 0,
      fonts: new Map(),
      resolveAsset: () => "",
      assetKind: () => "image" as const,
      lottieData: () => ({}),
      registerSeekable: () => undefined,
      assetIntrinsicSize: () => undefined,
      scene: {} as never,
    };
    renderCard(
      {
        id: "bar",
        type: "card",
        at: 0,
        position: { xPct: 50, yPct: 50 },
        variant: {
          variant: "progressBar",
          label: "Encoding pipeline",
          value: 94,
          fill: "#22d3ee",
          showPercentage: true,
          widthPx: 640,
        },
      } as never,
      ctx as never
    );
    const host = ctx.content.firstElementChild as HTMLElement;
    const col = host.firstElementChild as HTMLElement;
    const header = col.firstElementChild as HTMLElement;
    expect(header.style.display).toBe("flex");
    expect(header.style.justifyContent).toBe("space-between");
    // label first, percentage second, both inside the same row
    const kids = Array.from(header.children);
    expect(kids).toHaveLength(2);
    expect(kids[0]?.textContent).toBe("Encoding pipeline");
    // `flex: none` → `flex-grow/shrink/basis: 0 0 auto`, so the number keeps its
    // intrinsic width and never stretches the label out of the card
    const pct = kids[1] as HTMLElement;
    expect(pct.style.flexGrow).toBe("0");
    expect(pct.style.flexShrink).toBe("0");
    expect(pct.style.fontVariantNumeric).toBe("tabular-nums");
    expect(pct.style.direction).toBe("ltr");
    // col = header row + track only: the percentage is no longer a sibling of
    // the track, so it cannot sit past the bar's right edge
    expect(Array.from(col.children)).toHaveLength(2);
    expect(header.style.width).toBe("100%");
    expect(header.style.overflow).toBe("hidden");
  });
});

// ---------------------------------------------------------------------------
// 7. graceful layer auto-exit guard
// ---------------------------------------------------------------------------

describe("layer auto-exit guard", () => {
  const base = { id: "l", type: "background", at: 0, variant: { variant: "solid", color: "#000" } };

  it("triggers for a bounded layer that ends well before the scene", () => {
    expect(needsAutoExit({ ...base, duration: 3000 }, 10000)).toBe(true);
  });

  it("does not trigger when an explicit exit is authored", () => {
    expect(needsAutoExit({ ...base, duration: 3000, exit: { name: "scaleDownFade" } }, 10000)).toBe(false);
  });

  it("does not trigger for an unbounded layer (it runs to scene end)", () => {
    expect(needsAutoExit({ ...base }, 10000)).toBe(false);
  });

  it("ignores a tail within the 50 ms guard band (nothing to fade)", () => {
    expect(needsAutoExit({ ...base, duration: 9970 }, 10000)).toBe(false);
    expect(needsAutoExit({ ...base, duration: 9940 }, 10000)).toBe(true);
  });

  it("places the fade in the tail of the layer's own window", () => {
    const w = autoExitWindow({ ...base, at: 1000, duration: 4000 }, 10000);
    expect(w.endMs).toBe(5000);
    expect(w.startMs).toBe(5000 - AUTO_EXIT_FADE_MS);
    expect(w.endMs - w.startMs).toBe(AUTO_EXIT_FADE_MS);
  });

  it("never runs the fade past the layer's own end", () => {
    const w = autoExitWindow({ ...base, at: 0, duration: 100 }, 10000);
    expect(w.endMs).toBe(100);
    expect(w.startMs).toBeGreaterThanOrEqual(0);
  });
});