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
    name: "Bento and Diagram Runtime Test",
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

describe("TASK M4 — bentoGrid & connectorDiagram runtime renderers", () => {
  it("1. bentoGrid renders exactly cells.length cards and the grid template matches columns", () => {
    const { stage } = mountTestScene([
      {
        id: "bento-test-1",
        type: "bentoGrid",
        columns: 3,
        cells: [
          { title: "Velocity", metricValue: "240ms", badge: "Fast" },
          { title: "Availability", metricValue: "99.99%", badge: "SLA" },
          { title: "Integrations", subtitle: "Plug and play into your toolchain" },
        ],
      },
    ]);

    const grid = stage.content.querySelector(".mf-bento-grid") as HTMLElement;
    expect(grid).not.toBeNull();
    expect(grid.style.gridTemplateColumns).toBe("repeat(3, 1fr)");

    const cards = stage.content.querySelectorAll(".mf-bento-card");
    expect(cards.length).toBe(3);

    // Verify cell content
    expect(cards[0]?.textContent).toContain("Velocity");
    expect(cards[0]?.textContent).toContain("240ms");
    expect(cards[0]?.textContent).toContain("Fast");
    expect(cards[2]?.textContent).toContain("Integrations");
    expect(cards[2]?.textContent).toContain("Plug and play into your toolchain");
  });

  it("2. Stagger: cell 2 is still at opacity 0 at at + 10 ms and visible at at + staggerMs*2 + 500 ms", () => {
    const at = 1000;
    const staggerMs = 110;

    const { built, stage } = mountTestScene(
      [
        {
          id: "bento-stagger",
          type: "bentoGrid",
          at,
          staggerMs,
          columns: 3,
          cells: [
            { title: "Card 0" },
            { title: "Card 1" },
            { title: "Card 2" },
          ],
        },
      ],
      5000
    );

    const cards = stage.content.querySelectorAll(".mf-bento-card") as NodeListOf<HTMLElement>;
    expect(cards.length).toBe(3);
    const cell2 = cards[2]!;

    // At at + 10 ms: cell 2 has not started yet (it starts at at + 220 ms)
    // seek to (1000 + 10) / 1000 = 1.01 s
    built.tl.seek((at + 10) / 1000, false);
    const opacityAt10ms = parseFloat(cell2.style.opacity || "0");
    expect(opacityAt10ms).toBe(0);

    // At at + staggerMs*2 + 500 ms: cell 2 has finished entrance tween (duration 450 ms)
    // seek to (1000 + 220 + 500) / 1000 = 1.72 s
    built.tl.seek((at + staggerMs * 2 + 500) / 1000, false);
    const opacityAtEnd = parseFloat(cell2.style.opacity);
    expect(opacityAtEnd).toBeCloseTo(1, 1);
  });

  it("3. connectorDiagram renders nodes.length cards and edges.length paths", () => {
    const { stage } = mountTestScene([
      {
        id: "diagram-test-1",
        type: "connectorDiagram",
        nodes: [
          { id: "node-client", label: "Client App", sublabel: "Edge device", xPct: 20, yPct: 30 },
          { id: "node-api", label: "API Gateway", sublabel: "Service cluster", xPct: 50, yPct: 50 },
          { id: "node-db", label: "Primary Database", sublabel: "Postgres", xPct: 80, yPct: 70 },
        ],
        edges: [
          { from: "node-client", to: "node-api", label: "gRPC" },
          { from: "node-api", to: "node-db", label: "TCP pool" },
        ],
      },
    ]);

    const nodeCards = stage.content.querySelectorAll(".mf-node-card");
    expect(nodeCards.length).toBe(3);

    const edgePaths = stage.content.querySelectorAll(".mf-diagram-edge-path");
    expect(edgePaths.length).toBe(2);

    const edgeLabels = stage.content.querySelectorAll(".mf-diagram-edge-label");
    expect(edgeLabels.length).toBe(2);
    expect(edgeLabels[0]?.textContent).toBe("gRPC");
    expect(edgeLabels[1]?.textContent).toBe("TCP pool");
  });

  it("4. Edge path d starts at the from node centre and ends at the to node centre (parse the numbers, tolerance 0.5 viewBox units)", () => {
    const fromXPct = 20;
    const fromYPct = 35;
    const toXPct = 80;
    const toYPct = 65;

    const { stage } = mountTestScene([
      {
        id: "diagram-geometry",
        type: "connectorDiagram",
        nodes: [
          { id: "from-node", label: "Start", xPct: fromXPct, yPct: fromYPct },
          { id: "to-node", label: "End", xPct: toXPct, yPct: toYPct },
        ],
        edges: [{ from: "from-node", to: "to-node" }],
      },
    ]);

    const path = stage.content.querySelector(".mf-diagram-edge-path");
    expect(path).not.toBeNull();
    const d = path!.getAttribute("d")!;
    expect(d).toBeDefined();

    // Parse start coordinates from 'M x1 y1'
    const startMatch = d.match(/M\s*([\d.]+)[,\s]+([\d.]+)/);
    expect(startMatch).not.toBeNull();
    const startX = parseFloat(startMatch![1]!);
    const startY = parseFloat(startMatch![2]!);

    expect(Math.abs(startX - fromXPct)).toBeLessThan(0.5);
    expect(Math.abs(startY - fromYPct)).toBeLessThan(0.5);

    // Parse end coordinates from the end of path 'cx2 cy2, x2 y2'
    const endMatch = d.match(/([\d.]+)[,\s]+([\d.]+)\s*$/);
    expect(endMatch).not.toBeNull();
    const endX = parseFloat(endMatch![1]!);
    const endY = parseFloat(endMatch![2]!);

    expect(Math.abs(endX - toXPct)).toBeLessThan(0.5);
    expect(Math.abs(endY - toYPct)).toBeLessThan(0.5);
  });

  it("5. animatedPulse: false renders zero pulse dots; true renders one per edge", () => {
    // animatedPulse: false
    const { stage: stageFalse } = mountTestScene([
      {
        id: "diagram-no-pulse",
        type: "connectorDiagram",
        nodes: [
          { id: "a", label: "A", xPct: 20, yPct: 40 },
          { id: "b", label: "B", xPct: 80, yPct: 60 },
        ],
        edges: [
          { from: "a", to: "b", animatedPulse: false },
        ],
      },
    ]);
    const dotsFalse = stageFalse.content.querySelectorAll(".mf-diagram-pulse-dot");
    expect(dotsFalse.length).toBe(0);

    // animatedPulse: true (2 edges -> 2 dots)
    const { stage: stageTrue } = mountTestScene([
      {
        id: "diagram-with-pulse",
        type: "connectorDiagram",
        nodes: [
          { id: "n1", label: "N1", xPct: 20, yPct: 30 },
          { id: "n2", label: "N2", xPct: 50, yPct: 50 },
          { id: "n3", label: "N3", xPct: 80, yPct: 70 },
        ],
        edges: [
          { from: "n1", to: "n2", animatedPulse: true },
          { from: "n2", to: "n3", animatedPulse: true },
        ],
      },
    ]);
    const dotsTrue = stageTrue.content.querySelectorAll(".mf-diagram-pulse-dot");
    expect(dotsTrue.length).toBe(2);
  });

  it("6. Determinism: same scene + same seek twice -> identical innerHTML", () => {
    const sceneDef: SceneSpecInput["layers"] = [
      {
        id: "bg",
        type: "background",
        variant: { variant: "solid", color: "#0a0f1d" },
      },
      {
        id: "bento-deterministic",
        type: "bentoGrid",
        at: 200,
        columns: 2,
        cells: [
          { title: "Metrics A", metricValue: "99%", badge: "Healthy", accentColor: "#38bdf8" },
          { title: "Metrics B", subtitle: "Operational status", accentColor: "#a855f7" },
        ],
      },
      {
        id: "diagram-deterministic",
        type: "connectorDiagram",
        at: 400,
        nodes: [
          { id: "src", label: "Source", xPct: 25, yPct: 40, accentColor: "#38bdf8" },
          { id: "dest", label: "Destination", xPct: 75, yPct: 60, accentColor: "#a855f7" },
        ],
        edges: [
          { from: "src", to: "dest", label: "Sync pipeline", animatedPulse: true },
        ],
      },
    ];

    const run1 = mountTestScene(sceneDef, 4000);
    const run2 = mountTestScene(sceneDef, 4000);

    run1.built.tl.seek(1.5, false);
    run2.built.tl.seek(1.5, false);

    expect(run1.stage.content.innerHTML).toBe(run2.stage.content.innerHTML);
  });
});
