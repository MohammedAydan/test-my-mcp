import type { CapabilitiesResponse, StudioScene } from './types.js';

export class APIError extends Error {
  constructor(public status: number, message: string, public issues: unknown[] = []) {
    super(message);
    this.name = 'APIError';
  }
}

export function sanitizeSceneForEngine(scene: unknown): unknown {
  if (!scene || typeof scene !== 'object') return scene;
  const clone = JSON.parse(JSON.stringify(scene));
  if (Array.isArray(clone.layers)) {
    clone.layers = clone.layers.map((layer: Record<string, unknown>) => {
      const clean: Record<string, unknown> = { ...layer };
      for (const k of Object.keys(clean)) {
        if (k.startsWith('_')) {
          delete clean[k];
        }
      }
      return clean;
    });
  }
  return clone;
}

export class API {
  public url: string;

  constructor(url?: string) {
    const electronEngineUrl = (window as unknown as { motionforge?: { engineUrl?: string } }).motionforge?.engineUrl;
    const defaultUrl = electronEngineUrl || localStorage.getItem('motionforge_engine') || 'http://127.0.0.1:4000';
    this.url = (url || defaultUrl).replace(/\/$/, '');
  }

  setUrl(url: string) {
    this.url = url.replace(/\/$/, '');
  }

  async req<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.url + path, opts);
    } catch {
      throw new APIError(0, `Engine unreachable at ${this.url}`);
    }
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      throw new APIError(
        res.status,
        (data.error as string) || `HTTP ${res.status}`,
        (data.issues as unknown[]) || []
      );
    }
    return data as T;
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    try {
      const start = performance.now();
      await fetch(this.url + '/api/capabilities', { method: 'HEAD' });
      return { ok: true, latencyMs: Math.round(performance.now() - start) };
    } catch {
      return { ok: false, latencyMs: -1 };
    }
  }

  capabilities(): Promise<CapabilitiesResponse> {
    return this.req<CapabilitiesResponse>('/api/capabilities');
  }

  getScene(id: string): Promise<StudioScene> {
    return this.req<StudioScene>('/api/scenes/' + encodeURIComponent(id));
  }

  createScene(scene: StudioScene): Promise<{ id: string; revision: number; status: string; warnings?: string[] }> {
    const payload = sanitizeSceneForEngine(scene);
    return this.req('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  inspect(id: string, at: number[], includeFullResolution = false) {
    return this.req<{ frames: Array<{ at: number; image?: string; fullResolutionPath?: string; framesMeta: unknown }> }>(
      '/api/scenes/' + encodeURIComponent(id) + '/keyframes',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ at, includeFullResolution }),
      }
    );
  }

  startRender(sceneId: string, quality: 'draft' | 'production') {
    return this.req<{ id: string; status: string }>(
      '/api/renders',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId, quality }),
      }
    );
  }

  getRender(jobId: string) {
    return this.req<{ id: string; sceneId: string; quality: string; status: string; outputPath?: string; error?: string }>(
      '/api/renders/' + encodeURIComponent(jobId)
    );
  }

  renderFileUrl(jobId: string) {
    return `${this.url}/api/renders/${encodeURIComponent(jobId)}/file`;
  }

  previewUrl(sceneId: string) {
    return `${this.url}/preview/?scene=${encodeURIComponent(sceneId)}`;
  }

  async uploadAsset(filename: string, data: ArrayBuffer | Uint8Array | Blob) {
    const cleanName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const res = await fetch(`${this.url}/api/assets?filename=${encodeURIComponent(cleanName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new APIError(res.status, (err as { error?: string }).error || 'Upload failed');
    }
    return res.json();
  }

  assetVaultUrl(name: string) {
    return `${this.url}/api/assets/vault/${encodeURIComponent(name)}`;
  }

  sfxUrl(name: string) {
    return `${this.url}/api/assets/vault/_sfx/${encodeURIComponent(name)}.ogg`;
  }

  subscribe(sceneId: string, cb: (e: MessageEvent) => void) {
    const es = new EventSource(`${this.url}/api/scenes/${encodeURIComponent(sceneId)}/events`);
    es.addEventListener('scene:updated', cb);
    return es;
  }
}

export const api = new API();
