import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const PACKAGE_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export interface EnginePaths {
  packageDir: string;
  dataDir: string;
  vaultDir: string;
  sfxDir: string;
  rendersDir: string;
  runtimeDistDir: string;
}

export function enginePaths(): EnginePaths {
  const dataDir = path.join(PACKAGE_DIR, "data");
  return {
    packageDir: PACKAGE_DIR,
    dataDir,
    vaultDir: path.join(dataDir, "vault"),
    sfxDir: path.join(dataDir, "vault", "_sfx"),
    rendersDir: path.join(dataDir, "renders"),
    // sibling workspace package (always) — built by `npm run build -w @motionforge/scene-runtime`
    runtimeDistDir: path.resolve(PACKAGE_DIR, "..", "scene-runtime", "dist"),
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
