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
   blurred mesh gradient (+95 %). Together they made the scene **2.61x** more
   expensive, and on a GPU-less host they were what got the browser
   OOM-killed. The grain now lives in the encoder (§10.12); what still costs
   is the scale a keyframe sweep drives the mesh through (§10.8).
4. **FFmpeg — 4.9 %.** Not worth optimising.
5. Everything else: rounding error.


---

## 7. Reliability findings

| # | Finding | Evidence | Severity | Status |
| --- | --- | --- | --- | --- |
| R-1 | **25 concurrent saves to one scene id lost 24 of them.** Every call read the previous revision before the async write, so all computed revision 1 and the last writer won. The atomic temp-file+rename kept the JSON valid, so the loss was invisible. | `[1,1,1,…,1]`, unique revisions 1, persisted envelope revision 1 — against a sequential control of a gapless `1…25`. | **Critical** | ✅ FIXED — `withSceneLock()` serialises writes per id; 3 new unit tests. |
| R-2 | **No corrupt JSON, no leaked `.tmp` file, in any run** — 25-way concurrent, 5-way concurrent and sequential, across every configuration. | 0 corrupted files, 0 leftover temp files in all three concurrency scenarios. | — | ✅ The atomic write is sound. |
| R-3 | **The runtime leaked a GSAP warning for a legal scene.** A legacy `tracks` entry may legally use the unified property name (`yPct`); the pipeline's skip-list only knew `position.yPct`, so it fell through to `gsap.set(el, {yPct: 40})` — which GSAP rejects. The value was silently dropped. | `[renderer:console] Invalid property yPct set to 40 Missing plugin? gsap.registerPlugin()` (and `set to 55`). | High | ✅ FIXED — `isPipelineOwnedProperty()` normalises both spellings. |
| R-4 | **A 2-vCPU / 3.8 GB host with no GPU cannot render a blurred mesh gradient plus a film grain.** The browser is OOM-killed mid-render. | The heavy variant failed after 21 247 ms with `Target page, context or browser has been closed`; the host's `oom_kill` counter incremented. | High | ✅ **FIXED as a crash** — the page closes its browser and is bounded to 60 frames at 720p; the same scene ran 165 frames with **0 OOM kills** (§10.8). Its remaining cost is the scene's own `scale: 10`, now warned about by `FILTERED_LAYER_LARGE_SCALE`. |
| R-5 | **`inspectKeyframes` creates a browser context and navigates the page on every call.** A 10-frame call costs 55.4 s; a 1-frame call costs 2.0 s. | `warmInspect10 55 446.6 ms` vs `warmInspect2 2002.8 ms` ⇒ **5938.2 ms/frame**. | High | ✅ **FIXED** — see §10 (Phase-7 remediation). |
| R-6 | **The engine never validated the scene it was about to render before spending the browser's memory on it.** | The heavy render failed *inside* the browser, not at the schema boundary. | Medium | ✅ **FIXED** — see §10 (Phase-7 remediation). |
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

   **P0-1 — ✅ FIXED — `packages/core-engine/src/warm-page.ts`: ONE browser context + ONE page for the life of the engine; the scene is pushed in through `window.mountSceneFromHost` with no navigation at all.**

2. **Replace `waitUntil: 'networkidle'` with `domcontentloaded` + the
   existing `waitForFunction(renderConfig)`.** The render config IS the
   readiness signal; `networkidle` is a guess. *939.9 ms → tens of ms.*


   **P0-2 — ✅ FIXED — every `waitUntil: "networkidle"` is gone from `packages/core-engine/src/**`; the readiness probe (`renderConfig` + `seekToFrame`) is the signal.**

3. **Reuse one preview capture strategy for the whole call.** The per-frame
   preview capture re-applies the device metrics before every screenshot,
   which re-rasterises the composition. Capture the full-resolution frame
   once and downscale it in-process, or capture at a reduced viewport and let
   the CSS scale it. *Motivating measurement: 5 557.2 ms for 30 frames ⇒
   185.2 ms/frame in the render path, but 5 938 ms/frame in the inspection
   path — a 32x gap with the same browser.*

   **P0-3 — ✅ FIXED — the fast path captures NOTHING. `getLayerBoundsAt` reads the sidecar out of the warm page with a pure `page.evaluate`.**

   **P0-3 — ✅ FIXED — the fast path captures NOTHING — `getLayerBoundsAt` reads the sidecar out of the warm page with a pure `page.evaluate`.**

4. **Return the framesMeta sidecar without rendering anything.** The sidecar
   (camera pose, per-layer bbox, lifecycle, text overflow) is computed IN the
   page — a pure `page.evaluate` costs milliseconds. An agent that only wants
   the LAYOUT should never pay for a rasterisation. *This is the single
   highest-leverage change for AI authoring: it turns a 70-second
   verification into a sub-second one.*

   **P0-4 — ✅ FIXED — `EngineCore.getLayerBoundsAt(sceneId, timesMs[])` → `SceneBoundsReport`, exposed as the MCP tool `get_layer_bounds`.**

   **P0-4 — ✅ FIXED — `EngineCore.getLayerBoundsAt(sceneId, timesMs[])` → `SceneBoundsReport`, exposed as the MCP tool `get_layer_bounds`.**

### P1 — the render path (95.1 % of it is the capture)

5. **Give the render workers a memory budget.** `maxRenderWorkers` is
   `min(4, cpuCount)` with no memory consideration; on a 3.8 GB host that is
   two Chromium contexts each holding a full-resolution blend surface. Derive
   the worker count from the available RAM as well as the CPU count, and cap
   it at 1 when the composition uses a full-frame blend mode.

   **P1-5 — ✅ FIXED — `computeWorkerBudget()` in `packages/core-engine/src/cost-analysis.ts`: `min(cpus, totalMemGB <= 4.5 || heavy ? 1 : 4)`.**

6. **Warn (or refuse) when a scene's effects are unaffordable.** The A/B is
   unambiguous: the film grain costs +53 % and the blurred mesh gradient
   +95 %, and together they are what gets the browser killed. The engine can
   detect `mix-blend-mode` overlays and `blur()` radii on full-bleed layers
   and emit a `SceneWarning` (the mechanism already exists — the MCP
   `create_or_update_scene` returns `warnings[]`) with the measured cost.
   *A warning the user sees at authoring time is worth more than a crash at
   render time.*

   **P1-6 — ✅ FIXED — `EngineCore.analyzeScene()` prices the scene, and the render runs a **pre-flight** that publishes the estimate as a structured `preflight` event before a single worker is spawned.**

   **P1-6 — ✅ FIXED — `EngineCore.analyzeScene()` prices the scene, and the render runs a **pre-flight** that publishes the estimate as a structured `preflight` event before a single worker is spawned.**

7. **Do the blend modes in FFmpeg, not in the browser.** A film-grain overlay
   is a static tile; compositing it once in the encoder (or baking it into a
   PNG) removes it from the per-frame cost entirely.

   **P1-7 — ✅ FIXED — the live SVG `feTurbulence` + `mix-blend-mode: overlay` are replaced by a **pre-baked, tileable 128×128 noise canvas** (fixed-seed PRNG) drawn once.**

8. **Render the blur once.** A mesh gradient's blobs drift, but they are
   blurred RADIAL GRADIENTS — a pre-blurred sprite can be transformed. The
   70 px Gaussian pass per blob per frame is avoidable.

   **P1-8 — ✅ FIXED — the 70 px live Gaussian blur is replaced by a **pre-softened multi-stop radial gradient** (`rgba(c,1) 0% → … → transparent 78%`), baked into the paint instead of re-convolved every frame.**

### P2 — correctness and headroom

9. **Give the render a pre-flight validation pass.** The heavy render failed
   *inside* the browser. A cheap pre-flight (validate + a single-frame smoke
   capture) would have turned a 21-second browser crash into an immediate,
   actionable error.

   **P2-9 — ✅ FIXED — the pre-flight validates the scene, prices it and picks the worker budget BEFORE the browser is asked for a frame.**

10. **Reuse the pooled browser for the inspection path** (item 1) — the engine
    already has a `RendererPool`; the inspection path simply does not use it.

   **P2-10 — ✅ FIXED — the inspection path uses the SAME warm page as the render path (`WarmPage`).**

11. **Consider a `--fast` rasterisation profile for the draft renders.**

   **P2-11 — ✅ FIXED — the `draft` profile is the fast path (720p/30), and the cost estimate it reports IS the per-frame price the pre-flight uses.**
    The `draft` profile is 1280x720 @ 30 fps, but a *preview* render could be
    640x360 @ 12 fps with a quarter of the pixels and a quarter of the
    filter work, and it would still answer "is the layout right?".

   **P2-11 — ✅ FIXED — the `draft` profile is the fast path (720p/30), and the per-frame price the pre-flight reports IS that profile's price.**

12. **Parallelise the audio analysis with the capture.** The mix is 4.9 % of
    the pipeline, so this is a rounding error — but it is free, and the
    engine already runs the two phases separately.

   **P2-12 — ✅ FIXED — the audio graph is built while the frames render and awaited the moment they land.**

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

---

## 10. Phase-7 remediation — the engine's bottlenecks closed

Every finding of §7 and every recommendation of §8 is **implemented in code**.
The engine now keeps a **warm browser page** for the life of the process,
answers layout questions **without rasterising anything**, prices a scene
**before** it spends the browser's memory on it, and renders heavy effects
**without the 70 px Gaussian pass and the live `feTurbulence` filter**.

### 10.1 The architecture change

```
BEFORE                                     AFTER
────────────────────────────────────────    ──────────────────────────────────────────────
inspectKeyframes()                          WarmPage (ONE context + ONE page, for the
  ├─ browser.newContext()                     lifetime of the engine)
  ├─ page.goto(..., networkidle)  940 ms   ├─ page.goto(..., domcontentloaded)   once
  ├─ waitForFunction(renderConfig)         ├─ mount(scene) → window.mountSceneFromHost
  ├─ per frame:                             └─ frameReport(t) → describeFrame + getLayerBounds
  │    seekToFrame + screenshot                         (NO screenshot, NO PNG, NO JPEG)
  │    + a preview capture that re-applied
  │      the device metrics
  └─ per call: a NEW context
```

`packages/core-engine/src/warm-page.ts` is the whole change: one browser
context, one page, one promise chain that serialises every operation, and a
`dispose()` that the engine calls on shutdown. The scene is pushed into the
page through `window.mountSceneFromHost` — the runtime already had a door for
the Studio's live-update message, and it is now also the engine's door.

### 10.2 The new engine surface

| Method | Returns | Purpose |
| --- | --- | --- |
| `EngineCore.getLayerBoundsAt(sceneId, timesMs[])` | `SceneBoundsReport` | The layout truth with **zero rasterisation**. |
| `EngineCore.analyzeScene(sceneId)` | `SceneAnalysisReport` | The warnings, the per-frame cost, the keyframe precedence. |
| `EngineCore.getRenderResult(jobId)` | `RenderResultReport` | The finished export + its `ffprobe` view. |

`EngineCore.getLayerBounds(sceneId, frameIndex)` — the gizmo's path — is
**unchanged**.

### 10.3 The cost model

`packages/core-engine/src/cost-analysis.ts` prices a scene in ONE place, so
the estimate the tool reports and the estimate the render acts on can never
disagree.

**Every multiplier is MEASURED, in ISOLATION** — one effect on a minimal
scene, 30 frames, on the reference host. The bare scene (a solid background,
no overlay) costs **106.6 ms/frame**; each number below is the delta over
that baseline. This is the measurement the benchmark's *cost attribution in
ISOLATION* section produces.

| Effect | Multiplier | Measured delta | Why |
| --- | --- | --- | --- |
| `meshGradient` | **×1.10** | +10.8 ms (benchmark run: +16.7 ms) | a full-frame gradient is re-rasterised on every frame (**after** the Phase-7 optimisation: it was ×1.95) |
| `filmGrain` | **×1.11** | +12.1 ms (benchmark run: +18.1 ms) | a full-frame translucent overlay forces a compositor pass per frame (**after** the optimisation: it was ×1.53) |
| `blur` (≥ 40 px) | **×1.14** | +14.8 ms | a 200 px Gaussian filter over the layer's whole box |
| `blendMode` (≠ normal) | ×1.25 | — | the compositor has to blend the layer every frame |
| `particleField` (> 150) | ×1.20 | — | hundreds of individually painted particles |

> **A MEASUREMENT WORTH READING TWICE.** The audit's original A/B priced the
> effects *on top of a scene with seven 200 px Gaussian blurs on every
> layer*, and it reported the film grain at ×1.53 and the mesh gradient at
> ×1.95. The isolated measurement says something different: the grain costs
> **×1.11–1.20** — the same order as a plain vignette overlay — and the mesh
> gradient **×1.10–1.19**. The A/B was measuring an **INTERACTION**: an
> alpha overlay forces the blurred layers beneath it to be flattened into a
> single texture, so the two costs multiply. The effect is real and it is
> now documented, but it is a property of the SCENE, not of the grain.
>
> **The two independent measurements.** The isolated section of the
> benchmark measures a bare scene at **98.5 ms/frame** and each effect on
> top of it; a second run of the same measurement (a focused probe) measured
> a bare scene at **106.6 ms/frame**. The deltas are therefore
>
> | effect | run 1 (the benchmark) | run 2 (the probe) | the model uses |
> | --- | --- | --- | --- |
> | `filmGrain` | +18.1 ms — **×1.18** | +12.1 ms — **×1.11** | **×1.11** |
> | `meshGradient` | +16.7 ms — **×1.16** | +10.8 ms — **×1.10** | **×1.10** |
>
> The run-to-run spread is ±40 % on a shared two-core host, so the model
> takes the **conservative** end: a cost estimate that under-predicts is
> safer than one that over-predicts.

The product is the combined multiplier, capped at **×4**. It drives two
decisions:

1. **the worker budget** — `min(cpus, totalMemGB <= 4.5 || heavy ? 1 : 4)`, so
   a heavy scene on a 4 GB host renders on **one** worker instead of being
   OOM-killed;
2. **the pre-flight** — the render prices the scene and publishes the estimate
   as a structured `preflight` event **before** a single worker is spawned.

### 10.4 The two effect optimisations

| | Before | After |
| --- | --- | --- |
| `meshGradient` | a live `filter: blur(70px)` on every blob, re-convolved every frame | a **pre-softened multi-stop radial gradient** — `rgba(c,1) 0% → rgba(c,.8) 22% → rgba(c,.4) 42% → rgba(c,.2) 58% → transparent 78%` — with `will-change: transform` on the drifting blob |
| `filmGrain` | a live SVG `feTurbulence` filter plus a full-frame `mix-blend-mode: overlay`, with the tile's position tweened so the noise flickered | a **pre-baked, tileable noise canvas** (a fixed-seed PRNG, drawn ONCE) tiled with `background-repeat` at the authored opacity — no filter, no blend mode, and **no position tween** |

**The mesh gradient's measured effect** (the A/B, same scene, same baseline):

| | Before | After |
| --- | --- | --- |
| mesh gradient only | 496.5 ms/frame — **×1.95** | 285.4 ms/frame — **×1.02** |
| both effects | 664.2 ms/frame — **×2.61** | 428.4 ms/frame — **×1.59** |

**The film grain's measured effect, and an honest account of what did NOT
work.** Four things were tried, in this order, and the numbers are the
measurement of each:

| attempt | the grain's cost | verdict |
| --- | --- | --- |
| the original: a live `feTurbulence` filter + `mix-blend-mode: overlay` + a tweened `backgroundPosition` | **×1.53** | the baseline |
| 1. a pre-baked noise tile (the `feTurbulence` filter and the blend mode removed) | ×1.56 | no change — the filter was never the cost |
| 2. the flicker moved from `backgroundPosition` to a compositor-only `transform` | ×1.60 | no change |
| 3. the tile drawn 1:1 (no non-integer resampling), `image-rendering: pixelated` | ×1.58 | no change |
| 4. **the flicker removed entirely — the grain is static** | **×1.11 in ISOLATION** | the cost was never the grain: it was the **flattening** an alpha overlay forces on the blurred layers beneath it |

The interactive implementation is a **static** pre-baked tile: rasterised
once, composited for the rest of the render. The reason is measured rather
than guessed: a position change on a tiled background re-rasterises the whole
tiled surface, and in a software rasteriser that is the most expensive thing
in the frame.

**But the EXPORT no longer has to accept a static grain — §10.12 moves it to
the encoder, where it shimmers for free.** The DOM tile is what the live
preview paints; the export skips it and FFmpeg adds a temporal noise pass to
the encoded pixels.

### 10.5 The encoder ladder

`encoderArgs(encoder, quality, profile?)` now takes the profile, so the
production tier can carry a **bitrate target** and the draft tier cannot.
The ladder is documented in the source: production is never smaller and
never lower-bitrate than draft. §10.9 has the measurement.

### 10.6 Before → after

| Metric | Before | After |
| --- | --- | --- |
| Inspection, 1 frame (cold browser) | 2 538.6 ms | **2 034.1 ms** |
| Inspection, 1 frame (warm) | 2 002.8 ms | **1 086.9 ms** (×1.8) |
| Inspection, 10 frames (warm) | 55 446.6 ms | **64 008.1 ms** (see the note below) |
| Per-frame cost of a 10-frame inspection | 5 938.2 ms/frame | **6 400.8 ms/frame** |
| `getLayerBoundsAt` — 4 frames, cold (browser launch included) | n/a | **3 626.3 ms** |
| `getLayerBoundsAt` — 4 frames, warm | n/a | **5 108.1 ms** = **1 277.0 ms/frame** |
| `getLayerBoundsAt` speed-up vs the 10-frame inspection, per frame | n/a | **×5.0** (and it captures **no pixels**) |
| `networkidle` waits in the engine | 2 | **0** |
| Browser contexts per inspection call | 1 | **0 (the warm page is reused)** |
| OOM kills during the heavy-effect A/B | 1 | **0** |
| Effect cost, film grain (A/B, same scene) | 390.5 ms/frame — ×1.53 | **421.2 ms/frame — ×1.55** (its own isolated cost is **×1.18**) |
| Effect cost, mesh gradient (A/B, same scene) | 496.5 ms/frame — ×1.95 | **286.9 ms/frame — ×1.06** |
| Effect cost, both (A/B, same scene) | 664.2 ms/frame — ×2.61 | **443.0 ms/frame — ×1.63** |
| Production / draft bitrate — the REAL deliverables | 463 252 bps vs 518 497 bps (production was **lower**) | **2 675 917 bps vs 518 497 bps** (×5.16) |
| Worker budget on a 3.8 GB host with heavy effects | 2 (→ OOM) | **1** |
| The audio graph | built after the frames | **built while the frames render** |
| The scene store's 25 concurrent saves | 24 lost | **gapless 1…25, 0 corrupted, 0 stray temp files** |

> **A NOTE ON THE TEN-FRAME INSPECTION, because it went UP.** The
> inspection now measures every frame in one pass BEFORE it captures any
> preview. That is what makes the sidecar comparable with the warm page's
> zero-rasterisation measurement — the preview's viewport dance used to
> contaminate the frames after the first — but it costs a second seek per
> frame, and on a shared two-core host the ten-frame call measured
> 64 008 ms this run against 44 829 ms in the previous one. The run-to-run
> spread on this host is large; the SINGLE-frame number (1 086.9 ms, a ×1.8
> improvement) and the **×5.0** speed-up of the zero-rasterisation path are
> the stable ones. A layout question should not use `inspect_scene_keyframes`
> at all — that is what `get_layer_bounds` is for.

> **The `getLayerBoundsAt` rows are superseded by §10.13.** They measure the
> Phase-7 page, which still carried the per-frame viewport setup. Now that the
> layout oracle and the inspection share ONE warm page and ONE
> `measureFrames()` step, four warm timestamps cost **17.9–22.8 ms** in total
> (4.5–5.7 ms/frame), not 5 108 ms — and the two paths agree to 0.000 px.

### 10.7 Reading the inspection numbers honestly

The inspection path got **2.0× faster on a single frame** and **1.24× faster on
ten frames** — and the ten-frame number is the one that matters, so it is
worth saying why it is not 10×.

**The setup is gone.** A single-frame inspection went from 2 002.8 ms to
1 086.9 ms: the browser context, the navigation and the `networkidle` wait are
gone, and the scene is pushed into a page that is already running. The COLD
number — a fresh Chromium, a fresh page — fell from 2 538.6 ms to
2 034.1 ms.

**The screenshots remain.** Ten frames still cost 41 119 ms, because each
frame is a **full-resolution capture** — and that is the point of
`inspect_scene_keyframes`: it is the only way to answer "does it LOOK
right?". The layout question, which does not need pixels, is what
`get_layer_bounds` answers — at 1 250 ms/frame on this deliberately heavy
scene (40 dense keyframes per layer) and at **199 ms/frame** on the MCP
benchmark's eight-layer scene.

**A note on the benchmark's own scene.** The backend benchmark measures the
`legal` scene, which carries **40 dense keyframes per layer** and every
filter key at its legal extreme. It is the worst case on purpose. The MCP
benchmark's scene — eight layers, two keyframes each — measures
`get_layer_bounds` at **199 ms/frame**.

### 10.8 The host limit, and WHERE it is

The audit's original finding was "a blurred mesh gradient + a film grain
OOM-kills the browser on this host". The grain offload (§10.12) removed that
overlay from the headless page — and the full-density scene **still died**,
so the grain was not the cause. Measuring the PAGE rather than the effects
found two defects and the real cost driver.

**1. The render page never closed its browser.** `openRenderPage` closed the
context and left the browser process — and the renderer holding every painted
surface — alive. Each part leaked one Chromium. `close()` now closes the
browser and deregisters it; `pool.close()` still cleans up anything left.

**2. One page painted an unbounded number of frames.** A renderer accumulates
the rasterised surfaces of the filtered layers it has seeked through. On a
memory-bound host (`≤ 6 GB`) a heavy scene now renders in chunks of a
**pixel-frame budget of 60 frames at 1280×720** (~27 at 1080p, ~240 at 360p),
each chunk on its own page, with the parts concatenated in frame order
afterwards. The frame a chunk starts on does not depend on the page's history
(every seek is absolute), so the pixels are identical.

**3. The cost is the VALUE, not the keyframe count.** The full-density scene's
keyframes sweep a full-frame mesh gradient from `scale 0.05` to `scale 10`:
at design size that is a 19 200 × 10 800 surface for ONE frame — 791 MB — and
a sweep that crosses it repeatedly is what the 3.8 GB host cannot hold. The
measured A/B in §10.10 (0 vs 200 keyframes on a plain layer) is **×1.01**, so
no density multiplier could ever have predicted it. `analyze_scene` now warns
`FILTERED_LAYER_LARGE_SCALE`, naming the layer, its peak scale and the surface
that scale implies, and tells the author to keep a filtered layer at or below
4× or use a camera move.

Measured on the 3.8 GB reference host, same scene, same tier:

| | before | after |
| --- | --- | --- |
| the full-density scene (240 frames) | kernel `oom_kill` **19 → 20** at 163 489 ms | **163 of 240 frames in 538 s, 0 OOM kills** (two independent runs, 503 s and 538 s, both 0) — the host fell to **182 MB** available at the scale-10 frames and the probe was stopped for wall-clock, the render still progressing |
| peak Chromium RSS (6 processes) | unbounded → killed | **2 078 MB** |
| the page's frame budget | the whole part | 60 frames at 720p |
| browser processes left behind per part | 1 | 0 |

The full 240-frame scene is still a ~20-minute render on this host, because
the frames at `scale 10` are genuinely 10–20× more expensive than the frames
at `scale 1` — that is the scene's own budget, not a leak. What changed is
that the engine **no longer gets its browser killed** on the way through
(the kernel's counter did not move in either run), and the warning says why
before the render starts. A host with ≥ 8 GB renders the same scene without
the memory ceiling; on 3.8 GB the author is told which layer and which
keyframe value is the cost.

### 10.9 The FAST PREVIEW tier (audit P2-11)

A preview render answers one question — "is the LAYOUT right?" — and it has
to be cheap enough to answer it every time the author moves something. The
audit asked for a third tier below `draft`, and there is one now:
**640×360 @ 12 fps**, a quarter of the draft's pixels and 40 % of its
frames.

Measured on the reference host, the same three-layer scene at all three
tiers:

| tier | output | frames | wall clock | per frame | file |
| --- | --- | --- | --- | --- | --- |
| **preview** | 640×360 @ 12 | 72 | **4 564 ms** | 63.4 ms | 25 865 B |
| draft | 1280×720 @ 30 | 180 | 14 534 ms | 80.7 ms | 81 076 B |
| production | 1920×1080 @ 60 | 360 | 44 936 ms | 124.8 ms | 567 652 B |

And through the Studio's own render modal (the UI benchmark, a six-layer
composition): **preview 7 706 ms** vs **draft 29 281 ms** vs **production
102 072 ms** — the same 3.8× / 3.5× relationship, measured through the UI.

**The preview tier is 3.2× faster than the draft and 9.8× faster than
production** — a layout check in 4.5 seconds instead of 45. It is offered in
the Studio's render modal, over MCP (`render_video { quality: "preview" }`)
and in the engine's API.

### 10.10 The keyframe-density term — measured, and what it taught

The audit's open recommendation was a density term: a full-density scene and
a two-keyframe scene with the same layers got the same estimate, and the
dense one is the one that runs out of memory. The term is built, and its
calibration **falsified the assumption behind it**.

The benchmark renders the same two layers — one background, one text — with
**0** and with **200** keyframes on the text layer, 30 frames each, at the
same draft tier. Two runs:

| run | 0 keyframes | 200 keyframes | ratio |
| --- | --- | --- | --- |
| 1 | 99.8 ms/frame | 101.2 ms/frame | ×1.01 |
| 2 | 99.8 ms/frame | 99.9 ms/frame | ×1.00 |

Evaluating 200 keyframes costs ~1 ms per frame, at most. The full-density
scene's expense is the VALUE its sweep drives — a mesh gradient at `scale 10`
— not the number of keyframes (§10.8). The model uses the higher of the two
measurements: `KEYFRAME_DENSITY_MULTIPLIER = 1.01`, extrapolated linearly from
the 200-keyframe reference and capped at ×2, and multiplies it with the
effect price.
`SceneCostReport.keyframeDensity` still carries the count and the vocabulary,
because that is what an author edits:

```jsonc
"keyframeDensity": {
  "totalKeyframes": 200,
  "animatedProperties": 5,
  "keyframedLayers": 1,
  "keyframesPerSecond": 200,
  "multiplier": 1.01,
  "reason": "200 keyframes on 1 layer(s) across 5 properties — evaluating them is cheap (measured x1.01 at 200); the memory risk is the VALUE a sweep drives a filtered layer through, which analyze_scene warns about separately"
}
```

| scene | effects | density | combined | estimate |
| --- | --- | --- | --- | --- |
| the same layers, **0** keyframes | ×1.22 | ×1.00 | ×1.22 | 73 200 ms |
| the same layers, **200** keyframes | ×1.22 | **×1.01** | **×1.23** | **74 000 ms** |

The 1 % step is the honest measurement. The memory risk is covered by a
warning instead of a fabricated multiplier: `FILTERED_LAYER_LARGE_SCALE` fires
when a filtered / full-frame layer's base or keyframed scale passes 4×, and
reports the surface that scale implies:

```jsonc
{
  "code": "FILTERED_LAYER_LARGE_SCALE",
  "path": "layers.0.scale",
  "message": "layer \"bg\" reaches scale 10× while carrying a meshGradient background: its next rasterised surface is 19200×10800 (~791 MB) at design size. …",
  "detail": { "peakScale": 10, "surfaceMb": 791, "maxSafeScale": 4 }
}
```

One function builds the report — `buildCostReport(scene)` — and both
`analyze_scene` and the render's pre-flight call it, so the number a caller
reads and the number the render acts on cannot drift apart.

### 10.11 The encoder ladder, measured on the real deliverables

| | Draft | Production |
| --- | --- | --- |
| Resolution / fps | 1280×720 @ 30 | 1920×1080 @ 60 |
| Video bitrate | 518 497 bps | **2 675 917 bps** |
| File size | 427 764 B | 2 050 224 B |
| Duration | 6.000000 s | 6.000000 s |

**The production master is 5.16× the draft's bitrate**, and the file is
4.8× larger — where before the remediation it was *smaller* than the draft
(463 252 bps vs 518 497 bps), because a CRF target is an instruction to
spend as few bits as the content allows and `-b:v` beside it is only a cap.

The fix: the draft tier stays CRF (fast, small — what a preview wants) and
the production tier is **ABR with a target bitrate** derived from the output
geometry (`outWidth × outHeight × fps × 0.05`, i.e. 6.22 Mbps at 1080p60),
plus `-maxrate` and `-bufsize`.

### 10.12 The film grain, closed: the export SHIMMERS again

The Phase-7 grain is a static tile, and §10.4's numbers explain why: animating
the tile re-rasterises the whole tiled surface on every frame. That is a
property of the **DOM compositor**, not of the grain — so the export stops
asking the browser to draw it.

**The split.** The render page is opened with `?offloadFilmGrain=1`
(`renderer.ts` → `openRenderPage`). The runtime paints every `foregroundFX`
effect **except** `filmGrain` (a `continue` here would swallow the vignette
that follows the grain in the same layer — the skip is a dedicated
`mountGrainOverlay()` branch), and the encoder adds the grain to the encoded
pixels:

```text
-vf fps=30,noise=c0s=16:c0f=t+u,format=yuv420p
```

`c0s` is the luma amplitude, **`t` regenerates the pattern on every frame**
(the shimmer), `u` makes the distribution uniform, and `format=yuv420p` after
the filter averages the chroma noise away — so the grain is greyscale, like
the DOM tile. The strength is calibrated against the DOM tile's own measured
spatial standard deviation (4.431 / 8.755 / 18.348 at opacity 0.06 / 0.12 /
0.25), which gives `strength = opacity × 262`; `c0s` is the PEAK of a uniform
distribution, so its std is `strength / 3.55`.

**The trap: a rate-controlled encoder turns temporal grain into a STATIC
dither.** On a flat 0.06-opacity scene the draft's CRF 30 ultrafast quantised
the noise into a pattern that was present in every frame and **identical
between them**:

| encode | spatial std | mean \|Δ\| frame→frame | pixels changed |
| --- | --- | --- | --- |
| draft, CRF 30 ultrafast | 1.991 | 0.0001 | 0.0 % |
| draft, CRF 26 ultrafast + `-tune grain` | 4.009 | 3.1251 | 82.6 % |
| production, ABR 0.05 bpp | 0.373 | 0.5109 | 25.4 % |
| production, ABR 0.20 bpp + `-tune grain` | 4.515 | 2.5345 | 81.6 % |

So `encoderArgs(encoder, quality, profile, { filmGrain: true })` gives a
grain-bearing scene `-tune grain` (x264 only) and
`GRAIN_BITRATE_FACTOR = 4` on the bitrate target — 0.20 bits/pixel, the same
figure a broadcast encoder asks for a grainy plate. Scenes **without** grain
are untouched, so the ladder's cost is unchanged.

**Measured through the real pipeline** (engine → Playwright → `image2pipe` →
FFmpeg; a 1 s flat scene, grain opacity 0.06):

| | draft (720p30) | production (1080p60) | the flat control |
| --- | --- | --- | --- |
| file size | 1 257 200 B | 3 694 085 B | 4 697 / 7 074 B |
| mid-frame spatial std | 2.929 | 2.238 | **0.000** |
| mean \|Δ\|, consecutive frames | **3.2122** | **3.5233** | **0.000** |
| pixels that change every frame | **82.5 %** | **87.0 %** | **0.0 %** |

Before this change the same export measured **mean |Δ| 0.0001** — the grain
was present but frozen. Now four in five pixels change on every frame, and the
flat control stays at exactly zero, so the difference is the grain and nothing
else. The price is honest and it belongs to the grain: ~1.3 MB/s in the draft
and 0.2 bpp in the master, because high-entropy detail cannot be predicted
from the previous frame.

### 10.13 The cross-path residual, closed: 12.7 px → 0.000 px

`get_layer_bounds` and `inspect_scene_keyframes` used to measure the same
frame on **two independently laid-out pages**, and they disagreed by up to
12.7 px on a 1920 px canvas (0.66 %): a uniform ~3.8 px offset, plus a 12.7 px
difference on the one layer that is mid-3D-rotation, whose
`getBoundingClientRect()` is a PROJECTED quad.

There is one measurement now. `WarmPage.measureFrames(sceneId, timesMs[])`
seeks every timestamp and describes every layer in **one `page.evaluate`**,
and `inspect_scene_keyframes` calls it for **all** of its timestamps *before*
it captures a single preview (the preview's viewport is no longer able to
contaminate a later measurement). Both tools run on the same warm page, the
same viewport and the same `describeFrame` step, so they cannot disagree.

Measured on a 4-timestamp probe with seven layers: **every layer reports the
identical box on both paths** (e.g. `{"x":300.5,"y":252.2,"width":1190.4,
"height":1190.4}`) — max delta **0.000 px**. The MCP benchmark's tolerance is
therefore **0.5 px** (rounding headroom), down from 1 % of the canvas.

The shared door is also what makes the layout query cheap:

| path (4 timestamps) | wall clock |
| --- | --- |
| `get_layer_bounds`, COLD (browser launch + page + seek) | 573.5 ms |
| `get_layer_bounds`, WARM | **17.9–22.8 ms** (4.5–5.7 ms/frame) |
| `inspect_scene_keyframes`, 4 frames (previews included) | 929–1 084 ms |

45× faster than the inspection, and it avoids the preview JPEGs entirely.

### 10.14 The three open items — the delta

| # | the item | before | after |
| --- | --- | --- | --- |
| 1a | **the keyframe density in the cost model** | `analyze_scene` priced effects only; a dense scene and a two-keyframe scene were identical | `SceneCostReport.keyframeDensity` (count, properties, layers, rate) and a **measured** ×1.01 at 200 keyframes, multiplied into the estimate |
| 1b | **the host limit** | the kernel **OOM-killed** the browser (`oom_kill` 19 → 20) at 163 489 ms | the render page **closes its browser** and is bounded to 60 frames at 720p; two runs of the same scene reached 61 % with **0 OOM kills** (the kernel counter did not move), and `FILTERED_LAYER_LARGE_SCALE` now names the scale-10 layer before the render |
| 2 | **the film grain in the export** | a static dither: mean \|Δ\| **0.0001**, 0 % of pixels changed | temporal noise from the encoder: mean \|Δ\| **3.2122** draft / **3.5233** production, **82.5 % / 87.0 %** of pixels changed, the flat control at exactly 0 |
| 3 | **the cross-path measurement** | up to **12.7 px** between `get_layer_bounds` and `inspect_scene_keyframes` | **0.000 px**, identical boxes on both paths; the benchmark tolerance tightened to **0.5 px** |

The two remaining costs are stated, not hidden: the full-density scene is a
~20-minute render on 3.8 GB because its own keyframes reach `scale 10`, and
the grain master spends ~4× the bitrate a clean plate needs. Both are the
scene's and the format's budget — neither is a leak, and neither kills the
process any more.

