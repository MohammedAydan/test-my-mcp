import type { CapabilitiesResponse, MotionForgeEngineBridge, StudioScene } from './types.js';

export class APIError extends Error {
  constructor(public status: number, message: string, public issues: unknown[] = []) {
    super(message);
    this.name = 'APIError';
  }
}

/**
 * Strips Solid.js reactive Proxies and clone-breaking objects before passing
 * across the Electron V8 Structured Clone IPC boundary.
 */
export function unwrapPayload<T>(val: T): T {
  if (val === null || val === undefined || typeof val !== 'object') return val;
  if (val instanceof ArrayBuffer || val instanceof Uint8Array) return val;
  return JSON.parse(JSON.stringify(val));
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

function getBridge(): MotionForgeEngineBridge | null {
  if (typeof window !== 'undefined' && window.motionforgeEngine) {
    return window.motionforgeEngine;
  }
  return null;
}

export class API {
  public url: string;

  constructor(url?: string) {
    const electronEngineUrl = typeof window !== 'undefined' ? window.motionforge?.engineUrl : undefined;
    const defaultUrl = electronEngineUrl || (typeof localStorage !== 'undefined' ? localStorage.getItem('motionforge_engine') : '') || 'http://127.0.0.1:4000';
    this.url = (url || defaultUrl).replace(/\/$/, '');
  }

  setUrl(url: string) {
    this.url = url.replace(/\/$/, '');
  }

  get isElectron(): boolean {
    return Boolean(getBridge());
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
    const bridge = getBridge();
    if (bridge) {
      const start = performance.now();
      try {
        await bridge.invoke('getCapabilities');
        return { ok: true, latencyMs: Math.round(performance.now() - start) };
      } catch {
        return { ok: false, latencyMs: -1 };
      }
    }
    try {
      const start = performance.now();
      await fetch(this.url + '/api/capabilities', { method: 'HEAD' });
      return { ok: true, latencyMs: Math.round(performance.now() - start) };
    } catch {
      return { ok: false, latencyMs: -1 };
    }
  }

  async capabilities(): Promise<CapabilitiesResponse> {
    const bridge = getBridge();
    if (bridge) {
      return (await bridge.invoke('getCapabilities')) as CapabilitiesResponse;
    }
    return this.req<CapabilitiesResponse>('/api/capabilities');
  }

  async getScene(id: string): Promise<StudioScene> {
    const bridge = getBridge();
    if (bridge) {
      const scene = (await bridge.invoke('getScene', id)) as StudioScene | null;
      if (!scene) throw new APIError(404, `unknown scene "${id}"`);
      return scene;
    }
    return this.req<StudioScene>('/api/scenes/' + encodeURIComponent(id));
  }

  async createScene(
    scene: StudioScene
  ): Promise<{ id: string; revision: number; status: string; warnings?: string[] }> {
    const payload = sanitizeSceneForEngine(scene);
    const bridge = getBridge();
    if (bridge) {
      try {
        return (await bridge.invoke('saveScene', unwrapPayload(payload))) as {
          id: string;
          revision: number;
          status: string;
          warnings?: string[];
        };
      } catch (err: any) {
        throw new APIError(400, err?.message || 'Failed to save scene', err?.issues || []);
      }
    }
    return this.req('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async deleteScene(id: string): Promise<{ id: string; success: boolean }> {
    const bridge = getBridge();
    if (bridge) {
      return (await bridge.invoke('deleteScene', id)) as { id: string; success: boolean };
    }
    return this.req('/api/scenes/' + encodeURIComponent(id), {
      method: 'DELETE',
    });
  }

  async listScenes(): Promise<
    Array<{
      id: string;
      name: string;
      revision: number;
      hash: string;
      updatedAt: number;
      layerCount: number;
      durationMs: number;
    }>
  > {
    const bridge = getBridge();
    if (bridge) {
      return (await bridge.invoke('listScenes')) as any;
    }
    return this.req('/api/scenes');
  }

  async listAssets(): Promise<
    Array<{
      id: string;
      name: string;
      src: string;
      kind: string;
      size: number;
      mimeType: string;
    }>
  > {
    const bridge = getBridge();
    if (bridge) {
      return (await bridge.invoke('listAssets')) as any;
    }
    return this.req('/api/assets');
  }

  async inspect(id: string, at: number[], includeFullResolution = false) {
    const bridge = getBridge();
    if (bridge) {
      return (await bridge.invoke('inspectKeyframes', id, { at, includeFullResolution })) as any;
    }
    return this.req<{
      frames: Array<{ at: number; image?: string; fullResolutionPath?: string; framesMeta: unknown }>;
    }>('/api/scenes/' + encodeURIComponent(id) + '/keyframes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ at, includeFullResolution }),
    });
  }

  async startRender(sceneId: string, quality: 'draft' | 'production') {
    const bridge = getBridge();
    if (bridge) {
      return (await bridge.invoke('startRender', sceneId, quality)) as { id: string; status: string };
    }
    return this.req<{ id: string; status: string }>('/api/renders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneId, quality }),
    });
  }

  async getRender(jobId: string) {
    const bridge = getBridge();
    if (bridge) {
      return (await bridge.invoke('getRenderStatus', jobId)) as any;
    }
    return this.req<{
      id: string;
      sceneId: string;
      quality: string;
      status: string;
      outputPath?: string;
      error?: string;
    }>('/api/renders/' + encodeURIComponent(jobId));
  }

  renderFileUrl(jobId: string) {
    return `${this.url}/api/renders/${encodeURIComponent(jobId)}/file`;
  }

  previewUrl(sceneId: string) {
    return `${this.url}/preview/?scene=${encodeURIComponent(sceneId)}`;
  }

  async uploadAsset(filename: string, data: ArrayBuffer | Uint8Array | Blob) {
    const cleanName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const bridge = getBridge();
    if (bridge) {
      let buffer: Uint8Array;
      if (data instanceof Uint8Array) {
        buffer = data;
      } else if (data instanceof ArrayBuffer) {
        buffer = new Uint8Array(data);
      } else {
        buffer = new Uint8Array(await (data as Blob).arrayBuffer());
      }
      return (await bridge.invoke('ingestAsset', buffer, cleanName)) as any;
    }

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
    if (this.isElectron) {
      return `mf-vault://${name}`;
    }
    return `${this.url}/api/assets/vault/${encodeURIComponent(name)}`;
  }

  sfxUrl(name: string) {
    if (this.isElectron) {
      return `mf-vault://_sfx/${name}.ogg`;
    }
    return `${this.url}/api/assets/vault/_sfx/${encodeURIComponent(name)}.ogg`;
  }

  subscribe(sceneId: string, cb: (e: any) => void) {
    const bridge = getBridge();
    if (bridge) {
      const unsub = bridge.onEvent((evt) => {
        if (evt.eventName === 'scene:updated' && (evt.payload as any)?.sceneId === sceneId) {
          cb(new MessageEvent('scene:updated', { data: JSON.stringify(evt.payload) }));
        }
      });
      return { close: unsub };
    }

    const es = new EventSource(`${this.url}/api/scenes/${encodeURIComponent(sceneId)}/events`);
    es.addEventListener('scene:updated', cb);
    return es;
  }
}

export const api = new API();
if (typeof window !== 'undefined') {
  (window as unknown as { api: API }).api = api;
}
