# Feature Plan: Desktop NLE Application & Solid.js Migration

## Goal
Transform MotionForge into a production-grade desktop NLE application for motion-graphics authoring competing with After Effects / Premiere Pro, using Electron 30+, Solid.js 1.8+, Tailwind CSS 3.4, HTML5 Canvas timeline, and an SVG direct manipulation canvas overlay.

## Acceptance Criteria
- [ ] Electron 30+ shell with dynamic port allocation, child-process engine lifecycle management, and typed preload IPC.
- [ ] Solid.js 1.8+ UI with fine-grained reactivity (`solid-js/store`) and full feature parity with existing Studio UI.
- [ ] Existing 329 backend unit tests continue to pass without regression.
- [ ] Existing 22 UI Playwright tests pass against the new Solid.js UI.
- [ ] Direct canvas manipulation: SVG overlay with 8 resize handles, 1 rotation handle, snap guides, and coordinate transforms.
- [ ] Backend bounds endpoint: `GET /api/scenes/:id/frame/:frameIndex/bounds` returning accurate layer bounding boxes.
- [ ] Advanced NLE Timeline: multi-track Canvas 2D timeline, keyframe tracks, JKL playback, trim/split/ripple delete, and In/Out marks.
- [ ] Packaged desktop build runnable on Windows via `electron-builder`.

## Approach
1. **Commit 3 (Solid.js Read-Only Parity):** Set up `packages/studio` with Vite + Solid.js + Tailwind + Kobalte. Implement store, layout, inspector, layer list, preview iframe, and read-only canvas timeline.
2. **Commit 4 (Solid.js Full Feature Parity):** Add mutations, undo/redo, modal dialogs, asset vault, render queue, and keyboard shortcuts. Verify 22/22 UI tests pass.
3. **Commit 5 (Deprecate Vanilla UI):** Remove legacy frontend files; make Solid.js the single canonical UI loaded by Electron.
4. **Phase A (Direct Canvas Manipulation):** Implement backend bounds endpoint in `core-engine`, add `rotation` support in `scene-spec` and `scene-runtime`, build SVG overlay with selection, handles, snapping, and pan/zoom.
5. **Phase B (Timeline NLE):** Implement multi-track keyframe tracks, keyframe interpolator, JKL transport engine, trim/split/ripple delete, and In/Out rendering.
6. **Phase C & D (Polish & Packaging):** Keyboard-first workflow, command palette, audio waveform/scrubbing, packaging via `electron-builder`.

## Scope
- **IN:** Electron shell, Solid.js UI, Direct Canvas Manipulation (SVG overlay), Multi-track Canvas Timeline, Keyframe authoring, JKL playback, Trim/Split/Ripple delete, In/Out marks, Project save/load (`.mfproj`), Desktop packaging.
- **OUT:** Complete rewrite of core-engine or FFmpeg pipeline (core-engine remains unchanged except bounds route). External cloud storage (everything is local/vault-based).

## Dependencies
- Node >= 20, Electron 31, Solid.js 1.8, Kobalte, Tailwind CSS 3.4, Playwright, FFmpeg.

## Estimated Complexity
- XL (Full NLE Desktop Application Migration)
