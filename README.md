# MotionForge

Production-grade **programmatic motion graphics & video engine** with a cleanly
decoupled **MCP adapter**. Describe a video as declarative `SceneSpec` JSON, preview it
in a browser timeline, and render studio-quality 1080p/4K @ 60fps MP4s with synced SFX —
all deterministic, all driven by GSAP v3.

## Packages (npm workspaces)

| Package | Role |
| --- | --- |
| [`@motionforge/scene-spec`](packages/scene-spec) | Zod schema + TS types for the SceneSpec contract, motion preset & SFX registries |
| [`@motionforge/core-engine`](packages/core-engine) | Fastify service: validation, assets, Playwright frame renderer, FFmpeg encode, SFX mix |
| [`@motionforge/scene-runtime`](packages/scene-runtime) | Browser canvas: layers, 2.5D camera rig, timeline scrubber (Vite + Tailwind + GSAP + Lottie) |
| [`@motionforge/mcp-server`](packages/mcp-server) | Thin MCP adapter exposing exactly 5 tools |

## Documentation

- [`AGENTS.md`](AGENTS.md) — operating manual for coding agents
- [`docs/00_PLAN.md`](docs/00_PLAN.md) — implementation plan & milestones
- [`docs/01_ARCHITECTURE.md`](docs/01_ARCHITECTURE.md) — system design, render pipeline, REST API
- [`docs/02_SCENESPEC.md`](docs/02_SCENESPEC.md) — the SceneSpec reference (for humans and LLMs)

## Quick start

```bash
npm install
npm run typecheck --workspaces --if-present
npm test
```

Requirements: Node ≥ 20, FFmpeg ≥ 6 (Playwright Chromium for rendering).

## Status

Milestone 0 (workspace + SceneSpec contract) is complete — see
[`docs/00_PLAN.md`](docs/00_PLAN.md) for live milestone status.
