import { describe, expect, it } from "vitest";
import {
  bentoGridLayerSchema,
  connectorDiagramLayerSchema,
  sceneSpecSchema,
  sanitizeSceneInputWithReport,
  type BentoGridLayer,
  type ConnectorDiagramLayer,
} from "../src/index.js";

describe("TASK M4 — bentoGrid & connectorDiagram schemas", () => {
  it("1. Defaults (columns 3, spanCols 1, staggerMs 110, animatedPulse true)", () => {
    // Bento grid defaults
    const rawBento = {
      id: "bento-1",
      type: "bentoGrid",
      cells: [
        { title: "Cell 1" },
        { title: "Cell 2" },
      ],
    };
    const parsedBento = bentoGridLayerSchema.parse(rawBento) as BentoGridLayer;
    expect(parsedBento.columns).toBe(3);
    expect(parsedBento.staggerMs).toBe(110);
    expect(parsedBento.cells[0]?.spanCols).toBe(1);
    expect(parsedBento.cells[1]?.spanCols).toBe(1);

    // Connector diagram defaults
    const rawDiagram = {
      id: "diagram-1",
      type: "connectorDiagram",
      nodes: [
        { id: "n1", label: "Node 1", xPct: 20, yPct: 30 },
        { id: "n2", label: "Node 2", xPct: 80, yPct: 70 },
      ],
      edges: [
        { from: "n1", to: "n2" },
      ],
    };
    const parsedDiagram = connectorDiagramLayerSchema.parse(rawDiagram) as ConnectorDiagramLayer;
    expect(parsedDiagram.edges[0]?.animatedPulse).toBe(true);
  });

  it("2. Rejection: 1 cell, 7 cells, 9 nodes, 13 edges, duplicate node ids, unknown key", () => {
    // 1 cell rejected (min 2)
    expect(
      bentoGridLayerSchema.safeParse({
        id: "bento-1",
        type: "bentoGrid",
        cells: [{ title: "Only One" }],
      }).success
    ).toBe(false);

    // 7 cells rejected (max 6)
    expect(
      bentoGridLayerSchema.safeParse({
        id: "bento-1",
        type: "bentoGrid",
        cells: [
          { title: "C1" },
          { title: "C2" },
          { title: "C3" },
          { title: "C4" },
          { title: "C5" },
          { title: "C6" },
          { title: "C7" },
        ],
      }).success
    ).toBe(false);

    // 9 nodes rejected (max 8)
    const nineNodes = Array.from({ length: 9 }, (_, i) => ({
      id: `node-${i + 1}`,
      label: `Node ${i + 1}`,
      xPct: 10 + i * 8,
      yPct: 20 + i * 5,
    }));
    expect(
      connectorDiagramLayerSchema.safeParse({
        id: "diagram-1",
        type: "connectorDiagram",
        nodes: nineNodes,
        edges: [{ from: "node-1", to: "node-2" }],
      }).success
    ).toBe(false);

    // 13 edges rejected (max 12)
    const twoNodes = [
      { id: "n1", label: "N1", xPct: 20, yPct: 30 },
      { id: "n2", label: "N2", xPct: 80, yPct: 70 },
    ];
    const thirteenEdges = Array.from({ length: 13 }, () => ({
      from: "n1",
      to: "n2",
    }));
    expect(
      connectorDiagramLayerSchema.safeParse({
        id: "diagram-1",
        type: "connectorDiagram",
        nodes: twoNodes,
        edges: thirteenEdges,
      }).success
    ).toBe(false);

    // Duplicate node ids rejected by sceneSpecSchema
    const dupNodesScene = {
      schemaVersion: 1,
      name: "Duplicate Nodes",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: [
        {
          id: "diagram-1",
          type: "connectorDiagram",
          nodes: [
            { id: "n-same", label: "Node A", xPct: 20, yPct: 30 },
            { id: "n-same", label: "Node B", xPct: 80, yPct: 70 },
          ],
          edges: [{ from: "n-same", to: "n-same" }],
        },
      ],
    };
    const dupRes = sceneSpecSchema.safeParse(dupNodesScene);
    expect(dupRes.success).toBe(false);
    if (!dupRes.success) {
      const issue = dupRes.error.issues.find((i) => i.path.includes("nodes"));
      expect(issue).toBeDefined();
      expect(issue?.path).toEqual(["layers", 0, "nodes", 1, "id"]);
      expect(issue?.message).toContain('duplicate node id "n-same"');
    }

    // Unknown key rejected on bentoGrid and connectorDiagram
    expect(
      bentoGridLayerSchema.safeParse({
        id: "bento-1",
        type: "bentoGrid",
        cells: [{ title: "C1" }, { title: "C2" }],
        unknownField: true,
      }).success
    ).toBe(false);

    expect(
      connectorDiagramLayerSchema.safeParse({
        id: "diagram-1",
        type: "connectorDiagram",
        nodes: twoNodes,
        edges: [{ from: "n1", to: "n2" }],
        hallucinatedProp: "invalid",
      }).success
    ).toBe(false);
  });

  it("3. Edge referencing a missing node is rejected by sceneSpecSchema with the right path", () => {
    // Missing 'to' node
    const missingToScene = {
      schemaVersion: 1,
      name: "Missing To Node",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: [
        {
          id: "diagram-1",
          type: "connectorDiagram",
          nodes: [
            { id: "n1", label: "Node 1", xPct: 20, yPct: 30 },
            { id: "n2", label: "Node 2", xPct: 80, yPct: 70 },
          ],
          edges: [{ from: "n1", to: "non-existent-node" }],
        },
      ],
    };
    const toRes = sceneSpecSchema.safeParse(missingToScene);
    expect(toRes.success).toBe(false);
    if (!toRes.success) {
      const issue = toRes.error.issues.find((i) => i.path.includes("edges"));
      expect(issue).toBeDefined();
      expect(issue?.path).toEqual(["layers", 0, "edges", 0, "to"]);
      expect(issue?.message).toContain("non-existent-node");
    }

    // Missing 'from' node
    const missingFromScene = {
      schemaVersion: 1,
      name: "Missing From Node",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: [
        {
          id: "diagram-1",
          type: "connectorDiagram",
          nodes: [
            { id: "n1", label: "Node 1", xPct: 20, yPct: 30 },
            { id: "n2", label: "Node 2", xPct: 80, yPct: 70 },
          ],
          edges: [{ from: "ghost-origin", to: "n2" }],
        },
      ],
    };
    const fromRes = sceneSpecSchema.safeParse(missingFromScene);
    expect(fromRes.success).toBe(false);
    if (!fromRes.success) {
      const issue = fromRes.error.issues.find((i) => i.path.includes("edges"));
      expect(issue).toBeDefined();
      expect(issue?.path).toEqual(["layers", 0, "edges", 0, "from"]);
      expect(issue?.message).toContain("ghost-origin");
    }
  });

  it("4. spanCols > columns is clamped and reported", () => {
    // 2-column grid with a cell declaring spanCols: 3 -> clamped to 2
    const rawScene2Col = {
      schemaVersion: 1,
      name: "Bento Sanitize 2-Col",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: [
        {
          id: "bento-2col",
          type: "bentoGrid",
          columns: 2,
          cells: [
            { title: "Card 1", spanCols: 3 },
            { title: "Card 2", spanCols: 1 },
          ],
        },
      ],
    };
    const report2Col = sanitizeSceneInputWithReport(rawScene2Col);
    const layer2Col = (report2Col.scene as { layers: BentoGridLayer[] }).layers[0]!;
    expect(layer2Col.cells[0]?.spanCols).toBe(2);
    expect(layer2Col.cells[1]?.spanCols).toBe(1);
    expect(report2Col.clamped).toContain("layers.0.cells.0.spanCols");

    // 3-column grid with a cell declaring spanCols: 4 -> clamped to 3
    const rawScene3Col = {
      schemaVersion: 1,
      name: "Bento Sanitize 3-Col",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: [
        {
          id: "bento-3col",
          type: "bentoGrid",
          columns: 3,
          cells: [
            { title: "Card 1", spanCols: 4 },
            { title: "Card 2", spanCols: 1 },
          ],
        },
      ],
    };
    const report3Col = sanitizeSceneInputWithReport(rawScene3Col);
    const layer3Col = (report3Col.scene as { layers: BentoGridLayer[] }).layers[0]!;
    expect(layer3Col.cells[0]?.spanCols).toBe(3);
    expect(layer3Col.cells[1]?.spanCols).toBe(1);
    expect(report3Col.clamped).toContain("layers.0.cells.0.spanCols");
  });
});
