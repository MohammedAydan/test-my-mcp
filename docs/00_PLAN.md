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
- ☐ **Step 3 — `scene-runtime`.** Vite + vanilla TS + Tailwind + GSAP v3 + lottie-web.
  2.5D `#camera-rig`, the 5 layer renderers, preset engine (`presets.ts`), RTL/LTR +
  Google Fonts loading, foreground FX (vignette/grain/grade), transitions
  (wipe/morph/glitch/whip-pan), and the bottom timeline scrubber
  (play / pause / seek / frame counter).
  *Acceptance: dev server plays a demo scene smoothly; scrubbing is frame-accurate;
  `window.seekToFrame(n)` is deterministic.*

## Milestone 2 — The Engine Room
- ☐ **Step 4 — `core-engine`.** Fastify REST API (scenes CRUD, assets, render jobs,
  preview hosting), deterministic Playwright frame-stepper with a **worker pool**
  (frame ranges split across CPU cores), memory-piped FFmpeg encode
  (`image2pipe` → `h264_nvenc`/`h264_videotoolbox`/`libx264 ultrafast` fallback),
  draft (720p30) vs production (1080p/4K @ 60) profiles, and the millisecond SFX
  mixer (`adelay` cues + music with loudness normalization).
  *Acceptance: 10 s 1080p60 demo renders without disk-frame spillage; telemetry
  reports frames, wall time, effective fps, encoder used; SFX land at ±1 frame.*

## Milestone 3 — The AI Surface
- ☐ **Step 5 — `mcp-server`.** Exactly 5 tools over `@modelcontextprotocol/sdk`,
  proxying core-engine HTTP. Capabilities doc generated from `scene-spec` registries.
  *Acceptance: `get_motion_capabilities` lists only registry-backed features; a
  create→inspect→render round-trip works end-to-end.*
- ☐ **Step 6 — Demo scene + E2E.** Logo entrance with light sweep, staggered
  Arabic/English kinetic type, glassmorphic cards, camera zoom, synced SFX.
  *Acceptance: draft render < 5 s wall time; production render passes visual
  keyframe inspection.*

## Standing constraints (all milestones)
- Zero MCP imports outside `mcp-server`; zero GSAP outside `scene-runtime`.
- Frames stay in memory (no PNG-on-disk pipelines).
- Every schema change bumps `schemaVersion` and updates `docs/02_SCENESPEC.md`.
- No placeholders/TODOs in committed code.
