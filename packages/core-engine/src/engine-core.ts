import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import type { SceneSpec } from "@motionforge/scene-spec";
import { capabilities } from "./capabilities.js";
import {
  engineConfig,
  resolveEnginePaths,
  type EngineConfig,
  type EnginePathOptions,
  type EnginePaths,
} from "./config.js";
import { getFrameBounds, inspectKeyframes, type InspectedFrame } from "./keyframes.js";
import { resolveProjectAssets } from "./project-assets.js";
import { RenderRunner, type RenderJob, type RenderQuality } from "./render-runner.js";
import { SceneStore, sceneHash, type StoredScene } from "./scene-store.js";
import { storeScene, type SceneStoreResponse } from "./server.js";
import { ensureSfxBank } from "./sfx-bank.js";
import {
  ensureDirs,
  listVaultAssets,
  mimeFor,
  sanitizeVaultName,
  saveVaultUpload,
  type AssetVaultItem,
} from "./vault.js";

export interface EngineCoreOptions extends EnginePathOptions {
  port?: number;
  maxRenderWorkers?: number;
  log?: (msg: string) => void;
  enableWatcher?: boolean;
}

export interface EngineEventMap {
  "render:progress": {
    jobId: string;
    sceneId: string;
    progressPct: number;
    currentFrame: number;
    totalFrames: number;
  };
  "render:completed": {
    jobId: string;
    sceneId: string;
    outputPath: string;
    durationMs: number;
  };
  "render:failed": {
    jobId: string;
    sceneId: string;
    error: string;
  };
  "scene:updated": {
    sceneId: string;
    revision: number;
    hash: string;
    source: "internal" | "external";
  };
  "scene:deleted": {
    sceneId: string;
    source: "internal" | "external";
  };
  "vault:updated": {
    assets: AssetVaultItem[];
  };
}

export class EngineCore extends EventEmitter {
  readonly store: SceneStore;
  readonly runner: RenderRunner;
  readonly log: (msg: string) => void;
  private watchers: fs.FSWatcher[] = [];
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private disposed = false;

  constructor(
    readonly config: EngineConfig,
    readonly paths: EnginePaths,
    readonly options?: Partial<EngineCoreOptions>
  ) {
    super();
    this.setMaxListeners(0);
    this.log = options?.log ?? (() => undefined);
    this.store = new SceneStore({
      dataDir: paths.dataDir,
      scenesDir: paths.storageDir,
    });
    this.runner = new RenderRunner(config, paths, this.store, this.log);

    // Forward runner events to EngineCore event bus
    this.runner.on("progress", (evt) => {
      this.emit("render:progress", evt);
    });
    this.runner.on("completed", (evt) => {
      this.emit("render:completed", evt);
    });
    this.runner.on("failed", (evt) => {
      this.emit("render:failed", evt);
    });
  }

  async init(): Promise<void> {
    await ensureDirs(this.paths);
    await ensureSfxBank(this.paths, this.log);
    const hydrated = await this.store.load();
    if (hydrated.loaded > 0) {
      this.log(`[EngineCore] hydrated ${hydrated.loaded} scene(s) from ${this.paths.storageDir}`);
    }
    for (const issue of hydrated.issues) {
      this.log(`[EngineCore] skipped unreadable scene ${issue.file}: ${issue.error}`);
    }

    if (this.options?.enableWatcher !== false) {
      this.startWatchers();
    }
  }

  getCapabilities(): Record<string, unknown> {
    return capabilities();
  }

  async getScene(sceneId: string): Promise<SceneSpec | null> {
    const found = this.store.get(sceneId);
    return found ? found.scene : null;
  }

  async saveScene(scene: unknown, projectPath?: string): Promise<SceneStoreResponse> {
    const res = await storeScene({
      body: scene,
      store: this.store,
      paths: this.paths,
      port: this.config.port,
      projectPath,
    });

    if ("error" in res.body) {
      const err = new Error(
        res.body.error + (res.body.issues?.length ? ": " + res.body.issues.join("; ") : "")
      ) as Error & { issues?: string[]; status?: number };
      err.issues = res.body.issues;
      err.status = res.status;
      throw err;
    }

    const saved = res.body as SceneStoreResponse;
    this.emit("scene:updated", {
      sceneId: saved.id,
      revision: saved.revision,
      hash: saved.hash,
      source: "internal",
    });

    return saved;
  }

  async deleteScene(sceneId: string): Promise<{ id: string; success: boolean }> {
    const deleted = await this.store.delete(sceneId);
    if (deleted) {
      this.emit("scene:deleted", { sceneId, source: "internal" });
    }
    return { id: sceneId, success: deleted };
  }

  async listScenes(): Promise<
    Array<{
      id: string;
      name: string;
      revision: number;
      hash: string;
      updatedAt: number;
      projectPath?: string;
      layerCount: number;
      durationMs: number;
    }>
  > {
    return this.store.list().map((entry) => ({
      id: entry.scene.id ?? "",
      name: entry.scene.name,
      revision: entry.revision,
      hash: entry.hash,
      updatedAt: entry.updatedAt,
      projectPath: entry.projectPath,
      layerCount: entry.scene.layers.length,
      durationMs: entry.scene.durationMs,
    }));
  }

  async listAssets(projectPath?: string): Promise<AssetVaultItem[]> {
    const assets = await listVaultAssets(this.paths);

    if (projectPath && fs.existsSync(projectPath)) {
      const projectAssetsDir = path.join(projectPath, "assets");
      if (fs.existsSync(projectAssetsDir)) {
        try {
          const subdirs = ["images", "video", "audio", "lottie"];
          for (const sub of subdirs) {
            const dir = path.join(projectAssetsDir, sub);
            if (!fs.existsSync(dir)) continue;
            const files = await fsp.readdir(dir);
            for (const file of files) {
              if (file.startsWith(".") || file.includes(".tmp")) continue;
              const full = path.join(dir, file);
              const stat = await fsp.stat(full);
              const existsInVault = assets.some((a) => a.name === file);
              if (!existsInVault) {
                let kind: AssetVaultItem["kind"] = "unknown";
                if (sub === "images") kind = "image";
                else if (sub === "video") kind = "video";
                else if (sub === "audio") kind = "audio";
                else if (sub === "lottie") kind = "lottie";

                assets.push({
                  id: `project:${file}`,
                  name: file,
                  src: `vault:${file}`,
                  kind,
                  size: stat.size,
                  mimeType: mimeFor(file),
                  updatedAt: Math.round(stat.mtimeMs),
                  projectPath: full,
                });
              }
            }
          }
        } catch {
          // ignore project asset reading errors
        }
      }
    }

    return assets;
  }

  async ingestAsset(
    fileBuffer: Buffer | Uint8Array,
    fileName: string,
    kind?: string,
    projectPath?: string
  ): Promise<AssetVaultItem> {
    const safeName = sanitizeVaultName(fileName);
    if (!safeName) {
      throw new Error(`Unsafe or invalid asset file name: "${fileName}"`);
    }

    const buffer = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer);
    const size = await saveVaultUpload(this.paths, safeName, buffer);

    if (projectPath && fs.existsSync(projectPath)) {
      const sub =
        kind && ["images", "video", "audio", "lottie"].includes(kind)
          ? kind
          : kind === "image"
          ? "images"
          : "images";
      const targetDir = path.join(projectPath, "assets", sub);
      try {
        await fsp.mkdir(targetDir, { recursive: true });
        await fsp.writeFile(path.join(targetDir, safeName), buffer);
      } catch {
        // ignore project disk sync issues
      }
    }

    const assets = await this.listAssets(projectPath);
    this.emit("vault:updated", { assets });

    const ext = path.extname(safeName).toLowerCase();
    let itemKind: AssetVaultItem["kind"] = "unknown";
    if ([".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"].includes(ext)) itemKind = "image";
    else if ([".mp4", ".webm", ".mov"].includes(ext)) itemKind = "video";
    else if ([".mp3", ".ogg", ".wav"].includes(ext)) itemKind = "audio";
    else if ([".json"].includes(ext)) itemKind = "lottie";

    return {
      id: safeName,
      name: safeName,
      src: `vault:${safeName}`,
      kind: itemKind,
      size,
      mimeType: mimeFor(safeName),
      updatedAt: Date.now(),
      ...(projectPath ? { projectPath } : {}),
    };
  }

  async inspectKeyframes(
    sceneId: string,
    options: { at?: number[]; includeFullResolution?: boolean } = {}
  ): Promise<{ frames: InspectedFrame[]; framesMeta: unknown[] }> {
    const found = this.store.require(sceneId);
    const stamps = options.at?.filter((n) => Number.isFinite(n) && n >= 0) ?? [0];
    const frames = await inspectKeyframes({
      scene: found.scene,
      sceneId,
      baseUrl: `http://127.0.0.1:${this.config.port}`,
      at: stamps,
      includeFullResolution: options.includeFullResolution === true,
      // zero-port: the headless page, the scene and the vault are served from
      // memory/disk — the inspection needs no listening engine
      paths: this.paths,
      store: this.store,
    });
    return { frames, framesMeta: frames.map((f) => f.meta ?? { atMs: f.atMs }) };
  }

  async getLayerBounds(sceneId: string, frameIndex: number): Promise<Record<string, unknown>> {
    const found = this.store.require(sceneId);
    return await getFrameBounds({
      scene: found.scene,
      sceneId,
      baseUrl: `http://127.0.0.1:${this.config.port}`,
      frameIndex,
      // zero-port: the headless page, the scene and the vault are served from
      // memory/disk — the measurement needs no listening engine
      paths: this.paths,
      store: this.store,
    });
  }

  async startRender(
    sceneId: string,
    quality: RenderQuality,
    projectPath?: string
  ): Promise<{ jobId: string; status: string }> {
    this.store.require(sceneId);
    const job = this.runner.enqueue(sceneId, quality);
    return { jobId: job.id, status: job.status };
  }

  getRenderStatus(jobId: string): RenderJob | undefined {
    return this.runner.jobId(jobId);
  }

  getPreviewUrl(sceneId: string): string {
    return `http://127.0.0.1:${this.config.port}/preview/?scene=${encodeURIComponent(sceneId)}`;
  }

  private startWatchers(): void {
    try {
      if (fs.existsSync(this.paths.storageDir)) {
        const sceneWatcher = fs.watch(this.paths.storageDir, (_evt, filename) => {
          if (!filename || filename.includes(".tmp") || !filename.endsWith(".json")) return;
          this.scheduleSceneSync(filename);
        });
        this.watchers.push(sceneWatcher);
      }
    } catch (err) {
      this.log(`[EngineCore] scene watcher notice: ${err}`);
    }

    try {
      if (fs.existsSync(this.paths.vaultDir)) {
        const vaultWatcher = fs.watch(this.paths.vaultDir, { recursive: true }, (_evt, filename) => {
          if (!filename || filename.includes(".tmp")) return;
          this.scheduleVaultSync();
        });
        this.watchers.push(vaultWatcher);
      }
    } catch (err) {
      this.log(`[EngineCore] vault watcher notice: ${err}`);
    }
  }

  private scheduleSceneSync(filename: string): void {
    if (this.disposed) return;
    const existing = this.debounceTimers.get(`scene:${filename}`);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(`scene:${filename}`);
      await this.handleExternalSceneChange(filename);
    }, 100);
    this.debounceTimers.set(`scene:${filename}`, timer);
  }

  private scheduleVaultSync(): void {
    if (this.disposed) return;
    const key = "vault:sync";
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(key);
      const assets = await this.listAssets();
      this.emit("vault:updated", { assets });
    }, 150);
    this.debounceTimers.set(key, timer);
  }

  private async handleExternalSceneChange(filename: string): Promise<void> {
    const fullPath = path.join(this.paths.storageDir, filename);
    const sceneId = path.basename(filename, ".json");

    if (!fs.existsSync(fullPath)) {
      // Scene deleted on disk by another process
      if (this.store.get(sceneId)) {
        this.store.removeEntry(sceneId);
        this.emit("scene:deleted", { sceneId, source: "external" });
      }
      return;
    }

    try {
      const rawText = await fsp.readFile(fullPath, "utf8");
      const parsed = JSON.parse(rawText);
      const envelope = parsed && typeof parsed === "object" && "scene" in parsed ? parsed.scene : parsed;
      const { validateScene } = await import("@motionforge/scene-spec");
      const validation = validateScene(envelope);
      if (!validation.ok) return;

      const scene: SceneSpec = validation.scene;
      scene.id ??= sceneId;
      const newHash = sceneHash(scene);
      const existing = this.store.get(sceneId);

      if (!existing || existing.hash !== newHash) {
        const storedEntry: StoredScene = {
          scene,
          updatedAt: typeof parsed?.updatedAt === "number" ? parsed.updatedAt : Date.now(),
          revision: typeof parsed?.revision === "number" ? parsed.revision : (existing?.revision ?? 0) + 1,
          hash: newHash,
          ...(typeof parsed?.projectPath === "string" ? { projectPath: parsed.projectPath } : {}),
        };
        this.store.setEntry(sceneId, storedEntry);
        this.emit("scene:updated", {
          sceneId,
          revision: storedEntry.revision,
          hash: newHash,
          source: "external",
        });
      }
    } catch {
      // ignore partial reads or temporary locks
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {}
    }
    this.watchers.length = 0;
    this.removeAllListeners();
  }
}

export async function createEngineCore(
  options?: Partial<EngineCoreOptions>
): Promise<EngineCore> {
  const paths = resolveEnginePaths(options);
  const config = engineConfig({
    port: options?.port,
    maxRenderWorkers: options?.maxRenderWorkers,
  });
  config.paths = paths;

  const core = new EngineCore(config, paths, options);
  await core.init();
  return core;
}
