import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import { createReadStream, existsSync } from "node:fs";

import { capabilities } from "./capabilities.js";
import type { EngineConfig } from "./config.js";
import { RenderRunner, type RenderQuality } from "./render-runner.js";
import { validateScene, type SceneValidation } from "@motionforge/scene-spec";
import {
  ensureDirs,
  mimeFor,
  sanitizeVaultName,
  saveVaultUpload,
  vaultFileExists,
  vaultFileStream,
} from "./vault.js";
import { inspectKeyframes } from "./keyframes.js";
import {
  initCreativeProject,
  ProjectWorkspaceError,
  syncSceneToDisk,
  type InitCreativeProjectOptions,
} from "./project-workspace.js";
import { SceneStore } from "./scene-store.js";
import { ensureSfxBank } from "./sfx-bank.js";

export interface Engine {
  app: FastifyInstance;
  store: SceneStore;
  runner: RenderRunner;
}

/**
 * Creative-project routes — HTTP parity for the `init_creative_project` MCP
 * tool and the project-kit CLI. All workspace logic lives in
 * `project-workspace.ts`; these routes only adapt HTTP ↔ that module.
 */
export async function registerProjectRoutes(
  app: FastifyInstance,
  opts: { store: SceneStore; port: number }
): Promise<void> {
  const { store } = opts;
  const seedScene = (scene: Parameters<typeof store.upsert>[0]) => Promise.resolve(store.upsert(scene).id);

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
    const validation: SceneValidation = validateScene(scene);
    if (!validation.ok) {
      return reply.code(400).send({ error: "invalid scene", issues: validation.issues });
    }
    const { id } = store.upsert(validation.scene);
    if (!projectPath) return reply.code(201).send({ id, scene: validation.scene });
    // same code path as the MCP tool's disk auto-sync
    const sync = await syncSceneToDisk(projectPath, validation.scene);
    return reply.code(201).send({ id, scene: validation.scene, disk: sync });
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

  const store = new SceneStore();
  const runner = new RenderRunner(config, config.paths, store, log);

  // -------------------------------------------------------------------------
  // capabilities + preview
  // -------------------------------------------------------------------------
  app.get("/api/capabilities", () => capabilities());

  if (existsSync(config.paths.runtimeDistDir)) {
    await app.register(staticFiles, {
      root: config.paths.runtimeDistDir,
      prefix: "/preview/",
      wildcard: false,
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
        return reply.sendFile("index.html", config.paths.runtimeDistDir);
      }
      return reply.code(404).send({ error: "not found" });
    });
  } else {
    log("scene-runtime/dist not built — /preview disabled until `npm run build -w @motionforge/scene-runtime`");
  }

  // -------------------------------------------------------------------------
  // scenes
  // -------------------------------------------------------------------------
  app.post("/api/scenes", async (req, reply) => {
    const validation: SceneValidation = validateScene(req.body);
    if (!validation.ok) {
      return reply.code(400).send({ error: "invalid scene", issues: validation.issues });
    }
    const scene = validation.scene;
    // vault: sources must exist in the vault (the LLM may reference assets it uploaded)
    for (const asset of scene.assets) {
      if (asset.src.startsWith("vault:")) {
        const name = sanitizeVaultName(asset.src.slice("vault:".length));
        if (!name || !vaultFileExists(config.paths, name)) {
          return reply.code(400).send({
            error: "invalid scene",
            issues: [`asset "${asset.id}" references missing vault file: ${asset.src}`],
          });
        }
      }
    }
    const { id } = store.upsert(scene);
    return reply.code(201).send({ id, scene });
  });

  app.get("/api/scenes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = store.get(id);
    if (!found) return reply.code(404).send({ error: `unknown scene "${id}"` });
    return found.scene;
  });

  // -------------------------------------------------------------------------
  // creative projects — HTTP parity for the init_creative_project MCP tool and
  // the project-kit CLI. The shared logic lives in project-workspace.ts.
  // -------------------------------------------------------------------------
  await registerProjectRoutes(app, { store, port: config.port });

  app.get("/api/scenes/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    reply.raw.write(": connected\n\n");
    const listener = (payload: { type: string }) => {
      reply.raw.write(`event: ${payload.type}\ndata: {}\n\n`);
    };
    store.bus.on(`scene:${id}`, listener);
    req.raw.on("close", () => store.bus.off(`scene:${id}`, listener));
  });

  app.post("/api/scenes/:id/keyframes", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { at } = (req.body ?? {}) as { at?: number[] };
    const stamps = at?.filter((n) => Number.isFinite(n) && n >= 0) ?? [0];
    const { scene } = store.require(id);
    const { inspectKeyframes } = await import("./keyframes.js");
    const frames = await inspectKeyframes({
      scene,
      sceneId: id,
      baseUrl: `http://127.0.0.1:${config.port}`,
      at: stamps,
    });
    return { frames };
  });

  // -------------------------------------------------------------------------
  // assets (vault)
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  await app.ready();
  await app.listen({ port: config.port, host: "127.0.0.1" });
  log(`core-engine listening on http://127.0.0.1:${config.port}`);
  return { app, store, runner };
}
