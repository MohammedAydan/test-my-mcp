import { describe, expect, it } from "vitest";
import { TOOL_NAMES, formatRenderSummary } from "../src/index.js";
import type { RenderJobView } from "../src/engine-client.js";

describe("MCP adapter contract", () => {
  it("exposes EXACTLY the 5 protocol tools — no more, no fewer", () => {
    expect(TOOL_NAMES).toEqual([
      "get_motion_capabilities",
      "create_or_update_scene",
      "inspect_scene_keyframes",
      "open_live_timeline_preview",
      "render_video",
    ]);
  });
});

describe("formatRenderSummary", () => {
  const base: RenderJobView = {
    id: "abc123",
    sceneId: "demo",
    quality: "draft",
    status: "succeeded",
    progress: 1,
    result: {
      mp4Path: "/data/renders/draft-demo-abc123.mp4",
      mp4Url: "/api/renders/abc123/file",
      frames: 120,
      wallMs: 5_000,
      effectiveFps: 24,
      encoder: "libx264",
      workerCount: 2,
      profile: { quality: "draft", fps: 30, outWidth: 1280, outHeight: 720, jpegQuality: 80 },
    },
  };

  it("summarizes a successful render with file + telemetry", () => {
    const text = formatRenderSummary(base);
    expect(text).toContain("SUCCEEDED");
    expect(text).toContain("draft-demo-abc123.mp4");
    expect(text).toContain("120");
  });

  it("reports failures with the engine error", () => {
    const text = formatRenderSummary({ ...base, status: "failed", result: undefined, error: "ffmpeg failed (mux audio): x" });
    expect(text).toContain("FAILED");
    expect(text).toContain("mux audio");
  });

  it("reports progress for queued/running jobs", () => {
    const text = formatRenderSummary({ ...base, status: "running", result: undefined, progress: 0.4 });
    expect(text).toContain("running");
    expect(text).toContain("40%");
  });
});
