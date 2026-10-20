import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SceneStore } from "../src/scene-store.js";
import type { SceneSpec } from "@motionforge/scene-spec";

/**
 * Scene de-duplication on hydration.
 *
 * THE DEFECT: the store hydrated EVERY `*.json` in the scenes directory. A
 * repeated test / seed run therefore left several scenes with the SAME name
 * ("MotionForge Demo") side by side, and the Studio's Project Bin listed all
 * of them — five identical entries the user could not tell apart and had to
 * delete by hand.
 *
 * THE RULE: within one name group only the NEWEST **exact duplicate**
 * survives. "Exact duplicate" means the same CONTENT — the id and the exact
 * spelling of the name are excluded from the comparison, because a seeded
 * copy differs only by those. A scene that merely shares a NAME with another
 * is a DIFFERENT composition and is NEVER deleted (renaming a composition
 * onto an existing name must not destroy the older one).
 */

let workdir: string;
let scenesDir: string;

const BASE = {
  schemaVersion: 1 as const,
  canvas: { shape: "16:9" as const, scale: 1080 as const },
  durationMs: 4000,
  layers: [
    {
      id: "bg",
      type: "background" as const,
      variant: { variant: "solid" as const, color: "#05070d" },
    },
  ],
};

/** Write a scene file with an explicit envelope (updatedAt / revision). */
async function writeScene(
  id: string,
  name: string,
  meta: { updatedAt?: number; revision?: number } = {}
): Promise<string> {
  const file = path.join(scenesDir, `${id}.json`);
  const envelope = {
    schemaVersion: 1,
    scene: { ...BASE, id, name },
    revision: meta.revision ?? 1,
    hash: `hash-${id}`,
    updatedAt: meta.updatedAt ?? 0,
  };
  await fsp.writeFile(file, JSON.stringify(envelope, null, 2), "utf8");
  return file;
}

async function sceneFiles(): Promise<string[]> {
  const entries = await fsp.readdir(scenesDir);
  return entries.filter((f) => f.endsWith(".json")).sort();
}

beforeEach(async () => {
  workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "mf-scene-dedup-"));
  scenesDir = path.join(workdir, "scenes");
  await fsp.mkdir(scenesDir, { recursive: true });
});

afterEach(async () => {
  await fsp.rm(workdir, { recursive: true, force: true });
});

describe("scene store de-duplication", () => {
  it("keeps only the NEWEST scene of a same-name group", async () => {
    await writeScene("demo-old", "MotionForge Demo", { updatedAt: 1000, revision: 1 });
    await writeScene("demo-mid", "MotionForge Demo", { updatedAt: 2000, revision: 2 });
    await writeScene("demo-new", "MotionForge Demo", { updatedAt: 3000, revision: 3 });

    const store = new SceneStore({ scenesDir });
    const result = await store.load();

    expect(result.loaded).toBe(1);
    expect(result.dropped.sort()).toEqual(["demo-mid", "demo-old"]);
    expect(store.list().map((s) => s.scene.id)).toEqual(["demo-new"]);
    expect(store.get("demo-new")).toBeDefined();
    expect(store.get("demo-old")).toBeUndefined();
    expect(store.get("demo-mid")).toBeUndefined();
  });

  it("keeps a scene whose name is unique", async () => {
    await writeScene("demo", "MotionForge Demo", { updatedAt: 1000 });
    await writeScene("other", "Something Else", { updatedAt: 500 });

    const store = new SceneStore({ scenesDir });
    const result = await store.load();

    expect(result.loaded).toBe(2);
    expect(result.dropped).toEqual([]);
    expect(store.get("demo")).toBeDefined();
    expect(store.get("other")).toBeDefined();
  });

  it("removes the dropped scenes from disk", async () => {
    await writeScene("demo-old", "MotionForge Demo", { updatedAt: 1000 });
    await writeScene("demo-new", "MotionForge Demo", { updatedAt: 3000 });

    const store = new SceneStore({ scenesDir });
    await store.load();

    expect(await sceneFiles()).toEqual(["demo-new.json"]);
  });

  it("is case- and whitespace-insensitive about the name", async () => {
    await writeScene("demo-a", "MotionForge Demo", { updatedAt: 1000 });
    await writeScene("demo-b", "  motionforge demo  ", { updatedAt: 2000 });

    const store = new SceneStore({ scenesDir });
    const result = await store.load();

    expect(result.loaded).toBe(1);
    expect(store.get("demo-b")).toBeDefined();
    expect(store.get("demo-a")).toBeUndefined();
  });

  it("falls back to the revision when the timestamps are equal", async () => {
    await writeScene("demo-low", "Twin", { updatedAt: 0, revision: 1 });
    await writeScene("demo-high", "Twin", { updatedAt: 0, revision: 9 });

    const store = new SceneStore({ scenesDir });
    const result = await store.load();

    expect(result.loaded).toBe(1);
    expect(store.get("demo-high")).toBeDefined();
    expect(store.get("demo-low")).toBeUndefined();
  });

  it("emits a deleted event for every dropped scene", async () => {
    await writeScene("demo-old", "MotionForge Demo", { updatedAt: 1000 });
    await writeScene("demo-new", "MotionForge Demo", { updatedAt: 3000 });

    const store = new SceneStore({ scenesDir });
    const events: Array<{ id: string; type: string }> = [];
    store.bus.on("scene:demo-old", (evt: { type: string }) => {
      events.push({ id: "demo-old", type: evt.type });
    });
    await store.load();

    expect(events).toEqual([{ id: "demo-old", type: "deleted" }]);
  });

  it("a second boot finds nothing left to clean up", async () => {
    await writeScene("demo-old", "MotionForge Demo", { updatedAt: 1000 });
    await writeScene("demo-new", "MotionForge Demo", { updatedAt: 3000 });

    const first = new SceneStore({ scenesDir });
    await first.load();

    const second = new SceneStore({ scenesDir });
    const result = await second.load();

    expect(result.loaded).toBe(1);
    expect(result.dropped).toEqual([]);
    expect(second.get("demo-new")).toBeDefined();
  });

  it("never drops a scene whose name is unique, even next to a big group", async () => {
    await writeScene("demo-d1", "Group", { updatedAt: 1000 });
    await writeScene("demo-d2", "Group", { updatedAt: 2000 });
    await writeScene("demo-d3", "Group", { updatedAt: 3000 });
    await writeScene("solo", "Solo", { updatedAt: 1 });

    const store = new SceneStore({ scenesDir });
    const result = await store.load();

    expect(result.loaded).toBe(2);
    expect(store.get("solo")).toBeDefined();
    expect(store.get("demo-d3")).toBeDefined();
  });

  it("keeps the surviving scene's own content intact", async () => {
    const file = path.join(scenesDir, "demo-new.json");
    await fsp.writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        scene: {
          ...BASE,
          id: "demo-new",
          name: "MotionForge Demo",
          layers: [
            {
              id: "bg",
              type: "background",
              variant: { variant: "solid", color: "#05070d" },
            },
            {
              id: "title",
              type: "kineticText",
              text: "Survivor",
              sizePx: 80,
              position: { xPct: 50, yPct: 45 },
            },
          ],
        },
        revision: 4,
        hash: "hash-demo-new",
        updatedAt: 5000,
      }),
      "utf8"
    );
    await writeScene("demo-old", "MotionForge Demo", { updatedAt: 1000 });

    const store = new SceneStore({ scenesDir });
    await store.load();

    const kept = store.get("demo-new");
    expect(kept).toBeDefined();
    const scene = kept!.scene as SceneSpec;
    expect(scene.layers).toHaveLength(2);
    expect(kept!.updatedAt).toBe(5000);
    expect(kept!.revision).toBe(4);
  });

  it("NEVER merges two USER-created scenes that happen to be identical", async () => {
    // Identical content is not proof of a duplicate: the user may have made
    // two copies on purpose. Only SEEDED scenes are collapsed.
    await writeScene("scene-one", "Untitled Composition", { updatedAt: 1000 });
    await writeScene("scene-two", "Untitled Composition", { updatedAt: 2000 });

    const store = new SceneStore({ scenesDir });
    const result = await store.load();

    expect(result.loaded).toBe(2);
    expect(result.dropped).toEqual([]);
    expect(store.get("scene-one")).toBeDefined();
    expect(store.get("scene-two")).toBeDefined();
    expect(await sceneFiles()).toEqual(["scene-one.json", "scene-two.json"]);
  });

  it("NEVER deletes a same-named scene whose content DIFFERS", async () => {
    // The destructive rule: renaming a composition onto an existing name
    // silently destroyed the older one on the next boot. Two scenes that share
    // a NAME but differ in CONTENT are two different compositions.
    const file = path.join(scenesDir, "richer.json");
    await fsp.writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        scene: {
          ...BASE,
          id: "richer",
          name: "MotionForge Demo",
          layers: [
            {
              id: "bg",
              type: "background",
              variant: { variant: "solid", color: "#05070d" },
            },
            {
              id: "title",
              type: "kineticText",
              text: "Different",
              sizePx: 80,
              position: { xPct: 50, yPct: 45 },
            },
          ],
        },
        revision: 2,
        hash: "hash-richer",
        updatedAt: 5000,
      }),
      "utf8"
    );
    await writeScene("plain", "MotionForge Demo", { updatedAt: 1000 });

    const store = new SceneStore({ scenesDir });
    const result = await store.load();

    expect(result.loaded).toBe(2);
    expect(result.dropped).toEqual([]);
    expect(store.get("richer")).toBeDefined();
    expect(store.get("plain")).toBeDefined();
    // and the file on disk survives
    expect(await sceneFiles()).toEqual(["plain.json", "richer.json"]);
  });
});
