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

## Milestone 6 — Field-Run Hardening (Visual Defects + Engine/MCP Findings)
**Goal:** close the defects found in two production field runs (`brand-launch-ar`,
`fintech-launch-ar`) plus the human review of the rendered MP4s: three visual /
animation defect classes, one P0 audio crash, one P0 persistence gap, and the
engine/MCP gaps that made them expensive to diagnose.

- ✅ **Step 17 — Universal In/Out effect envelope** (`scene-runtime/src/envelope.ts`).
  Every bounded effect now starts at exact identity and returns to exact identity:
  a dedicated ramp-in (first 20%), symmetric yoyo cycles (even `repeat` ⇒ an odd
  number of traversals, so the block ends on the peak), and a dedicated ramp-out
  (last 20%). `pulseGlow` and `floatIdle` gained a real glow/displacement that
  unwinds; `lightSweep` became an isolated `mix-blend-mode: screen` overlay with
  pure light stops (the blocky dark band over a `progressBar` is gone);
  `cameraShakeImpact` uses a `sin(p·π·n)·(1−p)²` decay; every camera move gets a
  ramp-in / hold / ramp-out envelope, so `focusTarget` no longer leaves the camera
  parked at 1.45×.
  *Acceptance:* ✅ `packages/scene-runtime/tests/effect-envelopes.test.ts` asserts
  on the **live GSAP timeline** that each emphasis preset is at identity at both
  ends of its window and demonstrably moved in between.
- ✅ **Step 18 — Bell-curve transitions** (`scene-runtime/src/transitions.ts`).
  All four transitions rebuilt as a strict 2-phase bell: `0 → peak at 50% → 0 at
  100%`, with the seam swap hidden under a fully-opaque midpoint. `wipe` covers the
  frame (48–52% hold) with a glowing leading edge; `whipPan` slams to ±45% and
  wraps at the midpoint under peak motion blur; `glitch` steps RGB split and
  slice bars with a flash at the cut; `morph` expands a radial iris with frosted
  blur and contracts cleanly. Every overlay leaves zero residual transforms or
  filters.
  *Acceptance:* ✅ the same test file asserts the bell shape per kind, the live
  overlay visibility, and that the rig transform is clean after the window.
- ✅ **Step 19 — Text reflow lock** (`presets.ts`, `kinetic-text.ts`, `card.ts`).
  Masks animate `clip-path` only — never `width`/`height` — and the runtime
  *asserts* it, so a regression is a thrown error, not a sliced word. `blurFadeIn`
  drops the filter (`filter: none`) the instant the entrance completes, and the
  `.mf-unit` guard gained horizontal padding for the blur kernel. The `highlight`
  pill now lives **inside** the animated word unit, so it cannot appear before its
  glyph. The `progressBar` percentage moved into the card's header row, where a
  camera zoom can no longer clip it.
  *Acceptance:* ✅ unit tests lock the clip-path-only contract, the `filter: none`
  reset, the nested highlight pill and the header-row layout.
- ✅ **Step 20 — Graceful layer auto-exit guard.** A bounded layer that ends well
  before the scene and declares no `exit` now fades out over the last 220 ms of its
  own window instead of being force-hidden in one frame.
  *Acceptance:* ✅ `needsAutoExit` / `autoExitWindow` are unit-tested, including the
  50 ms guard band.
- ✅ **Step 21 — FFmpeg `pan` crash fixed** (P0, report 2 C1/F1). The mixer emitted
  `pan=stereo:c0=…:c1=…`, which FFmpeg parses as AVOptions and rejects
  (`Option not found`), aborting every render with a non-zero `pan`. It now emits
  the filter-graph form `aformat=channel_layouts=stereo,pan=stereo|c0=…|c1=…` with
  constant-power gains, and audio failures name the offending cue.
  *Acceptance:* ✅ a real FFmpeg run renders an MP4 with `pan: -0.6` and
  `pan: +0.75`, and `ffprobe` confirms a stereo AAC stream.
- ✅ **Step 22 — Camera safety, inheritance and framing warnings** (P0, report 1
  4.1/4.2, P0-2/P0-3). Camera keyframes now **explicitly** inherit every omitted
  field from the previous keyframe (baseline `{scale:1, xPct:50, yPct:50, roll:0,
  yaw:0, pitch:0}`), the runtime clamps the pan to the canvas at `scale >= 1`, and
  the engine emits a non-blocking `CAMERA_VIEWPORT_EXCEEDS_CANVAS` warning with the
  exact timestamp, axis and safe range.
  *Acceptance:* ✅ unit tests cover the inheritance chain, the clamp, the warning
  and the safe-range arithmetic.
- ✅ **Step 23 — Disk-backed `SceneStore`** (P0, report 2 C3/F2). Every scene is
  persisted to `data/scenes/<sceneId>.json` (atomic temp-file + rename) with its
  `revision`, `hash`, `updatedAt` and `projectPath`, and the store hydrates from
  disk on boot. `create_or_update_scene` now returns
  `{id, status, revision, hash, warnings, previewUrl, savedSceneFilePath?}`.
  *Acceptance:* ✅ a test stores a scene, builds a **new** store over the same
  directory (a simulated restart) and asserts the scene, revision, hash and
  projectPath all survive.
- ✅ **Step 24 — `framesMeta` inspection sidecar** (P0, report 1 P0-5 / 4.4-4.5).
  `inspect_scene_keyframes` returns a deterministic per-timestamp description:
  the camera pose (+ `clampedVoid`), the active transition with its phase, and
  every visible layer's lifecycle phase, progress, opacity, bounding box and
  `textOverflow` flag. A frame that looks empty can now be *read* as "still
  entering" instead of guessed at.
  *Acceptance:* ✅ MCP tests assert the sidecar is rendered next to the images, and
  a live run against a real engine reports the right phase at every timestamp.
- ✅ **Step 25 — Project asset resolution** (P1, report 1 4.7 / report 2 5.4). A
  scene stored with a `projectPath` gets its `vault:` references resolved out of
  `assets/{images,lottie,video,audio/**}/` and `brand/logo/` automatically; the
  files are copied into the engine vault on first use and never overwrite an
  existing (possibly higher-quality) vault file.
  *Acceptance:* ✅ tests cover resolution, caching, the traversal guard and the
  actionable "searched these directories" message.
- ✅ **Step 26 — Capabilities completeness** (P0, report 1 P0-3, I-2/I-4/I-5/I-6,
  I-12). `get_motion_capabilities` now publishes the engine `version` and
  `buildTimestamp`, the full camera keyframe field table (defaults + safe pan
  range), how each camera move composes with keyframes, the complete parameter
  shape of all four transitions, and the nested `box.chip` / `highlight` /
  `callout` / `progressBar` shapes.
  *Acceptance:* ✅ tests assert every documented field exists and that no
  transition advertises a field its schema would reject.
- ✅ **Step 27 — Logo sizing fix.** An `imageLogo` with no `heightPx` collapsed to
  a **zero-height** box — the absolutely-positioned frame inside it had nothing to
  fill, so the mark was completely invisible. The height is now derived from the
  image's own aspect ratio, measured while the runtime preloads it (deterministic,
  never an `onload` race).
  *Acceptance:* ✅ unit tests cover the derived height, an explicit height and the
  no-intrinsic-size fallback; a live render confirms the logo is visible.
- ✅ **Step 28 — CLI delegation.** `sync-scene` and `pull-render` now call the
  shared `project-workspace` helpers instead of re-implementing the file layout
  and manifest updates, so the CLI and the MCP tool can never diverge.
  *Acceptance:* ✅ a live run of both scripts against a real engine files the
  render, writes the `-latest.mp4` copy and reports the manifest status.

## Standing constraints (all milestones)
- Zero MCP imports outside `mcp-server`; zero GSAP outside `scene-runtime`.
- Frames stay in memory (no PNG-on-disk pipelines).
- Every schema change bumps `schemaVersion` and updates `docs/02_SCENESPEC.md`.
- No placeholders/TODOs in committed code.
