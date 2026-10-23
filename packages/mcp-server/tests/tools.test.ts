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
  type ComposeReport,
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
  it("exposes the full protocol tool surface — the original six plus the seven the audit added", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools).toHaveLength(17);
    // the original six are all still there, unchanged in name
    for (const name of [
      "get_motion_capabilities",
      "init_creative_project",
      "create_or_update_scene",
      "inspect_scene_keyframes",
      "open_live_timeline_preview",
      "render_video",
    ]) {
      expect(tools.map((t) => t.name)).toContain(name);
    }
    // …and the ten new ones (16 total)
    for (const name of [
      "render_scene",
      "get_layer_bounds",
      "get_render_status",
      "get_render_result",
      "analyze_scene",
      "upload_asset",
      "project_asset_manifest",
      "critique_and_autofix_scene",
      "auto_choreograph_audio",
      "generate_storyboard_from_brief",
    ]) {
      expect(tools.map((t) => t.name)).toContain(name);
    }
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

    // …and the tool count is still exactly 17
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(17);
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
        profile: { quality: "production", fps: 60, outWidth: 1920, outHeight: 1080, jpegQuality: 98 },
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
        profile: { quality: "draft", fps: 30, outWidth: 1280, outHeight: 720, jpegQuality: 94 },
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
// The seven tools the production audit added
// ---------------------------------------------------------------------------

describe("get_layer_bounds", () => {
  it("returns the layout sidecar WITHOUT any rasterisation", async () => {
    const spy = vi.spyOn(engineClient, "layerBoundsAt").mockResolvedValue({
      sceneId: "scene-01",
      canvas: { width: 1920, height: 1080 },
      elapsedMs: 42,
      warm: true,
      frames: [
        {
          atMs: 1000,
          camera: { scale: 1.1, xPct: 50, yPct: 50, roll: 0, yaw: 0, pitch: 0, clampedVoid: false },
          layers: [
            {
              id: "headline",
              type: "kineticText",
              lifecyclePhase: "settled",
              phaseProgressPct: 0,
              opacity: 1,
              bbox: { x: 10, y: 20, width: 300, height: 80 },
              textOverflow: false,
            },
          ],
          foreground: ["headline"],
          overlaps: [{ a: "headline", b: "subhead", areaPx2: 120 }],
          offscreen: [],
        },
      ],
    });

    const { handleGetLayerBounds } = await import("../src/index.js");
    const result = await handleGetLayerBounds({ sceneId: "scene-01", at: [1000] });
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

    expect(spy).toHaveBeenCalledWith("scene-01", [1000]);
    expect(text).toContain("no rasterisation");
    expect(text).toContain("42 ms");
    expect(text).toContain("headline");
    expect(text).toContain("OVERLAPS");
    // the machine-readable payload rides along
    expect(result.structuredContent?.frames).toBeDefined();
    expect((result.structuredContent?.frames as unknown[]).length).toBe(1);
  });

  it("accepts `timesMs` as an alias of `at`", async () => {
    const spy = vi.spyOn(engineClient, "layerBoundsAt").mockResolvedValue({
      sceneId: "scene-01",
      canvas: { width: 1920, height: 1080 },
      elapsedMs: 10,
      warm: true,
      frames: [],
    });
    const { handleGetLayerBounds } = await import("../src/index.js");
    await handleGetLayerBounds({ sceneId: "scene-01", timesMs: [0, 500] });
    expect(spy).toHaveBeenCalledWith("scene-01", [0, 500]);
  });
});

describe("render_video with wait:false", () => {
  it("returns a job id IMMEDIATELY so a long render cannot outlast the client timeout", async () => {
    vi.spyOn(engineClient, "enqueueRender").mockResolvedValue({ jobId: "job9", status: "queued" });
    vi.spyOn(engineClient, "renderJob").mockResolvedValue({
      id: "job9",
      sceneId: "scene-01",
      quality: "production",
      status: "queued",
      progress: 0,
    });

    const { handleRenderVideo } = await import("../src/index.js");
    const result = await handleRenderVideo({ sceneId: "scene-01", quality: "production", wait: false });
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

    expect(text).toContain("job9");
    expect(text).toContain("get_render_status");
    expect(result.structuredContent?.jobId).toBe("job9");
    expect(result.structuredContent?.status).toBe("queued");
  });
});

describe("get_render_status / get_render_result", () => {
  it("reports the job status and progress", async () => {
    vi.spyOn(engineClient, "renderJob").mockResolvedValue({
      id: "job1",
      sceneId: "scene-01",
      quality: "draft",
      status: "running",
      progress: 0.42,
    });
    const { handleGetRenderStatus } = await import("../src/index.js");
    const result = await handleGetRenderStatus({ jobId: "job1" });
    expect(result.structuredContent?.status).toBe("running");
    expect(result.structuredContent?.progress).toBe(0.42);
  });

  it("returns the ffprobe metadata of a finished export", async () => {
    vi.spyOn(engineClient, "renderResult").mockResolvedValue({
      jobId: "job1",
      sceneId: "scene-01",
      quality: "production",
      status: "succeeded",
      progress: 1,
      outputPath: "/data/renders/production-scene-01.mp4",
      probe: {
        path: "/data/renders/production-scene-01.mp4",
        sizeBytes: 2_425_692,
        durationSec: 8,
        format: "mov,mp4,m4a",
        bitRate: 2_338_553,
        streams: [
          { index: 0, type: "video", codec: "h264", width: 1920, height: 1080, fps: 60 },
          { index: 1, type: "audio", codec: "aac", sampleRate: 48000, channels: 1 },
        ],
      },
    });
    const { handleGetRenderResult } = await import("../src/index.js");
    const result = await handleGetRenderResult({ jobId: "job1" });
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(text).toContain("video h264 1920x1080 @60fps");
    expect(text).toContain("audio aac 48000Hz 1ch");
    expect(result.structuredContent?.probe).toBeDefined();
  });
});

describe("analyze_scene", () => {
  it("reports the cost estimate, the warnings and the keyframe precedence", async () => {
    vi.spyOn(engineClient, "analyzeScene").mockResolvedValue({
      sceneId: "scene-01",
      layerCount: 6,
      durationMs: 8000,
      warnings: [{ code: "CAMERA_VIEWPORT_EXCEEDS_CANVAS", path: "camera.keyframes.0", message: "too far out" }],
      cost: {
        perFrameMultiplier: 2.61,
        estimatedFrameMs: 652,
        estimatedTotalMs: 313_000,
        frames: 480,
        workerBudget: 1,
        keyframeDensity: {
          totalKeyframes: 200,
          animatedProperties: 5,
          keyframedLayers: 1,
          keyframesPerSecond: 25,
          multiplier: 1.01,
          reason: "200 keyframes on 1 layer(s) — evaluating them is cheap",
        },
        heavyEffects: [
          {
            layerId: "bg",
            layerType: "background",
            effect: "meshGradient",
            multiplier: 1.95,
            reason: "a blurred full-frame gradient is re-rasterised on every frame",
          },
        ],
        host: { cpus: 2, totalMemGb: 3.8, softwareRasterised: true },
        notes: [],
      },
      keyframePrecedence: {
        canonical: "keyframes",
        legacy: "tracks",
        rule: "the flat `keyframes` array is canonical and wins",
        conflicts: [
          { layerId: "title", canonicalProperties: ["xPct"], legacyProperties: ["position.xPct"] },
        ],
      },
    });

    const { handleAnalyzeScene } = await import("../src/index.js");
    const result = await handleAnalyzeScene({ sceneId: "scene-01" });
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

    expect(text).toContain("2.61x per frame");
    expect(text).toContain("meshGradient");
    expect(text).toContain("CAMERA_VIEWPORT_EXCEEDS_CANVAS");
    expect(text).toContain("the flat `keyframes` array is canonical and wins");
    expect(text).toContain("carries BOTH arrays");
  });
});

describe("upload_asset", () => {
  it("puts a text asset into the vault and tells the agent how to reference it", async () => {
    const ingest = vi.spyOn(engineClient, "ingestAsset").mockResolvedValue({
      id: "logo.svg",
      name: "logo.svg",
      src: "vault:logo.svg",
      kind: "image",
      size: 128,
      mimeType: "image/svg+xml",
    });
    const { handleUploadAsset } = await import("../src/index.js");
    const result = await handleUploadAsset({ name: "logo.svg", contentText: "<svg/>" });
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

    expect(ingest).toHaveBeenCalled();
    expect(text).toContain("vault:logo.svg");
    expect(text).toContain("scene.assets");
  });

  it("refuses a call with no content at all", async () => {
    const { handleUploadAsset } = await import("../src/index.js");
    const result = await handleUploadAsset({ name: "logo.svg" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("contentBase64");
  });
});

describe("project_asset_manifest", () => {
  it("lists the project's assets and the manifest state", async () => {
    vi.spyOn(engineClient, "projectManifest").mockResolvedValue({
      ok: true,
      manifest: { name: "job" },
      issues: [],
      assets: [{ id: "logo.svg", name: "logo.svg", kind: "image", src: "vault:logo.svg", size: 128 }],
    });
    const { handleProjectAssetManifest } = await import("../src/index.js");
    const result = await handleProjectAssetManifest({ projectPath: "/tmp/job" });
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(text).toContain("manifest: valid");
    expect(text).toContain("logo.svg");
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

describe("critique_and_autofix_scene", () => {
  it("forwards the critique options, formats scoreBefore -> scoreAfter, fix count and structuredContent", async () => {
    const mockReport = {
      sceneId: "scene-critic-01",
      revision: 4,
      scoreBefore: 53,
      scoreAfter: 95,
      issuesBefore: [
        {
          rule: "FOREGROUND_OVERLAP" as const,
          severity: "error" as const,
          atMs: 500,
          layerIds: ["title", "card"],
          message: "Foreground layers overlap",
          autoFixable: true,
        },
      ],
      appliedFixes: [
        'Separated overlapping foreground layers "title" and "card" vertically',
      ],
      issuesAfter: [],
      sampledTimesMs: [250, 1000, 2000],
    };

    const spy = vi
      .spyOn(engineClient, "critiqueAndAutofixScene")
      .mockResolvedValue(mockReport);

    const client = await connect();
    const result = await client.callTool({
      name: "critique_and_autofix_scene",
      arguments: {
        sceneId: "scene-critic-01",
        autoApplyFixes: true,
        sampleTimesMs: [250, 1000, 2000],
      },
    });

    expect(spy).toHaveBeenCalledWith("scene-critic-01", {
      autoApplyFixes: true,
      sampleTimesMs: [250, 1000, 2000],
    });

    const text = result.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("\n");
    expect(text).toContain("53 -> 95");
    expect(text).toContain("applied fixes: 1");
    expect(text).toContain("remaining issues: 0 (none)");

    const structured = (result as any).structuredContent;
    expect(structured).toBeDefined();
    expect(structured.scoreBefore).toBe(53);
    expect(structured.scoreAfter).toBe(95);
    expect(structured.sceneId).toBe("scene-critic-01");
    expect(structured.revision).toBe(4);
    expect(structured.appliedFixes).toHaveLength(1);
  });

  it("calls auto_choreograph_audio and returns both text summary and structuredContent", async () => {
    const mockReport = {
      sceneId: "scene-audio-01",
      revision: 2,
      cuesAdded: 12,
      totalCues: 12,
      bySfx: {
        bassDrop: 1,
        shimmer: 1,
        whoosh: 1,
        softSwoosh: 1,
        typingTick: 1,
        counterTick: 1,
        notificationChime: 1,
        subImpact: 1,
        mouseClick: 2,
        riser: 1,
        ambientPad: 1,
      },
      ambientIncluded: true,
      skipped: [],
    };

    const spy = vi
      .spyOn(engineClient, "autoChoreographAudio")
      .mockResolvedValue(mockReport);

    const client = await connect();
    const result = await client.callTool({
      name: "auto_choreograph_audio",
      arguments: {
        sceneId: "scene-audio-01",
        includeAmbientBed: true,
        overwriteExisting: false,
        masterGain: 1,
      },
    });

    expect(spy).toHaveBeenCalledWith("scene-audio-01", {
      includeAmbientBed: true,
      overwriteExisting: false,
      masterGain: 1,
    });

    const text = result.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("\n");
    expect(text).toContain('choreographed audio: scene-audio-01 (rev 2)');
    expect(text).toContain("cues: 12 added, 12 total");
    expect(text).toContain("ambient bed: on");

    const structured = (result as any).structuredContent;
    expect(structured).toBeDefined();
    expect(structured.sceneId).toBe("scene-audio-01");
    expect(structured.cuesAdded).toBe(12);
    expect(structured.totalCues).toBe(12);
    expect(structured.ambientIncluded).toBe(true);
  });

  it("calls generate_storyboard_from_brief and returns prose summary and structuredContent", async () => {
    const mockReport = {
      projectTitle: "Acme Cloud",
      themePreset: "linearMinimal" as const,
      totalDurationMs: 12000,
      scenes: [
        {
          sceneId: "acme-cloud-s1",
          name: "Acme Cloud - hook",
          durationMs: 4000,
          layerKinds: ["background", "kineticText", "metricTicker", "bentoGrid"],
          score: 100,
          cueCount: 6,
        },
        {
          sceneId: "acme-cloud-s2",
          name: "Acme Cloud - product",
          durationMs: 4000,
          layerKinds: ["deviceMockup", "connectorDiagram", "codeBlock", "card", "cursorFlow"],
          score: 100,
          cueCount: 7,
        },
        {
          sceneId: "acme-cloud-s3",
          name: "Acme Cloud - proof",
          durationMs: 4000,
          layerKinds: ["comparisonSplit", "chart", "cta"],
          score: 100,
          cueCount: 6,
        },
      ],
      manifest: [
        { sceneId: "acme-cloud-s1", index: 0, role: "hook", transitionToNext: "fade" },
        { sceneId: "acme-cloud-s2", index: 1, role: "product", transitionToNext: "fade" },
        { sceneId: "acme-cloud-s3", index: 2, role: "proof", transitionToNext: "cut" },
      ],
    };

    const spy = vi
      .spyOn(engineClient, "generateStoryboardFromBrief")
      .mockResolvedValue(mockReport);

    const client = await connect();
    const result = await client.callTool({
      name: "generate_storyboard_from_brief",
      arguments: {
        projectTitle: "Acme Cloud",
        productName: "Acme Engine",
        tagline: "Ultra-fast video generation platform",
      },
    });

    expect(spy).toHaveBeenCalled();
    const text = result.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("\n");
    expect(text).toContain('storyboard generated: "Acme Cloud"');
    expect(text).toContain("scenes: 3 (acme-cloud-s1, acme-cloud-s2, acme-cloud-s3)");
    expect(text).toContain("total duration: 12000ms");
    expect(text).toContain("theme: linearMinimal");
    expect(text).toContain("scores: acme-cloud-s1: 100, acme-cloud-s2: 100, acme-cloud-s3: 100");

    const structured = (result as any).structuredContent;
    expect(structured).toBeDefined();
    expect(structured.projectTitle).toBe("Acme Cloud");
    expect(structured.totalDurationMs).toBe(12000);
    expect(structured.scenes).toHaveLength(3);
    expect(structured.manifest).toHaveLength(3);
  });

  it("composes storyboard video with wait: true and wait: false", async () => {
    const mockReport: ComposeReport = {
      jobId: "compose-abc12345",
      outputPath: "/tmp/storyboard-master.mp4",
      durationMs: 7500,
      totalWallMs: 14200,
      quality: "draft",
      scenes: [
        {
          sceneId: "scene-1",
          mp4Path: "/tmp/scene-1.mp4",
          durationMs: 4000,
          renderWallMs: 6500,
          frames: 120,
          workerCount: 1,
          transitionToNext: "fade",
          transitionDurationMs: 500,
        },
        {
          sceneId: "scene-2",
          mp4Path: "/tmp/scene-2.mp4",
          durationMs: 4000,
          renderWallMs: 6700,
          frames: 120,
          workerCount: 1,
          transitionToNext: "cut",
          transitionDurationMs: 0,
        },
      ],
      probe: {
        path: "/tmp/storyboard-master.mp4",
        sizeBytes: 154200,
        durationSec: 7.5,
        format: "mov,mp4,m4a,3gp,3g2,mj2",
        streams: [
          {
            index: 0,
            type: "video",
            codec: "h264",
            width: 1280,
            height: 720,
            fps: 30,
            durationSec: 7.5,
          },
          {
            index: 1,
            type: "audio",
            codec: "aac",
            channels: 2,
            sampleRate: 48000,
            durationSec: 7.5,
          },
        ],
      },
    };

    const spy = vi
      .spyOn(engineClient, "composeStoryboardVideo")
      .mockResolvedValueOnce(mockReport)
      .mockResolvedValueOnce({ jobId: "compose-async999", status: "running" });

    const client = await connect();

    // wait: true
    const result1 = await client.callTool({
      name: "compose_storyboard_video",
      arguments: {
        outputName: "client-master",
        scenes: [
          { sceneId: "scene-1", transitionToNext: "fade", transitionDurationMs: 500 },
          { sceneId: "scene-2", transitionToNext: "cut" },
        ],
        quality: "draft",
        wait: true,
      },
    });

    const text1 = result1.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(text1).toContain("storyboard master composed: /tmp/storyboard-master.mp4");
    expect(text1).toContain("total duration: 7.50s (7500ms)");
    expect(text1).toContain("quality: draft");
    expect(text1).toContain("scenes (2):");
    const struct1 = (result1 as any).structuredContent;
    expect(struct1).toBeDefined();
    expect(struct1.jobId).toBe("compose-abc12345");
    expect(struct1.scenes).toHaveLength(2);

    // wait: false
    const result2 = await client.callTool({
      name: "compose_storyboard_video",
      arguments: {
        outputName: "client-master-async",
        scenes: [
          { sceneId: "scene-1" },
          { sceneId: "scene-2" },
        ],
        wait: false,
      },
    });

    const text2 = result2.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    expect(text2).toContain("compose storyboard master compose-async999 started in background (wait: false)");
    const struct2 = (result2 as any).structuredContent;
    expect(struct2).toEqual({ jobId: "compose-async999", status: "running" });
  });
});
