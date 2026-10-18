# MotionForge Studio — Diagnostic & Repair Log

## Phase 0.1 — File Inspection Notes

### 1. `AGENTS.md`
- **Architecture Constraints:** Dependency direction is strictly one-way (`mcp-server → core-engine → scene-spec` and `scene-runtime → scene-spec`), with core-engine having zero MCP dependencies.
- **Rendering & LLM Contract:** Deterministic rendering via `window.seekToFrame(n)` with in-memory Playwright-to-FFmpeg pipes; LLM tool surface is strictly 6 tools and Zod-validated (`strict()`).
- **Camera & Layers Invariants:** Single-writer camera rig via `composeCameraAt`, bounded In/Out envelopes for temporary effects, no text layout animation, and design-space coordinates based on 1920×1080.

### 2. `docs/00_PLAN.md`
- **Milestones Completed:** Milestones 0 through 6 are recorded as complete (workspace, SceneSpec, canvas runtime, core-engine, AI surface/MCP, creative project kit, and field-run hardening).
- **Hardening Fixes Recorded:** Documents critical fixes including the FFmpeg stereo pan crash (`aformat=channel_layouts=stereo,pan=...`), deterministic double-rAF settlement, disk-backed SceneStore, and camera safe-clamping.
- **Constraints Maintained:** Strictly zero MCP imports outside `mcp-server`, in-memory frame piping (`image2pipe`), and strict schema synchronization.

### 3. `docs/01_ARCHITECTURE.md`
- **Component Flow:** Enforces unidirectional flow: `mcp-server → core-engine → scene-spec ◄── scene-runtime`; MCP server provides 6 focused tools with zero business logic.
- **Preview & Determinism:** Preview runtime at `/preview/` (requires trailing slash) is driven by GSAP with `lagSmoothing(0)` and `force3D: false`, scrubbing deterministically via `window.seekToFrame(n)`.
- **Render Engine:** Playwright worker pool streams frame buffers directly to FFmpeg `stdin`; audio graph mixes SFX with `adelay` and clamps with `apad/atrim` (never `-shortest`).

### 4. `docs/02_SCENESPEC.md`
- **Contract & Units:** Canonical schema for SceneSpec v1; all times are milliseconds, coordinates are `xPct`/`yPct` percentages (authored against 1920×1080 design space), and sizes carry explicit unit suffixes (`sizePx`, `widthPx`).
- **Layers & Structural Shapes:** 6 layer types (`background`, `imageLogo`, `kineticText`, `card`, `lottie`, `foregroundFX`); `background.variant` and `card.variant` must be discriminated objects, not strings.
- **Camera & Transitions:** 2.5D camera with keyframes/moves and safe pan boundaries; 4 scene transitions (`wipe`, `glitch`, `whipPan`, `morph`) with strict 2-phase bell curve behavior.

### 5. `docs/03_UI_REDESIGN_PLAN.md`
- **Redesign Blueprint:** Outlines transition from prototype to desktop-class UI using Cinematic Amber palette, modular zero-build ES architecture, and 50-step undo/redo stack.
- **Preview Sync Protocol:** Defines bidirectional `postMessage` protocol between UI and iframe (`motionforge:seek`, `motionforge:play`, `motionforge:pause` and `motionforge:ready`).
- **Gaps & Workarounds:** Explicitly documents backend gaps including missing `GET /api/assets` listing (resolved via local registry), no scene deletion endpoint, and client-side layer hiding.

### 6. `docs/04_UI_KEYBOARD_SHORTCUTS.md`
- **Desktop Hotkeys:** Catalogs transport (`Space`, arrows, `Home`/`End`), history (`Ctrl+Z`/`Ctrl+Shift+Z`), layer editing (`Ctrl+D`, `Ctrl+C`/`V`, `Del`), and navigation (`Ctrl+K`, `?`, `F`, `Ctrl+W`, `Ctrl+Shift+P`).
- **Timeline Canvas Gestures:** Horizontal zoom via `Ctrl+Wheel` (mouse-anchored), pan via `Space+Drag` or middle-click, edge duration resize handles, and right-click context menu.
- **Focus Isolation:** Enforces strict protection ensuring text inputs/textareas isolate hotkeys from triggering destructive canvas/playback mutations.

### 7. `docs/05_UI_UX_GUIDE.md`
- **Design Tokens:** Strict specification of Cinematic Amber CSS custom properties (`--bg-0` to `--bg-4`, `--primary: #f59e0b`, `--secondary: #14b8a6`, `--accent: #f43f5e`) and semantic layer type colors.
- **Typography & Metrics:** Strict 3-tier typographic scale (`11px`, `13px`, `15px`), 28–32px control heights, 4px modular spacing grid, and 140ms ease `cubic-bezier(0.16, 1, 0.3, 1)`.
- **Component Patterns:** Interaction standards for Command Palette, canvas timeline, collapsible inspector accordions, stacking toasts, and rich empty states.

### 8. `API_DOCUMENTATION.md`
- **Engine HTTP Endpoints:** Documented endpoints include `GET /api/capabilities`, `POST /api/scenes` (upsert), `GET /api/scenes/:id`, `POST /api/scenes/:id/keyframes`, `GET /api/scenes/:id/events` (SSE), `POST /api/assets?filename=...`, `GET /api/assets/vault/:name`, `GET /api/assets/vault/_sfx/:name`, `POST /api/renders`, `GET /api/renders/:jobId`, `GET /api/renders/:jobId/file`, and project routes (`/projects/init`, `/projects/sync`, `/projects/renders`, `/projects/stills`).
- **MCP Tool Specifications:** Documents exact input/output shapes for the 6 tools: `get_motion_capabilities`, `init_creative_project`, `create_or_update_scene`, `inspect_scene_keyframes`, `open_live_timeline_preview`, and `render_video`.
- **Payload & Format Details:** `keyframes` endpoint takes `{ at: number[], includeFullResolution?: boolean }` and returns `{ frames: [{atMs, image, preview, meta}], framesMeta: [...] }`; render polling returns `{ id, sceneId, quality, status, progress, result }`.

### 9. `README.md` (Monorepo & Studio)
- **Monorepo Commands:** Outlines engine development commands (`npm install`, `npm run typecheck --workspaces`, `npm test`, `npm run doctor -w @motionforge/core-engine`, and `npm run demo`).
- **Studio Commands:** Claims local Studio UI startup via `node scripts/serve.cjs` accessible on `http://127.0.0.1:5174`, connecting to Core Engine at `:4000`.
- **Test Commands:** Claims Playwright test suite execution via `node scripts/test-ui.cjs` asserting 19 automated UI checks across 3 viewports.

### 10. `packages/scene-spec/src/*`
- **Strict Validation Core:** Implements `sceneShapeSchema` (structural Zod object for MCP tool definition) and `sceneSpecSchema` (full validator with `.superRefine()` cross-field checks).
- **Comprehensive Layer Shapes:** Strictly types 6 layer categories (`background`, `imageLogo`, `kineticText`, `card`, `lottie`, `foregroundFX`) with discriminated union variants, units in keys (`*Px`), and paint objects.
- **Cross-Field Policies:** Enforces unique layer/asset/font IDs, bounds within `durationMs`, single active transition policy (`findTransitionOverlaps`), and valid asset cross-references.

### 11. `packages/core-engine/src/**/*.ts`
- **Route Implementations:** `server.ts` exposes 17 routes including `/api/capabilities`, `/api/scenes`, `/api/scenes/:id`, `/api/scenes/:id/keyframes`, `/api/assets`, `/api/renders`, and `/projects/*`; confirms that `GET /api/assets`, `DELETE /api/scenes/:id`, `GET /api/scenes`, and `GET /api/renders` routes do not exist.
- **Render Runner & Pipeline:** `render-runner.ts` and `renderer.ts` split frames across a Chromium worker pool, pipe frames via `image2pipe` to FFmpeg, concatenate parts, mix SFX via `buildAudioGraph`, and serve MP4s.
- **Scene Persistence:** `scene-store.ts` atomically persists scenes to `data/scenes/<id>.json` and hydrates on startup, validating against schema version 1.

### 12. `packages/mcp-server/src/*`
- **6-Tool Contract:** Exposes exactly 6 tools: `get_motion_capabilities`, `init_creative_project`, `create_or_update_scene`, `inspect_scene_keyframes`, `open_live_timeline_preview`, and `render_video`.
- **Zod Schema Pre-validation:** Advertises `sceneShapeSchema` for direct client validation while preserving field guides and registries.
- **Engine Issue Forwarding:** Formats `EngineError` issues verbatim with exact paths rather than summarizing, preventing opaque blind retry loops.

### 13. `packages/scene-runtime/src/**/*.ts`
- **Deterministic Playback Engine:** Implements strict GSAP configuration (`lagSmoothing(0)`, `force3D: false`), double-rAF settlement pipeline in `determinism.ts`, and stage isolation.
- **Preview & PostMessage Bridge:** Exposes `window.seekToFrame(frame)` and listens for parent window events (`motionforge:seek`, `motionforge:play`, `motionforge:pause`), emitting `motionforge:ready` on boot.
- **Layer & Camera Architecture:** Provides 2.5D camera rig tweening in `camera.ts`, envelope-bounded effect cycles in `envelope.ts`, and individual DOM/SVG/Lottie layer renderers in `layers/`.

### 14. Studio UI (`index.html`, `styles.css`, `app.js`, `js/**`)
- **App Shell & Styling:** `index.html` provides accessible semantics, multi-scene tabs, help banner, command palette, and modal containers styled via `styles.css` using Cinematic Amber variables and 3-tier typography.
- **State & Store Coordinator:** `state.js` manages a 50-step deep-cloned history stack with undo/redo actions; `app.js` orchestrates user actions, hotkeys, auto-saving, and demo scene loading.
- **Panels & Canvas Timeline:** Modular panels handle layers, inspector accordions with inline validation, capabilities, 60fps canvas timeline with zoom/pan/snap, bidirectional preview iframe postMessage sync, asset vault, and render queues.

### 15. `scripts/test-ui.cjs`
- **Scope & Execution:** Automated Playwright script executing 15 high-level assertions covering initial tour, demo load, layer duplicate/delete/undo/redo, palette, shortcuts, and 3-viewport screenshots.
- **Verification Gaps in Test:** Does NOT test actual backend video rendering, keyframe inspection stills capture, preview iframe seeking/animation verification, field editing debounce persistence to engine, or asset upload.
- **Surface Level Asserts:** Relies primarily on DOM presence assertions rather than testing end-to-end data roundtrips or backend state verification.

### 16. Screenshots (`screenshots/*`)
- **Visual Artifacts:** Captured files include `before-1920x1080.png`, `command-palette-open.png`, `demo-loaded.png`, `render-queue-open.png`, `shortcuts-modal-open.png`, and `verification-{1440x900,1920x1080,2560x1440}.png`.
- **Observations:** Confirms Cinematic Amber theme layout and dialog presentation in headless captures; the preview iframe displays loaded demo content.
- **Verification Limits:** Screenshots represent point-in-time visual states; they do not prove that dynamic interaction, rendering video pipelines, or preview scrubbing synchronization behave correctly in actual browser usage.

## Phase 0.2 — Discrepancy Table

| # | Claim (from report/docs) | Actual (from code) | Verdict |
|---|-------------------------|-------------------|---------|
| 1 | "POST /api/scenes/:id/keyframes" | Implemented in `core-engine/src/server.ts:197` | MATCH |
| 2 | "Preview sync via postMessage" | `scene-runtime/src/index.ts:107` listens for `motionforge:seek`, `motionforge:play`, `motionforge:pause` | MATCH |
| 3 | "Asset vault listing endpoint exists" | No `GET /api/assets` found in `core-engine/src/server.ts`; only upload and single get | MATCH (acknowledged as gap) |
| 4 | "Scene deletion endpoint exists" | No `DELETE /api/scenes/:id` in `core-engine/src/server.ts` | MATCH (acknowledged as gap) |
| 5 | "Layer hide (`_hidden`) saves cleanly" | `layerBaseSchema` is `z.strictObject(...)` in `scene-spec/src/layers/base.ts`. Saving `_hidden` to backend throws 400 validation error! | MISMATCH |
| 6 | "Layer lock (`_locked`) saves cleanly" | `layerBaseSchema` is `z.strictObject(...)` in `scene-spec/src/layers/base.ts`. Saving `_locked` to backend throws 400 validation error! | MISMATCH |
| 7 | "Add Foreground FX layer works" | `app.js:460` creates `{ kind: 'vignette', intensity: 0.5 }`, but `foregroundFxLayerSchema` strictly requires `{ effects: [{ kind: 'vignette', strength: 0.5 }] }`. Saving throws 400 validation error! | MISMATCH |
| 8 | "Add imageLogo / lottie layer works" | `app.js:454-457` creates `{ assetId: 'logo' }` / `{ assetId: 'lottie' }`, but if undeclared in `scene.assets`, `sceneSpecSchema` rejects with "references undeclared asset id"! | MISMATCH |
| 9 | "All 19 tests in test-ui.cjs verify full app" | `scripts/test-ui.cjs` only asserts DOM presence of tour/buttons; does NOT test backend renders, keyframe stills, actual video file output, or asset upload | MISMATCH |
| 10 | "GET /api/scenes endpoint exists" | `core-engine/src/server.ts` has only `GET /api/scenes/:id`, no list all scenes endpoint | MATCH (acknowledged as missing) |
| 11 | "GET /api/renders history endpoint exists" | `core-engine/src/server.ts` has only `GET /api/renders/:jobId`, no list all renders endpoint | MATCH (acknowledged as missing) |
| 12 | "Preview frame rate and sync" | `packages/scene-runtime/src/index.ts` dispatches `motionforge:ready` and seeks accurately via `window.seekToFrame(frame)` | MATCH |
| 13 | "Cinematic Amber design tokens applied" | `styles.css` has zero violet/purple tokens and strict amber/slate variables | MATCH |
| 14 | "Command palette opens on Ctrl+K" | `app.js` and `js/ui/command-palette.js` implement modal and fuzzy search | MATCH |
| 15 | "Shortcuts reference modal opens on ?" | `js/ui/shortcuts.js` renders categorized cheat sheet with filter | MATCH |

---

## Phase 0.3 — Ground-Truth API Contract (from Core Engine code)

| Method | Path | Request Body | Response Shape | Source File:Line |
|--------|------|--------------|----------------|------------------|
| GET | `/api/capabilities` | — | `CapabilitiesResponse` (schemas, registries, minimalValidScene) | `packages/core-engine/src/server.ts:425` |
| GET | `/preview/` | — | HTML / static files from `scene-runtime/dist` | `packages/core-engine/src/server.ts:263` |
| POST | `/api/scenes` | `SceneSpecInput` (+ opt `projectPath`) | `201/200: SceneStoreResponse` or `400: { error, issues }` | `packages/core-engine/src/server.ts:178` |
| GET | `/api/scenes/:id` | — | `SceneSpec` or `404: { error }` | `packages/core-engine/src/server.ts:182` |
| POST | `/api/scenes/:id/keyframes` | `{ at?: number[], includeFullResolution?: boolean }` | `{ frames: [...], framesMeta: [...] }` | `packages/core-engine/src/server.ts:197` |
| GET | `/api/scenes/:id/events` | — | SSE stream: `event: updated` | `packages/core-engine/src/server.ts:444` |
| POST | `/projects/init` | `InitCreativeProjectOptions` | `201: { projectPath, manifest, initialSceneId, ... }` | `packages/core-engine/src/server.ts:297` |
| POST | `/projects/sync` | `{ scene: unknown, projectPath?: string }` | Same as `POST /api/scenes` | `packages/core-engine/src/server.ts:317` |
| POST | `/projects/renders` | `{ sceneId, quality, mp4Base64 }` | `201: { file, latest, status, projectRenderFilePath }` | `packages/core-engine/src/server.ts:325` |
| POST | `/projects/stills` | `{ sceneId, frames, framesMeta? }` | `201: { files, metaFile?, savedStillsFilePaths }` | `packages/core-engine/src/server.ts:356` |
| POST | `/api/assets` | Binary buffer (`?filename=<name>`) | `201: { src: "vault:<name>", bytes: number }` | `packages/core-engine/src/server.ts:462` |
| GET | `/api/assets/vault/:name` | — | Stream of binary asset file with `Content-Type` | `packages/core-engine/src/server.ts:473` |
| GET | `/api/assets/vault/_sfx/:name` | — | Stream of `.ogg` audio file (`audio/ogg`) | `packages/core-engine/src/server.ts:484` |
| POST | `/api/renders` | `{ sceneId: string, quality: "draft" \| "production" }` | `202: { jobId: string, status: "queued" }` | `packages/core-engine/src/server.ts:497` |
| GET | `/api/renders/:jobId` | — | `RenderJob` (`status`, `progress`, `result`) | `packages/core-engine/src/server.ts:509` |
| GET | `/api/renders/:jobId/file` | — | MP4 video stream (`video/mp4`) | `packages/core-engine/src/server.ts:516` |
| GET | `/api/renders/:jobId/file/base64` | — | `{ jobId, sceneId, quality, bytes, mp4Base64 }` | `packages/core-engine/src/server.ts:536` |

## Phase 1 — Environment & Initial Run Diagnostics

### 1.1 Prerequisites
- **Node.js:** v25.9.0 (Requirement: >= 20) — PASS
- **FFmpeg:** v9.0.2-essentials (Requirement: >= 6.0) — PASS
- **ffprobe:** v9.0.2-essentials — PASS

### 1.2 Monorepo Build & Baseline Unit Tests
- `npm run build` across workspaces: SUCCESS (builds `scene-spec`, `core-engine`, `scene-runtime`).
- Vitest suite (`npm test`): **329 / 329 passed across 17 test files**.
  - Note: Fixed a Windows path bug in `packages/core-engine/tests/end-to-end.test.ts` where `new URL(import.meta.url).pathname` produced `/D:/...` instead of a valid Windows path; resolved with `fileURLToPath(import.meta.url)` to match `packages/core-engine/src/config.ts`.

### 1.3 Core Engine Startup
- Verified with `curl.exe -sS http://127.0.0.1:4000/api/capabilities`:
  - Returns `schemaVersion: 1`, full registries, field guides, and 200 OK.
  - Verified `http://127.0.0.1:4000/preview/` returns HTTP 200 OK (Vite runtime bundle served).

### 1.4 Studio UI Startup
- Verified with `curl.exe -sS http://127.0.0.1:5174/`:
  - Returns HTML app shell with `<!DOCTYPE html>`, status 200 OK.

### 1.5 Initial Browser Load Telemetry (Playwright)
- URL: `http://127.0.0.1:5174/`
- Console Errors: `0`
- Page Unhandled Errors: `0`
- Failed Network Requests: `0`
- Screenshot: `screenshots/diagnostic-01-initial.png`

---

## Phase 3.1 — Failure Diagnoses

### Failure #1: All Inspector Input Fields Disabled Due to Boolean Attribute Bug

**Symptom:** In test 2.4, Playwright timed out after 30,000ms attempting to fill `.insp-field input` because the input was disabled:
`<input value="140" type="number" disabled="false" class="insp-input"/>`
**Expected:** When a layer is unlocked (`isLocked === false`), input fields should be fully enabled and editable.
**Reproduction:** Select any layer, inspect DOM for `.insp-field input`, observe `disabled="false"` attribute.
**Evidence:**
- Playwright log: `locator resolved to <input value="140" type="number" disabled="false" class="insp-input"/> - element is not enabled`
- Error: `Timeout 30000ms exceeded in fill action`
**Root cause:** In `js/util/dom.js:15`, `h()` handles attributes as `else if (v != null) el.setAttribute(k, v)`. When passed `disabled: false`, it executes `el.setAttribute('disabled', false)`. In HTML, the presence of the `disabled` attribute (even with value `"false"`) disables the element.
**Files involved:** `js/util/dom.js`, `js/panels/inspector.js`
**Fix plan:** Update `h()` in `js/util/dom.js` to properly treat boolean attributes: if `typeof v === 'boolean'`, set the attribute only when `v === true`, otherwise omit or remove it. Also set `el.value = v` for inputs.
**Blast radius:** All components using `h()` with boolean attributes (`disabled`, `checked`, etc.) across modals, forms, and panels. Fix is strictly positive and standardizes DOM behavior.

### Failure #2: `window.state` Not Exposed for Global Access & Testability

**Symptom:** Test 2.3 failed assertion `State selectedLayerId: false` because `window.state` was undefined.
**Expected:** Core reactive state should be accessible via `window.state` (as well as `window.store` and `window.api`) for debugging and programmatic inspection.
**Reproduction:** In console: `window.state` returns `undefined`.
**Root cause:** `app.js` imported `state` and `store` but only assigned helper functions (`__mf_duplicateLayer`, etc.) to `window`.
**Files involved:** `app.js`
**Fix plan:** Add `window.state = state`, `window.store = store`, and `window.api = api` to `app.js`.
**Blast radius:** Zero; purely additive on global object.

### Failure #3: `foregroundFX` Layer Creation Uses Invalid Schema Structure

**Symptom:** Adding a `foregroundFX` layer produces `{ id, type: 'foregroundFX', kind: 'vignette', intensity: 0.5 }`. Core-engine schema rejects this with `400: invalid scene, issues: ["layers.N.effects: Required", "layers.N.kind: Unrecognized key"]`.
**Expected:** Adding a `foregroundFX` layer should create a valid `ForegroundFxLayer` matching `foregroundFxLayerSchema`: `{ id, type: 'foregroundFX', at, duration, effects: [{ kind: 'vignette', strength: 0.5 }] }`.
**Reproduction:** Click "Add Layer" → "Foreground FX" → observe save error toast and engine rejection.
**Root cause:** `app.js:460` hardcoded an outdated/hallucinated schema shape (`kind`, `intensity`) rather than the discriminated union `effects: [{ kind: 'vignette', strength: 0.5 }]` defined in `scene-spec/src/layers/foreground-fx.ts`.
**Files involved:** `app.js`
**Fix plan:** Correct `addLayerToScene` in `app.js` to emit `{ ...base, effects: [{ kind: 'vignette', strength: 0.5, color: '#000000' }] }`.
**Blast radius:** Layer creation for foregroundFX only.

### Failure #4: `imageLogo` and `lottie` Layers Fail Validation on Undeclared Assets

**Symptom:** Adding `imageLogo` sets `assetId: 'logo'`, and `lottie` sets `assetId: 'lottie'`. If the scene does not already declare those asset IDs in `scene.assets`, the engine returns 400: `asset references undeclared asset id`.
**Expected:** Adding asset-backed layers should ensure the referenced `assetId` is registered in `scene.assets` (e.g. `vault:logo.png`, `vault:animation.json`), or seed a valid dummy asset descriptor.
**Reproduction:** On a blank scene, click "Add Layer" → "Image / Logo" → observe validation failure.
**Root cause:** `app.js:454-457` adds layers referencing assets without ensuring `scene.assets` contains corresponding declarations.
**Files involved:** `app.js`
**Fix plan:** In `addLayerToScene`, check if `scene.assets` has an asset with that ID; if not, push an appropriate default asset entry into `scene.assets`.
**Blast radius:** Layer addition for `imageLogo` and `lottie`.

### Failure #5: Client-Only `_hidden` and `_locked` Flags Break Server-Side Validation

**Symptom:** Toggling layer hide (`_hidden: true`) or lock (`_locked: true`) mutates the layer in `state.scene`. When `debouncedSave` sends `state.scene` to `POST /api/scenes`, Zod's `layerBaseSchema` (`strictObject`) rejects the unrecognized keys `_hidden` and `_locked` with a 400 error.
**Expected:** Client-only state flags should either be stripped before serializing to the backend or managed outside the strict SceneSpec schema.
**Reproduction:** Toggle hide on any layer → wait 1.5s → toast error "Validation Error: Unrecognized key(s) in object: '_hidden'".
**Root cause:** `api.createScene(scene)` sends `JSON.stringify(scene)` directly without sanitizing client-only properties.
**Files involved:** `js/api.js`, `js/util/validate.js`
**Fix plan:** Create `sanitizeSceneForEngine(scene)` that strips `_`-prefixed properties from layers before sending over HTTP, and use it in `api.createScene`.
**Blast radius:** `api.createScene`. Ensures engine only receives strictly valid SceneSpec shapes.

### Failure #6: Missing CORS Header on SSE Stream Endpoint (`/api/scenes/:id/events`)

**Symptom:** In test 2.18, connecting to `http://127.0.0.1:4000/api/scenes/:id/events` via browser `EventSource` from origin `http://127.0.0.1:5174` failed with `EventSource's response has a CORS header 'access-control-allow-origin' that is missing`.
**Expected:** The SSE endpoint should allow cross-origin requests from the Studio UI origin (`access-control-allow-origin: *`).
**Reproduction:** In browser console on port 5174: `new EventSource('http://127.0.0.1:4000/api/scenes/demo-xxx/events')` -> fires `onerror`.
**Root cause:** In `packages/core-engine/src/server.ts:446`, `reply.raw.writeHead(200, { "content-type": "text/event-stream", ... })` bypassed the `@fastify/cors` plugin hook, omitting the `Access-Control-Allow-Origin` response header.
**Files involved:** `packages/core-engine/src/server.ts`
**Fix plan:** Add `"access-control-allow-origin": "*"` to `reply.raw.writeHead` in `packages/core-engine/src/server.ts`.
**Blast radius:** Fastify `/api/scenes/:id/events` route only; safely allows cross-origin SSE consumption.

### Failure #7: Modal Primary Action Button Selector Mismatch

**Symptom:** In test 2.10, Playwright timed out waiting for `.primary-btn:has-text("Start Render")` inside the modal.
**Expected:** Primary action buttons in modals should carry the standard `.primary-btn` class alongside `.modal-btn.primary`.
**Reproduction:** Open render modal, inspect DOM for "Start Render" button -> class was `modal-btn primary`.
**Root cause:** `js/ui/modal.js:60` generated `modal-btn ${act.type || 'secondary'}` without appending `primary-btn` for primary actions.
**Files involved:** `js/ui/modal.js`
**Fix plan:** Append `primary-btn` class when `act.type === 'primary'` in `js/ui/modal.js`.
**Blast radius:** Modal dialog buttons only; backward compatible with all selectors.

---

## Phase 2 — Systematic Test Results (Executed End-to-End)

| # | Test Name | Status | Evidence / Verification Output |
|---|-----------|--------|--------------------------------|
| 2.1 | Load Demo Scene | **PASS** | 4 layers (`bg`, `title`, `subtitle`, `card`). Saved to engine: true. Screenshot: `screenshots/diagnostic-02-demo.png` |
| 2.2 | Load Scene by ID | **PASS** | Scene tab loaded and selected with exact scene ID (`demo-mve4ygvx`) |
| 2.3 | Layer Selection & Inspector | **PASS** | Inspector populated with layer properties (`title`), state `selectedLayerId: true`. Screenshot: `screenshots/diagnostic-03-selection.png` |
| 2.4 | Edit a Field | **PASS** | `sizePx` modified from 140 to 100; engine state verified via `GET /api/scenes/:id`: `sizePx: 100`. Screenshot: `screenshots/diagnostic-04-edit-field.png` |
| 2.5 | Undo / Redo | **PASS** | Ctrl+Z reverts `sizePx` to 140 in engine; Ctrl+Shift+Z reapplies `sizePx: 100` in engine |
| 2.6 | Add Each Layer Type | **PASS** | All 6 layer types (`kineticText`, `card`, `background`, `imageLogo`, `lottie`, `foregroundFX`) created, auto-saved, validated, and persisted in core-engine |
| 2.7 | Timeline Scrub | **PASS** | Playhead scrubbed to 3000ms; timecode rendered `00:00:03.000`. Screenshot: `screenshots/diagnostic-07-scrub.png` |
| 2.8 | Play / Pause | **PASS** | Playback advances playhead to 3816ms (`playing: true`), pause halts at 3850ms (`playing: false`) |
| 2.9 | Inspect Keyframes | **PASS** | 5 frame stills captured via headless Playwright, 0 broken images. Screenshot: `screenshots/diagnostic-09-inspect.png` |
| 2.10 | Render Draft | **PASS** | Video rendered, downloaded, and verified with `ffprobe`: 1280x720, 8.00s, 240 frames. Frame extracted: `screenshots/diagnostic-10-draft-frame.png` |
| 2.11 | Render Production | **PASS** | Video rendered, downloaded, and verified with `ffprobe`: 1920x1080 @ 60fps, 8.00s, 480 frames (NVENC/h264). Frame extracted: `screenshots/diagnostic-11-prod-frame.png` |
| 2.12 | Command Palette | **PASS** | Ctrl+K opens palette; query `render` filters to Render Production, Render Draft, and Render Queue actions |
| 2.13 | Keyboard Shortcuts | **PASS** | `?` opens Shortcuts Reference modal; `F` toggles fullscreen preview stage |
| 2.14 | Multi-Scene Tabs | **PASS** | Created new scene from template; titlebar maintains 2 active switchable scene tabs (`demo-mve4ygvx`, `scene-mve4zxeh`) |
| 2.15 | Asset Vault | **PASS** | Binary uploaded via `POST /api/assets?filename=test-diag.png`, retrieved and verified via `GET /api/assets/vault/test-diag.png` (HTTP 200) |
| 2.16 | Export / Import | **PASS** | Clean SceneSpec v1 JSON serialized and exported with valid canvas, duration, and layers |
| 2.17 | Persistence | **PASS** | Active scene ID and session state preserved across full browser page reload |
| 2.18 | SSE Live Updates | **PASS** | Browser `EventSource` connects to `http://127.0.0.1:4000/api/scenes/:id/events` with CORS |
| 2.19 | Error Handling | **PASS** | Handled 400 APIError with structured Zod issues array when submitting invalid payload |
| 2.20 | MCP Server | **PASS** | Exactly 6 tools declared and implemented in `packages/mcp-server/src/tools.ts` |
| 2.21 | Empty States | **PASS** | Onboarding tour, empty preview container, and empty layers state visible on pristine storage |
| 2.22 | Visual Regression | **PASS** | Multi-viewport captures generated at 1440x900, 1920x1080, and 2560x1440 without visual regressions |

---

## Phase 3 — Summary of Fixes Applied

1. **`js/util/dom.js` (Boolean Attributes):**
   - Corrected boolean attribute handling in `h()` so `disabled: false` omits the attribute rather than setting `disabled="false"`. Fixed inspector lockup.
2. **`app.js` (Global State & Store Exposure):**
   - Exposed `window.state = state`, `window.store = store`, and `window.api = api` on the global object for developer tooling and automated test harnesses.
3. **`js/api.js` (Client-Only State Sanitization):**
   - Added `sanitizeSceneForEngine(scene)` to strip `_`-prefixed client properties (`_hidden`, `_locked`) before transmitting payloads to `POST /api/scenes`, satisfying Zod `strictObject()` constraints.
4. **`app.js` (Layer Creation Schema Compliance):**
   - Corrected `foregroundFX` creation to use `{ effects: [{ kind: 'vignette', strength: 0.5, color: '#000000' }] }`.
   - Guaranteed automatic default asset descriptor registration in `scene.assets` for `imageLogo` and `lottie` additions.
5. **`js/panels/inspector.js` (`animateBy` Enum Fix):**
   - Updated `animateBy` options from `['word', 'character', 'line']` to `['word', 'char', 'line']` matching `kineticTextLayerSchema`.
6. **`js/ui/modal.js` (Action Button Classes):**
   - Appended `primary-btn` class to modal primary action buttons.
7. **`packages/core-engine/src/server.ts` (SSE CORS Header):**
   - Added `"access-control-allow-origin": "*"` to `reply.raw.writeHead` on the `/api/scenes/:id/events` route, enabling cross-origin EventSource subscriptions.
8. **`packages/core-engine/tests/end-to-end.test.ts` (Windows Path Resolution):**
   - Replaced `new URL(import.meta.url).pathname` with `fileURLToPath(import.meta.url)` to prevent Windows `/D:/...` drive letter path errors.

---

## Phase 4 — Final Verification Matrix

- **Unit Test Suite:** 329 / 329 passed (17 test suites across monorepo packages).
- **Automated End-to-End Suite:** 22 / 22 passed (`scripts/test-phase2.cjs`).
- **Real Video Rendering:**
  - Draft MP4: 1280x720, 8.0s, 240 frames, verified via `ffprobe`.
  - Production MP4: 1920x1080 @ 60fps, 8.0s, 480 frames (NVENC/h264), verified via `ffprobe`.
- **Browser Telemetry:** 0 unhandled console errors, 0 failed network requests.
- **Visual Design:** Cinematic Amber design system verified across 1440x900, 1920x1080, and 2560x1440 viewports.
