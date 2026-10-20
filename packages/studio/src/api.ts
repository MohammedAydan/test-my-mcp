import type { CapabilitiesResponse, StudioScene } from './types.js';
import { invokeEngine, isElectron as detectElectron, onEngineEvent } from './services/engine-bridge.js';
import {
  deleteScene as engineDeleteScene,
  getScene as engineGetScene,
  inspectKeyframes as engineInspectKeyframes,
  listScenes as engineListScenes,
  saveScene as engineSaveScene,
  sanitizeSceneForEngine,
  unwrapPayload,
} from './services/scene-service.js';
import { ingestAsset as engineIngestAsset, listAssets as engineListAssets } from './services/asset-service.js';
import { getRenderStatus, startRender as engineStartRender } from './services/render-service.js';

/**
 * The Studio's API facade.
 *
 * A thin, stable surface over the services layer. Components call `api.*`;
 * `api` calls the services; the services call the engine over IPC. No
 * component ever touches `window.motionforgeEngine` directly.
 */

export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues: unknown[] = []
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export { sanitizeSceneForEngine, unwrapPayload };

export const api = {
  isElectron: detectElectron(),
  url: 'in-process',

  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = performance.now();
    try {
      await invokeEngine('getCapabilities');
      return { ok: true, latencyMs: Math.round(performance.now() - start) };
    } catch {
      return { ok: false, latencyMs: -1 };
    }
  },

  async capabilities(): Promise<CapabilitiesResponse> {
    return (await invokeEngine('getCapabilities')) as CapabilitiesResponse;
  },

  async getScene(id: string): Promise<StudioScene> {
    return engineGetScene(id);
  },

  async createScene(scene: StudioScene): Promise<{ id: string; revision: number; status: string; warnings?: string[] }> {
    return engineSaveScene(scene);
  },

  async deleteScene(id: string): Promise<{ id: string; success: boolean }> {
    return engineDeleteScene(id);
  },

  async listScenes() {
    return engineListScenes();
  },

  async listAssets() {
    return engineListAssets();
  },

  async inspect(id: string, at: number[], includeFullResolution = false) {
    return engineInspectKeyframes(id, at, includeFullResolution);
  },

  async startRender(sceneId: string, quality: 'draft' | 'production') {
    return engineStartRender(sceneId, quality);
  },

  async getRender(jobId: string) {
    return getRenderStatus(jobId);
  },

  previewUrl(sceneId: string): string {
    // `embedded=1` tells the runtime to stay out of the way: the Studio
    // provides the SMPTE transport, so the runtime must not mount its own.
    return `mf-runtime://app/index.html?scene=${encodeURIComponent(sceneId)}&embedded=1`;
  },

  async uploadAsset(filename: string, data: ArrayBuffer | Uint8Array | Blob) {
    return engineIngestAsset(filename, data);
  },

  assetVaultUrl(name: string): string {
    return `mf-vault://${name}`;
  },

  sfxUrl(name: string): string {
    return `mf-vault://_sfx/${name}.ogg`;
  },

  subscribe(sceneId: string, cb: (e: MessageEvent) => void) {
    const unsubscribe = onEngineEvent((event) => {
      if (event.eventName === 'scene:updated') {
        const payload = event.payload as { sceneId?: string };
        if (payload?.sceneId === sceneId) {
          cb(new MessageEvent('scene:updated', { data: JSON.stringify(event.payload) }));
        }
      }
    });
    return { close: unsubscribe };
  },
};

if (typeof window !== 'undefined') {
  (window as unknown as { api: typeof api }).api = api;
}
