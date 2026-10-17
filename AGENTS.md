# AGENTS.md — MotionForge Monorepo

Agent-facing operating manual for this repository. Read this before writing any code.
Deep design documents live in [`docs/`](docs/).

## What this repo is

A production-grade **programmatic motion graphics & video engine** with a decoupled
**MCP adapter**, organized as an npm-workspaces monorepo:

```
packages/
  scene-spec/      @motionforge/scene-spec   — Zod SceneSpec schema + TS types (shared contract)
  core-engine/     @motionforge/core-engine  — Fastify API, assets, Playwright frame renderer, FFmpeg encoder, SFX mixer
  scene-runtime/   @motionforge/scene-runtime — Vite + TS + Tailwind + GSAP browser canvas (DOM/SVG/Lottie layers, camera rig, timeline UI)
  mcp-server/      @motionforge/mcp-server   — Thin MCP wrapper exposing exactly 5 tools, talks to core-engine over HTTP
```

## Non-negotiable architectural rules

1. **Dependency direction is one-way:**
   `mcp-server → core-engine → scene-spec` and `scene-runtime → scene-spec`.
   - `core-engine` and `scene-runtime` must have **ZERO knowledge of MCP**. No `@modelcontextprotocol/*` imports outside `packages/mcp-server`.
   - `scene-spec` must have **zero runtime dependencies** except `zod`, and must never import from the other packages.
2. **Declarative, not imperative.** Videos are described by a `SceneSpec` JSON + named
   motion presets. Never hand-roll custom tween math when GSAP v3 already does it
   (timelines, easing, stagger). Presets live in one registry, not scattered inline code.
3. **Deterministic rendering.** The browser runtime exposes `window.renderConfig`,
   `window.seekToFrame(n)`, and awaits `document.fonts.ready` + image decode before a
   frame is considered capturable. No `Date.now()`/`performance.now()`-driven animation paths.
4. **Frames never touch the disk.** Playwright captures JPEG/PNG buffers in memory and
   pipes them into FFmpeg stdin (`-f image2pipe`). SFX are mixed with millisecond `adelay`.
5. **No placeholders.** No `TODO`, no stubbed return values, no mock data committed as
   if functional. If a feature isn't built yet, it doesn't ship in that commit.
6. **The LLM surface is exactly 5 tools** (`get_motion_capabilities`,
   `create_or_update_scene`, `inspect_scene_keyframes`, `open_live_timeline_preview`,
   `render_video`). Do not add more without updating `docs/`.

## Commands

```bash
npm install                      # install all workspaces
npm run build -ws                # build every package
npm run typecheck -ws            # tsc --noEmit everywhere
npm test                         # vitest across packages
npm run dev -w @motionforge/core-engine   # API on :4000
npm run dev -w @motionforge/scene-runtime # Vite preview UI on :5173 (proxies to :4000)
npm run doctor -w @motionforge/core-engine        # toolchain check (ffmpeg, chromium, sfx bank, runtime dist)
npm run smoke -w @motionforge/core-engine         # tiny full-pipeline draft render + ffprobe assertions
npm run demo -w @motionforge/core-engine          # showcase scene: keyframe inspection + draft render
npm run start -w @motionforge/mcp-server          # MCP stdio server (MOTIONFORGE_ENGINE_URL, default :4000)
```

FFmpeg 6.x and (for rendering) Playwright Chromium are expected on the host.
`npm run doctor -w @motionforge/core-engine` verifies the toolchain once implemented.

## Conventions

- **TypeScript strict, ESM only** (`"type": "module"`, `NodeNext` resolution → use `.js`
  extensions in relative imports). Target ES2022, Node ≥ 20.
- **Validation is Zod-first:** every external boundary (HTTP body, MCP tool args, scene
  JSON from the preview) parses through a `scene-spec` schema. Unknown keys are rejected
  (`strict()`), so hallucinated fields surface as errors instead of being silently dropped.
- Files: `kebab-case.ts`; types `PascalCase`; schema objects `camelCase` ending in
  `Schema`; inferred types exported with the same name minus `Schema`.
- Errors: `Fastify` error codes for HTTP; zod `.flatten()` issues for scene validation.
- Design-space convention: all layer geometry is authored against a **1920×1080** (or
  1080×1920 for vertical) canvas and scaled uniformly to the render size.

## Scene-authoring guidance (for LLM-driven scenes)

- **Always start from `get_motion_capabilities().minimalValidScene`.** It is generated
  from the schemas (`scene-spec/src/field-guide.ts`), guaranteed to validate, and is
  the fastest path to a valid scene. Post it as-is if you just need a working baseline.
  `fullShowcaseSketch` is the same idea with every asset-free feature exercised.
- Do not guess structure from field names. Copy shapes from
  `get_motion_capabilities().layerFieldGuide[...]` and read `nestedShapeNotes` — the
  recurring failures are structural, not vocabulary: `background.variant`/`card.variant`
  are **objects** discriminated by `variant`, motion is `entrance/emphasis/exit:
  {name: <preset>}`, positions are `{xPct, yPct}`, sizes use `*Px` keys, times are ms.
  The same guide is available offline as the MCP resource `motionforge://scenespec/v1`.
- When `create_or_update_scene` rejects a scene, the response lists **every** field-level
  issue (`layers.0.variant: Expected object, received string`). Fix exactly those paths
  and re-post — never re-send the same scene hoping for a different result.
- Pick presets from the registry only (`docs/02_SCENESPEC.md` lists all valid names).
  Easing defaults are already professional; override only with intent.
- Budget durations: one idea per 2–4 s; total scenes typically 8–30 s.
- Arabic text: set `direction: "rtl"` on `kineticText` layers; keep numerals LTR inside.
- Reference assets by `assetId`; declare them in `scene.assets`. SFX names come from the
  fixed bank (`whoosh | pop | click | subImpact | shimmer | riser`).
- Validate early and often via `create_or_update_scene`, then eyeball with
  `inspect_scene_keyframes` before spending a production render.

## Where to look / where to add things

| Task | Location |
| --- | --- |
| New layer type / preset / SFX name | `packages/scene-spec/src/**` first, then implement in runtime+engine; update `docs/02_SCENESPEC.md` |
| Authoring guidance shown to LLMs (`layerFieldGuide`, `minimalValidScene`, …) | `packages/scene-spec/src/field-guide.ts` — typed as `SceneSpecInput` and drift-tested; regenerate nothing by hand |
| MCP tool wiring | `packages/mcp-server/src/**` (never drop engine `issues[]`; advertise `sceneShapeSchema`, not a cast raw shape) |
| HTTP route, render pipeline, audio | `packages/core-engine/src/**` |
| Visual layer rendering, timeline UI | `packages/scene-runtime/src/**` |

Changing the `SceneSpec` schema is a **breaking contract change**: bump
`schemaVersion`, keep the old version parsing (or migrate), and update the docs in the
same commit.
