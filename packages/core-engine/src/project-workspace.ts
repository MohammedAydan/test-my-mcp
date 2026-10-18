/**
 * Creative-project workspace manager — the single implementation behind BOTH
 * the `init_creative_project` MCP tool and the project-kit CLI scripts
 * (`init-project`, `sync-scene`, `pull-render`). Neither surface may grow its
 * own copy of the template-copy / token-substitution / manifest logic; they
 * call this module so CLI and MCP can never diverge.
 *
 * Deliberately dependency-light: this module is loaded by the MCP server
 * process and by `node --import tsx` CLI scripts, so it may only import
 * `node:*` and `@motionforge/scene-spec`. It knows nothing about Fastify, MCP
 * or render pipelines — those are the engine's and the adapter's jobs.
 */
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initCreativeProjectSchema,
  type InitCreativeProjectOptions,
  minimalProjectManifest,
  PROJECT_MANIFEST_FILENAME,
  validateProjectManifest,
  validateScene,
  type ProjectManifest,
  type ProjectQuality,
  type ProjectSceneStatus,
  type SceneSpec,
} from "@motionforge/scene-spec";
import { sceneIdFromName } from "./scene-store.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Every failure this module can produce. The message is written for an LLM or
 * an operator: exact, actionable, and safe to surface verbatim as a tool result.
 */
export class ProjectWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectWorkspaceError";
  }
}

// ---------------------------------------------------------------------------
// Constants + tiny utilities
// ---------------------------------------------------------------------------

export { initCreativeProjectSchema };
export type { InitCreativeProjectOptions };

/** The shipped job template, relative to this file (repo root). */
export const PROJECT_TEMPLATE_DIR = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../templates/creative-project"
);

/** Files whose text is token-substituted during init. */
const TOKEN_FILE_EXTENSIONS = new Set([".md", ".json"]);

/** `2026-01-31-090000` — compact local timestamp for render/stills filenames. */
export function timestampStamp(date: Date = new Date()): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "")
    .replace("T", "-");
}

export function containsToken(text: string): boolean {
  return /\{\{[A-Z0-9_]+\}\}/.test(text);
}

/**
 * Replace `{{TOKEN}}` placeholders. Unknown tokens are an error, never a silent
 * leftover: an unsubstituted `{{PROJECT_NAME}}` in a client deliverable is a
 * defect the tests must never be able to miss.
 */
export function substituteTokens(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    if (!(key in tokens)) {
      throw new Error(`unknown template token ${match} (known: ${Object.keys(tokens).join(", ")})`);
    }
    return tokens[key]!;
  });
}

/** Recursively list files relative to `root`, sorted for deterministic copies. */
export async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path.join(root, entry.name), rel)));
    } else {
      files.push(rel);
    }
  }
  return files.sort();
}

/** True when the directory does not exist or contains nothing but dotfiles. */
export async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.filter((name) => !name.startsWith(".")).length === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return true;
    throw error;
  }
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return false;
    throw error;
  }
}

export function previewUrlFor(sceneId: string, engineBaseUrl: string): string {
  return `${engineBaseUrl.replace(/\/+$/, "")}/preview/?scene=${encodeURIComponent(sceneId)}`;
}

// ---------------------------------------------------------------------------
// Manifest access
// ---------------------------------------------------------------------------

export type ProjectManifestRead =
  | { ok: true; manifest: ProjectManifest }
  | { ok: false; issues: string[] };

/** Read + validate a project's manifest, failing with actionable issues. */
export async function readProjectManifest(projectDir: string): Promise<ProjectManifestRead> {
  const file = path.join(projectDir, PROJECT_MANIFEST_FILENAME);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return {
      ok: false,
      issues: [
        `${PROJECT_MANIFEST_FILENAME} not found in ${projectDir} — ` +
          "run init_creative_project (or `npm run init-project`) first",
      ],
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      issues: [`${PROJECT_MANIFEST_FILENAME} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  return validateProjectManifest(json);
}

async function writeProjectManifest(projectDir: string, manifest: ProjectManifest): Promise<void> {
  await writeFile(
    path.join(projectDir, PROJECT_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

/**
 * Upsert a scene entry in the manifest. Shared by the scene sync (adds the
 * scene file entry, status "draft") and the render sync (bumps the status to
 * the render quality) so both write the exact same entry shape.
 */
export function upsertSceneEntry(
  manifest: ProjectManifest,
  entry: { id: string; file: string; status: ProjectSceneStatus }
): { created: boolean } {
  const idx = manifest.scenes.findIndex((s) => s.id === entry.id);
  if (idx === -1) {
    manifest.scenes.push(entry);
    return { created: true };
  }
  manifest.scenes[idx] = { ...manifest.scenes[idx], ...entry };
  return { created: false };
}

// ---------------------------------------------------------------------------
// initCreativeProject
// ---------------------------------------------------------------------------

export interface ProjectWorkspaceDeps {
  /** Template root. Defaults to the shipped `templates/creative-project/`. */
  templateDir?: string;
  /**
   * Registers a scene with core-engine. The Fastify route passes the in-process
   * store; CLI scripts and the MCP tool pass `createHttpSeeder(engineUrl)`.
   * Required when `autoSeedScene` is true.
   */
  seedScene?: (scene: SceneSpec) => Promise<string>;
  /** Engine base URL (no trailing slash needed) — seeds preview links + token substitution. */
  engineBaseUrl?: string;
}

export interface InitProjectResult {
  projectPath: string;
  manifest: ProjectManifest;
  /** Engine scene id once seeded; null when seeding was skipped/failed/disabled. */
  initialSceneId: string | null;
  previewUrl: string | null;
  filesCreatedCount: number;
  /** Set when autoSeedScene ran but the engine rejected/unreachable — the project itself is fine. */
  seedError: string | null;
  operationalChecklist: string[];
}

/**
 * Create a MotionForge creative project at `options.targetPath`:
 * copy the template, substitute tokens, write + validate the manifest and the
 * starter scene, optionally seed the scene into core-engine.
 *
 * Refuses to overwrite a non-empty directory unless `force` is set — clobbering
 * a client job is the one mistake this function must never make.
 */
export async function initCreativeProject(
  options: unknown,
  deps: ProjectWorkspaceDeps = {}
): Promise<InitProjectResult> {
  const parsed = initCreativeProjectSchema.safeParse(options);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new ProjectWorkspaceError(`invalid init_creative_project options:\n${issues}`);
  }
  const opts = parsed.data;

  const templateDir = deps.templateDir ?? PROJECT_TEMPLATE_DIR;
  if (!(await pathExists(templateDir))) {
    throw new ProjectWorkspaceError(
      `project template not found at ${templateDir} — this is an engine installation problem, not a project problem`
    );
  }
  const target = path.resolve(process.cwd(), opts.targetPath);

  // guard: never clobber someone's work
  if (!(await isEmptyDir(target))) {
    if (!opts.force) {
      throw new ProjectWorkspaceError(
        `${target} is not empty.\n` +
          "  init_creative_project will not overwrite an existing workspace.\n" +
          "  Pick another targetPath, or pass force: true to overwrite template files (your own files are kept)."
      );
    }
  }

  await mkdir(target, { recursive: true });

  const engineUrl = (deps.engineBaseUrl ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
  const canvas = opts.canvasDefault ?? { shape: "16:9" as const, scale: 1080 as const };

  // --- copy + substitute -----------------------------------------------------
  const tokens = {
    PROJECT_NAME: opts.name,
    CREATED_AT: new Date().toISOString(),
    LANG: opts.language.primary,
    ENGINE_URL: engineUrl,
    CANVAS_SHAPE: canvas.shape,
    CANVAS_SCALE: String(canvas.scale),
    BRAND_BG: opts.brandColors?.bg ?? "#05070d",
    BRAND_ACCENT: opts.brandColors?.accent ?? "#38bdf8",
    BRAND_TEXT: opts.brandColors?.text ?? "#ffffff",
  };

  const files = await listFiles(templateDir);
  const leftovers: string[] = [];
  for (const rel of files) {
    const from = path.join(templateDir, rel);
    const to = path.join(target, rel);
    await mkdir(path.dirname(to), { recursive: true });
    if (TOKEN_FILE_EXTENSIONS.has(path.extname(rel))) {
      const raw = await readFile(from, "utf8");
      const text = substituteTokens(raw, tokens);
      if (containsToken(text)) leftovers.push(rel);
      await writeFile(to, text, "utf8");
    } else {
      await writeFile(to, await readFile(from));
    }
  }
  if (leftovers.length > 0) {
    throw new ProjectWorkspaceError(
      `template tokens were left unsubstituted in:\n  ${leftovers.join("\n  ")}`
    );
  }

  // --- manifest: built from the schema, validated as written -----------------
  const manifest = minimalProjectManifest({
    name: opts.name,
    createdAt: tokens.CREATED_AT,
    engineUrl,
    canvas,
    language: opts.language.primary,
    brandColors: opts.brandColors,
  });
  const manifestCheck = validateProjectManifest(manifest);
  if (!manifestCheck.ok) {
    throw new ProjectWorkspaceError(
      `generated manifest is invalid:\n  ${manifestCheck.issues.join("\n  ")}`
    );
  }
  await writeProjectManifest(target, manifest);

  // --- starter scene: validated with the exact schema the engine uses -------
  const scenePath = path.join(target, "scenes", "scene-01.json");
  const sceneCheck = validateScene(JSON.parse(await readFile(scenePath, "utf8")));
  if (!sceneCheck.ok) {
    throw new ProjectWorkspaceError(
      `generated scenes/scene-01.json is invalid:\n  ${sceneCheck.issues.join("\n  ")}`
    );
  }
  const scene = sceneCheck.scene;

  // --- optional seed: scene-01 is immediately previewable/inspectable --------
  let initialSceneId: string | null = null;
  let seedError: string | null = null;
  if (opts.autoSeedScene) {
    if (!deps.seedScene) {
      throw new ProjectWorkspaceError(
        "autoSeedScene is true but no seedScene callback was provided — " +
          "wire one (the HTTP route passes the store; scripts/MCP pass createHttpSeeder)"
      );
    }
    try {
      initialSceneId = await deps.seedScene(scene);
    } catch (error) {
      seedError = error instanceof Error ? error.message : String(error);
    }
  }

  const previewUrl = initialSceneId ? previewUrlFor(initialSceneId, engineUrl) : null;
  const operationalChecklist = [
    `core-engine is configured at ${manifest.engine.url} — start it with \`npm run dev -w @motionforge/core-engine\` if it is not running`,
    ...(initialSceneId
      ? [
          `Open the live timeline preview: ${previewUrl}`,
          `The starter scene "${initialSceneId}" is already in the engine — inspect it with inspect_scene_keyframes (pass projectPath: "${opts.targetPath}" and it stays in sync on disk)`,
        ]
      : [
          opts.autoSeedScene
            ? `Seeding scene-01 failed (${seedError ?? "unknown error"}) — push it later with create_or_update_scene (pass projectPath: "${opts.targetPath}")`
            : `Seeding is disabled — push scene-01 when ready with create_or_update_scene (pass projectPath: "${opts.targetPath}")`,
        ]),
    "Read brief/BRIEF.md and answer every section before authoring",
    "Author scenes/scene-01.json, then push it: create_or_update_scene (or `npm run sync-scene -- --project <path> --file scenes/scene-01.json`)",
    "inspect_scene_keyframes before any render; render_video quality: \"draft\" while iterating",
    "On approval: render_video quality: \"production\", copy the MP4 to exports/client-delivery/, update the manifest status",
  ];

  return {
    projectPath: target,
    manifest,
    initialSceneId,
    previewUrl,
    filesCreatedCount: files.length,
    seedError,
    operationalChecklist,
  };
}

// ---------------------------------------------------------------------------
// Disk auto-sync helpers (create_or_update_scene / render_video / inspect)
// ---------------------------------------------------------------------------

export interface SceneSyncResult {
  /** Project-relative path of the written scene file, e.g. `scenes/scene-01.json`. */
  file: string;
  manifest: ProjectManifest;
  created: boolean;
}

/**
 * Write the validated SceneSpec a scene JSON next to the project's other
 * scenes and register it in the manifest. This is what keeps
 * `scenes/<id>.json` and the engine store identical without a manual
 * `sync-scene` round trip.
 */
export async function syncSceneToDisk(
  projectPath: string,
  scene: SceneSpec
): Promise<SceneSyncResult> {
  const dir = path.resolve(process.cwd(), projectPath);
  const check = await readProjectManifest(dir);
  if (!check.ok) {
    throw new ProjectWorkspaceError(check.issues.join("\n"));
  }
  const id = scene.id ?? sceneIdFromName(scene.name);
  const file = `scenes/${id}.json`;
  await mkdir(path.join(dir, "scenes"), { recursive: true });
  await writeFile(path.join(dir, file), `${JSON.stringify(scene, null, 2)}\n`, "utf8");
  const { created } = upsertSceneEntry(check.manifest, { id, file, status: "draft" });
  await writeProjectManifest(dir, check.manifest);
  return { file, manifest: check.manifest, created };
}

export interface RenderSaveResult {
  /** e.g. `renders/draft/<sceneId>-20260131-090000.mp4` */
  file: string;
  /** e.g. `renders/draft/<sceneId>-latest.mp4` — deterministic access to the newest render */
  latest: string;
  status: ProjectSceneStatus;
  manifest: ProjectManifest;
}

/**
 * File a finished render into the project: a timestamped copy (history) plus a
 * `-latest.mp4` copy (deterministic access), and the manifest status is bumped
 * to the render quality (`draft` / `production`).
 */
export async function saveRenderToDisk(
  projectPath: string,
  sceneId: string,
  quality: ProjectQuality,
  mp4: Buffer,
  stamp: string = timestampStamp()
): Promise<RenderSaveResult> {
  const dir = path.resolve(process.cwd(), projectPath);
  const check = await readProjectManifest(dir);
  if (!check.ok) {
    throw new ProjectWorkspaceError(check.issues.join("\n"));
  }
  if (mp4.length === 0) {
    throw new ProjectWorkspaceError("core-engine returned an empty file — refusing to write a zero-byte MP4");
  }
  const outDir = path.join(dir, "renders", quality);
  await mkdir(outDir, { recursive: true });
  const file = `renders/${quality}/${sceneId}-${stamp}.mp4`;
  const latest = `renders/${quality}/${sceneId}-latest.mp4`;
  await writeFile(path.join(dir, file), mp4);
  await writeFile(path.join(dir, latest), mp4);
  upsertSceneEntry(check.manifest, {
    id: sceneId,
    file: `scenes/${sceneId}.json`,
    status: quality,
  });
  await writeProjectManifest(dir, check.manifest);
  return { file, latest, status: quality, manifest: check.manifest };
}

export interface StillsFrame {
  atMs: number;
  /** `data:image/png;base64,…` (the engine's keyframe inspector format) */
  image: string;
}

/**
 * Write captured keyframe stills into the project. The bytes are whatever the
 * engine captured (PNG), so the extension follows the data URL, never a guess.
 */
export async function saveStillsToDisk(
  projectPath: string,
  sceneId: string,
  frames: StillsFrame[]
): Promise<string[]> {
  const dir = path.resolve(process.cwd(), projectPath);
  const check = await readProjectManifest(dir);
  if (!check.ok) {
    throw new ProjectWorkspaceError(check.issues.join("\n"));
  }
  const outDir = path.join(dir, "renders", "stills");
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];
  for (const frame of frames) {
    const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(frame.image);
    if (!match) {
      throw new ProjectWorkspaceError(
        `keyframe at ${frame.atMs}ms is not a base64 image data URL — refusing to guess the format`
      );
    }
    const name = `${sceneId}-${frame.atMs}ms.${match[1] === "png" ? "png" : "jpg"}`;
    await writeFile(path.join(outDir, name), Buffer.from(match[2]!, "base64"));
    written.push(`renders/stills/${name}`);
  }
  return written;
}

// ---------------------------------------------------------------------------
// Seeding transport for out-of-process callers (CLI scripts, MCP tool)
// ---------------------------------------------------------------------------

/**
 * Build a `seedScene` callback that registers the scene with core-engine over
 * HTTP. Used by the MCP tool and the CLI scripts, which run outside the engine
 * process and therefore cannot hold the store directly.
 */
export function createHttpSeeder(engineUrl: string): (scene: SceneSpec) => Promise<string> {
  const base = engineUrl.replace(/\/+$/, "");
  return async (scene) => {
    let response: Response;
    try {
      response = await fetch(`${base}/api/scenes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(scene),
      });
    } catch (error) {
      throw new Error(
        `could not reach core-engine at ${base}: ${error instanceof Error ? error.message : String(error)}\n` +
          "  Start it with: npm run dev -w @motionforge/core-engine"
      );
    }
    const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string; issues?: string[] };
    if (!response.ok) {
      const issues = Array.isArray(body.issues) ? `\n${body.issues.map((i) => `- ${i}`).join("\n")}` : "";
      throw new Error(
        `core-engine ${response.status} rejected the seeded scene: ${body.error ?? response.statusText}${issues}`
      );
    }
    if (!body.id) throw new Error(`core-engine ${response.status} returned no scene id`);
    return body.id;
  };
}
