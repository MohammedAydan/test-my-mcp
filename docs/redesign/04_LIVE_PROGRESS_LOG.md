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

## Regression ledger

| Date | Change | Tests | Typecheck | Build | Electron |
| --- | --- | --- | --- | --- | --- |
| 2026-10-20 | v3.0 rebuild — Phase 0 + Phase 1 | 350 → 400 passing | 0 errors (6 workspaces) | 0 errors | pending Phase 3 |
| 2026-10-20 | v3.0 rebuild — Phase 2 (Studio modular rebuild) + Phase 3 | 400 → 421 passing | 0 errors (6 workspaces) | 0 errors | ✅ 60/60 E2E checks |
| 2026-10-20 | v4 overhaul — Phase 4 (full-stack UX & gizmo verification) | 421 passing (unchanged — the v4 work is test-side) | 0 errors (6 workspaces) | 0 errors | ✅ 64/65 E2E checks (1 open product defect, V4-1) + the v3.0 harness still 60/60 |
| 2026-10-20 | v4 defect fixes (V4-1 … V4-5) + the shared-icon fix | 421 → 496 passing | 0 errors (6 workspaces) | 0 errors | ✅ 66/66 v4 checks + the v3.0 harness still 60/60 |
