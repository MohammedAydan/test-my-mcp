/**
 * The scene write path — validate, asset-resolve, store, sync.
 *
 * This is the single place where a SceneSpec becomes a stored scene. It lives
 * outside `server.ts` because it is not an HTTP concern: the scene route, the
 * project-sync route, the in-process `EngineCore` and the tests all call the
 * SAME function, so none of them can drift from each other (a divergence here
 * is exactly how the MCP tool and the CLI ended up disagreeing about what
 * "storing a scene" means).
 *
 * The module owns no I/O of its own beyond what the store, the vault and the
 * project workspace already provide.
 */
import { validateScene, type SceneSpec } from "@motionforge/scene-spec";

import type { EnginePaths } from "./config.js";
import {
  resolveProjectAssets,
  unresolvedAssetIssues,
  type ResolvedAsset,
} from "./project-assets.js";
import { syncSceneToDisk } from "./project-workspace.js";
import { analyzeScene, type SceneWarning } from "./scene-analysis.js";
import type { SceneStore } from "./scene-store.js";
import { sanitizeVaultName, vaultFileExists } from "./vault.js";

/** The body a scene-store response carries. Shared by both scene routes. */
export interface SceneStoreResponse {
  id: string;
  status: "created" | "updated";
  revision: number;
  hash: string;
  warnings: SceneWarning[];
  previewUrl: string;
  scene: SceneSpec;
  savedSceneFilePath?: string;
  assetsResolved?: ResolvedAsset[];
}

/**
 * The body a REJECTED scene carries.
 *
 * `issues` is the field-level list the schema produced (or the asset resolver
 * produced) — it is never absent, so a caller can always render it.
 */
export interface SceneStoreError {
  error: string;
  issues: string[];
}

/** A successful store: the scene is in the store, the response describes it. */
export interface SceneStoreSuccess {
  status: number;
  body: SceneStoreResponse;
}

/** A rejected store: nothing was written, `body.issues` says why. */
export interface SceneStoreFailure {
  status: number;
  body: SceneStoreError;
}

/**
 * The result of a store attempt.
 *
 * The union is discriminated by the `error` key on the body, so a caller
 * narrows it with `if ("error" in result.body)` — no cast, no `any`.
 */
export type SceneStoreResult = SceneStoreSuccess | SceneStoreFailure;

/** The inputs of a single store attempt. */
export interface StoreSceneOptions {
  /** the raw, untrusted scene payload (validated here) */
  body: unknown;
  store: SceneStore;
  paths: EnginePaths;
  port: number;
  /** when set, the scene is written to the creative project on disk */
  projectPath?: string;
}

/**
 * Validate, asset-resolve and store a scene.
 *
 * Shared by `POST /api/scenes` and `POST /projects/sync` so the MCP tool and the
 * CLI can never diverge on what "storing a scene" means — including the
 * non-blocking warnings and the project asset resolution.
 */
export async function storeScene(opts: StoreSceneOptions): Promise<SceneStoreResult> {
  const validation = validateScene(opts.body);
  if (!validation.ok) {
    return { status: 400, body: { error: "invalid scene", issues: validation.issues } };
  }
  const scene = validation.scene;
  const projectPath = opts.projectPath;

  // Pull any project-local artwork into the vault before the existence check, so
  // `vault:logo.png` resolves from `<project>/assets/images/logo.png`.
  let assetsResolved: ResolvedAsset[] | undefined;
  if (projectPath) {
    const outcome = await resolveProjectAssets(scene, { projectPath, enginePaths: opts.paths });
    assetsResolved = outcome.resolved;
    if (outcome.unresolved.length > 0) {
      return {
        status: 400,
        body: { error: "invalid scene", issues: unresolvedAssetIssues(outcome.unresolved) },
      };
    }
  }

  for (const asset of scene.assets) {
    if (!asset.src.startsWith("vault:")) continue;
    const name = sanitizeVaultName(asset.src.slice("vault:".length));
    if (!name || !vaultFileExists(opts.paths, name)) {
      return {
        status: 400,
        body: {
          error: "invalid scene",
          issues: [`asset "${asset.id}" references missing vault file: ${asset.src}`],
        },
      };
    }
  }

  const upserted = await opts.store.upsert(scene, projectPath ? { projectPath } : {});
  const warnings: SceneWarning[] = analyzeScene(scene);
  const response: SceneStoreResponse = {
    id: upserted.id,
    status: upserted.status,
    revision: upserted.revision,
    hash: upserted.hash,
    warnings,
    previewUrl: `http://127.0.0.1:${opts.port}/preview/?scene=${encodeURIComponent(upserted.id)}`,
    scene,
    ...(assetsResolved && assetsResolved.length > 0 ? { assetsResolved } : {}),
  };

  if (projectPath) {
    const sync = await syncSceneToDisk(projectPath, scene);
    response.savedSceneFilePath = `${projectPath.replace(/\/+$/, "")}/${sync.file}`;
    if (sync.manifestError) {
      // the scene file was written; only the manifest is missing
      warnings.push({
        code: "PROJECT_MANIFEST_MISSING",
        path: "projectPath",
        message:
          `scene written to ${sync.file}, but the project manifest could not be updated: ${sync.manifestError} ` +
          `Run init_creative_project (or \`npm run init-project\`) in that directory first.`,
      });
    }
  }

  return { status: upserted.status === "created" ? 201 : 200, body: response };
}
