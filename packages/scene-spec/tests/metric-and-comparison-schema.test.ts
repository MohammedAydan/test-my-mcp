import { describe, expect, it } from "vitest";
import {
  metricTickerLayerSchema,
  comparisonSplitLayerSchema,
  sceneSpecSchema,
  sanitizeSceneInput,
  sanitizeSceneInputWithReport,
  type MetricTickerLayer,
  type ComparisonSplitLayer,
  type SanitizeReport,
} from "../src/index.js";

describe("TASK M5 — metricTicker & comparisonSplit schemas", () => {
  it("1. Defaults (fromValue 0, prefix/suffix '', decimals 0, countDurationMs 1600, leftAccent '#ef4444', rightAccent '#10b981', vsBadge 'VS')", () => {
    // metricTicker defaults
    const rawTicker = {
      id: "ticker-1",
      type: "metricTicker",
      label: "TOTAL REVENUE",
      toValue: 50000,
    };
    const parsedTicker = metricTickerLayerSchema.parse(rawTicker) as MetricTickerLayer;
    expect(parsedTicker.fromValue).toBe(0);
    expect(parsedTicker.prefix).toBe("");
    expect(parsedTicker.suffix).toBe("");
    expect(parsedTicker.decimals).toBe(0);
    expect(parsedTicker.countDurationMs).toBe(1600);

    // comparisonSplit defaults
    const rawSplit = {
      id: "split-1",
      type: "comparisonSplit",
      leftTitle: "Old Way",
      leftItems: ["Manual editing"],
      rightTitle: "New Way",
      rightItems: ["Automated renders"],
    };
    const parsedSplit = comparisonSplitLayerSchema.parse(rawSplit) as ComparisonSplitLayer;
    expect(parsedSplit.leftAccent).toBe("#ef4444");
    expect(parsedSplit.rightAccent).toBe("#10b981");
    expect(parsedSplit.vsBadge).toBe("VS");
  });

  it("2. Rejections: decimals 5, countDurationMs 100, 0 items, 7 items, item > 100 chars, NaN value, unknown key", () => {
    // decimals 5 rejected (max 4)
    expect(
      metricTickerLayerSchema.safeParse({
        id: "ticker-1",
        type: "metricTicker",
        label: "Decimals Test",
        toValue: 100,
        decimals: 5,
      }).success
    ).toBe(false);

    // countDurationMs 100 rejected (min 200)
    expect(
      metricTickerLayerSchema.safeParse({
        id: "ticker-1",
        type: "metricTicker",
        label: "Duration Test",
        toValue: 100,
        countDurationMs: 100,
      }).success
    ).toBe(false);

    // 0 items rejected (min 1)
    expect(
      comparisonSplitLayerSchema.safeParse({
        id: "split-1",
        type: "comparisonSplit",
        leftTitle: "Left",
        leftItems: [],
        rightTitle: "Right",
        rightItems: ["Item 1"],
      }).success
    ).toBe(false);

    expect(
      comparisonSplitLayerSchema.safeParse({
        id: "split-1",
        type: "comparisonSplit",
        leftTitle: "Left",
        leftItems: ["Item 1"],
        rightTitle: "Right",
        rightItems: [],
      }).success
    ).toBe(false);

    // 7 items rejected (max 6)
    const sevenItems = Array.from({ length: 7 }, (_, i) => `Feature ${i + 1}`);
    expect(
      comparisonSplitLayerSchema.safeParse({
        id: "split-1",
        type: "comparisonSplit",
        leftTitle: "Left",
        leftItems: sevenItems,
        rightTitle: "Right",
        rightItems: ["Item 1"],
      }).success
    ).toBe(false);

    expect(
      comparisonSplitLayerSchema.safeParse({
        id: "split-1",
        type: "comparisonSplit",
        leftTitle: "Left",
        leftItems: ["Item 1"],
        rightTitle: "Right",
        rightItems: sevenItems,
      }).success
    ).toBe(false);

    // item > 100 chars rejected
    const longItem = "a".repeat(101);
    expect(
      comparisonSplitLayerSchema.safeParse({
        id: "split-1",
        type: "comparisonSplit",
        leftTitle: "Left",
        leftItems: [longItem],
        rightTitle: "Right",
        rightItems: ["Item 1"],
      }).success
    ).toBe(false);

    // NaN value rejected (finite number required)
    expect(
      metricTickerLayerSchema.safeParse({
        id: "ticker-1",
        type: "metricTicker",
        label: "NaN Test",
        toValue: Number.NaN,
      }).success
    ).toBe(false);

    expect(
      metricTickerLayerSchema.safeParse({
        id: "ticker-1",
        type: "metricTicker",
        label: "Infinity Test",
        toValue: Number.POSITIVE_INFINITY,
      }).success
    ).toBe(false);

    // unknown key rejected on metricTicker and comparisonSplit
    expect(
      metricTickerLayerSchema.safeParse({
        id: "ticker-1",
        type: "metricTicker",
        label: "Unknown Test",
        toValue: 100,
        hallucinatedField: "invalid",
      }).success
    ).toBe(false);

    expect(
      comparisonSplitLayerSchema.safeParse({
        id: "split-1",
        type: "comparisonSplit",
        leftTitle: "Left",
        leftItems: ["Item 1"],
        rightTitle: "Right",
        rightItems: ["Item 2"],
        extraProp: 123,
      }).success
    ).toBe(false);
  });

  it("3. sanitizeSceneInput() keeps both kinds intact and does not add fields", () => {
    const rawScene = {
      schemaVersion: 1,
      name: "M5 Sanitize Test",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 5000,
      layers: [
        {
          id: "ticker-clean",
          type: "metricTicker",
          label: "CONVERSIONS",
          fromValue: 100,
          toValue: 8500,
          prefix: "$",
          suffix: "/mo",
          decimals: 2,
          countDurationMs: 2000,
          deltaBadge: "+32%",
          accentColor: "#10b981",
        },
        {
          id: "split-clean",
          type: "comparisonSplit",
          leftTitle: "Before",
          leftItems: ["Slow", "Manual"],
          rightTitle: "After",
          rightItems: ["Fast", "Automatic"],
          leftAccent: "#f43f5e",
          rightAccent: "#06b6d4",
          vsBadge: "VERSUS",
        },
      ],
    };

    const report = sanitizeSceneInputWithReport(rawScene) as SanitizeReport;
    const sanitized = sanitizeSceneInput(rawScene) as typeof rawScene;

    // Report should have no unexpected mutations
    expect(report.healed).toEqual([]);
    expect(report.clamped).toEqual([]);
    expect(report.resolved).toEqual([]);

    // Layers must match the input exactly
    expect(sanitized.layers[0]).toEqual(rawScene.layers[0]);
    expect(sanitized.layers[1]).toEqual(rawScene.layers[1]);

    // Sanitized scene parses cleanly through strict schema
    const parseRes = sceneSpecSchema.safeParse(sanitized);
    expect(parseRes.success).toBe(true);
  });
});
