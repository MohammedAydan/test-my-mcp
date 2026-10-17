import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { engineClient, EngineError, type RenderJobView } from "./engine-client.js";

/**
 * The LLM surface is EXACTLY these 5 tools (see AGENTS.md — changing this list
 * is a breaking contract change). Schemas are documentation for the caller;
 * the strict SceneSpec validation happens in core-engine (`create_or_update_scene`
 * forwards raw args, so hallucinated fields surface as engine issues, never
 * silent drops).
 */
export const TOOL_NAMES = [
  "get_motion_capabilities",
  "create_or_update_scene",
  "inspect_scene_keyframes",
  "open_live_timeline_preview",
  "render_video",
] as const;

const sceneArgsShape = {
  schemaVersion: z.number().optional().describe('Schema version, always 1'),
  id: z.string().optional().describe('Stable scene id; reused across calls to update in place'),
  name: z.string().describe('Human scene name'),
  canvas: z
    .object({
      shape: z.enum(["16:9", "9:16", "1:1", "4:5"]),
      scale: z.number(),
    })
    .describe('Design canvas, e.g. {"shape":"16:9","scale":1080}'),
  durationMs: z.number().describe('Total scene duration in ms (8-30s typical)'),
  assets: z.array(z.record(z.string(), z.unknown())).optional().describe('Declared assets: {id, kind, src}'),
  fonts: z.array(z.record(z.string(), z.unknown())).optional().describe('Font roles: {role, family, provider, weights}'),
  layers: z.array(z.record(z.string(), z.unknown())).min(1).describe('Layer list — see get_motion_capabilities'),
  camera: z.record(z.string(), z.unknown()).optional().describe('Camera keyframes / moves'),
  transitions: z.array(z.record(z.string(), z.unknown())).optional().describe('Scene transitions'),
  audio: z.record(z.string(), z.unknown()).optional().describe("Music + absolute SFX cues (ms)"),
};

function engineMessage(error: unknown): string {
  if (error instanceof EngineError) {
    return error.issues && error.issues.length > 0
      ? `${error.message}\nissues:\n${error.issues.map((i) => `- ${i}`).join("\n")}`
      : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

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

export function registerTools(server: McpServer): void {
  server.tool(
    "get_motion_capabilities",
    "List every layer type, variant, motion preset, camera move, SFX name, canvas shape and transition the engine supports. ALWAYS read this before authoring a SceneSpec.",
    {},
    async () => ({
      content: [{ type: "text", text: JSON.stringify(await engineClient.capabilities(), null, 2) }],
    })
  );

  server.tool(
    "create_or_update_scene",
    "Validate and store a SceneSpec. Unknown fields are rejected — do not invent layer types, presets or params. Re-posting the same id updates the scene in place (live previews re-fetch automatically).",
    sceneArgsShape,
    async (args) => {
      const result = await engineClient.putScene(args);
      return {
        content: [
          {
            type: "text",
            text: `scene stored with id "${result.id}"\npreview: ${engineClient.previewUrl(result.id)}\nnext: inspect_scene_keyframes to verify visually, then render_video.`,
          },
        ],
      };
    }
  );

  server.tool(
    "inspect_scene_keyframes",
    "Render exact frames of a stored scene and return them as images for visual verification. Call BEFORE a production render to catch layout/contrast/timing problems.",
    {
      sceneId: z.string().describe('Scene id from create_or_update_scene'),
      at: z
        .array(z.number())
        .optional()
        .describe('Timestamps in ms to screenshot; default [0, duration/2, duration-500]')
    },
    async ({ sceneId, at }) => {
      const stamps = at && at.length > 0 ? at : [];
      const { frames } = await engineClient.keyframes(sceneId, stamps);
      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
      for (const frame of frames) {
        const base64 = frame.image.replace(/^data:image\/jpeg;base64,/, "");
        content.push({ type: "image", data: base64, mimeType: "image/jpeg" });
      }
      content.push({
        type: "text",
        text: `inspected ${frames.length} frames at [${frames.map((f) => f.atMs).join(", ")}] ms`,
      });
      return { content };
    }
  );

  server.tool(
    "open_live_timeline_preview",
    "Open the interactive browser preview (play/pause, frame-accurate scrubber). The engine pushes updates over SSE — re-posting a scene refreshes the open preview automatically.",
    { sceneId: z.string().describe('Scene id from create_or_update_scene') },
    async ({ sceneId }) => {
      const url = engineClient.previewUrl(sceneId);
      return { content: [{ type: "text", text: `preview: ${url}` }] };
    }
  );

  server.tool(
    "render_video",
    "Render a stored scene to MP4. quality=draft is 720p/30 (fast iteration); production is full canvas/60. Blocks until the render finishes and returns telemetry.",
    {
      sceneId: z.string().describe('Scene id from create_or_update_scene'),
      quality: z.enum(["draft", "production"]).describe('Render quality profile'),
      waitMaxSec: z.number().optional().describe('Poll budget in seconds (default 300)'),
    },
    async ({ sceneId, quality, waitMaxSec }) => {
      const { jobId } = await engineClient.enqueueRender(sceneId, quality);
      const budgetMs = (waitMaxSec ?? 300) * 1000;
      let job = await engineClient.renderJob(jobId);
      const started = Date.now();
      while (job.status === "queued" || job.status === "running") {
        if (Date.now() - started > budgetMs) {
          return {
            content: [{ type: "text", text: `render ${jobId} still ${job.status} — poll GET /api/renders/${jobId}` }],
          };
        }
        await new Promise((r) => setTimeout(r, job.status === "queued" ? 500 : 400));
        job = await engineClient.renderJob(jobId);
      }
      return { content: [{ type: "text", text: formatRenderSummary(job) }] };
    }
  );
}

export { engineMessage };
