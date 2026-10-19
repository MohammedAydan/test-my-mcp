/**
 * Scene store — in-memory index + disk persistence.
 *
 * THE BUG THIS FIXES (report 2 / C3-F2): the store was a bare `Map`. Restarting
 * core-engine wiped every stored scene, so a render job could not be resumed and
 * the live preview 404'd — and an agent that had just authored eight scenes lost
 * all of them to a restart.
 *
 * Each scene is now one self-describing JSON file under `data/scenes/`:
 *
 *     data/scenes/<sceneId>.json   →  { schemaVersion, scene, revision, hash,
 *                                       updatedAt, projectPath? }
 *
 * Writes go through a temp file + `rename`, which is atomic on POSIX: a reader
 * (or a crash) can never observe a half-written scene.
 */
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateScene, type SceneSpec } from "@motionforge/scene-spec";

export interface StoredScene {
  scene: SceneSpec;
  updatedAt: number;
  /** bumped on every write; survives a restart */
  revision: number;
  /** content hash of the scene — lets a caller skip redundant re-renders */
  hash: string;
  /** the creative project this scene belongs to, when one was supplied */
  projectPath?: string;
}

export interface UpsertResult {
  id: string;
  status: "created" | "updated";
  revision: number;
  hash: string;
  /** true when the content is byte-identical to the stored copy */
  unchanged: boolean;
}

export type SceneStoreLoadIssue = {
  file: string;
  error: string;
};

export const SCENE_STORE_SCHEMA_VERSION = 1;

export function sceneIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "scene";
}

/** Stable content hash of a scene (key order does not affect it). */
export function sceneHash(scene: SceneSpec): string {
  return createHash("sha256").update(stableStringify(scene)).digest("hex").slice(0, 16);
}

/** JSON with sorted keys, so two structurally equal scenes hash identically. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

interface PersistedScene {
  schemaVersion: number;
  scene: SceneSpec;
  revision: number;
  hash: string;
  updatedAt: number;
  projectPath?: string;
}

/** Scene store + live-preview event bus (SSE), backed by `data/scenes/`. */
export class SceneStore {
  private scenes = new Map<string, StoredScene>();
  readonly bus = new EventEmitter();
  /** files that failed to hydrate, surfaced so a broken scene is never silent */
  readonly loadIssues: SceneStoreLoadIssue[] = [];

  private readonly dataDir: string | null = null;
  private readonly _scenesDir: string | null = null;

  /**
   * @param dataDir `packages/core-engine/data` or `{ dataDir, scenesDir }`. Pass `null` for a purely
   *   in-memory store (tests that do not care about persistence).
   */
  constructor(
    dataDirOrOptions: string | null | { dataDir?: string | null; scenesDir?: string | null } = null
  ) {
    this.bus.setMaxListeners(0);
    if (typeof dataDirOrOptions === "string" || dataDirOrOptions === null) {
      this.dataDir = dataDirOrOptions;
      this._scenesDir = dataDirOrOptions ? path.join(dataDirOrOptions, "scenes") : null;
    } else {
      this.dataDir = dataDirOrOptions.dataDir ?? null;
      this._scenesDir =
        dataDirOrOptions.scenesDir ?? (this.dataDir ? path.join(this.dataDir, "scenes") : null);
    }
  }

  get scenesDir(): string | null {
    return this._scenesDir;
  }

  /**
   * Hydrate from disk. Every file is re-validated with the real schema, so a
   * scene hand-edited into an illegal state is rejected (and reported) instead
   * of crashing a later render.
   */
  async load(): Promise<{ loaded: number; issues: SceneStoreLoadIssue[] }> {
    this.loadIssues.length = 0;
    if (!this.scenesDir) return { loaded: 0, issues: this.loadIssues };
    const dir = this.scenesDir;
    let entries: string[];
    try {
      await mkdir(dir, { recursive: true });
      entries = await readdir(dir);
    } catch (error) {
      this.loadIssues.push({ file: dir, error: `cannot read scene store: ${describe(error)}` });
      return { loaded: 0, issues: this.loadIssues };
    }

    let loaded = 0;
    for (const name of entries.filter((f) => f.endsWith(".json")).sort()) {
      const file = path.join(dir, name);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(file, "utf8"));
      } catch (error) {
        this.loadIssues.push({ file: name, error: `unreadable: ${describe(error)}` });
        continue;
      }
      const envelope = parsed as Partial<PersistedScene> | null;
      const raw = envelope && typeof envelope === "object" && "scene" in envelope ? envelope.scene : parsed;
      const validation = validateScene(raw);
      if (!validation.ok) {
        this.loadIssues.push({ file: name, error: `invalid scene: ${validation.issues.join("; ")}` });
        continue;
      }
      const id =
        (typeof envelope?.scene?.id === "string" && envelope.scene.id) ||
        path.basename(name, ".json");
      const scene: SceneSpec = validation.scene;
      scene.id ??= id;
      this.scenes.set(id, {
        scene,
        updatedAt: typeof envelope?.updatedAt === "number" ? envelope.updatedAt : 0,
        revision: typeof envelope?.revision === "number" ? envelope.revision : 1,
        hash: typeof envelope?.hash === "string" ? envelope.hash : sceneHash(scene),
        ...(typeof envelope?.projectPath === "string" ? { projectPath: envelope.projectPath } : {}),
      });
      loaded++;
    }
    return { loaded, issues: this.loadIssues };
  }

  async upsert(scene: SceneSpec, meta: { projectPath?: string } = {}): Promise<UpsertResult> {
    const id = scene.id ?? sceneIdFromName(scene.name);
    const stored = { ...scene, id };
    const previous = this.scenes.get(id);
    const hash = sceneHash(stored);
    const unchanged = previous?.hash === hash;
    const entry: StoredScene = {
      scene: stored,
      updatedAt: Date.now(),
      revision: unchanged && previous ? previous.revision : (previous?.revision ?? 0) + 1,
      hash,
      ...(meta.projectPath ?? previous?.projectPath
        ? { projectPath: meta.projectPath ?? previous?.projectPath }
        : {}),
    };

    await this.persist(entry);
    this.scenes.set(id, entry);
    this.bus.emit(`scene:${id}`, { type: previous ? "updated" : "created" });
    return { id, status: previous ? "updated" : "created", revision: entry.revision, hash, unchanged };
  }

  private async persist(entry: StoredScene): Promise<void> {
    if (!this.scenesDir || !entry.scene.id) return;
    const dir = this.scenesDir;
    await mkdir(dir, { recursive: true });
    const envelope: PersistedScene = {
      schemaVersion: SCENE_STORE_SCHEMA_VERSION,
      scene: entry.scene,
      revision: entry.revision,
      hash: entry.hash,
      updatedAt: entry.updatedAt,
      ...(entry.projectPath ? { projectPath: entry.projectPath } : {}),
    };
    const target = path.join(dir, `${sanitize(entry.scene.id)}.json`);
    // temp file + rename: a reader can never see a partially written scene
    const tmp = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    await writeFile(tmp, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    await rename(tmp, target);
  }

  async delete(id: string): Promise<boolean> {
    const existing = this.scenes.get(id);
    if (!existing) return false;
    this.scenes.delete(id);
    if (this.scenesDir && existing.scene.id) {
      const target = path.join(this.scenesDir, `${sanitize(existing.scene.id)}.json`);
      try {
        await unlink(target);
      } catch {
        // file might not exist on disk, ignore
      }
    }
    this.bus.emit(`scene:${id}`, { type: "deleted" });
    return true;
  }

  /** Synchronize an entry from external process watcher */
  setEntry(id: string, entry: StoredScene): void {
    this.scenes.set(id, entry);
    this.bus.emit(`scene:${id}`, { type: "updated" });
  }

  /** Remove an entry from external process watcher */
  removeEntry(id: string): boolean {
    const removed = this.scenes.delete(id);
    if (removed) {
      this.bus.emit(`scene:${id}`, { type: "deleted" });
    }
    return removed;
  }

  get(id: string): StoredScene | undefined {
    return this.scenes.get(id);
  }

  require(id: string): StoredScene {
    const found = this.scenes.get(id);
    if (!found) {
      const err = new Error(`unknown scene "${id}"`) as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    }
    return found;
  }

  list(): StoredScene[] {
    return [...this.scenes.values()];
  }
}

function sanitize(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9._-]/g, "-");
  return safe || "scene";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}