import { createReadStream, existsSync, statSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import type { EnginePaths } from "./config.js";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".json": "application/json",
};

export function mimeFor(filename: string): string {
  return MIME_BY_EXT[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

/** Vault filenames are opaque slugs — reject path separators/traversal. */
export function sanitizeVaultName(name: string): string | null {
  const trimmed = name.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(trimmed) || trimmed.includes("..")) return null;
  return trimmed;
}

export async function ensureDirs(paths: EnginePaths): Promise<void> {
  await Promise.all([
    fsp.mkdir(paths.vaultDir, { recursive: true }),
    fsp.mkdir(paths.rendersDir, { recursive: true }),
  ]);
}

export function vaultFilePath(paths: EnginePaths, name: string): string {
  return path.join(paths.vaultDir, name);
}

export function vaultFileExists(paths: EnginePaths, name: string): boolean {
  return existsSync(vaultFilePath(paths, name));
}

export function vaultFileStream(paths: EnginePaths, name: string): ReturnType<typeof createReadStream> {
  return createReadStream(vaultFilePath(paths, name));
}

/** Resolve an asset src to something FFmpeg and the preview can consume. */
export function resolveAssetSource(paths: EnginePaths, src: string): string {
  if (src.startsWith("vault:_sfx/")) {
    const name = src.slice("vault:_sfx/".length);
    if (!/^[a-zA-Z]+\.ogg$/.test(name) || !existsSync(path.join(paths.sfxDir, name))) {
      throw new Error(`sfx bank entry not found: ${src} (run ensureSfxBank)`);
    }
    return path.join(paths.sfxDir, name);
  }
  if (src.startsWith("vault:")) {
    const name = sanitizeVaultName(src.slice("vault:".length));
    if (!name || !vaultFileExists(paths, name)) {
      throw new Error(`vault asset not found: ${src}`);
    }
    return vaultFilePath(paths, name);
  }
  return src; // http(s)/data pass through
}

export async function saveVaultUpload(paths: EnginePaths, name: string, body: Buffer): Promise<number> {
  const file = vaultFilePath(paths, name);
  await fsp.writeFile(file, body);
  return statSync(file).size;
}
