export * from "./config.js";
export * from "./capabilities.js";
export * from "./project-workspace.js";
export {
  storeScene,
  type SceneStoreResponse,
  type SceneStoreError,
  type SceneStoreResult,
  type SceneStoreSuccess,
  type SceneStoreFailure,
  type StoreSceneOptions,
} from "./scene-operations.js";
export { SceneStore, sceneHash, type StoredScene } from "./scene-store.js";
export { ensureSfxBank, SFX_BANK } from "./sfx-bank.js";
export { doctor, type DoctorReport } from "./doctor.js";
export { RenderRunner, type RenderJob, type RenderQuality } from "./render-runner.js";
export { profileFor, pickEncoder, buildAudioGraph, availableEncoders, type RenderProfile } from "./encoder.js";
export { encoderArgs, productionBitrateFloor } from "./encoder.js";
export {
  buildBoundsFrameReport,
  buildCameraReport,
  buildCompositionBox,
  findOffscreen,
  findOverlaps,
  type RuntimeFrameDescription,
} from "./bounds-report.js";
export {
  buildCostReport,
  computeWorkerBudget,
  detectHeavyEffects,
  estimatedFrameMs,
  hostFacts,
  measureKeyframeDensity,
  perFrameMultiplier,
  sceneHasHeavyEffects,
  workerBudgetForScene,
  HEAVY_EFFECT_MULTIPLIERS,
  KEYFRAME_DENSITY_MULTIPLIER,
  KEYFRAME_DENSITY_REFERENCE,
  MAX_KEYFRAME_DENSITY_MULTIPLIER,
  MAX_PER_FRAME_MULTIPLIER,
  type WorkerBudgetInput,
} from "./cost-analysis.js";
export { probeMedia, toStreamReport } from "./media-probe.js";
export { WarmPage, WARM_FPS, type WarmFrameReport, type WarmPageOptions } from "./warm-page.js";
export {
  EngineCore,
  createEngineCore,
  type EngineCoreOptions,
  type EngineEventMap,
} from "./engine-core.js";
export { listVaultAssets, type AssetVaultItem } from "./vault.js";
