# MotionForge Desktop Migration Log

**Document Version:** 1.0.0  
**Date:** 2026-10-18  
**Author:** Senior Software Engineer (AI Pair Programmer)  
**Status:** Phase 0 Complete — Discovery & Baseline Verified

---

## 0.1 Codebase Inspection Notes

### 1. `AGENTS.md`
- Enforces strict unidirectional dependencies: `mcp-server -> core-engine -> scene-spec` and `scene-runtime -> scene-spec`.
- Core engine and runtime must have zero MCP dependencies; LLM tool surface is locked to exactly 6 tools.
- Rendering is deterministic via `window.seekToFrame(n)`, in-memory FFmpeg pipes, and 2.5D single-writer camera rig.

### 2. `docs/00_PLAN.md`
- Details Milestones 0 through 6 covering SceneSpec contracts, canvas runtime, core-engine, MCP surface, and project kits.
- Documents critical architectural fixes: stereo pan audio filter stability, double-rAF frame settlement, and atomic SceneStore persistence.
- Establishes zero-tolerance rules against unhandled placeholders, disk frame leaks, and silent validation drops.

### 3. `docs/01_ARCHITECTURE.md`
- Details component interaction over HTTP (:4000) and stdio MCP; defines runtime bundle preview served by Fastify.
- Playwright Chromium worker pool captures in-memory frame buffers piped directly into FFmpeg `image2pipe` stdin.
- Audio graph mixes millisecond `adelay` cues with `loudnorm` normalization and hard clamp to exact scene duration.

### 4. `docs/02_SCENESPEC.md`
- Canonical contract reference for SceneSpec v1: times in ms, coordinates in canvas `xPct`/`yPct`, dimensions in design `*Px`.
- Discriminated union schemas for layers (`background`, `imageLogo`, `kineticText`, `card`, `lottie`, `foregroundFX`).
- Defines 2.5D camera rig boundaries, single active transition invariant, and registry-backed motion presets.

### 5. `docs/03_UI_REDESIGN_PLAN.md`
- Outlines architectural shift from prototype to studio workstation using "Cinematic Amber" theme tokens.
- Specifies bidirectional `postMessage` protocol between UI playhead and embedded preview iframe (`motionforge:seek`/`play`/`pause`).
- Documents backend API gaps: local registry workaround for asset vault listing and client-side layer hiding.

### 6. `docs/04_UI_KEYBOARD_SHORTCUTS.md`
- Catalogs comprehensive hotkey map: transport (`Space`, arrows, `Home`/`End`), history (`Ctrl+Z`/`Ctrl+Shift+Z`), layer editing (`Ctrl+D`, `Ctrl+C`/`V`, `Del`).
- Documents canvas gestures: `Ctrl+Wheel` horizontal zoom, `Space+Drag` horizontal pan, edge duration resizing.
- Formulates strict focus isolation rules to prevent text editing keys from accidentally firing canvas/playback mutations.

### 7. `docs/05_UI_UX_GUIDE.md`
- Establishes Cinematic Amber design token registry (`--bg-0` to `--bg-4`, `--primary: #f59e0b`, `--secondary: #14b8a6`, `--accent: #f43f5e`).
- Enforces strict 3-tier typography hierarchy (11px labels, 13px controls, 15px titles) and 28–32px tactile control heights.
- Specifies UX interaction patterns for Command Palette, HTML5 canvas timeline, and rich empty states.

### 8. `docs/06_DIAGNOSTIC_LOG.md`
- Comprehensive 15-item discrepancy audit between claimed features and real codebase capabilities.
- Complete 17-route Fastify ground-truth API contract mapping request/response schemas to exact source lines.
- Records diagnosis and fixes for 7 real bugs including SSE CORS headers, boolean DOM attributes, and schema strictness.

### 9. `API_DOCUMENTATION.md`
- Exhaustive documentation of Core Engine REST endpoints, Server-Sent Events, and 6 MCP server tools.
- Details request/response shapes for `/api/capabilities`, `/api/scenes`, `/api/scenes/:id/keyframes`, `/api/assets`, and `/api/renders`.
- Explains deterministic frame capture architecture and background job polling lifecycle.

### 10. `README.md` (Monorepo & Studio)
- Quick start instructions for engine development, project kit scaffolding, and local Studio UI hosting.
- Documents toolchain requirements (Node >= 20, FFmpeg >= 6, Playwright Chromium).
- Summarizes 6-tool MCP contract and autonomous disk synchronization mechanisms.

### 11. `packages/scene-spec/src/**/*.ts`
- Zod-first validation core exporting `sceneShapeSchema` (structural) and `sceneSpecSchema` (full with cross-field rules).
- Defines layer specifications with strict type validation, units in keys, paint objects, and preset references.
- Validates cross-field constraints: timeline bounds, asset references, font roles, and transition overlap prevention.

### 12. `packages/core-engine/src/**/*.ts`
- Fastify server hosting 17 routes, handling scene persistence atomically to `data/scenes/<id>.json`.
- Render runner managing Chromium worker pool, in-memory frame piping to FFmpeg, and multi-track audio mixing.
- Keyframe inspection subsystem rendering lightweight inline previews alongside full-resolution disk stills.

### 13. `packages/scene-runtime/src/**/*.ts`
- Vite + GSAP v3 canvas bundle; implements deterministic double-rAF settlement and stage isolation in `determinism.ts`.
- Exposes `window.seekToFrame(frame)` and bidirectional postMessage bridge (`motionforge:seek`/`play`/`pause`/`ready`).
- Implements 2.5D camera rig math in `camera.ts`, envelope-bounded effect cycles in `envelope.ts`, and individual layer renderers.

### 14. `packages/mcp-server/src/**/*.ts`
- Thin TypeScript MCP adapter exposing exactly 6 tools over `@modelcontextprotocol/sdk`.
- Advertises `sceneShapeSchema` for client-side prevalidation while preserving full capability field guides.
- Implements verbatim forwarding of engine validation `issues[]` to allow AI agents to self-correct field paths.

### 15. Studio UI (`index.html`, `styles.css`, `app.js`, `js/**`)
- Semantic HTML shell styled with Cinematic Amber tokens, providing multi-scene tabs, help strip, and modal dialogs.
- Central reactive store with 50-step deep-cloned history stack in `state.js` and modular panel coordinators in `js/panels/`.
- Double-buffered HTML5 canvas timeline in `js/panels/timeline.js` operating at 60fps with pan, zoom, and edge resizing.

### 16. `scripts/test-ui.cjs`, `scripts/test-phase2.cjs`, `scripts/phase2-results.json`
- `test-ui.cjs`: 19-assertion DOM presence test suite across 3 viewports.
- `test-phase2.cjs`: 22-test zero-trust Playwright harness verifying end-to-end backend roundtrips, FFmpeg MP4s, and SSE.
- `phase2-results.json`: Baseline proof recording 22/22 tests passing with `ffprobe` video stream verification.

### 17. Screenshots (`screenshots/**`)
- Contains 25 visual proof artifacts including multi-viewport captures (1440x900, 1920x1080, 2560x1440) and dialog overlays.
- Confirms Cinematic Amber theme fidelity, preview iframe rendering, command palette styling, and shortcuts modal.
- Includes extracted draft and production MP4 video frames (`diagnostic-10-draft-frame.png`, `diagnostic-11-prod-frame.png`).

---

## 0.2 Current Stack Baseline Execution

- **Backend:** Started `@motionforge/core-engine` on port 4000; verified with `curl -sS http://127.0.0.1:4000/api/capabilities`.
- **Frontend:** Started static studio server on port 5174; verified with `curl -sS http://127.0.0.1:5174/`.
- **Headless Browser Capture:** Executed Playwright navigation to `http://127.0.0.1:5174` with networkidle wait.
  - **Console Errors:** `0`
  - **Console Warnings:** `1` (Iframe sandbox warning: `allow-scripts` + `allow-same-origin`)
  - **Failed Network Requests:** `0`
  - **Screenshot Saved:** `screenshots/desktop-baseline-01.png`

---

## 0.3 Current Feature Inventory

| Feature | Claimed | Actually Works? | Evidence |
|---|---|---|---|
| Demo scene loads | Yes | Yes | `test-phase2.cjs` 2.1 PASS (4 layers, sceneId in store, screenshot `diagnostic-02-demo.png`) |
| Load scene by ID | Yes | Yes | `test-phase2.cjs` 2.2 PASS (Modal loads scene by ID into active tab) |
| Layer selection & inspector | Yes | Yes | `test-phase2.cjs` 2.3 PASS (Selecting layer populates inspector accordions) |
| Inspector field edits & debounce save | Yes | Yes | `test-phase2.cjs` 2.4 PASS (Changing `sizePx` updates engine via debounced PUT/POST) |
| Undo / Redo | Yes | Yes | `test-phase2.cjs` 2.5 PASS (Ctrl+Z / Ctrl+Shift+Z reverses mutations across 50 snapshots) |
| Add each layer type | Yes | Yes | `test-phase2.cjs` 2.6 PASS (Adds kineticText, card, background, imageLogo, lottie, foregroundFX) |
| Layer duplicate (Ctrl+D) | Yes | Yes | `test-phase2.cjs` 2.6 & `test-ui.cjs` PASS (Deep clone created with unique ID and offset) |
| Layer delete (Del/Backspace) | Yes | Yes | `test-phase2.cjs` 2.6 & `test-ui.cjs` PASS (Layer removed with undo toast) |
| Layer hide / lock | Yes | Yes | `test-phase2.cjs` 2.6 PASS (`_hidden` / `_locked` toggled, filtered before engine save) |
| Layer reorder | Yes | Yes | `test-ui.cjs` PASS (Drag reorder mutates layer indices and triggers save) |
| Timeline scrub syncs preview | Yes | Yes | `test-phase2.cjs` 2.7 PASS (PostMessage `motionforge:seek` dispatched, timecode updates) |
| Timeline play / pause | Yes | Yes | `test-phase2.cjs` 2.8 PASS (Space toggles 60fps playback, syncs iframe via postMessage) |
| Inspect keyframe stills | Yes | Yes | `test-phase2.cjs` 2.9 PASS (Calls keyframes endpoint, displays 5 rendered stills) |
| Draft video render | Yes | Yes | `test-phase2.cjs` 2.10 PASS (Produces 720p 30fps MP4 verified by `ffprobe`) |
| Production video render | Yes | Yes | `test-phase2.cjs` 2.11 PASS (Produces 1080p 60fps MP4 verified by `ffprobe`) |
| Command palette (Ctrl+K) | Yes | Yes | `test-phase2.cjs` 2.12 PASS (Fuzzy filter across layers, actions, and scenes) |
| Keyboard shortcuts modal (?) | Yes | Yes | `test-phase2.cjs` 2.13 PASS (Cheat sheet modal opens and filters) |
| Multi-scene tabs | Yes | Yes | `test-phase2.cjs` 2.14 PASS (Tab bar manages multiple scenes with dirty state) |
| Asset vault & upload | Yes | Yes | `test-phase2.cjs` 2.15 PASS (Uploads binary to engine vault, registers in localStorage) |
| Scene templates / new scene | Yes | Yes | `test-phase2.cjs` 2.16 PASS (Creates new blank/preset scenes) |
| Persistence across reloads | Yes | Yes | `test-phase2.cjs` 2.17 PASS (Last active scene restored from localStorage) |
| SSE live updates | Yes | Yes | `test-phase2.cjs` 2.18 PASS (EventSource connects to `/api/scenes/:id/events`) |
| Error states & recovery | Yes | Yes | `test-phase2.cjs` 2.19 PASS (Displays actionable error toasts on invalid input) |
| MCP tool contract | Yes | Yes | `test-phase2.cjs` 2.20 PASS (Exposes exactly 6 tools) |
| Rich empty states | Yes | Yes | `test-phase2.cjs` 2.21 PASS (Empty layers, preview, and render queue show SVG badges + CTAs) |
| Responsive layout | Yes | Yes | `test-phase2.cjs` 2.22 PASS (Verified at 1440x900, 1920x1080, 2560x1440) |
| Timeline zoom (Ctrl+Wheel) | Yes | Yes | `test-ui.cjs` PASS (Canvas scale adjusts anchored to mouse cursor) |
| Timeline pan (Space+Drag) | Yes | Yes | `test-ui.cjs` PASS (Canvas offsets horizontally) |
| Fullscreen preview (F) | Yes | Yes | `test-ui.cjs` PASS (Maximizes iframe preview container) |
| Performance HUD (Ctrl+Shift+P) | Yes | Yes | `test-ui.cjs` PASS (Floating diagnostics HUD with live FPS and memory) |
| Direct layer manipulation on canvas | No | N/A | Not implemented in current web UI (Target for Desktop Phase A) |
| Multi-track keyframe editor | No | N/A | Not implemented in current web UI (Target for Desktop Phase B) |
| Premiere-style trim/split/ripple delete | No | N/A | Not implemented in current web UI (Target for Desktop Phase B) |
| Native OS menus & windowing | No | N/A | Web browser only (Target for Desktop Electron shell) |

---

## 0.4 Known Good State Baseline

- **Node.js:** `v25.9.0`
- **FFmpeg:** `9.0.2-essentials_build-www.gyan.dev`
- **Git HEAD Commit:** `6d30410893170e78b2716adf4022aefb118f3629`
- **Unit Tests Status:** `329 / 329 passed across 17 test files` (`npm test`)
- **UI E2E Tests Status:** `22 / 22 passed` (`scripts/test-phase2.cjs`)
- **Baseline Screenshot:** `screenshots/desktop-baseline-01.png`
