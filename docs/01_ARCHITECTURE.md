# MotionForge — System Architecture

> **⚠️ AUDIT REALITY CHECK (October 2026):**  
> This architecture document details the core headless engine and scene runtime. For the desktop architecture (Electron + Solid.js Studio) and identified UX remediation targets, refer to [`11_CURRENT_STATE_AUDIT.md`](11_CURRENT_STATE_AUDIT.md) and [`plans/DESKTOP_APP_PLAN.md`](plans/DESKTOP_APP_PLAN.md).

## 1. Component overview

```
┌──────────────┐   MCP (stdio)   ┌───────────────┐   HTTP :4000   ┌──────────────────┐
│  LLM / Host  │ ◄──────────────►│  mcp-server   │ ◄────────────► │   core-engine    │
│  (Claude…)   │  5 focused tools│  (thin TS)    │  REST + SSE    │  Fastify + Zod   │
└──────────────┘                 └───────────────┘                └────────┬─────────┘
                                                                           │ serves build of
                                                                           ▼
                                       ┌─────────────────────────────────────────────┐
                                       │ scene-runtime (Vite bundle, served static)  │
                                       │ GSAP masterTimeline · #camera-rig · layers  │
                                       └─────────────────────────────────────────────┘
```

Dependency direction (enforced, one-way):

```
mcp-server ──► core-engine ──► scene-spec ◄── scene-runtime
```

- **`@motionforge/scene-spec`** — pure Zod schemas + inferred types + registries
  (preset names, SFX names, layer kinds, canvas shapes). No side effects, no I/O,
  only dependency: `zod`. This is the single source of truth for what is *possible*.
- **`@motionforge/core-engine`** — Node service (Fastify). Owns: scene storage,
  asset vault, validation endpoint, live preview hosting, Playwright render farm,
  FFmpeg encoding, SFX mixing, render telemetry. Knows nothing about MCP.
- **`@motionforge/scene-runtime`** — browser bundle. Builds DOM/SVG/Canvas/Lottie
  layers from a `SceneSpec`, drives everything from one GSAP `masterTimeline`,
  hosts the 2.5D camera rig and the human-facing timeline scrubber. Knows nothing
  about Node, HTTP polling of render state, or FFmpeg.
- **`@motionforge/mcp-server`** — the *only* package importing
  `@modelcontextprotocol/sdk`. Each tool is a thin proxy: validate args → HTTP call →
  return engine response. No business logic.

## 2. Data flow

### Authoring / preview
1. LLM calls `create_or_update_scene(sceneJson)`.
2. `mcp-server` POSTs to `POST /scenes` on core-engine.
3. Engine parses with `sceneSpecSchema` (strict). On success: stores the scene,
   returns `{ id, version, issues? }`; the preview page (which holds the current
   scene id via query param) is notified over SSE (`GET /scenes/:id/events`) and
   hot-swaps the `masterTimeline`.
4. LLM may call `inspect_scene_keyframes([0.5, 2.0, 4.5])` → engine drives a
   headless page to those exact times and returns JPEG screenshots.

### Rendering
1. `render_video({ sceneId, quality })` → `POST /renders` returns `{ jobId }`.
2. Job runner: split `[0 … totalFrames)` into N contiguous ranges (N = CPU cores,
   capped by pool size). Each range gets a Playwright page pointed at
   `/render?scene=…&from=F0&to=F1`, which exposes deterministic
   `window.seekToFrame(n)` + `window.captureFrame()` (JPEG buffer, DPR locked to 1).
3. Per-worker frames stream as raw buffers into per-worker FFmpeg `stdin`
   (`-f image2pipe -c:v <encoder>`). Worker outputs are concatenated
   (`-f concat -c copy` on fragmented MP4 segments) — no disk frame spillage,
   only small video segments.
4. Audio graph is built independently: music (normalized) + one input per SFX cue,
   each delayed with `adelay={ms}:{channel}`; mixed (`amix`), loudness-normalized,
   muxed onto the video.
5. Response: `{ mp4Path, telemetry: { frames, wallMs, effectiveFps, encoder, workerCount } }`.

### Determinism contract
- One GSAP timeline, `paused: true`; `seekToFrame(f)` → `timeline.seek(f / fps)`,
  then `await document.fonts.ready` + decode of any in-flight media before capture.
- No wall-clock-driven animation anywhere in the runtime (CSS animations and
  Lottie's internal clock are disabled/scrubbed by timeline progress).
- Rendering and preview use identical code paths; "draft" differs only in
  resolution/fps/bitrate/quality presets.

## 3. SFX engine design
- Fixed bank shipped with core-engine: `whoosh, pop, click, subImpact, shimmer, riser`
  (short OGG/MP3 files in `core-engine/assets/sfx/`).
- Cues reach the engine from two sources, normalized to absolute-ms cues:
  1. explicit `scene.audio.cues[]`;
  2. layer shorthand `layer.sfx[]` (offset relative to the layer's `at`).
- Mix recipe per cue: `-i sfx.ogg -af "adelay={t}|{t},volume={gain}"` (pan via
  `pan=` filter when |pan| > 0), then `amix` all cues + music, then
  `loudnorm` normalization so music sits under cues.

## 4. REST API sketch (core-engine, implemented in Step 4)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/capabilities` | registries: layer kinds, presets, SFX, canvas shapes |
| POST | `/scenes` | validate + upsert scene (`?id=`) |
| GET | `/scenes/:id` | current validated SceneSpec |
| GET | `/scenes/:id/events` | SSE: scene updated / render progress |
| POST | `/scenes/:id/keyframes` | body `{ at: number[] }` → screenshots (JPEG data) |
| POST | `/assets` | upload asset → `{ assetId }` (served from vault) |
| POST | `/renders` | `{ sceneId, quality: "draft"\|"production" }` → `{ jobId }` |
| GET | `/renders/:jobId` | status + telemetry + final path |

Preview: `GET /preview?scene=:id` serves the scene-runtime bundle with the
interactive timeline scrubber.

## 5. Failure modes & policies
- **Invalid scene** → 400 with zod `.flatten()` issues; MCP tool surfaces them
  verbatim so the LLM can self-correct. Unknown keys are errors (strict schemas).
- **Missing asset** → validation error at scene-upsert (assetId must exist in vault
  or be declared inline).
- **Render worker crash** → job marked `failed` with worker stderr in telemetry;
  other workers are drained, no partial file published.
- **No hardware encoder** → automatic fallback chain
  `h264_nvenc → h264_videotoolbox → libx264(-preset ultrafast)`, encoder name in telemetry.

## 6. As-built notes (Step 4/6 hardening decisions)

These are decisions that differ from the design sketch above. They exist because
the naive version of each was measured and failed — keep them unless you re-measure.
- **One Chromium per worker, not one browser with N pages.** Headless renderers
  inside a single browser process share raster/GPU threads, so N pages in one
  browser serialize frame capture. Separate browser processes give real
  parallelism (`renderer.ts`, `RendererPool`).
- **Encoder selection is a round-trip probe, not `-encoders` listing.** A driver
  can be installed while encoder init still fails. `pickEncoder` encodes 15
  frames to a temp MP4 with the candidate's real flags, then ffprobes the frame
  count; only a verified encoder is selected, otherwise it falls through. A
  subtle trap this caught: `encoderArgs` must cover every candidate explicitly,
  or the "probe" silently tests a different codec and falsely passes.
- **Worker parts are plain MP4 files (not fragmented).** Fragmented-MP4 parts
  (`frag_keyframe+empty_moov`) concatenated with `-c copy` silently dropped
  frames. Plain MP4 (a real file, so seeking is fine) + concat demuxer is exact.
  `concatParts` hard-fails on any zero-byte part.
- **Audio is clamped, never `-shortest`.** Every chain ends with
  `apad=whole_dur=<scene>` + `atrim=end=<scene>`, so the mix spans the scene
  exactly regardless of source lengths. `-shortest` in the mux step is what
  truncated video to the length of the last SFX tail (2.06 s instead of 12 s).
- **Mux input order is audio-first.** The filtergraph indexes inputs positionally,
  so audio inputs come first and the video input index is computed — otherwise
  every `[N:a]` label is off by one.
- **`/preview` must end in a trailing slash.** The built bundle references
  relative `./assets/*`; without the slash they resolve to `/assets/*` and 404.
  The engine redirects `/preview?...` → `/preview/?...` preserving the query.
- **Stage centering is explicit** (`position:absolute; left/top:50%` +
  `translate(-50%,-50%) scale(s)`). Grid/flex centering of the canvas — which is
  usually *larger* than the viewport — is not dependable across engines and
  silently cropped renders to the top-left quadrant.
- **Staggered text needs a container visibility fix.** Word/char units animate
  their own opacity, so the layer container's initial `autoAlpha: 0` must be
  released at the entrance position, or all text is invisible.
- **Transition overlays declare their initial hidden state.** An overlay whose
  first timeline touch is at `at=7.9s` is visible from t=0 (CSS initial state)
  until that touch — always set the resting state at build time.
- **Asset references resolve `assetId → src → URL`.** The runtime must look the
  id up in `scene.assets`; passing the id straight through as a URL yields a
  broken image (the browser silently shows alt text).
- **MCP must forward Zod issues verbatim — never summarize.** `core-engine` returns
  `{ error, issues[] }` with one entry per field path (`layers.0.variant: Expected
  object, received string`). The MCP adapter converts every `EngineError` into a tool
  result containing the status, the message and one bullet per issue, plus a pointer
  to the authoring guide. A bare `invalid scene` is unusable to the caller: it was the
  root cause of a 42-attempt blind-probing loop in a live session. Regression-locked by
  `packages/mcp-server/tests/tools.test.ts`.
- **Advertise the real schema, not a free-form bag.** `create_or_update_scene` uses
  `sceneShapeSchema` (the structural half of `sceneSpecSchema`, exported separately
  because MCP tool schemas must be a `ZodObject` — a `.superRefine()` wrapper serializes
  to empty properties). Hosts therefore see real field names, discriminated unions and
  `additionalProperties: false`. Note: `normalizeObjectSchema()` in the MCP SDK detects
  raw shapes by duck-typing, so a schema must never be `as`-cast into a shape object —
  that silently advertises `{properties:{}}`. The test asserts the schema contains real
  markers (`meshGradient`, `xPct`, `sizePx`, …).
- **Capabilities must carry STRUCTURE, not only vocabularies.** Registry lists teach
  which names are legal; they do not teach shapes. `get_motion_capabilities` therefore
  also returns `layerFieldGuide`, `nestedShapeNotes`, `minimalValidScene` and
  `fullShowcaseSketch` (see `scene-spec/src/field-guide.ts`).
- **The authoring guide ships as a resource, not a sixth tool.** `motionforge://scenespec/v1`
  is served from `@motionforge/scene-spec` directly, so it works with the engine down.

## 7. Engine monorepo vs creative project workspace

There are two kinds of repository in this system, and they are deliberately
separate:

| | Engine monorepo | Creative project |
| --- | --- | --- |
| Example | this repo | a folder created by `npm run init-project` |
| Contains | `packages/*` source, tests, docs | brief, brand, `scenes/*.json`, renders |
| Owns | the SceneSpec contract, render pipeline | one client job and its deliverables |
| Talks to the engine | is the engine | over HTTP (the 6 MCP tools / REST API) |
| Changes the schema | yes, with a `schemaVersion` bump | never |

The monorepo ships the **contract** (`@motionforge/scene-spec`), the **engine**,
and the **scaffolding** (`templates/creative-project/`, `scripts/*`, the agent
skill). It never ships a client job. A creative project is a consumer workspace
that may live anywhere; its only coupling to the engine is
`motionforge.project.json → engine.url`, and its scenes are validated by the very
same Zod schemas (the CLI imports `@motionforge/scene-spec` to do it, so there is
one validator, not two).

**Rules that keep the boundary clean:**

- The monorepo never imports anything from a creative project.
- A creative project never imports engine internals; it talks HTTP or uses the
  MCP tools.
- Project-kit helpers are **CLI scripts**; the 6th MCP tool is `init_creative_project`,
  which delegates to the same shared implementation in `core-engine`. The contract
  is fixed by `TOOL_NAMES` and a contract test.
- `.psd` / `.aep` / `.ai` / Figma files stay in `design/`; they are masters for
  humans. Only exported PNG/SVG/WebP/Lottie in `assets/` may appear in a
  SceneSpec.

## 9. The 6-tool MCP contract & autonomous project disk sync

The official MCP surface is **exactly 6 tools**:

1. `get_motion_capabilities` — authoring contract (structure + vocabularies)
2. `init_creative_project` — scaffold a complete client-job workspace
3. `create_or_update_scene` — validate + store a SceneSpec
4. `inspect_scene_keyframes` — images at exact ms — the quality gate
5. `open_live_timeline_preview` — interactive scrubber; auto-refreshes on re-post
6. `render_video` — `draft` while iterating, `production` once approved

**Autonomous project disk sync.** When the agent provides `projectPath` (the
directory containing `motionforge.project.json`):

- `create_or_update_scene` writes `scenes/<sceneId>.json` and upserts the manifest
  `scenes[]` entry (status `"draft"`). Response includes `savedSceneFilePath`.
- `render_video` files the MP4 to `renders/<quality>/<sceneId>-<timestamp>.mp4`
  and `renders/<quality>/<sceneId>-latest.mp4`, updates manifest status to the
  render quality. Response includes `projectRenderFilePath`.
- `inspect_scene_keyframes` with `saveStills: true` (default when `projectPath`
  is provided) writes PNGs to `renders/stills/<sceneId>-<atMs>ms.png`.

All three tools delegate to `packages/core-engine/src/project-workspace.ts`,
which is also used by the CLI scripts (`scripts/*.mjs`) and the HTTP routes
`POST /projects/init` and `POST /projects/sync`. There is exactly one
implementation of template copying, token substitution, manifest validation, and
disk sync — zero duplication between CLI and MCP.

**Shared implementation.** `packages/core-engine/src/project-workspace.ts`
exports:
- `initCreativeProject(options, deps)` — scaffold + validate + optional seed
- `syncSceneToDisk(projectPath, scene)` — write scene JSON + upsert manifest
- `saveRenderToDisk(projectPath, sceneId, quality, mp4)` — timestamped + latest
- `saveStillsToDisk(projectPath, sceneId, frames)` — PNGs to renders/stills/
- `createHttpSeeder(engineUrl)` — HTTP seeder for out-of-process callers

The Fastify routes in `core-engine/src/server.ts`:
- `POST /projects/init` — uses the in-process store as seeder
- `POST /projects/sync` — validates + stores + optional disk sync

Both MCP tools and CLI scripts call the same functions via `createHttpSeeder`
when running outside the engine process.

## 10. The effect envelope contract

Every bounded effect in the runtime — an emphasis preset, a camera move, a
transition — is a **window**, and the window has an **envelope**. The contract
is one sentence long:

> A temporary effect starts at exact identity, does its work, and returns to
> exact identity.

`packages/scene-runtime/src/envelope.ts` owns that contract:

| Effect | Envelope |
| --- | --- |
| `pulseGlow`, `floatIdle` | ramp-in (20%, `sine.inOut`) → symmetric yoyo cycles → ramp-out (20%, `sine.inOut`) |
| `lightSweep` | opacity 0→1 (0–20%), `translateX(-110%) → 110%` (0–100%, `power2.inOut`), opacity 1→0 (80–100%) |
| `cameraShakeImpact` | `sin(p·π·n)·(1−p)²` — a snap-in with a quadratic decay to exactly 0 |
| camera moves | ramp-in 28% (`expo.out`) → hold → ramp-out 28% (`expo.inOut`) |
| transitions | 2-phase bell: `0 → peak at 50% → 0 at 100%` |

The yoyo block uses an **even** `repeat` count, which means an *odd* number of
half-cycle traversals — so the block finishes on the peak and the dedicated
ramp-out can close the window symmetrically. The regions always tile the window
exactly (`rampIn + cycles + hold + rampOut === windowSec`), so an effect can never
overrun its own end time. That overrun was the original cause of the visible cut.

Two structural rules follow from the same investigation:

- **Masks never animate layout.** `width`/`height` on a text or card element
  forces the browser to re-wrap the text on every frame, which is how
  `"Render pipeline"` became `"ender pipeline"`. Mask presets animate
  `clip-path` only, and `assertNoLayoutTweening()` throws if one ever does.
- **Filters are dropped, not zeroed.** `blur(0px)` leaves the element on a
  filtered compositor layer; `filter: none` removes it. `blurFadeIn` sets
  `filter: none` the instant the entrance completes.

## 11. Camera safety

The camera is the one system where a legal scene can still look broken, so it
has three independent layers of defence:

1. **Explicit inheritance.** `resolveCameraKeyframes()` expands the keyframe
   chain into fully-resolved poses, each inheriting every omitted field from the
   previous one, starting from the neutral baseline
   `{scale: 1, xPct: 50, yPct: 50, roll: 0, yaw: 0, pitch: 0}`. The runtime
   writes *every* field on *every* tween, so the pose is a pure function of the
   timeline position — not of playback order.
2. **Viewport clamping.** At `scale = s` the visible slice of the canvas is
   `100/s` percent wide, so a look-at point outside `[50/s, 100 − 50/s]` exposes
   black void. `clampCameraPan()` holds the pan inside that range, and the rig
   carries a `mfCameraClamped` flag while it is pressed against the edge.
3. **A warning, not an error.** `core-engine` evaluates the camera across every
   keyframe and move and returns a non-blocking
   `CAMERA_VIEWPORT_EXCEEDS_CANVAS` warning with the exact timestamp, the axis,
   the offending value and the safe range. The scene is still stored — the
   runtime corrects it — but the author learns about it.

## 12. Scene persistence

`SceneStore` is disk-backed. Every upsert writes
`data/scenes/<sceneId>.json` — a self-describing envelope of
`{schemaVersion, scene, revision, hash, updatedAt, projectPath?}` — through a
temp file and a `rename`, which is atomic on POSIX: a reader can never observe a
half-written scene. On boot the store hydrates from that directory, re-validating
every file with the real schema; a file that no longer validates is skipped and
reported, never loaded.

The `hash` is a SHA-256 over a key-sorted rendering of the scene, so two
structurally equal scenes hash identically and a redundant re-post is detected
without a version bump.

## 13. Diagnostics as data

Two responses carry structured diagnostics, because "the render looked wrong" is
not an actionable error message:

- `create_or_update_scene` → `warnings[]` — a stable `code`, the exact `path`
  and a message that says what to change.
- `inspect_scene_keyframes` → `framesMeta[]` — per timestamp: the camera pose
  (with `clampedVoid`), the active transition with its `progressPct` and `phase`
  (`in` / `peak` / `out`), and every visible layer's `lifecyclePhase`
  (`entrance` / `settled` / `emphasis` / `exit`), `phaseProgressPct`, `opacity`,
  bounding box and `textOverflow` flag.

Together they answer the two questions an agent used to have to answer by
eyeballing pixels: *is this frame supposed to look like this?* and *is this
element clipped?*

## 8. Deterministic frame settlement (Milestone 4)

A screenshot taken immediately after `timeline.seek(t)` is **not** frame `t`:
the seek only mutates inline styles, and the compositor paints later. The
runtime therefore defines settlement as a pipeline and refuses to report ready
until every stage has completed (`scene-runtime/src/determinism.ts`):

```
seek(suppressEvents=false) → layer lifecycle → media resync
  → document.fonts.ready → image decode → layout flush → rAF → rAF
```

- `gsap.ticker.lagSmoothing(0)` removes clock compensation entirely: a frame
  index maps to exactly one timeline time, no matter how slow the host is.
- `gsap.config({ force3D: false })` stops GSAP promoting text/SVG into
  composited texture quads, which is what blurred text when the camera scaled it.
  Genuine 3D presets keep working because they declare `rotationY` /
  `transformPerspective` / `transform-style: preserve-3d` explicitly.
- The **second** rAF is not redundant: the first runs the callback, the second
  proves the compositor committed the resulting frame.
- Image decode has a bounded grace period, so a hung asset degrades to
  "capture what is painted" instead of wedging a 60 fps render.
- The order is enforced by a dependency-injected settler, so it is unit-testable
  without a browser.

Layer visibility is recomputed from each layer's `[start, end)` window on **every**
seek (`LayerLifecycle`), never derived from "what was applied last". That is what
makes non-linear seeking (a worker jumping from frame 900 to frame 30) artifact
free.
