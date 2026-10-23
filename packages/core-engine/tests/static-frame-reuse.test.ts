import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveEnginePaths } from "../src/config.js";
import { EngineCore } from "../src/engine-core.js";
import { probeMedia } from "../src/media-probe.js";
import { ensureSfxBank } from "../src/sfx-bank.js";

describe("static-frame reuse telemetry", () => {
  let workdir: string;
  let core: EngineCore;

  beforeAll(async () => {
    workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "m10-static-"));
    const paths = resolveEnginePaths({ dataDir: workdir });
    await ensureSfxBank(paths);
    core = new EngineCore({ port: 4013, maxRenderWorkers: 1, paths }, paths, { enableWatcher: false });
    await core.init();
  }, 60_000);

  afterAll(async () => {
    await core.dispose();
    await fsp.rm(workdir, { recursive: true, force: true });
  }, 30_000);

  it("renders a 2s static scene at preview and reports reused frames", async () => {
    const scene = {
      schemaVersion: 1 as const,
      canvas: { shape: "16:9" as const, scale: 1080 },
      durationMs: 2000,
      layers: [
        {
          id: "bg",
          type: "background" as const,
          variant: { variant: "solid" as const, color: "#101820" },
          at: 0,
          direction: "ltr",
        },
        {
          id: "text",
          type: "kineticText" as const,
          text: "Static Title",
          sizePx: 72,
          fill: "#ffffff",
          position: { xPct: 50, yPct: 50 },
          at: 0,
          duration: 2000,
          direction: "ltr",
          role: "headline",
          fontWeight: 800,
          lineHeight: 1.15,
          letterSpacingPx: 0,
          align: "center",
          animateBy: "word",
        },
      ],
    };

    await core.saveScene({ ...scene, id: "m10-static", name: "M10 Static" });

    const result = await core.startRender("m10-static", "preview");
    expect(result.status).toBe("running");

    // Wait for completion
    let status = core.getRenderStatus(result.jobId);
    while (status && status.status === "running") {
      await new Promise((r) => setTimeout(r, 200));
      status = core.getRenderStatus(result.jobId);
    }

    expect(status?.status).toBe("succeeded");
    expect(status?.result).toBeDefined();

    // Verify telemetry fields
    expect(status!.result!.capturedFrames).toBeGreaterThan(0);
    expect(status!.result!.reusedStaticFrames).toBeGreaterThan(0);
    expect(status!.result!.capturedFrames + status!.result!.reusedStaticFrames).toBe(status!.result!.frames);
    expect(status!.result!.captureMsPerFrame).toBeGreaterThan(0);

    // Probe the output file
    const probe = await probeMedia(status!.result!.mp4Path);
    expect(probe.durationSec).toBeCloseTo(2.0, 1);
  }, 120_000);
});