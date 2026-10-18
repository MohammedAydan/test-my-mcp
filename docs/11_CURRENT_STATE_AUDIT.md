# MotionForge Master Audit: Current State, Discrepancies & Verification

**Document Version:** 1.0.0  
**Audit Date:** 2026-10-19  
**Auditor:** Senior Software Engineer (AI Pair Programmer)  
**Session Directive:** Diagnosis and planning only. Zero code changes permitted.

---

## 1. Executive Summary

This audit was conducted in response to end-user reports that despite previous reports claiming feature completion and automated test passes (374/374), actual usage of the MotionForge desktop application reveals severe UX breakage, missing core NLE capabilities, disconnected canvas controls, and profound interaction frustrations.

### Core Findings
1. **Automated Tests Tested Mock States, Not Real Workflows:** The previous automated test suites (`test-phase-a-overlay.cjs`, `test-phase-b-timeline.cjs`) checked that JavaScript variables in `window.state` changed value in response to mouse events. They **never checked** whether the preview iframe updated, whether the backend engine persisted the changes, or whether undo reverted the canvas.
2. **The Preview Iframe is Disconnected from Canvas Manipulation:** Dragging a layer's handles in `CanvasOverlay.tsx` mutates local SVG coordinates, but **never posts a save to the backend engine** and **does not update the iframe in real-time**. The visual layer in the video preview remains frozen in its original position while the user drags an empty orange wireframe.
3. **Undo for Canvas Manipulation is Broken:** On `pointerup`, `CanvasOverlay.tsx` calls `store.pushHistory()` **after** the mutation has already occurred, pushing the post-drag state onto the undo stack. Pressing `Ctrl+Z` "restores" the already-moved position.
4. **Timeline Lacks Vertical Scrolling:** The Timeline Canvas has a fixed height (~146px available for tracks) with **zero vertical scroll support** (`scrollY` is neither stored nor applied to `ctx.translate`). Any scene with more than 3–4 layers cuts off subsequent tracks completely with no scrollbar.
5. **No Concept of Non-Overlapping Multi-Clip Tracks:** The data model and timeline renderer strictly map 1 Layer = 1 Track row. Two layers that do not overlap in time cannot share a timeline row.
6. **Panels Have Hardcoded Dimensions:** Panel widths (`280px 1fr 340px`) and heights (`42px auto 1fr 210px 26px`) are fixed in CSS grid rules with zero resizable splitters.
7. **Drag and Drop is Non-Existent:** Neither `Preview.tsx`, `CanvasOverlay.tsx`, nor `Timeline.tsx` contains `onDragOver` or `onDrop` handlers. Dragging media onto the canvas or timeline does nothing.

---

## 2. Git State & Inventory

- **Active Branch:** `feat/desktop-app`
- **Current HEAD Hash:** `e089697`
- **Working Tree Cleanliness:** Clean (0 uncommitted files)
- **Upstream Status:** 9 commits ahead of `origin/main`:
  1. `68fc024` — `feat(desktop): wrap existing UI in Electron shell`
  2. `94a552d` — `feat(desktop): native menus, file dialogs, project save/load`
  3. `958ecfe` — `feat(studio): Solid.js skeleton with read-only parity`
  4. `0c15fcd` — `feat(studio): full feature parity in Solid`
  5. `9c11e94` — `refactor(studio): remove vanilla UI, Solid is canonical`
  6. `09f032f` — `feat(canvas): direct manipulation SVG overlay with resize, rotate, and snapping`
  7. `c585b97` — `feat(timeline): multi-track NLE canvas with keyframes, JKL transport, razor split, and ripple delete`
  8. `e089697` — `chore(release): package and verify standalone desktop NLE application`
- **Total Audited Files:** 92 distinct source, test, doc, and config files (excluding node_modules and build artifacts).

---

## 3. Read Inventory (Audited Files)

### Backend: `packages/scene-spec/src/`
- `assets.ts`: Declares `AssetDeclaration` schema and allowed URI schemes (`vault:`, `data:`, `http://`, `https://`). Enforces strict MIME typing.
- `audio.ts`: Declares audio track contracts (`sfxCueSchema`, `musicCueSchema`, millisecond pan offsets). Bounds cue times within scene duration.
- `camera.ts`: Zod schema for 2.5D camera rig containing translation offsets, zoom scale factors, and keyframe points. Enforces non-negative focal bounds.
- `common.ts`: Reusable primitive schemas including hex colors, paint fills, timestamps, easing enums, and dimension units.
- `coverage.ts`: Analytical rule set checking for empty foreground gaps and transition midpoint bridges. Emits warnings for uncovered void frames.
- `field-guide.ts`: Authoring guide and minimal valid scene templates consumed by LLMs and MCP discovery. Guaranteed to parse against `sceneSpecSchema`.
- `index.ts`: Public entrypoint for `@motionforge/scene-spec` exporting schema unions, infer types, and validation helpers.
- `motion.ts`: Registry definitions for entrance, emphasis, and exit named animation presets. Discriminated union objects with custom duration and easing overrides.
- `project-manifest.ts`: Schema for client creative project manifests (`motionforge.project.json`). Tracks deliverables, aspect ratios, brand tokens, and render targets.
- `scene.ts`: Root `SceneSpec` schema union enforcing duration, canvas shapes (`16:9`, `9:16`, `1:1`, `4:5`), layers array, and schemaVersion 1.
- `validate.ts`: Strict Zod validation wrapper returning structured `.flatten()` issues and typed scene trees.
- `layers/background.ts`: Schema for background layer variants (solid colors, linear gradients, radial mesh, video plates).
- `layers/base.ts`: Base attributes for all visual layers (id, type, at, duration, position `{xPct, yPct}`, optional rotation, keyframe tracks).
- `layers/card.ts`: Container and card layer schemas with glassmorphism blur, tint colors, rounded borders, and title/body content.
- `layers/foreground-fx.ts`: Visual effect overlays (vignette, film grain, light leaks, particles) applied across the viewport.
- `layers/image-logo.ts`: Raster and vector image layer schema referencing declared project assets with dimensions and aspect preservation.
- `layers/kinetic-text.ts`: Animated kinetic typography schema with RTL text direction, font family roles, size, fill paint, and word/char/line splitting.
- `layers/lottie.ts`: Lottie vector animation layer schema with asset binding, loop modes, and frame playback rate controls.

### Backend: `packages/core-engine/src/`
- `capabilities.ts`: Fastify route handler reporting engine hardware, toolchain status, available presets, and field guide schemas.
- `config.ts`: Environment configuration resolving filesystem paths (`data/scenes`, `vault`, `dist`, `temp`) and port defaults.
- `demo.ts`: Script generating and seeding the comprehensive 16s showcase demo scene with multi-layer assets.
- `doctor.ts`: Toolchain validator checking host installation of FFmpeg, Chromium, SFX audio banks, and built runtime bundles.
- `encoder.ts`: FFmpeg pipe manager executing hardware-accelerated video compilation via stdin image streams and audio muxing.
- `index.ts`: Package entrypoint exporting `startEngine`, `RenderRunner`, and `SceneStore`.
- `keyframes.ts`: Deterministic Chromium frame capturer producing lightweight inline JPEGs and disk PNGs; includes sub-pixel `getFrameBounds`.
- `main.ts`: CLI entrypoint bootstrapping Fastify engine listener with optional host/port overrides.
- `project-assets.ts`: Asset resolver copying project-relative files into the engine vault automatically.
- `project-workspace.ts`: Scaffolds autonomous creative-project directory workspaces from standard templates.
- `render-runner.ts`: Background job queue managing render workers, status polling, and disk artifact persistence.
- `renderer.ts`: Headless Playwright Chromium pool coordinator navigating to `/preview/` and executing `seekToFrame`.
- `scene-analysis.ts`: Static scene validator checking for camera void bounds and foreground coverage holes.
- `scene-store.ts`: In-memory scene registry backed by atomic JSON disk persistence and event emitters.
- `server.ts`: 17-route Fastify HTTP server exposing scenes, renders, keyframes, vault, bounds, and SSE live streams.
- `sfx-bank.ts`: Procedural audio synthesizer generating local OGG sound effects (whoosh, pop, click, riser).
- `smoke.ts`: Quick smoke test verifying minimal end-to-end rendering pipeline through FFmpeg and Playwright.
- `vault.ts`: Binary file vault storing uploaded assets with sanitized filenames and content-type streaming.

### Runtime: `packages/scene-runtime/src/`
- `api.ts`: Client bridge fetching scene specs and notifying parent window of ready states.
- `camera.ts`: Pure functional 2.5D camera rig calculator computing stage transformations, focus nudges, and pan clamping.
- `determinism.ts`: Deterministic double-rAF settlement harness ensuring fonts, styles, and images settle before frame capture.
- `envelope.ts`: Temporary effect envelope wrapper ensuring animations start and end at exact identity.
- `fonts.ts`: Font loader waiting for `document.fonts.ready` before marking frames capturable.
- `index.ts`: Browser runtime entrypoint exposing `seekToFrame`, timeline mount, layer bounds calculation, and postMessage bridge.
- `motion-slots.ts`: GSAP animation coordinator attaching entrance, emphasis, and exit presets to layer DOM containers.
- `presets.ts`: Registry of GSAP v3 animation presets with professional easing curves and line-based clipping wipes.
- `scene-builder.ts`: Master timeline compiler instantiating GSAP master timeline from declarative SceneSpec.
- `stage.ts`: Viewport container scaler maintaining 1920x1080 design space regardless of render dimensions.
- `timeline-ui.ts`: Interactive canvas scrubber overlay mounted in browser preview mode.
- `transitions.ts`: Inter-act visual transitions (whipPan, crossFade, wipe, morph) holding midpoint seams.
- `types.ts`: TypeScript interfaces for runtime stage, mounted instances, and lifecycle maps.
- `layers/background.ts`: GSAP DOM renderer for solid, gradient, and mesh background canvases.
- `layers/card.ts`: DOM renderer for glassmorphic cards with responsive borders and backdrop blur.
- `layers/context.ts`: Shared renderer context providing time offsets and asset URL resolvers.
- `layers/foreground-fx.ts`: Visual shader and canvas effect renderer for vignettes, grain, and leaks.
- `layers/image-logo.ts`: Image and SVG logo renderer with aspect ratio letterboxing and frosted plates.
- `layers/index.ts`: Layer renderer factory dispatching layer types to specialized renderers.
- `layers/kinetic-text.ts`: Typography renderer splitting text into lines, words, or characters with directional wipes.
- `layers/lottie.ts`: Lottie vector animation renderer driving frames synchronously via GSAP tweens.

### Desktop: `packages/desktop/src/` & Configs
- `electron-builder.yml`: Packaging configuration targeting Windows NSIS/portable, macOS DMG, and Linux AppImage.
- `electron.vite.config.ts`: Build configuration compiling main, preload, and renderer targets with Vite.
- `package.json`: Desktop workspace manifest pinning Electron 31.7.7 and dependencies.
- `tsconfig.json`: TypeScript configuration for Electron Node/Chromium environments.
- `src/main.ts`: Main process script spawning engine child process, building native menus, and handling IPC.
- `src/preload.ts`: Context bridge exposing typed `window.motionforge` IPC methods.

### Studio UI: `packages/studio/src/` & Configs
- `index.html`: Shell HTML page mounting Solid.js root element.
- `package.json`: Studio workspace manifest with Solid.js 1.8, Kobalte, and Tailwind CSS.
- `postcss.config.js`: PostCSS configuration loading Tailwind and Autoprefixer.
- `tailwind.config.js`: Tailwind configuration declaring theme colors and layout metrics.
- `tsconfig.json`: TypeScript compiler options for Solid JSX and strict ESM.
- `vite.config.ts`: Vite build configuration for Solid UI.
- `src/api.ts`: REST and SSE client for Core Engine endpoints.
- `src/App.tsx`: Root application coordinator managing keyboard shortcuts, auto-save, and layout.
- `src/index.tsx`: Solid.js entrypoint rendering `<App />` into DOM.
- `src/store.ts`: Central reactive store with 50-step undo/redo stack and scene mutations.
- `src/styles.css`: Cinematic Amber CSS variables, panel metrics, and utility classes.
- `src/types.ts`: Studio-specific layer and scene type extensions.
- `src/components/CanvasOverlay.tsx`: SVG overlay rendering bounding boxes, resize/rotate handles, snapping guides, and pan/zoom.
- `src/components/CommandPalette.tsx`: Fuzzy search modal for quick layer navigation and application actions.
- `src/components/Header.tsx`: Titlebar with native window buttons, scene tabs, transport, undo/redo, and render trigger.
- `src/components/HelpTipBar.tsx`: Contextual tip strip displaying actionable keyboard hints.
- `src/components/Inspector.tsx`: Grouped accordion property inspector for active layer parameters.
- `src/components/LayersPanel.tsx`: Left tabbed sidebar managing layers, scene info, and assets.
- `src/components/Modal.tsx`: Dialog host for scene loading, templates, render queue, and keyframe inspection.
- `src/components/OnboardingTour.tsx`: Multi-step interactive feature tour for first-time sessions.
- `src/components/Preview.tsx`: Center panel housing preview iframe, canvas overlay, and viewport controls.
- `src/components/StatusBar.tsx`: Bottom status bar showing engine connection, port, and layer count.
- `src/components/Timeline.tsx`: Multi-track Canvas 2D timeline with left track headers, keyframes, and JKL playback.
- `src/components/Toasts.tsx`: Toast notification container for non-blocking status alerts.

---

## 4. Verification & Reproduction of the 11 User Complaints

### Complaint #1: Design Still Not Optimal (Unfinished / Unprofessional Layout)
- **User's claim:** "Design still not optimal — layout feels unfinished, unprofessional"
- **Reproduction steps:**
  1. Launch desktop app (`MotionForge.exe`).
  2. Inspect titlebar, left panel tabs, preview toolbar, and inspector typography.
  3. Observe misaligned heights, hardcoded padding, low contrast icon labels, and cramped header tabs.
- **Observed behavior:**
  - Layout has fixed, rigid dimensions (`styles.css:136, 377`).
  - Viewport zoom toolbar floats inside the preview area rather than docking neatly into the preview header.
  - Buttons in the titlebar have varying padding, and the scene tabs bar overflows awkwardly when more than 2 scenes are open.
  - Dark mode contrast in the inspector is inconsistent (e.g., `#71717a` against `#12121a` fails WCAG AA readability for 11px font sizes).
- **Screenshot:** `screenshots/audit-complaint-1.png`
- **Root cause:** `packages/studio/src/styles.css:136, 377`, `packages/studio/src/components/Header.tsx:35-51`.
- **Classification:** Design gap & CSS architectural defect.
- **Severity:** P1 (Poor aesthetic credibility and visual hierarchy).
- **Proposed fix:** Redesign application shell with professional CSS flex/grid layout, consistent 28px/32px button tokens, WCAG AA contrast compliance, and docked panel toolbars.
- **Estimated effort:** M

---

### Complaint #2: No Responsibility (Unclear Separation of Concerns in UI Code & Panels)
- **User's claim:** "No responsibility (unclear ownership / separation of concerns in UI code, or unclear panel responsibilities)"
- **Reproduction steps:**
  1. Examine `LayersPanel.tsx`: observe it contains "Layers", "Scene Info", and "Assets" in a single left accordion tab.
  2. Examine `Preview.tsx` vs `CanvasOverlay.tsx`: observe `CanvasOverlay` contains zoom level dropdown, fit button, and snapping toggles.
  3. Examine `Timeline.tsx`: observe it contains razor split, ripple delete, and In/Out clear buttons mixed with track headers.
- **Observed behavior:**
  - Panel responsibilities are conflated: Assets Vault is stuffed into a secondary tab under Layers instead of being a dedicated Project Media Bin panel.
  - CanvasOverlay owns viewport navigation state instead of Preview.
  - Transport controls are split: Play/Pause/Timecode is in Header and central transport bar, while In/Out and Split buttons are in Timeline toolbar.
- **Screenshot:** `screenshots/audit-complaint-2.png`
- **Root cause:** `packages/studio/src/components/LayersPanel.tsx:74-102`, `packages/studio/src/components/CanvasOverlay.tsx:690-750`.
- **Classification:** Architecture & UI Component Design Gap.
- **Severity:** P1 (Disorganized user mental model).
- **Proposed fix:** Decompose panels into single-responsibility views: Project Media Bin panel (left), Scene Hierarchy panel (left), Canvas Viewport (center), Inspector (right), Centralized Transport Bar, and Track Timeline (bottom).
- **Estimated effort:** L

---

### Complaint #3: Control Over Elements is Poor (Selection & Manipulation Imprecise)
- **User's claim:** "Control over elements is poor — selection, editing, manipulation feel imprecise"
- **Reproduction steps:**
  1. Load demo scene.
  2. Click on a text element in the canvas overlay.
  3. Observe bounding box position and attempt to nudge with arrow keys.
- **Observed behavior:**
  - Arrow keys do not nudge selected elements on the canvas (arrow keys are unhandled in canvas focus).
  - Bounding box calculation falls back to `textLen * size * 0.55` which severely underestimates text width for large font sizes (e.g. 140px text generates a 132px box instead of 780px).
  - Clicking on a layer in the canvas uses a simplistic bounding box hit test that fails on rotated or transformed elements.
- **Screenshot:** `screenshots/audit-complaint-3.png`
- **Root cause:** `packages/studio/src/components/CanvasOverlay.tsx:130-145, 344-348`.
- **Classification:** Frontend logic bug & math inaccuracy.
- **Severity:** P0 (Prevents precise element layout).
- **Proposed fix:** Query real live element bounding boxes via DOM matrix transforms; implement pixel-perfect polygon raycasting for rotated elements; add arrow-key nudging (1px, Shift=10px).
- **Estimated effort:** M

---

### Complaint #4: Timeline Element Control is Poor (Interactions Feel Unreliable)
- **User's claim:** "Timeline element control is poor — interactions feel unreliable"
- **Reproduction steps:**
  1. Click on the timeline canvas to position the playhead.
  2. Attempt to grab the 6px edge of a layer bar to resize its duration.
  3. Drag layer along time axis.
- **Observed behavior:**
  - Edge hover zone is only 6px (`edgeHoverZone = 6`), making it extremely difficult to grab trim handles on high-DPI displays.
  - During drag, no tooltips show the start time, end time, or delta frames.
  - Scrubbing drops frames or stutters because the preview iframe receives postMessage on every mousemove without requestAnimationFrame throttling.
- **Screenshot:** `screenshots/audit-complaint-4.png`
- **Root cause:** `packages/studio/src/components/Timeline.tsx:30, 280-360`.
- **Classification:** Frontend UX & Interaction Bug.
- **Severity:** P1 (Frustrating, error-prone timeline editing).
- **Proposed fix:** Expand trim handle hit target to 12px with dedicated visual cursor cues; add live duration badge during trim; throttle postMessage seeks with rAF.
- **Estimated effort:** M

---

### Complaint #5: Cannot See More Than ~3 Layers Stacked (No Vertical Scrolling)
- **User's claim:** "Cannot see more than ~3 layers stacked — no vertical scrolling in the layer list or timeline track list"
- **Reproduction steps:**
  1. Add 5 or more layers to a scene.
  2. Look at the timeline canvas tracks area.
  3. Attempt to scroll down using mouse wheel or scrollbar.
- **Observed behavior:**
  - The Timeline canvas has a fixed height of ~146px for track lanes.
  - Tracks 1, 2, 3, and part of 4 render. Track 5 and beyond are rendered off the bottom of the canvas.
  - There is **no vertical scroll offset** in `Timeline.tsx` (`currentY` starts at `RULER_H + 4` and never shifts by `scrollY`).
  - The canvas does NOT have a vertical scrollbar, nor does it respond to vertical mouse wheel scrolling.
- **Screenshot:** `screenshots/audit-complaint-5.png`
- **Root cause:** `packages/studio/src/components/Timeline.tsx:107-136, 139-152`.
- **Classification:** Design & Frontend Architecture Gap (Critical missing feature).
- **Severity:** P0 (Blocks multi-layer authoring completely).
- **Proposed fix:** Implement virtualized vertical scrolling: store `timelineScrollY`, apply `ctx.translate(0, -timelineScrollY)` to canvas, add custom scrollbar or synchronize with left track headers scroll element.
- **Estimated effort:** M

---

### Complaint #6: No Way to Control Individual Panel Sizes (No Resizable Splitters)
- **User's claim:** "No way to control individual panel sizes — no resizable splitters between panels"
- **Reproduction steps:**
  1. Move mouse to the border between the left Layers panel and center Preview.
  2. Move mouse to the border between Preview and Inspector, or Preview and Timeline.
  3. Observe cursor and attempt to click-and-drag.
- **Observed behavior:**
  - Cursor remains default pointer.
  - Panels cannot be resized horizontally or vertically.
  - `styles.css:136` hardcodes `grid-template-rows: 42px auto 1fr 210px 26px;`.
  - `styles.css:377` hardcodes `grid-template-columns: 280px 1fr 340px;`.
- **Screenshot:** `screenshots/audit-complaint-6.png`
- **Root cause:** `packages/studio/src/styles.css:136, 377`.
- **Classification:** Missing feature / Design gap.
- **Severity:** P1 (Restricts workspace customization).
- **Proposed fix:** Implement draggable 4px splitters between panels with `col-resize` / `row-resize` cursors; persist customized panel dimensions to localStorage.
- **Estimated effort:** M

---

### Complaint #7: No Direct Drag-and-Drop for Elements onto Canvas or Timeline
- **User's claim:** "No direct drag-and-drop for elements — dragging layers/assets onto canvas or timeline doesn't work"
- **Reproduction steps:**
  1. Open Assets tab in left panel.
  2. Drag an asset (or file from OS Explorer) toward the canvas preview or timeline.
  3. Release mouse over canvas or timeline.
- **Observed behavior:**
  - Cursor displays "no-drop" / forbidden circle with slash.
  - Element returns to source or does nothing.
  - `Preview.tsx` and `Timeline.tsx` have zero `dragover` or `drop` event listeners.
- **Screenshot:** `screenshots/audit-complaint-7.png`
- **Root cause:** Complete absence of HTML5 Drag and Drop event handlers in `packages/studio/src/components/Preview.tsx` and `Timeline.tsx`.
- **Classification:** Missing feature.
- **Severity:** P0 (Fundamental workflow gap expected by video editors).
- **Proposed fix:** Implement `dragover` / `drop` on CanvasOverlay (instantiating new layer at drop `{xPct, yPct}`) and on Timeline (instantiating layer at drop timecode and target track).
- **Estimated effort:** M

---

### Complaint #8: Cannot Place More Than One Layer on the Same Timeline Row
- **User's claim:** "Cannot place more than one layer on the same timeline row — even when their time ranges don't overlap. This is a fundamental NLE feature that's missing."
- **Reproduction steps:**
  1. Create a scene with Layer A from 0s to 3s and Layer B from 4s to 7s.
  2. Look at the timeline tracks.
- **Observed behavior:**
  - Layer A occupies Row 1.
  - Row 1 between 3s and 7s is completely empty.
  - Layer B is forced onto Row 2.
  - `Timeline.tsx` iterates through `scene.layers` and increments `currentY += totalH + TRACK_GAP` for every single layer.
- **Screenshot:** `screenshots/audit-complaint-8.png`
- **Root cause:** `packages/studio/src/components/Timeline.tsx:115-133` and underlying SceneSpec data model equating layers directly to track lanes.
- **Classification:** Data model & UI architecture limitation.
- **Severity:** P0 (Fundamental NLE architectural deviation).
- **Proposed fix:** Introduce a Track abstraction (`tracks: TrackLane[]` where each track contains an array of non-overlapping `clips: LayerId[]`). The timeline renders track lanes, and packs non-overlapping clips into the same lane.
- **Estimated effort:** L

---

### Complaint #9: No Real/Correct Control Over Elements in the Preview
- **User's claim:** "No real/correct control over elements in the preview — canvas manipulation is buggy"
- **Reproduction steps:**
  1. Select a layer on canvas.
  2. Drag the resize or position handle.
  3. Check the preview iframe content and check the backend scene.
- **Observed behavior:**
  - The preview iframe video element **never moves**. It remains frozen at its initial position.
  - `CanvasOverlay.tsx` updates `store.state.scene.layers.position`, but does **not call `api.createScene`** on `pointerup`.
  - When the user presses `Ctrl+Z`, the position does not revert because `pushHistory` was called on `pointerup` with the post-drag state.
- **Screenshot:** `screenshots/audit-complaint-9.png`
- **Root cause:** `packages/studio/src/components/CanvasOverlay.tsx:458-469, 536-542`.
- **Classification:** Frontend logic bug & backend synchronization omission.
- **Severity:** P0 (Renders canvas direct manipulation non-functional).
- **Proposed fix:** Push pre-drag state to undo stack on `pointerdown`; emit live `postMessage` transform updates to preview iframe during `pointermove`; call `executeSave()` on `pointerup`.
- **Estimated effort:** M

---

### Complaint #10: Real-Time Control is Broken ("لغبطة وغلطات كتير جدا")
- **User's claim:** "Real-time control is broken — 'لغبطة وغلطات كتير جدا' (chaos and many errors) when interacting with elements"
- **Reproduction steps:**
  1. Play the scene (Space).
  2. Click on a moving layer in the preview canvas.
  3. Observe bounding box positioning while playback is active.
- **Observed behavior:**
  - Bounding box is frozen at static frame 0 resting coordinates while the actual text animations (springPop, slideUp) animate in the iframe.
  - Clicking on the animated text hits empty canvas; clicking on the misaligned wireframe pauses or jumps unexpectedly.
  - Multiple desynchronized timers and state updates cause visual flickering and erratic element jumps.
- **Screenshot:** `screenshots/audit-complaint-10.png`
- **Root cause:** `packages/studio/src/components/CanvasOverlay.tsx:106-148, 332-350`.
- **Classification:** Architectural desynchronization bug.
- **Severity:** P0 (Severe disorientation and broken UX).
- **Proposed fix:** During playback, disable overlay handle manipulation or continuously sync matrix bounds from iframe via SharedArrayBuffer / rAF postMessage bridge; hide transform wireframes during active playback.
- **Estimated effort:** L

---

### Complaint #11: Additional Issues Beyond These ("وغيرهم من مشاكل")
- **User's claim:** "وغيرهم من مشاكل (and more issues beyond these)"
- **Reproduction steps:**
  1. Inspect SFX / Audio tracks: observe no waveform visualization.
  2. Inspect Keyframe track: observe no bezier curve control or easing handle handles.
  3. Inspect Inspector: observe numeric inputs lack drag-to-scrub functionality (standard in AE/Premiere).
- **Observed behavior:**
  - Audio cues are represented only by text markers, without audio waveform visualization.
  - Keyframes are linear diamonds with no velocity curves or graph editor.
  - Inspector numbers must be typed manually instead of dragged with mouse scrubber.
- **Screenshot:** `screenshots/audit-complaint-11.png`
- **Root cause:** UI primitives in `Inspector.tsx` and `Timeline.tsx` are basic HTML inputs without NLE tactile scrubbers.
- **Classification:** Missing professional NLE feature set.
- **Severity:** P1.
- **Proposed fix:** Add drag-to-scrub numeric inputs (`ScrubbableNumber`), audio waveform rendering via Web Audio API, and a curve editor toggle.
- **Estimated effort:** L

---

## 5. Verification of Previous Claims

| Claim from Previous Report | Verified Truth | Verdict | Evidence |
|---|---|---|---|
| Electron 31.7.7 with sandbox & contextIsolation | Verified in `packages/desktop/src/main.ts` | **PASS** | `webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }` |
| Dynamic Engine Port | Verified in `packages/desktop/src/main.ts` | **PASS** | Binds to OS free port when `MOTIONFORGE_ENGINE_URL` is omitted |
| Typed IPC bridge (`window.motionforge`) | Verified in `packages/desktop/src/preload.ts` | **PASS** | Context bridge exposes typed IPC methods |
| `.mfproj` Project Save / Load | Verified in `scripts/test-desktop-launch.cjs` | **PASS** | File written and loaded with valid schema |
| Standalone `.exe` Built | Verified on disk | **PASS** | `packages/desktop/dist/win-unpacked/MotionForge.exe` (180MB) launches |
| Solid.js 1.8 + Tailwind 3.4 + Kobalte | Verified in `packages/studio/package.json` | **PASS** | Dependencies present and compiled |
| Cinematic Amber palette | Verified across styles.css and components | **PASS** | Grep found 0 violet hex codes in `packages/studio` |
| 50-step undo/redo | Verified for inspector inputs, **broken for canvas drag** | **PARTIAL** | Canvas drag pushes post-drag state on pointerup |
| Command palette ⌘K | Opens and executes commands | **PASS** | Tested in Electron |
| Multi-scene tabs | Multiple scenes open in tabs | **PASS** | Tab bar renders active/inactive scenes |
| Asset vault | Uploads and serves assets | **PASS** | Binary upload and vault persistence verified |
| Render queue persistence | Persists in localStorage | **PASS** | Jobs preserved across reloads |
| Bounds endpoint `GET /api/scenes/:id/frame/:frameIndex/bounds` | Verified via curl | **PASS** | Returns sub-pixel bounds for all layers |
| Rotation field in schema | Present in `layerBaseSchema` | **PASS** | `rotation: z.number().min(-360).max(360).optional()` |
| Canvas overlay with 8 handles + rotation | Handles render, but **drag does not update preview or backend** | **FAIL** | Preview iframe stays frozen, backend never receives save |
| Cyan snapping guides `#22d3ee` 5px | Guides render during drag | **PASS** | Active guides appear when within 5px threshold |
| Marquee selection | Drag selects multiple layers | **PASS** | Bounding box intersections computed |
| Zoom/pan in preview | Viewport zoom and pan work | **PASS** | Ctrl+wheel and toolbar select change zoom |
| Extended schema with keyframeTrackSchema | Declared in `scene-spec` | **PASS** | `tracks?: KeyframeTrack[]` validates |
| Multi-track canvas timeline with 220px headers | Fixed 220px headers rendered | **PASS** | Verified in `Timeline.tsx:10` |
| Collapsible property sub-tracks | Expands property tracks | **PASS** | Expands on caret click |
| Diamond keyframe markers | Renders diamond markers on canvas | **PASS** | Drawn on property tracks |
| In/Out point markers `[I]` `[O]` | Hotkeys and buttons shade non-work area | **PASS** | Canvas marks rendered |
| Razor split `Ctrl+K` | Splits active layer into two segments | **PASS** | Creates second layer at playhead |
| Ripple delete `Shift+Delete` | Deletes layer and shifts subsequent | **PASS** | Tested and verified |
| JKL transport | Transport speeds up and reverses | **PASS** | L=1x/2x, K=pause, J=-1x/-2x |
| Vertical scrolling on timeline | **Completely missing** | **FAIL** | Canvas has zero vertical scrolling, cuts off >3 layers |
| Same-row multi-layer placement | **Completely missing** | **FAIL** | 1 layer = 1 row strictly enforced |
| Resizable panel splitters | **Completely missing** | **FAIL** | Fixed widths and heights in CSS grid |
| Drag-and-drop onto canvas/timeline | **Completely missing** | **FAIL** | Zero onDrop handlers in Preview or Timeline |

---

## 6. Test Suite Results (Session Run)

- **Backend Unit Tests (`npm test`):** **329 / 329 passed** (17 test files, 12.75s).
- **UI E2E Test Suite (`test-phase2.cjs`):** **22 / 22 passed** (Render draft 720p/30fps and production 1080p/60fps verified).
- **Responsive Viewport Suite (`test-ui.cjs`):** **19 / 19 passed**.
- **Phase A Overlay Suite (`test-phase-a-overlay.cjs`):** `PASS` *(Test gap: only verified `window.state` in memory, not preview iframe or backend persistence)*.
- **Phase B Timeline Suite (`test-phase-b-timeline.cjs`):** `PASS` *(Test gap: only verified 4 layers in initial viewport, never tested vertical scrolling or >4 layers)*.
- **Desktop Launch Suite (`test-desktop-launch.cjs`):** `PASS`.
- **Packaged Executable Suite (`test-packaged-exe.cjs`):** `PASS`.

---

## 7. Audit Conclusion & Next Steps

The discrepancy between the previous "Mission Complete" report and the end user's experience is now fully understood and documented:
1. Automated tests verified that **in-memory data models** updated, but did not verify that the **visual canvas and video pipeline reflected those changes in real-time**.
2. Critical desktop NLE architectural capabilities were never designed: **timeline vertical scrolling**, **resizable splitters**, **multi-clip track lanes**, **drag-and-drop ingestion**, and **live canvas-to-engine persistence**.

Remediation plans have been drafted across Backend (`docs/plans/BACKEND_PLAN.md`), Desktop App (`docs/plans/DESKTOP_APP_PLAN.md`), and UI/UX (`docs/plans/UI_UX_PLAN.md`) to guide implementation in authorized follow-up sessions.
