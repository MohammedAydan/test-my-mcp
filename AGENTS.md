# AGENTS.md — MotionForge Monorepo

Agent-facing operating manual for this repository. Read this before writing any code.
Deep design documents live in [`docs/`](docs/).

## What this repo is

A production-grade **programmatic motion graphics & video engine** with a decoupled
**MCP adapter**, organized as an npm-workspaces monorepo:

```
packages/
  scene-spec/      @motionforge/scene-spec   — Zod SceneSpec schema + TS types (shared contract)
  core-engine/     @motionforge/core-engine  — in-process domain core, assets, Playwright frame renderer, FFmpeg encoder, SFX mixer
  scene-runtime/   @motionforge/scene-runtime — Vite + TS + Tailwind + GSAP browser canvas (DOM/SVG/Lottie layers, camera rig, timeline UI)
  studio/          @motionforge/studio      — Solid.js Pro NLE user interface (the desktop shell's renderer)
  desktop/         @motionforge/desktop     — Electron shell hosting EngineCore in the main process
  mcp-server/      @motionforge/mcp-server   — Thin MCP wrapper exposing exactly 6 tools, talks to core-engine in-process
```

> **v3.0 (2026-10-20).** The Studio was rebuilt as a modular Pro NLE. The
> blueprint and the verification ledger live in
> [`docs/redesign/`](docs/redesign/):
> [`00_MASTER_EXECUTION_ROADMAP.md`](docs/redesign/00_MASTER_EXECUTION_ROADMAP.md),
> [`01_BACKEND_AND_SCHEMA_AUDIT.md`](docs/redesign/01_BACKEND_AND_SCHEMA_AUDIT.md),
> [`02_PRO_NLE_DESIGN_SYSTEM.md`](docs/redesign/02_PRO_NLE_DESIGN_SYSTEM.md),
> [`03_MODULAR_COMPONENT_ARCHITECTURE.md`](docs/redesign/03_MODULAR_COMPONENT_ARCHITECTURE.md),
> [`04_LIVE_PROGRESS_LOG.md`](docs/redesign/04_LIVE_PROGRESS_LOG.md).

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
   (Keyframe *inspection* stills are written to disk — they are client deliverables, not
   render frames.)
5. **No placeholders.** No `TODO`, no stubbed return values, no mock data committed as
   if functional. If a feature isn't built yet, it doesn't ship in that commit.
6. **The LLM surface is exactly 6 tools** (`get_motion_capabilities`,
   `init_creative_project`, `create_or_update_scene`, `inspect_scene_keyframes`,
   `open_live_timeline_preview`, `render_video`). Do not add more without updating `docs/`.
7. **Every temporary effect has an In/Out envelope.** Anything that runs over a bounded
   window (emphasis presets, camera moves, transitions) must start at exact identity and
   return to exact identity — see `packages/scene-runtime/src/envelope.ts`. A tween that
   ends on a peak leaves the element stranded and the next frame cuts it.
8. **Never animate layout on text.** `width`/`height` on a text or card element forces a
   re-wrap every frame. Masks animate `clip-path` only.
9. **Every layer accepts the universal spatial set.** `layerBaseSchema` declares
   `position`, `scale`, `rotation`, `opacity`, `visible`, `locked`, `trackIndex` and
   `blendMode` for EVERY layer kind — including the `background` at `layers.0`.
   The Studio writes those properties onto whichever layer the user grabbed, so a
   kind that does not declare them fails every auto-save with
   `Unrecognized key(s) in object: 'position'`.
10. **Normalize, then validate.** `sanitizeSceneInput()` (published from
    `@motionforge/scene-spec`) strips transient `_`-prefixed properties, heals the
    legacy `_hidden`/`_locked` markers into `visible`/`locked`, and clamps the
    spatial numbers into their legal range. BOTH write paths call it:
    `EngineCore.saveScene` and `packages/studio/src/api.ts`. A hallucinated key is
    still a validation error — the sanitizer removes *transient* properties, not
    unknown ones.
11. **Zero emoji, 100% vector SVG.** Every icon in the Studio comes from
    `packages/studio/src/components/icons/NleIcons.tsx`. Unicode emoji are
    forbidden anywhere in the UI or the codebase; `npm run verify:no-emoji` is a
    gate, and the practical verification scans `document.body.innerText` live.
12. **The Studio is a composition of modules.** `packages/studio/src/` is split into
    `state/`, `services/`, `styles/` and `components/{shell,workspace,project-bin,
    hierarchy,monitor,inspector,timeline,export,modals,shared}`. A component owns
    ONE responsibility, reads ONE store slice and talks to the engine through
    `services/engine-bridge.ts`. `App.tsx` is the composition root only.
13. **ONE transform owner, ONE keyframe implementation.** The runtime's
    `scene-runtime/src/transform.ts` is the only thing that writes a layer's
    `transform` / `opacity` / `filter`; the renderers write the anchor
    (`left`/`top`) and nothing else. The keyframe INTERPOLATION lives in
    `@motionforge/scene-spec` (`interpolateKeyframeValue`) so the runtime and the
    inspector can never disagree about a value.
14. **A layer without an explicit `trackIndex` gets its OWN timeline lane.**
    `store.resolveTrackLanes()` is the single grouping authority: two clips
    share a row only when they declare the same lane AND do not overlap.
15. **An icon's path is cloned per instance.** A DOM node can only live in one
    place, so a shared path would paint in its last instance and be blank
    everywhere else — `cloneIconPath()` in `NleIcons.tsx` prevents it.
16. **An automated test NEVER touches the user's workspace.** Every Electron
    harness runs in its own temp workspace
    (`MOTIONFORGE_STORAGE_DIR` / `MOTIONFORGE_VAULT_DIR` /
    `MOTIONFORGE_RENDERS_DIR` / `MOTIONFORGE_DATA_DIR` — see
    `scripts/lib/test-env.cjs`), created before the launch and removed in a
    `finally`. The engine honours those variables through
    `resolveEnginePaths()`, so NO test-only branch is needed in the engine.
17. **The timeline's "fit" means EVERY clip is visible.** The fit targets the
    CONTENT EXTENT (the last clip's end, which may exceed `durationMs`) and
    resets `panOffset`. Note the trap: `pxPerMs = canvasWidth × zoom /
    durationMs`, so `zoom = 1` ALREADY means "the whole duration fills the
    canvas" — setting `zoom = durationMs / canvasWidth` zooms IN and hides
    most of the composition. `applyTimelineFit()` in `TimelinePanel.tsx` is the
    single authority.
18. **The inspector shows the KEYFRAMED value, and edits auto-key.** A
    keyframable field renders the INTERPOLATED value at the playhead (via
    `interpolateKeyframeValue` in `@motionforge/scene-spec` — the same function
    the runtime renders with), and committing an edit to a keyframed property
    writes the keyframe at the playhead (After Effects semantics).

## Commands

```bash
npm install                      # install all workspaces
npm run build -ws                # build every package
npm run typecheck -ws            # tsc --noEmit everywhere (all SIX workspaces)
npm test                         # vitest across packages
npm run dev -w @motionforge/desktop    # the Electron Pro NLE (predev builds the runtime bundle)
npm run dev -w @motionforge/scene-runtime # the runtime canvas alone, on :5173
npm run dev -w @motionforge/studio       # the Studio UI alone, on :5174 (browser fallback bridge)
npm run doctor -w @motionforge/core-engine        # toolchain check (ffmpeg, chromium, sfx bank, runtime dist)
npm run smoke -w @motionforge/core-engine         # tiny full-pipeline draft render + ffprobe assertions
npm run demo -w @motionforge/core-engine          # showcase scene: keyframe inspection + draft render
npm run start -w @motionforge/mcp-server          # MCP stdio server
npm run verify:no-emoji        # static zero-emoji gate over every package source
npm run verify:pro-nle         # practical verification of the REAL Electron app (60 checks)
npm run verify:ux-gizmo        # the v4 UX + transform-gizmo harness (66 checks)
node scripts/cleanup-test-scenes.cjs --dry-run   # list the test scenes in a store
```

> The practical verification needs a display. On a headless host:
> `xvfb-run -a --server-args="-screen 0 1920x1200x24" npm run verify:pro-nle`.

### Creative project kit (client jobs)

```bash
npm run init-project -- --name "client-reel" --path "../jobs/client-reel"   # scaffold a client job
npm run sync-scene   -- --project ../jobs/client-reel --file scenes/scene-01.json
npm run pull-render  -- --project ../jobs/client-reel --jobId <id> --quality draft
npm run sync-template-scenes   # regenerate templates/creative-project/scenes/*.json from scene-spec
```

`templates/creative-project/` is the job template, `skills/motionforge-creative-project/SKILL.md`
is the agent skill, and `scripts/*.mjs` are the CLIs. **The project kit is CLI-only — it
never adds a sixth MCP tool.**

### MCP tool contract (6 tools)

```
get_motion_capabilities  →  init_creative_project  →  create_or_update_scene
                          →  inspect_scene_keyframes  →  open_live_timeline_preview
                          →  render_video
```

| Order | Tool | Purpose |
| --- | --- | --- |
| 1 | `get_motion_capabilities` | the authoring contract (structure + vocabularies) |
| 2 | `init_creative_project` | scaffold a complete client-job workspace (project disk sync enabled) |
| 3 | `create_or_update_scene` | validate + store a SceneSpec; returns the scene id |
| 4 | `inspect_scene_keyframes` | images at exact ms — the quality gate |
| 5 | `open_live_timeline_preview` | interactive scrubber; auto-refreshes on re-post |
| 6 | `render_video` | `draft` while iterating, `production` once approved |

**Autonomous project disk sync.** When `projectPath` is provided to `create_or_update_scene`,
`inspect_scene_keyframes`, or `render_video`, the corresponding files are written to
disk automatically: `scenes/<id>.json`, `renders/stills/*.png`,
`renders/draft|production/*.mp4`, and `motionforge.project.json` all stay in sync
without manual CLI commands.

**Project assets resolve themselves.** A scene stored with a `projectPath` gets its
`vault:` references resolved out of `<projectPath>/assets/{images,lottie,video,audio,…}/`
and `<projectPath>/brand/logo/` automatically — the files are copied into the engine
vault on first use. No manual upload step.

**Scenes survive an engine restart.** `core-engine` persists every scene to
`data/scenes/<sceneId>.json` (atomic temp-file + rename) and hydrates the store on
boot. `create_or_update_scene` returns `{id, status, revision, hash, warnings, previewUrl}`.

**Diagnostics, not guesswork.** `create_or_update_scene` returns non-blocking
`warnings[]` (e.g. `CAMERA_VIEWPORT_EXCEEDS_CANVAS` — a camera that would expose black
void, or a `focusTarget` whose zoom cannot reach its layer), and
`inspect_scene_keyframes` returns a `framesMeta[]` sidecar per timestamp
(camera pose, active transition phase, per-layer lifecycle/opacity/bbox/textOverflow).
Read them before judging a frame.

**Inspection responses must fit in a pipe.** MCP over stdio is a bounded pipe, not a
socket: a twelve-frame inspection at full resolution is ~15 MB of base64, which
overflows the buffer, closes the client end, and kills the server with an unhandled
`write EPIPE`. So the *inline* copies are lightweight JPEG previews (≤960px wide, q75)
and `includeInlineImages: false` drops them for a text-only pass — while the
FULL-resolution PNGs and a `<sceneId>-frames-meta.json` sidecar are still written to
`<projectPath>/renders/stills/`. Never put a full-resolution frame in a tool result.

**The camera cannot show void.** The rig is `translate(xPercent%, yPercent%) scale(S)`,
and because the scale is applied first, the canvas point at the viewport centre is
`50 − xPercent/S`. Two invariants follow, and both are enforced:
centring a point `c` needs `xPercent = (50 − c)·S`, and the frame stays covered only
while `|xPercent| ≤ 50·(S − 1)` (equivalently, a look-at inside
`[50 − 50(1−1/S), 50 + 50(1−1/S)]`). `focusTarget` therefore boosts its zoom until the
target is reachable — or limits the pan when even the cap cannot reach it — and a final
clamp runs on the timeline's own `onUpdate`, i.e. **after** every child tween, so it sees
the pose that is actually rendered. When it has to intervene it sets
`framesMeta.camera.clampedVoid` and reports the requested look-at as
`unclampedXPct`/`unclampedYPct`.

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

## Camera & transitions (the invariants)

- **The camera has exactly ONE writer.** `composeCameraAt(scene, t, ctx)` in
  `camera.ts` is a pure function — `Clamp(Keyframes ⊕ Moves ⊕ Drift ⊕ Stage)` — and
  the timeline's `onUpdate` applies it with `gsap.quickSetter`. Never add a tween
  that writes `rig` scale/translation/rotation: a competing writer is what produced
  the "double-pump" zoom (hold at 1.47× → snap to 1.00 → back to 1.47×). Transitions
  contribute through `stageOffsetAt`, not through rig tweens.
- **`focusTarget` is a nudge, not a zoom solve.** Max `+0.14×` on the current scale
  and a pan capped at 80% of the safe headroom. Use a camera keyframe to actually
  reframe.
- **A move holds its framing into the act cut.** When a transition midpoint falls
  within 1 s after a move's window, the ramp-out is deferred to that midpoint — the
  frame is covered while the release happens.
- **At most one transition at a time** (schema-enforced) and a fully-covered peak
  never longer than ~120 ms (`PEAK_HOLD_MS` = 100 ms target).
- **Act seams are bridged automatically.** `planSeamBridges` holds an outgoing act
  to the transition midpoint and starts an incoming act there. `framesMeta[].foreground`
  lists the visible content layers per frame — an empty list outside a transition
  peak is a defect, and `create_or_update_scene` warns with
  `FOREGROUND_COVERAGE_GAP` when a hole exceeds 200 ms.
- **Mask presets clip the LINE, never a word.** `maskRevealWipe`/`collapseMask`
  drive a single directional clip-path per line container, so a multi-word Arabic
  sentence is never sliced open mid-phrase.
- **`highlight` is one pill per line**, borderless and rounded — not a bordered box
  per word.

## Where to look / where to add things

| Task | Location |
| --- | --- |
| New layer type / preset / SFX name | `packages/scene-spec/src/**` first, then implement in runtime+engine; update `docs/02_SCENESPEC.md` |
| Authoring guidance shown to LLMs (`layerFieldGuide`, `minimalValidScene`, …) | `packages/scene-spec/src/field-guide.ts` — typed as `SceneSpecInput` and drift-tested; regenerate nothing by hand |
| Creative-project manifest schema | `packages/scene-spec/src/project-manifest.ts` (strict Zod; validated by `scripts/sync-scene.mjs`) |
| Client-job scaffolding + CLI | `templates/creative-project/**` and `scripts/*.mjs` (`npm run init-project` / `sync-scene` / `pull-render`) |
| Agent skill | `skills/motionforge-creative-project/SKILL.md` |
| MCP tool wiring | `packages/mcp-server/src/**` (never drop engine `issues[]`; advertise `sceneShapeSchema`, not a cast raw shape) |
| Render pipeline, audio, scene persistence | `packages/core-engine/src/**` |
| Visual layer rendering, the runtime canvas | `packages/scene-runtime/src/**` |
| Zero-port headless serving (preview bundle, scene, vault) | `packages/core-engine/src/renderer.ts` — `setupPlaywrightZeroPortRoutes` |
| Scene sanitizer / normalizer | `packages/scene-spec/src/sanitize.ts` — `sanitizeSceneInput()` |
| Pro NLE design tokens (colour, type, metrics) | `packages/studio/src/styles/tokens.css` |
| A new UI icon | `packages/studio/src/components/icons/NleIcons.tsx` — **never** an emoji |
| The frameless window chrome / window controls | `packages/studio/src/components/shell/TitleBar.tsx` + `packages/desktop/src/{main,preload}.ts` |
| A menu item, a palette entry or a shortcut | `packages/studio/src/services/commands.ts` — ONE registry, three views |
| Studio state and its actions | `packages/studio/src/state/store.ts` |
| The engine bridge (the only IPC caller) | `packages/studio/src/services/engine-bridge.ts` |
| The practical verification | `scripts/test-pro-nle-redesign.cjs` (`npm run verify:pro-nle`) |

Changing the `SceneSpec` schema is a **breaking contract change**: bump
`schemaVersion`, keep the old version parsing (or migrate), and update the docs in the
same commit.

---

## Current State (October 2026)

> **v3.0 — the Pro NLE rebuild landed.** The desktop application layer was
> rebuilt as a modular, frameless Adobe-Premiere-grade NLE. The blueprint is in
> [`docs/redesign/`](docs/redesign/) and the verification ledger is
> [`docs/redesign/04_LIVE_PROGRESS_LOG.md`](docs/redesign/04_LIVE_PROGRESS_LOG.md).

Key points for agents working in this repo:
1. **Engine & CLI pipeline are functional:** the rendering engine, Playwright
   frame capture, FFmpeg export and the MCP tools all work as specified.
2. **The desktop application layer was rebuilt** (the gaps listed in
   [`docs/11_CURRENT_STATE_AUDIT.md`](docs/11_CURRENT_STATE_AUDIT.md) and
   [`docs/12_FEATURE_STATUS_MATRIX.md`](docs/12_FEATURE_STATUS_MATRIX.md) are
   closed):
   - Canvas direct manipulation now transforms the LIVE preview, snaps to smart
     alignment guides, and persists through the engine.
   - The timeline scrolls vertically, zooms on the wheel, packs multi-clip
     tracks, trims with dual handles and splits with the razor tool.
   - Panels are resizable (drag) and maximisable (`` ` `` / double-click).
   - Layers are multi-track (`trackIndex`) and the asset vault drags onto both
     the canvas and the timeline.
3. **Verification is a gate, not a claim:**
   `npm run typecheck` (6 workspaces), `npm test` (496 tests),
   `npm run verify:no-emoji`, `npm run verify:pro-nle` (60 practical checks
   against the real Electron app) and `npm run verify:ux-gizmo` (66 checks)
   must all be green.

