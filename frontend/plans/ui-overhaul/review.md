# Feature Review: UI Overhaul & Feature Expansion

## 1. What Was Built
- **Visual Overhaul (Cinematic Amber)**: Complete theme redesign removing all violet/purple styling in favor of dark slate surfaces (`--bg-0` through `--bg-4`), radiant amber accents (`--primary`), teal cameras/scenes (`--secondary`), and rose highlights (`--accent`). Implemented strict 3-tier typography (11px, 13px, 15px) and high-visibility focus rings.
- **Zero-Build ES Module Architecture**: Modularized the monolithic `app.js` into distinct ES modules under `js/` (`api.js`, `state.js`, `ui/*`, `panels/*`, `util/*`).
- **50-Step Reactive Undo / Redo**: Deep snapshot state history tracking all layer mutations, additions, removals, renames, and reorderings with keyboard shortcuts (`Ctrl+Z`, `Ctrl+Shift+Z`) and undoable toast notifications.
- **Command Palette (`Ctrl+K` / `⌘K`)**: Desktop search launcher with instant fuzzy filtering across layers, actions, and scenes.
- **Layer Operations Suite**: Layer duplication (`Ctrl+D`), copy/paste (`Ctrl+C`/`Ctrl+V`), deletion with undo, hide/show, lock, drag-and-drop reordering, inline double-click rename, and layer search filter.
- **Grouped Collapsible Inspector**: Organized into Identity, Timing, Position, Appearance, Motion, and Advanced with live SceneSpec validation and motion preset visual badges.
- **60fps Canvas Timeline**: Horizontal zoom (<kbd>Ctrl+Wheel</kbd>), smooth pan (<kbd>Space+Drag</kbd> and Middle-Click), edge duration dragging with magnetic snap, multi-selection, and right-click context menu.
- **Bidirectional Preview Sync**: Connected timeline scrubbing and playback to the GSAP runtime in the preview iframe via `postMessage` (`motionforge:seek`, `motionforge:play`, `motionforge:pause`).
- **Power Features (Phase 2 & 3)**: Multi-scene tabs, Asset Vault with drag-and-drop file upload, SFX cues editor, Camera editor, Transitions track, persistent Render Queue with live progress, Starter Templates, Performance HUD (`Ctrl+Shift+P`), and Shortcuts Modal (`?`).
- **Automated Verification**: Playwright test suite in `scripts/test-ui.cjs` passing **19 / 19 tests** across 1440×900, 1920×1080, and 2560×1440 resolutions.

## 2. Edge Cases Handled
- **Keyboard Input Isolation**: All hotkeys (Space for playback, Delete for layer deletion, Arrows for scrub, Ctrl+Z for undo) explicitly detect when focused inside text inputs, textareas, or selects, preventing destructive accidental mutations during typing.
- **Horizontal Zoom Anchor**: Timeline zoom calculates cursor time offset and recalculates canvas scroll so the time under the cursor remains anchored during zoom.
- **MIME Type Compliance**: Custom Node static server explicitly serves `.js` files with `Content-Type: text/javascript` to adhere to browser ES module security standards.
- **Multi-Scene Dirty Tracking**: Scene tabs track modification state (`*`) and persist session states to `localStorage`.
- **API Vault Listing Fallback**: Implemented client-side persistent vault registry in `localStorage` (`motionforge_asset_vault`) to accommodate the lack of a `GET /api/assets` listing endpoint on the core engine.

## 3. Known Limitations
- The Core Engine does not natively support server-side layer exclusion for `hidden: true` during final MP4 rendering; the UI handles this via client-side preview dimming and authoring toggle.
- Core Engine lacks a `DELETE /api/scenes/:id` endpoint; deletion is handled client-side via tab and recents management.

## 4. Follow-up Tasks / Tech Debt
- Expand template library with additional motion graphics presets.
- Add audio waveform visualization if audio rendering endpoint is added to core engine.
