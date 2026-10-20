// --- primitives -------------------------------------------------------------
export * from "./common.js";
// --- registries -------------------------------------------------------------
export * from "./motion.js";
export * from "./camera.js";
export * from "./assets.js";
export * from "./audio.js";
// --- layers -----------------------------------------------------------------
export * from "./layers/base.js";
export * from "./layers/background.js";
export * from "./layers/image-logo.js";
export * from "./layers/kinetic-text.js";
export * from "./layers/card.js";
export * from "./layers/lottie.js";
export * from "./layers/foreground-fx.js";
// --- scene + validation -----------------------------------------------------
export * from "./scene.js";
export * from "./validate.js";
// --- scene sanitizer / normalizer ------------------------------------------
export * from "./sanitize.js";
// --- act seams / foreground coverage (shared runtime ⇄ engine contract) -----
export * from "./coverage.js";
// --- authoring guidance (LLM-facing, derived from the schemas above) -------
export * from "./field-guide.js";
// --- creative project manifest (client/job workspaces) ---------------------
export * from "./project-manifest.js";
