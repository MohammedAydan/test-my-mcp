# Tasks: Desktop NLE Application & Solid.js Migration

## Phase 0: Discovery & Baseline
- [x] 0.1 Read codebase and log notes in `docs/07_DESKTOP_MIGRATION_LOG.md`
- [x] 0.2 Run baseline stack, verify zero console errors, capture `desktop-baseline-01.png`
- [x] 0.3 Verify all 33 features in inventory
- [x] 0.4 Document known good state and commit baseline tag `pre-desktop-baseline`

## Phase 1: Electron Foundation & Native Menus
- [x] 1.1 Commit 1: Wrap existing UI in Electron shell with typed IPC preload (`packages/desktop`)
- [x] 1.2 Commit 2: Native OS menus, file dialogs, `.mfproj` save/load, window title & dirty state

## Phase 2: Solid.js UI Migration
- [x] 2.1 Commit 3: Solid.js skeleton with read-only parity against demo scene
- [~] 2.2 Commit 4: Solid.js full feature parity (mutations, inspector, undo/redo, render queue, dialogs)
- [ ] 2.3 Verify all 22 UI tests (`scripts/test-phase2.cjs`) pass against Solid.js UI
- [ ] 2.4 Commit 5: Remove vanilla UI, point desktop renderer to `packages/studio`

## Phase 3: Direct Canvas Manipulation (Phase A)
- [ ] 3.1 Backend: Add `GET /api/scenes/:id/frame/:frameIndex/bounds` in `core-engine`
- [ ] 3.2 Schema & Runtime: Add `rotation` to layer specs and GSAP renderers
- [ ] 3.3 SVG Overlay: Implement 8 resize handles, 1 rotation handle, bounding boxes
- [ ] 3.4 Snap Engine: Smart guides (`--snap-guide: #22d3ee`) with 5px threshold
- [ ] 3.5 Canvas Navigation: Ctrl+Wheel zoom, Space+drag pan, Fit / 100% controls

## Phase 4: Timeline NLE (Phase B)
- [ ] 4.1 Schema: Add `KeyframeTrack` and keyframe interpolator in `scene-spec` and `scene-runtime`
- [ ] 4.2 Multi-Track Canvas: Render layer bars and property sub-tracks with diamond keyframe markers
- [ ] 4.3 Transport: JKL playback loop (1x/2x/4x, reverse, step)
- [ ] 4.4 Editing Tools: Razor split (`Cmd+K`), trim handles, ripple delete, In/Out marks (`I`/`O`)
- [ ] 4.5 Motion Presets: Dropdown/drag-and-drop to apply preset envelopes to layer segments

## Phase 5: Verification & Desktop Packaging
- [ ] 5.1 Run 329 backend unit tests (`vitest`) and assert all pass
- [ ] 5.2 Run automated desktop test suite covering Phase A & B features
- [ ] 5.3 Build desktop distributable via `electron-builder`
- [ ] 5.4 Capture verification screenshots and finalize `docs/07_DESKTOP_MIGRATION_LOG.md`
