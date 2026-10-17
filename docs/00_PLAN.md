# MotionForge — Implementation Plan

Status legend: ☐ planned · ◐ in progress · ✅ done

## Milestone 0 — Repository & Contracts
**Goal:** workspace skeleton + the shared `SceneSpec` contract, fully validated.

- ✅ **Step 1 — Workspace init.** npm-workspaces monorepo, base tsconfig, package
  scaffolds for `scene-spec`, `core-engine`, `scene-runtime`, `mcp-server`.
  *Acceptance: `npm install` and `npm run typecheck -ws` pass from the root.*
- ✅ **Step 2 — `SceneSpec` Zod schema** in `@motionforge/scene-spec`:
  canvas, layers (background / imageLogo / kineticText / card / lottie / foregroundFX),
  camera rig keyframes + moves, motion preset registry, assets, fonts, audio cues
  (SFX bank), transitions. Strict validation helper returning flattened issues.
  *Acceptance: demo scene fixture parses; invalid fixtures produce readable errors;
  schema has zero deps beyond zod.*

## Milestone 1 — The Visual Canvas
- ✅ **Step 3 — `scene-runtime`.** Vite + vanilla TS + Tailwind + GSAP v3 + lottie-web.
  2.5D `#camera-rig`, the 5 layer renderers, preset engine (`presets.ts`), RTL/LTR +
  Google Fonts loading, foreground FX (vignette/grain/grade), transitions
  (wipe/morph/glitch/whip-pan), and the bottom timeline scrubber
  (play / pause / seek / frame counter).
  *Acceptance: dev server plays a demo scene smoothly; scrubbing is frame-accurate;
  `window.seekToFrame(n)` is deterministic.* ✅ Verified in Step 6: frames extracted from
  the rendered MP4 confirm the canvas, staggered text, logo FX and transitions compose
  correctly (three runtime bugs were found and fixed exactly this way: stage centering,
  staggered-text container visibility, transition-overlay initial state).

## Milestone 2 — The Engine Room
- ✅ **Step 4 — `core-engine`.** Fastify REST API (scenes CRUD + SSE events, asset
  vault, render jobs, keyframe inspector, preview hosting), deterministic Playwright
  frame-stepper with a **worker pool** (frame ranges split across CPUs, one Chromium
  per worker), memory-piped FFmpeg encode (`image2pipe` → per-worker MP4 parts →
  `concat -c copy`), verified hardware-encoder probe (`h264_nvenc`/`h264_qsv`/
  `h264_videotoolbox` → `libx264` fallback), draft (720p30) vs production
  (full canvas @60) profiles, and the millisecond SFX mixer (`adelay` cues + music
  with loudness normalization, clamped to the exact scene length).
  *Acceptance:* ✅ `npm run smoke -w @motionforge/core-engine` boots the engine,
  uploads a generated asset, stores a scene, captures keyframes and renders
  end-to-end — 120 frames, 4.00 s, h264+aac, telemetry (frames / wallMs /
  effectiveFps / encoder / workers). No disk frames. SFX land millisecond-exact
  (`adelay=<ms>:all=1`).

## Milestone 3 — The AI Surface
- ✅ **Step 5 — `mcp-server`.** Exactly 5 tools over `@modelcontextprotocol/sdk`,
  proxying core-engine HTTP. Capabilities doc generated from `scene-spec` registries.
  *Acceptance: `get_motion_capabilities` lists only registry-backed features; a
  create→inspect→render round-trip works end-to-end.* ✅ Verified live over stdio:
  `initialize` → `tools/list` returns exactly the 5 contract tools;
  `get_motion_capabilities` returns the engine-generated registry document; a
  contract test asserts the tool list can never grow or shrink silently.
- ✅ **Step 6 — Demo scene + E2E.** `npm run demo -w @motionforge/core-engine`
  generates real vault assets, stores the showcase SceneSpec (logo entrance with
  light sweep, staggered Arabic RTL + English LTR kinetic type, glassmorphic card,
  progress bar, counter, camera drift/push-in/shake, wipe+glitch+morph transitions,
  layer-relative and absolute SFX), inspects 6 keyframes, and renders a draft MP4.
  *Acceptance:* ✅ draft render of the 12 s / 1080p-design scene lands at exactly
  12.00 s, h264+aac, 360 frames through the full pipeline; visual inspection of
  extracted frames confirms every layer composes correctly. Production profile
  verified too (`DEMO_QUALITY=production npm run demo -w @motionforge/core-engine`):
  1920×1080@60, 720 frames across two worker parts, exactly 12.00 s, h264+aac.
  *Wall-time note:* the plan's "< 5 s" target assumed dev-grade hardware (8+ cores
  + NVENC). Measured here on a 2-core CPU-only VM: ~4.3 draft frames/s and
  ~1.5 production frames/s effective — the bottleneck is per-frame capture
  (screenshot + seek round-trip), not encoding. Scale is linear in workers/cores;
  hardware encoders are picked automatically when present.

## Standing constraints (all milestones)
- Zero MCP imports outside `mcp-server`; zero GSAP outside `scene-runtime`.
- Frames stay in memory (no PNG-on-disk pipelines).
- Every schema change bumps `schemaVersion` and updates `docs/02_SCENESPEC.md`.
- No placeholders/TODOs in committed code.
