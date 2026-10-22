# CLAUDE.md — AI Coding Agent Operating Brief

## Repository Purpose
MotionForge is a production-grade programmatic motion graphics and video engine with a decoupled Model Context Protocol (MCP) adapter and a desktop Pro NLE (Non-Linear Editor), organized as an npm-workspaces monorepo.

## The Six Workspaces
1. `packages/scene-spec` (`@motionforge/scene-spec`): Zod schemas, TypeScript types, registries, and validators. Shared contract for all packages. Zero runtime dependencies other than `zod`.
2. `packages/core-engine` (`@motionforge/core-engine`): In-process domain core, asset vault, Playwright frame renderer, FFmpeg encoder, and procedural SFX synthesizer.
3. `packages/scene-runtime` (`@motionforge/scene-runtime`): Browser canvas runtime (Vite + TypeScript + GSAP v3 + Tailwind) hosting DOM/SVG/Lottie layers, 2.5D camera rig, and timeline UI.
4. `packages/studio` (`@motionforge/studio`): Solid.js Pro NLE desktop user interface.
5. `packages/desktop` (`@motionforge/desktop`): Electron shell hosting `EngineCore` in the main process.
6. `packages/mcp-server` (`@motionforge/mcp-server`): Thin Model Context Protocol adapter exposing tools over stdio to LLM hosts, invoking `core-engine` directly in-process.

## Enforced Dependency Direction
Strictly one-way:
- `mcp-server -> core-engine -> scene-spec`
- `scene-runtime -> scene-spec`
- No `@modelcontextprotocol/*` imports outside `packages/mcp-server`.
- `scene-spec` never imports from any sibling package.

## Core Architectural Invariants
- **In-Process EngineCore (Zero HTTP Servers):** `mcp-server` and `studio` communicate with `core-engine` directly in-process via `createEngineCore()`. There is no HTTP listener in `core-engine` or `mcp-server`; `EngineConfig.port` is vestigial and the legacy project kit still substitutes an `ENGINE_URL` default into its templates.
- **Single-Chromium 3.8 GB Rule:** The execution environment operates under 2 vCPU and 3.8 GB RAM with no GPU. Software rasterisation is the host default (headless Chromium, no GPU flags requested; launch args: `--disable-lcd-text`, `--font-render-hinting=none`, `--force-device-scale-factor=1`, `--hide-scrollbars`). Strictly **ONE** Chromium process runs at any time. All browser tasks (inspection, layout bounds, rendering) execute sequentially.
- **Single Measurement Authority (`warm-page.ts`):** `get_layer_bounds` and `inspect_scene_keyframes` both query a single persistent warm browser page via `WarmPage.measureFrames()`. Layout queries use `window.seekToFrameForLayout()` and never rasterise.
- **60-Frame Bounded Render Browser:** On hosts with <= 6 GB RAM, heavy rendering splits into chunks of 60 frames (`HEAVY_SCENE_PIXEL_FRAME_BUDGET = 60 * 1280 * 720`). The Playwright browser process is closed and restarted between chunks to release accumulated Skia surfaces and prevent Linux kernel OOM kills.
- **Encoder-Owned Temporal Film Grain:** During video export, the browser runtime skips DOM grain overlay via `?offloadFilmGrain=1`. FFmpeg adds temporal film grain via `noise=c0s=<opacity * 262>:c0f=t+u` and `-tune grain`, preventing static dither quantization.
- **Frames Never Touch Disk:** Playwright captures raw buffers in memory and streams them directly into FFmpeg stdin via `-f image2pipe`. Stills written to disk are strictly inspection deliverables.
- **Zero Emoji:** Unicode emoji are forbidden everywhere across the codebase and documentation. All UI iconography uses 100% vector SVG components from `packages/studio/src/components/icons/NleIcons.tsx`.

## Primary Verification Gate
Before declaring any task or milestone complete, verify all quality gates:
```bash
npm run typecheck -ws          # Typecheck all 6 workspaces
npm run build -ws              # Build all packages
npm test                       # Run test suites across monorepo
node scripts/verify-no-emoji.cjs # Enforce zero-emoji gate
```

## Detailed Documentation & Milestones
- Repository Operating Manual: `AGENTS.md`
- Master Execution Blueprint: `docs/mcp-evolution/00_MASTER_EXECUTION_PLAN.md`
- Live Milestone Progress Tracker: `docs/mcp-evolution/01_PROGRESS_TRACKER.md`
- Machine-Readable Rules: `.cursor/rules/`
- Agent Implementation Playbooks: `.agents/skills/`
