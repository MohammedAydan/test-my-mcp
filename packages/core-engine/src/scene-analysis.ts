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
import { resolveCanvasSize, type CameraKeyframe, type CameraMove, type SceneSpec } from "@motionforge/scene-spec";

export const CAMERA_VIEWPORT_EXCEEDS_CANVAS = "CAMERA_VIEWPORT_EXCEEDS_CANVAS";
export const CAMERA_MOVE_OVERRUNS_SCENE = "CAMERA_MOVE_OVERRUNS_SCENE";

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
export function safePanRange(scale: number): { min: number; max: number } {
  if (!(scale > 1)) return { min: 0, max: 100 };
  const margin = 50 / scale;
  return { min: margin, max: 100 - margin };
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
export const FOCUS_MAX_SCALE = 3;

/**
 * The zoom `focusTarget` needs to centre on a point `d` percent from the canvas
 * centre: `|d| ≤ 50(1 − 1/S)`  ⟹  `S ≥ 1 / (1 − |d|/50)`. Capped, because a
 * target on the very edge of the canvas is unreachable at any finite zoom.
 */
export function requiredFocusScale(offsetPct: number): number {
  const d = Math.min(49.999, Math.abs(offsetPct));
  return Math.min(FOCUS_MAX_SCALE, 1 / (1 - d / 50));
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
        if (!anchor) return { ...pose, scale: 1.45 * strength, xPct: base.xPct, yPct: base.yPct };
        const offset = Math.max(Math.abs(50 - anchor.xPct), Math.abs(50 - anchor.yPct));
        const scale = Math.max(1.45 * strength, requiredFocusScale(offset));
        const { min, max } = safePanRange(scale);
        const limit = (v: number): number => Math.min(max, Math.max(min, v));
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