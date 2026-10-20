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

## Regression ledger

| Date | Change | Tests | Typecheck | Build | Electron |
| --- | --- | --- | --- | --- | --- |
| 2026-10-20 | v3.0 rebuild — Phase 0 + Phase 1 | 350 → 400 passing | 0 errors (6 workspaces) | 0 errors | pending Phase 3 |
| 2026-10-20 | v3.0 rebuild — Phase 2 (Studio modular rebuild) + Phase 3 | 400 → 421 passing | 0 errors (6 workspaces) | 0 errors | ✅ 60/60 E2E checks |
