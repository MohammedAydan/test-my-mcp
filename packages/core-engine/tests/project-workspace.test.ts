import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import {
  validateProjectManifest,
  validateScene,
} from "@motionforge/scene-spec";

/** A complete, validated SceneSpec for tests. */
const TEST_SCENE = validateScene({
  schemaVersion: 1,
  id: "scene-01",
  name: "Test Scene",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 4000,
  assets: [],
  fonts: [],
  layers: [
    { id: "bg", type: "background", variant: { variant: "solid", color: "#05070d" } },
  ],
  camera: {},
  transitions: [],
  audio: { cues: [] },
});
if (!TEST_SCENE.ok) throw new Error(`TEST_SCENE invalid: ${TEST_SCENE.issues.join("; ")}`);
const validatedScene = TEST_SCENE.scene;

import {
  containsToken,
  createHttpSeeder,
  initCreativeProject,
  ProjectWorkspaceError,
  readProjectManifest,
  saveRenderToDisk,
  saveStillsToDisk,
  substituteTokens,
  syncSceneToDisk,
  timestampStamp,
} from "../src/project-workspace.js";
import { SceneStore } from "../src/scene-store.js";
import { registerProjectRoutes } from "../src/server.js";

let workdir: string;

beforeAll(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), "mf-workspace-"));
});

afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});

/** Create a project via the shared implementation (autoSeedScene off). */
async function scaffold(name: string, extra: Record<string, unknown> = {}) {
  return initCreativeProject(
    { name, targetPath: path.join(workdir, name), autoSeedScene: false, ...extra },
    {}
  );
}

/** Write a manifest into a scratch dir so disk-sync helpers have a project. */
async function seedManifest(dir: string, name = "manifest-job") {
  await writeFile(
    path.join(dir, "motionforge.project.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        name,
        createdAt: "2026-01-31T09:00:00.000Z",
        engine: { url: "http://127.0.0.1:4000", preferredQuality: "draft" },
        canvasDefault: { shape: "16:9", scale: 1080 },
        language: { primary: "ar", secondary: "en" },
        brand: { colors: { bg: "#05070d", accent: "#38bdf8", text: "#ffffff" }, logoAssetId: null },
        scenes: [{ id: "scene-01", file: "scenes/scene-01.json", status: "draft" }],
        workflow: { requireInspectBeforeProduction: true, autoOpenPreview: true },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  return dir;
}

describe("initCreativeProject", () => {
  it("scaffolds the full tree and returns a validated manifest + checklist", async () => {
    const result = await scaffold("acme-reel");

    expect(result.projectPath).toBe(path.join(workdir, "acme-reel"));
    expect(result.manifest.name).toBe("acme-reel");
    expect(result.filesCreatedCount).toBeGreaterThanOrEqual(50);
    expect(result.initialSceneId).toBeNull(); // autoSeedScene: false
    expect(result.operationalChecklist.length).toBeGreaterThanOrEqual(4);

    // every documented directory exists and is not empty
    for (const dir of ["scenes/_templates", "renders/draft", "renders/production", "renders/stills", "logs/agent-sessions"]) {
      expect((await readdir(path.join(result.projectPath, dir))).length, dir).toBeGreaterThan(0);
    }

    // the starter scene is a valid SceneSpec with the project id
    const scene = validateScene(JSON.parse(await readFile(path.join(result.projectPath, "scenes/scene-01.json"), "utf8")));
    if (!scene.ok) throw new Error(`scene invalid: ${scene.issues.join("; ")}`);
    expect(scene.scene.id).toBe("scene-01");

    // and the manifest on disk validates through the canonical schema
    const check = validateProjectManifest(
      JSON.parse(await readFile(path.join(result.projectPath, "motionforge.project.json"), "utf8"))
    );
    if (!check.ok) throw new Error(`manifest invalid: ${check.issues.join("; ")}`);
  });

  it("applies language, canvasDefault and brandColors to manifest", async () => {
    const result = await scaffold("vertical-job", {
      language: { primary: "en" },
      canvasDefault: { shape: "9:16", scale: 1080 },
      brandColors: { accent: "#ff00aa" },
    });

    expect(result.manifest.language.primary).toBe("en");
    expect(result.manifest.canvasDefault).toEqual({ shape: "9:16", scale: 1080 });
    expect(result.manifest.brand.colors.accent).toBe("#ff00aa");
    // untouched brand colors keep the template defaults
    expect(result.manifest.brand.colors.bg).toBe("#05070d");

    // scene-01.json keeps its own hardcoded canvas (the template default)
    const scene = JSON.parse(
      await readFile(path.join(result.projectPath, "scenes/scene-01.json"), "utf8")
    ) as { canvas: { shape: string; scale: number } };
    expect(scene.canvas).toEqual({ shape: "16:9", scale: 1080 });
  });

  it("substitutes every token in every text file (no {{...}} left)", async () => {
    const result = await scaffold("token-job", { language: { primary: "both" } });
    const files = await (async function walk(dir: string, prefix = ""): Promise<string[]> {
      const out: string[] = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), rel)));
        else if ([".md", ".json"].includes(path.extname(entry.name))) out.push(rel);
      }
      return out;
    })(result.projectPath);

    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const rel of files) {
      const text = await readFile(path.join(result.projectPath, rel), "utf8");
      expect(text, `${rel} still has a token`).not.toContain("{{");
    }
    const manifest = JSON.parse(
      await readFile(path.join(result.projectPath, "motionforge.project.json"), "utf8")
    ) as { canvasDefault: { shape: string; scale: number }; language: { primary: string } };
    expect(manifest.language.primary).toBe("both");
    expect(manifest.canvasDefault).toEqual({ shape: "16:9", scale: 1080 });
  });

  it("refuses to overwrite a non-empty directory without force", async () => {
    const target = path.join(workdir, "guarded");
    await scaffold("guarded");
    await writeFile(path.join(target, "client-notes.txt"), "precious", "utf8");

    await expect(scaffold("guarded")).rejects.toThrow(/is not empty/);

    const forced = await initCreativeProject(
      { name: "guarded", targetPath: target, autoSeedScene: false, force: true },
      {}
    );
    expect(forced.manifest.name).toBe("guarded");
    // force overwrites template files, never user files
    expect(await readFile(path.join(target, "client-notes.txt"), "utf8")).toBe("precious");
  });

  it("rejects invalid options before touching the filesystem", async () => {
    await expect(
      initCreativeProject({ name: "", targetPath: path.join(workdir, "never"), autoSeedScene: false }, {})
    ).rejects.toThrow(/name/);
    await expect(
      initCreativeProject(
        { name: "bad-canvas", targetPath: path.join(workdir, "never2"), autoSeedScene: false, canvasDefault: { shape: "9:16", scale: 3000 } },
        {}
      )
    ).rejects.toThrow(/scale/);
    await expect(stat(path.join(workdir, "never"))).rejects.toThrow();
  });

  it("seeds the starter scene and returns the engine id + previewUrl", async () => {
    const seeded: string[] = [];
    const result = await initCreativeProject(
      { name: "seeded-job", targetPath: path.join(workdir, "seeded-job"), autoSeedScene: true },
      {
        seedScene: async (scene) => {
          seeded.push(scene.id ?? scene.name);
          return "scene-01";
        },
        engineBaseUrl: "http://127.0.0.1:4000",
      }
    );
    expect(seeded).toEqual(["scene-01"]);
    expect(result.initialSceneId).toBe("scene-01");
    expect(result.previewUrl).toBe("http://127.0.0.1:4000/preview/?scene=scene-01");
  });

  it("reports seed failures without failing the project", async () => {
    const result = await initCreativeProject(
      { name: "seed-fail", targetPath: path.join(workdir, "seed-fail"), autoSeedScene: true },
      { seedScene: async () => { throw new Error("connection refused"); } }
    );
    expect(result.initialSceneId).toBeNull();
    expect(result.seedError).toContain("connection refused");
  });
});

describe("syncSceneToDisk", () => {
  it("writes scenes/<id>.json and upserts the manifest entry", async () => {
    const dir = path.join(workdir, "sync-a");
    await scaffold("sync-a");
    await seedManifest(dir);

    // sync the same scene that's already in the manifest (idempotent update)
    const scene = { ...validatedScene, id: "scene-01" };
    const first = await syncSceneToDisk(dir, scene);
    expect(first.file).toBe("scenes/scene-01.json");
    expect(first.created).toBe(false); // seedManifest already added it

    const manifest = JSON.parse(
      await readFile(path.join(dir, "motionforge.project.json"), "utf8")
    ) as { scenes: Array<{ id: string; file: string; status: string }> };
    expect(manifest.scenes.find((s) => s.id === "scene-01")).toEqual({
      id: "scene-01",
      file: "scenes/scene-01.json",
      status: "draft",
    });

    // second sync is also idempotent
    const second = await syncSceneToDisk(dir, scene);
    expect(second.created).toBe(false);
    const again = JSON.parse(
      await readFile(path.join(dir, "motionforge.project.json"), "utf8")
    ) as { scenes: unknown[] };
    expect(again.scenes).toHaveLength(1);
  });

  it("adds a brand-new scene entry for an unseen id", async () => {
    const dir = path.join(workdir, "sync-b");
    await scaffold("sync-b");
    await seedManifest(dir);

    const scene = { ...validatedScene, id: "scene-02", name: "Second" };
    await syncSceneToDisk(dir, scene);

    const manifest = JSON.parse(
      await readFile(path.join(dir, "motionforge.project.json"), "utf8")
    ) as { scenes: Array<{ id: string }> };
    expect(manifest.scenes.map((s) => s.id).sort()).toEqual(["scene-01", "scene-02"]);
    expect(
      validateScene(JSON.parse(await readFile(path.join(dir, "scenes/scene-02.json"), "utf8"))).ok
    ).toBe(true);
  });

  it("fails loudly when the project has no manifest", async () => {
    const dir = path.join(workdir, "sync-c");
    await scaffold("sync-c");
    await rm(path.join(dir, "motionforge.project.json"));
    await expect(syncSceneToDisk(dir, { ...validatedScene, id: "scene-01" })).rejects.toThrow(
      ProjectWorkspaceError
    );
  });
});

describe("saveRenderToDisk", () => {
  it("writes timestamped + latest copies and bumps the manifest status", async () => {
    const dir = path.join(workdir, "render-a");
    await scaffold("render-a");
    await seedManifest(dir);

    const mp4 = Buffer.from("fake-mp4-bytes");
    const saved = await saveRenderToDisk(dir, "scene-01", "draft", mp4, "20260131-090000");

    expect(saved.file).toBe("renders/draft/scene-01-20260131-090000.mp4");
    expect(saved.latest).toBe("renders/draft/scene-01-latest.mp4");
    expect(await readFile(path.join(dir, saved.file))).toEqual(mp4);
    expect(await readFile(path.join(dir, saved.latest))).toEqual(mp4);

    const manifest = JSON.parse(
      await readFile(path.join(dir, "motionforge.project.json"), "utf8")
    ) as { scenes: Array<{ id: string; status: string }> };
    expect(manifest.scenes.find((s) => s.id === "scene-01")?.status).toBe("draft");
  });

  it("production renders set status production, leaving draft history intact", async () => {
    const dir = path.join(workdir, "render-b");
    await scaffold("render-b");
    await seedManifest(dir);

    await saveRenderToDisk(dir, "scene-01", "draft", Buffer.from("d"), "20260131-090000");
    const prod = await saveRenderToDisk(dir, "scene-01", "production", Buffer.from("p"), "20260201-100000");

    expect(prod.file).toBe("renders/production/scene-01-20260201-100000.mp4");
    expect(await readFile(path.join(dir, "renders/draft/scene-01-20260131-090000.mp4"))).toEqual(Buffer.from("d"));
    expect(await readFile(path.join(dir, "renders/draft/scene-01-latest.mp4"))).toEqual(Buffer.from("d"));

    const manifest = JSON.parse(
      await readFile(path.join(dir, "motionforge.project.json"), "utf8")
    ) as { scenes: Array<{ id: string; status: string }> };
    expect(manifest.scenes.find((s) => s.id === "scene-01")?.status).toBe("production");
  });

  it("refuses a zero-byte MP4", async () => {
    const dir = path.join(workdir, "render-c");
    await scaffold("render-c");
    await seedManifest(dir);
    await expect(saveRenderToDisk(dir, "scene-01", "draft", Buffer.alloc(0))).rejects.toThrow(/zero-byte/);
  });
});

describe("saveStillsToDisk", () => {
  it("writes <sceneId>-<atMs>ms.png files from the engine data URLs", async () => {
    const dir = path.join(workdir, "stills-a");
    await scaffold("stills-a");
    await seedManifest(dir);

    const png = Buffer.from("89504e470d0a1a0a", "hex"); // PNG magic bytes
    const written = await saveStillsToDisk(dir, "scene-01", [
      { atMs: 500, image: `data:image/png;base64,${png.toString("base64")}` },
      { atMs: 1800, image: `data:image/png;base64,${png.toString("base64")}` },
    ]);

    expect(written).toEqual([
      "renders/stills/scene-01-500ms.png",
      "renders/stills/scene-01-1800ms.png",
    ]);
    expect(await readFile(path.join(dir, "renders/stills/scene-01-500ms.png"))).toEqual(png);
  });

  it("refuses a frame that is not a base64 image data URL", async () => {
    const dir = path.join(workdir, "stills-b");
    await scaffold("stills-b");
    await seedManifest(dir);
    await expect(
      saveStillsToDisk(dir, "scene-01", [{ atMs: 500, image: "not-a-data-url" }])
    ).rejects.toThrow(/base64/);
  });
});

describe("createHttpSeeder", () => {
  it("POSTs the scene to the engine and returns its id", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ?? "" });
      return new Response(JSON.stringify({ id: "scene-01", scene: JSON.parse(init?.body ?? "{}") }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const id = await createHttpSeeder("http://127.0.0.1:4000/")({ ...validatedScene, id: "scene-01" });
      expect(id).toBe("scene-01");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("http://127.0.0.1:4000/api/scenes");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("surfaces engine rejections with status + issues", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "invalid scene", issues: ["layers.0.id: Required"] }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      await expect(createHttpSeeder("http://127.0.0.1:4000")({ ...validatedScene })).rejects.toThrow(
        /invalid scene[\s\S]*layers\.0\.id: Required/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("explains an unreachable engine", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("connection refused");
    }) as typeof fetch;
    try {
      await expect(createHttpSeeder("http://127.0.0.1:9")({ ...validatedScene })).rejects.toThrow(
        /could not reach core-engine at http:\/\/127\.0\.0\.1:9[\s\S]*connection refused/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("token helpers + stamps", () => {
  it("substituteTokens replaces known tokens and rejects unknown ones", () => {
    expect(substituteTokens("hello {{NAME}}", { NAME: "world" })).toBe("hello world");
    expect(() => substituteTokens("hello {{UNKNOWN}}", { NAME: "world" })).toThrow(/unknown template token/);
    expect(containsToken("{{X}}")).toBe(true);
    expect(containsToken("plain")).toBe(false);
  });

  it("timestampStamp formats YYYYMMDD-HHmmss", () => {
    expect(timestampStamp(new Date("2026-01-31T09:00:00.000Z"))).toMatch(/^\d{8}-\d{6}$/);
  });
});

describe("readProjectManifest", () => {
  it("reports a missing manifest as a fixable issue", async () => {
    const dir = path.join(workdir, "manifest-a");
    await scaffold("manifest-a");
    await rm(path.join(dir, "motionforge.project.json"));
    const result = await readProjectManifest(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain("run init_creative_project");
  });

  it("parses a valid manifest", async () => {
    const dir = path.join(workdir, "manifest-b");
    await scaffold("manifest-b");
    const result = await readProjectManifest(dir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.name).toBe("manifest-b");
  });
});

describe("POST /projects/init + /projects/sync (HTTP parity)", () => {
  it("initializes a project over HTTP with the in-process store as seeder", async () => {
    const app = Fastify();
    await registerProjectRoutes(app, { store: new SceneStore(), port: 4000 });
    try {
      const target = path.join(workdir, "http-init");
      const res = await app.inject({
        method: "POST",
        url: "/projects/init",
        payload: { name: "http-job", targetPath: target, autoSeedScene: true },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as {
        initialSceneId: string | null;
        previewUrl: string | null;
        seedError: string | null;
      };
      expect(body.initialSceneId).toBe("scene-01"); // scene-01.json carries its own id
      expect(body.previewUrl).toBe("http://127.0.0.1:4000/preview/?scene=scene-01");
      expect(await readFile(path.join(target, "scenes/scene-01.json"), "utf8")).toContain("http-job");
    } finally {
      await app.close();
    }
  });

  it("returns 409 when the target is not empty and force is not set", async () => {
    const app = Fastify();
    await registerProjectRoutes(app, { store: new SceneStore(), port: 4000 });
    try {
      const target = path.join(workdir, "http-guard");
      await scaffold("http-guard");
      const res = await app.inject({
        method: "POST",
        url: "/projects/init",
        payload: { name: "http-guard", targetPath: target },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatch(/is not empty/);
    } finally {
      await app.close();
    }
  });

  it("rejects invalid options with 400 + issues", async () => {
    const app = Fastify();
    await registerProjectRoutes(app, { store: new SceneStore(), port: 4000 });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/projects/init",
        payload: { name: "", targetPath: path.join(workdir, "never") },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toContain("name");
    } finally {
      await app.close();
    }
  });

  it("syncs a stored scene to the project disk", async () => {
    const app = Fastify();
    const store = new SceneStore();
    await registerProjectRoutes(app, { store, port: 4000 });
    try {
      const dir = path.join(workdir, "http-sync");
      await scaffold("http-sync");
      await seedManifest(dir);

      const res = await app.inject({
        method: "POST",
        url: "/projects/sync",
        payload: { projectPath: dir, scene: { ...validatedScene, id: "scene-01" } },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; disk: { file: string } };
      expect(body.id).toBe("scene-01");
      expect(body.disk.file).toBe("scenes/scene-01.json");
      const scene = JSON.parse(await readFile(path.join(dir, "scenes/scene-01.json"), "utf8")) as { id?: string };
      expect(scene.id).toBe("scene-01");
    } finally {
      await app.close();
    }
  });
});
