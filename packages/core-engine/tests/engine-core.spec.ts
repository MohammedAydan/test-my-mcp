import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  createEngineCore,
  EngineCore,
  resolveEnginePaths,
} from "../src/index.js";
import type { SceneSpec } from "@motionforge/scene-spec";

const sampleScene = {
  schemaVersion: 1,
  id: "test-scene-alpha",
  name: "Test Scene Alpha",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 3000,
  layers: [
    {
      id: "bg",
      type: "background",
      variant: { variant: "solid", color: "#05070d" },
    },
    {
      id: "title",
      type: "kineticText",
      at: 400,
      text: "Hello MotionForge",
      sizePx: 96,
      position: { xPct: 50, yPct: 50 },
      fill: "#ffffff",
      entrance: { name: "smoothSlideUp" },
    },
  ],
  assets: [],
  audio: { cues: [] },
};

describe("EngineCore & Unified Architecture", () => {
  let tempDir: string;
  let core: EngineCore;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `mf-core-test-${randomUUID().slice(0, 8)}`);
    await fsp.mkdir(tempDir, { recursive: true });
    core = await createEngineCore({
      dataDir: tempDir,
      enableWatcher: true,
    });
  });

  afterEach(async () => {
    await core.dispose();
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  });

  describe("resolveEnginePaths", () => {
    it("resolves explicitly provided paths", () => {
      const explicit = resolveEnginePaths({
        storageDir: "/custom/storage",
        vaultDir: "/custom/vault",
      });
      expect(explicit.storageDir).toBe("/custom/storage");
      expect(explicit.vaultDir).toBe("/custom/vault");
    });

    it("falls back to deterministic canonical path when unconfigured", () => {
      const resolved = resolveEnginePaths();
      const expectedBase = path.join(os.homedir(), ".motionforge");
      expect(resolved.storageDir).toBe(path.join(expectedBase, "scenes"));
      expect(resolved.vaultDir).toBe(path.join(expectedBase, "vault"));
    });
  });

  describe("Scene CRUD & BE-004 Scene Deletion", () => {
    it("saves and retrieves scenes with atomic persistence", async () => {
      let eventPayload: any = null;
      core.on("scene:updated", (evt) => {
        eventPayload = evt;
      });

      const saved = await core.saveScene(sampleScene);
      expect(saved.id).toBe("test-scene-alpha");
      expect(saved.status).toBe("created");
      expect(saved.revision).toBe(1);
      expect(eventPayload).toMatchObject({
        sceneId: "test-scene-alpha",
        revision: 1,
        source: "internal",
      });

      // Verify retrieved from memory
      const retrieved = await core.getScene("test-scene-alpha");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe("Test Scene Alpha");

      // Verify file persisted on disk
      const filePath = path.join(core.paths.storageDir, "test-scene-alpha.json");
      const diskContent = JSON.parse(await fsp.readFile(filePath, "utf8"));
      expect(diskContent.scene.name).toBe("Test Scene Alpha");
      expect(diskContent.revision).toBe(1);
    });

    it("lists stored scenes with summary metrics", async () => {
      await core.saveScene(sampleScene);
      const list = await core.listScenes();
      expect(list.length).toBe(1);
      expect(list[0]).toMatchObject({
        id: "test-scene-alpha",
        name: "Test Scene Alpha",
        revision: 1,
        layerCount: 2,
        durationMs: 3000,
      });
    });

    it("deletes scene from memory and disk (BE-004)", async () => {
      await core.saveScene(sampleScene);
      const filePath = path.join(core.paths.storageDir, "test-scene-alpha.json");
      expect(await fsp.stat(filePath)).toBeDefined();

      let deletedPayload: any = null;
      core.on("scene:deleted", (evt) => {
        deletedPayload = evt;
      });

      const res = await core.deleteScene("test-scene-alpha");
      expect(res).toEqual({ id: "test-scene-alpha", success: true });
      expect(deletedPayload).toEqual({ sceneId: "test-scene-alpha", source: "internal" });

      // Verify in-memory removal
      const after = await core.getScene("test-scene-alpha");
      expect(after).toBeNull();

      // Verify disk removal
      let exists = true;
      try {
        await fsp.stat(filePath);
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
    });
  });

  describe("Asset Ingestion & Listing (BE-003)", () => {
    it("ingests binary assets and lists vault assets authoritatively", async () => {
      let vaultEventFired = false;
      core.on("vault:updated", () => {
        vaultEventFired = true;
      });

      const sampleBuffer = Buffer.from("fake-png-content-stream");
      const asset = await core.ingestAsset(sampleBuffer, "test-logo.png", "image");

      expect(asset.id).toBe("test-logo.png");
      expect(asset.src).toBe("vault:test-logo.png");
      expect(asset.kind).toBe("image");
      expect(asset.size).toBe(sampleBuffer.length);
      expect(vaultEventFired).toBe(true);

      const list = await core.listAssets();
      const found = list.find((a) => a.name === "test-logo.png");
      expect(found).toBeDefined();
      expect(found?.mimeType).toBe("image/png");
    });
  });

  describe("Cross-Process Watcher Synchronization", () => {
    it("detects external scene changes on disk and updates in-memory store", async () => {
      await core.saveScene(sampleScene);

      let externalEventPromise = new Promise<any>((resolve) => {
        core.on("scene:updated", (evt) => {
          if (evt.source === "external") resolve(evt);
        });
      });

      // Simulate external process writing to storageDir
      const filePath = path.join(core.paths.storageDir, "test-scene-alpha.json");
      const diskContent = JSON.parse(await fsp.readFile(filePath, "utf8"));
      diskContent.scene.name = "Externally Renamed Scene";
      diskContent.revision = 2;
      diskContent.hash = "external-hash-999";
      await fsp.writeFile(filePath, JSON.stringify(diskContent, null, 2), "utf8");

      const event = await externalEventPromise;
      expect(event.sceneId).toBe("test-scene-alpha");
      expect(event.source).toBe("external");

      const updated = await core.getScene("test-scene-alpha");
      expect(updated?.name).toBe("Externally Renamed Scene");
    });

    it("detects external scene deletion on disk and removes from in-memory store", async () => {
      await core.saveScene(sampleScene);

      let deleteEventPromise = new Promise<any>((resolve) => {
        core.on("scene:deleted", (evt) => {
          if (evt.source === "external") resolve(evt);
        });
      });

      // Simulate external process unlinking file
      const filePath = path.join(core.paths.storageDir, "test-scene-alpha.json");
      await fsp.unlink(filePath);

      const event = await deleteEventPromise;
      expect(event.sceneId).toBe("test-scene-alpha");
      expect(event.source).toBe("external");

      const after = await core.getScene("test-scene-alpha");
      expect(after).toBeNull();
    });
  });
});
