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
| [`@motionforge/core-engine`](packages/core-engine) | Fastify service: validation, assets, Playwright frame renderer, FFmpeg encode, SFX mix, **project workspace manager** |
| [`@motionforge/scene-runtime`](packages/scene-runtime) | Browser canvas: layers, 2.5D camera rig, timeline scrubber (Vite + Tailwind + GSAP + Lottie) |
| [`@motionforge/mcp-server`](packages/mcp-server) | Thin MCP adapter exposing exactly **6 tools** |
| [`@motionforge/studio`](packages/studio) | Solid.js + Tailwind desktop editor interface (NLE timeline, inspector, preview overlay) |
| [`@motionforge/desktop`](packages/desktop) | Electron desktop shell packaging the studio and embedding the core engine |

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

## MCP tool contract (6 tools)

```
get_motion_capabilities  →  init_creative_project  →  create_or_update_scene
                          →  inspect_scene_keyframes  →  open_live_timeline_preview
                          →  render_video
```

When `projectPath` is provided to `create_or_update_scene`, `inspect_scene_keyframes`,
or `render_video`, the corresponding files are written to disk automatically:
`scenes/<id>.json`, `renders/stills/*.png`, `renders/draft|production/*.mp4`,
and `motionforge.project.json` all stay in sync without manual CLI commands.

A scene stored with a `projectPath` also resolves its own assets: `vault:`-prefixed
references are looked up in `<projectPath>/assets/{images,lottie,video,audio}/` and
`<projectPath>/brand/logo/`, and copied into the engine vault on first use.

Scenes are persisted to `data/scenes/<sceneId>.json` and reloaded when the engine
restarts. `create_or_update_scene` returns
`{id, status, revision, hash, warnings[], previewUrl}` and `inspect_scene_keyframes`
returns a `framesMeta[]` sidecar (camera pose, live transition phase, per-layer
lifecycle / opacity / bbox / text-overflow) next to the images.

## Documentation

- [`AGENTS.md`](AGENTS.md) — operating manual for coding agents
- [`docs/00_PLAN.md`](docs/00_PLAN.md) — implementation plan & milestones
- [`docs/01_ARCHITECTURE.md`](docs/01_ARCHITECTURE.md) — system design, render pipeline, REST API
- [`docs/02_SCENESPEC.md`](docs/02_SCENESPEC.md) — the SceneSpec reference (for humans and LLMs)
- [`templates/creative-project/`](templates/creative-project/) — the client-job template
- [`skills/motionforge-creative-project/`](skills/motionforge-creative-project/) — the agent skill

## Status

- **Engine & Core Pipeline:** Complete and passing (329/329 tests). Headless rendering, MCP adapter, and CLI workflows are verified.
- **Desktop Application & Studio UX:** Currently in remediation. An exhaustive zero-trust audit conducted in October 2026 identified 11 UX interaction and architecture issues.
  - See [`docs/11_CURRENT_STATE_AUDIT.md`](docs/11_CURRENT_STATE_AUDIT.md) for empirical test results and root causes.
  - See [`docs/12_FEATURE_STATUS_MATRIX.md`](docs/12_FEATURE_STATUS_MATRIX.md) for the verified status of all 39 features.
  - See [`docs/plans/`](docs/plans/) and [`docs/13_NEXT_STEPS.md`](docs/13_NEXT_STEPS.md) for the prioritized remediation roadmap.

