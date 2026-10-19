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

/** Vault filenames are opaque slugs — reject path traversal but allow subdirectories. */
export function sanitizeVaultName(name: string): string | null {
  const trimmed = name.trim();
  // Allow subdirectories (a/b/c) but no traversal (..)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(trimmed) || trimmed.includes("..")) return null;
  return trimmed;
}

export interface AssetVaultItem {
  id: string;
  name: string;
  src: string;
  kind: "image" | "video" | "audio" | "lottie" | "unknown";
  size: number;
  mimeType: string;
  updatedAt: number;
  projectPath?: string;
}

export async function ensureDirs(paths: EnginePaths): Promise<void> {
  await Promise.all([
    fsp.mkdir(paths.vaultDir, { recursive: true }),
    fsp.mkdir(paths.rendersDir, { recursive: true }),
    fsp.mkdir(paths.storageDir ?? path.join(paths.dataDir, "scenes"), { recursive: true }),
  ]);
}

export async function listVaultAssets(paths: EnginePaths): Promise<AssetVaultItem[]> {
  const results: AssetVaultItem[] = [];
  if (!existsSync(paths.vaultDir)) return results;

  async function scanDir(dir: string, prefix = ""): Promise<void> {
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name.includes(".tmp")) continue;
      const fullPath = path.join(dir, entry.name);
      const relName = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await scanDir(fullPath, relName);
      } else if (entry.isFile()) {
        const stat = await fsp.stat(fullPath);
        const ext = path.extname(entry.name).toLowerCase();
        let kind: AssetVaultItem["kind"] = "unknown";
        if ([".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"].includes(ext)) kind = "image";
        else if ([".mp4", ".webm", ".mov"].includes(ext)) kind = "video";
        else if ([".mp3", ".ogg", ".wav"].includes(ext)) kind = "audio";
        else if ([".json"].includes(ext)) kind = "lottie";

        results.push({
          id: relName,
          name: entry.name,
          src: `vault:${relName}`,
          kind,
          size: stat.size,
          mimeType: mimeFor(entry.name),
          updatedAt: Math.round(stat.mtimeMs),
        });
      }
    }
  }

  await scanDir(paths.vaultDir);
  return results.sort((a, b) => a.name.localeCompare(b.name));
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
