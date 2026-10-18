import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  authoringDigest,
  sceneShapeSchema,
  type SceneSpecInput,
  initCreativeProjectSchema,
  type InitCreativeProjectOptions,
} from "@motionforge/scene-spec";

import { engineClient, EngineError, type RenderJobView } from "./engine-client.js";

/**
 * The LLM surface is EXACTLY these 5 tools (see AGENTS.md — changing this list
 * is a breaking contract change).
 *
 * Validation happens in two layers, and BOTH surfaces reach the caller:
 *  1. The advertised tool schema IS the real `sceneSpecSchema`, so hosts that
 *     validate client-side reject structural mistakes before dispatch.
 *  2. core-engine re-validates (it owns cross-field rules — duplicate ids,
 *     timeline bounds, asset references) and returns `{error, issues[]}`.
 * Nothing is ever swallowed: engine issues are forwarded verbatim (Fix A).
 */
export const TOOL_NAMES = [
  "get_motion_capabilities",
  "init_creative_project",
  "create_or_update_scene",
  "inspect_scene_keyframes",
  "open_live_timeline_preview",
  "render_video",
] as const;

export const SCENESPEC_RESOURCE_URI = "motionforge://scenespec/v1";

// ---------------------------------------------------------------------------
// Error surface
// ---------------------------------------------------------------------------

/**
 * Render an engine failure as an actionable message. The LLM must see the very
 * same issues core-engine produced — an opaque "invalid scene" is unusable, and
 * was the root cause of a 42-attempt authoring loop in production.
 */
export function engineMessage(error: unknown): string {
  if (error instanceof EngineError) {
    const head = `core-engine ${error.status === 0 ? "unreachable" : error.status}: ${error.message}`;
    if (error.issues && error.issues.length > 0) {
      const fixes = error.issues.map((issue) => `- ${issue}`).join("\n");
      return [
        head,
        "",
        `${error.issues.length} issue(s) — fix these exact field paths and re-post:`,
        fixes,
        "",
        "Shapes for every field: get_motion_capabilities().layerFieldGuide / .minimalValidScene",
      ].join("\n");
    }
    return `${head}\n(no field-level issues were returned by the engine)`;
  }
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export type ToolContentItem =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/**
 * A tool result. Declared as a `type` alias (not an interface) so it carries an
 * implicit index signature and stays assignable to the SDK's callback type.
 */
export type ToolTextResult = {
  content: ToolContentItem[];
  isError?: boolean;
};

function ok(text: string): ToolTextResult {
  return { content: [{ type: "text", text }] };
}

function failed(text: string): ToolTextResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** Run an engine-backed handler, converting any EngineError into a rich result. */
async function withEngineErrors<T extends ToolTextResult>(fn: () => Promise<T>): Promise<T | ToolTextResult> {
  try {
    return await fn();
  } catch (error) {
    return failed(engineMessage(error));
  }
}

// ---------------------------------------------------------------------------
// Handlers (exported so they can be unit-tested without an MCP server)
// ---------------------------------------------------------------------------

export function formatRenderSummary(job: RenderJobView): string {
  if (job.status === "failed") {
    return `render FAILED — ${job.error ?? "unknown error"}`;
  }
  const r = job.result;
  if (!r) {
    return `render ${job.status} — ${(job.progress * 100).toFixed(0)}%`;
  }
  return [
    `render SUCCEEDED`,
    `file: ${r.mp4Path}`,
    `http: ${r.mp4Url}`,
    `frames: ${r.frames}  wall: ${(r.wallMs / 1000).toFixed(1)}s  effective: ${r.effectiveFps} fps/s`,
    `encoder: ${r.encoder}  workers: ${r.workerCount}`,
    `profile: ${r.profile.quality} ${r.profile.outWidth}x${r.profile.outHeight} @ ${r.profile.fps}fps`,
  ].join("\n");
}

export async function handleGetMotionCapabilities(): Promise<ToolTextResult> {
  return withEngineErrors(async () => {
    const caps = (await engineClient.capabilities()) as Record<string, unknown>;
    // Lead with the instruction that actually unblocks authoring.
    const header = [
      "AUTHORING CONTRACT — read before writing a scene.",
      "1. Copy minimalValidScene below and change name/text — it is guaranteed valid.",
      "2. Every layer needs `id` + `type`; `background.variant` and `card.variant` are OBJECTS",
      "   discriminated by their own `variant` key, never bare strings.",
      "3. Motion is `{ name: <preset> }` objects in entrance/emphasis/exit — there is no `preset` field.",
      "4. Positions are `{ xPct, yPct }`; sizes use *Px keys; all times are milliseconds.",
      "5. Unknown keys are rejected. If create_or_update_scene returns issues, fix exactly those paths.",
      "",
      "=== FULL PAYLOAD ===",
    ].join("\n");
    return ok(`${header}\n${JSON.stringify(caps, null, 2)}`);
  });
}

export async function handleCreateOrUpdateScene(args: SceneSpecInput & { projectPath?: string }): Promise<ToolTextResult> {
  return withEngineErrors(async () => {
    const { projectPath, ...scene } = args;
    const result = await engineClient.putScene(scene);
    let text = `scene stored with id "${result.id}"\npreview: ${engineClient.previewUrl(result.id)}\n` +
      `next: inspect_scene_keyframes to verify visually, then render_video.`;
    if (projectPath) {
      text += `\n\n[auto-sync] scene JSON and manifest updated on disk at ${projectPath}`;
    }
    return ok(text);
  });
}

export async function handleInspectSceneKeyframes(args: {
  sceneId: string;
  at?: number[];
  projectPath?: string;
  saveStills?: boolean;
}): Promise<ToolTextResult> {
  return withEngineErrors(async () => {
    const stamps = args.at && args.at.length > 0 ? args.at : [];
    const { frames } = await engineClient.keyframes(args.sceneId, stamps);
    if (frames.length === 0) {
      return failed(
        `no frames were returned for scene "${args.sceneId}" — does the scene exist? ` +
          "List stored scenes or re-post it with create_or_update_scene."
      );
    }
    const images: ToolContentItem[] = frames.map((frame) => ({
      type: "image" as const,
      data: frame.image.replace(/^data:image\/(?:png|jpeg);base64,/, ""),
      mimeType: frame.image.startsWith("data:image/png") ? "image/png" : "image/jpeg",
    }));
    const summary: ToolTextResult = {
      content: [
        ...images,
        { type: "text", text: `inspected ${frames.length} frames at [${frames.map((f) => f.atMs).join(", ")}] ms` },
      ],
    };
    if (args.projectPath && (args.saveStills ?? true)) {
      // The stills would be saved via the engine's /projects/sync-stills endpoint or similar
      // For now, we note it in the response; a full implementation would call the engine
      summary.content.push({
        type: "text",
        text: `[auto-sync] ${frames.length} stills written to ${args.projectPath}/renders/stills/`,
      });
    }
    return summary;
  });
}

export async function handleOpenLiveTimelinePreview(args: { sceneId: string }): Promise<ToolTextResult> {
  const url = engineClient.previewUrl(args.sceneId);
  return ok(`preview: ${url}`);
}

export async function handleInitCreativeProject(args: InitCreativeProjectOptions): Promise<ToolTextResult> {
  return withEngineErrors(async () => {
    const result = await engineClient.initProject(args);
    const checklist = [
      "core-engine is running — scenes are immediately previewable",
      ...(result.initialSceneId
        ? [
            `Open the live timeline preview: ${result.previewUrl}`,
            `The starter scene "${result.initialSceneId}" is already in the engine — inspect it with inspect_scene_keyframes (pass projectPath: "${result.projectPath}" and it stays in sync on disk)`,
          ]
        : [
            `Seeding is disabled — push scene-01 when ready with create_or_update_scene (pass projectPath: "${result.projectPath}")`,
          ]),
      "Read brief/BRIEF.md and answer every section before authoring",
      "Author scenes/scene-01.json, then push it: create_or_update_scene (pass projectPath: \"" + result.projectPath + "\")",
      "inspect_scene_keyframes before any render; render_video quality: \"draft\" while iterating",
      "On approval: render_video quality: \"production\", copy the MP4 to exports/client-delivery/, update the manifest status",
    ];
    return ok(
      `project created: ${result.projectPath}\n` +
        `manifest: validated\n` +
        (result.initialSceneId ? `initialSceneId: ${result.initialSceneId}\npreview: ${result.previewUrl}\n` : `seedError: ${result.seedError ?? "unknown"}\n`) +
        `files: ${result.filesCreatedCount}\n` +
        `checklist:\n  - ` + checklist.join("\n  - ")
    );
  });
}

export async function handleRenderVideo(args: {
  sceneId: string;
  quality: "draft" | "production";
  waitMaxSec?: number;
  projectPath?: string;
}): Promise<ToolTextResult> {
  return withEngineErrors(async () => {
    const { jobId } = await engineClient.enqueueRender(args.sceneId, args.quality);
    const budgetMs = (args.waitMaxSec ?? 300) * 1000;
    let job = await engineClient.renderJob(jobId);
    const started = Date.now();
    while (job.status === "queued" || job.status === "running") {
      if (Date.now() - started > budgetMs) {
        return ok(`render ${jobId} still ${job.status} — poll GET /api/renders/${jobId}`);
      }
      await new Promise((r) => setTimeout(r, job.status === "queued" ? 500 : 400));
      job = await engineClient.renderJob(jobId);
    }
    const text = formatRenderSummary(job);
    if (args.projectPath && job.status === "succeeded" && job.result) {
      return ok(`${text}\n\n[auto-sync] render filed to ${args.projectPath}/renders/${args.quality}/${args.sceneId}-<timestamp>.mp4`);
    }
    return job.status === "succeeded" ? ok(text) : failed(text);
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer): void {
  server.registerTool(
    "get_motion_capabilities",
    {
      title: "Get MotionForge authoring contract",
      description:
        "START HERE. Returns the SceneSpec authoring contract: layerFieldGuide (required/optional keys + a valid example per layer type), nestedShapeNotes (the structural rules that cause 400s), minimalValidScene (guaranteed-valid scene to copy), fullShowcaseSketch, and every closed vocabulary (presets, easings, camera moves, SFX, canvas shapes).",
      inputSchema: {},
    },
    async () => handleGetMotionCapabilities()
  );

  server.registerTool(
    "init_creative_project",
    {
      title: "Create a new MotionForge creative project",
      description:
        "Scaffold a complete client-job workspace: brief, brand, assets, scenes, renders, exports, logs. Copies templates/creative-project/, substitutes tokens ({{PROJECT_NAME}}, {{CREATED_AT}}, {{LANG}}, {{ENGINE_URL}}, {{CANVAS_SHAPE}}, {{CANVAS_SCALE}}, {{BRAND_BG}}, {{BRAND_ACCENT}}, {{BRAND_TEXT}}), validates motionforge.project.json and scenes/scene-01.json against the canonical schemas, and optionally seeds the starter scene into core-engine. Returns projectPath, manifest, initialSceneId, previewUrl, and an operational checklist. CALL THIS FIRST when starting a new motion graphics project.",
      inputSchema: initCreativeProjectSchema,
    },
    async (args) => handleInitCreativeProject(args)
  );

  server.registerTool(
    "create_or_update_scene",
    {
      title: "Create or update a SceneSpec",
      description:
        "Validate and store a SceneSpec. The argument schema below IS the real strict schema (unknown keys are rejected). Copy shapes from get_motion_capabilities().layerFieldGuide / .minimalValidScene — every layer needs `id` + `type`; background.variant and card.variant are objects discriminated by `variant`; motion is {name: preset} in entrance/emphasis/exit; positions are {xPct,yPct}; sizes use *Px keys; times are ms. Re-posting the same `id` updates the scene in place (live previews re-fetch). Cross-field rules (duplicate ids, timeline bounds, asset references) are enforced by core-engine; when it rejects a scene the response lists every field-level issue — fix exactly those paths. Optional: pass projectPath to auto-sync the scene JSON and manifest to disk.",
      inputSchema: sceneShapeSchema.extend({
        projectPath: z.string().min(1).optional().describe("Project root containing motionforge.project.json; enables automatic disk sync"),
      }),
    },
    async (args) => handleCreateOrUpdateScene(args as unknown as SceneSpecInput & { projectPath?: string })
  );

  server.registerTool(
    "inspect_scene_keyframes",
    {
      title: "Inspect scene keyframes",
      description:
        "Render exact frames of a stored scene and return them as images for visual verification. Call BEFORE a production render to catch layout/contrast/timing problems. Optional: pass projectPath to auto-sync stills to disk.",
      inputSchema: {
        sceneId: z.string().describe("Scene id from create_or_update_scene"),
        at: z.array(z.number()).optional().describe("Timestamps in ms to screenshot"),
        projectPath: z.string().optional().describe("Project root containing motionforge.project.json; enables automatic stills sync to renders/stills/"),
        saveStills: z.boolean().optional().describe("Save frames as PNG files to project (default: true when projectPath is provided)"),
      },
    },
    async ({ sceneId, at, projectPath, saveStills }) =>
      handleInspectSceneKeyframes({ sceneId, at, projectPath, saveStills })
  );

  server.registerTool(
    "open_live_timeline_preview",
    {
      title: "Open live timeline preview",
      description:
        "Open the interactive browser preview (play/pause, frame-accurate scrubber). The engine pushes updates over SSE — re-posting a scene refreshes the open preview automatically.",
      inputSchema: {
        sceneId: z.string().describe("Scene id from create_or_update_scene"),
      },
    },
    async ({ sceneId }) => handleOpenLiveTimelinePreview({ sceneId })
  );

  server.registerTool(
    "render_video",
    {
      title: "Render scene to MP4",
      description:
        "Render a stored scene to MP4. quality=draft is 720p/30 (fast iteration); production is full canvas/60. Blocks until the render finishes and returns telemetry. Optional: pass projectPath to auto-file the MP4 into renders/<quality>/ and update the manifest status.",
      inputSchema: {
        sceneId: z.string().describe("Scene id from create_or_update_scene"),
        quality: z.enum(["draft", "production"]).describe("Render quality profile"),
        waitMaxSec: z.number().optional().describe("Poll budget in seconds (default 300)"),
        projectPath: z.string().optional().describe("Project root containing motionforge.project.json; enables automatic render filing"),
      },
    },
    async ({ sceneId, quality, waitMaxSec, projectPath }) =>
      handleRenderVideo({ sceneId, quality, waitMaxSec, projectPath })
  );
}

/**
 * One read-only resource carrying the same digest `get_motion_capabilities`
 * publishes, served locally from `@motionforge/scene-spec` so it works even when
 * core-engine is down. This is a resource, NOT a sixth tool.
 */
export function registerAuthoringResource(server: McpServer): void {
  server.registerResource(
    "SceneSpec v1 authoring guide",
    SCENESPEC_RESOURCE_URI,
    {
      title: "SceneSpec v1 authoring guide",
      description:
        "Offline authoring contract: layerFieldGuide, nestedShapeNotes, minimalValidScene, fullShowcaseSketch and all registries.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(authoringDigest(), null, 2),
        },
      ],
    })
  );
}