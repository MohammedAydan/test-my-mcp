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
  handleInitCreativeProject,
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
  it("exposes EXACTLY the 6 protocol tools — no more, no fewer", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools).toHaveLength(6);
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

    // …and the tool count is still exactly 6
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(6);
  });
});

describe("init_creative_project tool", () => {
  it("creates a project and auto-seeds the starter scene", async () => {
    vi.spyOn(engineClient, "initProject").mockResolvedValue({
      projectPath: "/tmp/test-project",
      manifest: { name: "test-project" },
      initialSceneId: "scene-01",
      previewUrl: "http://127.0.0.1:4000/preview/?scene=scene-01",
      filesCreatedCount: 53,
      seedError: null,
      operationalChecklist: ["start engine", "read brief"],
    });

    const result = await handleInitCreativeProject({
      name: "test-project",
      targetPath: "/tmp/test-project",
      autoSeedScene: true,
    });

    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(result.isError).toBeUndefined();
    expect(text).toContain("project created: /tmp/test-project");
    expect(text).toContain("initialSceneId: scene-01");
    expect(text).toContain("preview: http://127.0.0.1:4000/preview/?scene=scene-01");
    expect(text).toContain("files: 53");
  });

  it("reports seed failures without failing the project", async () => {
    vi.spyOn(engineClient, "initProject").mockResolvedValue({
      projectPath: "/tmp/test-project",
      manifest: { name: "test-project" },
      initialSceneId: null,
      previewUrl: null,
      filesCreatedCount: 53,
      seedError: "connection refused",
      operationalChecklist: ["start engine", "push scene manually"],
    });

    const result = await handleInitCreativeProject({
      name: "test-project",
      targetPath: "/tmp/test-project",
      autoSeedScene: true,
    });

    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(result.isError).toBeUndefined();
    expect(text).toContain("seedError: connection refused");
  });

  it("refuses invalid options", async () => {
    vi.spyOn(engineClient, "initProject").mockRejectedValue(
      new EngineError(400, "invalid init_creative_project options", ["name: String must contain at least 1 character(s)"])
    );
    const result = await handleInitCreativeProject({
      name: "",
      targetPath: "/tmp/test-project",
      autoSeedScene: false,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("invalid init_creative_project options");
  });
});

// ---------------------------------------------------------------------------
// Autonomous project disk sync + the new engine response fields
// ---------------------------------------------------------------------------

describe("create_or_update_scene", () => {
  it("reports the revision, hash and status the engine returns", async () => {
    vi.spyOn(engineClient, "putScene").mockResolvedValue({
      id: "scene-01",
      status: "created",
      revision: 1,
      hash: "abc123def4567890",
      warnings: [],
      previewUrl: "http://127.0.0.1:4000/preview/?scene=scene-01",
      scene: MINIMAL_VALID_SCENE,
    });

    const result = await handleCreateOrUpdateScene(MINIMAL_VALID_SCENE);
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(text).toContain("scene created with id \"scene-01\"");
    expect(text).toContain("revision 1");
    expect(text).toContain("hash abc123def4567890");
  });

  it("routes through the project sync endpoint when projectPath is given", async () => {
    const sync = vi.spyOn(engineClient, "syncScene").mockResolvedValue({
      id: "scene-01",
      status: "updated",
      revision: 4,
      hash: "0123456789abcdef",
      warnings: [],
      savedSceneFilePath: "/tmp/job/scenes/scene-01.json",
      scene: MINIMAL_VALID_SCENE,
    });
    const put = vi.spyOn(engineClient, "putScene");

    const result = await handleCreateOrUpdateScene({
      ...(MINIMAL_VALID_SCENE as object),
      projectPath: "/tmp/job",
    } as never);
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

    expect(sync).toHaveBeenCalled();
    const [sceneArg, pathArg] = sync.mock.calls[0] as [Record<string, unknown>, string];
    expect(sceneArg.name).toBe((MINIMAL_VALID_SCENE as { name: string }).name);
    // the envelope field must be stripped before the scene is sent
    expect(sceneArg.projectPath).toBeUndefined();
    expect(pathArg).toBe("/tmp/job");
    expect(put).not.toHaveBeenCalled();
    expect(text).toContain("[auto-sync]");
    expect(text).toContain("/tmp/job/scenes/scene-01.json");
  });

  it("surfaces non-blocking engine warnings in the tool result", async () => {
    vi.spyOn(engineClient, "putScene").mockResolvedValue({
      id: "scene-01",
      status: "created",
      revision: 1,
      hash: "0123456789abcdef",
      warnings: [
        {
          code: "CAMERA_VIEWPORT_EXCEEDS_CANVAS",
          path: "camera.keyframes.0.xPct",
          message: "camera keyframe at 0ms (scale 1.4) pans outside the canvas on x",
        },
      ],
      scene: MINIMAL_VALID_SCENE,
    });

    const result = await handleCreateOrUpdateScene(MINIMAL_VALID_SCENE);
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(text).toContain("CAMERA_VIEWPORT_EXCEEDS_CANVAS");
    expect(text).toContain("camera.keyframes.0.xPct");
    // a warning is NOT an error — the scene was stored
    expect(result.isError).toBeUndefined();
  });
});

describe("inspect_scene_keyframes", () => {
  const frame = {
    atMs: 1000,
    image: "data:image/png;base64,iVBORw0KGgo=",
  };

  it("returns the numeric framesMeta sidecar next to the images", async () => {
    vi.spyOn(engineClient, "keyframes").mockResolvedValue({
      frames: [
        {
          ...frame,
          meta: {
            atMs: 1000,
            camera: { scale: 1.2, xPct: 50, yPct: 50, roll: 0, yaw: 0, pitch: 0, clampedVoid: false },
            activeTransitions: [{ kind: "wipe", progressPct: 25, phase: "in" }],
            layers: [
              {
                id: "title",
                type: "kineticText",
                lifecyclePhase: "entrance",
                phaseProgressPct: 62.5,
                opacity: 0.8,
                bbox: { x: 10, y: 20, width: 300, height: 80 },
                textOverflow: true,
              },
            ],
          },
        },
      ],
      framesMeta: [
        {
          atMs: 1000,
          camera: { scale: 1.2, xPct: 50, yPct: 50, roll: 0, yaw: 0, pitch: 0, clampedVoid: false },
          activeTransitions: [{ kind: "wipe", progressPct: 25, phase: "in" }],
          layers: [
            {
              id: "title",
              type: "kineticText",
              lifecyclePhase: "entrance",
              phaseProgressPct: 62.5,
              opacity: 0.8,
              bbox: { x: 10, y: 20, width: 300, height: 80 },
              textOverflow: true,
            },
          ],
        },
      ],
    });

    const { handleInspectSceneKeyframes } = await import("../src/index.js");
    const result = await handleInspectSceneKeyframes({ sceneId: "scene-01", at: [1000] });
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

    expect(text).toContain("framesMeta");
    expect(text).toContain("camera: scale 1.2");
    expect(text).toContain("transition: wipe 25% (phase \"in\")");
    // the mid-entrance phase is reported, so the agent knows the frame is not broken
    expect(text).toContain("mid-entrance 62.5%");
    // …and a clipped word is reported as data
    expect(text).toContain("TEXT OVERFLOW");
  });

  it("reports a clamped camera so a void frame is explained", async () => {
    vi.spyOn(engineClient, "keyframes").mockResolvedValue({
      frames: [frame],
      framesMeta: [
        {
          atMs: 1000,
          camera: { scale: 1.4, xPct: 35.7, yPct: 50, roll: 0, yaw: 0, pitch: 0, clampedVoid: true },
          activeTransitions: [],
          layers: [],
        },
      ],
    });
    const { handleInspectSceneKeyframes } = await import("../src/index.js");
    const result = await handleInspectSceneKeyframes({ sceneId: "scene-01", at: [1000] });
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(text).toContain("clampedVoid");
  });

  it("writes stills to the project when projectPath is given", async () => {
    vi.spyOn(engineClient, "keyframes").mockResolvedValue({ frames: [frame], framesMeta: [] });
    const save = vi.spyOn(engineClient, "saveStills").mockResolvedValue({
      files: ["renders/stills/scene-01-1000ms.png"],
      savedStillsFilePaths: ["/tmp/job/renders/stills/scene-01-1000ms.png"],
    });
    const { handleInspectSceneKeyframes } = await import("../src/index.js");
    const result = await handleInspectSceneKeyframes({ sceneId: "scene-01", at: [1000], projectPath: "/tmp/job" });
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(save).toHaveBeenCalled();
    expect(text).toContain("renders/stills/scene-01-1000ms.png");
  });

  it("skips the stills write when saveStills is explicitly false", async () => {
    vi.spyOn(engineClient, "keyframes").mockResolvedValue({ frames: [frame], framesMeta: [] });
    const save = vi.spyOn(engineClient, "saveStills");
    const { handleInspectSceneKeyframes } = await import("../src/index.js");
    await handleInspectSceneKeyframes({ sceneId: "scene-01", at: [1000], projectPath: "/tmp/job", saveStills: false });
    expect(save).not.toHaveBeenCalled();
  });

  it("never fails an inspection because the disk write failed", async () => {
    vi.spyOn(engineClient, "keyframes").mockResolvedValue({ frames: [frame], framesMeta: [] });
    vi.spyOn(engineClient, "saveStills").mockRejectedValue(new EngineError(400, "no manifest in /tmp/job"));
    const { handleInspectSceneKeyframes } = await import("../src/index.js");
    const result = await handleInspectSceneKeyframes({ sceneId: "scene-01", at: [1000], projectPath: "/tmp/job" });
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(result.isError).toBeUndefined();
    expect(text).toContain("could not write stills");
  });
});

describe("render_video", () => {
  it("files the render into the project and reports the manifest status", async () => {
    vi.spyOn(engineClient, "enqueueRender").mockResolvedValue({ jobId: "job1", status: "queued" });
    vi.spyOn(engineClient, "renderJob").mockResolvedValue({
      id: "job1",
      sceneId: "scene-01",
      quality: "production",
      status: "succeeded",
      progress: 1,
      result: {
        mp4Path: "/data/renders/production-scene-01.mp4",
        mp4Url: "/api/renders/job1/file",
        frames: 600,
        wallMs: 9000,
        effectiveFps: 66.6,
        encoder: "libx264",
        workerCount: 4,
        profile: { quality: "production", fps: 60, outWidth: 1920, outHeight: 1080, jpegQuality: 92 },
      },
    });
    vi.spyOn(engineClient, "renderFileBase64").mockResolvedValue({
      mp4Base64: "AAAA",
      sceneId: "scene-01",
      quality: "production",
    });
    const save = vi.spyOn(engineClient, "saveRender").mockResolvedValue({
      file: "renders/production/scene-01-20260131-090000.mp4",
      latest: "renders/production/scene-01-latest.mp4",
      status: "production",
      projectRenderFilePath: "/tmp/job/renders/production/scene-01-latest.mp4",
    });

    const { handleRenderVideo } = await import("../src/index.js");
    const result = await handleRenderVideo({ sceneId: "scene-01", quality: "production", projectPath: "/tmp/job" });
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

    expect(save).toHaveBeenCalledWith("scene-01", "production", "AAAA", "/tmp/job");
    expect(text).toContain("renders/production/scene-01-20260131-090000.mp4");
    expect(text).toContain("renders/production/scene-01-latest.mp4");
    expect(text).toContain("manifest status for \"scene-01\" is now \"production\"");
  });

  it("keeps a successful render successful when the disk filing fails", async () => {
    vi.spyOn(engineClient, "enqueueRender").mockResolvedValue({ jobId: "job1", status: "queued" });
    vi.spyOn(engineClient, "renderJob").mockResolvedValue({
      id: "job1",
      sceneId: "scene-01",
      quality: "draft",
      status: "succeeded",
      progress: 1,
      result: {
        mp4Path: "/data/renders/draft-scene-01.mp4",
        mp4Url: "/api/renders/job1/file",
        frames: 120,
        wallMs: 4000,
        effectiveFps: 30,
        encoder: "libx264",
        workerCount: 2,
        profile: { quality: "draft", fps: 30, outWidth: 1280, outHeight: 720, jpegQuality: 80 },
      },
    });
    vi.spyOn(engineClient, "renderFileBase64").mockRejectedValue(new EngineError(500, "engine exploded"));
    const { handleRenderVideo } = await import("../src/index.js");
    const result = await handleRenderVideo({ sceneId: "scene-01", quality: "draft", projectPath: "/tmp/job" });
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(result.isError).toBeUndefined();
    expect(text).toContain("render SUCCEEDED");
    expect(text).toContain("[auto-sync] FAILED to file");
  });
});

// ---------------------------------------------------------------------------
// Top-level schema strictness (report 2 C5 / F5)
// ---------------------------------------------------------------------------

describe("top-level schema strictness", () => {
  it("rejects an unknown TOP-LEVEL key with a surgical path error", async () => {
    const client = await connect();
    let text = "";
    try {
      const result = await client.callTool({
        name: "create_or_update_scene",
        arguments: { ...(MINIMAL_VALID_SCENE as object), wrongKey: true },
      });
      text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    } catch (error) {
      text = error instanceof Error ? error.message : String(error);
    }
    // the same surgical treatment a nested key gets
    expect(text).toMatch(/wrongKey|Unrecognized key/i);
  });

  it("rejects an unknown nested key the same way", async () => {
    const client = await connect();
    let text = "";
    try {
      const result = await client.callTool({
        name: "create_or_update_scene",
        arguments: {
          ...(MINIMAL_VALID_SCENE as object),
          layers: [
            { id: "bg", type: "background", variant: { variant: "solid", color: "#000" }, preset: "springPop" },
          ],
        },
      });
      text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    } catch (error) {
      text = error instanceof Error ? error.message : String(error);
    }
    expect(text).toMatch(/preset|Unrecognized key/i);
  });
});