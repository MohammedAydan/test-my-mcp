import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import type {
  BoundsFrameReport,
  RenderResultReport,
  SceneAnalysisReport,
  SceneBoundsReport,
  SceneSpec,
} from "@motionforge/scene-spec";
import { resolveCanvasSize, sanitizeSceneInput } from "@motionforge/scene-spec";
import { buildBoundsFrameReport } from "./bounds-report.js";
import { capabilities } from "./capabilities.js";
import {
  engineConfig,
  resolveEnginePaths,
  type EngineConfig,
  type EnginePathOptions,
  type EnginePaths,
} from "./config.js";
import {
  buildCostReport,
  computeWorkerBudget,
  detectHeavyEffects,
  estimatedFrameMs,
  hostFacts,
  perFrameMultiplier,
} from "./cost-analysis.js";
import type { FrameMeta, InspectedFrame } from "./keyframes.js";
import { probeMedia } from "./media-probe.js";
import { resolveProjectAssets } from "./project-assets.js";
import { RenderRunner, type RenderJob, type RenderQuality } from "./render-runner.js";
import { analyzeScene as analyzeSceneWarnings } from "./scene-analysis.js";
import {
  applyAutoFixes,
  computeCritiqueScore,
  computeSampleTimes,
  evaluateCritiqueIssues,
  type CritiqueOptions,
  type CritiqueReport,
} from "./scene-critic.js";
import {
  choreographSceneAudio,
  type AudioChoreographyOptions,
  type AudioChoreographyReport,
} from "./audio-choreographer.js";
import {
  generateStoryboardFromBrief,
  type StoryboardBrief,
  type StoryboardReport,
} from "./storyboard-generator.js";
import { SceneStore, sceneHash, type StoredScene } from "./scene-store.js";
import { storeScene, type SceneStoreResponse } from "./scene-operations.js";
import { ensureSfxBank } from "./sfx-bank.js";
import { WarmPage, WARM_FPS } from "./warm-page.js";
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
  /**
   * The long-lived browser page the measurement paths push scenes into.
   *
   * It is created LAZILY: a process that only stores scenes never opens a
   * browser at all.
   */
  private warm: WarmPage | null = null;

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
    // The last line of defence.
    //
    // The Studio is a direct-manipulation editor: it attaches spatial and NLE
    // properties (position, scale, opacity, visible, locked …) to whichever
    // layer the user grabbed — including the `background` at `layers.0`. Those
    // properties are part of the contract now, but a scene can still carry
    // transient UI-only bookkeeping, and a legacy project can still carry
    // keys the schema has retired. Normalizing here means the store NEVER
    // sees an unsanitizable scene, no matter which client called.
    const sanitized = sanitizeSceneInput(scene);

    const res = await storeScene({
      body: sanitized,
      store: this.store,
      paths: this.paths,
      port: this.config.port,
      projectPath,
    });
    const { body } = res;

    if ("error" in body) {
      const err = new Error(
        body.error + (body.issues.length ? ": " + body.issues.join("; ") : "")
      ) as Error & { issues?: string[]; status?: number };
      err.issues = body.issues;
      err.status = res.status;
      throw err;
    }

    const saved: SceneStoreResponse = body;
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

  /**
   * The frames of a scene at a list of timestamps — with their pictures AND
   * their numbers.
   *
   * THE WARM PAGE IS THE ONLY MEASUREMENT AUTHORITY. The inspection and the
   * zero-rasterisation layout query now run on the SAME page, with the SAME
   * viewport and the SAME `describeFrame` measurement — so the two can never
   * disagree about where a layer is. They used to be two different pages,
   * which left a residual of 12.7 px (0.66 % of the canvas) between them.
   *
   * The MEASUREMENT pass uses the layout settle (no media resync, no image
   * decode) and the CAPTURE pass uses the full settle, so the picture is
   * right and the numbers are comparable.
   */
  async inspectKeyframes(
    sceneId: string,
    options: { at?: number[]; includeFullResolution?: boolean } = {}
  ): Promise<{ frames: InspectedFrame[]; framesMeta: unknown[] }> {
    const found = this.store.require(sceneId);
    const stamps = options.at?.filter((n) => Number.isFinite(n) && n >= 0) ?? [0];
    const { width, height } = resolveCanvasSize(found.scene.canvas);

    const warm = this.warmPage();
    await warm.mount(found.scene, sceneId, WARM_FPS);
    const captured = await warm.inspectFrames(stamps, {
      width,
      height,
      includeFullResolution: options.includeFullResolution === true,
    });

    const frames: InspectedFrame[] = captured.map((frame) => ({
      atMs: frame.atMs,
      image: frame.image,
      preview: frame.preview,
      ...(frame.describe && typeof frame.describe === "object"
        ? { meta: { atMs: frame.atMs, ...(frame.describe as object) } as FrameMeta }
        : {}),
    }));
    return { frames, framesMeta: frames.map((f) => f.meta ?? { atMs: f.atMs }) };
  }

  async getLayerBounds(sceneId: string, frameIndex: number): Promise<Record<string, unknown>> {
    const found = this.store.require(sceneId);
    const warm = this.warmPage();
    await warm.mount(found.scene, sceneId, WARM_FPS);
    // the legacy API takes a FRAME index; the warm page takes milliseconds
    const report = await warm.frameReport((frameIndex / WARM_FPS) * 1000);
    return report.bounds;
  }

  // -------------------------------------------------------------------------
  // The warm measurement path — numbers, not pixels
  // -------------------------------------------------------------------------

  /**
   * The LAYOUT of a scene at a list of timestamps — with NO rasterisation.
   *
   * The scene is mounted on the warm page (one long-lived browser page, no
   * navigation) and every timestamp is answered with NUMBERS: the camera
   * pose, the per-layer lifecycle, the painted box, the composition box, the
   * overlapping pairs and the layers that hang off the canvas edge.
   *
   * This is the fast sibling of `inspectKeyframes` (which rasterises, because
   * a picture is the only way to answer "does it LOOK right") and the fast
   * replacement for `getLayerBounds` (which opens a browser per call).
   */
  async getLayerBoundsAt(sceneId: string, timesMs: number[]): Promise<SceneBoundsReport> {
    const started = Date.now();
    const found = this.store.require(sceneId);
    const scene = found.scene;
    const canvas = resolveCanvasSize(scene.canvas);
    const stamps = (timesMs ?? [])
      .filter((ms) => Number.isFinite(ms) && ms >= 0)
      .map((ms) => Math.round(ms));

    const warm = this.warmPage();
    await warm.mount(scene, sceneId, WARM_FPS);

    // ONE round-trip for every timestamp: the scene is mounted ONCE and the
    // page seeks through the requested times — never a re-mount per stamp.
    const reports = await warm.measureFrames(stamps);

    const frames: BoundsFrameReport[] = reports.map((report, index) =>
      buildBoundsFrameReport({
        atMs: stamps[index] ?? 0,
        describe: report.describe,
        bounds: report.bounds,
        canvas,
      })
    );

    return {
      sceneId,
      canvas: { width: canvas.width, height: canvas.height },
      frames,
      elapsedMs: Date.now() - started,
      warm: true,
    };
  }

  /**
   * The static + dynamic analysis of a scene: what is wrong with it, what it
   * will cost to render on THIS host, and which keyframe array wins.
   */
  async analyzeScene(sceneId: string): Promise<SceneAnalysisReport> {
    const found = this.store.require(sceneId);
    const scene = found.scene;

    // the engine's own non-blocking diagnostics (camera void, dead frames, …)
    const warnings = analyzeSceneWarnings(scene);

    // ONE cost report — the same function the render pre-flight calls, so the
    // estimate a caller reads is the estimate the render used.
    const cost = buildCostReport(scene);

    return {
      sceneId,
      layerCount: scene.layers.length,
      durationMs: scene.durationMs,
      warnings,
      cost,
      keyframePrecedence: buildKeyframePrecedence(scene),
    };
  }

  /**
   * Autonomous art director: critique a scene across layout overlaps, safe margins,
   * WCAG contrast, dead air frames, visual clutter, timing overflows, and render cost hazards.
   * Optionally auto-applies fixes and saves the repaired scene.
   */
  async critiqueAndAutofixScene(
    sceneId: string,
    options?: CritiqueOptions
  ): Promise<CritiqueReport> {
    const found = this.store.require(sceneId);
    const scene = found.scene;
    const autoApplyFixes = options?.autoApplyFixes !== false;
    const sampleTimes = computeSampleTimes(scene, options?.sampleTimesMs);

    const boundsBefore = await this.getLayerBoundsAt(sceneId, sampleTimes);
    const warningsBefore = analyzeSceneWarnings(scene);
    const issuesBefore = evaluateCritiqueIssues(scene, boundsBefore, warningsBefore);
    const scoreBefore = computeCritiqueScore(issuesBefore);

    if (!autoApplyFixes || issuesBefore.length === 0) {
      return {
        sceneId,
        revision: found.revision,
        scoreBefore,
        scoreAfter: scoreBefore,
        issuesBefore,
        appliedFixes: [],
        issuesAfter: issuesBefore,
        sampledTimesMs: sampleTimes,
      };
    }

    const { fixedScene, appliedFixes } = applyAutoFixes(scene, issuesBefore, boundsBefore);

    if (appliedFixes.length === 0) {
      return {
        sceneId,
        revision: found.revision,
        scoreBefore,
        scoreAfter: scoreBefore,
        issuesBefore,
        appliedFixes: [],
        issuesAfter: issuesBefore,
        sampledTimesMs: sampleTimes,
      };
    }

    await this.saveScene(fixedScene);
    const reloaded = this.store.require(sceneId);
    const boundsAfter = await this.getLayerBoundsAt(sceneId, sampleTimes);
    const warningsAfter = analyzeSceneWarnings(reloaded.scene);
    const issuesAfter = evaluateCritiqueIssues(reloaded.scene, boundsAfter, warningsAfter);
    const scoreAfter = computeCritiqueScore(issuesAfter);

    return {
      sceneId,
      revision: reloaded.revision,
      scoreBefore,
      scoreAfter,
      issuesBefore,
      appliedFixes,
      issuesAfter,
      sampledTimesMs: sampleTimes,
    };
  }

  /**
   * Automatically choreographs audio SFX cues across the 14-cue bank for a scene,
   * saves the updated scene, and returns the choreography report.
   */
  async autoChoreographAudio(
    sceneId: string,
    options?: AudioChoreographyOptions
  ): Promise<AudioChoreographyReport> {
    const found = this.store.require(sceneId);
    const result = choreographSceneAudio(found.scene, options);
    const saved = await this.saveScene(result.updatedScene, found.projectPath);
    return {
      sceneId,
      revision: saved.revision,
      cuesAdded: result.cuesAdded,
      totalCues: result.totalCues,
      bySfx: result.bySfx,
      ambientIncluded: result.ambientIncluded,
      skipped: result.skipped,
    };
  }

  /**
   * Synthesizes a cohesive multi-scene video storyboard from a project brief.
   */
  async generateStoryboardFromBrief(brief: StoryboardBrief): Promise<StoryboardReport> {
    return generateStoryboardFromBrief(this, brief);
  }

  /**
   * The finished result of a render job — with the ffprobe view of the file.
   *
   * A job that is still running returns its status and progress and NO
   * probe: there is no file to probe yet.
   */
  async getRenderResult(jobId: string): Promise<RenderResultReport> {
    const job = this.getRenderStatus(jobId);
    if (!job) {
      const err = new Error(`unknown render job "${jobId}"`) as Error & {
        status?: number;
        statusCode?: number;
      };
      err.status = 404;
      err.statusCode = 404;
      throw err;
    }

    const report: RenderResultReport = {
      jobId: job.id,
      sceneId: job.sceneId,
      quality: job.quality,
      status: job.status,
      progress: job.progress,
      ...(job.error ? { error: job.error } : {}),
      ...(job.result
        ? {
            outputPath: job.result.mp4Path,
            telemetry: {
              frames: job.result.frames,
              wallMs: job.result.wallMs,
              effectiveFps: job.result.effectiveFps,
              encoder: job.result.encoder,
              workerCount: job.result.workerCount,
              profile: {
                quality: job.result.profile.quality,
                fps: job.result.profile.fps,
                outWidth: job.result.profile.outWidth,
                outHeight: job.result.profile.outHeight,
                jpegQuality: job.result.profile.jpegQuality,
              },
            },
          }
        : {}),
    };

    if (job.status === "succeeded" && job.result?.mp4Path) {
      report.probe = await probeMedia(job.result.mp4Path);
    }
    return report;
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

  /**
   * The warm page — created on FIRST USE, kept until `dispose()`.
   *
   * A process that only stores scenes never opens a browser: the page is
   * built the first time a measurement asks for one.
   */
  private warmPage(): WarmPage {
    this.warm ??= new WarmPage({
      baseUrl: `http://127.0.0.1:${this.config.port}`,
      paths: this.paths,
      store: this.store,
      log: this.log,
    });
    return this.warm;
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
      const { validateScene, sanitizeSceneInput } = await import("@motionforge/scene-spec");
      const validation = validateScene(sanitizeSceneInput(envelope, { dropUnknown: true }));
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
    // the warm page holds a whole Chromium process, and the render pool holds
    // one per worker — both must not outlive the engine
    const warm = this.warm;
    this.warm = null;
    await warm?.dispose();
    await this.runner.dispose();
    this.removeAllListeners();
  }
}

/**
 * Which keyframe array wins when a layer carries BOTH.
 *
 * The flat `keyframes` array is canonical: for every property it drives it
 * WINS over the legacy `tracks` array. The legacy array still drives the
 * properties the canonical one does not mention, so a scene that carries
 * both is not broken — it is just ambiguous, and the ambiguity is reported
 * here instead of being resolved silently.
 */
function buildKeyframePrecedence(scene: SceneSpec): SceneAnalysisReport["keyframePrecedence"] {
  const conflicts: SceneAnalysisReport["keyframePrecedence"]["conflicts"] = [];
  for (const layer of scene.layers) {
    const canonical = layer.keyframes ?? [];
    const legacy = layer.tracks ?? [];
    if (canonical.length === 0 || legacy.length === 0) continue;
    conflicts.push({
      layerId: layer.id,
      canonicalProperties: [...new Set(canonical.map((keyframe) => keyframe.property))].sort(),
      legacyProperties: [...new Set(legacy.map((track) => track.property))].sort(),
    });
  }
  return {
    canonical: "keyframes",
    legacy: "tracks",
    rule:
      "The flat `keyframes` array is canonical: for every property it drives it WINS over the legacy " +
      "`tracks` array; `tracks` only drives the properties `keyframes` does not mention.",
    conflicts,
  };
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

export type { AudioChoreographyOptions, AudioChoreographyReport };
