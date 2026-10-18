import { gsap } from "gsap";
import { centerPctInRig } from "./stage.js";
import { applyDecayEnvelope, planCameraEnvelope, SHAKE_SAMPLES } from "./envelope.js";
import { easeToGsap } from "./presets.js";
import type { CameraKeyframe, SceneSpec } from "@motionforge/scene-spec";

/**
 * 2.5D virtual camera.
 *
 * THE MODEL (one paragraph, because every camera bug traces back to it):
 *
 * The rig's transform is `translate(xPercent%, yPercent%) scale(S)`, applied
 * about the canvas centre. The translate happens in the PARENT's (unscaled)
 * units, so a rig translation of `p` percent moves the content by
 * `p/100 · width` pixels — and, because the scale is applied first, the
 * canvas point that ends up at the viewport centre is
 *
 *     lookAtPct = 50 − xPercent / S
 *
 * Two consequences drive everything below:
 *
 * 1. **Centring a canvas point `c`** needs `xPercent = (50 − c) · S`, not
 *    `50 − c`. The old mapping was only correct at `S = 1`, so a zoomed camera
 *    never actually looked where it was told to.
 * 2. **No black void** requires the content to still cover the viewport:
 *
 *        |ΔX| ≤ width · (S − 1) / 2      (and likewise for Y)
 *
 *    which in percent is `|xPercent| ≤ 50 · (S − 1)`, or equivalently a
 *    look-at inside `[50 − 50(1−1/S), 50 + 50(1−1/S)]`.
 *
 * The clamp at the bottom of this file enforces (2) on the FINAL composed
 * pose of every frame — keyframes, moves and drift together — and does so
 * SYNCHRONOUSLY, because a deferred write is a write the next tween
 * overwrites, and a camera that is corrected one frame late is a camera that
 * renders void.
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

/** The highest zoom a `focusTarget` may reach on its own. */
export const FOCUS_MAX_SCALE = 3;

/**
 * Expand camera keyframes into fully-resolved states.
 *
 * The documented contract is that a keyframe inherits every field it omits from
 * the previous keyframe, starting from the neutral rig. Resolving the chain up
 * front makes the inheritance explicit, testable, and independent of playback
 * order.
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

/**
 * The resolved camera pose in effect at `timeMs`, interpolated with the SAME
 * ease the runtime tween uses — so a `focusTarget` can compute its delta
 * against the pose it will actually compose with.
 */
export function cameraStateAt(keyframes: readonly CameraKeyframe[], timeMs: number): ResolvedCameraState {
  const resolved = resolveCameraKeyframes(keyframes);
  const chain: Array<{ from: ResolvedCameraState; to: ResolvedCameraState; ease: gsap.TweenVars["ease"] }> = [];
  let prev: ResolvedCameraState = { ...CAMERA_BASELINE };
  resolved.forEach((kf, index) => {
    chain.push({ from: prev, to: kf, ease: easeToGsap(keyframes[index]?.ease ?? "power2.inOut") });
    prev = kf;
  });
  if (chain.length === 0) return { ...CAMERA_BASELINE };

  for (const segment of chain) {
    if (timeMs < segment.from.at) return segment.from;
    if (timeMs <= segment.to.at) {
      const span = segment.to.at - segment.from.at;
      if (span <= 0) return segment.to;
      const raw = (timeMs - segment.from.at) / span;
      const easedFn = segment.ease as unknown as (p: number) => number;
      const p = typeof easedFn === "function" ? easedFn(raw) : raw;
      const lerp = (a: number, b: number): number => a + (b - a) * p;
      return {
        at: timeMs,
        scale: lerp(segment.from.scale, segment.to.scale),
        xPct: lerp(segment.from.xPct, segment.to.xPct),
        yPct: lerp(segment.from.yPct, segment.to.yPct),
        roll: lerp(segment.from.roll, segment.to.roll),
        pitch: lerp(segment.from.pitch, segment.to.pitch),
        yaw: lerp(segment.from.yaw, segment.to.yaw),
      };
    }
  }
  return chain[chain.length - 1]!.to;
}

/**
 * The safe look-at band at a given zoom: the canvas points the camera may
 * centre on without pushing the frame past the canvas edge.
 *
 *     safeHalfSpanPct = 50 · (1 − 1/S)
 */
export function safeLookAtRange(scale: number): { min: number; max: number; half: number } {
  const half = scale > 1 ? 50 * (1 - 1 / scale) : 0;
  return { min: 50 - half, max: 50 + half, half };
}

/** The rig translation (percent) that puts `targetPct` at the viewport centre. */
export function translationForLookAt(scale: number, targetPct: number): number {
  return (50 - targetPct) * scale;
}

/** The canvas point currently at the viewport centre, in percent. */
export function lookAtPct(scale: number, translationPercent: number): number {
  return 50 - translationPercent / Math.max(1e-6, scale);
}

/**
 * The smallest zoom at which `offsetPct` (the distance of the look-at point
 * from the canvas centre) is still reachable without exposing void.
 *
 * `|offset| ≤ 50(1 − 1/S)` ���  `S ≥ 1 / (1 − |offset|/50)`.
 */
export function requiredScaleForPan(offsetPct: number, cap: number = FOCUS_MAX_SCALE): number {
  const d = Math.min(49.999, Math.abs(offsetPct));
  const needed = 1 / (1 - d / 50);
  return Math.min(cap, needed);
}

/**
 * The pixel-space clamp on the rig translation.
 *
 *     |ΔX| ≤ width · (S − 1) / 2   ⟺   |xPercent| ≤ 50 · (S − 1)
 *
 * The limit is independent of the canvas size (both sides scale with it), and
 * it is exactly zero at `S = 1`: at that zoom the canvas fills the frame
 * precisely, so ANY pan would expose void.
 */
export function clampCameraTranslation(
  scale: number,
  xPercent: number,
  yPercent: number
): { xPercent: number; yPercent: number; clamped: boolean; limit: number } {
  const limit = 50 * Math.max(0, scale - 1);
  const cx = Math.min(limit, Math.max(-limit, xPercent));
  const cy = Math.min(limit, Math.max(-limit, yPercent));
  return {
    xPercent: cx,
    yPercent: cy,
    clamped: cx !== xPercent || cy !== yPercent,
    limit,
  };
}

/** Whether the pose at (scale, xPct, yPct) exposes black void outside the canvas. */
export function cameraExceedsCanvas(state: { scale: number; xPct: number; yPct: number }): {
  x: boolean;
  y: boolean;
  safeX: [number, number];
  safeY: [number, number];
} {
  const { min, max } = safeLookAtRange(state.scale);
  const safeX: [number, number] = [min, max];
  const safeY: [number, number] = [min, max];
  return {
    x: state.xPct < min - 1e-6 || state.xPct > max + 1e-6,
    y: state.yPct < min - 1e-6 || state.yPct > max + 1e-6,
    safeX,
    safeY,
  };
}

/** Dataset flag set while the live rig is being held inside the canvas bounds. */
export const CAMERA_CLAMP_FLAG = "mfCameraClamped";

/** Dataset attributes carrying the pose BEFORE the clamp was applied. */
export const CAMERA_UNCLAMPED_X = "mfCameraUnclampedX";
export const CAMERA_UNCLAMPED_Y = "mfCameraUnclampedY";

/**
 * The look-at a `focusTarget` ASKED for, when it could not be honoured.
 *
 * The final clamp reports poses it pinned itself; this reports a pan the
 * `focusTarget` move itself had to limit (a target on the canvas edge is
 * unreachable at any finite zoom). Without it, `clampedVoid` would read `false`
 * on exactly the frames where the framing quietly departed from the brief.
 */
export const CAMERA_REQUESTED_X = "mfCameraRequestedX";
export const CAMERA_REQUESTED_Y = "mfCameraRequestedY";

/** A `focusTarget` whose requested look-at exceeded the safe band at its peak. */
export interface FocusClamp {
  startSec: number;
  endSec: number;
  requested: { xPct: number; yPct: number };
  applied: { xPct: number; yPct: number };
}

/** Everything the clamp needs to know that is decided at BUILD time. */
export interface CameraRuntimeInfo {
  focusClamps: FocusClamp[];
}

/** Read the live camera state off the rig, after clamping. */
export function cameraStateFromRig(rig: HTMLElement): {
  scale: number;
  xPct: number;
  yPct: number;
  roll: number;
  yaw: number;
  pitch: number;
  clampedVoid: boolean;
  unclampedXPct: number;
  unclampedYPct: number;
} {
  const scale = Number(gsap.getProperty(rig, "scale")) || 1;
  const xPercent = Number(gsap.getProperty(rig, "xPercent")) || 0;
  const yPercent = Number(gsap.getProperty(rig, "yPercent")) || 0;
  const rawX = Number(rig.dataset[CAMERA_UNCLAMPED_X]);
  const rawY = Number(rig.dataset[CAMERA_UNCLAMPED_Y]);
  const askedX = Number(rig.dataset[CAMERA_REQUESTED_X]);
  const askedY = Number(rig.dataset[CAMERA_REQUESTED_Y]);
  const clamped = rig.dataset[CAMERA_CLAMP_FLAG] === "1";
  const renderedX = lookAtPct(scale, xPercent);
  const renderedY = lookAtPct(scale, yPercent);
  return {
    scale,
    // the TRUE look-at: the canvas point at the viewport centre
    xPct: renderedX,
    yPct: renderedY,
    roll: Number(gsap.getProperty(rig, "rotation")) || 0,
    yaw: Number(gsap.getProperty(rig, "rotationY")) || 0,
    pitch: Number(gsap.getProperty(rig, "rotationX")) || 0,
    clampedVoid: clamped,
    unclampedXPct: Number.isFinite(askedX)
      ? askedX
      : Number.isFinite(rawX)
        ? rawX
        : renderedX,
    unclampedYPct: Number.isFinite(askedY)
      ? askedY
      : Number.isFinite(rawY)
        ? rawY
        : renderedY,
  };
}

/** Where a layer's painted content is centred, in canvas percent. */
export interface LayerAnchor {
  xPct: number;
  yPct: number;
}

/**
 * A camera state expressed as the rig transform that realises it.
 *
 * Every camera tween is authored through this function, with EXPLICIT from and
 * to values. That matters more than it looks: a `to` tween (or a relative
 * `+=` value) resolves its start by reading the element's live state at first
 * render — and the viewport clamp writes to that same element, synchronously,
 * on every frame. Reading it back would feed the clamped value into the next
 * tween's start, so a keyframe whose authored start is 70% would silently
 * begin at the clamped 20% and interpolate to the wrong pose. `fromTo` never
 * looks at the element, so the clamp and the tweens cannot corrupt each other.
 */
export function rigVars(state: ResolvedCameraState): gsap.TweenVars {
  return {
    scale: state.scale,
    xPercent: translationForLookAt(state.scale, state.xPct),
    yPercent: translationForLookAt(state.scale, state.yPct),
    rotation: state.roll,
    rotationX: state.pitch,
    rotationY: state.yaw,
  };
}

/** Add a translation offset (in canvas percent) to a state. */
function withPan(state: ResolvedCameraState, dxPct: number, dyPct: number): ResolvedCameraState {
  return {
    ...state,
    scale: state.scale,
    // the offset is a *look-at* offset, so it is re-expressed in the new scale
    xPct: clampNum(lookAtPct(state.scale, translationForLookAt(state.scale, state.xPct) + dxPct), state.scale),
    yPct: clampNum(lookAtPct(state.scale, translationForLookAt(state.scale, state.yPct) + dyPct), state.scale),
  };
}

function clampNum(lookAt: number, scale: number): number {
  // no canvas point lives outside 0..100; a zoomed camera simply cannot see the rest
  return Math.min(100, Math.max(0, lookAt));
}

/** Scale a state by a delta factor and set its look-at point. */
function toState(
  base: ResolvedCameraState,
  scale: number,
  lookAtX: number,
  lookAtY: number
): ResolvedCameraState {
  return { ...base, scale, xPct: lookAtX, yPct: lookAtY };
}

export function applyCamera(
  tl: gsap.core.Timeline,
  scene: SceneSpec,
  rig: HTMLElement,
  layerAnchors: Map<string, LayerAnchor>
): CameraRuntimeInfo {
  const focusClamps: FocusClamp[] = [];
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

  // subtle handheld drift (timeline-driven → deterministic under seek).
  // The drift oscillates between the neutral pose and the neutral pose plus
  // the amplitude, so both ends are written explicitly.
  if (cam.drift) {
    const amp = cam.drift.amplitudePct;
    const periodSec = Math.max(0.5, cam.drift.periodMs / 1000);
    const repeats = Math.max(1, Math.ceil(durationSec / periodSec) * 2);
    tl.fromTo(
      rig,
      { xPercent: 0 },
      {
        xPercent: amp,
        duration: periodSec,
        ease: "sine.inOut",
        yoyo: true,
        repeat: repeats,
        immediateRender: false,
      },
      0
    );
    tl.fromTo(
      rig,
      { yPercent: 0 },
      {
        yPercent: amp * 0.6,
        duration: periodSec * 1.3,
        ease: "sine.inOut",
        yoyo: true,
        repeat: Math.max(1, Math.ceil(durationSec / (periodSec * 1.3)) * 2),
        immediateRender: false,
      },
      0
    );
  }

  // canonical keyframes: each tween runs from the previous keyframe's state.
  // EVERY field is written on EVERY tween — including the inherited ones — so
  // the pose is a pure function of the timeline position, and the from-value is
  // explicit so the clamp can never feed a stale pose back in.
  const resolved = resolveCameraKeyframes(cam.keyframes);
  let prev: ResolvedCameraState = { ...CAMERA_BASELINE };
  resolved.forEach((kf, index) => {
    const authored = cam.keyframes[index];
    tl.fromTo(
      rig,
      rigVars(prev),
      {
        ...rigVars(kf),
        duration: Math.max(0, (kf.at - prev.at) / 1000),
        ease: easeToGsap(authored?.ease ?? "power2.inOut"),
        immediateRender: false,
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
    // the pose the move composes with, at the moment the move starts
    const base = cameraStateAt(cam.keyframes, mv.at);
    /** ramp-in → peak, then peak → back to the exact pre-move pose */
    const toPeak = (peak: ResolvedCameraState, easeIn: string, easeOut: string): void => {
      tl.fromTo(rig, rigVars(base), { ...rigVars(peak), duration: plan.inSec, ease: easeIn, immediateRender: false }, at);
      tl.fromTo(
        rig,
        rigVars(peak),
        { ...rigVars(base), duration: plan.outSec, ease: easeOut, immediateRender: false },
        at + plan.inSec + plan.holdSec
      );
    };
    switch (mv.move) {
      case "slowPushIn":
        toPeak({ ...base, scale: base.scale + 0.12 * s }, "expo.out", "expo.inOut");
        break;
      case "whipPanLeft":
      case "whipPanRight": {
        const dir = mv.move === "whipPanLeft" ? -1 : 1;
        toPeak(withPan(base, dir * 26 * s, 0), "power3.in", "power3.out");
        break;
      }
      case "shakeImpact":
        // the decay rings AROUND the pre-move pose, it does not replace it —
        // without the bias the final sample would drive `scale` to 0
        applyDecayEnvelope(tl, rig, {
          at,
          windowSec: dur,
          amplitude: { rotation: 1.6 * s, scale: 0.02 * s },
          bias: { rotation: base.roll, scale: base.scale },
          samples: SHAKE_SAMPLES,
        });
        break;
      case "focusTarget": {
        const anchor = mv.targetLayerId ? layerAnchors.get(mv.targetLayerId) : undefined;
        if (!anchor) break;

        // SMART SCALE / PAN COUPLING
        //
        // Centring a point that sits `d` percent away from the canvas centre
        // needs a zoom of at least `1 / (1 − |d|/50)`; below that, honouring
        // the pan would push the frame past the canvas edge and expose black
        // void. So the move either boosts its zoom until the target is
        // reachable, or — if even the cap cannot reach it (a target on the very
        // edge of the canvas) — limits the pan to the safe band.
        const dX = 50 - anchor.xPct;
        const dY = 50 - anchor.yPct;
        const authoredPeak = 1.45 * s;
        const peakScale = Math.max(
          authoredPeak,
          requiredScaleForPan(Math.max(Math.abs(dX), Math.abs(dY)))
        );
        const { min, max } = safeLookAtRange(peakScale);
        const clampTo = (v: number): number => Math.min(max, Math.max(min, v));
        const lookAtX = clampTo(anchor.xPct);
        const lookAtY = clampTo(anchor.yPct);

        // a target the zoom cannot reach (it sits on the canvas edge) still has
        // to render safely, so the pan is limited — and that limitation is
        // reported, because the framing quietly departed from the brief
        if (lookAtX !== anchor.xPct || lookAtY !== anchor.yPct) {
          focusClamps.push({
            startSec: at,
            endSec: at + dur,
            requested: { xPct: anchor.xPct, yPct: anchor.yPct },
            applied: { xPct: lookAtX, yPct: lookAtY },
          });
        }

        toPeak(toState(base, peakScale, lookAtX, lookAtY), "expo.out", "expo.inOut");
        break;
      }
    }
  }
  return { focusClamps };
}

/**
 * The FINAL composed camera clamp.
 *
 * Installed on the master timeline's `onUpdate`, which fires after every child
 * has rendered — so it observes the pose that is actually rendered: keyframes,
 * moves and drift together.
 *
 * The write is SYNCHRONOUS (`gsap.quickSetter`), which is the whole point: a
 * deferred write (`gsap.set`, which lands on the global timeline) is applied
 * one tick later — by which time the next camera tween has already
 * overwritten it with the unclamped value. That is why a camera could be
 * "clamped" in the metadata while the screenshot still showed black void.
 */
export function applyViewportClamp(
  tl: gsap.core.Timeline,
  rig: HTMLElement,
  scene: SceneSpec,
  info: CameraRuntimeInfo = { focusClamps: [] }
): void {
  void scene;
  const setX = gsap.quickSetter(rig, "xPercent") as (value: number) => void;
  const setY = gsap.quickSetter(rig, "yPercent") as (value: number) => void;
  // The TIMELINE's own `onUpdate` is the only hook that is guaranteed to run
  // after every child tween has written its pose — a sibling tween does not
  // work, because GSAP keeps a timeline's children sorted by start time, and a
  // keyframe that starts later in the scene would render *after* the guard and
  // put the unclamped value straight back.
  const previous = tl.eventCallback("onUpdate");
  tl.eventCallback("onUpdate", function clampedOnUpdate(this: gsap.core.Timeline) {
    clampRigToCanvas(rig, setX, setY);
    noteFocusClamp(rig, this.time(), info.focusClamps);
    if (typeof previous === "function") previous.call(this);
  });
}

/**
 * Surface a `focusTarget` that had to limit its own pan.
 *
 * Runs after the pixel clamp so it can OR into the same flag rather than
 * racing it: the frame is `clampedVoid` if EITHER the rig was pinned or the
 * move quietly re-framed.
 */
function noteFocusClamp(
  rig: HTMLElement,
  timeSec: number,
  focusClamps: readonly FocusClamp[]
): void {
  const active = focusClamps.find((c) => timeSec >= c.startSec && timeSec < c.endSec);
  if (active) {
    rig.dataset[CAMERA_REQUESTED_X] = String(round(active.requested.xPct));
    rig.dataset[CAMERA_REQUESTED_Y] = String(round(active.requested.yPct));
    rig.dataset[CAMERA_CLAMP_FLAG] = "1";
  } else {
    delete rig.dataset[CAMERA_REQUESTED_X];
    delete rig.dataset[CAMERA_REQUESTED_Y];
  }
}

function clampRigToCanvas(
  rig: HTMLElement,
  setX: (value: number) => void,
  setY: (value: number) => void
): void {
  const scale = Number(gsap.getProperty(rig, "scale")) || 1;
  const xPercent = Number(gsap.getProperty(rig, "xPercent")) || 0;
  const yPercent = Number(gsap.getProperty(rig, "yPercent")) || 0;
  const clamped = clampCameraTranslation(scale, xPercent, yPercent);

  // remember the pose BEFORE the clamp, so `framesMeta` can report what the
  // author asked for next to what was actually rendered
  rig.dataset[CAMERA_UNCLAMPED_X] = String(round(lookAtPct(scale, xPercent)));
  rig.dataset[CAMERA_UNCLAMPED_Y] = String(round(lookAtPct(scale, yPercent)));

  if (clamped.xPercent !== xPercent) setX(clamped.xPercent);
  if (clamped.yPercent !== yPercent) setY(clamped.yPercent);

  if (clamped.clamped) {
    rig.dataset[CAMERA_CLAMP_FLAG] = "1";
  } else {
    delete rig.dataset[CAMERA_CLAMP_FLAG];
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Kept for callers that only have the element (the measured fallback). */
export { centerPctInRig };
