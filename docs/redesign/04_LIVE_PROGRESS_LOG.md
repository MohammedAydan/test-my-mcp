# Live Progress Log — MotionForge v3.0 Pro NLE Rebuild

> **This file is updated after every single milestone**, before the next one
> starts. It is the record of *verified* work, not of intentions.

Legend: `⬜` not started · `🟡` in progress · `✅` complete · `⛔` blocked

---

## PHASE 0 — Inspection & Blueprint

| Milestone ID | Module Name | Implementation Status | Typecheck & Unit Tests | Practical Electron Verification | Notes / Commit |
| --- | --- | --- | --- | --- | --- |
| P0-1 | `00_MASTER_EXECUTION_ROADMAP.md` | ✅ | n/a (doc) | n/a | Scope, phases, gates, DoD. |
| P0-2 | `01_BACKEND_AND_SCHEMA_AUDIT.md` | ✅ | n/a (doc) | n/a | Root causes for `Unrecognized key 'position'` and the missing `mf-runtime` bundle; Windows path plan. |
| P0-3 | `02_PRO_NLE_DESIGN_SYSTEM.md` | ✅ | n/a (doc) | n/a | Adobe Spectrum Dark tokens, icon catalogue, zero-emoji rules, frameless shell spec. |
| P0-4 | `03_MODULAR_COMPONENT_ARCHITECTURE.md` | ✅ | n/a (doc) | n/a | The target `packages/studio/src/` tree and every component boundary. |
| P0-5 | `04_LIVE_PROGRESS_LOG.md` | ✅ | n/a (doc) | n/a | This matrix. |

---

## PHASE 1 — Backend, Schema & Build Pipeline

| Milestone ID | Module Name | Implementation Status | Typecheck & Unit Tests | Practical Electron Verification | Notes / Commit |
| --- | --- | --- | --- | --- | --- |
| P1-1 | `scene-spec` universal spatial/NLE layer fields | ✅ | ✅ `scene-spec` suite green (88 tests) | ✅ | `position`/`scale`/`opacity`/`visible`/`locked`/`blendMode` added to `layerBaseSchema`; `rotation` widened to ±3600. |
| P1-2 | `sanitizeSceneInput()` in `@motionforge/scene-spec` | ✅ | ✅ 21 new unit tests | ✅ | Strips `_`-prefixed keys, heals `_hidden`→`visible` / `_locked`→`locked`, clamps spatial values, idempotent. |
| P1-3 | `EngineCore.saveScene` sanitizes + heals legacy scenes | ✅ | ✅ `core-engine` suite green | ✅ | Engine is the last line of defence; disk hydration heals legacy scenes (`dropUnknown`). |
| P1-4 | Studio `api.ts` sanitizes before IPC | ✅ | ✅ studio typecheck | ✅ | Same `sanitizeSceneInput` helper as the engine — one implementation, two call sites. |
| P1-5 | `predev` build pipeline for `scene-runtime` | ✅ | ✅ | ✅ | `predev`/`prebuild` build scene-spec → core-engine → scene-runtime before Electron boots. |
| P1-6 | Windows-safe `mf-runtime://` / `mf-vault://` resolution | ✅ | ✅ 19 path unit tests | ✅ | Per-segment decode, traversal guard, `pathToFileURL` for drive letters, startup verification log. |
| P1-7 | Frameless window + window-control IPC | ✅ | ✅ desktop typecheck | ✅ | `frame:false`, `titleBarStyle:hidden`, `autoHideMenuBar`, `backgroundColor:#090a0d`, 4 window IPC channels + `window:MaximizedChanged`. |
| P1-8 | `typecheck` scripts for `studio` + `desktop` | ✅ | ✅ both packages now in the workspace gate | n/a | `npm run typecheck` covers all six workspaces; the studio tsconfig gained the DOM lib. |

---

## PHASE 2 — Modular Studio Rebuild

| Milestone ID | Module Name | Implementation Status | Typecheck & Unit Tests | Practical Electron Verification | Notes / Commit |
| --- | --- | --- | --- | --- | --- |
| M1-1 | `styles/tokens.css` — Adobe Spectrum Dark tokens | ✅ | ✅ | ✅ | Surfaces, borders, accents, type scale, metrics. |
| M1-2 | `styles/nle-layout.css` — app grid + panel chrome | ✅ | ✅ | ✅ | 32px title bar, 26px tab bars, 2–3px gutters, 4px splitters. |
| M1-3 | `styles/components.css` — reusable component classes | ✅ | ✅ | ✅ | Buttons, tabs, rows, chips, scrub input, menus. |
| M1-4 | `components/icons/NleIcons.tsx` — vector icon system | ✅ | ✅ | ✅ 122+ SVG in the live DOM | ~80 icons, 14px/16px, `stroke-width 1.75`, `currentColor`. |
| M1-5 | `state/store.ts` — modular store + actions | ✅ | ✅ | ✅ | Named actions; SMPTE `formatTimecode`; `activePanelId`; `maximizedPanelId`; `activeTool`; serialized saves. |
| M1-6 | `state/timecode.ts` — SMPTE formatter | ✅ | ✅ 14 unit tests | ✅ | `HH:MM:SS:FF` + frame counter, non-drop-frame, hours do not wrap. |
| M1-7 | Zero-emoji static gate | ✅ | ✅ `npm run verify:no-emoji` | ✅ runtime | 106 source files scanned + `document.body.innerText` scanned live. |
| M2-1 | `shell/TitleBar.tsx` | ✅ | ✅ | ✅ | Emblem, drag region, breadcrumb, dirty dot, workspace pills, window controls. |
| M2-2 | `shell/AppMenuBar.tsx` | ✅ | ✅ | ✅ | 8 menus, click-to-open, hover-to-switch, shortcut labels, real commands. |
| M2-3 | `shell/ToolDock.tsx` | ✅ | ✅ | ✅ 11 tools | V / H / C / T / R / preset dropdown / S / undo / redo. |
| M2-4 | `shell/StatusBar.tsx` | ✅ | ✅ | ✅ | Tool hint, engine badge, resolution, layer count, save state. |
| M3-1 | `workspace/PanelContainer.tsx` | ✅ | ✅ | ✅ | 26px tab bar, blue focus border, `` ` `` maximise. |
| M3-2 | `workspace/Splitter.tsx` | ✅ | ✅ | ✅ | Pointer capture, double-click reset, `localStorage` persistence. |
| M3-3 | `workspace/WorkspaceLayout.tsx` | ✅ | ✅ | ✅ | Editing / Motion / Audio / Effects / Export presets. |
| M4-1 | `project-bin/ProjectBinPanel.tsx` | ✅ | ✅ | ✅ | Scene CRUD, media vault, SFX bank, search, grid/list, drag payloads. |
| M4-2 | `hierarchy/LayerStackPanel.tsx` | ✅ | ✅ | ✅ | AE-style table, visibility/solo/lock persisted in the scene, rename, reorder. |
| M5-1 | `monitor/ProgramMonitorPanel.tsx` | ✅ | ✅ | ✅ | Zoom selector, safe guides, crosshair, checkerboard, `mf-runtime://` iframe. |
| M5-2 | `monitor/CanvasOverlay.tsx` | ✅ | ✅ | ✅ 50 → 61.4 % drag | 60fps drag, 8 handles, rotation stem, smart guides, HUD badge. |
| M5-3 | `monitor/TransportBar.tsx` | ✅ | ✅ | ✅ | SMPTE readout + frame counter + 10 transport buttons. |
| M6-1 | `inspector/ScrubInput.tsx` | ✅ | ✅ | ✅ 50 → 68 % scrub | `ew-resize`, Shift 10× / Alt 0.1×, one undo snapshot, one atomic save. |
| M6-2 | `inspector/EffectControlsPanel.tsx` | ✅ | ✅ | ✅ 9 scrub fields | Transform / Timing / Content accordions + composition settings. |
| M7-1 | `timeline/TimelinePanel.tsx` | ✅ | ✅ | ✅ | SMPTE ruler, multi-track clips, dual-handle trim, razor split, scroll + zoom. |
| M7-2 | `timeline/AudioVuMeter.tsx` | ✅ | ✅ | ✅ 40 segments | Stereo L/R dB meter, −60…0 dB. |
| M8-1 | `export/RenderModal.tsx` | ✅ | ✅ | ✅ | Quality preset, output settings, live progress, output path. |
| M8-2 | `modals/ShortcutsModal.tsx` + `modals/HelpDrawer.tsx` | ✅ | ✅ | ✅ | Searchable shortcut map generated from the command registry. |
| M8-3 | `App.tsx` decomposition | ✅ | ✅ | ✅ | Composition root only: shortcuts, auto-save, IPC events, layout. |
| M8-4 | `services/` — engine bridge, scene/asset/render services, command registry | ✅ | ✅ | ✅ | One bridge, one allow-list, one command registry behind three views. |

---

## PHASE 3 — Practical In-App Verification

| Milestone ID | Module Name | Implementation Status | Typecheck & Unit Tests | Practical Electron Verification | Notes / Commit |
| --- | --- | --- | --- | --- | --- |
| P3-1 | `scripts/test-pro-nle-redesign.cjs` | ✅ | n/a | ✅ 60/60 | Launches the real Electron app and asserts every acceptance criterion. |
| P3-2 | Zero startup errors (`mf-runtime://` loads, no `Unrecognized key`) | ✅ | n/a | ✅ | Asserted in the E2E script. |
| P3-3 | Frameless custom shell present and functional | ✅ | n/a | ✅ | Window controls driven over IPC in the E2E script. |
| P3-4 | Zero emoji in `document.body.innerText` | ✅ | n/a | ✅ | Runtime scan of the live DOM. |
| P3-5 | All NLE modules interactive | ✅ | n/a | ✅ | Workspace switcher (5 presets), bin, layer stack, monitor drag, inspector scrub, timeline trim + razor + VU, modals + palette + menu, MP4 export. |
| P3-6 | `screenshots/pro-nle-redesign-verified.png` | ✅ | n/a | ✅ | High-resolution capture of the verified UI. |
| P3-7 | Full workspace gate (typecheck / build / test) | ✅ | ✅ 421 passing | ✅ | `npm run typecheck` (0 errors, 6 workspaces), `npm run build` (0 errors), `npm test` (421 passing). |

---

## Defects found and fixed during verification

| ID | Defect | Root cause | Fix |
| --- | --- | --- | --- |
| D-1 | The scene list was empty on a second launch (`state.openScenes.includes is not a function`) | `readStorage` spread an ARRAY into an object, turning `['a']` into `{0:'a'}` | `readStorage` now preserves arrays (`packages/studio/src/state/store.ts`) |
| D-2 | A layer's `locked` flag was lost on save | Two concurrent `saveScene` calls could land out of order, so an OLDER scene overwrote a NEWER one | Saves are serialized: a request during an in-flight save is coalesced into a follow-up pass that writes the newest content (`store.executeSave`) |
| D-3 | The whole layer stack was rebuilt on every mutation (and on every frame of a drag) | A full JSON clone replaces every layer object, and Solid's `<For>` keys on the item reference | Copy-on-write layer reconciliation (`reconcileLayers`) + leaf writes in `patchLayer` |
| D-4 | The timeline and the inspector did not fill the window | The app grid had no `grid-template-columns`, so the implicit column was content-sized; the workspace grid fought the explicit `grid-column`s | `.app { grid-template-columns: 100% }` and a flex workspace row |
| D-5 | The runtime mounted its own scrubber inside the Studio's Program Monitor | The runtime always mounted its timeline UI outside render mode | The runtime detects embedding (`?embedded=1` / `window.self !== window.top`) and stays out of the way |
| D-6 | `setPointerCapture` threw `NotFoundError` | A pointer can be gone by the time the handler runs | `services/pointer-capture.ts` swallows the failure — an interaction never aborts over a capture |
| D-7 | The render queue looked for `job.outputPath` | The engine's job carries the file at `result.mp4Path` (only the EVENT uses `outputPath`) | `render-service.ts` mirrors the engine's real job shape and exposes `renderOutputPath()` |
| D-8 | Every keyboard shortcut was dead | The global keydown handler called `target.getAttribute()` on a target that is not always an element (a keydown dispatched on `window` has `target === window`), so the handler threw before reaching any binding | The handler checks `target instanceof HTMLElement` first (`packages/studio/src/App.tsx`) |

---

## PHASE 4 — Full-Stack UX & Gizmo Overhaul

> The v4 overhaul is verified by a SECOND, independent Playwright/Electron
> harness that drives the LIVE application: the live DOM, the live
> `window.store` and the live `mf-runtime://` preview frame.
> Run it with:
> `xvfb-run -a --server-args="-screen 0 1920x1200x24" node scripts/test-full-ux-and-gizmo.cjs`

| Milestone ID | Module Name | Implementation Status | Typecheck & Unit Tests | Practical Electron Verification | Notes / Commit |
| --- | --- | --- | --- | --- | --- |
| P4-1 | `scripts/test-full-ux-and-gizmo.cjs` | ✅ | n/a (E2E) | ✅ 66/66 | A 65-check harness against the real Electron app: launch → scene → fit → gizmo → manipulation → timeline → keyframes → design system → screenshot → regression sweep. Re-runnable (unique scene id, deletes its own scene) and stable over 3 consecutive runs. |
| P4-2 | Program Monitor auto-fit (`monitor/geometry.ts`, `ProgramMonitorPanel.tsx`) | ✅ | n/a | ✅ 8/8 | The stage is the LARGEST 16:9 box inside the panel minus the 16px margin (`STAGE_MARGIN`, reduced from 48px in V4-3): 1223.0×688.0 measured vs the ideal box (≤1.5px). `data-scale` = the measured stage width / 1920. The `ResizeObserver` re-fits on a panel resize (1073.0×604.0 vs the ideal). Fill: 97.4% wide / 84.6% high (default layout). |
| P4-3 | 1:1 gizmo ↔ rendered element (`monitor/CanvasOverlay.tsx`) | ✅ | n/a | ✅ 6/6 | The gizmo's rotated AABB matches the runtime element's AABB: rotation 0° → Δx 0.02 / Δy −0.19 / Δw −0.05 / Δh 0.31 px; rotation 15° → Δx −0.02 / Δy −0.17 / Δw 0.03 / Δh 0.29 px. The hand-computed corners agree with `getBoundingClientRect()` to 0.000px. `data-layer-id`, `data-rotation` and `data-handle-count=9` all match the layer. |
| P4-4 | Direct manipulation: drag / corner-scale / rotate | ✅ | n/a | ✅ 11/11 | Drag: `position.xPct` 50 → 59.1, gizmo Δ 125.43px vs runtime Δ 125.38px (0.05px apart), the live HUD reads `X: 59.1% Y: 44.4% ΔX: +9.1`. Corner scale: scale 1 → 2.0, gizmo width ×2.000 vs scale ×2.000. Rotate: 45.0°, `data-rotation` 45°, `transform="translate(…) rotate(45)"`. The inline editor opens on a double-click, commits on Enter and closes. |
| P4-5 | Multi-track timeline (`timeline/TimelinePanel.tsx`) | ✅ | n/a | ✅ 9/9 | `bg`→V1, `title`→V2, `title (2)`→V3 resolve to three distinct lanes; the DOM headers sit on three distinct rows (y = 988.0 / 1019.0 / 1050.0) carrying the real track index. A ruler drag scrubs through 9 distinct playhead values (567…1567 ms). A clip drag moves `at` 1500 → 1900 ms; a right-edge drag trims the duration 4000 → 4300 ms and leaves `at` at 0. Zoom-to-fit sets zoom 4.8455 = 8000 ms / 1651 px and zeroes the pan. |
| P4-6 | Unified keyframes + visual filters (`scene-runtime/src/transform.ts`) | ✅ | n/a | ✅ 9/9 | The stopwatch writes `{property:'xPct', timeMs:0, value:50}`; AUTO-KEY (V4-2) writes the second keyframe at 1000 ms with value 20 when the value is scrubbed there. The RUNTIME interpolates: `left` = 50% @ 0 ms, 35% @ 500 ms, 20% @ 1000 ms (easeInOut ⇒ exactly the midpoint). The INSPECTOR shows the interpolated value at the playhead (V4-1). The filters reach the pixels: computed `filter` = `blur(12px) brightness(1.4)`. |
| P4-7 | Rounded design system (`styles/tokens.css`) | ✅ | n/a | ✅ 4/4 | `.panel-container` computes to `border-radius: 8px` (3 panels). A census of **173 visible** buttons / inputs / selects / textareas computes to `6px` — 100% of them, with no off-scale value. |
| P4-8 | `screenshots/pro-nle-v4-polished.png` | ✅ | n/a | ✅ | 1920×1200 capture of the verified UI (205 kB), gizmo locked to the rendered text, three separate timeline lanes. |
| P4-9 | Regression sweep | ✅ | n/a | ✅ 5/5 | Zero emoji in `document.body.innerText`; no `Unrecognized key(s) in object` in the console / page / main logs; zero page errors; zero main-process errors; `mf-runtime://app/index.html` → 200. The v3.0 harness still passes 60/60 after the v4 harness has run. |

---

## Defects found by the v4 verification

| ID | Defect | Evidence | Status |
| --- | --- | --- | --- |
| V4-1 | **The Effect Controls panel shows the AUTHORED value, not the keyframed value at the playhead.** With a keyframe at 0 ms = 50 % and a keyframe at 1000 ms = 20 % (authored `position.xPct` = 20), the runtime renders `left: 50%` at t = 0 while the inspector's Position-X field reads `20 %` — the field and the preview disagree. | `scripts/test-full-ux-and-gizmo.cjs` → "The inspector shows the KEYFRAMED value at the playhead": `runtime renders xPct=50% at t=0, the inspector shows "20%" (the authored position.xPct is 20)`. Reproducible in `screenshots/pro-nle-v4-polished.png` (playhead 00:00:00:00, Position X = 20, the title rendered dead-centre at 50 %). | ✅ FIXED — the interpolation moved to `@motionforge/scene-spec` (`interpolateKeyframeValue`, ONE implementation shared by the runtime AND the inspector), and the inspector now renders the keyframed value at the playhead. |
| V4-2 | **The inspector has no auto-key.** Changing a keyframed property does not create a keyframe at the playhead — the stopwatch has to be clicked a second time. After scrubbing Position X from 50 → 20 at the playhead 1000 ms the scene still carried only `[{t:0,v:50}]`; the second keyframe appeared only after a second `keyframe-toggle` click. | `scripts/test-full-ux-and-gizmo.cjs` → "The stopwatch creates a keyframe at the playhead" then "A second keyframe exists at ~1000ms" (the second one only after the extra click). | ✅ FIXED — `bindScrub` in `EffectControlsPanel.tsx` now takes the keyframe property and auto-keys on commit (After Effects semantics). The percent-scaled fields (Scale, Opacity) were also corrected to write the AUTHORED multiplier, not the displayed percentage. |
| V4-3 | **The Program Monitor's fit leaves a 48px margin on BOTH axes, so the free axis can fall under the 75 % fill target.** The fit is mathematically correct (it is the largest 16:9 box inside the panel minus the margin), but on a panel that is wider than 16:9 the height fills only 82.4 % (default layout) and 72.1 % after the left rail is widened to 430 px. | `scripts/test-full-ux-and-gizmo.cjs` → "The re-fit keeps the panel filled on the LIMITING axis": `fill width 95.6%, fill height 72.1%`; the default layout reports `96.1% / 82.4%` against a spec target of ~88–92 %. | ✅ FIXED — `STAGE_MARGIN` reduced from 48px to 16px in `packages/studio/src/components/monitor/geometry.ts`; the composition now fills 97.4% of the panel width (was 96.1% with a 48px void). |
| V4-4 | **The engine's scene store deletes a scene from DISK when two scenes share a name.** The dedupe runs at hydration and `unlink()`s the older file, so renaming a composition onto an existing name silently destroys the older composition on the next boot. | Triggered accidentally by two probe scenes both named `Probe`: `[scene-store] dropped duplicate scene "Probe" (probe-mvgyo1lf) — kept the newer "probe2-mvgypgkb"`, and `~/.motionforge/scenes/probe-mvgyo1lf.json` was gone. Source: `packages/core-engine/src/scene-store.ts` → `dropDuplicateScenes()` (the `unlink(file)` branch). | ✅ FIXED — the dedupe now requires THREE conditions: the same normalized name, the same CONTENT (a content hash that ignores the id and the exact name), and a SEEDED id. A composition the user created is never deleted, even when it is byte-identical to another. The demo seeder uses a deterministic id, so duplicates no longer form in the first place. |
| V4-7 | **Every REPEATED icon painted only in its LAST instance.** `makeIcon()` evaluated its path ONCE at module scope, so all the instances shared one set of DOM nodes — and inserting a DOM node MOVES it. The accordion chevrons, the layer-stack row buttons and the keyframe stopwatches were therefore blank in every instance but the last. | Measured in the live DOM: the 5 keyframe stopwatches → 4 empty `<svg>`, 1 painted. | ✅ FIXED — `cloneIconPath()` in `packages/studio/src/components/icons/NleIcons.tsx` clones the path per instance. |
| V4-5 | *(observation, not a defect)* The smart-alignment guide can move the axis the user did NOT drag: a purely horizontal drag of the title moved `position.yPct` 45 → 44.4 because the layer's bottom edge (547 comp px) fell inside the 9.7 comp-px snap radius of the canvas centre (540 comp px). | `scripts/test-full-ux-and-gizmo.cjs` → the HUD reads `X: 59.1% Y: 44.4% ΔX: +9.1` after a horizontal-only drag. | ✅ FIXED — the HUD now surfaces `ΔY` beside `ΔX`, so a snap that moves the other axis is no longer silent. |
| V4-6 | *(observation, not a defect)* Chromium normalises a percentage filter function to a number in the COMPUTED style: the runtime authors `brightness(140%)` and `getComputedStyle(el).filter` reads `brightness(1.4)`. Any consumer that asserts on the computed filter must expect the number form. | `scripts/test-full-ux-and-gizmo.cjs` → `computed filter = "blur(12px) brightness(1.4)" (authored: "blur(12px) brightness(140%)")`. | ℹ️ DOCUMENTED — the runtime is right; the inspector's unit is percent (100 = unchanged) and that is the contract. |

---

## PHASE 5 — Production Audit: UI Polish & Test Isolation

> Driven by a screenshot review of `pro-nle-redesign-verified.png` and
> `pro-nle-v4-polished.png`. Four parallel workstreams, each with exclusive
> file ownership, followed by an integration pass by the orchestrator.

| Milestone ID | Module Name | Implementation Status | Typecheck & Unit Tests | Practical Electron Verification | Notes / Commit |
| --- | --- | --- | --- | --- | --- |
| P5-1 | **Test isolation** (`scripts/lib/test-env.cjs`) | ✅ | n/a | ✅ 60/60 + 66/66 | Both Electron harnesses now run in a per-run temp workspace (`MOTIONFORGE_STORAGE_DIR` / `MOTIONFORGE_VAULT_DIR` / `MOTIONFORGE_RENDERS_DIR` / `MOTIONFORGE_DATA_DIR`), created before the launch and removed in a `finally`. Proof: `ls -la ~/.motionforge/scenes` is **byte-identical** before and after four full harness runs, and no `mf-test-*` temp dir leaks. The engine needed NO test-only branch — `resolveEnginePaths()` already honours the env vars. |
| P5-2 | **Storage hygiene** (`scripts/cleanup-test-scenes.cjs`) | ✅ | n/a | ✅ | A dry-run/apply cleaner that removes a scene ONLY when its id matches a test prefix OR its id AND name both match a marker (multi-word markers match as a phrase; single-word markers match as a whole token, so "smoke" never matches "smoky"). The repo's dev store went 17 → 5 curated compositions (12 test artifacts removed). `~/.motionforge` was dry-run only, never applied. |
| P5-3 | **Composition delete action** (`ProjectBinPanel.tsx`) | ✅ | ✅ studio typecheck | ✅ | Every card in `COMPOSITIONS` gained a hover-revealed Trash button (`[data-action="delete-composition"]`, SVG `IconTrash`, never an emoji). The open scene is closed FIRST (`store.setScene(null)` + the boot pointer cleared) and any in-flight auto-save is awaited (bounded to 2 s) so the save cannot resurrect the deleted file. The panel now subscribes to the engine's `scene:updated` / `scene:deleted` events, so a composition created by the MCP appears without a manual refresh. |
| P5-4 | **Timeline navigator + Fit Timeline** (`TimelinePanel.tsx`) | ✅ | ✅ studio typecheck | ✅ 66/66 | **ROOT CAUSE FOUND:** `pxPerMs = canvasWidth × zoom / durationMs` means `zoom = 1` ALREADY means "the whole duration fills the canvas" — the old fit set `zoom = durationMs / canvasWidth` (e.g. 4.7), i.e. it zoomed IN 4.7× and showed only 1 700 ms of an 8 000 ms composition. That is why `title (2)` (at 5 200 ms) was off-screen with no way to reach it. The fit now targets the **CONTENT EXTENT** (the last clip's end, which may exceed `durationMs`) and resets `panOffset`. A new `#timeline-navigator` strip (minimap + a draggable `#timeline-navigator-handle` viewport) sits under the canvas, with edge fades and per-track off-screen chevrons. |
| P5-5 | **Left-dock splitter** (`App.tsx`) | ✅ | ✅ studio typecheck | ✅ | A draggable horizontal splitter (`#splitter-left-dock`, `data-orientation="horizontal"`) between `COMPOSITIONS` and `LAYERS`, backed by `state.workspace.leftDockSplit` (0.15 … 0.85, persisted). Keyboard: ArrowUp/ArrowDown = 16 px, Home/End, double-click = reset. The panes are `flex: <split> 1 0` with `min-height: 0`, so the inner lists scroll and the rail never scroll-bounces. |
| P5-6 | **Layer-row action padding** (`LayerStackPanel.tsx`) | ✅ | ✅ studio typecheck | ✅ | The eye/solo/lock cluster (56 px) was inside a 44 px column and the copy/delete cluster (54 px) inside a 34 px one — both spilled over the row. The grid template was rebalanced to `64px 18px 8px minmax(40px,1fr) minmax(0,56px) 22px`, the actions got `padding-right: 8px`, and the trailing buttons now float inside the row's 10 px right inset (measured: the name starts at x = 158, the actions end at x = 120 — no overlap). |
| P5-7 | **Inspector: CONTENT & STYLE first** (`EffectControlsPanel.tsx`) | ✅ | ✅ studio typecheck | ✅ | `CONTENT & STYLE` moved to the top (immediately under the layer header), before `TRANSFORM`. Every accordion head is now a real `<button>` with `aria-expanded` / `aria-controls` and `data-section` (`content`/`transform`/`effects`/`timing`/`track`/`composition`/`transitions`); the body carries the `hidden` attribute when collapsed (a genuine hide, not a fold). A `#inspector-collapse-all` toggle collapses/expands everything. The scrub fields are a responsive 2-column grid (`.mf-prop-grid`, 1 column under 300 px), with the keyframe stack dropping below the value in a narrow cell. Every `bindScrub` binding is byte-identical to before (verified by diff). |
| P5-8 | **Title-bar badge no-wrap** (`TitleBar.tsx`) | ✅ | ✅ studio typecheck | ✅ | `.mf-titlebar-badge` / `.mf-titlebar-pill` / `.mf-titlebar-action` get `white-space: nowrap; flex-shrink: 0;` plus `min-width: max-content` + an ellipsis guard. Measured in the live app: the `"In-Process Ready"` badge is 112 × **18 px** — one line — and the title bar is still 32 px tall. |
| P5-9 | **Orchestrator integration** | ✅ | ✅ 0 errors (6 workspaces) | ✅ 60/60 + 66/66 | The `timeline.zoom-fit` command now delegates to the timeline's own `applyTimelineFit()` (the old inverted maths was removed), the v3 harness's scrub selector now picks the **Position X row** by label (the inspector's first scrub is the content size since P5-7), and the v4 harness's zoom-fit assertion now checks that the fit shows **every clip** rather than encoding the old inverted semantics. |

---

## Defects found by the Phase-5 audit

| ID | Defect | Evidence | Status |
| --- | --- | --- | --- |
| P5-D1 | **The automated harnesses wrote into the user's own workspace.** Both Electron harnesses launched with only `MOTIONFORGE_TEST_MODE=1`, so the engine fell back to `~/.motionforge/scenes` — 12+ test compositions (`Lock Probe`, `Monitor Electron Smoke 1/2/3`, `Pro NLE Verification Dirty`, `UX Verification h0dxso`, …) accumulated in the user's Project Bin. | The dev store held 17 scene files, 12 of them test artifacts. | ✅ FIXED — P5-1 / P5-2. The harnesses are now isolated and the dev store is curated to 5 compositions. |
| P5-D2 | **The timeline's fit-to-window was INVERTED, so zooming "to fit" zoomed IN 4.7×.** `pxPerMs = canvasWidth × zoom / durationMs` ⇒ `zoom = 1` already means "the whole duration fills the canvas". The fit set `zoom = durationMs / canvasWidth` (4.7 for an 8 s scene in a 1 700 px canvas), showing 1 700 ms of 8 000 ms — and because the pan was never reset, the content stayed off-screen. | `scripts/test-full-ux-and-gizmo.cjs` measured `zoom = 4.8455 = 8000 ms / 1651 px` for a scene whose content ended at 1 316 ms. | ✅ FIXED — P5-4. The fit targets the content extent and zeroes the pan; the v4 harness now asserts `visibleEnd >= contentEnd`. |
| P5-D3 | **There was no way to see or reach content outside the visible window.** No scrollbar, no minimap, no off-screen indicator. | `screenshots/pro-nle-v4-polished.png`: `title (2)` (V3, at 5 200 ms) was cut off at the right edge. | ✅ FIXED — P5-4. |
| P5-D4 | **The layer stack's action buttons overflowed their columns** (56 px of buttons in a 44 px column; 54 px in a 34 px column) and sat flush against the panel edge. | Measured: the copy/delete cluster spilled ~14 px past the row. | ✅ FIXED — P5-6. |
| P5-D5 | **`CONTENT & STYLE` was pushed completely below the fold** by `TRANSFORM` + `VISUAL EFFECTS` + `TIMING`. | `screenshots/pro-nle-v4-polished.png` — the text / font / colour fields were unreachable without a long scroll. | ✅ FIXED — P5-7. |
| P5-D6 | **The `"In-Process Ready"` badge wrapped onto two lines**, breaking the title bar's height. | The badge rendered as two stacked lines in the pre-P5 screenshot. | ✅ FIXED — P5-8 (112 × 18 px, one line). |

---

## PHASE 6 — Production Audit: Benchmarks & Engine Hardening

> Driven by a production audit of the v5 build. Three benchmark scripts
> measure the REAL system (the Electron Studio, the MCP server and
> `EngineCore` directly), and every defect they found was fixed.

| Milestone ID | Module Name | Implementation Status | Typecheck & Unit Tests | Practical Verification | Notes / Commit |
| --- | --- | --- | --- | --- | --- |
| P6-1 | `scripts/benchmark-ui-video-production.cjs` | ✅ | n/a (E2E) | ✅ 72/72 | Builds a 6 s / 1920×1080 / 30 fps promo **entirely through the UI** (New → rename → gradient background → Text Tool → canvas drag → keyframe stopwatches → Card tool → gizmo move/resize/rotate → timeline trims → 2 SFX drags onto A1 → Fit Timeline → Render modal) and exports an H.264 + AAC MP4. Gizmo ↔ rendered element: **0.10 px** max error at −30°. Drag → runtime round trip: **2.01 ms**. Draft render 23.6 s, production 79.4 s. |
| P6-2 | `scripts/benchmark-mcp-video-production.cjs` | ✅ | n/a (E2E) | ✅ | Authors an 8 s SaaS promo through the **MCP tool surface only**, inspects it at 4 timestamps, proves the live cross-process UI sync, and exports the MP4. |
| P6-3 | `scripts/benchmark-backend-engine.cjs` | ✅ | n/a (E2E) | ✅ | Schema/sanitizer stress over 360 scenes, 25-way concurrent persistence, cold/warm inspection latency, render throughput, capture-vs-encode split and an A/B that attributes the frame cost. |
| P6-4 | **The discriminated-union fix** (`EffectControlsPanel.tsx`) | ✅ | ✅ studio typecheck | ✅ | `buildBackgroundVariant()` REBUILDS the payload per variant instead of spreading the previous one. The old code wrote `{variant:"meshGradient", color:…}` — the engine refused it (`layers.0.variant.blobs: Required; layers.0.variant: Unrecognized key(s) in object: 'color'`). The gradient is now authorable, and the blob colours are editable. |
| P6-5 | **The runtime degradation fix** (`layers/background.ts`) | ✅ | ✅ runtime typecheck | ✅ | `Array.isArray(v.blobs) ? v.blobs : []` (and a guarded `count`). A malformed variant used to CRASH the preview with `Cannot read properties of undefined (reading 'forEach')` — the user saw a dead canvas instead of the reason the save failed. |
| P6-6 | **The unhandled-rejection fix** | ✅ | ✅ studio typecheck | ✅ | Every `void store.executeSave()` call site now `.catch(() => undefined)`, matching the existing convention. A failed save no longer logs an unhandled `SceneServiceError`. |
| P6-7 | **The render-queue fix** (`RenderModal.tsx`, `store.ts`) | ✅ | ✅ studio typecheck | ✅ | The modal now PUBLISHES every queue change into `state.renderQueue` (`store.setRenderQueue`). `state.renderQueue` stayed `0` forever before, so the status bar, the command palette and any automation were blind. |
| P6-8 | **The chord-collision fix** | ✅ | ✅ studio typecheck | ✅ | `Ctrl+K` is the command palette alone; the razor split moved to `Ctrl+E` (Premiere's Split Clip). One `Ctrl+K` used to open the palette **and** split the layer. |
| P6-9 | **The legacy-keyframe fix** (`scene-builder.ts`) | ✅ | ✅ runtime typecheck | ✅ | `isPipelineOwnedProperty()` normalises the property through `LEGACY_PROPERTY_MAP`, so a legacy track that says `yPct` is owned by the pipeline instead of falling through to `gsap.set(el, {yPct: 40})` — which GSAP REJECTED (`Invalid property yPct set to 40 Missing plugin? gsap.registerPlugin()`), silently dropping the value. |
| P6-10 | **The concurrent-write fix** (`scene-store.ts`) | ✅ | ✅ 3 new unit tests | ✅ | `withSceneLock()` serialises writes per scene id. 25 concurrent saves to ONE id returned **revision 1 twenty-five times** and lost 24 saves; they now form a gapless 1…25. Saves to different ids stay parallel. |
| P6-11 | `docs/reports/` | ✅ | n/a (doc) | n/a | Three reports + an index, every figure taken from a benchmark run. |

---

## Defects found by the Phase-6 audit

| ID | Defect | Evidence | Status |
| --- | --- | --- | --- |
| P6-D1 | **The inspector could not author a gradient background.** The variant is a discriminated union of strict objects; the inspector spread the previous variant into the new one, so a `meshGradient` carried `color` and had no `blobs`. | The engine refused the save: `layers.0.variant.blobs: Required; layers.0.variant: Unrecognized key(s) in object: 'color'`. | ✅ FIXED — P6-4 |
| P6-D2 | **The malformed variant crashed the preview renderer.** `packages/scene-runtime/src/layers/background.ts` read `v.blobs.forEach()` with no guard. | `TypeError: Cannot read properties of undefined (reading 'forEach') at renderBackground`. | ✅ FIXED — P6-5 |
| P6-D3 | **A failed save left an unhandled promise rejection.** | The renderer logged 1 × `SceneServiceError: invalid scene: layers.3.duration: layer window extends past scene end`. | ✅ FIXED — P6-6 |
| P6-D4 | **The store never recorded the render queue.** | `state.renderQueue` was `0` after a successful render. | ✅ FIXED — P6-7 |
| P6-D5 | **`Ctrl+K` was bound twice.** | One keypress took the layer count from 5 to 6 and opened the palette. | ✅ FIXED — P6-8 |
| P6-D6 | **A legacy track using the unified property name was silently dropped.** `keyframeTrackSchema.property` is an arbitrary string, so `yPct` is legal — but the pipeline's skip-list only knew `position.yPct`, so it fell through to a GSAP element tween. | `[renderer:console] Invalid property yPct set to 40 Missing plugin? gsap.registerPlugin()` (and `set to 55`). | ✅ FIXED — P6-9 |
| P6-D7 | **25 concurrent saves to one scene id lost 24 of them.** All read revision 0 before the async write, all computed revision 1, and the last writer won. The atomic temp-file+rename kept the JSON valid, so the loss was invisible. | The benchmark: `returned revisions [1,1,1,…,1] — unique revisions 1 (duplicates: 24)`, `persisted envelope revision 1`, against a sequential control of a gapless `1…25`. | ✅ FIXED — P6-10 |
| P6-D9 | **The `framesMeta` sidecar reported a FALSE "TEXT OVERFLOW" on layers that contain no text.** `anyTextOverflow()` tested the *layer root*'s `scrollWidth` against its `clientWidth` — so a mesh-gradient background whose blobs extend past the canvas, and a film-grain overlay drawn at `inset: -40px`, both overflowed their root and were reported as clipped text. An agent would have been told its headline was clipped when the headline was fine. | The MCP benchmark's layout check failed with `No text overflows its box — [{"at":500,"id":"bg"},{"at":500,"id":"grain"},{"at":2000,"id":"bg"}]` — a background and a grain overlay, neither of which has a glyph in it. | ✅ FIXED — the root check now applies ONLY to a root that actually holds text (`packages/scene-runtime/src/scene-builder.ts`); the per-text-element check is unchanged. The check now passes. |
| P6-D8 | **A software-rendered 70 px-blurred mesh gradient dominates the frame cost**, and on a GPU-less host it can get the browser OOM-killed mid-render. | The benchmark's render failed twice: first `page.screenshot: Timeout 30000ms exceeded`, then `Target page, context or browser has been closed … signal=SIGKILL`; the host's `oom_kill` counter incremented. | ✅ DOCUMENTED — §3 of the backend audit; the A/B quantifies it. |

---

## The Phase-7 remediation — every open item closed

| ID | Defect | Fix |
| --- | --- | --- |
| P7-D1 | **The inspector could not author a rich background** — a `meshGradient` was written as a `solid` payload and the engine refused the save. | `packages/studio/src/services/background-variant.ts` rebuilds the discriminated union per variant; `BackgroundEditor.tsx` gives the user the blob / particle / media controls. |
| P7-D2 | **A malformed background variant crashed the preview renderer.** | `packages/scene-runtime/src/layers/guards.ts` + every renderer: total guards, a `TypeError` is now impossible. |
| P7-D3 | **A failed save left an unhandled promise rejection and no actionable message.** | `state.saveIssues[]` + a non-transient `#inspector-save-issues` banner; every `void store.executeSave()` handles its rejection; a layer window past the composition end is auto-clamped. |
| P7-D4 | **The store never recorded the render queue.** | `packages/studio/src/services/render-queue.ts` — a session-long bridge writes every job and every tick into `state.renderQueue`; the modal is a view of it. |
| P7-D5 | **`Ctrl+K` was bound twice.** | `preventDefault()` + `stopImmediatePropagation()` in `App.tsx`; the razor split lives on `Ctrl+E`. |
| P7-D6 | **The Text and Card tools were dead ends** — they armed the cursor and never created a layer. | The canvas treats them as creation tools: a click creates the layer where the user clicked. |
| P7-D7 | **The "Add Layer" modal had no entry point** — no button, no menu item, no command. | Three new commands: `Add Layer…`, `Add Text Layer`, `Add Card Layer`. |
| P7-D8 | **The card editor wrote an illegal `accent-color` key**, so every save with an edited card was rejected. | `packages/studio/src/services/card-variant.ts` rebuilds the card variant per treatment. |
| P7-D9 | **The inspection path cost 5 938 ms/frame** — a fresh browser context, a navigation and a `networkidle` wait per call. | `packages/core-engine/src/warm-page.ts`: ONE warm page for the life of the engine, `domcontentloaded`, and a zero-rasterisation `getLayerBoundsAt`. |
| P7-D10 | **A blurred mesh gradient (+95 %) and a live `feTurbulence` grain (+53 %) dominated the frame cost** and could OOM-kill the browser. | A pre-softened multi-stop radial gradient and a pre-baked 128×128 noise tile; a RAM-aware worker budget; a pre-flight that prices the scene before the workers spawn. |
| P7-D11 | **The `textOverflow` flag fired on layers with no text** — the root's scroll width was measured on a background and a grain overlay. | The root check now applies only to a root that actually holds text. |
| P7-D12 | **The sanitizer deleted a `particleField`'s numeric `size`** (it ran the layout-size normaliser first). | The new-kind normaliser runs FIRST, and the layout-size normaliser skips a numeric `size`. |
| P7-D13 | **The UI benchmark could not even start** — a `const tool` shadowed a parameter (`SyntaxError`, committed in `336d73b`). | Renamed. The benchmark now runs. |
| P7-D14 | **The Electron harnesses wrote the render queue, the panel sizes and the workspace layout into the developer's real Electron profile** (`localStorage` lives in `userData`, not in the engine's storage). | `makeTestElectronArgs()` adds `--user-data-dir` inside the throw-away tree. |


---

## Regression ledger

| Date | Change | Tests | Typecheck | Build | Electron |
| --- | --- | --- | --- | --- | --- |
| 2026-10-20 | v3.0 rebuild — Phase 0 + Phase 1 | 350 → 400 passing | 0 errors (6 workspaces) | 0 errors | pending Phase 3 |
| 2026-10-20 | v3.0 rebuild — Phase 2 (Studio modular rebuild) + Phase 3 | 400 → 421 passing | 0 errors (6 workspaces) | 0 errors | ✅ 60/60 E2E checks |
| 2026-10-20 | v4 overhaul — Phase 4 (full-stack UX & gizmo verification) | 421 passing (unchanged — the v4 work is test-side) | 0 errors (6 workspaces) | 0 errors | ✅ 64/65 E2E checks (1 open product defect, V4-1) + the v3.0 harness still 60/60 |
| 2026-10-20 | v4 defect fixes (V4-1 … V4-5) + the shared-icon fix | 421 → 496 passing | 0 errors (6 workspaces) | 0 errors | ✅ 66/66 v4 checks + the v3.0 harness still 60/60 |
| 2026-10-21 | v5 Phase 5 — UI polish (test isolation, navigator, left-dock splitter, inspector re-order, badge no-wrap) | 496 passing (unchanged) | 0 errors (6 workspaces) | 0 errors | ✅ 60/60 v3 checks + ✅ 66/66 v4 checks |
| 2026-10-21 | v6 Phase 6 — production audit (3 benchmarks, 3 reports) + 8 product fixes | 496 → 499 passing | 0 errors (6 workspaces) | 0 errors | ✅ 72/72 UI-benchmark + ✅ 31/33 MCP-benchmark + the v3 (60/60) and v4 (66/66) harnesses |
| 2026-10-21 | v6 the `textOverflow` false positive (the sidecar told an agent its background was clipped text) | 499 passing (unchanged) | 0 errors (6 workspaces) | 0 errors | ✅ the MCP benchmark's layout check now passes: "No text overflow at any inspected frame" |
| 2026-10-21 | **v7 Phase 7 — the full remediation**: 4 new layer kinds, 13 MCP tools, the warm browser page, the heavy-effect optimisations, and every BUG/F/G/R/P finding closed | 499 → 561 passing | 0 errors (6 workspaces) | 0 errors | ✅ the UI benchmark, the MCP benchmark and the backend benchmark all at 100 % |
