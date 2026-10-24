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

function mountTestScene(layers: SceneSpecInput["layers"], durationMs = 5000) {
  document.body.innerHTML = `<div id="viewport"></div>`;
  const stage = createStage(1920, 1080);
  const scene = parseScene({
    schemaVersion: 1,
    name: "Documentary Layers Test",
    canvas: { shape: "16:9", scale: 1080 },
    durationMs,
    layers,
  } as SceneSpecInput);

  const built = buildScene(scene, stage, {
    fonts: new Map(),
    resolveAsset: () => "",
    assetKind: () => "image",
    lottieData: () => ({}),
    registerSeekable: () => undefined,
    assetIntrinsicSize: () => undefined,
  });

  return { stage, scene, built };
}

describe("Documentary Graphic Layers Runtime Renderers", () => {
  it("cartographicRoute renders curved SVG route, halo underlay, and start/end pins", () => {
    const { stage } = mountTestScene([
      {
        id: "route-test",
        type: "cartographicRoute",
        strokeColor: "#d4af37",
        strokeWidthPx: 4,
        waypoints: [
          { xPct: 20, yPct: 30, label: "Point A" },
          { xPct: 50, yPct: 40 },
          { xPct: 80, yPct: 30, label: "Point B" },
        ],
        startPin: { color: "#d4af37", label: "Point A" },
        endPin: { color: "#d4af37", label: "Point B" },
      },
    ]);

    const svg = stage.content.querySelector("svg");
    expect(svg).not.toBeNull();

    // Check halo and route paths (SVG paths created)
    const paths = svg?.querySelectorAll("path");
    expect(paths?.length).toBeGreaterThanOrEqual(2);

    // Check pin circles created
    const circles = svg?.querySelectorAll("circle");
    expect(circles?.length).toBeGreaterThanOrEqual(2);

    // Check pin labels
    const texts = svg?.querySelectorAll("text");
    expect(texts?.length).toBe(2);
    expect(texts![0]!.textContent).toBe("Point A");
    expect(texts![1]!.textContent).toBe("Point B");
  });

  it("editorialRule renders horizontal divider with gradient fade ends and center ornament", () => {
    const { stage } = mountTestScene([
      {
        id: "rule-h",
        type: "editorialRule",
        orientation: "horizontal",
        color: "#d4af37",
        thicknessPx: 2,
        lengthPct: 70,
        centerOrnament: "diamond",
      },
    ]);

    const rule = stage.content.querySelector(".mf-editorial-rule.mf-rule-horizontal") as HTMLElement;
    expect(rule).not.toBeNull();
    expect(rule.style.width).toBe("70%");

    // Divider line element
    const line = rule.querySelector(".mf-rule-line") as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.style.height).toBe("2px");

    // Center ornament (diamond)
    const ornament = rule.querySelector(".mf-rule-ornament");
    expect(ornament).not.toBeNull();
  });

  it("editorialRule renders vertical divider without ornament", () => {
    const { stage } = mountTestScene([
      {
        id: "rule-v",
        type: "editorialRule",
        orientation: "vertical",
        thicknessPx: 3,
        lengthPct: 50,
        centerOrnament: "none",
      },
    ]);

    const rule = stage.content.querySelector(".mf-editorial-rule.mf-rule-vertical") as HTMLElement;
    expect(rule).not.toBeNull();
    expect(rule.style.height).toBe("50%");
    expect(rule.style.width).toBe("30px"); // thickness * 10

    const ornament = rule.querySelector(".mf-rule-ornament");
    expect(ornament).toBeNull();
  });

  it("timelineStrip renders chronological axis with markers and labels", () => {
    const { stage } = mountTestScene([
      {
        id: "timeline-test",
        type: "timelineStrip",
        lineColor: "#d4af37",
        events: [
          { date: "1776", title: "Declaration", description: "Independence" },
          { date: "1789", title: "Constitution" },
          { date: "1865", title: "Reconstruction" },
        ],
      },
    ]);

    const strip = stage.content.querySelector(".mf-timeline-strip") as HTMLElement;
    expect(strip).not.toBeNull();

    // Check axis line
    const axisLine = strip.querySelector(".mf-timeline-axis");
    expect(axisLine).not.toBeNull();

    // Check nodes
    const nodes = strip.querySelectorAll(".mf-timeline-node");
    expect(nodes.length).toBe(3);

    // Check dates and titles
    const dates = strip.querySelectorAll(".mf-timeline-date");
    expect(dates.length).toBe(3);
    expect(dates[0]!.textContent).toBe("1776");

    const titles = strip.querySelectorAll(".mf-timeline-title");
    expect(titles.length).toBe(3);
    expect(titles[0]!.textContent).toBe("Declaration");

    const descs = strip.querySelectorAll(".mf-timeline-desc");
    expect(descs.length).toBe(1);
    expect(descs[0]!.textContent).toBe("Independence");
  });
});
