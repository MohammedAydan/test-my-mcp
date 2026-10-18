# Feature Context: UI Overhaul & Feature Expansion

## Files to Create/Modify
- `index.html` — Updated shell with tabs, help strip, command palette, asset tab, audio/transition timeline tracks, modal containers
- `styles.css` — Complete Cinematic Amber theme overhaul, typography, components, panels, modals, toasts
- `app.js` — Boot sequence and main controller importing ES modules
- `js/api.js` — API client for Core Engine HTTP endpoints and SSE
- `js/state.js` — Reactive store, history stack (undo/redo), persistence
- `js/ui/toast.js` — Stacked actionable toasts and progress notifications
- `js/ui/modal.js` — Accessible modal dialog system
- `js/ui/tooltip.js` — Universal hover tooltip manager
- `js/ui/command-palette.js` — Ctrl+K command palette
- `js/ui/onboarding.js` — First-run 5-step tour
- `js/ui/shortcuts.js` — Keyboard shortcut registry and help modal
- `js/panels/layers.js` — Layer list, drag-reorder, duplicate, hide, lock, rename
- `js/panels/inspector.js` — Inspector with collapsible groups, validation, presets
- `js/panels/capabilities.js` — Engine capabilities panel
- `js/panels/timeline.js` — Upgraded canvas timeline with zoom, pan, snap, context menu
- `js/panels/preview.js` — Preview iframe controller with postMessage seek/play/pause sync
- `js/panels/assets.js` — Asset vault browser and uploader
- `js/panels/render-queue.js` — Persistent render queue tracker
- `js/panels/templates.js` — Scene templates picker
- `js/util/dom.js` — DOM helper utilities (`$`, `$$`, `h`, `debounce`)
- `js/util/time.js` — Timestamp formatting and parsing
- `js/util/validate.js` — Client-side SceneSpec validation rules
- `D:\Projects\mcps\test-my-mcp\packages\scene-runtime\src\index.ts` — PostMessage listener for preview sync
- `docs/03_UI_REDESIGN_PLAN.md` — Implementation plan and API gaps
- `docs/04_UI_KEYBOARD_SHORTCUTS.md` — Keyboard shortcuts reference
- `docs/05_UI_UX_GUIDE.md` — Design system and UX guide
- `README.md` — Project README with UI documentation and screenshot reference

## New Dependencies to Add
- None (100% vanilla browser code, no npm dependencies for the UI shell)

## Env Vars / Config Needed
- `MOTIONFORGE_ENGINE_URL` / `localStorage.getItem('motionforge_engine')` (defaults to `http://127.0.0.1:4000`)

## Open Questions & API Gaps
- Gap 1: No `GET /api/assets` to list the vault files. Solution: Maintain a local asset registry in `localStorage` (`motionforge_asset_vault`), populate with uploaded assets and known demo assets, and document this gap.
- Gap 2: No scene deletion endpoint in core engine. Solution: Provide UI confirmation and remove from local open scenes / recents.
- Gap 3: Layer `hidden` flag: Core engine schema might not strip hidden layers during server-side render, but UI will gray them out in timeline and can omit or document as client-side preview toggle.
