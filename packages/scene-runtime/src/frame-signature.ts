import type { SceneSpec } from "@motionforge/scene-spec";
import type { BuiltScene } from "./scene-builder.js";
import { activeTransitionsAt, type ActiveTransition } from "./transitions.js";
import { lifecyclePhaseAt } from "./scene-builder.js";

/**
 * The set of layer types that are considered "static" — their pixels never
 * change once they reach the settled phase, assuming no keyframes and no
 * camera motion.
 *
 * - kineticText: after entrance/emphasis/exit, text is static
 * - imageLogo: static image
 * - cta: button/call-to-action, static after entrance
 * - deviceMockup: static mockup content
 * - background (solid variant only): solid colour, no animation
 */
const STATIC_LAYER_TYPES = new Set([
  "kineticText",
  "imageLogo",
  "cta",
  "deviceMockup",
]);

/**
 * Checks if a layer is a background with solid variant.
 */
type SceneLayer = SceneSpec["layers"][number];

function isSolidBackground(layer: SceneLayer): boolean {
  return (
    layer.type === "background" &&
    layer.variant !== undefined &&
    "variant" in layer.variant &&
    layer.variant.variant === "solid"
  );
}

/**
 * Checks if a layer has any future keyframe (including legacy tracks) after the given time.
 */
function hasFutureKeyframe(layer: SceneLayer, timeMs: number): boolean {
  // Check modern flat keyframes
  if (layer.keyframes && layer.keyframes.length > 0) {
    for (const kf of layer.keyframes) {
      if (kf.timeMs > timeMs) return true;
    }
  }
  // Check legacy tracks
  if (layer.tracks && layer.tracks.length > 0) {
    for (const track of layer.tracks) {
      if (track.keyframes && track.keyframes.length > 0) {
        for (const kf of track.keyframes) {
          if (kf.at > timeMs) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Checks if the camera is static for the entire scene (no keyframes, moves, or drift).
 */
function isCameraStatic(scene: SceneSpec): boolean {
  if (!scene.camera) return true;
  const cam = scene.camera;
  return (
    (!cam.keyframes || cam.keyframes.length === 0) &&
    (!cam.moves || cam.moves.length === 0) &&
    !cam.drift
  );
}

/**
 * Returns the fps from renderConfig if available, otherwise defaults to 60.
 */
function getFps(): number {
  const config = (globalThis as any).renderConfig;
  if (config && typeof config.fps === "number" && config.fps > 0) {
    return config.fps;
  }
  return 60;
}

/**
 * Returns a stable string signature if the frame at `timeMs` is guaranteed to be
 * pixel-identical to the next frame; otherwise `null`.
 *
 * The signature is a constant string `"static"` when all conditions hold.
 * The renderer compares consecutive signatures to detect static runs.
 */
export function getSceneFrameSignature(
  scene: SceneSpec,
  built: BuiltScene,
  timeMs: number
): string | null {
  const fps = getFps();
  const nextFrameMs = timeMs + 1000 / fps;

  // 1. No active transition at current time OR next frame
  const activeNow = activeTransitionsAt(built.overlays, timeMs);
  if (activeNow.length > 0) return null;
  const activeNext = activeTransitionsAt(built.overlays, nextFrameMs);
  if (activeNext.length > 0) return null;

  // 2. Camera must be completely static for the whole scene
  if (!isCameraStatic(scene)) return null;

  // 3. Check every layer
  for (const layer of scene.layers) {
    const plan = built.plans.get(layer.id);
    if (!plan) return null;

    const visibleNow = timeMs >= plan.visibleStartMs && timeMs < plan.visibleEndMs;
    const visibleNext = nextFrameMs >= plan.visibleStartMs && nextFrameMs < plan.visibleEndMs;

    // Layer visibility must not change between current and next frame
    if (visibleNow !== visibleNext) return null;

    // Skip invisible layers
    if (!visibleNow) continue;

    // Skip explicitly hidden layers
    if (layer.visible === false) continue;

    // Skip fully transparent layers
    if (layer.opacity === 0) continue;

    // 4. Layer must be in settled phase
    const { phase } = lifecyclePhaseAt(plan, timeMs);
    if (phase !== "settled") return null;

    // 5. Layer type must be on the static whitelist
    if (!STATIC_LAYER_TYPES.has(layer.type) && !isSolidBackground(layer)) {
      return null;
    }

    // 6. No future keyframes
    if (hasFutureKeyframe(layer, timeMs)) return null;

    // 7. No auto-exit fade active or starting within next frame
    if (!plan.exit && !plan.exitSuppressedBySeam) {
      // Check if this layer needs auto-exit
      const endMs = Math.min(
        layer.at + (layer.duration ?? scene.durationMs),
        scene.durationMs
      );
      const fadeMs = Math.min(
        220,
        Math.max(0, endMs - plan.visibleStartMs)
      );
      const fadeStartMs = endMs - fadeMs;
      if (fadeStartMs <= nextFrameMs && endMs > timeMs) {
        // Auto-exit fade is active or starts within next frame
        return null;
      }
    }

    // 8. No explicit exit starting within next frame (even if suppressed by seam check)
    if (plan.exit && plan.exit.startMs <= nextFrameMs && plan.exit.startMs > timeMs) {
      return null;
    }

    // 9. No emphasis window starting within next frame
    if (plan.emphasis && plan.emphasis.startMs <= nextFrameMs && plan.emphasis.startMs > timeMs) {
      return null;
    }
  }

  // All conditions met: frame is static
  return "static";
}
