import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PACKAGE_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function findRuntimeDistDir(): string {
  const candidates = [
    process.env.MOTIONFORGE_RUNTIME_DIST_DIR,
    path.resolve(PACKAGE_DIR, "..", "scene-runtime", "dist"),
    path.resolve(PACKAGE_DIR, "..", "..", "scene-runtime", "dist"),
    path.resolve(PACKAGE_DIR, "..", "..", "..", "scene-runtime", "dist"),
    path.resolve(PACKAGE_DIR, "..", "..", "packages", "scene-runtime", "dist"),
    path.resolve(process.cwd(), "packages", "scene-runtime", "dist"),
    path.resolve(process.cwd(), "scene-runtime", "dist"),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, "index.html"))) {
      return c;
    }
  }
  return path.resolve(PACKAGE_DIR, "..", "scene-runtime", "dist");
}

export interface EnginePaths {
  packageDir: string;
  dataDir: string;
  storageDir: string;
  vaultDir: string;
  sfxDir: string;
  rendersDir: string;
  runtimeDistDir: string;
}

export function enginePaths(overrides?: Partial<EnginePaths>): EnginePaths {
  const dataDir = overrides?.dataDir ?? path.join(PACKAGE_DIR, "data");
  return {
    packageDir: PACKAGE_DIR,
    dataDir,
    storageDir: overrides?.storageDir ?? path.join(dataDir, "scenes"),
    vaultDir: overrides?.vaultDir ?? path.join(dataDir, "vault"),
    sfxDir: overrides?.sfxDir ?? path.join(dataDir, "vault", "_sfx"),
    rendersDir: overrides?.rendersDir ?? path.join(dataDir, "renders"),
    // sibling workspace package (always) — built by `npm run build -w @motionforge/scene-runtime`
    runtimeDistDir: overrides?.runtimeDistDir ?? findRuntimeDistDir(),
  };
}

export interface EnginePathOptions {
  storageDir?: string;
  vaultDir?: string;
  dataDir?: string;
  rendersDir?: string;
  sfxDir?: string;
  runtimeDistDir?: string;
}

export function resolveEnginePaths(options?: EnginePathOptions): EnginePaths {
  const canonicalBase = path.join(os.homedir(), ".motionforge");

  let dataDir: string;
  if (options?.dataDir) {
    dataDir = options.dataDir;
  } else if (process.env.MOTIONFORGE_DATA_DIR) {
    dataDir = process.env.MOTIONFORGE_DATA_DIR;
  } else if (options?.storageDir) {
    dataDir = path.dirname(options.storageDir);
  } else {
    dataDir = canonicalBase;
  }

  const storageDir =
    options?.storageDir ??
    process.env.MOTIONFORGE_STORAGE_DIR ??
    path.join(dataDir, "scenes");

  const vaultDir =
    options?.vaultDir ??
    process.env.MOTIONFORGE_VAULT_DIR ??
    path.join(dataDir, "vault");

  const sfxDir =
    options?.sfxDir ??
    path.join(vaultDir, "_sfx");

  const rendersDir =
    options?.rendersDir ??
    process.env.MOTIONFORGE_RENDERS_DIR ??
    path.join(dataDir, "renders");

  const runtimeDistDir =
    options?.runtimeDistDir ??
    findRuntimeDistDir();

  return {
    packageDir: PACKAGE_DIR,
    dataDir,
    storageDir,
    vaultDir,
    sfxDir,
    rendersDir,
    runtimeDistDir,
  };
}

export interface EngineConfig {
  port: number;
  paths: EnginePaths;
  /** headless pages used in parallel per render */
  maxRenderWorkers: number;
}

export function engineConfig(overrides?: Partial<Pick<EngineConfig, "port" | "maxRenderWorkers">>): EngineConfig {
  return {
    port: overrides?.port ?? 4000,
    paths: enginePaths(),
    maxRenderWorkers: overrides?.maxRenderWorkers ??
      Math.max(1, Math.min(4, os.cpus().length)),
  };
}

export const DRAFT_HEIGHT = 720;
export const PRODUCTION_FPS = 60;
export const DRAFT_FPS = 30;
