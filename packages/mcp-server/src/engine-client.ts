/**
 * Pure in-process client for core-engine.
 * Invokes EngineCore directly in-process without any REST APIs, resolving
 * to the shared ~/.motionforge canonical path.
 */
import { readFile } from "node:fs/promises";
import {
  createEngineCore,
  initCreativeProject,
  readProjectManifest,
  saveFramesMetaToDisk,
  saveRenderToDisk,
  saveStillsToDisk,
  type EngineCore,
} from "@motionforge/core-engine";
import type {
  RenderResultReport,
  SceneAnalysisReport,
  SceneBoundsReport,
} from "@motionforge/scene-spec";

export const ENGINE_URL = "in-process";

let inProcessCore: EngineCore | null = null;

export async function getInProcessCore(): Promise<EngineCore> {
  if (!inProcessCore) {
    inProcessCore = await createEngineCore({
      enableWatcher: true,
    });
  }
  return inProcessCore;
}

/**
 * An engine failure. The class carries DATA (status + body issues); prefixing
 * is the presenter's job, so callers can format it without doubling the status.
 */
export class EngineError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: string[]
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export interface SceneWarning {
  code: string;
  path: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface SceneUploadResult {
  id: string;
  status: "created" | "updated";
  revision: number;
  hash: string;
  /** non-blocking diagnostics — e.g. a camera that would expose black void */
  warnings: SceneWarning[];
  previewUrl?: string;
  /** set when the scene was written back to a creative project */
  savedSceneFilePath?: string;
  scene: unknown;
}

export interface ProjectInitResult {
  projectPath: string;
  manifest: Record<string, unknown>;
  initialSceneId: string | null;
  previewUrl: string | null;
  filesCreatedCount: number;
  seedError: string | null;
  operationalChecklist: string[];
}

export interface KeyframeFrameMeta {
  atMs: number;
  camera?: {
    scale: number;
    xPct: number;
    yPct: number;
    roll: number;
    yaw: number;
    pitch: number;
    /** the rendered pose was held inside the canvas bounds */
    clampedVoid: boolean;
    /** the look-at the scene ASKED for, when the renderer could not honour it */
    unclampedXPct?: number;
    unclampedYPct?: number;
  };
  activeTransitions?: Array<{ kind: string; progressPct: number; phase: "in" | "peak" | "out" }>;
  layers?: Array<{
    id: string;
    type: string;
    lifecyclePhase: "entrance" | "settled" | "emphasis" | "exit";
    phaseProgressPct: number;
    opacity: number;
    bbox: { x: number; y: number; width: number; height: number };
    textOverflow: boolean;
  }>;
}

export interface KeyframeFrame {
  atMs: number;
  /** the FULL-RESOLUTION PNG (data:image/png;base64,…) — only when requested */
  image: string;
  /**
   * A lightweight JPEG preview (data:image/jpeg;base64,…) — the copy that is
   * safe to put in an MCP response.
   */
  preview: string;
  /** numeric sidecar: camera pose, live transition phase, per-layer lifecycle */
  meta?: KeyframeFrameMeta;
}

export interface RenderJobView {
  id: string;
  sceneId: string;
  quality: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  error?: string;
  result?: {
    mp4Path: string;
    mp4Url: string;
    frames: number;
    wallMs: number;
    effectiveFps: number;
    encoder: string;
    workerCount: number;
    profile: { quality: string; fps: number; outWidth: number; outHeight: number; jpegQuality: number };
  };
}

export const engineClient = {
  capabilities: async (): Promise<unknown> => {
    const core = await getInProcessCore();
    return core.getCapabilities();
  },

  putScene: async (scene: unknown, projectPath?: string): Promise<SceneUploadResult> => {
    const core = await getInProcessCore();
    try {
      const res = await core.saveScene(scene, projectPath);
      return res as SceneUploadResult;
    } catch (error: any) {
      throw new EngineError(error.status ?? 400, error.message, error.issues);
    }
  },

  initProject: async (options: unknown): Promise<ProjectInitResult> => {
    const core = await getInProcessCore();
    return (await initCreativeProject(options as any, {
      seedScene: async (s) => (await core.store.upsert(s)).id,
      engineBaseUrl: "mf-runtime://app",
    })) as ProjectInitResult;
  },

  syncScene: async (scene: unknown, projectPath: string): Promise<SceneUploadResult> => {
    const core = await getInProcessCore();
    try {
      const res = await core.saveScene(scene, projectPath);
      return res as SceneUploadResult;
    } catch (error: any) {
      throw new EngineError(error.status ?? 400, error.message, error.issues);
    }
  },

  saveRender: async (
    sceneId: string,
    quality: "preview" | "draft" | "production",
    mp4Base64: string,
    projectPath: string
  ): Promise<{ file: string; latest: string; status: string; projectRenderFilePath: string }> => {
    // A PREVIEW render is a working file, not a deliverable: it is filed
    // under `draft/` (the project manifest only knows `draft` and
    // `production`).
    const projectQuality = quality === "preview" ? "draft" : quality;
    const saved = await saveRenderToDisk(projectPath, sceneId, projectQuality, Buffer.from(mp4Base64, "base64"));
    return {
      file: saved.file,
      latest: saved.latest,
      status: saved.status,
      projectRenderFilePath: `${projectPath.replace(/\/+$/, "")}/${saved.latest}`,
    };
  },

  saveStills: async (
    sceneId: string,
    frames: Array<{ atMs: number; image: string }>,
    projectPath: string,
    framesMeta: unknown[] = []
  ): Promise<{ files: string[]; savedStillsFilePaths: string[]; metaFile?: string }> => {
    const files = await saveStillsToDisk(projectPath, sceneId, frames);
    let metaFile: string | null = null;
    if (Array.isArray(framesMeta) && framesMeta.length > 0) {
      metaFile = await saveFramesMetaToDisk(projectPath, sceneId, framesMeta);
    }
    return {
      files,
      savedStillsFilePaths: files.map((f) => `${projectPath.replace(/\/+$/, "")}/${f}`),
      ...(metaFile ? { metaFile } : {}),
    };
  },

  keyframes: async (
    sceneId: string,
    at: number[],
    includeFullResolution = false
  ): Promise<{ frames: KeyframeFrame[]; framesMeta: KeyframeFrameMeta[] }> => {
    const core = await getInProcessCore();
    return (await core.inspectKeyframes(sceneId, { at, includeFullResolution })) as any;
  },

  previewUrl: (sceneId: string): string =>
    `mf-runtime://app/index.html?scene=${encodeURIComponent(sceneId)}`,

  enqueueRender: async (
    sceneId: string,
    quality: "preview" | "draft" | "production"
  ): Promise<{ jobId: string; status: string }> => {
    const core = await getInProcessCore();
    return await core.startRender(sceneId, quality);
  },

  renderJob: async (jobId: string): Promise<RenderJobView> => {
    const core = await getInProcessCore();
    const job = core.getRenderStatus(jobId);
    if (!job) throw new EngineError(404, `unknown render job "${jobId}"`);
    return job as any;
  },

  renderFileBase64: async (jobId: string): Promise<{ mp4Base64: string; sceneId: string; quality: string }> => {
    const core = await getInProcessCore();
    const job = core.getRenderStatus(jobId);
    if (!job || job.status !== "succeeded" || !job.result) {
      throw new EngineError(404, "render not finished");
    }
    const bytes = await readFile(job.result.mp4Path);
    return {
      mp4Base64: bytes.toString("base64"),
      sceneId: job.sceneId,
      quality: job.quality,
    };
  },

  /**
   * The ZERO-RASTERISATION layout report.
   *
   * The point of this call: the numbers a layout check needs, WITHOUT paying
   * for a screenshot per timestamp. `inspect_scene_keyframes` rasterises every
   * frame it measures; this only measures.
   */
  layerBoundsAt: async (sceneId: string, timesMs: number[]): Promise<SceneBoundsReport> => {
    const core = await getInProcessCore();
    try {
      return await core.getLayerBoundsAt(sceneId, timesMs);
    } catch (error: any) {
      throw new EngineError(error.status ?? 404, error.message, error.issues);
    }
  },

  /** Static + dynamic analysis: warnings, the render-cost estimate, keyframe precedence. */
  analyzeScene: async (sceneId: string): Promise<SceneAnalysisReport> => {
    const core = await getInProcessCore();
    try {
      return await core.analyzeScene(sceneId);
    } catch (error: any) {
      throw new EngineError(error.status ?? 404, error.message, error.issues);
    }
  },

  /** The finished render plus its ffprobe metadata. */
  renderResult: async (jobId: string): Promise<RenderResultReport> => {
    const core = await getInProcessCore();
    try {
      return await core.getRenderResult(jobId);
    } catch (error: any) {
      throw new EngineError(error.status ?? 404, error.message, error.issues);
    }
  },

  /** Put a file into the engine's asset vault (and into the project's asset tree). */
  ingestAsset: async (
    bytes: Buffer,
    name: string,
    kind?: string,
    projectPath?: string
  ): Promise<{ id: string; name: string; src: string; kind: string; size: number; mimeType: string }> => {
    const core = await getInProcessCore();
    try {
      return await core.ingestAsset(bytes, name, kind, projectPath);
    } catch (error: any) {
      throw new EngineError(error.status ?? 400, error.message, error.issues);
    }
  },

  /** The project's manifest + the assets it knows about. */
  projectManifest: async (
    projectPath: string
  ): Promise<{
    ok: boolean;
    manifest: unknown;
    issues: string[];
    assets: Array<{ id: string; name: string; kind: string; src: string; size: number }>;
  }> => {
    const core = await getInProcessCore();
    const read = await readProjectManifest(projectPath);
    const assets = await core.listAssets(projectPath);
    return {
      ok: read.ok,
      manifest: read.ok ? read.manifest : null,
      issues: read.ok ? [] : read.issues,
      assets: assets.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        src: a.src,
        size: a.size,
      })),
    };
  },
};
