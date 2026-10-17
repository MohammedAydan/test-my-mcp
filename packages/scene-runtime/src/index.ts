/**
 * @motionforge/scene-runtime — the visual canvas (browser).
 *
 * Builds DOM/SVG/Canvas/Lottie layers from a SceneSpec, drives everything from one
 * deterministic GSAP masterTimeline (window.seekToFrame), hosts the 2.5D camera rig
 * and the interactive timeline scrubber. Implemented in Step 3 (docs/00_PLAN.md).
 */
export const PACKAGE_NAME = "@motionforge/scene-runtime" as const;
export const PACKAGE_VERSION = "0.1.0" as const;
