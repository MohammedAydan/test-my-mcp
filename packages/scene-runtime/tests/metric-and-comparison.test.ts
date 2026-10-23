// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("lottie-web", () => ({
  default: {
    loadAnimation: () => ({
      totalFrames: 0,
      setSpeed: () => undefined,
      goToAndStop: () => undefined,
    }),
  },
}));

import { parseScene, type SceneSpecInput } from "@motionforge/scene-spec";
import { createStage } from "../src/stage.js";
import { buildScene } from "../src/scene-builder.js";

function mountTestScene(layers: SceneSpecInput["layers"], durationMs = 6000) {
  document.body.innerHTML = `<div id="viewport"></div>`;
  const stage = createStage(1920, 1080);
  const scene = parseScene({
    schemaVersion: 1,
    name: "Metric and Comparison Runtime Test",
    canvas: { shape: "16:9", scale: 1080 },
    durationMs,
    layers,
  } as SceneSpecInput);

  const seekables: Array<(tSec: number) => Promise<void>> = [];
  const built = buildScene(scene, stage, {
    fonts: new Map(),
    resolveAsset: () => "",
    assetKind: () => "image",
    lottieData: () => ({}),
    registerSeekable: (seekable) => seekables.push(seekable),
    assetIntrinsicSize: () => undefined,
  });

  const seek = async (tSec: number) => {
    built.tl.seek(tSec, false);
    for (const s of seekables) await s(tSec);
  };

  return { stage, scene, built, seek, seekables };
}

describe("TASK M5 — metricTicker & comparisonSplit runtime renderers", () => {
  it("1. metricTicker at `at` shows `fromValue` formatted (e.g. 0 -> '0')", async () => {
    const { stage, seek } = mountTestScene([
      {
        id: "ticker-test-1",
        type: "metricTicker",
        at: 1000,
        label: "ACTIVE USERS",
        fromValue: 0,
        toValue: 50000,
        decimals: 0,
        countDurationMs: 1600,
      },
    ]);

    await seek(1.0); // exactly at `at` (1000ms = 1.0s)
    const valueEl = stage.content.querySelector(".mf-metric-value");
    expect(valueEl).not.toBeNull();
    expect(valueEl?.textContent).toBe("0");
  });

  it("2. At `at + countDurationMs` shows `toValue` (e.g. 128400 with decimals 0 -> '128,400'; with prefix '$' and suffix '+' -> '$128,400+')", async () => {
    const { stage, seek } = mountTestScene([
      {
        id: "ticker-test-2",
        type: "metricTicker",
        at: 1000,
        label: "ANNUAL REVENUE",
        fromValue: 0,
        toValue: 128400,
        prefix: "$",
        suffix: "+",
        decimals: 0,
        countDurationMs: 1600,
      },
    ]);

    // at + countDurationMs = 1000ms + 1600ms = 2600ms = 2.6s
    await seek(2.6);
    const valueEl = stage.content.querySelector(".mf-metric-value");
    expect(valueEl).not.toBeNull();
    expect(valueEl?.textContent).toBe("$128,400+");
  });

  it("3. Midpoint is strictly between the two values and monotonic (sample 5 points)", async () => {
    const { stage, seek } = mountTestScene([
      {
        id: "ticker-test-3",
        type: "metricTicker",
        at: 1000,
        label: "COUNTING TICKER",
        fromValue: 100,
        toValue: 10000,
        decimals: 2,
        countDurationMs: 2000, // 1.0s to 3.0s
      },
    ]);

    const valueEl = stage.content.querySelector(".mf-metric-value") as HTMLElement;
    expect(valueEl).not.toBeNull();

    // Sample 5 points strictly between at (1.0s) and at + countDurationMs (3.0s)
    const sampleTimes = [1.2, 1.5, 2.0, 2.4, 2.8];
    const sampledValues: number[] = [];

    for (const t of sampleTimes) {
      await seek(t);
      const rawText = valueEl.textContent ?? "";
      const parsedNum = parseFloat(rawText.replace(/,/g, ""));
      sampledValues.push(parsedNum);
    }

    // Midpoint check: sampled values must be strictly between 100 and 10000
    for (const val of sampledValues) {
      expect(val).toBeGreaterThan(100);
      expect(val).toBeLessThan(10000);
    }

    // Monotonicity check: each sampled point must be strictly greater than the preceding one
    for (let i = 0; i < sampledValues.length - 1; i++) {
      expect(sampledValues[i + 1]!).toBeGreaterThan(sampledValues[i]!);
    }
  });

  it("4. Values past `countDurationMs` hold `toValue`", async () => {
    const { stage, seek } = mountTestScene([
      {
        id: "ticker-test-4",
        type: "metricTicker",
        at: 1000,
        label: "FINAL COUNT",
        fromValue: 50,
        toValue: 2500,
        prefix: "#",
        suffix: " pts",
        decimals: 0,
        countDurationMs: 1500, // ends at 2.5s
      },
    ]);

    const valueEl = stage.content.querySelector(".mf-metric-value") as HTMLElement;

    // Check at completion (2.5s)
    await seek(2.5);
    expect(valueEl.textContent).toBe("#2,500 pts");

    // Check past completion (3.0s, 3.8s, 5.0s)
    await seek(3.0);
    expect(valueEl.textContent).toBe("#2,500 pts");

    await seek(3.8);
    expect(valueEl.textContent).toBe("#2,500 pts");

    await seek(5.0);
    expect(valueEl.textContent).toBe("#2,500 pts");
  });

  it("5. comparisonSplit renders both titles, all items, the VS badge, and `leftItems.length + rightItems.length` indicators", () => {
    const leftItems = ["Complex legacy setup", "Unpredictable renders", "Opaque pipeline failures"];
    const rightItems = ["Zero-config CLI & MCP", "Deterministic Chromium capture", "100% vector SVG design system"];

    const { stage } = mountTestScene([
      {
        id: "split-test-1",
        type: "comparisonSplit",
        at: 500,
        leftTitle: "Legacy Video Stack",
        leftItems,
        rightTitle: "MotionForge Engine",
        rightItems,
        vsBadge: "VS",
      },
    ]);

    // Check titles
    const leftTitle = stage.content.querySelector(".mf-comparison-left-title");
    expect(leftTitle).not.toBeNull();
    expect(leftTitle?.textContent).toBe("Legacy Video Stack");

    const rightTitle = stage.content.querySelector(".mf-comparison-right-title");
    expect(rightTitle).not.toBeNull();
    expect(rightTitle?.textContent).toBe("MotionForge Engine");

    // Check all item texts are rendered
    const itemTexts = Array.from(stage.content.querySelectorAll(".mf-comparison-text")).map(
      (el) => el.textContent
    );
    expect(itemTexts).toEqual([...leftItems, ...rightItems]);

    // Check VS badge
    const vsBadge = stage.content.querySelector(".mf-comparison-vs-badge");
    expect(vsBadge).not.toBeNull();
    expect(vsBadge?.textContent).toBe("VS");

    // Check total indicator count = leftItems.length + rightItems.length
    const indicators = stage.content.querySelectorAll(".mf-comparison-indicator");
    expect(indicators.length).toBe(leftItems.length + rightItems.length);
  });

  it("6. Stagger: row 2 is at opacity 0 at `at + 10 ms`, visible at `at + 0.08*2 + 400 ms`", async () => {
    const { stage, seek } = mountTestScene([
      {
        id: "split-test-2",
        type: "comparisonSplit",
        at: 1000, // 1.0s
        leftTitle: "Before",
        leftItems: ["Row 0", "Row 1", "Row 2", "Row 3"],
        rightTitle: "After",
        rightItems: ["Item 0", "Item 1", "Item 2", "Item 3"],
      },
    ]);

    // Row 2 is at rowIndex 2 (0-indexed: 0, 1, 2)
    const leftRows = stage.content.querySelectorAll('.mf-comparison-col.mf-comparison-left .mf-comparison-row');
    const row2 = leftRows[2] as HTMLElement;
    expect(row2).toBeDefined();

    // At at + 10 ms (1.01s): row 2 starts at 1.0s + 0.08*2 = 1.16s, so it must be opacity 0
    await seek(1.01);
    expect(parseFloat(row2.style.opacity || "0")).toBe(0);

    // At at + 0.08*2 + 400 ms = 1.0s + 0.16s + 0.40s = 1.56s:
    // With 0.35s duration, tween completes at 1.16s + 0.35s = 1.51s, so it is fully visible (opacity 1)
    await seek(1.56);
    expect(parseFloat(row2.style.opacity || "0")).toBe(1);
  });

  it("7. Determinism: same seek twice -> identical innerHTML", async () => {
    const layersDef: SceneSpecInput["layers"] = [
      {
        id: "bg",
        type: "background",
        variant: { variant: "solid", color: "#090d16" },
      },
      {
        id: "ticker-det",
        type: "metricTicker",
        at: 200,
        label: "REVENUE GROWTH",
        fromValue: 0,
        toValue: 850000,
        prefix: "$",
        suffix: "",
        decimals: 0,
        countDurationMs: 1400,
        deltaBadge: "+120%",
        accentColor: "#10b981",
      },
      {
        id: "split-det",
        type: "comparisonSplit",
        at: 400,
        leftTitle: "Traditional",
        leftItems: ["Slow", "Expensive"],
        rightTitle: "MotionForge",
        rightItems: ["Instant", "Scalable"],
        leftAccent: "#ef4444",
        rightAccent: "#10b981",
        vsBadge: "VS",
      },
    ];

    const run1 = mountTestScene(layersDef, 4000);
    const run2 = mountTestScene(layersDef, 4000);

    await run1.seek(1.2);
    await run2.seek(1.2);

    expect(run1.stage.content.innerHTML).toBe(run2.stage.content.innerHTML);
  });
});
