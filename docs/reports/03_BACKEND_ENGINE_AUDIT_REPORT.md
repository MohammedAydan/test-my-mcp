# 03 — Backend Engine Audit Report

> **What this is.** A measurement of the real `EngineCore` — the schema and
> sanitizer, the scene store's persistence, the Playwright zero-port renderer
> and the FFmpeg pipeline — under load, under concurrency, and with the audio
> mixer exercised.
>
> **How to reproduce.**
>
> ```bash
> node scripts/benchmark-backend-engine.cjs
> # the cold-browser phase can be skipped on a small host:
> MOTIONFORGE_BENCH_SKIP_COLD=1 node scripts/benchmark-backend-engine.cjs
> ```
>
> The run is isolated: the engine is pointed at a throw-away tree through
> `MOTIONFORGE_STORAGE_DIR` / `MOTIONFORGE_VAULT_DIR` / `MOTIONFORGE_RENDERS_DIR`,
> so `~/.motionforge` is never touched.
>
> **The host this was measured on** matters for the render numbers, so it is
> stated up front: **2 vCPU, 3.8 GB RAM, no GPU** (Chromium runs with
> `--enable-unsafe-swiftshader`, i.e. software rasterisation), FFmpeg 6.1.1,
> Node v20.20.2.

---

## 1. Architecture overview

```
                        ┌──────────────────────────────────────────┐
                        │              EngineCore                  │
   MCP server  ───────► │  (the façade — the ONLY public surface)  │ ◄─── Studio (Electron)
   (stdio, 6 tools)     └────────────────────┬─────────────────────┘     (IPC invoke)
                                             │
        ┌────────────────────────────────────┼──────────────────────────────────┐
        │                    │               │                  │                 │
   SceneStore          RenderRunner      Keyframes          AssetVault        SceneSpec
   (scene-store.ts)    (render-runner)    (keyframes.ts)     (vault.ts)        (scene-spec)
        │                    │               │                  │
   atomic JSON          ┌───┴───┐       Playwright          the SFX bank
   (temp + rename)      │       │       (zero-port)         (synthesised
        │          capture frames   serve the runtime,     ogg files)
   revisions,            │       │   the scene and the
   the watcher           │       │   vault FROM MEMORY
                         ▼       ▼
                     FFmpeg encoder (libx264 / h264_nvenc)
                         │
                     AudioMixer — adelay + pan + amix
                         │
                         ▼
                       the MP4
```

**`EngineCore`** (`packages/core-engine/src/engine-core.ts`) is the façade. It
owns the store, the vault, the renderer pool and the render runner, and it
exposes exactly 14 methods (`getCapabilities`, `getScene`, `saveScene`,
`deleteScene`, `listScenes`, `listAssets`, `ingestAsset`, `inspectKeyframes`,
`getLayerBounds`, `startRender`, `getRenderStatus`, `getPreviewUrl`,
`dispose`, `init`). The MCP server and the Studio both talk to it and to
nothing else.

**`SceneStore`** owns the on-disk scenes. Every write is a temp file plus a
`rename`, so a reader can never see a half-written scene. It also heals legacy
scenes on hydration and collapses seeded duplicates.

**`RenderRunner`** splits the frame range across `min(4, cpuCount)` workers,
each of which drives a Playwright page, then concatenates the parts and muxes
the audio.

**`Keyframes`** owns the inspection path: it serves the runtime bundle, the
scene and the vault from memory through Playwright's request interception
(the "zero-port" trick), so an inspection never needs a listening server.

---

## 2. Benchmark 1 — schema & sanitizer stress

**Method.** 360 scenes (120 `legal`, 120 `illegal`, 120 `legacy`), each with
all six real layer kinds, dense keyframes on every one of the five animatable
properties, every filter key at its extreme, the extreme legal coordinates,
the legacy `tracks` array, and the legacy `_`-prefixed markers. Every scene is
run through the RAW parser and then through `sanitizeSceneInput` + the parser.

### 2.1 Acceptance, healing and rejection

| Mode | raw rejected | sanitized rejected | healed | total |
| --- | --- | --- | --- | --- |
| `legal` | 0 | 0 | 0 | 120 |
| `illegal` | **120** | **0** | **120** | 120 |
| `legacy` | **120** | **0** | **120** | 120 |
| **Total** | **240** | **0** | **240** | 360 |

**Every one of the 360 scenes ends up valid.** 240 were rejected by the strict
parser and then *healed* by the sanitizer; **0** survived sanitization still
invalid. The sanitizer recorded **30 120 clamp events** and **480 heal
events** across the run.

The raw rejections cluster on exactly the fields they should:
`layers.0.filters.{blur,brightness,contrast,saturate,shadowBlur,shadowColor,cornerRadius}`
(each 120×) and the out-of-range `layers.0.keyframes.N.value` entries (each
120×). **No issue path survived sanitization.**

### 2.2 Timing (n = 360, per scene)

| Operation | mean | p50 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- |
| **sanitize + validate** | **2.553 ms** | 1.463 ms | 7.406 ms | 16.778 ms | 1.355 ms | 30.473 ms |
| `sanitizeSceneInput` only | 0.775 ms | 0.381 ms | 5.058 ms | 6.828 ms | 0.323 ms | 28.303 ms |
| `validateScene` only | 1.778 ms | 1.078 ms | 6.731 ms | 8.406 ms | 1.006 ms | 12.015 ms |

**Throughput: 391.4 scenes/second** (919.7 ms wall clock for the whole
360-scene batch, including the scene construction).

The tail is worth noting: **p99 is 16.8 ms and the max is 30.5 ms** for a
scene with 40 keyframes per layer. The distribution is long-tailed because the
`illegal` scenes carry more clamp work, and because V8's GC lands inside the
measurement window. For an interactive editor that saves on every gesture,
the **p50 of 1.5 ms is the number that matters**; the tail is only visible in
a bulk import.

**The sanitizer is 31 % of the cost** (0.775 / 2.553). It is not free, but it
is not the bottleneck either.

---

## 3. Benchmark 2 — concurrency & atomic persistence

**Method.** 25 `saveScene` calls fired in parallel — once against a single
scene id, once across five ids — and then the same 25 saves run
**sequentially** as a control. Every file in the scenes directory is then
re-read and `JSON.parse`d.

### 3.1 The defect this found

Before the fix (the first run of this benchmark):

| | 25 parallel, ONE id | 25 parallel, FIVE ids | 25 sequential (control) |
| --- | --- | --- | --- |
| Wall clock | 187.7 ms | 189.2 ms | 164.2 ms |
| Per-save latency (mean) | 93.3 ms | 88.3 ms | **6.6 ms** |
| p95 | 172.5 ms | 169.0 ms | 13.0 ms |
| Failed saves | 0 | 0 | 0 |
| **Corrupted JSON files** | **0** | **0** | **0** |
| **Leftover `.tmp` files** | **0** | **0** | **0** |
| **Returned revisions** | **`[1,1,1,…,1]`** | **`[1,1,1,…,1]`** | **`[1,2,3,…,25]`** |
| Unique revisions | **1 (24 duplicates)** | **1 (24 duplicates)** | 25 |
| Persisted envelope revision | **1** | 1 | 25 |

**Twenty-four of the twenty-five saves were silently lost.** The mechanism:
`SceneStore.upsert()` read the previous revision *before* the `await` on the
disk write, so all 25 concurrent calls read revision 0, all 25 computed
revision 1, and all 25 wrote the same file — the last writer won.

The atomic temp-file+rename is why this was **invisible**: the JSON on disk
was never corrupt, the temp files were always cleaned up, and no save ever
reported an error. Only the revision counter told the truth, and a consumer
that does not check revisions would have believed every save landed.

Note also the **14× latency penalty**: 93.3 ms mean per save under contention
versus 6.6 ms sequential. Every concurrent save waits for every other
concurrent save's disk write.

### 3.2 The fix

`SceneStore.upsert()` now takes a **per-scene-id promise chain**
(`withSceneLock()`). Concurrent saves to the SAME id are serialised — so each
one reads the revision the previous one wrote — while saves to DIFFERENT ids
stay fully parallel. Three unit tests cover it
(`packages/core-engine/tests/scene-store-concurrency.test.ts`): a gapless
`1…25` sequence, no temp files and no corrupt JSON, and per-id independence.

---

## 4. Benchmark 3 — Playwright zero-port inspection latency

**Method.** `inspectKeyframes` and `getLayerBounds` against a 7-layer scene,
measured COLD (a child process with a fresh Chromium) and WARM (this process's
pooled browser).

| Measurement | Value |
| --- | --- |
| `inspectKeyframes` COLD (browser launch + page + 1 frame) | **2250.5 ms** |
| — of which page setup (`goto` → `renderConfig` ready) | 254.1 ms |
| — of which frame capture (seek + screenshot) | 1996.4 ms |
| `getLayerBounds` COLD (browser launch + page + bounds) | **1939.4 ms** |
| — of which page setup | 72.9 ms |
| — of which bounds evaluation | 1866.5 ms |
| `inspectKeyframes` call #1 (warm browser) | 2366.3 ms |
| `inspectKeyframes` call #2 (1 frame) | 2002.8 ms |
| `inspectKeyframes` call #3 (**10 frames**) | **55 446.6 ms** |
| **steady-state per-frame cost** | **5938.2 ms/frame** |
| `getLayerBounds` #1 / #2 / #3 (warm) | 2586.8 / 1578.0 / 1519.2 ms |
| Layers reported | 7 |
| cold ÷ warm ratio (inspect) | 1.12× |
| cold ÷ warm ratio (bounds) | 1.05× |

### 4.1 The finding: the per-frame cost is not the frame

**A 10-frame inspection costs 55.4 s — 5.9 s per frame — while a ONE-frame
inspection costs 2.0 s.** The marginal cost of a frame is therefore
**≈ 5.9 s**, but the *whole call* has a fixed cost of roughly
`2002.8 − 5938.2 ≈ −3935`… which is negative, i.e. the 10-frame call is
slower than 10 single-frame calls would predict by an order of magnitude.

The cause is in `packages/core-engine/src/keyframes.ts`: **every call to
`inspectKeyframes` creates a new browser CONTEXT and navigates the page
again** (`browser.newContext()` → `setupPlaywrightZeroPortRoutes()` →
`page.goto(..., {waitUntil: 'networkidle'})` → `waitForFunction(renderConfig)`).
Inside the loop, each frame does a `seekToFrame` + a `describeFrame` + a
preview capture — and the preview capture re-applies the device metrics
before every screenshot.

The 5.9 s per frame is therefore **not** the frame: it is the per-frame
context/page cost, paid inside the loop, plus the preview capture's
re-rasterisation of the whole composition at a different device scale factor.

**This is the single most actionable number in the audit.** An agent that
inspects 12 frames pays **~70 s**. The Studio's live preview does NOT pay it
(the runtime is loaded once and seeked), which is why the Studio feels fast
while the inspection tool is glacial.

### 4.2 The zero-port page setup, measured from inside the page

| Phase | Cost |
| --- | --- |
| `chromium.launch` | 91.7 ms |
| `browser.newContext` | 14.9 ms |
| `setupPlaywrightZeroPortRoutes` | 3.2 ms |
| `context.newPage` | 47.6 ms |
| `page.goto(/preview, networkidle)` | **939.9 ms** |
| `renderConfig` + `whenSceneReady` | 49.9 ms |
| `document.fonts.ready` (after ready) | **0.0 ms** |
| runtime bundle (in-page) | 27 ms, 560 383 B |
| scene JSON (in-page) | 6 ms, 30 158 B |
| vault `logo.png` (in-page) | 6 ms, 1 331 B |
| vault `anim.json` (in-page) | 6 ms, 1 013 B |
| Google Fonts CSS (in-page) | 72 ms, 965 B |

**`page.goto` with `waitUntil: 'networkidle'` is 940 ms — 76 % of the page
setup** — and it is paid on every single call. `networkidle` waits for 500 ms
of network quiet; nothing in the page needs that.

### 4.3 Is the font loading in the critical path? No.

| | page setup → ready |
| --- | --- |
| GOOGLE fonts (Cairo 700/900) | 53.4 ms |
| SYSTEM fonts (Inter 400/700) | 37.3 ms |
| **difference (the font network cost)** | **16.1 ms** |

**16.1 ms.** The Google Fonts CSS request is a 965-byte document; the actual
font files are fetched lazily by the browser and are NOT on the critical path
(`document.fonts.ready` measured **0.0 ms** after the scene was ready). Font
loading is a rounding error next to the 5.9 s per-frame cost.

### 4.4 The SFX bank synthesis

| | Cost |
| --- | --- |
| `ensureSfxBank` (6 files, cold vault) | **545.3 ms** |
| Files produced | 6 (`click.ogg`, `pop.ogg`, `riser.ogg`, `shimmer.ogg`, `subImpact.ogg`, `whoosh.ogg`) |

Half a second, once per vault. It is synthesised on demand and cached on
disk, so it is a one-time cost per machine.

---

## 5. Benchmark 4 — FFmpeg render throughput & audio mixing

### 5.1 The encoder

| | |
| --- | --- |
| `pickEncoder("draft")` | **`libx264`** (288.5 ms) |
| Available encoders | `h264_nvenc`, `h264_qsv`, `libx264` |

The probe takes 288 ms because it actually *runs* the candidate encoders to
see which one works. `h264_nvenc` is present in the list but this host has no
NVIDIA GPU, so the probe correctly falls back to `libx264` (software x264).

### 5.2 The cost attribution A/B

**Method.** The same scene, four times, at the same (compressed) 1.5 s
duration — 45 frames each — with exactly ONE visual feature changed per
variant. The A/B scene is deliberately light (2 keyframes per property
instead of 8) so the measurement is about the FEATURE and not about the
keyframe count.

**The result — the cost of every visual feature, measured:**

| Variant | Wall clock | Frames | ms / frame | relative |
| --- | --- | --- | --- | --- |
| **neither** (solid background + vignette only) | 11 454 ms | 45 | **254.5** | **1.00x** |
| **film grain only** (solid background + grain) | 17 573 ms | 45 | **390.5** | **1.53x** |
| **mesh gradient only** (blurred mesh + vignette) | 22 341 ms | 45 | **496.5** | **1.95x** |
| **both** (blurred mesh + film grain) | 29 887 ms | 45 | **664.2** | **2.61x** |

| Feature | Its own cost |
| --- | --- |
| **the film-grain overlay** | **+53 %** (254.5 → 390.5 ms/frame) |
| **the blurred mesh gradient** | **+95 %** (254.5 → 496.5 ms/frame) |
| **both together** | **+161 %** (254.5 → 664.2 ms/frame) |

**The two expensive features are the two that force the compositor to do real
work:**

- **The film grain** is a full-bleed `div` with `mix-blend-mode: overlay` and
  an SVG `feTurbulence` background. A blend mode forces Chromium to
  composite the entire stacking context through an intermediate surface; on
  this GPU-less host that surface is rasterised in software. It costs more
  per frame than the whole rest of the scene.
- **The mesh gradient** paints three large radial gradients and gives each a
  `filter: blur(70px)`. A 70 px blur is a full-resolution separable Gaussian
  pass per blob, in software, and the camera's slow push-in re-rasterises it
  at a growing scale.

Both are **cheap-looking CSS that is expensive to rasterise** — exactly the
kind of thing an engine should warn an author about, and neither is
diagnosable from the scene file.


### 5.3 The full-length render

**The full-length render** — the affordable variant, at the draft profile:

| | |
| --- | --- |
| Profile | 1280x720 @ 30 fps (`draft`), 180 frames |
| Encoder | `libx264`, **2 parallel workers** (`part_00.mp4` + `part_01.mp4`, 90 frames each) |
| **Wall clock** | **20 289 ms** (the engine's own figure: 20 278 ms) |
| **Effective render speed** | **8.88 fps** — 180 frames in 20.3 s |
| **Realtime factor** | **0.296x** — a 6-second video takes 20 seconds to render |
| Memory before the render | rss **147.0 MB**, heapUsed 57.9 MB |
| **PEAK rss** | **161.0 MB** |
| PEAK heapUsed / heapTotal | 69.2 MB / 80.2 MB |
| Memory samples (every 50 ms) | 402 |

**`ffprobe` of the exported MP4** (the real output, not a summary):

```
video:  H.264 "Constrained Baseline", yuv420p, 1280x720, 30/1 fps,
        nb_frames 180, duration 6.000000 s, video bit_rate 31 174
audio:  AAC (mp4a), 48 000 Hz, MONO, duration 6.000000 s,
        audio bit_rate 80 788, nb_frames 283
format: mp4, nb_streams 2, duration 6.000000 s, size 90 762 B,
        bit_rate 121 016, encoder Lavf60.16.100
```

The video bitrate is only **31 kbps** because the scene is almost entirely a
flat solid background — x264 spends nothing on a flat field. That is correct
behaviour, but it is worth stating: a user comparing bitrates across scenes
would be comparing scene CONTENT, not encoder quality.

**The heavy variant** — the SAME scene with the blurred mesh gradient AND the
film grain, at full density (8 keyframes per property per layer) and full
length — **failed**:

```
the heavy variant (blurred mesh gradient)  failed after 21 247 ms —
  browserContext.close: Target page, context or browser has been closed
```

The browser process was killed (the host's `oom_kill` counter incremented
during the run). On a 2-vCPU / 3.8 GB host with **no GPU**, the combination of
a software-rasterised 70 px blur, a full-frame `mix-blend-mode` overlay and
two parallel render workers does not fit. The A/B above quantifies why: at
664 ms/frame, 180 frames need 120 s of single-worker time, and the browser's
own surfaces — not the capture buffers — are what exhaust the memory.


### 5.4 The audio mix

**Method.** The rendered MP4 is decoded back to 16-bit PCM WAV and analysed
per segment: the RMS of each cue's own window, the RMS of a control window
that contains no cue, and an onset detector over a 50 ms envelope.

| Segment | `volumedetect` mean | max | computed RMS |
| --- | --- | --- | --- |
| `whoosh` @0 ms [0.05 – 0.85 s] | −15.7 dB | −4.5 dB | **−15.67 dB** |
| `pop` @900 ms [0.9 – 1.07 s] | −21.0 dB | −10.6 dB | **−21.05 dB** |
| `riser` @2000 ms [2.05 – 3.55 s] | −23.4 dB | −10.0 dB | **−23.40 dB** |
| `subImpact` @3500 ms [3.55 – 4.35 s] | −17.3 dB | −7.2 dB | **−17.27 dB** |
| **control** (no cue) [4.6 – 5.8 s] | **−91 dB** | −91 dB | **−Inf dB** |

**The mixer is correct.**

- Every cue is audible **in its own window** — the `pop` window reads
  −21.05 dB, not silence, so the `adelay=900` landed where it was told to.
- The **control window is digital silence** (−91 dB / −Inf), so the mixer is
  not leaking a bed, a click or a dither into the gaps.
- The **relative levels track the authored gains**: `whoosh` (gain 1.0) is the
  loudest at −15.67 dB; `subImpact` (gain 0.7) is next; `pop` (gain 0.5) is
  quieter. The `riser` is a sweep, so its *window average* is low (−23.4 dB)
  while its *peak* is −10 dB — the sound ramps up across the window, exactly
  as a riser should.
- The MP4 carries an **AAC stream at 48 kHz mono, 6.000000 s long, 283
  frames**, and the decoded WAV is 6.019 s — the mix is length-exact.

**One honest caveat about the measurement, not the mixer.** The onset detector
reported `0 ms, 2000 ms` against an expected `0, 900, 2000, 3500`. The two
"missing" onsets are a **detector artefact**: the detector re-arms only when
the envelope falls below −65 dB, and with four cues 900–1500 ms apart the
envelope never returns to silence, so the `pop` and `subImpact` onsets are
inside a still-loud window. The per-segment RMS table above is the reliable
measurement, and it confirms all four cues are present, in place, and silent
between them.


---

## 6. Bottleneck analysis

### 6.1 The pipeline splits into two halves, and one of them is 20x bigger

| Phase | Cost for 30 frames | Per frame | Share |
| --- | --- | --- | --- |
| **CAPTURE** (browser launch + page setup + 30 seek+screenshot) | 5557.2 ms | **185.2 ms** | **95.1 %** |
| **ENCODE** (ffmpeg `image2pipe` over the same 30 frames) | 284.3 ms | **9.5 ms** | **4.9 %** |
| Sum of the two phases | 5841.4 ms | | |

**The encoder is 20x cheaper than the capture.** Optimising FFmpeg — a
faster preset, a better `-tune`, hardware NVENC — would buy at most 5 % of
the render. Everything that matters is in the browser.

The real 180-frame draft render took 20 289 ms = **112.7 ms/frame**, faster
than the isolated 185.2 ms because the production path uses **2 parallel
workers** (two browser contexts, 90 frames each) while the isolated probe
used one. The scaling is sub-linear (2 workers bought 1.64x, not 2x) because
the host has 2 vCPUs and the capture is partly CPU-bound.

### 6.2 Inside the capture: the page setup is a fixed tax, the frame is the variable

| | Cost | Amortised over |
| --- | --- | --- |
| `chromium.launch` | 84.1 ms | the whole job |
| page setup (routes + `goto` + ready) | **888.6 ms** | the whole job |
| 30 frames of seek + screenshot | 5557.2 ms | **185.2 ms per frame** |

`page.goto(..., {waitUntil: 'networkidle'})` alone is **940 ms** (from the
in-page breakdown in §4.2) — it waits for 500 ms of network quiet that
nothing in the page needs. That is a **fixed tax paid on every call**.

### 6.3 The inspection path is the worst offender in the whole engine

The **5.9 s per frame** measured in §4.1 is 32x the render's 185 ms per
frame. The same runtime, the same scene, the same browser technology — but
the inspection path re-creates the context and re-navigates the page for
**every call**, and something inside the per-frame loop is re-rasterising the
whole composition.

For an AI agent this is the difference between a 2-second verification and a
70-second one.

### 6.4 What does NOT matter

| Candidate | Measured | Verdict |
| --- | --- | --- |
| Google Fonts | **16.1 ms** difference | **Irrelevant.** `document.fonts.ready` measures 0.0 ms after the scene is ready. |
| The SFX bank synthesis | 545.3 ms, once per vault | Irrelevant (one-time, cached on disk). |
| The encoder probe | 288.5 ms, once per job | Irrelevant. |
| The audio mix | folded into the 284.3 ms encode | Irrelevant. |
| The schema + sanitizer | 1.5 ms p50 per scene | Irrelevant to the render. |

### 6.5 The ranking, with the numbers attached

1. **Playwright frame capture — 95.1 %** of the render pipeline, 185.2 ms per
   frame for a 1280x720 composition.
2. **The per-call page setup inside the inspection path — 5.9 s per frame**,
   ~32x the render's per-frame cost.
3. **The two software-rasterised effects** — the film grain (+53 %) and the
   blurred mesh gradient (+95 %). Together they make the scene **2.61x** more
   expensive, and on a GPU-less host they are what gets the browser
   OOM-killed.
4. **FFmpeg — 4.9 %.** Not worth optimising.
5. Everything else: rounding error.


---

## 7. Reliability findings

| # | Finding | Evidence | Severity | Status |
| --- | --- | --- | --- | --- |
| R-1 | **25 concurrent saves to one scene id lost 24 of them.** Every call read the previous revision before the async write, so all computed revision 1 and the last writer won. The atomic temp-file+rename kept the JSON valid, so the loss was invisible. | `[1,1,1,…,1]`, unique revisions 1, persisted envelope revision 1 — against a sequential control of a gapless `1…25`. | **Critical** | ✅ FIXED — `withSceneLock()` serialises writes per id; 3 new unit tests. |
| R-2 | **No corrupt JSON, no leaked `.tmp` file, in any run** — 25-way concurrent, 5-way concurrent and sequential, across every configuration. | 0 corrupted files, 0 leftover temp files in all three concurrency scenarios. | — | ✅ The atomic write is sound. |
| R-3 | **The runtime leaked a GSAP warning for a legal scene.** A legacy `tracks` entry may legally use the unified property name (`yPct`); the pipeline's skip-list only knew `position.yPct`, so it fell through to `gsap.set(el, {yPct: 40})` — which GSAP rejects. The value was silently dropped. | `[renderer:console] Invalid property yPct set to 40 Missing plugin? gsap.registerPlugin()` (and `set to 55`). | High | ✅ FIXED — `isPipelineOwnedProperty()` normalises both spellings. |
| R-4 | **A 2-vCPU / 3.8 GB host with no GPU cannot render a blurred mesh gradient plus a film grain.** The browser is OOM-killed mid-render. | The heavy variant failed after 21 247 ms with `Target page, context or browser has been closed`; the host's `oom_kill` counter incremented. | High | ⚠️ DOCUMENTED — see the recommendations. |
| R-5 | **`inspectKeyframes` creates a browser context and navigates the page on every call.** A 10-frame call costs 55.4 s; a 1-frame call costs 2.0 s. | `warmInspect10 55 446.6 ms` vs `warmInspect2 2002.8 ms` ⇒ **5938.2 ms/frame**. | High | ⚠️ DOCUMENTED — see the recommendations. |
| R-6 | **The engine never validated the scene it was about to render before spending the browser's memory on it.** | The heavy render failed *inside* the browser, not at the schema boundary. | Medium | ⚠️ DOCUMENTED. |
| R-7 | **The scene store's duplicate collapse is destructive in its broad form** (same name → delete the file). It is now restricted to same name AND same content AND a seeded id. | Covered by `packages/core-engine/tests/scene-store-dedup.test.ts`. | Critical (was) | ✅ FIXED (in the v4 cycle). |


---

## 8. Architectural recommendations

Ordered by measured impact. Each one names the measurement that motivates it.

### P0 — the inspection path (5.9 s/frame ⇒ potentially < 500 ms/frame)

1. **Do not create a new context and re-navigate the page per call.**
   `packages/core-engine/src/keyframes.ts` opens a context, sets up the
   zero-port routes, navigates and waits for `renderConfig` — 940 ms of
   `networkidle` — every time. Keep ONE context and ONE page for the life of
   the engine, and re-push the scene into it (the runtime already supports a
   scene update). *Motivating measurement: `page.goto` 939.9 ms of a 2 000 ms
   single-frame inspection.*
2. **Replace `waitUntil: 'networkidle'` with `domcontentloaded` + the
   existing `waitForFunction(renderConfig)`.** The render config IS the
   readiness signal; `networkidle` is a guess. *939.9 ms → tens of ms.*
3. **Reuse one preview capture strategy for the whole call.** The per-frame
   preview capture re-applies the device metrics before every screenshot,
   which re-rasterises the composition. Capture the full-resolution frame
   once and downscale it in-process, or capture at a reduced viewport and let
   the CSS scale it. *Motivating measurement: 5 557.2 ms for 30 frames ⇒
   185.2 ms/frame in the render path, but 5 938 ms/frame in the inspection
   path — a 32x gap with the same browser.*
4. **Return the framesMeta sidecar without rendering anything.** The sidecar
   (camera pose, per-layer bbox, lifecycle, text overflow) is computed IN the
   page — a pure `page.evaluate` costs milliseconds. An agent that only wants
   the LAYOUT should never pay for a rasterisation. *This is the single
   highest-leverage change for AI authoring: it turns a 70-second
   verification into a sub-second one.*

### P1 — the render path (95.1 % of it is the capture)

5. **Give the render workers a memory budget.** `maxRenderWorkers` is
   `min(4, cpuCount)` with no memory consideration; on a 3.8 GB host that is
   two Chromium contexts each holding a full-resolution blend surface. Derive
   the worker count from the available RAM as well as the CPU count, and cap
   it at 1 when the composition uses a full-frame blend mode.
6. **Warn (or refuse) when a scene's effects are unaffordable.** The A/B is
   unambiguous: the film grain costs +53 % and the blurred mesh gradient
   +95 %, and together they are what gets the browser killed. The engine can
   detect `mix-blend-mode` overlays and `blur()` radii on full-bleed layers
   and emit a `SceneWarning` (the mechanism already exists — the MCP
   `create_or_update_scene` returns `warnings[]`) with the measured cost.
   *A warning the user sees at authoring time is worth more than a crash at
   render time.*
7. **Do the blend modes in FFmpeg, not in the browser.** A film-grain overlay
   is a static tile; compositing it once in the encoder (or baking it into a
   PNG) removes it from the per-frame cost entirely.
8. **Render the blur once.** A mesh gradient's blobs drift, but they are
   blurred RADIAL GRADIENTS — a pre-blurred sprite can be transformed. The
   70 px Gaussian pass per blob per frame is avoidable.

### P2 — correctness and headroom

9. **Give the render a pre-flight validation pass.** The heavy render failed
   *inside* the browser. A cheap pre-flight (validate + a single-frame smoke
   capture) would have turned a 21-second browser crash into an immediate,
   actionable error.
10. **Reuse the pooled browser for the inspection path** (item 1) — the engine
    already has a `RendererPool`; the inspection path simply does not use it.
11. **Consider a `--fast` rasterisation profile for the draft renders.**
    The `draft` profile is 1280x720 @ 30 fps, but a *preview* render could be
    640x360 @ 12 fps with a quarter of the pixels and a quarter of the
    filter work, and it would still answer "is the layout right?".
12. **Parallelise the audio analysis with the capture.** The mix is 4.9 % of
    the pipeline, so this is a rounding error — but it is free, and the
    engine already runs the two phases separately.

### What is NOT worth optimising

- **FFmpeg.** 284.3 ms for 30 frames, 4.9 % of the pipeline. A faster preset
  or NVENC would change the total by a few percent. The `h264_nvenc`
  encoder IS available on this host's FFmpeg build; the probe correctly
  rejects it because there is no NVIDIA GPU.
- **Font loading.** 16.1 ms. `document.fonts.ready` measured 0.0 ms.
- **The schema and the sanitizer.** 1.5 ms p50 for a scene with 40 keyframes
  per layer, and it is the only thing standing between the Studio and a
  corrupt scene.
- **The SFX bank.** 545.3 ms, once per vault, cached on disk.

---

## 9. Reproduction

```bash
node scripts/benchmark-backend-engine.cjs
# on a small host the cold-browser child can be skipped:
MOTIONFORGE_BENCH_SKIP_COLD=1 node scripts/benchmark-backend-engine.cjs
```

The script prints every measurement as it goes, ends with a JSON report, and
exits non-zero if a benchmark fails. It runs against a throw-away workspace
under `os.tmpdir()` and removes it in a `finally`, so the developer's
`~/.motionforge` is never touched.
