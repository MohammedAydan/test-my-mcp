import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SceneSpecInput } from "@motionforge/scene-spec";
import { enginePaths } from "../src/config.js";
import { EngineCore } from "../src/engine-core.js";

let workdir: string;
let hasChromium = true;
let core: EngineCore | undefined;

const BROKEN_SCENE: SceneSpecInput = {
  schemaVersion: 1,
  id: "broken-critic-scene",
  name: "Broken Critic Scene",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 4000,
  themePreset: "editorialLight",
  layers: [
    {
      id: "bg",
      type: "background",
      variant: { variant: "solid", color: "#f8fafc" },
    },
    // 1. Two foreground text/card layers overlapping by > 400 px^2 at the same time
    {
      id: "title",
      type: "kineticText",
      text: "Headline",
      sizePx: 56,
      position: { xPct: 50, yPct: 48 },
      at: 0,
      duration: 4000,
    },
    {
      id: "overlapCard",
      type: "card",
      variant: {
        variant: "glassCard",
        title: "Overlap Card",
        widthPx: 300,
      },
      position: { xPct: 50, yPct: 52 },
      at: 0,
      duration: 4000,
      // 4. Keyframe past durationMs (5000 > 4000)
      keyframes: [{ id: "kf-overflow", timeMs: 5000, property: "opacity", value: 0 }],
    },
    // 2. Card positioned off the right safe margin (xPct 97)
    {
      id: "offMarginCard",
      type: "card",
      variant: {
        variant: "glassCard",
        title: "Off Margin Card",
        widthPx: 260,
      },
      position: { xPct: 97, yPct: 50 },
      at: 0,
      duration: 4000,
    },
    // 3. Low-contrast text: editorialLight + fill: "#f8fafc"
    {
      id: "lowContrastText",
      type: "kineticText",
      text: "Unreadable",
      sizePx: 36,
      fill: "#f8fafc",
      position: { xPct: 15, yPct: 80 },
      at: 0,
      duration: 4000,
    },
    // 5. Filtered layer at scale: 5
    {
      id: "filteredLayer",
      type: "kineticText",
      text: "Filtered",
      sizePx: 20,
      filters: { blur: 10 },
      scale: 5,
      position: { xPct: 15, yPct: 20 },
      at: 0,
      duration: 4000,
    },
  ],
};

const CLEAN_SCENE: SceneSpecInput = {
  schemaVersion: 1,
  id: "clean-critic-scene",
  name: "Clean Critic Scene",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 4000,
  layers: [
    {
      id: "bg",
      type: "background",
      variant: { variant: "solid", color: "#05070d" },
    },
    {
      id: "heroText",
      type: "kineticText",
      text: "Proper Clean Headline",
      sizePx: 80,
      fill: "#ffffff",
      position: { xPct: 50, yPct: 50 },
      at: 0,
      duration: 4000,
    },
  ],
};

beforeAll(async () => {
  workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "mf-critic-"));
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    await browser.close();
  } catch {
    hasChromium = false;
    return;
  }

  const paths = {
    ...enginePaths(),
    dataDir: path.join(workdir, "data"),
    storageDir: path.join(workdir, "scenes"),
    vaultDir: path.join(workdir, "vault"),
  };
  core = new EngineCore(
    { port: 4000, maxRenderWorkers: 1, paths },
    paths
  );
  await core.init();
});

afterAll(async () => {
  if (core) {
    await core.dispose();
  }
  await fsp.rm(workdir, { recursive: true, force: true });
});

describe("scene critic and auto-fix solver", () => {
  it("critiqueAndAutofixScene with autoApplyFixes: false reports issues and deductions without modifying scene", async () => {
    if (!hasChromium || !core) return;

    await core.saveScene(BROKEN_SCENE);
    const report = await core.critiqueAndAutofixScene("broken-critic-scene", {
      autoApplyFixes: false,
    });

    // 1. scoreBefore < 65, at least 4 distinct rules present, appliedFixes empty
    expect(report.scoreBefore).toBeLessThan(65);
    expect(report.scoreAfter).toBe(report.scoreBefore);
    expect(report.appliedFixes).toHaveLength(0);
    expect(report.issuesAfter).toEqual(report.issuesBefore);

    const rulesPresent = new Set(report.issuesBefore.map((i) => i.rule));
    expect(rulesPresent.size).toBeGreaterThanOrEqual(4);
    expect(rulesPresent.has("FOREGROUND_OVERLAP")).toBe(true);
    expect(rulesPresent.has("SAFE_MARGIN_VIOLATION")).toBe(true);
    expect(rulesPresent.has("LOW_CONTRAST")).toBe(true);
    expect(rulesPresent.has("TIMING_OVERFLOW")).toBe(true);
  });

  it("critiqueAndAutofixScene with autoApplyFixes: true resolves issues and scores >= 95", async () => {
    if (!hasChromium || !core) return;

    // Save fresh broken scene
    const initialSaved = await core.saveScene(BROKEN_SCENE);
    const initialRevision = initialSaved.revision;

    const report = await core.critiqueAndAutofixScene("broken-critic-scene", {
      autoApplyFixes: true,
    });

    // 2. scoreAfter >= 95, issuesAfter contains ZERO of the fixed rules, appliedFixes.length >= 4
    expect(report.scoreAfter).toBeGreaterThanOrEqual(95);

    const afterRules = report.issuesAfter.map((i) => i.rule);
    expect(afterRules).not.toContain("FOREGROUND_OVERLAP");
    expect(afterRules).not.toContain("SAFE_MARGIN_VIOLATION");
    expect(afterRules).not.toContain("LOW_CONTRAST");
    expect(afterRules).not.toContain("TIMING_OVERFLOW");

    expect(report.appliedFixes.length).toBeGreaterThanOrEqual(4);

    // 3. The saved scene's revision increased and the scene round-trips through the store
    expect(report.revision).toBeGreaterThan(initialRevision);

    const reloaded = await core.getScene("broken-critic-scene");
    expect(reloaded).not.toBeNull();
    expect(reloaded?.id).toBe("broken-critic-scene");
  });

  it("scores 100 with zero issues on a clean minimal scene", async () => {
    if (!hasChromium || !core) return;

    await core.saveScene(CLEAN_SCENE);
    const report = await core.critiqueAndAutofixScene("clean-critic-scene");

    // 4. A clean scene scores 100 with zero issues
    expect(report.scoreBefore).toBe(100);
    expect(report.scoreAfter).toBe(100);
    expect(report.issuesBefore).toHaveLength(0);
    expect(report.issuesAfter).toHaveLength(0);
    expect(report.appliedFixes).toHaveLength(0);
  });

  it("is deterministic: two inspection passes yield identical score and issue rule sequence", async () => {
    if (!hasChromium || !core) return;

    const broken2: SceneSpecInput = {
      ...BROKEN_SCENE,
      id: "broken-critic-scene-2",
    };
    await core.saveScene(broken2);

    const r1 = await core.critiqueAndAutofixScene("broken-critic-scene-2", {
      autoApplyFixes: false,
    });
    const r2 = await core.critiqueAndAutofixScene("broken-critic-scene-2", {
      autoApplyFixes: false,
    });

    // 5. Determinism: identical scoreBefore and identical issue rule sequence
    expect(r1.scoreBefore).toBe(r2.scoreBefore);
    expect(r1.issuesBefore.map((i) => i.rule)).toEqual(
      r2.issuesBefore.map((i) => i.rule)
    );
    expect(r1.sampledTimesMs).toEqual(r2.sampledTimesMs);
  });
});
