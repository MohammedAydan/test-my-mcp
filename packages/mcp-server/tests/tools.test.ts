import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MINIMAL_VALID_SCENE } from "@motionforge/scene-spec";

import {
  EngineError,
  engineClient,
  engineMessage,
  handleCreateOrUpdateScene,
  handleGetMotionCapabilities,
  registerAuthoringResource,
  registerTools,
  SCENESPEC_RESOURCE_URI,
  TOOL_NAMES,
} from "../src/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fix A — engine issues must reach the caller verbatim
// ---------------------------------------------------------------------------

describe("engine error forwarding (Fix A)", () => {
  const issues = [
    "layers.0.id: Required",
    'layers.0.variant: Expected object, received string',
    'layers.1.preset: Unrecognized key(s) in object: \'preset\'',
  ];

  it("returns every engine issue in the tool result, not an opaque 400", async () => {
    vi.spyOn(engineClient, "putScene").mockRejectedValue(
      new EngineError(400, "invalid scene", issues)
    );

    const result = await handleCreateOrUpdateScene(MINIMAL_VALID_SCENE);
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

    expect(result.isError).toBe(true);
    expect(text).toContain("core-engine 400: invalid scene");
    // the status must appear exactly once — no doubled prefixes
    expect(text.match(/core-engine 400/g)).toHaveLength(1);
    for (const issue of issues) {
      expect(text, `missing issue: ${issue}`).toContain(issue);
    }
    // and it points at the recovery path
    expect(text).toContain("layerFieldGuide");
  });

  it("engineMessage never swallows an empty issue list silently", () => {
    const message = engineMessage(new EngineError(400, "invalid scene", []));
    expect(message).toContain("no field-level issues");
  });

  it("engineMessage marks an unreachable engine distinctly", () => {
    const message = engineMessage(new EngineError(0, "connection refused"));
    expect(message).toContain("unreachable");
    expect(message).toContain("connection refused");
  });

  it("forwards non-EngineError failures without losing the message", () => {
    expect(engineMessage(new TypeError("boom"))).toContain("TypeError: boom");
  });

  it("surfaces engine failures from the capabilities tool too", async () => {
    vi.spyOn(engineClient, "capabilities").mockRejectedValue(
      new EngineError(500, "capability registry exploded", ["registries.presets: missing"])
    );
    const result = await handleGetMotionCapabilities();
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(result.isError).toBe(true);
    expect(text).toContain("registries.presets: missing");
  });
});

// ---------------------------------------------------------------------------
// Contract + advertised schema (Fix C) + resource (Fix D), via a real client
// ---------------------------------------------------------------------------

async function connect(): Promise<Client> {
  const server = new McpServer({ name: "motionforge-test", version: "0.1.0" });
  registerTools(server);
  registerAuthoringResource(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.1.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("MCP contract over a live client session", () => {
  it("exposes EXACTLY the 5 protocol tools — no more, no fewer", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools).toHaveLength(5);
  });

  it("advertises the REAL SceneSpec schema, not an opaque bag", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const create = tools.find((t) => t.name === "create_or_update_scene");
    expect(create).toBeDefined();

    const schemaText = JSON.stringify(create?.inputSchema ?? {});
    // real field names must be visible to the host
    for (const marker of [
      "meshGradient",
      "glassCard",
      "progressBar",
      "xPct",
      "sizePx",
      "widthPx",
      "springPop",
      "kineticText",
      "foregroundFX",
      "durationMs",
    ]) {
      expect(schemaText, `schema missing ${marker}`).toContain(marker);
    }
    // strictness must survive into the advertised schema
    expect(schemaText).toContain("additionalProperties");
  });

  it("rejects a malformed scene with field-level detail, not a generic error", async () => {
    const client = await connect();
    const broken = {
      schemaVersion: 1,
      name: "Broken",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: [
        { type: "background", variant: "meshGradient" }, // no id; variant as a string
      ],
    };

    // the error may surface either as a protocol error or as an isError result —
    // both must name the offending field path
    let text = "";
    try {
      const result = await client.callTool({ name: "create_or_update_scene", arguments: broken });
      text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    } catch (error) {
      text = error instanceof Error ? error.message : String(error);
    }
    expect(text, "expected a validation error mentioning the offending field").toMatch(/layers/);
    expect(text, "expected the message to name the missing id").toMatch(/id/i);
  });

  it("serves the authoring guide as a resource (without adding a tool)", async () => {
    const client = await connect();
    const { resources } = await client.listResources();
    expect(resources).toHaveLength(1);
    expect(resources[0]?.uri).toBe(SCENESPEC_RESOURCE_URI);

    const read = await client.readResource({ uri: SCENESPEC_RESOURCE_URI });
    const text = read.contents
      .map((c) => ("text" in c ? c.text : ""))
      .join("\n");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.layerFieldGuide).toBeDefined();
    expect(parsed.minimalValidScene).toBeDefined();
    expect(parsed.nestedShapeNotes).toBeDefined();

    // …and the tool count is still exactly 5
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
  });
});