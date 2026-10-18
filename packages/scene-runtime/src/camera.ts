import { gsap } from "gsap";
import { centerPctInRig } from "./stage.js";
import { applyDecayEnvelope, clampCameraPan, planCameraEnvelope, SHAKE_SAMPLES } from "./envelope.js";
import { easeToGsap } from "./presets.js";
import type { CameraKeyframe, SceneSpec } from "@motionforge/scene-spec";

/**
 * 2.5D virtual camera. Everything is tweened on the master timeline so seeking
 * stays deterministic. `xPct/yPct` name the canvas point the camera looks at
 * (50/50 = centered); content shifts by the inverse amount.
 */

/** The rig's neutral pose — the baseline every first keyframe inherits from. */
export const CAMERA_BASELINE = {
  at: 0,
  scale: 1,
  xPct: 50,
  yPct: 50,
  roll: 0,
  pitch: 0,
  yaw: 0,
} as const;

export interface ResolvedCameraState {
  at: number;
  scale: number;
  xPct: number;
  yPct: number;
  roll: number;
  pitch: number;
  yaw: number;
}

/**
 * Expand camera keyframes into fully-resolved states.
 *
 * The documented contract is that a keyframe inherits every field it omits from
 * the previous keyframe, starting from the neutral rig. That used to be only
 * *implicitly* true (GSAP left untouched properties alone), which broke the
 * moment a move or a non-linear seek moved the rig: the "inherited" field was
 * then whatever the rig happened to hold. Resolving the chain up front makes the
 * inheritance explicit, testable, and independent of playback order.
 */
export function resolveCameraKeyframes(keyframes: readonly CameraKeyframe[]): ResolvedCameraState[] {
  const out: ResolvedCameraState[] = [];
  let prev: ResolvedCameraState = { ...CAMERA_BASELINE };
  for (const kf of keyframes) {
    prev = {
      at: kf.at,
      scale: kf.scale ?? prev.scale,
      xPct: kf.xPct ?? prev.xPct,
      yPct: kf.yPct ?? prev.yPct,
      roll: kf.roll ?? prev.roll,
      pitch: kf.pitch ?? prev.pitch,
      yaw: kf.yaw ?? prev.yaw,
    };
    out.push(prev);
  }
  return out;
}

/** The resolved camera pose in effect at `timeMs` (last keyframe at or before it). */
export function cameraStateAt(keyframes: readonly CameraKeyframe[], timeMs: number): ResolvedCameraState {
  const resolved = resolveCameraKeyframes(keyframes);
  let state: ResolvedCameraState = { ...CAMERA_BASELINE };
  for (const candidate of resolved) {
    if (candidate.at > timeMs) break;
    state = candidate;
  }
  return state;
}

/** Whether the pose at (scale, xPct, yPct) exposes black void outside the canvas. */
export function cameraExceedsCanvas(state: { scale: number; xPct: number; yPct: number }): {
  x: boolean;
  y: boolean;
  safeX: [number, number];
  safeY: [number, number];
} {
  const safeX: [number, number] = state.scale > 1 ? [50 / state.scale, 100 - 50 / state.scale] : [0, 100];
  const safeY: [number, number] = state.scale > 1 ? [50 / state.scale, 100 - 50 / state.scale] : [0, 100];
  return {
    x: state.xPct < safeX[0] || state.xPct > safeX[1],
    y: state.yPct < safeY[0] || state.yPct > safeY[1],
    safeX,
    safeY,
  };
}

/** Dataset flag set while the live rig is being held inside the canvas bounds. */
export const CAMERA_CLAMP_FLAG = "mfCameraClamped";

/** Read the live camera state off the rig, after clamping. */
export function cameraStateFromRig(rig: HTMLElement): {
  scale: number;
  xPct: number;
  yPct: number;
  roll: number;
  yaw: number;
  pitch: number;
  clampedVoid: boolean;
} {
  const scale = Number(gsap.getProperty(rig, "scale")) || 1;
  const xPercent = Number(gsap.getProperty(rig, "xPercent")) || 0;
  const yPercent = Number(gsap.getProperty(rig, "yPercent")) || 0;
  return {
    scale,
    xPct: 50 - xPercent,
    yPct: 50 - yPercent,
    roll: Number(gsap.getProperty(rig, "rotation")) || 0,
    yaw: Number(gsap.getProperty(rig, "rotationY")) || 0,
    pitch: Number(gsap.getProperty(rig, "rotationX")) || 0,
    clampedVoid: rig.dataset[CAMERA_CLAMP_FLAG] === "1",
  };
}

export function applyCamera(
  tl: gsap.core.Timeline,
  scene: SceneSpec,
  rig: HTMLElement,
  layerFocus: Map<string, HTMLElement>
): void {
  const cam = scene.camera;
  const durationSec = scene.durationMs / 1000;

  rig.parentElement?.style.setProperty("perspective", `${cam.perspective}px`);
  gsap.set(rig, {
    scale: 1,
    xPercent: 0,
    yPercent: 0,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    transformStyle: "preserve-3d",
  });
  delete rig.dataset[CAMERA_CLAMP_FLAG];

  // subtle handheld drift (timeline-driven → deterministic under seek)
  if (cam.drift) {
    const amp = cam.drift.amplitudePct;
    const periodSec = Math.max(0.5, cam.drift.periodMs / 1000);
    const repeats = Math.max(1, Math.ceil(durationSec / periodSec) * 2);
    tl.to(rig, {
      xPercent: `+=${amp}`,
      duration: periodSec,
      ease: "sine.inOut",
      yoyo: true,
      repeat: repeats,
    }, 0);
    tl.to(rig, {
      yPercent: `+=${amp * 0.6}`,
      duration: periodSec * 1.3,
      ease: "sine.inOut",
      yoyo: true,
      repeat: Math.max(1, Math.ceil(durationSec / (periodSec * 1.3)) * 2),
    }, 0);
  }

  // canonical keyframes: each tween runs from the previous keyframe's state
  const resolved = resolveCameraKeyframes(cam.keyframes);
  let prev: ResolvedCameraState = { ...CAMERA_BASELINE };
  resolved.forEach((kf, index) => {
    const authored = cam.keyframes[index];
    tl.to(
      rig,
      {
        // every field is written on every tween — including the inherited ones
        // — so the pose is a pure function of the timeline position
        scale: kf.scale,
        xPercent: 50 - kf.xPct,
        yPercent: 50 - kf.yPct,
        rotation: kf.roll,
        rotationX: kf.pitch,
        rotationY: kf.yaw,
        duration: Math.max(0, (kf.at - prev.at) / 1000),
        ease: easeToGsap(authored?.ease ?? "power2.inOut"),
      },
      prev.at / 1000
    );
    prev = kf;
  });

  // high-level moves compose on top of keyframes. Every one of them is a
  // *temporary* effect: ramp in, hold, ramp back out — a move must never leave
  // the rig parked at its peak when its window closes.
  for (const mv of cam.moves) {
    const s = mv.strength ?? 1;
    const dur = Math.max(0, (mv.durationMs ?? 800) / 1000);
    const at = mv.at / 1000;
    const plan = planCameraEnvelope(dur);
    switch (mv.move) {
      case "slowPushIn":
        tl.to(rig, { scale: `+=${0.12 * s}`, duration: plan.inSec, ease: "expo.out" }, at);
        tl.to(rig, { scale: `-=${0.12 * s}`, duration: plan.outSec, ease: "expo.inOut" }, at + plan.inSec + plan.holdSec);
        break;
      case "whipPanLeft":
      case "whipPanRight": {
        const dir = mv.move === "whipPanLeft" ? -1 : 1;
        tl.to(rig, { xPercent: `+=${dir * 26 * s}`, duration: plan.inSec, ease: "power3.in" }, at);
        tl.to(rig, { xPercent: `-=${dir * 26 * s}`, duration: plan.outSec, ease: "power3.out" }, at + plan.inSec + plan.holdSec);
        break;
      }
      case "shakeImpact":
        applyDecayEnvelope(tl, rig, {
          at,
          windowSec: dur,
          amplitude: { rotation: 1.6 * s, scale: 0.02 * s },
          samples: SHAKE_SAMPLES,
        });
        break;
      case "focusTarget": {
        const el = mv.targetLayerId ? layerFocus.get(mv.targetLayerId) : undefined;
        if (!el) break;
        const { xPct, yPct } = centerPctInRig(rig, el);
        // relative to the resolved keyframe pose, so the move composes instead
        // of overwriting, and the ramp-out returns to that exact pose
        const dx = (50 - xPct) - (50 - prev.xPct);
        const dy = (50 - yPct) - (50 - prev.yPct);
        const ds = 1.45 * s - prev.scale;
        tl.to(rig, { scale: `+=${ds}`, xPercent: `+=${dx}`, yPercent: `+=${dy}`, duration: plan.inSec, ease: "expo.out" }, at);
        tl.to(rig, { scale: `-=${ds}`, xPercent: `-=${dx}`, yPercent: `-=${dy}`, duration: plan.outSec, ease: "expo.inOut" }, at + plan.inSec + plan.holdSec);
        break;
      }
    }
  }

  // Viewport clamp, rendered LAST so it observes the final composed pose of the
  // frame. `xPct: 0` at `scale: 1.2` would otherwise expose ~34% of the frame as
  // black void; clamped, it sits flush against the canvas edge.
  const guard = { tick: 0 };
  tl.to(
    guard,
    {
      tick: 1,
      duration: Math.max(0.001, durationSec),
      ease: "none",
      onUpdate: () => clampRigToCanvas(rig),
    },
    0
  );
}

function clampRigToCanvas(rig: HTMLElement): void {
  const scale = Number(gsap.getProperty(rig, "scale")) || 1;
  const xPercent = Number(gsap.getProperty(rig, "xPercent")) || 0;
  const yPercent = Number(gsap.getProperty(rig, "yPercent")) || 0;
  const clamped = clampCameraPan(scale, 50 - xPercent, 50 - yPercent);
  if (clamped.clamped) {
    gsap.set(rig, { xPercent: 50 - clamped.xPct, yPercent: 50 - clamped.yPct });
  }
  // The flag reports "the camera is pressed against the canvas edge", which is
  // the observable consequence of a pose that exceeded the canvas. It is
  // derived from the EFFECTIVE pose (always clamped), so it is stable under
  // any seek order — unlike "was a clamp applied this frame", which depends on
  // whether the previous tween happened to leave the rig in range.
  const margin = scale > 1 ? 50 / scale : 0;
  const atEdge =
    scale > 1 &&
    (Math.abs(clamped.xPct - margin) < CAMERA_EDGE_EPSILON ||
      Math.abs(clamped.xPct - (100 - margin)) < CAMERA_EDGE_EPSILON ||
      Math.abs(clamped.yPct - margin) < CAMERA_EDGE_EPSILON ||
      Math.abs(clamped.yPct - (100 - margin)) < CAMERA_EDGE_EPSILON);
  if (atEdge) {
    rig.dataset[CAMERA_CLAMP_FLAG] = "1";
  } else {
    delete rig.dataset[CAMERA_CLAMP_FLAG];
  }
}

/** Tolerance (in canvas percent) for "the camera is flush against the edge". */
export const CAMERA_EDGE_EPSILON = 0.05;