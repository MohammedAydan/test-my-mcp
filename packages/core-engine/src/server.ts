import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { capabilities } from "./capabilities.js";
import type { EngineConfig, EnginePaths } from "./config.js";
import { RenderRunner, type RenderQuality } from "./render-runner.js";
import { validateScene, type ProjectQuality, type SceneSpec } from "@motionforge/scene-spec";
import type { ResolvedAsset } from "./project-assets.js";
import {
  ensureDirs,
  listVaultAssets,
  mimeFor,
  sanitizeVaultName,
  saveVaultUpload,
  vaultFileExists,
  vaultFileStream,
} from "./vault.js";
import { inspectKeyframes, getFrameBounds } from "./keyframes.js";
import {
  initCreativeProject,
  ProjectWorkspaceError,
  saveFramesMetaToDisk,
  saveRenderToDisk,
  saveStillsToDisk,
  syncSceneToDisk,
  type InitCreativeProjectOptions,
} from "./project-workspace.js";
import {
  resolveProjectAssets,
  unresolvedAssetIssues,
} from "./project-assets.js";
import { analyzeScene, summarizeWarnings, type SceneWarning } from "./scene-analysis.js";
import { SceneStore } from "./scene-store.js";
import { ensureSfxBank } from "./sfx-bank.js";

export interface Engine {
  app: FastifyInstance;
  store: SceneStore;
  runner: RenderRunner;
}

export interface ProjectRoutesDeps {
  store: SceneStore;
  port: number;
  paths: EnginePaths;
}

/** The body a scene-store response carries. Shared by both scene routes. */
export interface SceneStoreResponse {
  id: string;
  status: "created" | "updated";
  revision: number;
  hash: string;
  warnings: SceneWarning[];
  previewUrl: string;
  scene: SceneSpec;
  savedSceneFilePath?: string;
  assetsResolved?: ResolvedAsset[];
}

/**
 * Validate, asset-resolve and store a scene.
 *
 * Shared by `POST /api/scenes` and `POST /projects/sync` so the MCP tool and the
 * CLI can never diverge on what "storing a scene" means — including the
 * non-blocking warnings and the project asset resolution.
 */
export async function storeScene(opts: {
  body: unknown;
  store: SceneStore;
  paths: EnginePaths;
  port: number;
  projectPath?: string;
}): Promise<{ status: number; body: SceneStoreResponse | { error: string; issues: string[] } }> {
  const validation = validateScene(opts.body);
  if (!validation.ok) {
    return { status: 400, body: { error: "invalid scene", issues: validation.issues } };
  }
  const scene = validation.scene;
  const projectPath = opts.projectPath;

  // Pull any project-local artwork into the vault before the existence check, so
  // `vault:logo.png` resolves from `<project>/assets/images/logo.png`.
  let assetsResolved: ResolvedAsset[] | undefined;
  if (projectPath) {
    const outcome = await resolveProjectAssets(scene, { projectPath, enginePaths: opts.paths });
    assetsResolved = outcome.resolved;
    if (outcome.unresolved.length > 0) {
      return {
        status: 400,
        body: { error: "invalid scene", issues: unresolvedAssetIssues(outcome.unresolved) },
      };
    }
  }

  for (const asset of scene.assets) {
    if (!asset.src.startsWith("vault:")) continue;
    const name = sanitizeVaultName(asset.src.slice("vault:".length));
    if (!name || !vaultFileExists(opts.paths, name)) {
      return {
        status: 400,
        body: {
          error: "invalid scene",
          issues: [`asset "${asset.id}" references missing vault file: ${asset.src}`],
        },
      };
    }
  }

  const upserted = await opts.store.upsert(scene, projectPath ? { projectPath } : {});
  const warnings: SceneWarning[] = analyzeScene(scene);
  const response: SceneStoreResponse = {
    id: upserted.id,
    status: upserted.status,
    revision: upserted.revision,
    hash: upserted.hash,
    warnings,
    previewUrl: `http://127.0.0.1:${opts.port}/preview/?scene=${encodeURIComponent(upserted.id)}`,
    scene,
    ...(assetsResolved && assetsResolved.length > 0 ? { assetsResolved } : {}),
  };

  if (projectPath) {
    const sync = await syncSceneToDisk(projectPath, scene);
    response.savedSceneFilePath = `${projectPath.replace(/\/+$/, "")}/${sync.file}`;
    if (sync.manifestError) {
      // the scene file was written; only the manifest is missing
      warnings.push({
        code: "PROJECT_MANIFEST_MISSING",
        path: "projectPath",
        message:
          `scene written to ${sync.file}, but the project manifest could not be updated: ${sync.manifestError} ` +
          `Run init_creative_project (or \`npm run init-project\`) in that directory first.`,
      });
    }
  }

  return { status: upserted.status === "created" ? 201 : 200, body: response };
}

/**
 * The scene route — the single write path for a SceneSpec.
 *
 * Extracted from `startEngine` so it can be unit-tested with `app.inject()`
 * without booting the whole engine (a listening socket, a browser pool, a
 * render queue).
 */
export async function registerSceneRoutes(
  app: FastifyInstance,
  opts: { store: SceneStore; paths: EnginePaths; port: number }
): Promise<void> {
  const { store, paths, port } = opts;
  const sceneRoute = async (
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    // `projectPath` may ride along in the body (the MCP tool's auto-sync) or as
    // a header; both enable project asset resolution + disk sync.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const headerPath = req.headers["x-motionforge-project"];
    const rawProjectPath = body.projectPath ?? headerPath;
    const projectPath =
      typeof rawProjectPath === "string" && rawProjectPath.length > 0 ? rawProjectPath : undefined;
    // `projectPath` is an envelope field, not part of SceneSpec — strip it so
    // the strict schema does not reject it as an unknown key
    const { projectPath: _ignored, ...scene } = body;
    const result = await storeScene({
      body: scene,
      store,
      paths,
      port,
      ...(projectPath ? { projectPath } : {}),
    });
    return reply.code(result.status).send(result.body);
  };
  app.post("/api/scenes", sceneRoute);

  app.get("/api/scenes", async () => {
    return store.list().map((entry) => ({
      id: entry.scene.id ?? "",
      name: entry.scene.name,
      revision: entry.revision,
      hash: entry.hash,
      updatedAt: entry.updatedAt,
      projectPath: entry.projectPath,
      layerCount: entry.scene.layers.length,
      durationMs: entry.scene.durationMs,
    }));
  });

  // the preview bundle fetches the scene it is about to render, so this route is
  // part of the scene contract — not an incidental extra
  app.get("/api/scenes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = store.get(id);
    if (!found) return reply.code(404).send({ error: `unknown scene "${id}"` });
    return found.scene;
  });

  app.delete("/api/scenes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await store.delete(id);
    if (!deleted) return reply.code(404).send({ error: `unknown scene "${id}"` });
    return reply.code(200).send({ id, success: true });
  });

  /**
   * Exact-frame inspection.
   *
   * The renderer loads the preview page over HTTP, so the base URL is taken
   * from the request itself rather than from the configured port: the test
   * harness listens on an ephemeral port, and hard-coding one would make this
   * route untestable for the very reason it matters (payload size).
   */
  app.post("/api/scenes/:id/keyframes", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { at, includeFullResolution } = (req.body ?? {}) as {
      at?: number[];
      includeFullResolution?: boolean;
    };
    const stamps = at?.filter((n) => Number.isFinite(n) && n >= 0) ?? [0];
    const { scene } = store.require(id);
    const frames = await inspectKeyframes({
      scene,
      sceneId: id,
      baseUrl: selfBaseUrl(req, port),
      at: stamps,
      // the full-resolution PNG is only produced when the caller is going to
      // write it to disk — an inline caller gets the lightweight preview
      includeFullResolution: includeFullResolution === true,
    });
    // `frames[].meta` is the numeric sidecar (camera / transitions / per-layer
    // lifecycle + overflow) — the MCP tool renders it as `framesMeta`
    return { frames, framesMeta: frames.map((f) => f.meta ?? { atMs: f.atMs }) };
  });
}

/**
 * The engine's own base URL, for the frame renderer's page load.
 *
 * `inspectKeyframes` navigates Chromium to this URL, so it must resolve to the
 * listener that is actually serving. Three cases matter:
 *
 *   - a real request carries the bound host and port (the unit tests listen on
 *     an ephemeral port), which is authoritative;
 *   - `app.inject` (smoke, unit tests) synthesises `Host: localhost:80` — a
 *     placeholder, NOT the listener — so the configured port wins;
 *   - `localhost` is rewritten to `127.0.0.1`: it can resolve to `::1` while the
 *     listener is IPv4-only, and it is subject to `HTTP_PROXY`, either of which
 *     turns a working page load into `ERR_SSL_PROTOCOL_ERROR` / `ECONNREFUSED`.
 */
function selfBaseUrl(req: FastifyRequest, port: number): string {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
  const hostHeader = req.headers.host ?? "";
  const bracketed = hostHeader.startsWith("[");
  const close = bracketed ? hostHeader.indexOf("]") : -1;
  const colon = bracketed ? hostHeader.indexOf("]:") : hostHeader.lastIndexOf(":");
  const rawHostname = bracketed ? hostHeader.slice(0, close + 1) : hostHeader.split(":")[0]!;
  const headerPort = colon > 0 ? Number(hostHeader.slice(colon + 1)) : Number.NaN;
  // `app.inject` sends `Host: localhost:80` — a placeholder, not the listener
  const synthetic = !Number.isInteger(headerPort) || (headerPort === 80 && rawHostname === "localhost");

  const hostname =
    !rawHostname || rawHostname === "localhost" || rawHostname === "[::1]" ? "127.0.0.1" : rawHostname;
  return `${proto}://${hostname}:${synthetic ? port : headerPort}`;
}

/**
 * Serve the built scene-runtime bundle at `/preview/`.
 *
 * The frame renderer navigates to this URL to capture a scene, so any harness
 * that exercises `inspectKeyframes` needs it — extracted from `startEngine` so
 * the inspection tests render the same page the engine does, instead of a
 * stand-in.
 *
 * Returns false when the runtime bundle is not built, so the caller can report
 * it instead of failing obscurely at capture time.
 */
export async function registerPreviewRoutes(app: FastifyInstance, runtimeDistDir: string): Promise<boolean> {
  if (!existsSync(runtimeDistDir)) return false;
  await app.register(staticFiles, {
    root: runtimeDistDir,
    prefix: "/preview/",
    wildcard: true,
  });
  // the built bundle uses relative asset URLs — requires the trailing slash;
  // keep the original query string intact
  app.get("/preview", (req, reply) => {
    const query = req.raw.url?.includes("?") ? `?${req.raw.url.split("?")[1]}` : "";
    return reply.redirect(`/preview/${query}`, 302);
  });
  app.setNotFoundHandler((req, reply) => {
    // SPA fallback for /preview deep links
    if (req.raw.url?.startsWith("/preview")) {
      return reply.sendFile("index.html", runtimeDistDir);
    }
    return reply.code(404).send({ error: "not found" });
  });
  return true;
}

/**
 * Creative-project routes — HTTP parity for the `init_creative_project` MCP
 * tool and the project-kit CLI. All workspace logic lives in
 * `project-workspace.ts`; these routes only adapt HTTP ↔ that module.
 */
export async function registerProjectRoutes(
  app: FastifyInstance,
  opts: ProjectRoutesDeps
): Promise<void> {
  const { store, paths, port } = opts;
  const seedScene = async (scene: Parameters<typeof store.upsert>[0]): Promise<string> =>
    (await store.upsert(scene)).id;

  app.post("/projects/init", async (req, reply) => {
    try {
      const result = await initCreativeProject(req.body as InitCreativeProjectOptions, {
        // the in-process store IS the seeder — no HTTP hop, no serialization gap
        seedScene,
        engineBaseUrl: `http://127.0.0.1:${opts.port}`,
      });
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof ProjectWorkspaceError) {
        if (/is not empty/.test(error.message)) {
          return reply.code(409).send({ error: error.message });
        }
        // other validation errors (empty name, invalid canvas, etc.) -> 400
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post("/projects/sync", async (req, reply) => {
    const { scene, projectPath } = (req.body ?? {}) as { scene?: unknown; projectPath?: string };
    // identical path to the MCP tool's disk auto-sync, including warnings
    const result = await storeScene({ body: scene, store, paths, port, projectPath });
    return reply.code(result.status).send(result.body);
  });

  // file a finished render into the project and update the manifest status
  app.post("/projects/renders", async (req, reply) => {
    const { sceneId, quality, mp4Base64 } = (req.body ?? {}) as {
      sceneId?: string;
      quality?: ProjectQuality;
      mp4Base64?: string;
    };
    const stored = sceneId ? store.get(sceneId) : undefined;
    const projectPath = req.headers["x-motionforge-project"] ?? stored?.projectPath;
    if (!stored) return reply.code(404).send({ error: `unknown scene "${sceneId ?? ""}"` });
    if (typeof projectPath !== "string" || projectPath.length === 0) {
      return reply.code(400).send({ error: "no projectPath: store the scene with one, or pass X-MotionForge-Project" });
    }
    if (quality !== "draft" && quality !== "production") {
      return reply.code(400).send({ error: 'quality must be "draft" | "production"' });
    }
    if (!mp4Base64) return reply.code(400).send({ error: "mp4Base64 required" });
    try {
      const saved = await saveRenderToDisk(projectPath, sceneId as string, quality, Buffer.from(mp4Base64, "base64"));
      return reply.code(201).send({
        file: saved.file,
        latest: saved.latest,
        status: saved.status,
        projectRenderFilePath: `${projectPath.replace(/\/+$/, "")}/${saved.latest}`,
      });
    } catch (error) {
      if (error instanceof ProjectWorkspaceError) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });

  // write captured stills into the project's renders/stills/
  app.post("/projects/stills", async (req, reply) => {
    const { sceneId, frames, framesMeta } = (req.body ?? {}) as {
      sceneId?: string;
      frames?: Array<{ atMs: number; image: string }>;
      framesMeta?: unknown[];
    };
    const stored = sceneId ? store.get(sceneId) : undefined;
    const projectPath = req.headers["x-motionforge-project"] ?? stored?.projectPath;
    if (!stored) return reply.code(404).send({ error: `unknown scene "${sceneId ?? ""}"` });
    if (typeof projectPath !== "string" || projectPath.length === 0) {
      return reply.code(400).send({ error: "no projectPath: store the scene with one, or pass X-MotionForge-Project" });
    }
    if (!Array.isArray(frames) || frames.length === 0) {
      return reply.code(400).send({ error: "frames[] required" });
    }
    try {
      const files = await saveStillsToDisk(projectPath, sceneId as string, frames);
      // The numeric sidecar is persisted NEXT TO the stills, so the metadata
      // survives even when the agent inspects the project offline (and so the
      // frames can be re-checked without re-rendering).
      let metaFile: string | null = null;
      if (Array.isArray(framesMeta) && framesMeta.length > 0) {
        metaFile = await saveFramesMetaToDisk(projectPath, sceneId as string, framesMeta);
      }
      return reply.code(201).send({
        files,
        ...(metaFile ? { metaFile } : {}),
        savedStillsFilePaths: files.map((f) => `${projectPath.replace(/\/+$/, "")}/${f}`),
        ...(metaFile ? { savedFramesMetaFilePath: `${projectPath.replace(/\/+$/, "")}/${metaFile}` } : {}),
      });
    } catch (error) {
      if (error instanceof ProjectWorkspaceError) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });
}

export interface StartEngineOptions {
  config: EngineConfig;
  log?: (msg: string) => void;
}

export async function startEngine(opts: StartEngineOptions): Promise<Engine> {
  const log = opts.log ?? (() => undefined);
  const { config } = opts;
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 * 1024 });
  await app.register(cors, { origin: true });
  // raw binary asset uploads (POST /api/assets?filename=…)
  app.addContentTypeParser(
    ["application/octet-stream", "image/*", "video/*", "audio/*", "application/json-lottie"],
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body)
  );
  await ensureDirs(config.paths);
  await ensureSfxBank(config.paths, log);

  // Disk-backed store: scenes survive an engine restart. A scene that was
  // hand-edited into an illegal state is skipped and reported, never loaded.
  const store = new SceneStore(config.paths.dataDir);
  const hydrated = await store.load();
  if (hydrated.loaded > 0) log(`scene store: hydrated ${hydrated.loaded} scene(s) from data/scenes`);
  for (const issue of hydrated.issues) {
    log(`scene store: skipped ${issue.file} — ${issue.error}`);
  }
  const runner = new RenderRunner(config, config.paths, store, log);

  // -------------------------------------------------------------------------
  // capabilities + preview
  // -------------------------------------------------------------------------
  app.get("/api/capabilities", () => capabilities());

  if (!(await registerPreviewRoutes(app, config.paths.runtimeDistDir))) {
    log("scene-runtime/dist not built — /preview disabled until `npm run build -w @motionforge/scene-runtime`");
  }

  // -------------------------------------------------------------------------
  // scenes
  // -------------------------------------------------------------------------
  // the shared write path — registered through the same helper the tests use,
  // so the behaviour is identical in tests and in the running engine
  await registerSceneRoutes(app, { store, paths: config.paths, port: config.port });

  // -------------------------------------------------------------------------
  // creative projects — HTTP parity for the init_creative_project MCP tool and
  // the project-kit CLI. The shared logic lives in project-workspace.ts.
  // -------------------------------------------------------------------------
  await registerProjectRoutes(app, { store, port: config.port, paths: config.paths });

  app.get("/api/scenes/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
      connection: "keep-alive",
    });
    reply.raw.write(": connected\n\n");
    const listener = (payload: { type: string }) => {
      reply.raw.write(`event: ${payload.type}\ndata: {}\n\n`);
    };
    store.bus.on(`scene:${id}`, listener);
    req.raw.on("close", () => store.bus.off(`scene:${id}`, listener));
  });

  app.get("/api/scenes/:id/frame/:frameIndex/bounds", async (req, reply) => {
    const { id, frameIndex } = req.params as { id: string; frameIndex: string };
    const stored = store.get(id);
    if (!stored) {
      return reply.code(404).send({ error: `unknown scene "${id}"` });
    }
    const idx = parseInt(frameIndex, 10) || 0;
    try {
      const bounds = await getFrameBounds({
        scene: stored.scene,
        sceneId: id,
        baseUrl: `http://127.0.0.1:${config.port}`,
        frameIndex: idx,
      });
      return reply.send(bounds);
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // -------------------------------------------------------------------------
  // assets (vault)
  // -------------------------------------------------------------------------
  app.get("/api/assets", async () => {
    return listVaultAssets(config.paths);
  });

  app.post("/api/assets", async (req, reply) => {
    const filename = sanitizeVaultName(String((req.query as { filename?: string }).filename ?? ""));
    if (!filename) {
      return reply.code(400).send({ error: "missing or unsafe ?filename=" });
    }
    const body = req.body as Buffer | undefined;
    if (!body || body.length === 0) return reply.code(400).send({ error: "empty body" });
    const size = await saveVaultUpload(config.paths, filename, body);
    return reply.code(201).send({ src: `vault:${filename}`, bytes: size });
  });

  app.get("/api/assets/vault/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    const safe = sanitizeVaultName(name);
    if (!safe || !vaultFileExists(config.paths, safe)) {
      return reply.code(404).send({ error: "asset not found" });
    }
    return reply
      .header("content-type", mimeFor(safe))
      .send(vaultFileStream(config.paths, safe));
  });

  app.get("/api/assets/vault/_sfx/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!name.endsWith(".ogg") || !/^[a-zA-Z]+$/.test(name.slice(0, -4))) {
      return reply.code(400).send({ error: "bad sfx name" });
    }
    const file = `${config.paths.sfxDir}/${name}`;
    if (!existsSync(file)) return reply.code(404).send({ error: "sfx not found" });
    return reply.header("content-type", "audio/ogg").send(vaultFileStream(config.paths, `_sfx/${name}`));
  });

  // -------------------------------------------------------------------------
  // renders
  // -------------------------------------------------------------------------
  app.post("/api/renders", async (req, reply) => {
    const { sceneId, quality } = (req.body ?? {}) as { sceneId?: string; quality?: RenderQuality };
    if (!sceneId || store.get(sceneId) === undefined) {
      return reply.code(400).send({ error: `unknown scene "${sceneId ?? ""}"` });
    }
    if (quality !== "draft" && quality !== "production") {
      return reply.code(400).send({ error: 'quality must be "draft" | "production"' });
    }
    const job = runner.enqueue(sceneId, quality);
    return reply.code(202).send({ jobId: job.id, status: job.status });
  });

  app.get("/api/renders/:jobId", async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = runner.jobId(jobId);
    if (!job) return reply.code(404).send({ error: `unknown render job "${jobId}"` });
    return job;
  });

  app.get("/api/renders/:jobId/file", async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = runner.jobId(jobId);
    if (!job || job.status !== "succeeded" || !job.result) {
      return reply.code(404).send({ error: "render not finished" });
    }
    return reply
      .header("content-type", "video/mp4")
      .send(createReadStream(job.result.mp4Path));
  });

  /**
   * A finished render, base64-encoded.
   *
   * The MCP adapter has no filesystem access, so filing a render into a creative
   * project (and bumping the manifest status) needs the bytes over the wire.
   * Streaming back would be nicer, but a filtergraph/mux error discovered at this
   * point has to be attributable to the exact scene and quality, so the payload
   * is self-describing.
   */
  app.get("/api/renders/:jobId/file/base64", async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = runner.jobId(jobId);
    if (!job || job.status !== "succeeded" || !job.result) {
      return reply.code(404).send({ error: "render not finished" });
    }
    const bytes = await readFile(job.result.mp4Path);
    return {
      jobId,
      sceneId: job.sceneId,
      quality: job.quality,
      bytes: bytes.byteLength,
      mp4Base64: bytes.toString("base64"),
    };
  });

  // -------------------------------------------------------------------------
  await app.ready();
  await app.listen({ port: config.port, host: "127.0.0.1" });
  log(`core-engine listening on http://127.0.0.1:${config.port}`);
  return { app, store, runner };
}
