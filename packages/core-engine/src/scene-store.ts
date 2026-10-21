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

import { validateScene, sanitizeSceneInput, type SceneSpec } from "@motionforge/scene-spec";

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

/**
 * The result of a store hydration.
 *
 * `dropped` lists the scenes that were removed because a NEWER scene with the
 * same name existed — they are gone from the store AND from disk.
 */
export interface SceneStoreLoadResult {
  loaded: number;
  issues: SceneStoreLoadIssue[];
  /** ids of the scenes the de-duplication removed */
  dropped: string[];
}

export const SCENE_STORE_SCHEMA_VERSION = 1;

/**
 * The key scenes are grouped by when they are de-duplicated.
 *
 * Two scenes called "MotionForge Demo" and "  motionforge demo " are the same
 * scene as far as a human is concerned, so the comparison ignores case and the
 * surrounding whitespace.
 */
export function normalizeSceneName(name: string | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

/**
 * True when a scene id belongs to a SEEDED (auto-generated) scene.
 *
 * Only seeded scenes may be collapsed by the de-duplication pass. Two
 * compositions the USER created are never merged, even when they are
 * byte-identical — identical content is not proof of a duplicate.
 */
export function isSeededSceneId(id: string): boolean {
  return /^(demo|mf-demo|scene-motionforge-demo|showcase)[-_]/i.test(id) ||
    /^demo$/i.test(id) ||
    /^mf-demo$/i.test(id) ||
    /^scene-motionforge-demo$/i.test(id) ||
    /^showcase$/i.test(id);
}

/**
 * Order two scenes by recency: newest first.
 *
 * `updatedAt` is the primary key; `revision` breaks a tie (a legacy file
 * written before the envelope existed has no `updatedAt`, so it reads 0), and
 * the id is the final tie-break so the result is DETERMINISTIC — two boots on
 * the same folder always keep the same scene.
 */
export function compareSceneRecency(a: StoredScene, b: StoredScene): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  if (a.revision !== b.revision) return b.revision - a.revision;
  return (a.scene.id ?? "").localeCompare(b.scene.id ?? "");
}

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

/**
 * A hash of the scene's CONTENT, ignoring its id and its name.
 *
 * Two copies of the same composition differ only by their id (the seeder
 * stamps a random one) and by the exact spelling of the name (the de-dup
 * groups them case- and whitespace-insensitively), so both are excluded for
 * the two to be recognised as the same scene. A scene that shares a NAME with
 * another but differs in content gets a different hash — and is therefore
 * never deleted.
 */
export function sceneContentHash(scene: SceneSpec): string {
  const { id: _ignoredId, name: _ignoredName, ...rest } = scene as SceneSpec & {
    id?: string;
    name?: string;
  };
  return createHash("sha256").update(stableStringify(rest)).digest("hex").slice(0, 16);
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

  /**
   * Per-scene write chains.
   *
   * One promise chain per scene id: concurrent saves to the SAME id are
   * serialised (so the revision counter advances and no save is lost), while
   * saves to DIFFERENT ids stay fully parallel.
   */
  private readonly writeChains = new Map<string, Promise<void>>();
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
   *
   * After hydration the store DE-DUPLICATES by name: repeated test / seed runs
   * leave several scenes with the same name, and the Studio's Project Bin
   * lists every one of them. The newest survives; the rest are dropped from
   * the store and deleted from disk.
   */
  async load(): Promise<SceneStoreLoadResult> {
    this.loadIssues.length = 0;
    if (!this.scenesDir) return { loaded: 0, issues: this.loadIssues, dropped: [] };
    const dir = this.scenesDir;
    let entries: string[];
    try {
      await mkdir(dir, { recursive: true });
      entries = await readdir(dir);
    } catch (error) {
      this.loadIssues.push({ file: dir, error: `cannot read scene store: ${describe(error)}` });
      return { loaded: 0, issues: this.loadIssues, dropped: [] };
    }

    /** the file each hydrated scene came from, so a dropped scene can be deleted */
    const sourceFiles = new Map<string, string>();
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
      // LEGACY HEALING.
      //
      // A scene file on disk may have been written by an older build: it can
      // carry UI-only bookkeeping keys (`_hidden`, `_locked`) or keys the
      // current schema has retired. Those are normalized away (and healed into
      // their modern equivalents) instead of making the whole scene
      // unloadable. A scene whose VALUES are genuinely illegal is still
      // rejected — healing must never hide a real authoring error.
      const validation = validateScene(sanitizeSceneInput(raw, { dropUnknown: true }));
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
      sourceFiles.set(id, file);
      loaded++;
    }

    const dropped = await this.dropDuplicateScenes(sourceFiles);
    return { loaded: this.scenes.size, issues: this.loadIssues, dropped };
  }

  /**
   * Remove every scene that is an EXACT duplicate of a newer twin.
   *
   * The rule is deliberately narrow, because the broad version destroys data:
   *
   * - Two scenes that merely share a NAME are NOT duplicates. Renaming a
   *   composition onto an existing name must never delete the older one.
   * - A scene is a duplicate only when its CONTENT matches the keeper's
   *   (compared with a content hash that IGNORES the scene id and the exact
   *   spelling of the name — a seeded copy differs only by those).
   * - AND the victim must be a SEEDED scene (its id matches the demo
   *   pattern). Two compositions the USER created that happen to be identical
   *   are two compositions, not one — they are never collapsed.
   *
   * The removed scenes are deleted from disk as well, so the next boot does
   * not have to repeat the cleanup.
   */
  private async dropDuplicateScenes(sourceFiles: Map<string, string>): Promise<string[]> {
    const groups = new Map<string, Array<{ key: string; entry: StoredScene }>>();
    for (const [key, entry] of this.scenes) {
      const name = normalizeSceneName(entry.scene.name);
      const group = groups.get(name) ?? [];
      group.push({ key, entry });
      groups.set(name, group);
    }

    const dropped: string[] = [];
    for (const [name, group] of groups) {
      if (group.length <= 1) continue;
      const ordered = [...group].sort((a, b) => compareSceneRecency(a.entry, b.entry));
      const keeper = ordered[0]!;
      const keeperContent = sceneContentHash(keeper.entry.scene);
      for (const victim of ordered.slice(1)) {
        // SAME NAME but DIFFERENT CONTENT → a different composition that
        // happens to share a title. It is NOT a duplicate and must survive.
        if (sceneContentHash(victim.entry.scene) !== keeperContent) {
          continue;
        }
        // NOT a seeded copy → the user made it. Identical content is not
        // proof of a duplicate, so it is left alone.
        if (!isSeededSceneId(victim.entry.scene.id ?? victim.key)) {
          continue;
        }
        this.scenes.delete(victim.key);
        dropped.push(victim.key);
        const file = sourceFiles.get(victim.key);
        if (file) {
          try {
            await unlink(file);
          } catch (error) {
            this.loadIssues.push({
              file: path.basename(file),
              error: `could not delete duplicate scene: ${describe(error)}`,
            });
          }
        }
        console.warn(
          `[scene-store] dropped duplicate scene "${victim.entry.scene.name}" (${victim.key}) — ` +
            `kept the newer "${keeper.entry.scene.id}"`
        );
        this.bus.emit(`scene:${victim.key}`, {
          type: "deleted",
          reason: "duplicate-content",
          kept: keeper.entry.scene.id,
        });
      }
    }
    return dropped;
  }

  async upsert(scene: SceneSpec, meta: { projectPath?: string } = {}): Promise<UpsertResult> {
    const id = scene.id ?? sceneIdFromName(scene.name);
    // The write is SERIALISED per scene id.
    //
    // THE BUG THIS FIXES: `upsert` used to read the previous revision BEFORE
    // the async disk write, so 25 concurrent saves to the SAME id all read
    // revision 0, all computed revision 1, and all wrote the same file. The
    // store ended at revision 1 and 24 of the 25 saves were silently lost —
    // the atomic temp-file+rename kept the JSON valid, but the LAST writer
    // won and the revision counter never advanced.
    //
    // The lock is per id, so saves to DIFFERENT scenes still run in parallel.
    return await this.withSceneLock(id, async () => {
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
    });
  }

  /**
   * Run `task` with exclusive access to one scene id.
   *
   * A per-id promise chain: every caller waits for the previous holder of the
   * SAME id, and callers on OTHER ids never wait for each other.
   */
  private async withSceneLock<T>(id: string, task: () => Promise<T>): Promise<T> {
    const prior = this.writeChains.get(id) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = prior.then(() => gate);
    this.writeChains.set(id, chain);
    await prior;
    try {
      return await task();
    } finally {
      release();
      // Drop the entry when this call was the last in the chain, so the map
      // does not grow without bound.
      void chain.then(() => {
        if (this.writeChains.get(id) === chain) this.writeChains.delete(id);
      });
    }
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