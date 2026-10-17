/**
 * HTTP client for core-engine. The MCP adapter owns no scene logic — every
 * capability comes from the engine over the wire.
 */
export const ENGINE_URL = process.env.MOTIONFORGE_ENGINE_URL ?? "http://127.0.0.1:4000";

export class EngineError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: string[]
  ) {
    super(`core-engine ${status}: ${message}`);
    this.name = "EngineError";
  }
}

export interface SceneUploadResult {
  id: string;
}

export interface KeyframeFrame {
  atMs: number;
  /** data:image/jpeg;base64,… */
  image: string;
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

export const engineClient = {
  capabilities: (): Promise<unknown> => request("/api/capabilities"),

  putScene: (scene: unknown): Promise<SceneUploadResult> =>
    request("/api/scenes", { method: "POST", body: JSON.stringify(scene) }) as Promise<SceneUploadResult>,

  keyframes: (sceneId: string, at: number[]): Promise<{ frames: KeyframeFrame[] }> =>
    request(`/api/scenes/${encodeURIComponent(sceneId)}/keyframes`, {
      method: "POST",
      body: JSON.stringify({ at }),
    }) as Promise<{ frames: KeyframeFrame[] }>,

  previewUrl: (sceneId: string): string =>
    `${ENGINE_URL}/preview/?scene=${encodeURIComponent(sceneId)}`,

  enqueueRender: (sceneId: string, quality: "draft" | "production"): Promise<{ jobId: string; status: string }> =>
    request("/api/renders", {
      method: "POST",
      body: JSON.stringify({ sceneId, quality }),
    }) as Promise<{ jobId: string; status: string }>,

  renderJob: (jobId: string): Promise<RenderJobView> =>
    request(`/api/renders/${encodeURIComponent(jobId)}`) as Promise<RenderJobView>,
};
