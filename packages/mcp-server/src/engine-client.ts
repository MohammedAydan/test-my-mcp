/**
 * In-process or HTTP client for core-engine.
 * When MOTIONFORGE_ENGINE_URL is not set, invokes EngineCore directly in-process
 * without any REST APIs, resolving to the shared ~/.motionforge canonical path.
 */
import { readFile } from "node:fs/promises";
import {
  createEngineCore,
  initCreativeProject,
  saveFramesMetaToDisk,
  saveRenderToDisk,
  saveStillsToDisk,
  type EngineCore,
} from "@motionforge/core-engine";

export const ENGINE_URL = process.env.MOTIONFORGE_ENGINE_URL ?? "http://127.0.0.1:4000";

let inProcessCore: EngineCore | null = null;

async function getInProcessCore(): Promise<EngineCore> {
  if (!inProcessCore) {
    inProcessCore = await createEngineCore({
      enableWatcher: true,
    });
  }
  return inProcessCore;
}

function useHttp(): boolean {
  return Boolean(process.env.MOTIONFORGE_ENGINE_URL);
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

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${ENGINE_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (error) {
    throw new EngineError(0, `unreachable (${error instanceof Error ? error.message : String(error)}) — is core-engine running on ${ENGINE_URL}?`);
  }
  const text = await response.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const issues =
      body && typeof body === "object" && "issues" in body && Array.isArray((body as { issues: unknown }).issues)
        ? ((body as { issues: string[] }).issues)
        : undefined;
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : text.slice(0, 400) || response.statusText;
    throw new EngineError(response.status, message, issues);
  }
  return body;
}

/** Header the engine reads to associate an out-of-band call with a project. */
const PROJECT_HEADER = "x-motionforge-project";

export const engineClient = {
  capabilities: async (): Promise<unknown> => {
    if (useHttp()) return request("/api/capabilities");
    const core = await getInProcessCore();
    return core.getCapabilities();
  },

  putScene: async (scene: unknown, projectPath?: string): Promise<SceneUploadResult> => {
    if (useHttp()) {
      return request("/api/scenes", {
        method: "POST",
        body: JSON.stringify(projectPath ? { ...(scene as object), projectPath } : scene),
        headers: projectPath ? { [PROJECT_HEADER]: projectPath } : undefined,
      }) as Promise<SceneUploadResult>;
    }
    const core = await getInProcessCore();
    try {
      const res = await core.saveScene(scene, projectPath);
      return res as SceneUploadResult;
    } catch (error: any) {
      throw new EngineError(error.status ?? 400, error.message, error.issues);
    }
  },

  initProject: async (options: unknown): Promise<ProjectInitResult> => {
    if (useHttp()) {
      return request("/projects/init", { method: "POST", body: JSON.stringify(options) }) as Promise<ProjectInitResult>;
    }
    const core = await getInProcessCore();
    return (await initCreativeProject(options as any, {
      seedScene: async (s) => (await core.store.upsert(s)).id,
      engineBaseUrl: `http://127.0.0.1:${core.config.port}`,
    })) as ProjectInitResult;
  },

  syncScene: async (scene: unknown, projectPath: string): Promise<SceneUploadResult> => {
    if (useHttp()) {
      return request("/projects/sync", {
        method: "POST",
        body: JSON.stringify({ scene, projectPath }),
        headers: { [PROJECT_HEADER]: projectPath },
      }) as Promise<SceneUploadResult>;
    }
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
    quality: "draft" | "production",
    mp4Base64: string,
    projectPath: string
  ): Promise<{ file: string; latest: string; status: string; projectRenderFilePath: string }> => {
    if (useHttp()) {
      return request("/projects/renders", {
        method: "POST",
        body: JSON.stringify({ sceneId, quality, mp4Base64 }),
        headers: { [PROJECT_HEADER]: projectPath },
      }) as Promise<{ file: string; latest: string; status: string; projectRenderFilePath: string }>;
    }
    const saved = await saveRenderToDisk(projectPath, sceneId, quality, Buffer.from(mp4Base64, "base64"));
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
    if (useHttp()) {
      return request("/projects/stills", {
        method: "POST",
        body: JSON.stringify({ sceneId, frames, framesMeta }),
        headers: { [PROJECT_HEADER]: projectPath },
      }) as Promise<{ files: string[]; savedStillsFilePaths: string[]; metaFile?: string }>;
    }
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
    if (useHttp()) {
      return request(`/api/scenes/${encodeURIComponent(sceneId)}/keyframes`, {
        method: "POST",
        body: JSON.stringify({ at, includeFullResolution }),
      }) as Promise<{ frames: KeyframeFrame[]; framesMeta: KeyframeFrameMeta[] }>;
    }
    const core = await getInProcessCore();
    return (await core.inspectKeyframes(sceneId, { at, includeFullResolution })) as any;
  },

  previewUrl: (sceneId: string): string =>
    `${ENGINE_URL}/preview/?scene=${encodeURIComponent(sceneId)}`,

  enqueueRender: async (sceneId: string, quality: "draft" | "production"): Promise<{ jobId: string; status: string }> => {
    if (useHttp()) {
      return request("/api/renders", {
        method: "POST",
        body: JSON.stringify({ sceneId, quality }),
      }) as Promise<{ jobId: string; status: string }>;
    }
    const core = await getInProcessCore();
    return await core.startRender(sceneId, quality);
  },

  renderJob: async (jobId: string): Promise<RenderJobView> => {
    if (useHttp()) {
      return request(`/api/renders/${encodeURIComponent(jobId)}`) as Promise<RenderJobView>;
    }
    const core = await getInProcessCore();
    const job = core.getRenderStatus(jobId);
    if (!job) throw new EngineError(404, `unknown render job "${jobId}"`);
    return job as any;
  },

  renderFileBase64: async (jobId: string): Promise<{ mp4Base64: string; sceneId: string; quality: string }> => {
    if (useHttp()) {
      return request(`/api/renders/${encodeURIComponent(jobId)}/file/base64`) as Promise<{
        mp4Base64: string;
        sceneId: string;
        quality: string;
      }>;
    }
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
};
