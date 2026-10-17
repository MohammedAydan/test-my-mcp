import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { validateProjectManifest, validateScene } from "@motionforge/scene-spec";

/**
 * Integration tests for the project-kit CLI. They spawn the real scripts
 * exactly as an operator would (`node --import tsx scripts/…`), so argument
 * parsing, path handling, token substitution and the overwrite guard are all
 * covered end to end rather than mocked.
 */
const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const INIT = path.join(REPO_ROOT, "scripts/init-project.mjs");
const SYNC = path.join(REPO_ROOT, "scripts/sync-scene.mjs");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(script: string, args: string[], cwd = REPO_ROOT): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", script, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

let workdir: string;

beforeAll(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), "mf-project-kit-"));
});

afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});

describe("init-project", () => {
  it("scaffolds the full tree, substitutes every token, and validates the manifest", async () => {
    const target = path.join(workdir, "job-a");
    const result = await run(INIT, ["--name", "acme-reel", "--path", target, "--lang", "ar"]);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("MotionForge project created: acme-reel");

    // every documented directory exists and is not empty (`.gitkeep` or a README)
    for (const dir of [
      "brief/references",
      "design/psd",
      "design/ai",
      "design/aep",
      "design/figma",
      "design/storyboard",
      "brand/logo",
      "brand/fonts",
      "assets/images",
      "assets/video",
      "assets/lottie",
      "assets/audio/music",
      "assets/audio/vo",
      "assets/audio/sfx",
      "assets/_staging",
      "scenes/_templates",
      "renders/draft",
      "renders/production",
      "renders/stills",
      "exports/client-delivery",
      "exports/archive",
      "logs/agent-sessions",
    ]) {
      const entries = await readdir(path.join(target, dir));
      expect(entries, `${dir} is empty after init`).not.toHaveLength(0);
    }

    // token substitution reached every tokenized file, including the scene JSON
    for (const file of ["AGENTS.md", "README.md", "brief/BRIEF.md", "motionforge.project.json", "scenes/scene-01.json"]) {
      const content = await readFile(path.join(target, file), "utf8");
      expect(content, `${file} still has a template token`).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
    }
    const agents = await readFile(path.join(target, "AGENTS.md"), "utf8");
    expect(agents).toContain("acme-reel");
    expect(agents).toContain("http://127.0.0.1:4000");
    const sceneRaw = await readFile(path.join(target, "scenes/scene-01.json"), "utf8");
    expect(sceneRaw).toContain("acme-reel");

    // the generated manifest is schema-valid, not just well-formed JSON
    const manifest = JSON.parse(await readFile(path.join(target, "motionforge.project.json"), "utf8"));
    const check = validateProjectManifest(manifest);
    if (!check.ok) throw new Error(`manifest invalid:\n  ${check.issues.join("\n  ")}`);
    expect(check.manifest.name).toBe("acme-reel");
    expect(check.manifest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(check.manifest.scenes[0]?.file).toBe("scenes/scene-01.json");

    // and the starter scene is still a valid SceneSpec after substitution
    const scene = validateScene(JSON.parse(sceneRaw));
    if (!scene.ok) throw new Error(`starter scene invalid:\n  ${scene.issues.join("\n  ")}`);
  });

  it("refuses to overwrite a non-empty directory without --force", async () => {
    const target = path.join(workdir, "job-b");
    expect((await run(INIT, ["--name", "b", "--path", target])).code).toBe(0);

    const marker = path.join(target, "notes.txt");
    await writeFile(marker, "do not lose me", "utf8");

    const blocked = await run(INIT, ["--name", "b", "--path", target]);
    expect(blocked.code).not.toBe(0);
    expect(`${blocked.stdout}${blocked.stderr}`).toMatch(/not empty/);
    expect(await readFile(marker, "utf8")).toBe("do not lose me");

    const forced = await run(INIT, ["--name", "b", "--path", target, "--force"]);
    expect(forced.code, forced.stderr).toBe(0);
    expect(await readFile(marker, "utf8")).toBe("do not lose me"); // --force overwrites templates, not user files
    expect(await readFile(path.join(target, "AGENTS.md"), "utf8")).toContain("# AGENTS.md");
  });

  it("creates nested target paths that do not exist yet", async () => {
    const target = path.join(workdir, "deep/nested/job-c");
    const result = await run(INIT, ["--name", "c", "--path", target, "--shape", "9:16", "--scale", "1080"]);
    expect(result.code, result.stderr).toBe(0);
    const manifest = validateProjectManifest(
      JSON.parse(await readFile(path.join(target, "motionforge.project.json"), "utf8"))
    );
    if (!manifest.ok) throw new Error(manifest.issues.join("\n"));
    expect(manifest.manifest.canvasDefault).toEqual({ shape: "9:16", scale: 1080 });
  });

  it("rejects a bad --lang before touching the filesystem", async () => {
    const target = path.join(workdir, "job-d");
    const result = await run(INIT, ["--name", "d", "--path", target, "--lang", "fr"]);
    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/--lang must be ar, en or both/);
    await expect(readFile(path.join(target, "AGENTS.md"), "utf8")).rejects.toThrow();
  });

  it("requires --name and --path", async () => {
    expect((await run(INIT, ["--path", path.join(workdir, "x")])).code).not.toBe(0);
    expect((await run(INIT, ["--name", "x"])).code).not.toBe(0);
  });
});

describe("sync-scene", () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = path.join(workdir, "sync-job");
    const created = await run(INIT, ["--name", "sync-job", "--path", projectDir]);
    expect(created.code, created.stderr).toBe(0);
  });

  it("reports exact field-level issues and does not reach the engine", async () => {
    const file = path.join(projectDir, "scenes/broken.json");
    const scene = JSON.parse(await readFile(path.join(projectDir, "scenes/scene-01.json"), "utf8"));
    scene.layers[0].variant = "meshGradient";
    scene.layers[1].preset = "springPop";
    await writeFile(file, JSON.stringify(scene, null, 2), "utf8");

    const result = await run(SYNC, [
      "--project",
      projectDir,
      "--file",
      "scenes/broken.json",
      // an engine that is definitely not running: local validation must still
      // produce the issues, proving nothing was sent over the wire
      "--engine-url",
      "http://127.0.0.1:9",
    ]);

    expect(result.code).not.toBe(0);
    const out = result.stdout + result.stderr;
    expect(out).toContain("layers.0.variant");
    expect(out).toMatch(/Expected object, received string/);
    expect(out).toContain("preset");
    expect(out).toMatch(/Nothing was sent to the engine/);
  });

  it("fails loudly when the engine is unreachable", async () => {
    const result = await run(SYNC, [
      "--project",
      projectDir,
      "--file",
      "scenes/scene-01.json",
      "--engine-url",
      "http://127.0.0.1:9",
    ]);
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/could not reach core-engine/);
  });

  it("refuses a --file outside the project", async () => {
    await mkdir(path.join(workdir, "outside"), { recursive: true });
    const escapee = path.join(workdir, "outside/scene.json");
    await writeFile(escapee, "{}", "utf8");
    const result = await run(SYNC, [
      "--project",
      projectDir,
      "--file",
      path.relative(projectDir, escapee),
    ]);
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/must stay inside the project/);
  });
});
