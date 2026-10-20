# MotionForge v3.0 — Pro NLE Redesign & Modular Rebuild

> **Master Execution Roadmap**
> Target: an Adobe Premiere Pro / After Effects-grade desktop NLE, built as a
> monolithic in-process Electron application with zero HTTP surface.

---

## 1. Executive Summary

MotionForge already has a **working engine**: a declarative `SceneSpec` contract
(`@motionforge/scene-spec`), an in-process domain core (`@motionforge/core-engine`),
a deterministic browser runtime (`@motionforge/scene-runtime`) and an MCP authoring
surface (`@motionforge/mcp-server`). What it does **not** yet have is a *studio*
that a professional motion designer would recognise as a tool.

The v3.0 rebuild has two halves:

| Half | What changes | Why |
| --- | --- | --- |
| **Foundation (Phase 1)** | The schema accepts every spatial/NLE property the Studio writes; the build pipeline guarantees the runtime bundle exists before Electron boots; the shell is truly frameless and cross-platform. | Today the app *fails to save* on `layers.0` and *fails to boot* on Windows. A redesign on top of a broken foundation is a redesign of nothing. |
| **Surface (Phase 2–3)** | The Studio is decomposed into isolated, single-responsibility modules and restyled to the Adobe Spectrum Dark grade, with zero emoji and 100% vector SVG iconography. | "Pro" is a density, hierarchy and precision problem, not a colour problem. |

### Non-negotiable architectural invariants (unchanged by this rebuild)

1. **100% monolithic in-process execution.** No HTTP server, no port 4000. The
   Studio talks to `EngineCore` over `window.motionforgeEngine` IPC
   (`engine:invoke` / `engine:event`). The runtime and the asset vault are
   served over the custom privileged schemes `mf-runtime://` and `mf-vault://`.
2. **One-way dependency direction.**
   `mcp-server → core-engine → scene-spec` and `scene-runtime → scene-spec`.
   `core-engine` and `scene-runtime` contain **zero** MCP knowledge.
3. **Cross-platform OS compatibility.** The code must run identically on
   Windows (`D:\Projects\...`, drive letters, backslashes) and on POSIX.
   Every path that crosses a module boundary is normalised with
   `path.*` / `pathToFileURL`, never by string concatenation.
4. **Zod-first validation at every boundary.** Unknown keys are rejected so a
   hallucinated field surfaces as an error instead of being silently dropped —
   *except* for the explicitly whitelisted UI/spatial layer fields added in
   Phase 1, which are now part of the contract.

---

## 2. Phase breakdown

### PHASE 0 — Inspection & Blueprint (`docs/redesign/`)

Deliverable: five specification documents written **before** application code is
touched.

| File | Contents |
| --- | --- |
| `00_MASTER_EXECUTION_ROADMAP.md` | This document. |
| `01_BACKEND_AND_SCHEMA_AUDIT.md` | Root-cause analysis of the two startup bugs and the exact fix plan. |
| `02_PRO_NLE_DESIGN_SYSTEM.md` | CSS token contract, SVG icon catalogue, zero-emoji enforcement, frameless window spec. |
| `03_MODULAR_COMPONENT_ARCHITECTURE.md` | The full `packages/studio/src/` tree and every component boundary. |
| `04_LIVE_PROGRESS_LOG.md` | The verification matrix. Updated after **every** module. |

**Gate:** all five documents exist and agree with the code that exists today.

### PHASE 1 — Backend, Schema & Build Pipeline Remediation

Goal: a 100% bug-free foundation. Nothing in Phase 2 starts until this passes.

| ID | Work item | Verification |
| --- | --- | --- |
| P1-1 | Add the universal spatial/NLE layer fields to `layerBaseSchema` (`position`, `scale`, `rotation`, `opacity`, `visible`, `locked`, `blendMode`; `trackIndex` already present). | `scene-spec` unit tests assert every field on **every** layer kind, `background` (`layers.0`) included. |
| P1-2 | Publish `sanitizeSceneInput()` from `@motionforge/scene-spec` — a strip/normalize pass that removes transient UI-only keys before validation. | Unit test: a scene with `_hidden`, `_locked`, `foo` and a `background` carrying `position` validates. |
| P1-3 | `EngineCore.saveScene` sanitizes before validating; legacy scenes on disk are healed on load. | `core-engine` unit test: `saveScene` of a UI-dirty scene succeeds and returns no `Unrecognized key` issue. |
| P1-4 | `packages/studio/src/api.ts` sanitizes before crossing the IPC boundary. | Studio typecheck + the Electron E2E script. |
| P1-5 | `predev` builds `scene-spec`, `core-engine`, `scene-runtime` so `packages/scene-runtime/dist/index.html` always exists before Electron boots. | `rm -rf packages/scene-runtime/dist && npm run dev -w @motionforge/desktop` → runtime loads. |
| P1-6 | Windows-safe `mf-runtime://` / `mf-vault://` resolution (drive letters, backslashes, `pathToFileURL`). | Path-resolution unit test + startup log line. |
| P1-7 | Frameless window: `frame: false`, `titleBarStyle: 'hidden'`, `autoHideMenuBar: true`, `backgroundColor: '#090a0d'`, plus `window:minimize` / `window:toggleMaximize` / `window:isMaximized` / `window:close` IPC and a `window:MaximizedChanged` event. | E2E: the native frame is gone and the custom buttons drive the window. |

**Gate:** `npm run build` + `npm run typecheck` + `npm test` all green.

### PHASE 2 — Modular Studio Rebuild

Eight modules, executed and verified **one at a time**.

| Module | Deliverable |
| --- | --- |
| 1 | Design tokens, `NleIcons.tsx` SVG system, modular state store, SMPTE formatter. |
| 2 | Frameless `TitleBar` + `AppMenuBar` + `ToolDock` + `StatusBar`. |
| 3 | `PanelContainer` + `Splitter` + workspace layout switching. |
| 4 | `ProjectBinPanel` + `LayerStackPanel`. |
| 5 | `ProgramMonitorPanel` + `CanvasOverlay` + `TransportBar`. |
| 6 | `ScrubInput` + `EffectControlsPanel`. |
| 7 | `TimelinePanel` + `AudioVuMeter` (razor split, dual-handle trim, VU meter). |
| 8 | `RenderModal` + `ShortcutsModal` + `HelpDrawer`. |

**Gate per module:** typecheck clean, unit tests green, the module verified inside
the real Electron app, and `04_LIVE_PROGRESS_LOG.md` updated **before** the next
module starts.

### PHASE 3 — Practical In-App Verification

`scripts/test-pro-nle-redesign.cjs` launches the real Electron app and asserts:

- zero `Unrecognized key(s) in object: 'position'` errors on any save path,
- `mf-runtime://app/index.html` loads with zero console errors,
- the native frame is hidden and the custom shell is present and functional,
- `document.body.innerText` contains **zero** emoji codepoints,
- every NLE module is interactive (workspace switcher, project bin, layer stack,
  60fps monitor drag + smart guides, inspector scrub + undo/redo, timeline trim +
  razor split + VU meter, real MP4 export),
- a high-resolution screenshot lands in `screenshots/pro-nle-redesign-verified.png`.

---

## 3. Strict execution rules

1. **One module at a time.** No module is started until the previous module is
   typechecked, tested, verified in the app and logged.
2. **No stubs, no fake buttons.** A control that cannot act is not shipped. If a
   feature is not built, it does not exist in that commit.
3. **No emoji — ever.** Enforced by an automated grep gate
   (`npm run verify:no-emoji`) and by a runtime assertion in the E2E script.
4. **No new MCP tool.** The Studio talks to `EngineCore` in-process; the MCP
   surface stays at exactly six tools.
5. **No silent schema loosening.** The schema is strict by design; the only
   sanctioned additions are the whitelisted spatial/NLE fields, and they are
   documented, typed and tested.
6. **Every save path is sanitized.** `EngineCore.saveScene` is the last line of
   defence; the Studio sanitizes at the IPC boundary as well.

---

## 4. Testing gates

| Gate | Command | Required result |
| --- | --- | --- |
| Schema contract | `npm test -w @motionforge/scene-spec` | all green |
| Engine hardening | `npm test -w @motionforge/core-engine` | all green |
| Types | `npm run typecheck` (all workspaces, incl. studio + desktop) | 0 errors |
| Build | `npm run build` | 0 errors |
| Static hygiene | `npm run verify:no-emoji` | 0 hits in `packages/studio/src` |
| Practical | `node scripts/test-pro-nle-redesign.cjs` | all assertions pass |

---

## 5. Definition of Done

A module is **Done** when all of the following are true:

- [ ] Its files live under the domain folder named in `03_MODULAR_COMPONENT_ARCHITECTURE.md`.
- [ ] It owns one responsibility and reads its state from a single store slice.
- [ ] `npm run typecheck` is clean for the whole monorepo.
- [ ] `npm test` is fully green.
- [ ] It has been opened and driven inside the real Electron app.
- [ ] It contains no emoji and no `TODO`/`FIXME`/stub.
- [ ] `docs/redesign/04_LIVE_PROGRESS_LOG.md` records the module as complete,
      with the verification evidence.
