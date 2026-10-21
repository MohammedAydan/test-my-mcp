import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SceneStore } from "../src/scene-store.js";
import type { SceneSpec } from "@motionforge/scene-spec";

/**
 * CONCURRENT WRITES TO ONE SCENE.
 *
 * THE DEFECT: `upsert()` read the previous revision BEFORE the async disk
 * write, so N concurrent saves to the SAME id all read revision 0, all
 * computed revision 1 and all wrote the same file. The store ended at
 * revision 1 and N-1 saves were silently LOST — the last writer won.
 * The atomic temp-file+rename kept the JSON valid, so the corruption was
 * invisible; only the revision counter told the truth.
 *
 * THE RULE: concurrent saves to one id are serialised per id, so the
 * revisions form a gapless 1..N sequence and every save is accounted for.
 * Saves to DIFFERENT ids stay parallel.
 */

let workdir: string;
let scenesDir: string;

const baseScene = (id: string, name: string): SceneSpec =>
  ({
    schemaVersion: 1,
    id,
    name,
    canvas: { shape: "16:9", scale: 1080 },
    durationMs: 4000,
    layers: [
      {
        id: "bg",
        type: "background",
        variant: { variant: "solid", color: "#05070d" },
      },
    ],
  }) as unknown as SceneSpec;

const sceneFiles = async (): Promise<string[]> =>
  (await fsp.readdir(scenesDir)).filter((f) => f.endsWith(".json")).sort();

const tmpFiles = async (): Promise<string[]> =>
  (await fsp.readdir(scenesDir)).filter((f) => f.endsWith(".tmp")).sort();

beforeEach(async () => {
  workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "mf-concurrency-"));
  scenesDir = path.join(workdir, "scenes");
  await fsp.mkdir(scenesDir, { recursive: true });
});

afterEach(async () => {
  await fsp.rm(workdir, { recursive: true, force: true });
});

describe("scene store — concurrent writes", () => {
  it("serialises concurrent saves to the SAME id into a gapless revision sequence", async () => {
    const store = new SceneStore({ scenesDir });
    await store.load();

    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        store.upsert(baseScene("concurrent", `Concurrent ${i}`))
      )
    );

    const revisions = results.map((r) => r.revision).sort((a, b) => a - b);
    expect(revisions).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(new Set(revisions).size).toBe(25);

    const stored = store.get("concurrent");
    expect(stored?.revision).toBe(25);

    // the file on disk carries the final revision
    const raw = JSON.parse(
      await fsp.readFile(path.join(scenesDir, "concurrent.json"), "utf8")
    );
    expect(raw.revision).toBe(25);
  });

  it("leaves no temp files and no corrupt JSON behind", async () => {
    const store = new SceneStore({ scenesDir });
    await store.load();

    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        store.upsert(baseScene("concurrent", `Concurrent ${i}`))
      )
    );

    expect(await tmpFiles()).toEqual([]);
    expect(await sceneFiles()).toEqual(["concurrent.json"]);
    // every file parses
    for (const file of await sceneFiles()) {
      const raw = JSON.parse(await fsp.readFile(path.join(scenesDir, file), "utf8"));
      expect(raw.scene).toBeDefined();
      expect(typeof raw.revision).toBe("number");
    }
  });

  it("keeps saves to DIFFERENT ids fully independent", async () => {
    const store = new SceneStore({ scenesDir });
    await store.load();

    const ids = ["a", "b", "c", "d", "e"];
    const results = await Promise.all(
      ids.flatMap((id) =>
        Array.from({ length: 5 }, (_, i) => store.upsert(baseScene(id, `${id} ${i}`)))
      )
    );

    // every save of the same id got a distinct revision 1..5
    for (const id of ids) {
      const revisions = results
        .filter((_, index) => ids[Math.floor(index / 5)] === id)
        .map((r) => r.revision)
        .sort((a, b) => a - b);
      expect(revisions).toEqual([1, 2, 3, 4, 5]);
      expect(store.get(id)?.revision).toBe(5);
    }
    expect(await tmpFiles()).toEqual([]);
  });
});
