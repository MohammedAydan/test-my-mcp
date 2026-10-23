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
  type AudioChoreographyOptions,
  type AudioChoreographyReport,
} from "./engine-core.js";
export {
  choreographSceneAudio,
} from "./audio-choreographer.js";
export { listVaultAssets, type AssetVaultItem } from "./vault.js";
export {
  type CritiqueRule,
  type CritiqueIssue,
  type CritiqueOptions,
  type CritiqueReport,
  computeSampleTimes,
  evaluateCritiqueIssues,
  computeCritiqueScore,
  applyAutoFixes,
  contrastRatio,
  relativeLuminance,
  resolveBackgroundBase,
  resolveTextColor,
  adjustColorForContrast,
} from "./scene-critic.js";
export {
  generateStoryboardFromBrief,
  storyboardBriefSchema,
  briefMetricSchema,
  briefFeatureSchema,
  slug,
  parseMetricNumber,
  normalizeMetrics,
  normalizeFeatures,
  SCENE_ARCHETYPES,
  type BriefMetric,
  type BriefFeature,
  type StoryboardBrief,
  type StoryboardSceneSummary,
  type StoryboardReport,
  type SceneArchetypeRole,
} from "./storyboard-generator.js";
export {
  StoryboardComposer,
  planStoryboardCompose,
  composeInputSchema,
  composeSceneInputSchema,
  composeTransitionSchema,
  COMPOSE_TRANSITIONS,
  type ComposeTransition,
  type ComposeSceneInput,
  type ComposeInput,
  type ComposeSceneResult,
  type ComposeReport,
  type StoryboardPlan,
  type PlannedTransition,
} from "./storyboard-composer.js";

