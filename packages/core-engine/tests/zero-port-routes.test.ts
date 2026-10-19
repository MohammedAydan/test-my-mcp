/**
 * Zero-port route interception — the headless page with NO engine listening.
 *
 * The zero-port architecture (`docs/15_UNIFIED_ARCHITECTURE_BLUEPRINT.md`)
 * removes the engine's HTTP origin: the domain logic lives in the host
 * process, and the headless browser reaches it through Playwright's
 * `context.route` instead of over a socket.
 *
 * These tests are deliberately hostile about one thing: the page is loaded
 * from a port where NOTHING is listening. If any request escaped the
 * interception, the page would fail to load — so a green run proves the whole
 * chain (preview HTML → runtime bundle → scene JSON → vault assets) is served
 * from inside the engine process.
 *
 * Two levels of proof:
 *
 *   1. a synthetic runtime bundle — asserts the EXACT contract of every
 *      route (status, content type, body), with no dependency on a build;
 *   2. the REAL built runtime bundle — asserts that a real scene really
 *      mounts and produces layer bounds with no engine running.
 */
import { createServer } from "node:net";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseScene, type SceneSpec, type SceneSpecInput } from "@motionforge/scene-spec";
import { enginePaths, type EnginePaths } from "../src/config.js";
import { setupPlaywrightZeroPortRoutes } from "../src/renderer.js";
import { SceneStore } from "../src/scene-store.js";

let workdir: string;
let hasChromium = true;

/** A port that is guaranteed to have nothing listening on it. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 1;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

beforeAll(async () => {
  workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "mf-zero-port-"));
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    await browser.close();
  } catch {
    hasChromium = false;
  }
});

afterAll(async () => {
  await fsp.rm(workdir, { recursive: true, force: true });
});

const SCENE_INPUT: SceneSpecInput = {
  schemaVersion: 1,
  id: "zero-port-scene",
  name: "Zero Port Scene",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 2000,
  assets: [],
  fonts: [],
  layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#0b1020" } }],
};

function sceneOf(): SceneSpec {
  return parseScene(SCENE_INPUT);
}

// ---------------------------------------------------------------------------
// 1. the synthetic bundle — the exact contract of every route
// ---------------------------------------------------------------------------

const SYNTHETIC_INDEX_HTML = `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./assets/app.css" />
    <script type="module" src="./assets/app.js"></script>
  </head>
  <body><div id="out"></div></body>
</html>
`;

const SYNTHETIC_APP_JS = `
const id = new URLSearchParams(location.search).get("scene");
const sceneRes = await fetch(\`/api/scenes/\${encodeURIComponent(id)}\`);
const scene = await sceneRes.json();
const vaultRes = await fetch("/api/assets/vault/logo.svg");
const cssRes = await fetch("/assets/app.css");
const eventsRes = await fetch(\`/api/scenes/\${encodeURIComponent(id)}/events\`);
const out = document.getElementById("out");
out.dataset.scene = String(scene.name);
out.dataset.sceneType = sceneRes.headers.get("content-type") || "";
out.dataset.vault = vaultRes.status + "|" + (vaultRes.headers.get("content-type") || "");
out.dataset.css = cssRes.status + "|" + (cssRes.headers.get("content-type") || "");
out.dataset.events = eventsRes.status + "|" + (eventsRes.headers.get("content-type") || "");
out.dataset.eventsBody = (await eventsRes.text()).trim();
let fallback = "not-requested";
try {
  const res = await fetch("/not-intercepted-by-mf");
  fallback = "status:" + res.status;
} catch (error) {
  fallback = "network-error";
}
out.dataset.fallback = fallback;
out.dataset.ready = "1";
`;

async function buildSyntheticRuntime(): Promise<{ runtimeDistDir: string; vaultDir: string }> {
  const runtimeDistDir = path.join(workdir, "synthetic-runtime");
  const vaultDir = path.join(workdir, "synthetic-vault");
  await fsp.mkdir(path.join(runtimeDistDir, "assets"), { recursive: true });
  await fsp.mkdir(vaultDir, { recursive: true });
  await fsp.writeFile(path.join(runtimeDistDir, "index.html"), SYNTHETIC_INDEX_HTML, "utf8");
  await fsp.writeFile(path.join(runtimeDistDir, "assets", "app.js"), SYNTHETIC_APP_JS, "utf8");
  await fsp.writeFile(path.join(runtimeDistDir, "assets", "app.css"), "body{color:#fff}", "utf8");
  await fsp.writeFile(path.join(vaultDir, "logo.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>", "utf8");
  return { runtimeDistDir, vaultDir };
}

describe("zero-port routes: the contract of every intercepted request", () => {
  it("serves the page, the scene, the vault and the event stream with nothing listening", async () => {
    if (!hasChromium) return;
    const { runtimeDistDir, vaultDir } = await buildSyntheticRuntime();
    const paths: EnginePaths = { ...enginePaths(), runtimeDistDir, vaultDir };
    const scene = sceneOf();

    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      await setupPlaywrightZeroPortRoutes(context, { sceneId: scene.id!, scene, paths });
      const page = await context.newPage();

      // NOTHING is listening on this port — every request must be intercepted
      const port = await closedPort();
      await page.goto(`http://127.0.0.1:${port}/preview?scene=${scene.id}`, { waitUntil: "load" });
      await page.waitForSelector("#out[data-ready='1']", {
        state: "attached",
        timeout: 20_000,
      });

      const data = await page.evaluate(() => {
        const g = globalThis as unknown as {
          document: { getElementById(id: string): { dataset: Record<string, string> } | null };
        };
        return { ...(g.document.getElementById("out")?.dataset ?? {}) };
      });

      // the scene came from memory
      expect(data.scene).toBe("Zero Port Scene");
      expect(data.sceneType).toContain("application/json");
      // the vault file came from disk, with its real MIME type
      expect(data.vault).toBe("200|image/svg+xml");
      // the runtime bundle came from disk, with a MIME type the browser accepts
      expect(data.css).toContain("200|text/css");
      // the event stream is a well-formed SSE response
      expect(data.events).toBe("200|text/event-stream");
      expect(data.eventsBody).toBe(":ok");
      // anything else falls back to the network — which is not there
      expect(data.fallback).toBe("network-error");
    } finally {
      await browser.close();
    }
  }, 120_000);

  it("answers the scene route from the store when no scene is passed in", async () => {
    if (!hasChromium) return;
    const { runtimeDistDir, vaultDir } = await buildSyntheticRuntime();
    const paths: EnginePaths = { ...enginePaths(), runtimeDistDir, vaultDir };
    const store = new SceneStore(null);
    await store.upsert(sceneOf());

    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      await setupPlaywrightZeroPortRoutes(context, {
        sceneId: "zero-port-scene",
        store,
        paths,
      });
      const page = await context.newPage();
      const port = await closedPort();
      await page.goto(`http://127.0.0.1:${port}/preview?scene=zero-port-scene`, { waitUntil: "load" });
      await page.waitForSelector("#out[data-ready='1']", {
        state: "attached",
        timeout: 20_000,
      });
      const sceneName = await page.evaluate(() => {
        const g = globalThis as unknown as {
          document: { getElementById(id: string): { dataset: Record<string, string> } | null };
        };
        return g.document.getElementById("out")?.dataset.scene ?? "";
      });
      expect(sceneName).toBe("Zero Port Scene");
    } finally {
      await browser.close();
    }
  }, 120_000);

  it("refuses to escape the runtime bundle directory", async () => {
    if (!hasChromium) return;
    const { runtimeDistDir, vaultDir } = await buildSyntheticRuntime();
    // a file OUTSIDE the assets directory — a traversal must not reach it
    const secret = path.join(runtimeDistDir, "secret.txt");
    await fsp.writeFile(secret, "TOP-SECRET", "utf8");
    const paths: EnginePaths = { ...enginePaths(), runtimeDistDir, vaultDir };

    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      await setupPlaywrightZeroPortRoutes(context, { sceneId: "zero-port-scene", scene: sceneOf(), paths });
      const page = await context.newPage();
      const port = await closedPort();
      await page.goto(`http://127.0.0.1:${port}/preview?scene=zero-port-scene`, { waitUntil: "load" });
      const body = await page.evaluate(async () => {
        const g = globalThis as unknown as { fetch: (url: string) => Promise<Response> };
        try {
          const res = await g.fetch("/assets/../secret.txt");
          return await res.text();
        } catch {
          return "network-error";
        }
      });
      expect(body).not.toContain("TOP-SECRET");
    } finally {
      await browser.close();
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// 2. the REAL runtime bundle — a scene really mounts, with no engine running
// ---------------------------------------------------------------------------

describe("zero-port routes: the real scene-runtime bundle", () => {
  it("mounts a real scene and measures its layers with no engine listening", async () => {
    if (!hasChromium) return;
    const paths = enginePaths();
    const indexHtml = path.join(paths.runtimeDistDir, "index.html");
    if (!(await fsp.stat(indexHtml).catch(() => null))) {
      // the bundle is not built — `npm run build -w @motionforge/scene-runtime`
      return;
    }
    const store = new SceneStore(null);
    const scene = sceneOf();
    await store.upsert(scene);

    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      await setupPlaywrightZeroPortRoutes(context, {
        sceneId: scene.id!,
        scene,
        store,
        paths,
      });
      const page = await context.newPage();
      const port = await closedPort();
      await page.goto(
        `http://127.0.0.1:${port}/preview?scene=${scene.id}&render=1&fps=60`,
        { waitUntil: "load" }
      );
      await page.waitForFunction(
        () => {
          const g = globalThis as unknown as { renderConfig?: object; seekToFrame?: unknown };
          return typeof g.renderConfig === "object" && typeof g.seekToFrame === "function";
        },
        null,
        { timeout: 30_000 }
      );

      const layers = await page.evaluate(async () => {
        const g = globalThis as unknown as {
          seekToFrame: (frame: number) => Promise<void>;
          getLayerBounds?: () => Record<string, { width: number; height: number }>;
          document: { querySelectorAll(sel: string): { length: number } };
        };
        await g.seekToFrame(0);
        return {
          mounted: g.document.querySelectorAll(".mf-layer").length,
          bounds: g.getLayerBounds ? g.getLayerBounds() : {},
        };
      });
      expect(layers.mounted).toBeGreaterThan(0);
      expect(Object.keys(layers.bounds).length).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  }, 180_000);
});
