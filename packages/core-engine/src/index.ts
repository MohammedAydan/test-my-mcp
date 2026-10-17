/**
 * @motionforge/core-engine — the backend service.
 *
 * Owns: SceneSpec validation, asset vault, live preview hosting, the parallel
 * Playwright frame renderer, memory-piped FFmpeg encoding, and the millisecond-
 * accurate SFX mixer. Implemented in Step 4 (docs/00_PLAN.md).
 *
 * This package must have ZERO knowledge of MCP.
 */
export const PACKAGE_NAME = "@motionforge/core-engine" as const;
export const PACKAGE_VERSION = "0.1.0" as const;
