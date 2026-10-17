import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  MINIMAL_VALID_SCENE,
  SHOWCASE_SCENE_SKETCH,
  validateProjectManifest,
  validateScene,
  type SceneSpecInput,
} from "@motionforge/scene-spec";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const TEMPLATE_DIR = path.join(REPO_ROOT, "templates/creative-project");
const SCENES_DIR = path.join(TEMPLATE_DIR, "scenes");

const readJson = async (file: string): Promise<unknown> =>
  JSON.parse(await readFile(file, "utf8"));

/**
 * The template is what every new client job starts from, so a broken template
 * ships a broken job. These tests are the gate: every shipped scene must
 * validate against the real schema, and must stay byte-identical to the
 * scene-spec constants it was generated from.
 */
describe("creative-project template scenes", () => {
  it("ships only .json scene files", async () => {
    const files = (await readdir(SCENES_DIR, { recursive: true }))
      .map(String)
      .filter((name) => name.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  const cases: Array<[string, () => Promise<unknown>]> = [
    ["_templates/minimal-valid-scene.json", () => readJson(path.join(SCENES_DIR, "_templates/minimal-valid-scene.json"))],
    ["_templates/showcase-sketch.json", () => readJson(path.join(SCENES_DIR, "_templates/showcase-sketch.json"))],
    ["scene-01.json", () => readJson(path.join(SCENES_DIR, "scene-01.json"))],
  ];

  for (const [label, load] of cases) {
    it(`${label} is a valid SceneSpec`, async () => {
      const result = validateScene(await load());
      if (!result.ok) throw new Error(`${label} invalid:\n  ${result.issues.join("\n  ")}`);
    });
  }

  it("stays byte-identical to the scene-spec constants (no hand edits)", async () => {
    expect(await readJson(path.join(SCENES_DIR, "_templates/minimal-valid-scene.json"))).toEqual(
      MINIMAL_VALID_SCENE
    );
    expect(await readJson(path.join(SCENES_DIR, "_templates/showcase-sketch.json"))).toEqual(
      SHOWCASE_SCENE_SKETCH
    );
  });

  it("scene-01.json needs no assets, so it works on a fresh engine", async () => {
    const scene = (await readJson(path.join(SCENES_DIR, "scene-01.json"))) as SceneSpecInput;
    expect(scene.assets ?? []).toEqual([]);
    const types = scene.layers.map((l) => l.type);
    expect(types).toContain("background");
    expect(types).toContain("kineticText");
  });

  it("scene-01.json survives token substitution", async () => {
    const raw = await readFile(path.join(SCENES_DIR, "scene-01.json"), "utf8");
    const substituted = raw.replaceAll("{{PROJECT_NAME}}", "acme-reel-2026");
    expect(substituted).not.toContain("{{");
    const result = validateScene(JSON.parse(substituted));
    if (!result.ok) throw new Error(`substituted scene invalid:\n  ${result.issues.join("\n  ")}`);
    expect(result.scene.name).toBe("acme-reel-2026 — scene 01");
  });

  it("demonstrates bilingual RTL authoring in the starter scene", async () => {
    const scene = (await readJson(path.join(SCENES_DIR, "scene-01.json"))) as SceneSpecInput;
    const ar = scene.layers.find((l) => l.id === "hero-ar");
    const en = scene.layers.find((l) => l.id === "hero-en");
    expect(ar && ar.type === "kineticText" ? ar.direction : undefined).toBe("rtl");
    // per-character splitting of Arabic is exactly what must never ship
    expect(ar && ar.type === "kineticText" ? ar.animateBy : undefined).not.toBe("char");
    expect(en && en.type === "kineticText" ? en.text : undefined).toMatch(/[A-Za-z]/);
  });
});

describe("creative-project template manifest", () => {
  it("validates once tokens are substituted", async () => {
    const raw = await readFile(path.join(TEMPLATE_DIR, "motionforge.project.json"), "utf8");
    const substituted = raw
      .replaceAll("{{PROJECT_NAME}}", "client-reel")
      .replaceAll("{{CREATED_AT}}", "2026-01-31T09:00:00.000Z")
      .replaceAll("{{LANG}}", "ar")
      .replaceAll("{{ENGINE_URL}}", "http://127.0.0.1:4000");
    const result = validateProjectManifest(JSON.parse(substituted));
    if (!result.ok) throw new Error(`manifest invalid:\n  ${result.issues.join("\n  ")}`);
    expect(result.manifest.name).toBe("client-reel");
    expect(result.manifest.canvasDefault).toEqual({ shape: "16:9", scale: 1080 });
    expect(result.manifest.language.primary).toBe("ar");
    expect(result.manifest.workflow.requireInspectBeforeProduction).toBe(true);
    expect(result.manifest.scenes).toHaveLength(1);
  });

  it("ships the project-local agent manual and human README", async () => {
    for (const file of ["AGENTS.md", "README.md", "brief/BRIEF.md", ".gitignore"]) {
      const content = await readFile(path.join(TEMPLATE_DIR, file), "utf8");
      expect(content.length, `${file} is empty`).toBeGreaterThan(200);
    }
  });

  it("BRIEF.md has the fixed section headings", async () => {
    const brief = await readFile(path.join(TEMPLATE_DIR, "brief/BRIEF.md"), "utf8");
    for (const heading of [
      "## Goal",
      "## Audience",
      "## Duration",
      "## Aspect",
      "## Must-include lines (AR/EN)",
      "## Brand constraints",
      "## References",
      "## Delivery formats",
    ]) {
      expect(brief, `BRIEF.md is missing "${heading}"`).toContain(heading);
    }
  });

  it("the project AGENTS.md forbids per-character Arabic splitting", async () => {
    const agents = await readFile(path.join(TEMPLATE_DIR, "AGENTS.md"), "utf8");
    expect(agents).toContain("minimalValidScene");
    expect(agents).toMatch(/never split arabic per character/i);
    expect(agents).toContain("inspect_scene_keyframes");
  });
});

describe("creative-project template scene ignore rules", () => {
  /**
   * The template ships its own `.gitignore` for the generated project, and it
   * lives *inside* this repository. Unanchored or directory-excluding patterns
   * silently swallow the template's own `renders/`, `logs/` and
   * `assets/_staging/` folders — a real regression that was found and fixed.
   * Ask git itself, so the rule cannot be re-broken quietly.
   */
  const templateFiles = async (): Promise<string[]> =>
    (await readdir(TEMPLATE_DIR, { recursive: true }))
      .map(String)
      .filter((name) => !name.endsWith("/"))
      .map((name) => path.join(TEMPLATE_DIR, name));

  const gitAvailable = async (): Promise<boolean> =>
    new Promise((resolve) => {
      const child = spawn("git", ["-C", REPO_ROOT, "rev-parse", "--is-inside-work-tree"]);
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    });

  it("does not ignore any file that belongs to the template", async () => {
    if (!(await gitAvailable())) return; // not a git checkout: nothing to check

    const files = await templateFiles();
    const ignored = await Promise.all(
      files.map(
        (file) =>
          new Promise<string | null>((resolve) => {
            const child = spawn("git", ["-C", REPO_ROOT, "check-ignore", "--", file]);
            let out = "";
            child.stdout.on("data", (d) => (out += String(d)));
            child.on("error", () => resolve(null));
            child.on("close", (code) => resolve(code === 0 ? file : null));
          })
      )
    );
    const lost = ignored.filter((file): file is string => file !== null);
    expect(lost, `these template files would be dropped by git: ${lost.join(", ")}`).toEqual([]);
  });

  it("ignores generated output files but keeps READMEs and .gitkeep", async () => {
    // re-apply the template's rules in a scratch project, as a real job would
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const scratch = await mkdtemp(path.join(tmpdir(), "mf-ignore-"));
    try {
      await writeFile(path.join(scratch, ".gitignore"), await readFile(path.join(TEMPLATE_DIR, ".gitignore"), "utf8"));
      for (const dir of ["renders/draft", "logs/agent-sessions", "assets/_staging", "scenes"]) {
        await mkdir(path.join(scratch, dir), { recursive: true });
      }
      const cases: Array<[string, boolean]> = [
        ["renders/draft/scene-01-20260101-120000.mp4", true],
        ["renders/draft/README.md", false],
        ["renders/draft/.gitkeep", false],
        ["logs/agent-sessions/2026-01-31-scene-01.md", true],
        ["logs/agent-sessions/.gitkeep", false],
        ["logs/README.md", false],
        ["assets/_staging/raw-export.psd", true],
        ["assets/_staging/README.md", false],
        ["scenes/scene-01.json", false],
      ];
      for (const [file, shouldIgnore] of cases) {
        await writeFile(path.join(scratch, file), "x");
        const ignored = await new Promise<boolean>((resolve) => {
          const child = spawn("git", ["-C", scratch, "init", "-q", "--", "."]);
          child.on("error", () => resolve(false));
          child.on("close", () => {
            const probe = spawn("git", ["-C", scratch, "check-ignore", "--", file]);
            let out = "";
            probe.stdout.on("data", (d) => (out += String(d)));
            probe.on("close", (code) => resolve(code === 0 && out.length > 0));
          });
        });
        expect(ignored, `${file} should ${shouldIgnore ? "be ignored" : "stay tracked"}`).toBe(shouldIgnore);
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

describe("project kit scripts", () => {
  it("ships the three CLI tools and the skill", async () => {
    for (const file of [
      "scripts/init-project.mjs",
      "scripts/sync-scene.mjs",
      "scripts/pull-render.mjs",
      "scripts/_project-kit.mjs",
      "skills/motionforge-creative-project/SKILL.md",
    ]) {
      const content = await readFile(path.join(REPO_ROOT, file), "utf8");
      expect(content.length, `${file} is empty`).toBeGreaterThan(100);
    }
  });

  it("registers the CLIs in the root package.json (no sixth MCP tool)", async () => {
    const pkg = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["init-project"]).toContain("scripts/init-project.mjs");
    expect(pkg.scripts["sync-scene"]).toContain("scripts/sync-scene.mjs");
    expect(pkg.scripts["pull-render"]).toContain("scripts/pull-render.mjs");
  });
});
