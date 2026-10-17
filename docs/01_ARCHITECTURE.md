# MotionForge — System Architecture

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
