/**
 * Non-blocking scene diagnostics.
 *
 * Validation (`scene-spec`) answers "is this scene legal?". This answers "is
 * this scene *sane*?" — and it must answer without rejecting, because a scene
 * that renders a slightly wrong camera is still a scene an author wants to see.
 *
 * The one check that matters most in the field: a camera keyframe or move that
 * pans or zooms the canvas past its own edge. At `scale = s` the visible slice
 * is `100/s` percent wide, so a look-at point outside `[50/s, 100 − 50/s]`
 * exposes black void where the video should be. Report 1 shipped a frame that
 * was 34% black for exactly this reason.
 */
import {
  FOCUS_PAN_HEADROOM_FRACTION,
  FOCUS_SCALE_DELTA,
  FOCUS_MAX_SCALE,
  PEAK_COVER_MAX_MS,
  MAX_DEAD_GAP_MS as MAX_GAP,
  foregroundDeadGaps,
  requiredFocusScale,
  transitionPeakHoldMs,
  transitionPeakOverflowMs,
  type CameraKeyframe,
  type CameraMove,
  type SceneSpec,
} from "@motionforge/scene-spec";
import { resolveCanvasSize } from "@motionforge/scene-spec";

export const CAMERA_VIEWPORT_EXCEEDS_CANVAS = "CAMERA_VIEWPORT_EXCEEDS_CANVAS";
export const CAMERA_MOVE_OVERRUNS_SCENE = "CAMERA_MOVE_OVERRUNS_SCENE";

/**
 * A transition peak held longer than the cover allows.
 *
 * A cut may hide the stage only for the brief moment its cover is at full
 * extent; past ~120 ms the audience stops reading it as a transition and starts
 * reading it as a hold on an empty screen.
 */
export const TRANSITION_PEAK_TOO_LONG = "TRANSITION_PEAK_TOO_LONG";

/**
 * A run of screen time with no foreground content on it.
 *
 * A scene whose acts do not meet at their cut renders a dead dark frame, and no
 * individual field is illegal — so it is reported, and the runtime bridges it
 * where a transition is near enough to cover it.
 */
export const FOREGROUND_COVERAGE_GAP = "FOREGROUND_COVERAGE_GAP";

/**
 * A filtered / full-frame layer scaled far past the canvas.
 *
 * The renderer rasterises a filtered layer at its COMPOSITED size: a
 * full-frame mesh gradient keyframed to `scale: 10` is a 12 800 × 7 200
 * surface (~368 MB) for one frame, and a dense keyframe sweep that crosses
 * that scale repeatedly is what exhausts a 3.8 GB host. The keyframe COUNT is
 * cheap (measured ×1.01 at 200 keyframes); the VALUE is not.
 */
export const FILTERED_LAYER_LARGE_SCALE = "FILTERED_LAYER_LARGE_SCALE";

/** Above this scale a filtered layer is rasterised at more than 16× its area. */
export const MAX_SAFE_FILTERED_SCALE = 4;

export interface SceneWarning {
  /** stable machine code — an agent can branch on it without parsing prose */
  code: string;
  /** exact field path this refers to, e.g. `camera.keyframes.2.xPct` */
  path: string;
  message: string;
  /** structured payload for anything the message cannot express compactly */
  detail?: Record<string, unknown>;
}

interface CameraPose {
  at: number;
  scale: number;
  xPct: number;
  yPct: number;
  source: string;
  path: string;
}

const BASELINE: { scale: number; xPct: number; yPct: number } = { scale: 1, xPct: 50, yPct: 50 };

/** Expand keyframes into fully-inherited poses (same rule the runtime uses). */
export function resolvePoses(keyframes: readonly CameraKeyframe[]): CameraPose[] {
  const out: CameraPose[] = [];
  let scale = BASELINE.scale;
  let xPct = BASELINE.xPct;
  let yPct = BASELINE.yPct;
  keyframes.forEach((kf, index) => {
    scale = kf.scale ?? scale;
    xPct = kf.xPct ?? xPct;
    yPct = kf.yPct ?? yPct;
    out.push({ at: kf.at, scale, xPct, yPct, source: "keyframe", path: `camera.keyframes.${index}` });
  });
  return out;
}

/**
 * The safe look-at range for a given zoom. Below `scale = 1` the canvas is
 * smaller than the frame, so nothing is ever exposed and the range is the full
 * canvas.
 */
export function safePanRange(scale: number): { min: number; max: number; half: number } {
  if (!(scale > 1)) return { min: 0, max: 100, half: 0 };
  const margin = 50 / scale;
  const min = margin;
  const max = 100 - margin;
  return { min, max, half: (max - min) / 2 };
}

/** How much of the frame would be black void at this pose. */
export function voidPercent(scale: number, xPct: number, yPct: number): { x: number; y: number } {
  const { min, max } = safePanRange(scale);
  const axis = (v: number): number => {
    if (v < min) return min - v;
    if (v > max) return v - max;
    return 0;
  };
  return { x: axis(xPct), y: axis(yPct) };
}

/** The highest zoom a `focusTarget` will take on its own (mirrors the runtime). */
/**
 * The zoom budget a `focusTarget` is allowed to spend.
 *
 * This MUST stay in step with `FOCUS_SCALE_DELTA` in `scene-runtime`: a focus
 * is a bounded nudge (max +0.14× on the current zoom), never the zoom the
 * target mathematically needs. Solving for the latter centred a logo 16% above
 * the canvas middle at 1.47× and threw the headline 35% below it off the bottom
 * of the frame.
 */
/**
 * Every interior run of screen time with no foreground content, computed AFTER
 * the runtime's seam bridging — so a cut the runtime can cover does not show up
 * here, and what remains is a genuine hole.
 */
export function foregroundCoverageGaps(scene: SceneSpec): DeadGapReport[] {
  return foregroundDeadGaps(scene)
    .filter((gap) => gap.durationMs > MAX_GAP)
    .map((gap) => ({ fromMs: gap.fromMs, toMs: gap.toMs, durationMs: gap.durationMs }));
}

export interface DeadGapReport {
  fromMs: number;
  toMs: number;
  durationMs: number;
}

/**
 * The keyframe pose in effect at `timeMs`, linearly interpolated.
 *
 * A move composes on top of whatever the keyframes left behind AT THAT MOMENT,
 * not on top of the final keyframe — checking against the final pose reported
 * phantom warnings for moves that play while the camera is still moving.
 */
export function cameraPoseAt(keyframes: readonly CameraKeyframe[], timeMs: number): {
  scale: number;
  xPct: number;
  yPct: number;
} {
  const resolved = resolvePoses(keyframes);
  let prev = { at: 0, scale: BASELINE.scale, xPct: BASELINE.xPct, yPct: BASELINE.yPct };
  for (const pose of resolved) {
    if (timeMs < prev.at) return prev;
    if (timeMs <= pose.at) {
      const span = pose.at - prev.at;
      if (span <= 0) return pose;
      const p = (timeMs - prev.at) / span;
      return {
        scale: prev.scale + (pose.scale - prev.scale) * p,
        xPct: prev.xPct + (pose.xPct - prev.xPct) * p,
        yPct: prev.yPct + (pose.yPct - prev.yPct) * p,
      };
    }
    prev = pose;
  }
  return resolved.length > 0 ? resolved[resolved.length - 1]! : prev;
}

/** The authored anchor of a layer — the point `focusTarget` centres on. */
function layerAnchor(scene: SceneSpec, layerId: string | undefined): { xPct: number; yPct: number } | null {
  if (!layerId) return null;
  const layer = scene.layers.find((l) => l.id === layerId);
  if (!layer) return null;
  const position = "position" in layer ? layer.position : undefined;
  // full-bleed layers have no position; centring on one is a no-op
  return position ? { xPct: position.xPct, yPct: position.yPct } : { xPct: 50, yPct: 50 };
}

/**
 * Poses contributed by `camera.moves`. Moves are *temporary*: they ramp in,
 * hold, and ramp back out, so the extreme pose they reach is what must be
 * checked (not a permanent rest state).
 *
 * `focusTarget` is evaluated here for the first time: its pose depends on WHERE
 * the target sits, so a warning can only be raised once the move's own scale
 * boost and pan limit are modelled the same way the runtime models them.
 */
export function movePoses(scene: SceneSpec): CameraPose[] {
  return scene.camera.moves.map((move, index) => {
    const strength = move.strength ?? 1;
    const base = cameraPoseAt(scene.camera.keyframes, move.at);
    const pose = { at: move.at, source: "move", path: `camera.moves.${index}` as string };
    switch (move.move) {
      case "slowPushIn":
        return { ...pose, scale: base.scale + 0.12 * strength, xPct: base.xPct, yPct: base.yPct };
      case "focusTarget": {
        const anchor = layerAnchor(scene, move.targetLayerId);
        if (!anchor) return { ...pose, scale: 1 + FOCUS_SCALE_DELTA * strength, xPct: base.xPct, yPct: base.yPct };
        const delta = Math.min(1, Math.max(0.05, strength)) * FOCUS_SCALE_DELTA;
        const scale = base.scale + delta;
        // the pan may spend only 80% of the headroom the focus zoom creates
        const headroom = FOCUS_PAN_HEADROOM_FRACTION * safePanRange(scale).half;
        const limit = (v: number): number => {
          const want = 50 - v;
          return Math.abs(want) <= headroom ? v : 50 - Math.sign(want) * headroom;
        };
        return { ...pose, scale, xPct: limit(anchor.xPct), yPct: limit(anchor.yPct) };
      }
      case "whipPanLeft":
      case "whipPanRight": {
        const dir = move.move === "whipPanLeft" ? -1 : 1;
        const offset = dir * 26 * strength;
        return { ...pose, scale: base.scale, xPct: base.xPct - offset, yPct: base.yPct };
      }
      case "shakeImpact":
        return { ...pose, scale: base.scale + 0.02 * strength, xPct: base.xPct, yPct: base.yPct };
      default:
        return { ...pose, scale: base.scale, xPct: base.xPct, yPct: base.yPct };
    }
  });
}

/** A `focusTarget` whose target cannot be centred at any permitted zoom. */
export interface FocusReframe {
  moveIndex: number;
  at: number;
  requested: { xPct: number; yPct: number };
  applied: { xPct: number; yPct: number };
  scale: number;
}

/**
 * `focusTarget` moves the runtime has to re-frame.
 *
 * The runtime keeps the frame covered by boosting the zoom, and — when even the
 * boosted zoom cannot reach the target — by limiting the pan to the safe band.
 * A silent re-frame is a departure from the brief, so it is reported rather
 * than quietly rendered.
 */
export function focusReframes(scene: SceneSpec): FocusReframe[] {
  const out: FocusReframe[] = [];
  scene.camera.moves.forEach((move, moveIndex) => {
    if (move.move !== "focusTarget") return;
    const anchor = layerAnchor(scene, move.targetLayerId);
    if (!anchor) return;
    const strength = move.strength ?? 1;
    const offset = Math.max(Math.abs(50 - anchor.xPct), Math.abs(50 - anchor.yPct));
    const scale = Math.max(1.45 * strength, requiredFocusScale(offset));
    const { min, max } = safePanRange(scale);
    const limit = (v: number): number => Math.min(max, Math.max(min, v));
    const applied = { xPct: limit(anchor.xPct), yPct: limit(anchor.yPct) };
    if (applied.xPct === anchor.xPct && applied.yPct === anchor.yPct) return;
    out.push({ moveIndex, at: move.at, requested: { ...anchor }, applied, scale });
  });
  return out;
}

/** Every pose the camera can reach, keyframes first then moves. */
export function cameraPoses(scene: SceneSpec): CameraPose[] {
  return [...resolvePoses(scene.camera.keyframes), ...movePoses(scene)];
}

/**
 * Structured, NON-BLOCKING warnings for a scene. Returned alongside the stored
 * scene so `create_or_update_scene` can surface them without failing.
 */
/**
 * The expensive surfaces a layer can carry, or null when it carries none.
 * A `filmGrain` overlay is included even though the EXPORT offloads it: the
 * live preview still paints it, and a scaled overlay is the same raster cost.
 */
function expensiveSurface(layer: SceneSpec["layers"][number]): string | null {
  if (layer.type === "background" && layer.variant.variant === "meshGradient") {
    return "a meshGradient background";
  }
  if (layer.type === "background" && layer.variant.variant === "media") {
    return "a media background";
  }
  if (layer.type === "foregroundFX" && layer.effects.some((effect) => effect.kind === "filmGrain")) {
    return "a filmGrain overlay";
  }
  const blur = layer.filters?.blur;
  if (typeof blur === "number" && blur >= 8) return `blur(${blur}px)`;
  return null;
}

/** A layer's peak scale over its base value and every `scale` keyframe. */
function peakScale(layer: SceneSpec["layers"][number]): number {
  let peak = typeof layer.scale === "number" && Number.isFinite(layer.scale) ? layer.scale : 1;
  for (const keyframe of layer.keyframes ?? []) {
    if (keyframe.property !== "scale") continue;
    if (typeof keyframe.value !== "number" || !Number.isFinite(keyframe.value)) continue;
    peak = Math.max(peak, keyframe.value);
  }
  return peak;
}

/**
 * Warn when a dense keyframe sweep drives an expensive layer to a scale at
 * which ONE rasterised surface is bigger than the canvas by an order of
 * magnitude. The keyframe count is cheap; this value is not.
 */
function largeScaleWarnings(scene: SceneSpec): SceneWarning[] {
  const canvas = resolveCanvasSize(scene.canvas);
  const warnings: SceneWarning[] = [];
  scene.layers.forEach((layer, index) => {
    const peak = peakScale(layer);
    if (peak <= MAX_SAFE_FILTERED_SCALE) return;
    const surface = expensiveSurface(layer);
    if (!surface) return;
    const surfaceMb = Math.round(
      (canvas.width * peak * canvas.height * peak * 4) / (1024 * 1024)
    );
    warnings.push({
      code: FILTERED_LAYER_LARGE_SCALE,
      path: `layers.${index}.scale`,
      message:
        `layer "${layer.id}" reaches scale ${round(peak)}× while carrying ${surface}: its next ` +
        `rasterised surface is ${round(canvas.width * peak)}×${round(canvas.height * peak)} ` +
        `(~${surfaceMb} MB) at design size. A keyframe sweep that repeatedly crosses that scale is ` +
        `what exhausts a small render host (the keyframe COUNT is cheap). Keep the scale at or below ` +
        `${MAX_SAFE_FILTERED_SCALE}×, or frame the subject with a camera move instead of scaling the layer.`,
      detail: {
        layerId: layer.id,
        layerType: layer.type,
        peakScale: round(peak),
        surfaceAtPeakPx: [round(canvas.width * peak), round(canvas.height * peak)],
        surfaceMb,
        maxSafeScale: MAX_SAFE_FILTERED_SCALE,
      },
    });
  });
  return warnings;
}

export function analyzeScene(scene: SceneSpec): SceneWarning[] {
  const warnings: SceneWarning[] = [];

  for (const pose of cameraPoses(scene)) {
    const { min, max } = safePanRange(pose.scale);
    const overX = pose.xPct < min - 1e-6 || pose.xPct > max + 1e-6;
    const overY = pose.yPct < min - 1e-6 || pose.yPct > max + 1e-6;
    if (!overX && !overY) continue;

    const axes: string[] = [];
    if (overX) axes.push("x");
    if (overY) axes.push("y");
    const voided = voidPercent(pose.scale, pose.xPct, pose.yPct);
    const worst = Math.max(voided.x, voided.y);

    warnings.push({
      code: CAMERA_VIEWPORT_EXCEEDS_CANVAS,
      path: `${pose.path}.${axes.includes("x") ? "xPct" : "yPct"}`,
      message:
        `camera ${pose.source} at ${pose.at}ms (scale ${round(pose.scale)}) pans outside the canvas on ` +
        `${axes.join("+")}: ${axes.map((a) => `${a} ${round(a === "x" ? pose.xPct : pose.yPct)}%`).join(", ")} ` +
        `vs safe [${round(min)}%, ${round(max)}%] — about ${round(worst)}% of the frame would be black void. ` +
        `The runtime clamps this automatically; bring ${axes.includes("x") ? "xPct" : "yPct"} inside the safe range to remove the warning.`,
      detail: {
        at: pose.at,
        axis: axes,
        source: pose.source,
        scale: round(pose.scale),
        xPct: round(pose.xPct),
        yPct: round(pose.yPct),
        safeRangePct: [round(min), round(max)],
        voidPct: { x: round(voided.x), y: round(voided.y) },
      },
    });
  }

  for (const reframe of focusReframes(scene)) {
    const path = `camera.moves.${reframe.moveIndex}.targetLayerId`;
    warnings.push({
      code: CAMERA_VIEWPORT_EXCEEDS_CANVAS,
      path,
      message:
        `camera move "focusTarget" at ${reframe.at}ms targets a layer at ` +
        `(${round(reframe.requested.xPct)}%, ${round(reframe.requested.yPct)}%), which no permitted zoom can centre on: ` +
        `even at the ${FOCUS_MAX_SCALE}× cap the safe look-at range is ` +
        `[${round(safePanRange(reframe.scale).min)}%, ${round(safePanRange(reframe.scale).max)}%]. ` +
        `The frame stays covered by clamping the pan to (${round(reframe.applied.xPct)}%, ${round(reframe.applied.yPct)}%), ` +
        `so the target will not be centred — move it further from the canvas edge, or raise the move's zoom, to remove this warning.`,
      detail: {
        at: reframe.at,
        axis: [reframe.requested.xPct !== reframe.applied.xPct ? "x" : null, reframe.requested.yPct !== reframe.applied.yPct ? "y" : null]
          .filter(Boolean) as string[],
        source: "focusTarget",
        scale: round(reframe.scale),
        requestedLookAt: reframe.requested,
        appliedLookAt: reframe.applied,
        safeRangePct: [round(safePanRange(reframe.scale).min), round(safePanRange(reframe.scale).max)],
      },
    });
  }

  for (const [index, move] of scene.camera.moves.entries()) {
    const end = move.at + (move.durationMs ?? 800);
    if (end <= scene.durationMs) continue;
    warnings.push({
      code: CAMERA_MOVE_OVERRUNS_SCENE,
      path: `camera.moves.${index}`,
      message:
        `camera move "${move.move}" at ${move.at}ms runs ${end - scene.durationMs}ms past the scene end ` +
        `(${scene.durationMs}ms) and will be cut off mid-effect`,
      detail: { at: move.at, endsAtMs: end, sceneDurationMs: scene.durationMs },
    });
  }

  // a run of screen time with nothing on it — the audited dead frame
  scene.transitions.forEach((tr, index) => {
    const overflow = transitionPeakOverflowMs(tr.kind, tr.durationMs);
    if (overflow <= 0) return;
    warnings.push({
      code: TRANSITION_PEAK_TOO_LONG,
      path: `transitions.${index}.durationMs`,
      message:
        `"${tr.kind}" at ${tr.at}ms is authored at ${tr.durationMs}ms, which holds full-screen cover for ` +
        `${round(transitionPeakHoldMs(tr.kind, tr.durationMs))}ms — past the ${PEAK_COVER_MAX_MS}ms ceiling. ` +
        `The runtime clamps it, so the last ${round(overflow)}ms would read as a hold on an empty screen; ` +
        `shorten the transition.`,
      detail: {
        at: tr.at,
        durationMs: tr.durationMs,
        peakHoldMs: round(transitionPeakHoldMs(tr.kind, tr.durationMs)),
        maxPeakHoldMs: PEAK_COVER_MAX_MS,
      },
    });
  });

  // a run of screen time with nothing on it — the audited dead frame
  for (const gap of foregroundCoverageGaps(scene)) {
    warnings.push({
      code: FOREGROUND_COVERAGE_GAP,
      path: "layers",
      message:
        `no foreground content is on screen from ${gap.fromMs}ms to ${gap.toMs}ms ` +
        `(${gap.durationMs}ms). A production cut may hide the stage only while its cover is at full extent ` +
        `(${PEAK_COVER_MAX_MS}ms); anything longer renders as a dead dark frame. Put a transition whose midpoint ` +
        `sits inside that window, or extend an act across it.`,
      detail: { fromMs: gap.fromMs, toMs: gap.toMs, durationMs: gap.durationMs },
    });
  }

  // a dense sweep across an expensive surface — the host-limit cause
  warnings.push(...largeScaleWarnings(scene));

  return warnings;
}

/** Convenience for call sites that only care whether anything is wrong. */
export function hasWarnings(warnings: readonly SceneWarning[]): boolean {
  return warnings.length > 0;
}

/** One-line human summary, safe to append verbatim to a tool result. */
export function summarizeWarnings(warnings: readonly SceneWarning[]): string {
  if (warnings.length === 0) return "";
  return [
    "",
    `${warnings.length} warning(s) — non-blocking, the scene was stored:`,
    ...warnings.map((w) => `- [${w.code}] ${w.path}: ${w.message}`),
  ].join("\n");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export type { CameraMove };