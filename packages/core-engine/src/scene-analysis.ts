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

/**
 * Poses contributed by `camera.moves`. Moves are *temporary*: they ramp in,
 * hold, and ramp back out, so the extreme pose they reach is what must be
 * checked (not a permanent rest state).
 */
export function movePoses(scene: SceneSpec): CameraPose[] {
  const { width, height } = resolveCanvasSize(scene.canvas);
  const keyframeEnd = scene.camera.keyframes.length > 0
    ? scene.camera.keyframes[scene.camera.keyframes.length - 1]?.at ?? 0
    : 0;
  // a move composes on top of whatever the keyframes left behind
  let scale = BASELINE.scale;
  let xPct = BASELINE.xPct;
  let yPct = BASELINE.yPct;
  for (const kf of scene.camera.keyframes) {
    scale = kf.scale ?? scale;
    xPct = kf.xPct ?? xPct;
    yPct = kf.yPct ?? yPct;
  }
  void width;
  void height;
  void keyframeEnd;

  return scene.camera.moves.map((move, index) => {
    const strength = move.strength ?? 1;
    const pose = { at: move.at, source: "move", path: `camera.moves.${index}` as string };
    switch (move.move) {
      case "slowPushIn":
        return { ...pose, scale: scale + 0.12 * strength, xPct, yPct };
      case "focusTarget": {
        // the rig is 1.45× at the peak of the move; the pan target depends on
        // the layer's measured box, which the runtime resolves. Worst case for
        // the *default* centre-based pan is handled by the clamp, so only the
        // zoom is a real risk here.
        return { ...pose, scale: 1.45 * strength, xPct, yPct };
      }
      case "whipPanLeft":
      case "whipPanRight": {
        const dir = move.move === "whipPanLeft" ? -1 : 1;
        const offset = dir * 26 * strength;
        return { ...pose, scale, xPct: xPct - offset, yPct };
      }
      case "shakeImpact":
        return { ...pose, scale: scale + 0.02 * strength, xPct, yPct };
      default:
        return { ...pose, scale, xPct, yPct };
    }
  });
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