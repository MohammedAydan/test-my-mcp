import { gsap } from "gsap";
import { centerPctInRig } from "./stage.js";
import { easeToGsap } from "./presets.js";
import type { SceneSpec } from "@motionforge/scene-spec";

/**
 * 2.5D virtual camera. Everything is tweened on the master timeline so seeking
 * stays deterministic. `xPct/yPct` name the canvas point the camera looks at
 * (50/50 = centered); content shifts by the inverse amount.
 */
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
  interface CamState { at: number; scale: number; xPct: number; yPct: number; roll: number; pitch: number; yaw: number; }
  let prev: CamState = { at: 0, scale: 1, xPct: 50, yPct: 50, roll: 0, pitch: 0, yaw: 0 };
  for (const kf of cam.keyframes) {
    const vars: gsap.TweenVars = {};
    if (kf.scale !== undefined) vars.scale = kf.scale;
    if (kf.xPct !== undefined) vars.xPercent = 50 - kf.xPct;
    if (kf.yPct !== undefined) vars.yPercent = 50 - kf.yPct;
    if (kf.roll !== undefined) vars.rotation = kf.roll;
    if (kf.pitch !== undefined) vars.rotationX = kf.pitch;
    if (kf.yaw !== undefined) vars.rotationY = kf.yaw;
    tl.to(rig, {
      ...vars,
      duration: Math.max(0, (kf.at - prev.at) / 1000),
      ease: easeToGsap(kf.ease ?? "power2.inOut"),
    }, prev.at / 1000);
    prev = {
      at: kf.at,
      scale: kf.scale ?? prev.scale,
      xPct: kf.xPct ?? prev.xPct,
      yPct: kf.yPct ?? prev.yPct,
      roll: kf.roll ?? prev.roll,
      pitch: kf.pitch ?? prev.pitch,
      yaw: kf.yaw ?? prev.yaw,
    };
  }

  // high-level moves compose on top of keyframes
  for (const mv of cam.moves) {
    const s = mv.strength ?? 1;
    const dur = (mv.durationMs ?? 800) / 1000;
    const at = mv.at / 1000;
    switch (mv.move) {
      case "slowPushIn":
        tl.to(rig, { scale: `+=${0.12 * s}`, duration: dur, ease: "sine.inOut" }, at);
        break;
      case "whipPanLeft":
      case "whipPanRight": {
        const dir = mv.move === "whipPanLeft" ? -1 : 1;
        // there-and-back slam with motion blur, restoring the rest pose
        tl.to(rig, { xPercent: `+=${dir * 26 * s}`, duration: dur / 2, ease: "power2.in" }, at);
        tl.to(rig, { xPercent: `-=${dir * 26 * s}`, duration: dur / 2, ease: "power2.out" }, at + dur / 2);
        break;
      }
      case "shakeImpact":
        tl.to(rig, { rotation: `+=${1.6 * s}`, duration: 0.05, repeat: 9, yoyo: true, ease: "none" }, at);
        tl.to(rig, { scale: `+=${0.02 * s}`, duration: 0.05, repeat: 9, yoyo: true, ease: "none" }, at);
        break;
      case "focusTarget": {
        const el = mv.targetLayerId ? layerFocus.get(mv.targetLayerId) : undefined;
        if (!el) break;
        const { xPct, yPct } = centerPctInRig(rig, el);
        tl.to(rig, {
          scale: 1.45 * s,
          xPercent: 50 - xPct,
          yPercent: 50 - yPct,
          duration: dur,
          ease: "power3.inOut",
        }, at);
        break;
      }
    }
  }
}
