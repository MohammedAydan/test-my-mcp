/**
 * Shared plumbing for the project-kit CLI (`init-project`, `sync-scene`,
 * `pull-render`).
 *
 * These scripts are plain `.mjs` run through `node --import tsx`, which lets
 * them import the TypeScript sources of `@motionforge/scene-spec` — so the
 * manifest and the scenes are validated by exactly the same schemas the engine
 * uses, with no build step and no duplicated validation logic.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const TEMPLATE_DIR = path.join(REPO_ROOT, "templates/creative-project");
export const MANIFEST_FILENAME = "motionforge.project.json";

/** Files whose text is token-substituted by `init-project`. */
const TOKEN_FILE_EXTENSIONS = new Set([".md", ".json"]);

/** Minimal `--flag value` / `--flag=value` parser (no dependencies by design). */
export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    if (eq !== -1) {
      args[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export function fail(message, exitCode = 1) {
  console.error(`\n✗ ${message}\n`);
  process.exit(exitCode);
}

export function heading(text) {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

/** Recursively list files relative to `root`. */
export async function listFiles(root, prefix = "") {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
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

export const isTokenFile = (file) => TOKEN_FILE_EXTENSIONS.has(path.extname(file));

/**
 * Replace `{{TOKEN}}` placeholders. Unknown tokens are an error, never a silent
 * leftover: an unsubstituted `{{PROJECT_NAME}}` in a client deliverable is a
 * defect the tests must never be able to miss.
 */
export function substituteTokens(text, tokens) {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    if (!(key in tokens)) {
      throw new Error(`unknown template token ${match} (known: ${Object.keys(tokens).join(", ")})`);
    }
    return tokens[key];
  });
}

export function containsToken(text) {
  return /\{\{[A-Z0-9_]+\}\}/.test(text);
}

/** True when the directory does not exist or contains nothing but dotfiles. */
export async function isEmptyDir(dir) {
  try {
    const entries = await readdir(dir);
    return entries.filter((name) => !name.startsWith(".")).length === 0;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}

export async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/** Read + parse a project's manifest, failing with actionable issues. */
export async function readManifest(projectDir) {
  const file = path.join(projectDir, MANIFEST_FILENAME);
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    fail(`${file} not found — is this a MotionForge project? (run init-project first)`);
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`);
  }
  return json;
}
