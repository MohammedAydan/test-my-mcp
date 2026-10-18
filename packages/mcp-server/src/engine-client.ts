/**
 * HTTP client for core-engine. The MCP adapter owns no scene logic — every
 * capability comes from the engine over the wire.
 */
export const ENGINE_URL = process.env.MOTIONFORGE_ENGINE_URL ?? "http://127.0.0.1:4000";

/**
 * An engine HTTP failure. The class carries DATA (status + body issues); prefixing
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
    clampedVoid: boolean;
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
  /** data:image/png;base64,… */
  image: string;
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
  capabilities: (): Promise<unknown> => request("/api/capabilities"),

  putScene: (scene: unknown, projectPath?: string): Promise<SceneUploadResult> =>
    request("/api/scenes", {
      method: "POST",
      // `projectPath` rides in the body for /api/scenes and in a header for the
      // project routes, so both are accepted here
      body: JSON.stringify(projectPath ? { ...(scene as object), projectPath } : scene),
      headers: projectPath ? { [PROJECT_HEADER]: projectPath } : undefined,
    }) as Promise<SceneUploadResult>,

  initProject: (options: unknown): Promise<ProjectInitResult> =>
    request("/projects/init", { method: "POST", body: JSON.stringify(options) }) as Promise<ProjectInitResult>,

  syncScene: (scene: unknown, projectPath: string): Promise<SceneUploadResult> =>
    request("/projects/sync", {
      method: "POST",
      body: JSON.stringify({ scene, projectPath }),
      headers: { [PROJECT_HEADER]: projectPath },
    }) as Promise<SceneUploadResult>,

  saveRender: (
    sceneId: string,
    quality: "draft" | "production",
    mp4Base64: string,
    projectPath: string
  ): Promise<{ file: string; latest: string; status: string; projectRenderFilePath: string }> =>
    request("/projects/renders", {
      method: "POST",
      body: JSON.stringify({ sceneId, quality, mp4Base64 }),
      headers: { [PROJECT_HEADER]: projectPath },
    }) as Promise<{ file: string; latest: string; status: string; projectRenderFilePath: string }>,

  saveStills: (
    sceneId: string,
    frames: Array<{ atMs: number; image: string }>,
    projectPath: string
  ): Promise<{ files: string[]; savedStillsFilePaths: string[] }> =>
    request("/projects/stills", {
      method: "POST",
      body: JSON.stringify({ sceneId, frames }),
      headers: { [PROJECT_HEADER]: projectPath },
    }) as Promise<{ files: string[]; savedStillsFilePaths: string[] }>,

  keyframes: (sceneId: string, at: number[]): Promise<{ frames: KeyframeFrame[]; framesMeta: KeyframeFrameMeta[] }> =>
    request(`/api/scenes/${encodeURIComponent(sceneId)}/keyframes`, {
      method: "POST",
      body: JSON.stringify({ at }),
    }) as Promise<{ frames: KeyframeFrame[]; framesMeta: KeyframeFrameMeta[] }>,

  previewUrl: (sceneId: string): string =>
    `${ENGINE_URL}/preview/?scene=${encodeURIComponent(sceneId)}`,

  enqueueRender: (sceneId: string, quality: "draft" | "production"): Promise<{ jobId: string; status: string }> =>
    request("/api/renders", {
      method: "POST",
      body: JSON.stringify({ sceneId, quality }),
    }) as Promise<{ jobId: string; status: string }>,

  renderJob: (jobId: string): Promise<RenderJobView> =>
    request(`/api/renders/${encodeURIComponent(jobId)}`) as Promise<RenderJobView>,

  renderFileBase64: (jobId: string): Promise<{ mp4Base64: string; sceneId: string; quality: string }> =>
    request(`/api/renders/${encodeURIComponent(jobId)}/file/base64`) as Promise<{
      mp4Base64: string;
      sceneId: string;
      quality: string;
    }>,
};
