/**
 * Project asset resolution.
 *
 * THE GAP THIS CLOSES (report 1 §4.7 / report 2 §5.4): a creative project drops
 * its artwork into `assets/images/`, `brand/logo/`, `assets/lottie/` and so on,
 * then references it as `vault:logo.png`. Nothing connected the two, so every
 * image, Lottie, video and music track in a project failed at render time with
 * `vault asset not found` unless the agent had discovered the undocumented
 * `POST /api/assets` upload step.
 *
 * Resolution is therefore automatic: when a scene carries a `projectPath`, every
 * `vault:` (or bare relative) asset source is looked up in the project's own
 * directories and copied into the engine vault on first use. After that the file
 * is served by the normal vault route and the project is self-contained.
 */
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { Asset, SceneSpec } from "@motionforge/scene-spec";

import type { EnginePaths } from "./config.js";
import { sanitizeVaultName, vaultFileExists, vaultFilePath } from "./vault.js";

/**
 * Where a creative project keeps its files. The order is the search order, so a
 * `logo.png` in `brand/logo/` wins over a same-named file elsewhere only if the
 * earlier directory has no match.
 */
export const PROJECT_ASSET_DIRS = [
  "assets/images",
  "assets/lottie",
  "assets/video",
  "assets/audio",
  "assets/audio/music",
  "assets/audio/sfx",
  "assets/audio/vo",
  "brand/logo",
] as const;

export interface ResolvedAsset {
  assetId: string;
  /** the src the scene now uses (unchanged; it already read `vault:<name>`) */
  src: string;
  /** the vault name it landed under */
  vaultName: string;
  /** project-relative path it was copied from */
  from: string;
  /** true when the file was already in the vault (no copy performed) */
  cached: boolean;
}

export interface UnresolvedAsset {
  assetId: string;
  src: string;
  reason: "unsafe-name" | "not-found";
  searched: string[];
}

export interface ResolveProjectAssetsResult {
  resolved: ResolvedAsset[];
  unresolved: UnresolvedAsset[];
}

/**
 * The local name an asset source refers to, or `null` for remote sources.
 *
 * `vault:` sources return the RAW name (not a basename): a traversing name must
 * be rejected, not silently reduced to its last segment.
 */
function localNameOf(src: string): string | null {
  if (src.startsWith("vault:")) {
    const rest = src.slice("vault:".length);
    // `vault:_sfx/whoosh.ogg` is the engine's own bank, never a project file
    if (rest.startsWith("_sfx/")) return null;
    return rest;
  }
  if (/^(https?:|data:|blob:)/.test(src)) return null;
  // a project-relative path: `assets/images/logo.png` or just `logo.png`
  return src;
}

/** True when the source is a `vault:` reference (a flat, sanitized slug). */
function isVaultSource(src: string): boolean {
  return src.startsWith("vault:");
}

/** Recursively list files under `dir`, returned as project-relative POSIX paths. */
async function listRecursive(dir: string, prefix = ""): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listRecursive(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out.sort();
}

/** Build a filename → project-relative-path index over the project's asset dirs. */
export async function indexProjectAssets(
  projectPath: string
): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  for (const dir of PROJECT_ASSET_DIRS) {
    // seed the prefix with the directory itself so the recorded paths are
    // project-relative (`assets/images/logo.png`), not bare basenames
    for (const rel of await listRecursive(path.join(projectPath, dir), dir)) {
      const name = path.basename(rel);
      // first directory wins: the search order above is the precedence order
      if (!index.has(name)) index.set(name, rel);
    }
  }
  return index;
}

/**
 * Resolve (and cache into the vault) every local asset a scene references.
 *
 * Copying is idempotent and content is never overwritten once present: a vault
 * file may have been uploaded deliberately at a higher quality than the project
 * copy, and silently downgrading it would be worse than ignoring the project.
 */
export async function resolveProjectAssets(
  scene: SceneSpec,
  opts: { projectPath: string; enginePaths: EnginePaths }
): Promise<ResolveProjectAssetsResult> {
  const { projectPath, enginePaths } = opts;
  const resolved: ResolvedAsset[] = [];
  const unresolved: UnresolvedAsset[] = [];
  const assets: Asset[] = scene.assets;

  const wanted = assets.filter((a) => localNameOf(a.src) !== null);
  if (wanted.length === 0) return { resolved, unresolved };

  const index = await indexProjectAssets(projectPath);
  const searched = PROJECT_ASSET_DIRS.map((d) => `${d}/`);

  for (const asset of wanted) {
    const raw = localNameOf(asset.src) as string;
    // Reject a traversing / unsafe name BEFORE any path join. `vault:` names are
    // opaque slugs by contract (`sanitizeVaultName`); a project-relative source
    // is allowed to carry directories, so only its basename is sanitized.
    const bare = path.basename(raw);
    // A `vault:` name is an opaque flat slug: no directories, no traversal.
    // A project-relative path may carry directories — only its basename is used.
    const nameSource = isVaultSource(asset.src) ? raw : bare;
    const vaultName = sanitizeVaultName(nameSource);
    if (!vaultName || nameSource !== bare) {
      unresolved.push({ assetId: asset.id, src: asset.src, reason: "unsafe-name", searched });
      continue;
    }
    if (vaultFileExists(enginePaths, vaultName)) {
      resolved.push({ assetId: asset.id, src: asset.src, vaultName, from: "", cached: true });
      continue;
    }
    const rel = index.get(bare) ?? (raw.includes("/") ? raw : undefined);
    if (!rel) {
      unresolved.push({ assetId: asset.id, src: asset.src, reason: "not-found", searched });
      continue;
    }
    const from = path.join(projectPath, rel);
    try {
      const info = await stat(from);
      if (!info.isFile()) {
        unresolved.push({ assetId: asset.id, src: asset.src, reason: "not-found", searched });
        continue;
      }
      await mkdir(path.dirname(vaultFilePath(enginePaths, vaultName)), { recursive: true });
      await copyFile(from, vaultFilePath(enginePaths, vaultName));
      resolved.push({ assetId: asset.id, src: asset.src, vaultName, from: rel, cached: false });
    } catch {
      unresolved.push({ assetId: asset.id, src: asset.src, reason: "not-found", searched });
    }
  }

  return { resolved, unresolved };
}

/** Actionable message for an asset that could not be found anywhere. */
export function unresolvedAssetIssues(unresolved: readonly UnresolvedAsset[]): string[] {
  return unresolved.map(
    (u) =>
      `asset "${u.assetId}" references missing file "${u.src}" — searched ${u.searched.join(", ")} in the project. ` +
      `Add the file to one of those directories, or upload it to the vault.`
  );
}