# MotionForge

Production-grade **programmatic motion graphics & video engine** with a cleanly
decoupled **MCP adapter**. Describe a video as declarative `SceneSpec` JSON, preview it
in a browser timeline, and render studio-quality 1080p/4K @ 60fps MP4s with synced SFX —
all deterministic, all driven by GSAP v3.

Alongside the engine it ships a **creative project kit**: a template, an agent skill
and three CLI tools that turn any folder into a self-contained client job.

## Packages (npm workspaces)

| Package | Role |
| --- | --- |
| [`@motionforge/scene-spec`](packages/scene-spec) | Zod schema + TS types for the SceneSpec contract, motion preset & SFX registries, authoring field guide, project manifest |
| [`@motionforge/core-engine`](packages/core-engine) | Fastify service: validation, assets, Playwright frame renderer, FFmpeg encode, SFX mix |
| [`@motionforge/scene-runtime`](packages/scene-runtime) | Browser canvas: layers, 2.5D camera rig, timeline scrubber (Vite + Tailwind + GSAP + Lottie) |
| [`@motionforge/mcp-server`](packages/mcp-server) | Thin MCP adapter exposing exactly 5 tools |

## Quick start — engine development

```bash
npm install
npm run typecheck --workspaces --if-present
npm test
npm run doctor -w @motionforge/core-engine
```

Run a full draft render through the pipeline (generates assets, stores a scene,
inspects keyframes, encodes):

```bash
npm run build -w @motionforge/scene-runtime   # required once (engine serves the bundle)
npm run demo -w @motionforge/core-engine
```

Requirements: Node ≥ 20, FFmpeg ≥ 6, Playwright Chromium for rendering.

## Quick start — a client job

The kit lives in this repo and is consumed from anywhere:

```bash
npm run init-project -- --name "client-reel" --path "../jobs/client-reel"
```

That scaffolds a complete MotionForge workspace (brief, brand, asset slots,
validated `scenes/scene-01.json`, render folders, a project-local `AGENTS.md` and a
machine manifest). Then:

```bash
cd ../jobs/client-reel
npm run sync-scene -- --project . --file scenes/scene-01.json   # validate + push
npm run pull-render -- --project . --jobId <id> --quality draft
```

Agents should read `AGENTS.md` in the new project and install the skill
(`skills/motionforge-creative-project/SKILL.md`).

## Documentation

- [`AGENTS.md`](AGENTS.md) — operating manual for coding agents
- [`docs/00_PLAN.md`](docs/00_PLAN.md) — implementation plan & milestones
- [`docs/01_ARCHITECTURE.md`](docs/01_ARCHITECTURE.md) — system design, render pipeline, REST API
- [`docs/02_SCENESPEC.md`](docs/02_SCENESPEC.md) — the SceneSpec reference (for humans and LLMs)
- [`templates/creative-project/`](templates/creative-project/) — the client-job template
- [`skills/motionforge-creative-project/`](skills/motionforge-creative-project/) — the agent skill

## Status

Milestones 0–4 are complete — see [`docs/00_PLAN.md`](docs/00_PLAN.md) for live
milestone status and measured acceptance results.
