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

function getBridge(): MotionForgeEngineBridge {
  if (typeof window !== 'undefined' && window.motionforgeEngine) {
    return window.motionforgeEngine;
  }
  // Mock / fallback for testing environments
  return {
    invoke: async (method: string) => {
      if (method === 'getCapabilities') return { schemaVersion: 1, registries: {} };
      if (method === 'listScenes') return [];
      if (method === 'listAssets') return [];
      return null;
    },
    onEvent: () => () => undefined,
  };
}

export class API {
  readonly isElectron = true;
  readonly url = 'in-process';

  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const bridge = getBridge();
    const start = performance.now();
    try {
      await bridge.invoke('getCapabilities');
      return { ok: true, latencyMs: Math.round(performance.now() - start) };
    } catch {
      return { ok: false, latencyMs: -1 };
    }
  }

  async capabilities(): Promise<CapabilitiesResponse> {
    const bridge = getBridge();
    return (await bridge.invoke('getCapabilities')) as CapabilitiesResponse;
  }

  async getScene(id: string): Promise<StudioScene> {
    const bridge = getBridge();
    const scene = (await bridge.invoke('getScene', id)) as StudioScene | null;
    if (!scene) throw new APIError(404, `unknown scene "${id}"`);
    return scene;
  }

  async createScene(
    scene: StudioScene
  ): Promise<{ id: string; revision: number; status: string; warnings?: string[] }> {
    const payload = sanitizeSceneForEngine(scene);
    const bridge = getBridge();
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

  async deleteScene(id: string): Promise<{ id: string; success: boolean }> {
    const bridge = getBridge();
    return (await bridge.invoke('deleteScene', id)) as { id: string; success: boolean };
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
    return (await bridge.invoke('listScenes')) as any;
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
    return (await bridge.invoke('listAssets')) as any;
  }

  async inspect(id: string, at: number[], includeFullResolution = false) {
    const bridge = getBridge();
    return (await bridge.invoke('inspectKeyframes', id, { at, includeFullResolution })) as any;
  }

  async startRender(sceneId: string, quality: 'draft' | 'production') {
    const bridge = getBridge();
    return (await bridge.invoke('startRender', sceneId, quality)) as { id: string; status: string };
  }

  async getRender(jobId: string) {
    const bridge = getBridge();
    return (await bridge.invoke('getRenderStatus', jobId)) as any;
  }

  previewUrl(sceneId: string): string {
    return `mf-runtime://app/index.html?scene=${encodeURIComponent(sceneId)}`;
  }

  async uploadAsset(filename: string, data: ArrayBuffer | Uint8Array | Blob) {
    const cleanName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const bridge = getBridge();
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

  assetVaultUrl(name: string): string {
    return `mf-vault://${name}`;
  }

  sfxUrl(name: string): string {
    return `mf-vault://_sfx/${name}.ogg`;
  }

  subscribe(sceneId: string, cb: (e: any) => void) {
    const bridge = getBridge();
    const unsub = bridge.onEvent((evt) => {
      if (evt.eventName === 'scene:updated' && (evt.payload as any)?.sceneId === sceneId) {
        cb(new MessageEvent('scene:updated', { data: JSON.stringify(evt.payload) }));
      }
    });
    return { close: unsub };
  }
}

export const api = new API();
if (typeof window !== 'undefined') {
  (window as unknown as { api: API }).api = api;
}
