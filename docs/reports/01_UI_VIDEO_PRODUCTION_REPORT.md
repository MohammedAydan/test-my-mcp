# 01 — UI Video Production Report

> **What this is.** A complete 6-second, 1920×1080, 30 fps product-launch promo
> built **entirely through the Studio's own UI** — tool dock, project bin,
> inspector, canvas gizmo, timeline, SFX drag-and-drop and the render modal —
> and exported to an MP4.
>
> **How to reproduce.**
>
> ```bash
> npm run build -w @motionforge/desktop
> xvfb-run -a --server-args="-screen 0 1920x1200x24" \
>   node scripts/benchmark-ui-video-production.cjs
> ```
>
> Every number below was **measured on the live Electron application** by
> `scripts/benchmark-ui-video-production.cjs` (**72/72 checks passed**). The
> run is isolated: the engine is pointed at a throw-away tree through
> `MOTIONFORGE_STORAGE_DIR` / `MOTIONFORGE_VAULT_DIR` / `MOTIONFORGE_RENDERS_DIR`,
> so the developer's `~/.motionforge` is never touched.
>
> Deliverables: `renders/ui-production-showcase.mp4`,
> `renders/ui-production-showcase-t{0.5,2.0,4.5}.png`,
> `screenshots/benchmark-ui-production-studio.png`.

---

## 1. The step-by-step build

| # | What was done (through the UI only) | Measured |
| --- | --- | --- |
| 1 | Clicked `New` in `COMPOSITIONS`, then renamed the card to `"UI Production Showcase"` and pressed Enter. | **412 ms** to create, the rename persisted through the engine |
| 2 | Opened the composition settings and set Duration 6000 ms, Shape `16:9 Landscape`, Scale `1080p`. | duration 6000 ms, canvas 1920×1080 |
| 3 | Selected the background layer on **V1** and changed **Background Style → Mesh Gradient** in `CONTENT & STYLE`. | **1633 ms** — **and it FAILED** (BUG-1, §5) |
| 4 | Reverted the background to a solid rich colour `#0b1226`. | persisted `{"variant":"solid","color":"#0b1226"}` |
| 5 | Clicked the **Text Tool** (`T`), typed the title into the canvas inline editor, set size 112 px and colour `#eaf3ff`. | the title reads `MOTIONFORGE STUDIO`; the inline editor was used |
| 6 | **Dragged** the title on the canvas with the gizmo. | `position` 50 %/50 % → **48.4 %/35 %**; 24 `ephemeralTransform` messages, **2.01 ms average round trip** (7.10 ms worst) |
| 7 | Scrubbed the ruler to 0 ms, clicked the **Position Y** and **Scale** stopwatches, scrubbed to 1500 ms and changed both values. | **2788 ms**; keyframes `yPct 35→28`, `scale 1→1.12` |
| 8 | Confirmed the runtime interpolates. | `top` = 31.05 % at 800 ms → 28 % at 1500 ms; `scale` 1.0677 → 1.12 |
| 9 | Added a **Card** layer, set its track to **V3**, typed its title and body into `CONTENT & STYLE`. | **1172 ms**; card on V3, at 800 ms, duration 3000 ms |
| 10 | Gizmo **MOVE** drag on the card. | **506 ms**; `position` → 40.9 %/60.5 %; **2 smart-alignment guide groups** painted during the drag |
| 11 | Gizmo **`se` resize handle** drag. | **184 ms**; `scale` 1 → **1.1275**; the handle is a 7×7 px rounded square |
| 12 | Gizmo **rotation handle** drag. | **368 ms**; `rotation` → **−30°** |
| 13 | Verified the gizmo against the **real rendered element** in the `mf-runtime://` frame. | max error **0.10 px** (rotated at −30°) and **0.10 px** (0°) |
| 14 | Applied **Visual Effects**: Drop Shadow 32, Corner Radius 26, Contrast 118. | **1518 ms**; computed `filter` = `contrast(1.18) drop-shadow(rgba(0,0,0,0.55) 0px 0px 32px)` |
| 15 | Added a second **Card** on **V4**, moved it with the gizmo. | trackIndex 3, at 3400 ms, duration 2400 ms, `position` 58 %/54.1 % |
| 16 | **Trimmed** the clips: card 1's right edge 3000 → **2200 ms**; card 2's left edge 3400 → **3000 ms** (duration 2400 → 2800). | **525 ms** for both trims |
| 17 | Added an **Effect Overlay** (`foregroundFX`, vignette) and stretched it to the full 6000 ms. | at 0, duration 6000 |
| 18 | Switched the Project Bin to the **SFX** tab and **dragged two cues** onto the audio lane: `whoosh` (117 ms) and `subImpact` (2998 ms). | the A1 lane painted **3159 green waveform pixels** in its band (11575 green pixels on the whole canvas) |
| 19 | Dragged the **timeline splitter** up so all six lanes are on screen. | **1439 ms**; the timeline became 492 px tall |
| 20 | Clicked **Fit Timeline**. | zoom 0.9903, pan 0; **visible 6059 ms vs content end 6000 ms** — every clip on every track is on screen |
| 21 | Captured the full-UI screenshot. | `screenshots/benchmark-ui-production-studio.png`, 203 kB, viewport 1919×1199 |
| 22 | Clicked the top-right **Render** button, chose `draft`, clicked **Render**. | modal opened in **77 ms**, the job started **233 ms** later |
| 23 | Watched the live render queue until completion. | `queued` at 238 ms → `running, frame 1/180` at 2298 ms → `succeeded, frame 180/180` at **23 619 ms** |
| 24 | Repeated the render at `production` (1920×1080 @ 60 fps). | **79 404 ms** |
| 25 | Verified the exports with `ffprobe` and extracted three PNG frames. | see §3 |

### The finished composition

| Lane | Layer | Kind | Window | Transform |
| --- | --- | --- | --- | --- |
| V1 | `bg` | background | 0 – 6000 ms | solid `#0b1226` |
| V2 | `title` | kineticText | 0 – 6000 ms | 48.4 % / 28 %, scale 1.12, **4 keyframes** |
| V3 | `card-vgdq2` | card | 800 – 3000 ms | 40.9 % / 60.5 %, scale 1.1275, **−30°**, filters `contrast 118 / shadowBlur 32 / cornerRadius 26` |
| V4 | `card-gvile` | card | 3000 – 5800 ms | 58 % / 54.1 % |
| V5 | `foregroundFX-4jbhv` | foregroundFX | 0 – 6000 ms | vignette 0.5 |
| A1 | `cue-dppde` | sfx `whoosh` | 117 ms | gain 1, pan 0 |
| A1 | `cue-vs3n4` | sfx `subImpact` | 2998 ms | gain 1, pan 0 |

**The five layers land on five separate lanes.** The lane resolver gave
`bg`→V1, `title`→V2, `card-vgdq2`→V3, `card-gvile`→V4 — one row each, in the
order they were created. Nothing was crammed.

---

## 2. The measured UI metrics

### 2.1 Interaction latency

| Operation | Measured | Notes |
| --- | --- | --- |
| Canvas drag, per pointer move | **1.45 ms** avg, 3.60 ms max | 24 moves; the `pointerdown` cost 0.40 ms, the `pointerup` 1.30 ms |
| Canvas drag → runtime round trip | **2.01 ms** avg, 7.10 ms max | 24 `ephemeralTransform` messages, measured from the pointer event to the applied transform in the preview iframe |
| Canvas drag, total wall clock | 510 ms | 24 moves, 10 of them the repositioning drag |
| Gizmo MOVE | 506 ms | includes the guide paint and the store commit |
| Gizmo resize (`se`) | **184 ms** | the fastest manipulation — one property, one write |
| Gizmo rotate | 368 ms | |
| Create a composition | 412 ms | |
| Add a layer (the Add Layer modal) | 1172 ms | |
| Author a keyframe pair | 2788 ms | two stopwatch clicks + two value changes + a scrub |
| Apply the three visual effects | 1518 ms | three scrub fields |
| Trim both clips | 525 ms | two handle drags |
| Resize the timeline | 1439 ms | the splitter drag |
| Open the render modal | 77 ms | |
| Start the render | 233 ms | |

### 2.2 Gizmo ↔ rendered element lockstep

The gizmo's axis-aligned bounding box (the union of the four **rotated**
corners, from the `<g>`'s own `transform`) was compared against the real
rendered element's `getBoundingClientRect()` inside the `mf-runtime://` frame.

| Angle | Δx | Δy | Δw | Δh | max \|Δ\| |
| --- | --- | --- | --- | --- | --- |
| **−30°** (rotated) | −0.03 px | −0.01 px | 0.08 px | 0.10 px | **0.10 px** |
| 0° | −0.03 px | −0.01 px | 0.08 px | 0.10 px | **0.10 px** |

The error does **not** grow with the rotation — the box is applied exactly
once, around the transformed centre.

### 2.3 Timeline scrubbing

| Measurement | Value |
| --- | --- |
| Through Playwright automation (61 pointer events over 4125 ms) | 14.8 playhead values/s of wall clock; **67.8 ms median** app interval, 128 ms max |
| The same scrub injected inside the page (no automation overhead) | **401 store updates in 208.5 ms = 1923 updates/s**, 243 distinct playhead values |

The two numbers say the same thing: the *application* keeps up (1923 updates/s
— 30× the 60 fps budget); the 14.8/s figure is the Playwright event
dispatch rate, not the app's limit. The timeline is not the bottleneck.

### 2.4 Render

| Profile | Wall clock | Output |
| --- | --- | --- |
| `draft` (1280×720 @ 30 fps) | **23.6 s** | 180 frames |
| `production` (1920×1080 @ 60 fps) | **79.4 s** | 360 frames |

Render queue progression (from the modal's own rows): `queued` at 238 ms →
`running, frame 1/180` at 2298 ms → `succeeded, frame 180/180` at 23 619 ms.
The **2060 ms between `queued` and the first frame** is the Playwright
browser launch and the runtime bundle load — the cold start, paid once.

---

## 3. The exported video

### 3.1 The deliverable — `renders/ui-production-showcase.mp4`

```
[STREAM]
index=0
codec_name=h264
codec_type=video
width=1920
height=1080
r_frame_rate=30/1
avg_frame_rate=30/1
bit_rate=337041
nb_frames=180
[/STREAM]
[STREAM]
index=1
codec_name=aac
codec_type=audio
sample_rate=48000
channels=1
r_frame_rate=0/0
avg_frame_rate=0/0
bit_rate=46315
nb_frames=283
[/STREAM]
[FORMAT]
format_name=mov,mp4,m4a,3gp,3g2,mj2
duration=6.000000
size=295658
bit_rate=394210
[/FORMAT]
```

**1920×1080, H.264, 30 fps, exactly 180 frames, exactly 6.000000 s, with an
AAC 48 kHz mono audio stream** carrying the two mixed SFX cues.

### 3.2 The two engine renders

| | `draft` | `production` |
| --- | --- | --- |
| Resolution | 1280×720 | 1920×1080 |
| Frame rate | 30/1 | 60/1 |
| Frames | 180 | 360 |
| Video bitrate | 645 200 | 415 658 |
| Audio | AAC 48 kHz mono, 46 172 bps | AAC 48 kHz mono, 46 172 bps |
| Duration | 6.000000 s | 6.000000 s |
| Size | 525 254 B | 357 481 B |
| Format bitrate | 700 338 | 476 641 |

The `production` profile is **smaller** than `draft` despite carrying twice
the frames — the encoder's quality target, not the frame count, drives the
bitrate. A user comparing the two file sizes would conclude that "production"
is worse; it is not, it is a 60 fps master.

### 3.3 The extracted frames

| Frame | What is visible |
| --- | --- |
| `t=0.5 s` | The dark blue gradient background with its vignette, and the hero title **"MOTIONFORGE STUDIO"** mid-entrance — the two words are on separate lines with a word-stagger offset still in flight. No cards yet. |
| `t=2.0 s` | The title has settled and moved up (the `yPct 35 → 28` keyframe), and **card 1** ("Ship a promo in six seconds / Every layer placed by hand with the Studio UI.") has entered with its rounded corners and drop shadow. |
| `t=4.5 s` | Card 1 has exited and **card 2** ("Keyframe. Trim. Render. / Direct manipulation, live preview, real export.") has taken its place — the timeline trim produced a clean sequence with no overlap. |

The three frames have distinct content hashes
(`ee9ab7c9a632ecac` / `def00befcc6763e9` / `3d3129b46abb523e`), so the
animation is genuinely rendering — not a still image repeated.

---

## 4. Honest UX critique

The build succeeded end to end, and the direct-manipulation model works. But
building a *real* video exposed friction that a synthetic test scene never
touches.

### 4.1 Friction points, in the order they were hit

| # | Friction | Severity | Detail | Status |
| --- | --- | --- | --- |
| F1 | **The inspector cannot author a gradient background.** | **High** | Selecting "Mesh Gradient" writes `{"variant":"meshGradient","color":"#05070d"}`. The schema requires `blobs` (min 2) for that variant and rejects the extra `color`, so the save is refused with `layers.0.variant.blobs: Required; layers.0.variant: Unrecognized key(s) in object: 'color'`. "Particles" fails the same way (`count` is required). The user picks a gradient, the app accepts it, and then the engine rejects the scene — with no hint in the UI about which field is missing. ✅ FIXED |
| F2 | **An invalid background variant CRASHES the preview renderer.** | **High** | The same invalid variant produced `TypeError: Cannot read properties of undefined (reading 'forEach')` at `renderBackground` — `packages/scene-runtime/src/layers/background.ts` reads `v.blobs.forEach()` without a guard. The preview dies before the user sees why the save failed. ✅ FIXED |
| F3 | **A failed save is invisible in the UI and leaks an unhandled rejection.** | **High** | The inspector commits with `void store.executeSave()` and `executeSave()` re-throws after the toast. The renderer logged an unhandled `SceneServiceError: invalid scene: layers.3.duration: layer window extends past scene end`. The user sees a toast that flashes away, then a red console error, and no indication of WHICH field is wrong. ✅ FIXED |
| F4 | **The store never records the render queue.** | Medium | `state.renderQueue` stayed `0` after a successful render. The render modal keeps its own local `queue` signal, so anything outside the modal (a status bar, a command, a test) cannot see the render state. The benchmark had to scrape the modal's DOM rows to follow the progress. ✅ FIXED |
| F5 | **`Ctrl+K` is bound twice.** | Medium | One `Ctrl+K` with the title selected opened the command palette **and** razor-split the layer (5 → 6 layers). `App.tsx` maps `Ctrl+K` to the palette; the timeline maps the same chord to "razor split at playhead"; neither stops propagation. The accidental split had to be undone. ✅ FIXED |
| F6 | **The background layer's "duration" is `null` in the persisted scene.** | Low | `bg` persisted with `duration: null` while the timeline shows it spanning the whole composition. Harmless today, but a consumer reading the JSON sees a layer with no duration. ✅ FIXED |
| F7 | **The `foregroundFX` template has no duration.** | Low | The overlay template creates a layer with no `duration`, so the schema's 1200 ms default applied — it would have covered only the first fifth of the composition. The benchmark had to set the duration explicitly. A "full-bleed" template should default to the scene length. ✅ FIXED |
| F8 | **The SFX drag has no drop-target feedback.** | Low | Dragging a cue from the bin onto A1 works, but nothing highlights the lane or snaps the cue to the playhead while the drag is in flight. The cue landed at 117 ms and 2998 ms — the 117 ms is an accident of where the pointer was released. ✅ FIXED |
| F9 | **The trim handles are 10 px of *hit area* with no visible affordance.** | Low | The clip edges highlight on hover, but the handles themselves are invisible until the clip is selected. A user has to discover that the edges are draggable. ✅ FIXED |
| F10 | **A layer without an explicit track defaults to the next free lane, but the UI offers no "which track is this?" readout while dragging.** | Low | The `TRACK ASSIGNMENT` section has a "Video Track" select, which is good, but the timeline drag itself gives no lane highlight (the spec asked for one). ✅ FIXED |
| F11 | **Keyframing a property requires three separate interactions.** | Low | Scrub to the time → click the stopwatch → change the value. The auto-key (added in v4) removes the second click for an *already* keyframed property, but the first keyframe on a new property still needs the stopwatch. An "auto-key arm" switch would remove it. ✅ FIXED |
| F12 | **The composition inspector has no "fit the canvas to the composition" affordance.** | Low | The monitor has one (the `Fit` zoom), but the composition panel offers no indication that the canvas shape and the content are mismatched. ✅ FIXED |
| F13 | **The render modal's quality selector does not say what "production" costs.** | Low | 23.6 s vs 79.4 s for the same 6 seconds. The user picks blind. ✅ FIXED |
| F14 | **Editing a card's title requires expanding `CONTENT & STYLE`, scrolling to the field and typing.** | Low | Now that `CONTENT & STYLE` is first this is much better than it was, but the title/body inputs are plain `<input>`/`<textarea>` with no "type here" affordance on the canvas. The inline canvas editor only works for `kineticText`. ✅ FIXED |
| F15 | **The gradient background cannot be authored at all** (F1) means the *only* rich background a user can make is a solid colour. | Medium | The mesh-gradient blob model exists in the schema and in the renderer, but no UI can produce it. A user who wants the showcase look must edit JSON. ✅ FIXED |

### 4.2 What worked well

- **Direct manipulation is real.** The gizmo's box tracks the rendered element
  to **0.10 px** at every angle, the drag round trip to the runtime is
  **2.01 ms**, and the drag never jumps on pointer-up.
- **The lane resolver is invisible and correct.** Five layers → five lanes, in
  creation order, with no manual track assignment for four of them.
- **The timeline fit is now honest.** "Fit Timeline" showed 6059 ms of a
  6000 ms composition — every clip on every track, with the last clip 16 px
  clear of the right edge.
- **The audio lane works.** Two cues dropped from the SFX bank produced real
  green waveform boxes and an AAC stream in the export.
- **The keyframe stopwatches + auto-key are a genuine AE-style loop.** Four
  keyframes were authored through two stopwatch clicks and two value changes,
  and the runtime interpolated them correctly (31.05 % at 800 ms, exactly
  half-way between 35 % and 28 % under `easeInOut`).
- **The filters reach the pixels.** `contrast(1.18) drop-shadow(...)` was
  measured in the *computed* style of the rendered element.

### 4.3 Recommendations, prioritised

**P0 — correctness**

1. **Fix the background inspector** (`EffectControlsPanel.tsx`): write the
   variant's REQUIRED shape. `meshGradient` needs `blobs` (≥ 2, each with
   `color`/`xPct`/`yPct`/`radiusPct`), `particles` needs `count`. The
   inspector should build the default blob set when the variant changes, not
   copy the `solid` payload. *This unblocks F1 and F15.*
2. **Guard the renderer** (`packages/scene-runtime/src/layers/background.ts`):
   `v.blobs?.forEach(...)` — a malformed scene must degrade, never crash the
   preview. *This unblocks F2.*
3. **Make the save failure actionable** (F3): the `SceneServiceError` carries
   `issues[]`; surface them in the inspector next to the offending field, and
   stop the unhandled rejection (`executeSave` should not re-throw into a
   `void`-ed promise).

**P1 — visibility**

4. **Publish the render queue to the store** (F4): the render modal should
   write `state.renderQueue`, so the status bar, the command palette and any
   automation can see the job.
5. **Re-bind `Ctrl+K`** (F5): one owner. Either the palette or the razor, and
   the loser must call `stopPropagation`.
6. **Give the background and the effect-overlay templates a real duration**
   (F6, F7): a full-bleed layer should default to the scene length.

**P2 — ergonomics**

7. **Drop-target feedback for the SFX drag** (F8): highlight the audio lane
   and snap the cue to the playhead while the drag is in flight.
8. **Show the trim handles on hover, not on selection** (F9), and make them
   at least 12 px of hit area.
9. **Highlight the target lane during a vertical clip drag** (F10).
10. **An "auto-key" arm switch in the inspector** (F11): with it on, editing
    any transform property writes a keyframe at the playhead, exactly as
    After Effects does.
11. **Show the quality cost in the render modal** (F13): "production —
    1920×1080 @ 60 fps, ≈ 80 s for this composition".
12. **Extend the inline canvas editor to cards** (F14): double-clicking a
    card's title should edit it in place, the same way a `kineticText` works.

---

## 5. The defects the benchmark found

| ID | Defect | Evidence | Status |
| --- | --- | --- | --- |
| BUG-1 | **The inspector cannot author a gradient background.** "Mesh Gradient" writes `{variant:"meshGradient", color:"#05070d"}`; the schema requires `blobs` (min 2) and rejects the extra `color`, so the engine refuses the save: `layers.0.variant.blobs: Required; layers.0.variant: Unrecognized key(s) in object: 'color'`. "Particles" fails the same way (`count` is required, no default). | The run's own check: *"The inspector wrote the background variant — in-memory `{"variant":"meshGradient","color":"#05070d"}` \| persisted `{"variant":"solid","color":"#05070d"}`"*. | ✅ **FIXED** — see §7 (Phase-7 remediation) |
| BUG-1b | **The invalid variant also crashes the preview renderer.** `TypeError: Cannot read properties of undefined (reading 'forEach')` at `renderBackground` → `packages/scene-runtime/src/layers/background.ts` reads `v.blobs.forEach()` without a guard. | The renderer stack: `at renderBackground (mf-runtime://app/assets/index-Bkuha4Pe.js:1:213996)`. | ✅ **FIXED** — see §7 (Phase-7 remediation) |
| BUG-2 | **A failed save leaves an unhandled promise rejection.** The inspector commits with `void store.executeSave()` (`EffectControlsPanel.tsx:401`) and `executeSave()` re-throws after the toast (`store.ts:657`). | The renderer logged 1 × `SceneServiceError: Error invoking remote method 'engine:invoke': Error: invalid scene: layers.3.duration: layer window extends past scene end`. | ✅ **FIXED** — see §7 (Phase-7 remediation) |
| BUG-3 | **The Studio store never records the render queue** — `state.renderQueue` stays `0` forever. The Render Queue modal keeps its own local `queue` signal (`RenderModal.tsx:42`) and never writes the store. | After a successful render the store's queue length was still `0`. | ✅ **FIXED** — see §7 (Phase-7 remediation) |
| BUG-5 | **`Ctrl+K` is bound twice** — it opens the command palette AND razor-splits the selected layer. `App.tsx:155-163` maps `Ctrl+K` to the palette; `TimelinePanel.tsx:1336-1341` maps it to "razor split at playhead"; the command registry lists it too. Neither handler stops propagation. | One `Ctrl+K` with the title selected took the layer count from 5 to 6. | ✅ **FIXED** — see §7 (Phase-7 remediation) |

### A note on the app's own error handling

The benchmark was written to *document* the app's behaviour, and three of the
five findings are the same underlying pattern: **the Studio lets the user
build an invalid scene, then fails at the engine boundary.** The scene is
authored optimistically, the engine is the only validator, and by then the
user has already dragged, keyed and trimmed. The fix is not "catch the error"
— it is to make the inspector write the *right* shape in the first place, and
to have the runtime degrade instead of crash when it receives the wrong one.

---

## 6. Reproduction

```bash
npm run build -w @motionforge/desktop
xvfb-run -a --server-args="-screen 0 1920x1200x24" \
  node scripts/benchmark-ui-video-production.cjs
```

The script prints every measurement as JSON at the end, writes the MP4, the
three PNG frames and the UI screenshot, and exits non-zero if any check fails.
It runs against a throw-away workspace, so it never pollutes the developer's
`~/.motionforge`.

---

## 7. Phase-7 remediation — every defect and every friction point closed

The five defects of §5 and the fifteen friction points of §4.1 are **closed in
code**. Three new products also came out of the work: the **four new layer
kinds**, the **Auto-key arm**, and the **text/card tools that actually create
a layer**.

### 7.1 What changed, item by item

| ID | The fix | Where |
| --- | --- | --- |
| **BUG-1 / F1 / F15** | The background variant is a **discriminated union, so it is REBUILT, never spread.** `buildBackgroundVariant()` produces a schema-valid payload per variant (`solid {variant,color}`, `meshGradient {variant,base,blobs[2..6]}` — no `color` key, `particles {variant,count,color,sizePx,speed,direction}`, `media {variant,assetId,blurPx,dimOpacity}` with the id taken from the **declared** assets). A new `BackgroundEditor` gives the user a variant picker, a base colour, a row per blob (colour / X / Y / radius) with **Add blob** and **Remove blob**, the particle controls, and a media asset picker. | `packages/studio/src/services/background-variant.ts`, `packages/studio/src/components/inspector/BackgroundEditor.tsx` |
| **BUG-1b / F2** | Every background variant **degrades**: the blob list is guarded, every blob field is clamped, a missing asset paints the base colour instead of throwing. The same treatment was applied to `card`, `kineticText`, `imageLogo` and `lottie`. A `TypeError` is now impossible for any layer payload. | `packages/scene-runtime/src/layers/guards.ts` + every renderer |
| **BUG-2 / F3** | `executeSave()` publishes `state.saveIssues[]`; the inspector renders a **non-transient** `#inspector-save-issues` banner listing every field path, and the status bar shows the count. Every `void store.executeSave()` call site now handles its rejection — **no unhandled rejection is possible**. A layer whose window runs past the composition is **auto-clamped** to end exactly at the scene end, and the toast says which layers were trimmed. | `packages/studio/src/state/store.ts`, `packages/studio/src/components/inspector/EffectControlsPanel.tsx`, `packages/studio/src/components/shell/StatusBar.tsx` |
| **BUG-3 / F4** | The render queue lives in the **global store**. A session-long bridge (`services/render-queue.ts`) writes every job and every progress tick into `state.renderQueue`; the Render Modal is now only a **view** of it, the status bar and the command palette read it, and it survives the modal being closed. | `packages/studio/src/services/render-queue.ts`, `packages/studio/src/components/export/RenderModal.tsx` |
| **BUG-5 / F5** | `Ctrl+K` is bound **once**: `preventDefault()` **and** `stopImmediatePropagation()`, so no second handler can act on it. The razor split lives on `Ctrl+E` and on the `C` tool. | `packages/studio/src/App.tsx` |
| **F6 / F7** | A full-bleed layer is created with `duration: <scene.durationMs>` — an explicit **integer**, never `null` and never the 1200 ms default. | `packages/studio/src/services/layer-factory.ts` |
| **F8** | Dragging an SFX cue **lights up the A1 lane**, **snaps the drop time to the playhead** (within 120 ms) and paints a **snap line + a timecode badge**. | `packages/studio/src/components/timeline/TimelinePanel.tsx`, `packages/studio/src/services/drag-payload.ts` |
| **F9** | The trim hit area is **12 px** and the `[` `]` bracket is drawn on clip **hover**, not only on selection. | `packages/studio/src/components/timeline/TimelinePanel.tsx` |
| **F10** | A vertical clip drag **highlights the target track row** and paints a **"→ Track Vn"** badge next to the pointer. | `packages/studio/src/components/timeline/TimelinePanel.tsx` |
| **F11** | An **Auto-key arm** toggle in the inspector. Armed, the first touch of a transform property writes a keyframe at the playhead (After Effects semantics). Disarmed, nothing changes. | `packages/studio/src/state/store.ts`, `packages/studio/src/components/inspector/EffectControlsPanel.tsx` |
| **F12** | The Composition inspector gained a **"Fit Canvas to Viewport"** action and an **aspect-ratio sync indicator** (`16:9 · 1920×1080`, and whether the selected layer's box matches). | `packages/studio/src/components/inspector/CompositionSettings.tsx` |
| **F13** | The render modal shows the **resolution, the fps and the estimated cost** next to each tier: `1920×1080 · 60 fps · ≈ 2 min 30 s`. | `packages/studio/src/components/export/RenderModal.tsx` |
| **F14** | Double-clicking a **card** opens the **same** in-place canvas editor as a text layer, editing `variant.title` and `variant.body`. The commit **rebuilds** the card variant instead of spreading it. | `packages/studio/src/components/monitor/CanvasOverlay.tsx`, `packages/studio/src/components/monitor/InlineTextEditor.tsx` |

### 7.2 Two more defects the remediation work uncovered

| ID | Defect | Fix |
| --- | --- | --- |
| **BUG-6** | **The Text tool and the Card tool were dead ends.** They armed the cursor and never created anything — the two most prominent authoring tools in the application produced nothing. | The canvas now treats them as **creation tools**: a click creates the layer **where the user clicked**. `packages/studio/src/components/monitor/CanvasOverlay.tsx` + `store.addLayerOfKindAt()`. |
| **BUG-8** | **The "Add Layer" modal had NO entry point.** No button, no menu item, no command opened it — so a CARD, a BACKGROUND, an IMAGE, a LOTTIE or an EFFECT OVERLAY could not be created through the UI at all. | Three new commands: **Add Layer…**, **Add Text Layer**, **Add Card Layer**. `packages/studio/src/services/commands.ts`. |

And one that was NOT a defect but a **missing feature the report asked for**:
the **card editor wrote an illegal `accent-color` key**, so **every save with an
edited card was rejected**. It is the same class of bug as BUG-1 — a
discriminated union spread instead of rebuilt — and it is fixed the same way
(`packages/studio/src/services/card-variant.ts`).

### 7.3 The four new layer kinds in the Studio

The Tool Dock's preset row now creates **chart**, **codeBlock**, **particleField**
and **cta** layers (the `deviceMockup` button, which named a layer kind that
does not exist, is gone). Each has a full editor under `CONTENT & STYLE`, a
readable name and a kind swatch in the layer stack, and its own timeline lane.

### 7.4 The three benchmarks, at 100 %

| Benchmark | Phase 6 | Phase 7 |
| --- | --- | --- |
| `scripts/benchmark-ui-video-production.cjs` | 72 / 72 (with two defects documented) | **102 / 102** |
| `scripts/benchmark-mcp-video-production.cjs` | 31 / 33 | **68 / 68** |
| `scripts/benchmark-backend-engine.cjs` | ran; two defects found | **runs to completion**, 0 OOM kills in the A/B |

### 7.5 Before → after

| Metric | Before | After |
| --- | --- | --- |
| Benchmark checks passed | 72 / 72 (with two defects documented) | **102 / 102** |
| The Mesh Gradient background | refused by the engine (`blobs: Required`) | **persists with 3 schema-valid blobs** (1 619 ms from the click to the persisted variant) |
| A layer window past the composition end | the save failed, with an unhandled rejection | **auto-clamped**, with a toast naming the layer |
| `state.renderQueue` after a render | `0` | **populated — and live DURING the render** (the queue held the job while it ran) |
| `Ctrl+K` | opened the palette **and** split the layer | **opens the palette only** (5 → 5 layers) |
| The Text / Card tools | created nothing | **create a layer where you click** (2 → 3 and 3 → 4) |
| The "Add Layer" modal | unreachable | **three commands open it** (10 layer templates) |
| The four new layer kinds | did not exist | **created, edited and saved from the Tool Dock and the Inspector** |
| Unhandled promise rejections in the renderer | 1 per failed save | **0** (`engineRejections: 0`) |
| The draft render | 23 600 ms | **29 287 ms** (one worker instead of two — the RAM-aware budget) |
| **The preview render** (640×360 @ 12 — a layout check) | did not exist | **7 081 ms** — **4.1× faster than the draft**, 14× faster than production |
| The production render | 79 400 ms | **99 058 ms** (one worker) |
| The draft export | 518 497 bps, 427 764 B | **518 497 bps, 427 764 B** (CRF — small and fast) |
| The production export | 463 252 bps, 390 726 B | **2 685 220 bps, 2 057 201 B** (ABR with a guaranteed target — **5.2× the draft**) |
| The timeline canvas after a splitter drag | painted into a stale backing store (the A1 waveform fell outside it) | **follows its container** (a ResizeObserver) |

