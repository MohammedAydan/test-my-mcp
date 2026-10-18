# Tasks: UI Overhaul & Feature Expansion

## Phase 0 — Read & Plan
- [x] Phase 0: Read docs, examine existing codebase, and author `docs/03_UI_REDESIGN_PLAN.md` with implementation plan and API gaps

## Phase 1 — Core UX
- [x] Phase 1a: Visual overhaul only (Cinematic Amber palette, 3-tier typography, 0 violet remnants)
- [x] Phase 1b: Structural split into ES Modules (`app.js`, `js/api.js`, `js/state.js`, `js/panels/*`, `js/ui/*`, `js/util/*`)
- [x] Phase 1c: Centralized State store + 50-step undo/redo stack (`Ctrl+Z`, `Ctrl+Shift+Z`)
- [x] Phase 1d: Onboarding tour, tooltips, tips bar, and keyboard shortcuts modal (`?`)
- [x] Phase 1e: Command palette (`Ctrl+K` / `⌘K`) with fuzzy search across layers, scenes, and actions
- [x] Phase 1f: Layer operations (duplicate, delete undoable, hide/show, lock, drag reorder, rename, filter)
- [x] Phase 1g: Inspector overhaul (grouped collapsible sections, inline validation, color picker, motion presets)
- [x] Phase 1h: Timeline upgrades (zoom, pan, ruler scrub, snap, duration edge drag, multi-select, context menu)
- [x] Phase 1i: Preview seek/play/pause sync via postMessage + `scene-runtime` listener
- [x] Phase 1j: Auto-save indicator, stacking actionable toasts, loading skeletons, rich empty states
- [x] Phase 1 Verification Gate: Visual and functional testing, Playwright screenshots at 3 viewports

## Phase 2 — Power User Features
- [x] Phase 2.1: Multi-scene tabs in titlebar (with dirty indicator, max 8 tabs, `Ctrl+W`)
- [x] Phase 2.2: Asset vault panel (listing from local registry, upload button, drag-and-drop on preview)
- [x] Phase 2.3: SFX cue editor on timeline audio track
- [x] Phase 2.4: Camera keyframes editor in inspector / scene tab
- [x] Phase 2.5: Transitions editor in scene panel and timeline track
- [x] Phase 2.6: Persistent Render queue panel with background polling & history
- [x] Phase 2.7: Scene templates picker for new scenes
- [x] Phase 2.8: Export / Import (download JSON, import file, copy to clipboard)
- [x] Phase 2.9: Recent scenes in Load modal
- [x] Phase 2.10: Fullscreen preview mode (`F` key)
- [x] Phase 2.11: Layer copy/paste (`Ctrl+C` / `Ctrl+V`)

## Phase 3 — Polish & Documentation
- [x] Phase 3.1: Draggable panel resizing dividers
- [x] Phase 3.2: Performance HUD (`Ctrl+Shift+P`)
- [x] Phase 3.3: Settings dialog & inline documentation tooltips
- [x] Phase 3.4: Author `docs/04_UI_KEYBOARD_SHORTCUTS.md`, `docs/05_UI_UX_GUIDE.md`, and update root `README.md`
- [x] Phase 3.5: Final Quality Gates check and completion report
