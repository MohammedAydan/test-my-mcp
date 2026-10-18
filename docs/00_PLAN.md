# MotionForge — Implementation Plan

Status legend: ☐ planned · ◐ in progress · ✅ done

Milestones: **0** workspace + SceneSpec contract · **1** visual canvas ·
**2** engine room · **3** AI surface · **4** creative project kit + visual stabilization.

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

## Milestone 4 — Creative Project Kit & Visual Stabilization
**Goal:** make rendered video visually trustworthy, and make a client job a
first-class artifact an agent can scaffold and run without re-discovering the
workflow every session.

- ✅ **Step 7 — Deterministic frame settlement.** `scene-runtime` now freezes GSAP
  (`lagSmoothing(0)`, `force3D: false`, `nullTargetWarn: false`) and defines the
  frame contract explicitly: seek (`suppressEvents = false`) → per-layer lifecycle
  visibility → media resync → `document.fonts.ready` → image decode → layout flush
  → **two** committed animation frames. Anything less lets a screenshot catch an
  unfinished frame.
  *Acceptance:* ✅ `packages/scene-runtime/tests/visual-stability.test.ts` locks the
  call order, the double-rAF, the frame clamping and the image-decode grace period;
  the demo render still lands exactly 360 frames / 12.00 s at 6.9 effective fps
  (faster than before, because forced-3D promotion is off).
- ✅ **Step 8 — Text fidelity.** Arabic and RTL text is never split per character
  (word/line only, each word in an isolated inline-block span), typography is
  hint-free (`antialiased` / `geometricPrecision` / `font-kerning`), text units carry
  a padding+margin clipping guard for mask-reveal presets, and `.mf-unit` no longer
  keeps a permanent `will-change: transform` (that bitmap was what blurred text when
  the camera scaled it).
  *Acceptance:* ✅ inspected frames of the showcase scene show correctly joined
  Arabic ligatures and crisp glyphs under a 1.2× camera push-in.
- ✅ **Step 9 — Transition & element integrity.** Entrance, emphasis and exit now own
  three nested wrappers (`.mf-entrance` → `.mf-emphasis` → `.mf-exit`), so no two
  presets write the same `transform`/`autoAlpha`; their timeline windows are computed
  non-overlapping by `planMotionSlots`. Logos/icons enforce
  `object-fit: contain; max-width/height: 100%; flex-shrink: 0`; every transition
  overlay is `display: none` until its own `tl.set` at `at`, so nothing bleeds into
  the frames before it; `resetStage()` fully clears the previous scene on rebuild.
  *Acceptance:* ✅ lifecycle visibility is order-independent under non-linear seeks
  (test), and no wipe cover is visible at t=0 in the demo frames.
- ✅ **Step 10 — `templates/creative-project/`.** A complete client-job tree:
  `AGENTS.md`, `README.md`, `motionforge.project.json`, structured `brief/BRIEF.md`,
  `design/*` masters, `brand/*`, `assets/{images,video,lottie,audio}`, `scenes/` with
  validated templates, `renders/`, `exports/`, `logs/`. Empty directories carry a
  `.gitkeep`; explanatory ones carry a `README.md`.
  *Acceptance:* ✅ every shipped scene validates against `scene-spec`; the two
  templates are byte-identical to `MINIMAL_VALID_SCENE` / `SHOWCASE_SCENE_SKETCH`;
  the manifest validates after token substitution.
- ✅ **Step 11 — Agent guidance.** Project-local `AGENTS.md` (hard rules, the 5-tool
  map, disk-sync rule, Arabic rules, definition of done, forbidden actions) and
  `skills/motionforge-creative-project/SKILL.md` (mandatory startup reads, six-step
  checklist).
  *Acceptance:* ✅ both assert the same contract: `minimalValidScene` first, fix the
  exact issue paths, inspect keyframes before any production render, keep disk and
  engine in sync.
- ✅ **Step 12 — Project CLI.** `npm run init-project` (scaffolds, substitutes
  `{{PROJECT_NAME}}`/`{{CREATED_AT}}`/`{{LANG}}`/`{{ENGINE_URL}}`, validates the
  manifest, prints next steps), `npm run sync-scene` (validates locally with the same
  schema, then POSTs, printing the id + preview URL), `npm run pull-render` (downloads
  a finished job into `renders/<quality>/<sceneId>-<timestamp>.mp4`).
  *Acceptance:* ✅ integration tests spawn the real scripts: full tree, all tokens
  substituted, non-empty refusal without `--force` + success with `--force`, exact
  field-level issues for a broken scene with nothing sent to the engine; a live
  end-to-end run (init → sync → draft render → pull) produced a valid MP4 in the
  generated project's `renders/draft/`.

## Milestone 5 — Autonomous AI Project Workflow (MCP 6-Tool Contract)
**Goal:** make the AI agent 100% self-sufficient through MCP from cold start to
final project delivery. Promote project initialization to a 6th MCP tool and add
seamless project disk auto-sync so `scenes/*.json`, `renders/draft|production/*.mp4`,
`renders/stills/*.png`, and `motionforge.project.json` stay automatically synchronized
on disk without manual CLI commands.

- ✅ **Step 13 — `init_creative_project` MCP tool.** The 6th tool in the official
  contract. Scaffolds a complete client-job workspace by copying
  `templates/creative-project/`, substituting tokens (`{{PROJECT_NAME}}`,
  `{{CREATED_AT}}`, `{{LANG}}`, `{{ENGINE_URL}}`, `{{CANVAS_SHAPE}}`,
  `{{CANVAS_SCALE}}`, `{{BRAND_BG}}`, `{{BRAND_ACCENT}}`, `{{BRAND_TEXT}}`),
  validating `motionforge.project.json` and `scenes/scene-01.json` with the
  canonical Zod schemas, and optionally seeding the starter scene into core-engine
  (`autoSeedScene: true`). Returns `projectPath`, validated manifest,
  `initialSceneId`, `previewUrl`, `filesCreatedCount`, and an operational checklist.
  *Acceptance:* ✅ `packages/mcp-server/tests/tools.test.ts` asserts exactly 6 tools,
  tests `init_creative_project` end-to-end including `autoSeedScene: true` and
  non-empty directory protection.
- ✅ **Step 14 — Project disk auto-sync in MCP tools.** All three mutating MCP tools
  gain an optional `projectPath` parameter:
  - `create_or_update_scene`: writes `scenes/<sceneId>.json` + upserts manifest
    `scenes[]` entry with status `"draft"`, returns `savedSceneFilePath`.
  - `render_video`: files the finished MP4 to `renders/<quality>/<sceneId>-<timestamp>.mp4`
    and `renders/<quality>/<sceneId>-latest.mp4`, updates manifest status to the
    render quality, returns `projectRenderFilePath`.
  - `inspect_scene_keyframes`: with `saveStills: true` (default when `projectPath` is
    provided), writes PNGs to `renders/stills/<sceneId>-<atMs>ms.png`.
  *Acceptance:* ✅ core-engine `project-workspace` module unit tests (40+ tests)
  verify disk sync; HTTP routes `POST /projects/init` and `POST /projects/sync`
  provide parity; MCP tool handlers tested with mocked disk operations.
- ✅ **Step 15 — Single source of truth in `core-engine`.** The
  `project-workspace.ts` module is the canonical implementation shared by the MCP
  server (via HTTP to `/projects/init` and `/projects/sync`), the CLI scripts
  (`init-project.mjs`, `sync-scene.mjs`, `pull-render.mjs`), and the HTTP routes.
  No duplicated template-copying or token-replacement logic exists. `createHttpSeeder`
  lets out-of-process callers seed scenes over HTTP.
  *Acceptance:* ✅ CLI scripts refactored to delegate to the shared module; all
  existing CLI integration tests still pass.
- ✅ **Step 16 — Documentation & agent guidance.** Root `AGENTS.md`,
  `templates/creative-project/AGENTS.md`, and `skills/motionforge-creative-project/SKILL.md`
  updated to document the 6-tool contract and the `projectPath` auto-sync workflow.
  `docs/00_PLAN.md` and `docs/01_ARCHITECTURE.md` updated with Milestone 5.
  `README.md` quick-start updated.
  *Acceptance:* ✅ all docs consistent with the 6-tool contract and autonomous
  project workflow.

## Standing constraints (all milestones)
- Zero MCP imports outside `mcp-server`; zero GSAP outside `scene-runtime`.
- Frames stay in memory (no PNG-on-disk pipelines).
- Every schema change bumps `schemaVersion` and updates `docs/02_SCENESPEC.md`.
- No placeholders/TODOs in committed code.
