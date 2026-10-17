import { EventEmitter } from "node:events";
import type { SceneSpec } from "@motionforge/scene-spec";

export interface StoredScene {
  scene: SceneSpec;
  updatedAt: number;
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

/** In-memory scene store + live-preview event bus (SSE). */
export class SceneStore {
  private scenes = new Map<string, StoredScene>();
  readonly bus = new EventEmitter();

  upsert(scene: SceneSpec): { id: string; created: boolean } {
    const id = scene.id ?? sceneIdFromName(scene.name);
    const stored = { ...scene, id };
    const created = !this.scenes.has(id);
    this.scenes.set(id, { scene: stored, updatedAt: Date.now() });
    this.bus.emit(`scene:${id}`, { type: created ? "created" : "updated" });
    return { id, created };
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
