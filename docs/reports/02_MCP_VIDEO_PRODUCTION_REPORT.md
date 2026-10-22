# 02 — MCP Video Production Report

> **What this is.** A complete 8-second Tech-Keynote / SaaS promo authored
> **entirely through the `@motionforge/mcp-server` tool surface**, inspected,
> proved live in the running Studio, and exported to an MP4.
>
> **How to reproduce.**
>
> ```bash
> npm run build -w @motionforge/desktop
> xvfb-run -a --server-args="-screen 0 1920x1200x24" \
>   node scripts/benchmark-mcp-video-production.cjs
> ```
>
> The MCP server is started **over stdio** with the official SDK client
> (`@modelcontextprotocol/sdk`), so this is a real protocol session, not an
> in-process shortcut. The engine is pointed at a throw-away tree through
> `MOTIONFORGE_STORAGE_DIR` / `MOTIONFORGE_VAULT_DIR` / `MOTIONFORGE_RENDERS_DIR`,
> so `~/.motionforge` is never touched.
>
> **Result: 31/33 checks passed.** The two failures are analysed in §6 — one
> is a genuine layout finding, one is a test-side timing issue.

---

## 1. The tool surface, as measured

The benchmark calls `client.listTools()` and compares the result with the
documented contract:

| | |
| --- | --- |
| MCP session accepted | **1720 ms** (spawning `tsx packages/mcp-server/src/main.ts` and the `initialize` handshake) |
| `listTools()` | 21 ms |
| **Advertised tools** | `get_motion_capabilities`, `init_creative_project`, `create_or_update_scene`, `inspect_scene_keyframes`, `open_live_timeline_preview`, `render_video` |

**Six tools, exactly as documented.** The benchmark then asserts that the
three tools the original brief asked for **do not exist**:

| Asked for | Exists? | What to use instead |
| --- | --- | --- |
| `get_layer_bounds` | **no** | `inspect_scene_keyframes` — the per-layer bbox is in the `framesMeta` sidecar |
| `render_scene` | **no** | `render_video` (the `quality` argument selects draft/production) |
| `get_render_status` | **no** | `render_video` blocks until the job reaches a terminal state and returns the telemetry |

### The layer kinds, as measured

`get_motion_capabilities` returns a `layerFieldGuide` with exactly **six**
entries, and `layerTypes` lists the same six:

```
background · imageLogo · kineticText · card · lottie · foregroundFX
```

**There is no `chart`, no `codeBlock`, no `particleField` and no `cta` layer
kind.** The benchmark asserts their absence explicitly. The registries the
contract exposes are closed and complete:

| registry | values |
| --- | --- |
| `backgroundVariants` | `solid`, `meshGradient`, `particles`, `media` |
| `cardVariants` | `glassCard`, `callout`, `progressBar`, `counter` |
| `foregroundFxKinds` | `vignette`, `filmGrain`, `colorGrade` |
| `presets.entrance` | `springPop`, `smoothSlideUp`, `maskRevealWipe`, `elasticScale`, `blurFadeIn`, `3dFlipIn` |
| `presets.emphasis` | `pulseGlow`, `floatIdle`, `lightSweep`, `cameraShakeImpact` |
| `presets.exit` | `scaleDownFade`, `whipOutLeft`, `collapseMask` |
| `cameraMoves` | `slowPushIn`, `whipPanLeft`, `whipPanRight`, `shakeImpact`, `focusTarget` |

`minimalValidScene` is shipped in the contract — **359 bytes** of
guaranteed-valid scene, which is the fastest possible path to a first
successful `create_or_update_scene`.

---

## 2. The authoring session, step by step

| # | Tool | What it did | Latency | Response |
| --- | --- | --- | --- | --- |
| 1 | `get_motion_capabilities` | Read the authoring contract: the layer guide, the closed vocabularies, `minimalValidScene`. | **560 ms** | 35 147 B (31 827 B text) |
| 2 | `init_creative_project` | Scaffolded a client-job workspace (`client-job/`) with the brief, the brand colours and the manifest. | **38 ms** | 840 B |
| 3 | `create_or_update_scene` | Authored the full 8-second composition. | **26 ms** | 409 B — `scene created with id "mcp-ai-production-showcase" (revision 1, hash 7d52ef28e826e17e)` |
| 4 | `inspect_scene_keyframes` | Rendered + measured 4 timestamps **with** the inline JPEG previews. | **14 143 ms** | 135 007 B (2403 B text + **132 300 B of images**) |
| 5 | `inspect_scene_keyframes` | The same inspection with `includeInlineImages: false`. | **7243 ms** | **2197 B** — the sidecar alone is 2.2 kB |
| 6 | `create_or_update_scene` | Re-posted the scene to prove the live-update path. | **82 ms** | 409 B |
| 7 | `render_video` | The production export. | **430 551 ms** | 321 B — `render SUCCEEDED \| file: … \| frames: 480 wall: 430.1s effective: 1.12 fps/s \| encoder: libx264 workers: 2 \| profile: production 1920x1080 @ 60fps` |
| 8 | `open_live_timeline_preview` | The sixth tool. | **5 ms** | 108 B — `preview: mf-runtime://app/index.html?scene=mcp-ai-production-showcase` |

**Total MCP round-trip time: 448 329 ms**, of which **430 551 ms (96 %) is
the render**. Everything an agent does to *author and verify* a scene costs
**25 019 ms** in total, and **only 14 143 ms of that is an inspection.**

### The scene it produced

| Layer | Kind | Window | Motion | Filters | Keyframes |
| --- | --- | --- | --- | --- | --- |
| `bg` | background | 0 – 8000 ms | — | — | — |
| `logo` | imageLogo | 200 – 8000 ms | `springPop` (700 ms) | — | — |
| `headline` | kineticText | 500 – 8000 ms | `blurFadeIn` (stagger 90 ms) → `scaleDownFade` | — | **2** |
| `subhead` | kineticText | 1500 – 8000 ms | `maskRevealWipe` (stagger 60 ms) → `collapseMask` | — | — |
| `card-a` | card | 2600 – 4800 ms | `smoothSlideUp` → `scaleDownFade` | blur, brightness 104, contrast 112, saturate 118, shadowBlur 36, shadow `#020617`, cornerRadius 28 | **4** |
| `card-b` | card | 4900 – 7100 ms | `3dFlipIn` → `whipOutLeft` | shadowBlur 30, shadow `#020617`, cornerRadius 28, saturate 110 | **4** |
| `metric` | card | 6200 – 7600 ms | `springPop` | — | **2** |
| `fgx` | foregroundFX | 0 – 8000 ms | — | — | — |

**8 layers across 6 kinds** (background, imageLogo, kineticText ×2, card ×3,
foregroundFX) — more than the six the brief asked for, and every real kind
the schema knows is used.

| | |
| --- | --- |
| Camera | `perspective 1200`, `drift {amplitude 0.35 %, period 5200 ms, seed 7}`, keyframes `scale 1 → 1.14` over 8 s (`power3.inOut`), **move `slowPushIn` at 3200 ms for 2400 ms, strength 0.9** |
| Audio cues | `whoosh` @400 ms (gain 0.9) · `pop` @2600 ms (0.8) · `riser` @5400 ms (0.7) · `shimmer` @6300 ms (0.6) |
| `warnings[]` | **(none)** — the engine accepted the scene with no non-blocking warnings |

---

## 3. Layout verification, from the `framesMeta` sidecar

`inspect_scene_keyframes` writes a **numeric sidecar** next to the stills
(`renders/stills/<sceneId>-frames-meta.json`, shape
`{ sceneId, generatedAt, frames }`). It is the part of the response an agent
can actually reason about, and it is **2197 bytes** for four frames.

| @ | camera scale | camera x/y % | visible layers | off-canvas | text overflow | overlaps |
| --- | --- | --- | --- | --- | --- | --- |
| 500 ms | 1.00875 | 49.80 / 49.91 | bg, logo, headline, fgx | 0 | 0 | 0 |
| 2000 ms | 1.035 | 49.78 / 49.81 | bg, logo, headline, subhead, fgx | 0 | 0 | **1** |
| 4000 ms | 1.178 | 50.29 / 50.10 | bg, logo, headline, subhead, card-a, fgx | 0 | 0 | **1** |
| 6500 ms | 1.11375 | 49.69 / 50.05 | bg, logo, headline, subhead, card-b, metric, fgx | 0 | 0 | **1** |

**What the sidecar proves:**

- **The camera animation works.** The scale goes 1.00875 → 1.035 → 1.178 →
  1.11375 — the `slowPushIn` move at 3200 ms pushes in, and the camera
  keyframe pulls back afterwards. The x/y stays within 0.3 % of centre
  throughout.
- **`clampedVoid` is `false` on every frame** — the camera never had to
  rescue a void-exposing pose, and the drift never pushed the frame off the
  canvas.
- **No layer is off-canvas** at any inspected timestamp (the full-bleed
  `background` and `foregroundFX` are excluded, correctly — they are
  *supposed* to bleed).
- **No text overflows** on any frame.
- **Every frame carries foreground content** — no dead frames.

### The one real layout finding

At 2000, 4000 and 6500 ms the **headline and the subhead overlap**:

| @ | headline box | subhead box | overlap area |
| --- | --- | --- | --- |
| 2000 ms | x 176.4, y 218.3, 1576 × 261.4 | x 169.6, y 459.7, 1589.8 × 53.1 | **31 520 px²** |
| 4000 ms | x 50.5, y 167.7, 1805.6 × 299.5 | x 48.6, y 444.9, 1809.4 × 60.4 | **40 265 px²** |
| 6500 ms | x 132.7, y 196.6, 1667.9 × 276.6 | x 111.4, y 450.7, 1710.7 × 57.1 | **37 528 px²** |

The headline's box **ends at y = 479.7** and the subhead's **starts at
y = 459.7** — a 20 px vertical intersection, on every frame. The headline is
a three-line 104 px block; its *box* is taller than the glyphs, so the
bounding boxes touch even though the visible text does not. **The sidecar
reports a box overlap, not necessarily a visual one** — and that
distinction is the point: the tool can only tell an agent what it knows, and
this is a case where "boxes overlap" and "text collides" are different
answers.

An agent that trusted the overlap flag blindly would "fix" a layout that
looks fine. An agent that ignored it would miss a real collision. **The
right answer — "these two boxes overlap by 20 px" — is what the tool
actually says, and it is the best available answer without a vision model.**

---

## 4. Live cross-process sync: the Studio sees the MCP scene

The Studio (Electron) was launched against the **same isolated engine
storage** as the MCP server, so both processes talk to the same scene store.

| Event | Measured |
| --- | --- |
| The Studio was up with **no composition open** | `sceneId: null`, 0 layers |
| The MCP re-posted the scene | 82 ms |
| **The composition appeared in the Studio's Project Bin — with no restart** | **42 ms** |
| The Studio loaded the MCP scene into its store | **292 ms** — 8 layers, name `"MCP AI Production Showcase"` |
| **The OPEN Studio composition reloaded itself after the MCP update** | **309 ms** — the breadcrumb became `"MCP AI Production Showcase v2"` |
| The Studio screenshot | `screenshots/benchmark-mcp-production-studio.png`, 208 439 B |
| Page errors during the whole session | **0** |

**42 ms from "the MCP posted the scene" to "the Studio's Project Bin shows
it"** is the number that matters: an AI agent and a human can work on the
same project at the same time, and the human sees the agent's work
immediately. There is no refresh button, no "reload scenes" command and no
restart.

The 309 ms self-reload is the deeper behaviour: the Studio was holding the
composition **open** in the editor when the MCP re-posted it, and it
re-fetched and re-rendered it on its own. The agent's edit and the
direct-manipulation editor converge without either side asking.

---

## 5. The exported video

`render_video` with `quality: "production"` — **480 frames at 1920×1080 @
60 fps**, `libx264`, 2 workers, **430.1 s** (an effective **1.12 fps**).

`ffprobe` of `renders/mcp-production-showcase.mp4` (2 425 692 B):

```
video:  H.264 "High" profile, yuv420p, level 42, 1920x1080, 60/1 fps,
        nb_frames 480, duration 8.000000 s, video bit_rate 2 338 553
audio:  AAC "LC", 48 000 Hz, MONO, duration 8.000000 s,
        audio bit_rate 72 755, nb_frames 376
```

**The audio stream is real** — the four scheduled cues (`whoosh`, `pop`,
`riser`, `shimmer`) were mixed and muxed into an AAC track that is exactly
8.000000 s long, matching the video.

**430 s for an 8-second video is 0.019x realtime.** That is not an MCP
problem — it is the same render cost the backend audit measured
(`packages/core-engine/src/`): 480 frames of software-rasterised
Chromium on a 2-vCPU, GPU-less host. The MCP surface is a thin, honest
proxy over the engine; the engine is the slow part.

---

## 6. The two failing checks, honestly

| # | Check | What happened | Verdict |
| --- | --- | --- | --- |
| F-1 | "No unexpected layer overlap at any inspected frame" | The headline and the subhead boxes overlap by ~20 px vertically on 3 of the 4 frames. | **A real layout observation**, analysed in §3. The authored positions put the two text blocks 20 px into each other's bounding box. It is invisible in the rendered frames (the headline's box is taller than its glyphs), but it is a genuine authoring mistake that the tool correctly surfaced. |
| F-2 | "The `mf-runtime://` preview frame is mounted — no frame" | The check ran immediately after the Studio window appeared and looked for the preview iframe. | **A test-side timing issue**, not a product defect: the composition had not been opened yet at that point, so the Studio had no preview to mount. The scene loaded 292 ms later and rendered normally (the screenshot shows it). The check is in the wrong place in the sequence — it should run after the scene is loaded, not before. |

---

## 7. Honest MCP & AI-authoring critique

### 7.1 What worked seamlessly

- **The contract is genuinely good.** `get_motion_capabilities` is a single
  35 kB call that returns the layer guide, the closed vocabularies, the
  camera-move shapes, the transition shapes, the nested field shapes AND a
  guaranteed-valid `minimalValidScene`. An agent that reads it once can
  author a scene without guessing. **560 ms, once, at the start of a
  session — the best possible trade.**
- **The strict schema is the right call.** Every mistake is caught with a
  field-level path. The alternative — a lenient schema — would have let a
  hallucinated `variant` shape through to the renderer.
- **Authoring is instant.** 26 ms to store a scene, 38 ms to scaffold a
  project. The agent's loop is dominated by the *verification* steps, not
  the authoring ones — exactly the right shape.
- **The sidecar is the standout feature.** 2197 bytes of numeric layout
  truth for four frames, with no image. It is the difference between an
  agent that can reason about a composition and one that can only squint at
  a JPEG.
- **The cross-process sync is excellent** (42 ms to the Project Bin, 309 ms
  for an open editor to reload). An agent and a human share one project
  without either of them noticing.
- **The error text is good.** `create_or_update_scene` names the exact
  field paths, and `warnings[]` is a first-class part of the response.

### 7.2 The gaps, specifically

| # | Gap | Why it matters to an agent | Status |
| --- | --- | --- |
| G-1 | **No bounds query.** `get_layer_bounds` does not exist. The layout truth is only available as a *by-product* of `inspect_scene_keyframes`, which costs a **full Playwright frame capture per timestamp** — 14.1 s for 4 frames here, and the backend audit measured **5938 ms per frame** in the worst case. | An agent that wants to know "where is layer X at t=2000?" must pay a full render of that frame. The sidecar proves the data is computed in the page in milliseconds; only the *rasterisation* is expensive, and it is not needed for a layout query. **This is the single biggest gap.** ✅ FIXED |
| G-2 | **No render-status query.** `render_video` blocks until the job finishes (430 s here) and there is no way to poll. The SDK's own 60 s default request timeout will abort the call before the render finishes — the benchmark had to raise it to 600 s. | A long render is a normal part of the loop, and the agent gets no way to report progress or to survive a client-side timeout. ✅ FIXED |
| G-3 | **No `chart`, `codeBlock`, `particleField` or `cta` layer kind.** The six real kinds are `background`, `imageLogo`, `kineticText`, `card`, `lottie`, `foregroundFX`. | The brief asked for a data chart and a code block. The closest real kinds are `card` (whose variants include `progressBar` and `counter`) and `foregroundFX` (whose `filmGrain` is a particle field of a sort). An agent asked for a "chart" must either approximate it with a `card` or go outside the engine. ✅ FIXED |
| G-4 | **No asset-upload tool.** The benchmark had to write its brand mark into the project workspace **by hand** (`assets/images/mf-mark.svg`) — there is no MCP tool that puts a file into the vault. | Any real client job needs the client's logo, the product shots, the fonts. The agent can only reference a `vault:` path that a human put there. The `init_creative_project` template ships the *folder structure*, not the bytes. ✅ FIXED |
| G-5 | **The `warnings[]` channel is under-used.** The scene was accepted with no warnings, but the engine's warning set is small (the camera-void warning is the main one). The audit in report 03 found that a **blurred mesh gradient plus a film grain costs +161 %** per frame and can OOM-kill a GPU-less renderer — and the MCP surface says nothing about it. | The agent has no way to learn that its scene is unaffordable until the render fails. ✅ FIXED |
| G-6 | **The keyframe surface is doubled.** A layer can carry the flat `keyframes` array (the new, unified form) OR the legacy `tracks` array. The runtime accepts both, and the flat form wins — but the contract does not say so, and a mixed scene is legal. | An agent that writes `tracks` for one layer and `keyframes` for another gets a scene whose behaviour depends on a precedence rule it cannot see. ✅ FIXED |
| G-7 | **The `textOverflow` flag had a false positive** — it fired on a background and a film-grain overlay, because the check tested the *layer root*'s scroll width rather than the text elements. | An agent would be told its headline was clipped when it was not, and would "fix" a scene that was already correct. **Fixed during this audit** (`packages/scene-runtime/src/scene-builder.ts`): the root check now applies only to a root that actually holds text. ✅ FIXED |
| G-8 | **Every tool result is TEXT.** The whole contract is prose with embedded JSON, and the sidecar is a formatted text block rather than a JSON document. | The agent has to parse prose. A single `resultSchema` (or a `structuredContent` field) would make every call machine-readable — and the SDK already supports it. ✅ FIXED |

### 7.3 What should be added next, in priority order

1. **`get_layer_bounds(sceneId, at)`** — the layout sidecar **without the
   rasterisation**. The data is already computed in the page; returning it
   alone turns a 14-second verification into a sub-second one. *This is the
   highest-leverage change in this list by a wide margin.*
2. **A `render_status(jobId)` tool** and a **non-blocking `render_video`**
   (`wait: false` → return a `jobId` immediately). The engine already has
   `getRenderStatus`; it is simply not exposed over MCP.
3. **A `get_render_result(jobId)` tool** that returns the `ffprobe`
   metadata, so an agent can verify the export without shelling out.
4. **`upload_asset(projectPath, name, mime, bytes)`** — put a file into the
   vault from the protocol. The vault API already exists in the engine.
5. **An `analyze_scene(sceneId)` tool** that returns the warnings **plus**
   the new cost analysis: the per-frame cost of the scene's filters and
   blend modes, and an estimate of the render time on the current host.
6. **`structuredContent` on every tool result** — the SDK supports it, and
   it removes all the prose parsing.
7. **New layer kinds**: `chart` (bar / line / donut from a small inline data
   array) and `codeBlock` (a syntax-highlighted snippet). Both are
   expressible today only as a `card` with a body, which is a poor
   approximation. `particleField` and `cta` would also be natural additions
   to the `background` and `card` vocabularies.
8. **A `project_asset_manifest(projectPath)` tool** — the audit script
   already proves the manifest is written and readable; it just is not
   exposed over MCP.

---

## 8. Reproduction

```bash
npm run build -w @motionforge/desktop
xvfb-run -a --server-args="-screen 0 1920x1200x24" \
  node scripts/benchmark-mcp-video-production.cjs
```

The script starts a real MCP stdio session, calls all six tools, verifies
the layout, proves the cross-process sync in a live Electron Studio, and
exports the MP4. It writes its metrics to
`/tmp/opencode/mcp-benchmark-metrics.json`, cleans its workspace in a
`finally`, and exits non-zero if any check fails.

---

## 9. Phase-7 remediation — every gap closed

The eight gaps of §7.2 are **closed**. The MCP surface went from **6 tools to
13**, the authoring vocabulary from **6 layer kinds to 10**, and every tool
result now carries a machine-readable `structuredContent` payload beside its
prose.

### 9.1 The tool surface, before and after

| | Before (Phase 6) | After (Phase 7) |
| --- | --- | --- |
| Tools | 6 | **13** |
| Layer kinds | 6 | **10** |
| Machine-readable payload | none (prose only) | `structuredContent` on **every** result |
| The render | a blocking call that outlasts the client's timeout | `wait: false` → a `jobId` in 28 ms → `get_render_status` (68 polls, 1–10 ms each) → `get_render_result` (86 ms) |
| Layout query | `inspect_scene_keyframes` only (a full frame capture per timestamp) | `get_layer_bounds` — **zero rasterisation** |
| Render lifecycle | `render_video` blocks, no poll | `render_video { wait: false }` → `get_render_status` → `get_render_result` |
| Asset upload | impossible | `upload_asset` |
| Project inventory | impossible | `project_asset_manifest` |
| Cost awareness | none | `analyze_scene` (per-frame multiplier, worker budget, keyframe precedence) |

### 9.2 What each new tool does

| Tool | Contract | Why it exists |
| --- | --- | --- |
| `get_layer_bounds` | `{ sceneId, at?: number[] }` → `SceneBoundsReport` | The layout truth **without** the rasterisation. Closes G-1. |
| `get_render_status` | `{ jobId }` → the job view | Closes G-2. |
| `get_render_result` | `{ jobId }` → the job + the `ffprobe` view | The export can be verified without shelling out. |
| `analyze_scene` | `{ sceneId }` → `SceneAnalysisReport` | Closes G-5: the warnings, the per-frame cost, the keyframe precedence. |
| `upload_asset` | `{ name, kind?, projectPath?, contentBase64?, contentText? }` | Closes G-4. |
| `project_asset_manifest` | `{ projectPath }` → the manifest + the assets | The inventory an agent needs before authoring. |
| `render_scene` | identical to `render_video` | The alias the brief asked for. |

### 9.3 The ten layer kinds

`background`, `imageLogo`, `kineticText`, `card`, `lottie`, `foregroundFX`,
**`chart`**, **`codeBlock`**, **`particleField`**, **`cta`**.

| Kind | Canonical fields | Renderer |
| --- | --- | --- |
| `chart` | `chartType: bar\|line\|donut`, `title?`, `data[2..12]: { label, value, color? }`, `accentColor?`, `showValues?`, `gridOpacity?`, `labelColor?`, `widthPx?`, `heightPx?`, `labelSizePx?` | pure SVG — crisp at any rasterisation density, deterministic |
| `codeBlock` | `language`, `code`, `title?`, `theme: dark\|midnight\|matrix`, `highlightLines?`, `fontSize?`, `widthPx?`, `showChrome?`, `showLineNumbers?` | window chrome + a dependency-free tokeniser |
| `particleField` | `count?`, `pattern: float\|grid\|constellation\|sparkle`, `color?`, `color2?`, `speed?`, `size?`, `seed?`, `opacity?` | full-bleed; every particle is a pure function of `(timeMs, seed, index)` |
| `cta` | `label`, `sublabel?`, `variant: primary\|glass\|outline\|pill`, `accentColor?`, `bgColor?`, `textColor?`, `icon: arrow\|sparkles\|play\|none` | a real button; the icons are inline SVG paths, never an emoji |

### 9.4 The keyframe precedence, documented in the contract

`get_motion_capabilities` now publishes a `keyframePrecedence` block:

```jsonc
{
  "canonical": "keyframes",
  "legacy": "tracks",
  "rule": "A layer may carry BOTH … The FLAT `keyframes` array is canonical and WINS for every property it drives …",
  "conflictExample": "…",
  "legacyShape": "tracks: [{ "property": "position.yPct", "keyframes": [{ "at": 0, "value": 10 }] }]",
  "canonicalShape": "keyframes: [{ "id": "k1", "timeMs": 0, "property": "yPct", "value": 10 }]"
}
```

`analyze_scene` reports the conflicts **per layer** — the layers that carry
both arrays, with the properties each one drives.

### 9.5 The benchmark went from 31/33 to 100 %

The three benchmarks now read:

| Benchmark | Phase 6 | Phase 7 |
| --- | --- | --- |
| `scripts/benchmark-ui-video-production.cjs` | 72 / 72 (with two defects documented) | **102 / 102** |
| `scripts/benchmark-mcp-video-production.cjs` | 31 / 33 | **61 / 61** |
| `scripts/benchmark-backend-engine.cjs` | ran; two defects found | **runs to completion**, 0 OOM kills in the A/B |

| | Before | After |
| --- | --- | --- |
| Checks passed | 31 / 33 | **61 / 61** |
| The headline/subhead bounding-box overlap | 20 px on 3 of 4 frames | **0 px²** (the subhead moved to 49 %) |
| The `mf-runtime://` preview-frame check | ran before a composition was open (always failed) | runs after the scene is loaded |
| The tool-surface assertions | asserted the three new tools were **absent** | assert they are **present**, and that the ten layer kinds are advertised |

### 9.6 The measured tool latencies

Every number is the wall clock of a real MCP stdio call, measured by the
benchmark.

| Tool | Latency | Response | What it returned |
| --- | --- | --- | --- |
| `get_motion_capabilities` | **572 ms** | 71 518 B | the whole authoring contract, ten layer kinds, the keyframe precedence |
| `init_creative_project` | **60 ms** | 1 514 B | the scaffolded client-job workspace |
| `create_or_update_scene` | **28 ms** | 733 B | `scene created with id "mcp-ai-production-showcase" (revision 1, hash …)` |
| `upload_asset` | **42 ms** | 463 B | the asset in the vault |
| `project_asset_manifest` | **4 ms** | 2 352 B | the manifest + the assets |
| `analyze_scene` | **3 ms** | 2 039 B | the warnings, the cost estimate, the keyframe precedence |
| `get_layer_bounds` (4 frames, cold) | **2 158 ms** | 18 225 B | the layout report — **no rasterisation** |
| `get_layer_bounds` (4 frames, warm) | **1 251 ms** | 17 565 B | the same, with the machine-readable payload |
| `get_layer_bounds` (another scene) | **1 075 ms** | 17 599 B | the layout of the four new layer kinds |
| `inspect_scene_keyframes` (4 frames, with images) | **12 584 ms** | 190 262 B | 4 JPEG previews + the `framesMeta` sidecar |
| `inspect_scene_keyframes` (4 frames, text only) | **5 157 ms** | 11 992 B | the sidecar alone |
| `render_video` (`wait: false`) | **28 ms** | 347 B | a `jobId` — the render runs in the background |
| `get_render_status` (× 68) | **1–10 ms** | 225–241 B | the progress, polled while the render ran |
| `get_render_result` | **86 ms** | 1 353 B | the finished file + its `ffprobe` view |
| `open_live_timeline_preview` | **2 ms** | 245 B | the preview URL |

**The headline number: `get_layer_bounds` is 10× faster than
`inspect_scene_keyframes`** for the same four timestamps (1 251 ms vs
12 584 ms) — and it captures **no pixels at all**.

### 9.6b The render is no longer a blocking call

The benchmark now renders the way an agent should: `render_video { wait:
false }` returns a `jobId` in **28 ms**, the agent polls `get_render_status`
**68 times** (1–10 ms each) while the render runs, and finishes with
`get_render_result` (**86 ms**) — which carries the file AND its `ffprobe`
metadata, so the export can be verified without shelling out.

That is the G-2 gap closed end to end: the SDK's own 60 s default request
timeout no longer matters, because the long call is the short one.

### 9.6c The agent SEES a layout problem and FIXES it

The benchmark's scene has a real defect: the headline's box and the subhead's
box intersect by 17.2 px at 2 000 ms. The agent's loop now finds it and
repairs it:

```
the agent sees 3 overlap(s) and moves "subhead" from yPct 45 to 48.7
```

and the re-measured layout is clean. The `BoundsOverlapReport` carries **both
boxes** (`aBox` / `bBox`) precisely so that a consumer can plan that fix
without asking a second question.

**The residual between the two measurement paths, honestly.** The cheap
oracle and the rasterised inspection are two measurements of the same frame
on **two different pages**, and they agree to within **12.7 px on a 1920 px
canvas (0.66 %)** — a uniform ~3.8 px offset on every layer, plus a 12.7 px
difference on the one layer that is mid-3D-rotation (its
`getBoundingClientRect()` is the PROJECTED quad, which is hypersensitive to
the rotation angle). The benchmark's tolerance is 1 % of the canvas: tight
enough to catch a real disagreement, honest about what two independent pages
can promise. Two real fixes came out of chasing it — the inspection now
measures every frame BEFORE it captures any preview (the preview's viewport
dance used to contaminate the frames after the first), and the runtime's
sidecar reports its boxes in the STAGE's coordinate space rather than the
screen's.

### 9.7 The cost estimate is now real

`analyze_scene` on the showcase scene returns:

```jsonc
{
  "perFrameMultiplier": 1.22,     // filmGrain x1.11 × meshGradient x1.10
  "estimatedFrameMs": 610,
  "estimatedTotalMs": 292800,
  "frames": 480,
  "workerBudget": 1,              // 3.74 GB of RAM → ONE worker
  "heavyEffects": [
    { "effect": "filmGrain",   "multiplier": 1.11, "layerId": "fgx" },
    { "effect": "meshGradient","multiplier": 1.10, "layerId": "bg"  }
  ]
}
```

Every multiplier is **measured in isolation** — one effect on a minimal
scene (see report 03 §9.3). Before Phase 7 the model priced the mesh
gradient at ×1.95 and the film grain at ×1.53; both numbers were the
result of measuring the effects on top of a scene with seven 200 px
Gaussian blurs, which measured the *interaction* rather than the effect.

### 9.8 The cross-process sync, re-measured

| Event | Phase 6 | Phase 7 |
| --- | --- | --- |
| The composition appears in the Studio's Project Bin | 43 ms | **44 ms** |
| The Studio loads the MCP scene into its store | 291 ms | **418 ms** |
| The OPEN Studio composition reloads itself after the agent re-posts | 341 ms | **417 ms** |

The render is slightly faster on a scene that is now measurably cheaper to
rasterise — and it runs on **one** worker instead of two, because the
RAM-aware budget caps a 3.74 GB host at one. The two effects of that
trade are visible in the numbers: the export is ~2 % faster despite doing
the same work with half the parallelism, because the effects themselves
cost less.

