import { gsap } from "gsap";
import { sceneSeams, type SceneSpec } from "@motionforge/scene-spec";
import { centerPctInRig } from "./stage.js";
import { CAMERA_ENVELOPE_IN_FRACTION, planCameraEnvelope, SHAKE_WOBBLES, shakeDecayAt } from "./envelope.js";
import { easeToGsap } from "./presets.js";
import { glitchRigOffsetPxAt, whipPanOffsetAt } from "./transitions.js";
import type { CameraKeyframe, CameraMove } from "@motionforge/scene-spec";

/**
 * 2.5D virtual camera — ONE deterministic composition per frame.
 *
 * ## The model (every camera bug traces back to it)
 *
 * The rig's transform is `translate(xPercent%, yPercent%) scale(S)`, applied
 * about the canvas centre. The translate happens in the PARENT's (unscaled)
 * units, so a rig translation of `p` percent moves the content by `p/100·width`
 * pixels — and, because the scale is applied first, the canvas point that ends
 * up at the viewport centre is
 *
 *     lookAtPct = 50 − xPercent / S
 *
 * Two consequences drive everything below:
 *
 * 1. **Centring a canvas point `c`** needs `xPercent = (50 − c)·S`, not
 *    `50 − c`. The old mapping was only correct at `S = 1`, so a zoomed camera
 *    never actually looked where it was told to.
 * 2. **No black void** requires the content to still cover the viewport:
 *
 *        |ΔX| ≤ width · (S − 1) / 2      (and likewise for Y)
 *
 *    which in percent is `|xPercent| ≤ 50 · (S − 1)`, or equivalently a
 *    look-at inside `[50 − 50(1−1/S), 50 + 50(1−1/S)]`.
 *
 * ## Why there is exactly ONE writer
 *
 * THE DEFECT THIS FIXES ("double-pump" zoom, field audit of `scene-01`):
 * the camera used to be driven by *competing GSAP tweens* on the same element
 * — a full-length keyframe tween that re-wrote `scale: 1` on every frame, plus
 * a move's ramp-in / hold / ramp-out pair. GSAP only re-renders a child while
 * the playhead is inside its window, so the instant a move's ramp-in tween
 * ended, the permanent keyframe tween put `scale: 1` back — a one-frame snap
 * out of 1.47× — and then the ramp-out tween started from its own explicit peak
 * and slammed it back in. Measured: 1.47 at 2.9 s → **1.00 at 3.0 s** → 1.47
 * again at 3.6 s.
 *
 * No amount of tween bookkeeping fixes that: the write order is GSAP's, not
 * ours, and it changes with seek order. So the camera no longer uses tweens at
 * all. Every frame runs ONE pure function
 *
 *     State(t) = Clamp( Keyframes(t) ⊕ MergedMoves(t) ⊕ Drift(t) ⊕ Stage(t) )
 *
 * where `⊕` is composition (not overwrite) and `Stage` is the transition
 * contribution (a `whipPan` translates the stage and buys the headroom that
 * pan needs; a `glitch` jitters it). The result is written once, through
 * `gsap.quickSetter`, so the pose on screen is always exactly the pose the
 * metadata reports — and it is the same pose for the same `t` no matter how
 * the renderer got there.
 *
 * The composition is also *pure and exported*, which is what makes the curve
 * testable: `composeCameraAt(scene, t, ctx)` is the whole camera.
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
 * How much zoom a `focusTarget` may add, as a DELTA on the current scale.
 *
 * The old move solved for the zoom a target *needs* (`1/(1 − |d|/50)`) and
 * applied it: centring a logo 16% above centre demanded 1.47×, which threw the
 * headline sitting 35% below it straight off the bottom of the frame. A focus
 * is a nudge, not a crane — the brief caps it at `clamp(strength,.05,1)·0.14`,
 * i.e. at most ~1.14×, so the composition around the target survives.
 */
export const FOCUS_SCALE_DELTA = 0.14;

/**
 * The fraction of the safe pan headroom a `focusTarget` may spend.
 *
 * Full headroom centres the target but leaves nothing on either side of it; 80%
 * keeps the layer's neighbours (a headline under a logo) comfortably inside the
 * frame, which is the whole point of a focus.
 */
export const FOCUS_PAN_HEADROOM_FRACTION = 0.8;

/**
 * How long after a move ends it will still hold its final pose before ramping
 * down, looking for the act cut it belongs to.
 *
 * A move whose window closes mid-act used to ramp its zoom all the way back to
 * 1.0 and then let the NEXT keyframe zoom in again — the same "pump" seen from
 * the other side. Holding the final pose into the cut means the frame changes
 * act at full framing and crossfades out of it, instead of breathing.
 */
export const MOVE_SEAM_HOLD_MS = 1000;

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
 * ease the scene authored — so a `focusTarget` can compute its delta against
 * the pose it will actually compose with.
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
 * `|offset| ≤ 50(1 − 1/S)` ⟹  `S ≥ 1 / (1 − |offset|/50)`.
 *
 * Kept for diagnosis (the engine's warning still quotes the zoom a *keyframe*
 * would need) — but a `focusTarget` deliberately does NOT use it: see
 * {@link FOCUS_SCALE_DELTA}.
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
 * `focusTarget` move itself had to limit (a target further from centre than the
 * focus budget can cover). Without it, `clampedVoid` would read `false` on
 * exactly the frames where the framing quietly departed from the brief.
 */
export const CAMERA_REQUESTED_X = "mfCameraRequestedX";
export const CAMERA_REQUESTED_Y = "mfCameraRequestedY";

/** A `focusTarget` whose requested look-at exceeded the focus budget at its peak. */
export interface FocusClamp {
  startSec: number;
  endSec: number;
  requested: { xPct: number; yPct: number };
  applied: { xPct: number; yPct: number };
}

/** Everything the composition needs that is decided at BUILD time. */
export interface CameraRuntimeInfo {
  focusClamps: FocusClamp[];
  /** the seam midpoint each move holds its final pose into, by move index */
  moveHolds: Array<{ holdToSec: number; seamMidSec: number | null }>;
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

/** A `cameraShakeImpact` emphasis, already resolved to its absolute window. */
export interface RigShake {
  atSec: number;
  windowSec: number;
  strength: number;
}

/** Build-time facts the per-frame composition needs. */
export interface CameraContext {
  layerAnchors: ReadonlyMap<string, LayerAnchor>;
  shakes: readonly RigShake[];
  widthPx: number;
  heightPx: number;
}

export function emptyCameraContext(): CameraContext {
  return { layerAnchors: new Map(), shakes: [], widthPx: 1920, heightPx: 1080 };
}

// ---------------------------------------------------------------------------
// Composition terms — each one a pure function of t
// ---------------------------------------------------------------------------

/** Handheld drift, as a translation-percent offset. Identity at every period. */
export function driftOffsetAt(
  drift: SceneSpec["camera"]["drift"],
  timeSec: number
): { xPct: number; yPct: number } {
  if (!drift) return { xPct: 0, yPct: 0 };
  const amp = drift.amplitudePct;
  const period = Math.max(0.5, drift.periodMs / 1000);
  return {
    xPct: amp * Math.sin((2 * Math.PI * timeSec) / period),
    yPct: amp * 0.6 * Math.sin((2 * Math.PI * timeSec) / (period * 1.3)),
  };
}

/** The window a move occupies once its final pose is held into the act cut. */
export interface CameraMoveWindow {
  startSec: number;
  /** the authored end of the move */
  authoredEndSec: number;
  /** when the final pose may finally start releasing (the act cut, if any) */
  holdToSec: number;
  /** when the move is completely back at its pre-move contribution */
  endSec: number;
  seamMidSec: number | null;
  plan: ReturnType<typeof planCameraEnvelope>;
}

/**
 * When a move ends, look forward for the act cut it belongs to.
 *
 * A move whose window closes mid-act has to decide what to hand the next thing
 * on the timeline. The old answer was "ramp all the way back to 1.0", and since
 * the move's ramp-out finished *before* the next keyframe began its own zoom,
 * the frame visibly deflated to neutral and then inflated again: the same
 * "pump" seen from the other side (1.47 at 2.9 s → 1.00 at 3.0 s → 1.47 at 3.6 s).
 *
 * The answer is now "hold the framing you had until the cut, then let it go".
 * The release starts AT the seam midpoint — the one instant a transition is
 * guaranteed to be covering the frame — so the whole visible act plays at one
 * sustained framing and the release reads as part of the cut rather than as a
 * breath.
 */
export function planCameraMoveWindow(move: CameraMove, scene: SceneSpec): CameraMoveWindow {
  const startSec = move.at / 1000;
  const durationSec = Math.max(0, (move.durationMs ?? 800) / 1000);
  const authoredEndSec = startSec + durationSec;
  const seam = sceneSeams(scene)
    .map((s) => s.midMs / 1000)
    .filter((mid) => mid >= authoredEndSec - 1e-6 && mid <= authoredEndSec + MOVE_SEAM_HOLD_MS / 1000)
    .sort((a, b) => a - b)[0];
  const holdToSec = seam ?? authoredEndSec;

  // The envelope is authored in its own duration; only the HOLD is stretched to
  // reach the cut. `planCameraEnvelope` cannot express that — it derives the
  // hold from whatever is left after two 28% ramps of the TOTAL, which would
  // place the release at the wrong time entirely.
  //
  //   ramp-in: 28% of the authored duration
  //   hold:    from the end of the ramp-in to `holdToSec`
  //   release: 28% of the authored duration, starting AT `holdToSec`
  const inSec = durationSec * CAMERA_ENVELOPE_IN_FRACTION;
  const outSec = durationSec * CAMERA_ENVELOPE_IN_FRACTION;
  const holdSec = Math.max(0, holdToSec - startSec - inSec);
  return {
    startSec,
    authoredEndSec,
    holdToSec,
    endSec: holdToSec + outSec,
    seamMidSec: seam ?? null,
    plan: { inSec, holdSec, outSec, totalSec: inSec + holdSec + outSec },
  };
}

/** The move's envelope weight (0..1) at `timeSec`. */
export function moveWeightAt(window: CameraMoveWindow, timeSec: number): number {
  const { startSec, endSec, plan } = window;
  const elapsed = timeSec - startSec;
  if (elapsed <= 0 || elapsed >= endSec) return 0;
  if (plan.inSec <= 0) return 1;
  if (elapsed < plan.inSec) {
    const p = elapsed / plan.inSec;
    return 1 - Math.pow(2, -10 * p); // expo.out
  }
  if (elapsed < plan.inSec + plan.holdSec) return 1;
  const outElapsed = elapsed - plan.inSec - plan.holdSec;
  if (plan.outSec <= 0) return 0;
  // expo.inOut on the way down — the same curve family as the way up, so the
  // derivative is continuous at both ends of the hold
  const p = Math.min(1, outElapsed / plan.outSec);
  const eased =
    p === 0 ? 0 : p === 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2;
  return 1 - eased;
}

/** One move's contribution at full weight, in look-at space. */
export interface MoveContribution {
  scale: number;
  xPct: number;
  yPct: number;
  roll: number;
  /** the look-at this move ASKED for, when it had to limit its own pan */
  requestedLookAt?: { xPct: number; yPct: number };
}

const NO_CONTRIBUTION: MoveContribution = { scale: 0, xPct: 0, yPct: 0, roll: 0 };

/**
 * What a single move asks of the camera at its peak.
 *
 * `base` is the pose in effect where the move begins — the same analytic
 * state the keyframes produce, so a move always composes with the camera it
 * actually inherits rather than with whatever the rig happened to be holding.
 */
export function moveContributionAtPeak(
  move: CameraMove,
  base: ResolvedCameraState,
  ctx: CameraContext
): MoveContribution {
  const s = move.strength ?? 1;
  switch (move.move) {
    case "slowPushIn":
      return { ...NO_CONTRIBUTION, scale: 0.12 * s };
    case "whipPanLeft":
    case "whipPanRight": {
      const dir = move.move === "whipPanLeft" ? -1 : 1;
      return { ...NO_CONTRIBUTION, xPct: dir * 26 * s };
    }
    case "shakeImpact":
      return { ...NO_CONTRIBUTION, scale: 0.02 * s, roll: 1.6 * s };
    case "focusTarget": {
      const anchor = move.targetLayerId ? ctx.layerAnchors.get(move.targetLayerId) : undefined;
      if (!anchor) return NO_CONTRIBUTION;
      // GENTLE, COMPOSITION-SAFE FOCUS
      //
      // A bounded delta instead of the zoom the target "needs": centring a
      // logo 16% above the middle used to demand 1.47×, and at that zoom the
      // headline 35% below it fell off the bottom edge. A focus moves the eye,
      // it does not crop the composition away.
      const deltaScale = Math.min(1, Math.max(0.05, s)) * FOCUS_SCALE_DELTA;
      // …and the pan may only spend 80% of the headroom that zoom creates, so
      // the layer's neighbours stay comfortably inside the frame.
      const headroom = FOCUS_PAN_HEADROOM_FRACTION * safeLookAtRange(base.scale + deltaScale).half;
      const toward = (want: number): number => {
        const from = 50;
        const delta = want - from;
        return Math.abs(delta) <= headroom ? delta : Math.sign(delta) * headroom;
      };
      const xPct = toward(anchor.xPct);
      const yPct = toward(anchor.yPct);
      const applied = { xPct: base.xPct + xPct, yPct: base.yPct + yPct };
      const limited = applied.xPct !== anchor.xPct || applied.yPct !== anchor.yPct;
      return {
        ...NO_CONTRIBUTION,
        scale: deltaScale,
        xPct,
        yPct,
        ...(limited ? { requestedLookAt: { ...anchor } } : {}),
      };
    }
    default:
      return NO_CONTRIBUTION;
  }
}

/**
 * How the scene's transitions move the STAGE.
 *
 * A transition is a camera move too: a `whipPan` throws the whole stage aside
 * and must buy back the headroom that pan costs, or the frame goes black; a
 * `glitch` jitters it. Both used to be tweens on the rig, which fought the
 * keyframes; here they are just another composed term.
 */
export function stageOffsetAt(
  scene: SceneSpec,
  timeSec: number,
  poseScale: number,
  ctx: CameraContext
): { xPct: number; yPct: number; scale: number } {
  let xPct = 0;
  let scale = poseScale;
  for (const tr of (scene.transitions ?? [])) {
    const durSec = tr.durationMs / 1000;
    const elapsed = timeSec - tr.at / 1000;
    if (elapsed <= 0 || elapsed >= durSec || durSec <= 0) continue;
    const p = elapsed / durSec;
    if (tr.kind === "whipPan") {
      const offset = whipPanOffsetAt(p, tr.direction);
      xPct += offset;
      // the pan costs headroom: `|x| ≤ 50·(S−1)` ⟹ `S ≥ 1 + 2|x|/100`
      scale = Math.max(scale, 1 + (2 * Math.abs(offset)) / 100 * 1.02);
    } else if (tr.kind === "glitch") {
      xPct += (glitchRigOffsetPxAt(p, tr.intensity) / Math.max(1, ctx.widthPx)) * 100;
    }
  }
  return { xPct, yPct: 0, scale };
}

/**
 * Merge per-move contributions on one axis without ever letting them stack.
 *
 * WHY NOT AN AVERAGE: averaging the weighted contributions looks like the
 * obvious answer, but it is not monotone. With a strong move already at full
 * weight and a weaker one joining it, the weighted mean sits BELOW the strong
 * move's own contribution — so the act dips by exactly the amount the joining
 * move "contributed", and the curve reads as zoom → back off → zoom (the very
 * double tooth this pipeline exists to kill). Measured on the mixed-act scene:
 * `1.3800 → 1.3755 → 1.3780` in consecutive 50 ms samples.
 *
 * The dominant term wins instead. That is monotone in every contribution
 * (raising one move's weight never lowers the result), it can never exceed the
 * largest single move — so two overlapping `slowPushIn`s still read as one — and
 * a move with nothing overlapping it is untouched. The crossover is C0 rather
 * than C1: two moves of comparable size can meet at a velocity corner. That is
 * why overlapping moves are also flagged by the scene analyser: they are legal
 * but worth spacing out.
 */
export function blendDominant(values: readonly number[]): number {
  let best = 0;
  for (const value of values) {
    if (Math.abs(value) > Math.abs(best)) best = value;
  }
  return best;
}

/**
 * THE CAMERA.
 *
 * One pure function of `timeSec`. Nothing in it reads the DOM, so a seek to any
 * frame — from any direction — produces exactly the pose that frame has.
 */
export function composeCameraAt(
  scene: SceneSpec,
  timeSec: number,
  ctx: CameraContext
): ResolvedCameraState & {
  clamped: boolean;
  /** the look-at the composition asked for, before the canvas-bound clamp */
  wantXPct: number;
  wantYPct: number;
} {
  // 1. keyframes
  const keyframes = scene.camera?.keyframes ?? [];
  const base = cameraStateAt(keyframes, Math.round(timeSec * 1000));

  // 2. moves — each weighted by its own envelope, then blended so overlapping
  //    moves lead with the strongest one instead of doubling the peak
  const scales: number[] = [];
  const pansX: number[] = [];
  const pansY: number[] = [];
  const rolls: number[] = [];
  for (const move of (scene.camera?.moves ?? [])) {
    const weight = moveWeightAt(planCameraMoveWindow(move, scene), timeSec);
    if (weight <= 0) continue;
    const contribution = moveContributionAtPeak(move, base, ctx);
    scales.push(weight * contribution.scale);
    pansX.push(weight * contribution.xPct);
    pansY.push(weight * contribution.yPct);
    rolls.push(weight * contribution.roll);
  }
  const dScale = blendDominant(scales);
  const dxPct = blendDominant(pansX);
  const dyPct = blendDominant(pansY);
  const dRoll = blendDominant(rolls);

  // 3. drift (never touches scale, so it cannot perturb the zoom curve)
  const drift = driftOffsetAt(scene.camera?.drift, timeSec);

  // 4. emphasis shakes (also scale/roll only, and they ring around the pose)
  let shakeScale = 0;
  let shakeRoll = 0;
  let shakeXPct = 0;
  let shakeYPct = 0;
  const pxToPct = 100 / Math.max(1, ctx.widthPx);
  for (const shake of ctx.shakes) {
    if (shake.windowSec <= 0) continue;
    const p = (timeSec - shake.atSec) / shake.windowSec;
    if (p < 0 || p > 1) continue;
    const k = shakeDecayAt(p, SHAKE_WOBBLES) * shake.strength;
    shakeScale += k * 0.02;
    shakeRoll += k * 1.4;
    shakeXPct += k * 16 * pxToPct;
    shakeYPct += k * 12 * (100 / Math.max(1, ctx.heightPx));
  }

  // 5. compose, then clamp — in that order, because the clamp is about the
  //    FINAL pose, not about any individual term
  const composedScale = Math.max(0.05, base.scale + (dScale + shakeScale));
  const stage = stageOffsetAt(scene, timeSec, composedScale, ctx);

  const lookAtX = base.xPct + dxPct;
  const lookAtY = base.yPct + dyPct;
  const wantX = translationForLookAt(stage.scale, lookAtX) + drift.xPct + stage.xPct + shakeXPct;
  const wantY = translationForLookAt(stage.scale, lookAtY) + drift.yPct + stage.yPct + shakeYPct;

  const clamped = clampCameraTranslation(stage.scale, wantX, wantY);

  return {
    at: timeSec,
    scale: stage.scale,
    xPct: lookAtPct(stage.scale, clamped.xPercent),
    yPct: lookAtPct(stage.scale, clamped.yPercent),
    // what the composition ASKED for, before the canvas-bound clamp
    wantXPct: lookAtPct(stage.scale, wantX),
    wantYPct: lookAtPct(stage.scale, wantY),
    roll: base.roll + dRoll + shakeRoll,
    pitch: base.pitch,
    yaw: base.yaw,
    clamped: clamped.clamped,
  };
}

/** Where a move's own budget stopped short of the look-at it asked for. */
export function focusClampsForScene(scene: SceneSpec, ctx: CameraContext): FocusClamp[] {
  const out: FocusClamp[] = [];
  for (const move of (scene.camera?.moves ?? [])) {
    if (move.move !== "focusTarget") continue;
    const anchor = move.targetLayerId ? ctx.layerAnchors.get(move.targetLayerId) : undefined;
    if (!anchor) continue;
    const base = cameraStateAt(scene.camera?.keyframes ?? [], move.at);
    const contribution = moveContributionAtPeak(move, base, ctx);
    if (!contribution.requestedLookAt) continue;
    const window = planCameraMoveWindow(move, scene);
    out.push({
      startSec: window.startSec,
      endSec: window.holdToSec,
      requested: contribution.requestedLookAt,
      applied: { xPct: base.xPct + contribution.xPct, yPct: base.yPct + contribution.yPct },
    });  }
  return out;
}

// ---------------------------------------------------------------------------
// The single writer
// ---------------------------------------------------------------------------

/**
 * Install the one and only writer for the rig transform.
 *
 * Installed on the master timeline's `onUpdate`, which fires AFTER every child
 * has rendered — but that no longer matters for correctness, because nothing
 * else writes the rig's scale/translation any more. It matters only for
 * ordering: the pose must be the last thing applied in a frame.
 *
 * The write is SYNCHRONOUS (`gsap.quickSetter`) for the same reason as before:
 * `gsap.set` lands on the GLOBAL timeline one tick later, by which point the
 * next frame's composition has already overwritten it.
 */
export function applyCamera(
  tl: gsap.core.Timeline,
  scene: SceneSpec,
  rig: HTMLElement,
  ctx: CameraContext
): CameraRuntimeInfo {
  const focusClamps = focusClampsForScene(scene, ctx);
  const moveHolds = (scene.camera?.moves ?? []).map((move) => {
    const window = planCameraMoveWindow(move, scene);
    return { holdToSec: window.holdToSec, seamMidSec: window.seamMidSec };
  });

  rig.parentElement?.style.setProperty("perspective", `${scene.camera?.perspective ?? 1200}px`);

  const setScaleX = gsap.quickSetter(rig, "scaleX") as (value: number) => void;
  const setScaleY = gsap.quickSetter(rig, "scaleY") as (value: number) => void;
  const setX = gsap.quickSetter(rig, "xPercent") as (value: number) => void;
  const setY = gsap.quickSetter(rig, "yPercent") as (value: number) => void;
  const setRot = gsap.quickSetter(rig, "rotation") as (value: number) => void;
  const setRotX = gsap.quickSetter(rig, "rotationX") as (value: number) => void;
  const setRotY = gsap.quickSetter(rig, "rotationY") as (value: number) => void;

  const write = (timeSec: number): void => {
    const pose = composeCameraAt(scene, timeSec, ctx);
    // `quickSetter(rig, "scale")` is not usable: CSSPlugin expands the alias to
    // "scaleX,scaleY" and the setter then fails to parse that as a property
    // name. The uniform scale is written as both components instead.
    setScaleX(pose.scale);
    setScaleY(pose.scale);
    setX(translationForLookAt(pose.scale, pose.xPct));
    setY(translationForLookAt(pose.scale, pose.yPct));
    setRot(pose.roll);
    setRotX(pose.pitch);
    setRotY(pose.yaw);

    // report the pose BEFORE the clamp next to the pose that was rendered
    rig.dataset[CAMERA_UNCLAMPED_X] = String(round(pose.wantXPct));
    rig.dataset[CAMERA_UNCLAMPED_Y] = String(round(pose.wantYPct));

    const limited = noteFocusClamp(rig, timeSec, focusClamps);
    if (pose.clamped || limited) {
      rig.dataset[CAMERA_CLAMP_FLAG] = "1";
    } else {
      delete rig.dataset[CAMERA_CLAMP_FLAG];
    }
  };

  gsap.set(rig, { transformStyle: "preserve-3d" });
  delete rig.dataset[CAMERA_CLAMP_FLAG];

  const previous = tl.eventCallback("onUpdate");
  tl.eventCallback("onUpdate", function composedOnUpdate(this: gsap.core.Timeline) {
    write(this.time());
    if (typeof previous === "function") previous.call(this);
  });

  // frame 0 must already be correct before anything seeks
  write(0);

  return { focusClamps, moveHolds };
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
): boolean {
  const active = focusClamps.find((c) => timeSec >= c.startSec && timeSec < c.endSec);
  if (!active) {
    delete rig.dataset[CAMERA_REQUESTED_X];
    delete rig.dataset[CAMERA_REQUESTED_Y];
    return false;
  }
  rig.dataset[CAMERA_REQUESTED_X] = String(round(active.requested.xPct));
  rig.dataset[CAMERA_REQUESTED_Y] = String(round(active.requested.yPct));
  return true;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Kept for callers that only have the element (the measured fallback). */
export { centerPctInRig };
