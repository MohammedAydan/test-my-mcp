/**
 * @motionforge/mcp-server — the AI adapter.
 *
 * The ONLY package in the monorepo allowed to import `@modelcontextprotocol/sdk`.
 * Exposes exactly 5 tools (get_motion_capabilities, create_or_update_scene,
 * inspect_scene_keyframes, open_live_timeline_preview, render_video) and proxies
 * every call to core-engine over HTTP. Implemented in Step 5 (docs/00_PLAN.md).
 */
export const PACKAGE_NAME = "@motionforge/mcp-server" as const;
export const PACKAGE_VERSION = "0.1.0" as const;
export const MCP_TOOL_NAMES = [
  "get_motion_capabilities",
  "create_or_update_scene",
  "inspect_scene_keyframes",
  "open_live_timeline_preview",
  "render_video",
] as const;
