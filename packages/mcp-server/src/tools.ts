import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  authoringDigest,
  sceneShapeSchema,
  type SceneSpecInput,
  initCreativeProjectSchema,
  type InitCreativeProjectOptions,
} from "@motionforge/scene-spec";

import {
  engineClient,
  EngineError,
  type KeyframeFrameMeta,
  type RenderJobView,
  type SceneWarning,
} from "./engine-client.js";

/**
 * The LLM surface of the MotionForge MCP server.
 *
 * The ORIGINAL six tools are unchanged in behaviour and in name:
 * `get_motion_capabilities`, `init_creative_project`, `create_or_update_scene`,
 * `inspect_scene_keyframes`, `open_live_timeline_preview`, `render_video`.
 *
 * Seven more were added because the production audit found that an agent had
 * no way to ASK the questions the workflow actually needs:
 *
 * | tool | why it exists |
 * | --- | --- |
 * | `get_layer_bounds` | the layout sidecar WITHOUT the rasterisation — the old way cost a full frame capture per timestamp (5938 ms/frame measured) |
 * | `get_render_status` | poll a long render instead of blocking on it |
 * | `get_render_result` | the ffprobe metadata of a finished export |
 * | `analyze_scene` | the warnings + the per-frame render-cost estimate |
 * | `upload_asset` | put a file into the vault — an agent could not author a job without a logo |
 * | `project_asset_manifest` | what the project already has |
 * | `render_scene` | an alias of `render_video` (the name some hosts expect) |
 *
 * Validation happens in two layers, and BOTH surfaces reach the caller:
 *  1. The advertised tool schema IS the real `sceneSpecSchema`, so hosts that
 *     validate client-side reject structural mistakes before dispatch.
 *  2. core-engine re-validates (it owns cross-field rules — duplicate ids,
 *     timeline bounds, asset references) and returns `{error, issues[]}`.
 * Nothing is ever swallowed: engine issues are forwarded verbatim (Fix A).
 *
 * EVERY result carries BOTH a human/agent-readable `content` block AND a
 * machine-readable `structuredContent` payload, so a host can consume the
 * numbers without parsing prose.
 */
export const TOOL_NAMES = [
  "get_motion_capabilities",
  "init_creative_project",
  "create_or_update_scene",
  "inspect_scene_keyframes",
  "open_live_timeline_preview",
  "render_video",
  "render_scene",
  "get_layer_bounds",
  "get_render_status",
  "get_render_result",
  "analyze_scene",
  "upload_asset",
  "project_asset_manifest",
  "critique_and_autofix_scene",
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
  /**
   * The machine-readable payload.
   *
   * The `content` block is prose an LLM reads; this is the same data a host
   * program consumes. The MCP SDK supports `structuredContent` natively, so
   * every result now carries both — an agent can stop regex-ing prose.
   */
  structuredContent?: Record<string, unknown>;
};

function ok(text: string, structured?: Record<string, unknown>): ToolTextResult {
  return {
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

function failed(text: string, structured?: Record<string, unknown>): ToolTextResult {
  return {
    content: [{ type: "text", text }],
    isError: true,
    ...(structured ? { structuredContent: structured } : {}),
  };
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
      "6. Camera: see `cameraKeyframeFields` (defaults + safe pan range) and `cameraMoveShapes`.",
      "   A keyframe inherits every field it omits; at scale s the safe xPct/yPct range is [50/s, 100-50/s].",
      "7. Transitions: see `transitionShapes` for the full parameter list of each kind.",
      "8. `nestedFieldShapes` documents box/chip, highlight, callout and progressBar.",
      "9. create_or_update_scene returns `warnings[]` for non-blocking problems (e.g. a camera",
      "   that would expose black void) — the runtime auto-corrects them, but fix the authored value.",
      "10. inspect_scene_keyframes returns `framesMeta` per timestamp: camera pose, active transition",
      "    phase and each layer's lifecycle/opacity/bbox/textOverflow. Read it before judging a frame.",
      "11. LAYER KINDS — there are TEN: background, imageLogo, kineticText, card, lottie,",
      "    foregroundFX, chart, codeBlock, particleField, cta. The last four are first-class.",
      "12. KEYFRAMES — the flat `keyframes` array is CANONICAL and WINS over the legacy `tracks`",
      "    array for every property it drives. Write `keyframes`; never `tracks`.",
      "13. TOOLS — use `get_layer_bounds` for LAYOUT questions (sub-second, no rasterisation) and",
      "    `inspect_scene_keyframes` only when you need to SEE a frame. `analyze_scene` reports the",
      "    render-cost estimate and the warnings. `render_video` with wait:false returns a jobId you",
      "    can poll with `get_render_status` and finish with `get_render_result`.",
      "",
      "=== FULL PAYLOAD ===",
    ].join("\n");
    return ok(`${header}\n${JSON.stringify(caps, null, 2)}`, { capabilities: caps });
  });
}

/**
 * Render engine warnings for an LLM. These are non-blocking: the scene WAS
 * stored, and the runtime clamps the offending camera automatically. Reporting
 * them keeps the "the render looked wrong" class of bug diagnosable without a
 * frame-by-frame diff.
 */
export function formatWarnings(warnings: readonly SceneWarning[] | undefined): string {
  if (!warnings || warnings.length === 0) return "";
  return [
    "",
    `${warnings.length} warning(s) — the scene was stored; the runtime corrected these automatically:`,
    ...warnings.map((w) => `- [${w.code}] ${w.path}: ${w.message}`),
  ].join("\n");
}

export async function handleCreateOrUpdateScene(args: SceneSpecInput & { projectPath?: string }): Promise<ToolTextResult> {
  return withEngineErrors(async () => {
    const { projectPath, ...scene } = args;
    // with a projectPath the engine also resolves `<project>/assets/**` into the
    // vault and writes the scene JSON + manifest back to disk
    const result = projectPath
      ? await engineClient.syncScene(scene, projectPath)
      : await engineClient.putScene(scene);
    const text =
      `scene ${result.status ?? "stored"} with id "${result.id}" (revision ${result.revision}, hash ${result.hash})\n` +
      `preview: ${result.previewUrl ?? engineClient.previewUrl(result.id)}\n` +
      `next: inspect_scene_keyframes to verify visually, then render_video.` +
      formatWarnings(result.warnings) +
      (result.savedSceneFilePath ? `\n[auto-sync] scene JSON + manifest updated: ${result.savedSceneFilePath}` : "");
    return ok(text, {
      id: result.id,
      status: result.status,
      revision: result.revision,
      hash: result.hash,
      previewUrl: result.previewUrl ?? engineClient.previewUrl(result.id),
      warnings: result.warnings ?? [],
      savedSceneFilePath: result.savedSceneFilePath ?? null,
    });
  });
}

/**
 * The numeric sidecar `inspect_scene_keyframes` attaches to every frame. It
 * answers the questions a screenshot cannot: is this layer mid-entrance (so the
 * frame looks "empty" for a legitimate reason), is the camera showing void, is a
 * word clipped.
 */
export function formatFrameMeta(meta: KeyframeFrameMeta[] | undefined): string {
  if (!meta || meta.length === 0) return "";
  const lines: string[] = ["", "framesMeta (numeric, deterministic — read this before blaming the pixels):"];
  for (const m of meta) {
    lines.push(`- @${m.atMs}ms`);
    if (m.camera) {
      const cam = m.camera;
      lines.push(
        `    camera: scale ${round(cam.scale)} xPct ${round(cam.xPct)} yPct ${round(cam.yPct)} ` +
          `roll ${round(cam.roll)} yaw ${round(cam.yaw)} pitch ${round(cam.pitch)}` +
          // when the pose is pinned, an agent needs BOTH numbers: what the
          // scene asked for, and what the frame actually shows
          (cam.clampedVoid
            ? ` [clampedVoid: authored look-at was xPct ${round(cam.unclampedXPct) ?? "?"} ` +
              `yPct ${round(cam.unclampedYPct) ?? "?"}, held inside the canvas at this zoom]`
            : "")
      );
    }
    for (const tr of m.activeTransitions ?? []) {
      lines.push(`    transition: ${tr.kind} ${tr.progressPct}% (phase "${tr.phase}") — content beneath is mid-swap`);
    }
    for (const layer of m.layers ?? []) {
      const visible = layer.opacity > 0.01;
      if (!visible) continue;
      const flags: string[] = [];
      if (layer.textOverflow) flags.push("TEXT OVERFLOW (clipped content)");
      if (layer.lifecyclePhase !== "settled") {
        flags.push(`mid-${layer.lifecyclePhase} ${layer.phaseProgressPct}%`);
      }
      lines.push(
        `    layer ${layer.id} (${layer.type}) opacity ${layer.opacity} ` +
          `bbox ${round(layer.bbox.width)}x${round(layer.bbox.height)}@${round(layer.bbox.x)},${round(layer.bbox.y)}` +
          (flags.length > 0 ? ` — ${flags.join("; ")}` : "")
      );
    }
  }
  return lines.join("\n");
}

function round(value: number): number;
function round(value: number | undefined): number | undefined;
/**
 * Tolerates a missing value, because the frame sidecar is a loose contract: an
 * engine older than the runtime simply does not report the field, and an
 * undefined must not become `NaN` in an agent-facing message.
 */
function round(value: number | undefined): number | undefined {
  return typeof value === "number" ? Math.round(value * 10) / 10 : undefined;
}

export async function handleInspectSceneKeyframes(args: {
  sceneId: string;
  at?: number[];
  projectPath?: string;
  saveStills?: boolean;
  /**
   * Include the inline preview images in the tool result.
   *
   * Default true. The inline copies are small JPEGs (≤960px wide) — a 12-frame
   * response is ~300 KB instead of ~15 MB, which is the difference between a
   * working stdio session and an `EPIPE` crash.
   */
  includeInlineImages?: boolean;
}): Promise<ToolTextResult> {
  return withEngineErrors(async () => {
    const stamps = args.at && args.at.length > 0 ? args.at : [];
    // full-resolution PNGs are only produced when they are about to be written
    // to disk — they are far too large to put in an MCP response
    const shouldSave = Boolean(args.projectPath) && (args.saveStills ?? true);
    const { frames, framesMeta } = await engineClient.keyframes(
      args.sceneId,
      stamps,
      shouldSave
    );
    if (frames.length === 0) {
      return failed(
        `no frames were returned for scene "${args.sceneId}" — does the scene exist? ` +
          "List stored scenes or re-post it with create_or_update_scene."
      );
    }
    const includeInline = args.includeInlineImages ?? true;
    const images: ToolContentItem[] = includeInline
      ? frames
          .filter((frame) => frame.preview)
          .map((frame) => ({
            type: "image" as const,
            data: frame.preview.replace(/^data:image\/(?:png|jpeg);base64,/, ""),
            mimeType: "image/jpeg",
          }))
      : [];
    const summary: ToolTextResult = {
      content: [
        ...images,
        {
          type: "text",
          text:
            `inspected ${frames.length} frames at [${frames.map((f) => f.atMs).join(", ")}] ms` +
            (includeInline ? "" : " (inline images omitted — set includeInlineImages: true to see them)") +
            formatFrameMeta(framesMeta),
        },
      ],
      structuredContent: {
        sceneId: args.sceneId,
        at: frames.map((f) => f.atMs),
        frameCount: frames.length,
        framesMeta: framesMeta ?? [],
        inlineImageCount: images.length,
      },
    };
    // stills are deliverable client assets: written whenever a project is known
    if (shouldSave && args.projectPath) {
      try {
        const saved = await engineClient.saveStills(
          args.sceneId,
          frames.filter((f) => f.image).map((f) => ({ atMs: f.atMs, image: f.image })),
          args.projectPath,
          framesMeta
        );
        summary.content.push({
          type: "text",
          text:
            `[auto-sync] ${saved.files.length} still(s) written:\n  ${saved.files.join("\n  ")}` +
            (saved.metaFile ? `\n[auto-sync] frame metadata sidecar: ${saved.metaFile}` : ""),
        });
      } catch (error) {
        // never fail an inspection over a disk write
        summary.content.push({
          type: "text",
          text: `[auto-sync] could not write stills to ${args.projectPath}: ${engineMessage(error)}`,
        });
      }
    }
    return summary;
  });
}

export async function handleOpenLiveTimelinePreview(args: { sceneId: string }): Promise<ToolTextResult> {
  const url = engineClient.previewUrl(args.sceneId);
  return ok(`preview: ${url}`, { sceneId: args.sceneId, previewUrl: url });
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
        `checklist:\n  - ` + checklist.join("\n  - "),
      {
        projectPath: result.projectPath,
        manifest: result.manifest,
        initialSceneId: result.initialSceneId,
        previewUrl: result.previewUrl,
        filesCreatedCount: result.filesCreatedCount,
        seedError: result.seedError,
      }
    );
  });
}

export async function handleRenderVideo(args: {
  sceneId: string;
  quality: "preview" | "draft" | "production";
  waitMaxSec?: number;
  projectPath?: string;
  /**
   * Wait for the render to finish (default) or return a job id immediately.
   *
   * A production render of an 8-second scene took 430 s on the reference
   * host — longer than the MCP SDK's DEFAULT 60 s request timeout, so a
   * client that waited would abort the request while the server was still
   * working. `wait: false` hands back a `jobId` the agent can poll with
   * `get_render_status` and finish with `get_render_result`.
   */
  wait?: boolean;
}): Promise<ToolTextResult> {
  return withEngineErrors(async () => {
    const { jobId } = await engineClient.enqueueRender(args.sceneId, args.quality);
    const structured: Record<string, unknown> = { jobId, sceneId: args.sceneId, quality: args.quality };

    if (args.wait === false) {
      const job = await engineClient.renderJob(jobId);
      structured.status = job.status;
      structured.progress = job.progress;
      return ok(
        `render ${jobId} queued (wait: false) — status "${job.status}"\n` +
          `poll it with get_render_status { jobId: "${jobId}" } and finish with get_render_result { jobId: "${jobId}" }`,
        structured
      );
    }

    const budgetMs = (args.waitMaxSec ?? 300) * 1000;
    let job = await engineClient.renderJob(jobId);
    const started = Date.now();
    while (job.status === "queued" || job.status === "running") {
      if (Date.now() - started > budgetMs) {
        structured.status = job.status;
        structured.progress = job.progress;
        return ok(
          `render ${jobId} still ${job.status} — poll it with get_render_status { jobId: "${jobId}" }`,
          structured
        );
      }
      await new Promise((r) => setTimeout(r, job.status === "queued" ? 500 : 400));
      job = await engineClient.renderJob(jobId);
    }
    const text = formatRenderSummary(job);
    structured.status = job.status;
    structured.progress = job.progress;
    if (job.result) {
      structured.result = job.result;
      structured.outputPath = job.result.mp4Path;
    }
    if (job.status !== "succeeded") return failed(text, structured);

    if (!args.projectPath) return ok(text, structured);

    // File the render into the project. A disk failure here is reported but does
    // not invalidate a render that already succeeded — the MP4 path above is
    // still the deliverable.
    try {
      const bytes = await engineClient.renderFileBase64(jobId);
      const saved = await engineClient.saveRender(args.sceneId, args.quality, bytes.mp4Base64, args.projectPath);
      structured.savedFile = saved.file;
      structured.savedLatest = saved.latest;
      return ok(
        `${text}\n\n[auto-sync] filed ${saved.file}\n` +
          `[auto-sync] latest: ${saved.latest}\n` +
          `[auto-sync] manifest status for "${args.sceneId}" is now "${saved.status}"`,
        structured
      );
    } catch (error) {
      return ok(`${text}\n\n[auto-sync] FAILED to file into ${args.projectPath}: ${engineMessage(error)}`, structured);
    }
  });
}

// ---------------------------------------------------------------------------
// The seven tools the production audit added
// ---------------------------------------------------------------------------

/**
 * `get_layer_bounds` — the layout sidecar WITHOUT the rasterisation.
 *
 * THE POINT: `inspect_scene_keyframes` measures a frame by CAPTURING it, so
 * the measurement costs a full Playwright frame capture per timestamp (5938
 * ms/frame measured on the reference host). Every one of those numbers is
 * already computed in the page in milliseconds — only the rasterisation is
 * expensive, and a layout question does not need it.
 */
export async function handleGetLayerBounds(args: {
  sceneId: string;
  /** timestamps in ms; defaults to the whole scene in 4 samples */
  at?: number[];
  timesMs?: number[];
}): Promise<ToolTextResult> {
  return withEngineErrors(async () => {
    const requested = args.at ?? args.timesMs ?? [];
    const report = await engineClient.layerBoundsAt(args.sceneId, requested);
    const lines: string[] = [
      `layout report for "${report.sceneId}" — ${report.frames.length} frame(s) in ${report.elapsedMs} ms (no rasterisation)`,
      `canvas: ${report.canvas.width}x${report.canvas.height}`,
    ];
    for (const frame of report.frames) {
      lines.push(
        `- @${frame.atMs}ms  camera scale ${round(frame.camera.scale)} xPct ${round(frame.camera.xPct)} yPct ${round(frame.camera.yPct)}` +
          (frame.camera.clampedVoid ? " [clampedVoid]" : "")
      );
      for (const layer of frame.layers) {
        const flags: string[] = [];
        if (layer.textOverflow) flags.push("TEXT OVERFLOW");
        if (layer.lifecyclePhase !== "settled") flags.push(`mid-${layer.lifecyclePhase} ${layer.phaseProgressPct}%`);
        lines.push(
          `    ${layer.id} (${layer.type}) opacity ${layer.opacity} ` +
            `bbox ${round(layer.bbox.width)}x${round(layer.bbox.height)}@${round(layer.bbox.x)},${round(layer.bbox.y)}` +
            (flags.length > 0 ? ` — ${flags.join("; ")}` : "")
        );
      }
      if (frame.overlaps.length > 0) {
        lines.push(
          `    OVERLAPS: ${frame.overlaps
            .map((o) => `${o.a}×${o.b} (${Math.round(o.areaPx2)}px²)`)
            .join(", ")}`
        );
      }
      if (frame.offscreen.length > 0) {
        lines.push(
          `    OFF-CANVAS: ${frame.offscreen.map((o) => `${o.id} (${o.edges.join("/")})`).join(", ")}`
        );
      }
    }
    return ok(lines.join("\n"), {
      sceneId: report.sceneId,
      canvas: report.canvas,
      elapsedMs: report.elapsedMs,
      warm: report.warm,
      frames: report.frames,
    });
  });
}

/** `get_render_status` — poll a render that was started with `wait: false`. */
export async function handleGetRenderStatus(args: { jobId: string }): Promise<ToolTextResult> {
  return withEngineErrors(async () => {
    const job = await engineClient.renderJob(args.jobId);
    return ok(formatRenderSummary(job), {
      jobId: job.id,
      sceneId: job.sceneId,
      quality: job.quality,
      status: job.status,
      progress: job.progress,
      error: job.error ?? null,
      result: job.result ?? null,
    });
  });
}

/** `get_render_result` — the finished export plus its ffprobe metadata. */
export async function handleGetRenderResult(args: { jobId: string }): Promise<ToolTextResult> {
  return withEngineErrors(async () => {
    const result = await engineClient.renderResult(args.jobId);
    const lines = [
      `render ${result.jobId} — ${result.status}`,
      result.error ? `error: ${result.error}` : "",
      result.outputPath ? `file: ${result.outputPath}` : "",
      result.telemetry
        ? `frames: ${result.telemetry.frames}  wall: ${(result.telemetry.wallMs / 1000).toFixed(1)}s  effective: ${result.telemetry.effectiveFps} fps/s`
        : "",
      result.telemetry
        ? `profile: ${result.telemetry.profile.quality} ${result.telemetry.profile.outWidth}x${result.telemetry.profile.outHeight} @ ${result.telemetry.profile.fps}fps`
        : "",
    ].filter(Boolean);
    if (result.probe) {
      lines.push(
        `probe: ${result.probe.format} ${result.probe.durationSec.toFixed(3)}s ${(result.probe.sizeBytes / 1024 / 1024).toFixed(2)}MB` +
          (result.probe.bitRate ? ` @${Math.round(result.probe.bitRate / 1000)}kbps` : "")
      );
      for (const stream of result.probe.streams) {
        lines.push(
          `  stream ${stream.index}: ${stream.type} ${stream.codec}` +
            (stream.width ? ` ${stream.width}x${stream.height}` : "") +
            (stream.fps ? ` @${stream.fps}fps` : "") +
            (stream.sampleRate ? ` ${stream.sampleRate}Hz ${stream.channels}ch` : "")
        );
      }
    }
    return ok(lines.join("\n"), result as unknown as Record<string, unknown>);
  });
}

/** `analyze_scene` — the warnings, the render-cost estimate and the keyframe precedence. */
export async function handleAnalyzeScene(args: { sceneId: string }): Promise<ToolTextResult> {
  return withEngineErrors(async () => {
    const report = await engineClient.analyzeScene(args.sceneId);
    const lines: string[] = [
      `analysis of "${report.sceneId}" — ${report.layerCount} layer(s), ${report.durationMs}ms`,
      `estimated cost: ${report.cost.perFrameMultiplier.toFixed(2)}x per frame — ` +
        `≈${report.cost.estimatedFrameMs}ms/frame, ≈${Math.round(report.cost.estimatedTotalMs / 1000)}s total ` +
        `(${report.cost.frames} frames, worker budget ${report.cost.workerBudget})`,
      // THE DENSITY TERM, in prose as well as in `structuredContent`. The
      // multiplier is MEASURED (×1.01 at 200 keyframes): evaluating keyframes
      // is cheap. The term stays visible so a caller can see the count, the
      // properties and the rate — and the warnings name the VALUE (a filtered
      // layer scaled past 4×) that actually exhausts a render host.
      `keyframe density: ${report.cost.keyframeDensity.totalKeyframes} keyframe(s) across ` +
        `${report.cost.keyframeDensity.animatedProperties} ` +
        `propert${report.cost.keyframeDensity.animatedProperties === 1 ? "y" : "ies"} on ` +
        `${report.cost.keyframeDensity.keyframedLayers} layer(s) — ` +
        `x${report.cost.keyframeDensity.multiplier.toFixed(2)} ` +
        `(${report.cost.keyframeDensity.keyframesPerSecond}/s)`,
    ];
    if (report.cost.heavyEffects.length > 0) {
      lines.push("expensive features:");
      for (const effect of report.cost.heavyEffects) {
        lines.push(`  - ${effect.effect} on ${effect.layerId} (${effect.layerType}) x${effect.multiplier} — ${effect.reason}`);
      }
    } else {
      lines.push("no expensive features detected");
    }
    if (report.warnings.length > 0) {
      lines.push(`${report.warnings.length} warning(s):`);
      for (const warning of report.warnings) {
        lines.push(`  - [${warning.code}] ${warning.path}: ${warning.message}`);
      }
    } else {
      lines.push("no warnings");
    }
    lines.push(`keyframe precedence: ${report.keyframePrecedence.rule}`);
    for (const conflict of report.keyframePrecedence.conflicts) {
      lines.push(
        `  - layer "${conflict.layerId}" carries BOTH arrays: canonical [${conflict.canonicalProperties.join(", ")}] ` +
          `vs legacy [${conflict.legacyProperties.join(", ")}] — the canonical one wins`
      );
    }
    return ok(lines.join("\n"), report as unknown as Record<string, unknown>);
  });
}

/**
 * `upload_asset` — put a file into the engine's vault.
 *
 * THE GAP THIS CLOSES: an agent could reference a `vault:` asset but had no
 * way to CREATE one, so every real client job (which needs the client's logo
 * and product shots) needed a human to place the bytes by hand.
 */
export async function handleUploadAsset(args: {
  name: string;
  kind?: string;
  projectPath?: string;
  /** the file's bytes, base64 */
  contentBase64?: string;
  /** the file's bytes, as UTF-8 text (SVG, JSON, …) */
  contentText?: string;
}): Promise<ToolTextResult> {
  return withEngineErrors(async () => {
    let bytes: Buffer;
    if (args.contentBase64 !== undefined) {
      bytes = Buffer.from(args.contentBase64, "base64");
    } else if (args.contentText !== undefined) {
      bytes = Buffer.from(args.contentText, "utf8");
    } else {
      return failed(
        "upload_asset needs either `contentBase64` (binary) or `contentText` (UTF-8 text, e.g. an SVG)."
      );
    }
    if (bytes.length === 0) {
      return failed("upload_asset received an empty file.");
    }
    const item = await engineClient.ingestAsset(bytes, args.name, args.kind, args.projectPath);
    const text =
      `asset uploaded: ${item.name} (${item.kind}, ${item.size} bytes)\n` +
      `vault src: ${item.src}\n` +
      `declare it in scene.assets as { "id": "<your id>", "kind": "${item.kind}", "src": "${item.src}" }`;
    return ok(text, item as unknown as Record<string, unknown>);
  });
}

/** `project_asset_manifest` — what the project already has on disk. */
export async function handleProjectAssetManifest(args: { projectPath: string }): Promise<ToolTextResult> {
  return withEngineErrors(async () => {
    const result = await engineClient.projectManifest(args.projectPath);
    const lines = [
      `project manifest: ${args.projectPath}`,
      result.ok ? "manifest: valid" : `manifest: INVALID — ${result.issues.join("; ")}`,
      `assets: ${result.assets.length}`,
    ];
    for (const asset of result.assets) {
      lines.push(`  - ${asset.name} (${asset.kind}, ${asset.size} bytes) → ${asset.src}`);
    }
    return ok(lines.join("\n"), result as unknown as Record<string, unknown>);
  });
}

export async function handleCritiqueAndAutofixScene(args: {
  sceneId: string;
  autoApplyFixes?: boolean;
  sampleTimesMs?: number[];
}): Promise<ToolTextResult> {
  return withEngineErrors(async () => {
    const report = await engineClient.critiqueAndAutofixScene(args.sceneId, {
      autoApplyFixes: args.autoApplyFixes,
      sampleTimesMs: args.sampleTimesMs,
    });
    const remainingRules = Array.from(new Set(report.issuesAfter.map((i) => i.rule)));
    const remainingSummary =
      remainingRules.length === 0 ? "none" : remainingRules.join(", ");
    const lines = [
      `critique and auto-fix: ${report.sceneId} (rev ${report.revision})`,
      `score: ${report.scoreBefore} -> ${report.scoreAfter}`,
      `applied fixes: ${report.appliedFixes.length}`,
      ...report.appliedFixes.map((f) => `  - ${f}`),
      `remaining issues: ${report.issuesAfter.length} (${remainingSummary})`,
    ];
    return ok(lines.join("\n"), report as unknown as Record<string, unknown>);
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
        "Render exact frames of a stored scene and return them as images for visual verification. Call BEFORE a production render to catch layout/contrast/timing problems. The inline images are lightweight JPEG previews (≤960px) so a multi-frame inspection stays small over the stdio pipe; pass projectPath to write the FULL-RESOLUTION PNGs to renders/stills/ together with a frames-meta.json sidecar. The result also carries framesMeta: the camera pose, the live transition phase and each layer's lifecycle/opacity/bbox/textOverflow.",
      inputSchema: {
        sceneId: z.string().describe("Scene id from create_or_update_scene"),
        at: z.array(z.number()).optional().describe("Timestamps in ms to screenshot"),
        projectPath: z.string().optional().describe("Project root containing motionforge.project.json; enables automatic stills sync to renders/stills/"),
        saveStills: z.boolean().optional().describe("Save frames as full-resolution PNG files to the project (default: true when projectPath is provided)"),
        includeInlineImages: z.boolean().optional().describe("Include the inline preview images in the result (default: true). Set false for a text-only inspection when you only need framesMeta."),
      },
    },
    async ({ sceneId, at, projectPath, saveStills, includeInlineImages }) =>
      handleInspectSceneKeyframes({ sceneId, at, projectPath, saveStills, includeInlineImages })
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
        "Render a stored scene to MP4. quality=draft is 720p/30 (fast iteration); production is full canvas/60. Blocks until the render finishes and returns telemetry. Pass wait: false to get a jobId back IMMEDIATELY and poll it with get_render_status — a production render can take minutes and outlast the client's own request timeout. Optional: pass projectPath to auto-file the MP4 into renders/<quality>/ and update the manifest status.",
      inputSchema: {
        sceneId: z.string().describe("Scene id from create_or_update_scene"),
        quality: z
          .enum(["preview", "draft", "production"])
          .describe("Render quality profile: preview = 360p/12 (a layout check, seconds), draft = 720p/30, production = full canvas/60"),
        waitMaxSec: z.number().optional().describe("Poll budget in seconds (default 300)"),
        wait: z.boolean().optional().describe("Wait for the render to finish (default true). false returns a jobId immediately."),
        projectPath: z.string().optional().describe("Project root containing motionforge.project.json; enables automatic render filing"),
      },
    },
    async ({ sceneId, quality, waitMaxSec, wait, projectPath }) =>
      handleRenderVideo({ sceneId, quality, waitMaxSec, projectPath, wait })
  );

  // -------------------------------------------------------------------------
  // The tools the production audit added
  // -------------------------------------------------------------------------

  server.registerTool(
    "render_scene",
    {
      title: "Render scene to MP4 (alias of render_video)",
      description:
        "An ALIAS of render_video, for hosts that expect the older name. Identical arguments and behaviour: quality=draft is 720p/30, production is full canvas/60, wait:false returns a jobId immediately.",
      inputSchema: {
        sceneId: z.string().describe("Scene id from create_or_update_scene"),
        quality: z
          .enum(["preview", "draft", "production"])
          .describe("Render quality profile: preview = 360p/12 (a layout check, seconds), draft = 720p/30, production = full canvas/60"),
        waitMaxSec: z.number().optional().describe("Poll budget in seconds (default 300)"),
        wait: z.boolean().optional().describe("Wait for the render to finish (default true). false returns a jobId immediately."),
        projectPath: z.string().optional().describe("Project root containing motionforge.project.json; enables automatic render filing"),
      },
    },
    async ({ sceneId, quality, waitMaxSec, wait, projectPath }) =>
      handleRenderVideo({ sceneId, quality, waitMaxSec, projectPath, wait })
  );

  server.registerTool(
    "get_layer_bounds",
    {
      title: "Measure a scene's layout without rendering it",
      description:
        "The numeric layout of a scene at one or more timestamps — per-layer bounding boxes, the camera pose, the overlapping pairs, the off-canvas layers and the text-overflow flags. NO rasterisation happens: the numbers are read out of the live page, so this answers a layout question in milliseconds instead of the seconds a full frame capture costs. Use THIS for layout questions and inspect_scene_keyframes only when you need to SEE a frame.",
      inputSchema: {
        sceneId: z.string().describe("Scene id from create_or_update_scene"),
        at: z.array(z.number()).optional().describe("Timestamps in ms to measure (default: 4 samples across the scene)"),
        timesMs: z.array(z.number()).optional().describe("Alias of `at`"),
      },
    },
    async ({ sceneId, at, timesMs }) => handleGetLayerBounds({ sceneId, at, timesMs })
  );

  server.registerTool(
    "get_render_status",
    {
      title: "Check a render job's status",
      description:
        "Poll a render job started with render_video { wait: false }. Returns the status (queued / running / succeeded / failed), the progress fraction, and the telemetry once it succeeded.",
      inputSchema: {
        jobId: z.string().describe("Job id returned by render_video"),
      },
    },
    async ({ jobId }) => handleGetRenderStatus({ jobId })
  );

  server.registerTool(
    "get_render_result",
    {
      title: "Get a finished render's result and media metadata",
      description:
        "The finished export of a render job plus its ffprobe metadata — the video and audio streams, their codecs, the resolution, the frame rate, the duration and the bitrate. Use it to verify an export without shelling out.",
      inputSchema: {
        jobId: z.string().describe("Job id returned by render_video"),
      },
    },
    async ({ jobId }) => handleGetRenderResult({ jobId })
  );

  server.registerTool(
    "analyze_scene",
    {
      title: "Analyze a scene's warnings and render cost",
      description:
        "The non-blocking warnings of a stored scene, its estimated PER-FRAME render cost (which features are expensive and by how much), the estimated total render time, and the keyframe precedence — including every layer that carries BOTH the canonical `keyframes` array and the legacy `tracks` array.",
      inputSchema: {
        sceneId: z.string().describe("Scene id from create_or_update_scene"),
      },
    },
    async ({ sceneId }) => handleAnalyzeScene({ sceneId })
  );

  server.registerTool(
    "upload_asset",
    {
      title: "Upload a file into the asset vault",
      description:
        "Put a file into the engine's asset vault so a scene can reference it as `vault:<name>`. Accepts UTF-8 text (an SVG, a Lottie JSON) via contentText, or any binary via contentBase64. With projectPath the file is ALSO written into the project's assets/ tree.",
      inputSchema: {
        name: z.string().min(1).describe("File name with its extension, e.g. logo.svg"),
        kind: z.string().optional().describe("images | video | audio | lottie (inferred from the extension when omitted)"),
        projectPath: z.string().optional().describe("Project root; the file is copied into its assets/ tree too"),
        contentBase64: z.string().optional().describe("The file's bytes, base64"),
        contentText: z.string().optional().describe("The file's bytes as UTF-8 text"),
      },
    },
    async ({ name, kind, projectPath, contentBase64, contentText }) =>
      handleUploadAsset({ name, kind, projectPath, contentBase64, contentText })
  );

  server.registerTool(
    "project_asset_manifest",
    {
      title: "Read a project's asset manifest",
      description:
        "Read a creative project's manifest (motionforge.project.json) and list every asset the project and the engine's vault know about, with their kind and size. Use it before authoring to see which files are already available.",
      inputSchema: {
        projectPath: z.string().min(1).describe("Project root containing motionforge.project.json"),
      },
    },
    async ({ projectPath }) => handleProjectAssetManifest({ projectPath })
  );

  server.registerTool(
    "critique_and_autofix_scene",
    {
      title: "Critique and auto-fix scene",
      description:
        "Autonomous art director: analyzes a stored scene for layout overlaps, safe margin violations, low contrast, dead air frames, visual clutter, timing overflows, and render cost hazards, optionally auto-applying non-destructive fixes and saving the updated scene.",
      inputSchema: {
        sceneId: z.string().min(1).describe("Scene id from create_or_update_scene"),
        autoApplyFixes: z
          .boolean()
          .default(true)
          .describe("Automatically apply non-destructive fixes and save the scene (default: true)"),
        sampleTimesMs: z
          .array(z.number().min(0))
          .max(40)
          .optional()
          .describe("Optional explicit sample timestamps in ms to measure"),
      },
    },
    async ({ sceneId, autoApplyFixes, sampleTimesMs }) =>
      handleCritiqueAndAutofixScene({ sceneId, autoApplyFixes, sampleTimesMs })
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