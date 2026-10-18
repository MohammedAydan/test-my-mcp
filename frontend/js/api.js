// ============================================================
// MotionForge Studio — Core Engine API Client
// ============================================================

export class APIError extends Error {
  constructor(status, message, issues) {
    super(message);
    this.status = status;
    this.issues = issues || [];
  }
}

export function sanitizeSceneForEngine(scene) {
  if (!scene || typeof scene !== 'object') return scene;
  const clone = structuredClone(scene);
  if (Array.isArray(clone.layers)) {
    clone.layers = clone.layers.map((layer) => {
      const clean = { ...layer };
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
  constructor(url) {
    const defaultUrl = window.motionforge?.engineUrl || 'http://127.0.0.1:4000';
    this.url = (url || defaultUrl).replace(/\/$/, '');
  }

  setUrl(url) {
    this.url = url.replace(/\/$/, '');
  }

  async req(path, opts = {}) {
    let res;
    try {
      res = await fetch(this.url + path, opts);
    } catch (e) {
      throw new APIError(0, `Engine unreachable at ${this.url}`);
    }
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      throw new APIError(res.status, data.error || `HTTP ${res.status}`, data.issues);
    }
    return data;
  }

  async ping() {
    try {
      const start = performance.now();
      await fetch(this.url + '/api/capabilities', { method: 'HEAD' });
      return { ok: true, latencyMs: Math.round(performance.now() - start) };
    } catch {
      return { ok: false, latencyMs: -1 };
    }
  }

  capabilities() {
    return this.req('/api/capabilities');
  }

  getScene(id) {
    return this.req('/api/scenes/' + encodeURIComponent(id));
  }

  createScene(scene) {
    const payload = sanitizeSceneForEngine(scene);
    return this.req('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  inspect(id, at, includeFullResolution = false) {
    return this.req('/api/scenes/' + encodeURIComponent(id) + '/keyframes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ at, includeFullResolution }),
    });
  }

  startRender(sceneId, quality) {
    return this.req('/api/renders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneId, quality }),
    });
  }

  getRender(jobId) {
    return this.req('/api/renders/' + encodeURIComponent(jobId));
  }

  renderFileUrl(jobId) {
    return `${this.url}/api/renders/${encodeURIComponent(jobId)}/file`;
  }

  previewUrl(sceneId) {
    return `${this.url}/preview/?scene=${encodeURIComponent(sceneId)}`;
  }

  async uploadAsset(filename, data) {
    const cleanName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const res = await fetch(`${this.url}/api/assets?filename=${encodeURIComponent(cleanName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new APIError(res.status, err.error || 'Upload failed');
    }
    return res.json();
  }

  assetVaultUrl(name) {
    return `${this.url}/api/assets/vault/${encodeURIComponent(name)}`;
  }

  sfxUrl(name) {
    return `${this.url}/api/assets/vault/_sfx/${encodeURIComponent(name)}.ogg`;
  }

  subscribe(sceneId, cb) {
    const es = new EventSource(`${this.url}/api/scenes/${encodeURIComponent(sceneId)}/events`);
    es.addEventListener('scene:updated', cb);
    return es;
  }
}

export const ENGINE_URL = localStorage.getItem('motionforge_engine') || 'http://127.0.0.1:4000';
export const api = new API(ENGINE_URL);
