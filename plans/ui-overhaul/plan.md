# Feature Plan: MotionForge Studio UI Overhaul & Feature Expansion

## Goal
Transform MotionForge Studio from a prototype interface into a desktop-class, high-precision motion graphics authoring studio with a Cinematic Amber visual identity, rock-solid timeline scrub and preview sync, deep keyboard navigation, undo/redo history, command palette, and comprehensive creative authoring tooling without breaking existing functionality.

## Acceptance Criteria
- [ ] Visual Identity: Strict Cinematic Amber theme applied, 0 purple/violet remnants, 4.5:1 text contrast, 3-tier typography hierarchy (11px, 13px, 15px), 4/8/12/16/24/32px spacing scale.
- [ ] Architecture: Vanilla ES modules split with zero build step; centralized store with 50-step undo/redo stack (`Ctrl+Z`, `Ctrl+Shift+Z`).
- [ ] Onboarding & Help: 5-step interactive tour, universal tooltips (400ms delay), rotating tips banner, `?` shortcut modal.
- [ ] Command Palette: Centered blurred `Ctrl+K` palette with fuzzy search across layers, scenes, and actions.
- [ ] Layer Management: Duplicate (`Ctrl+D`), delete with undo, hide/show, lock/unlock, drag-and-drop reorder, rename, filter.
- [ ] Inspector Overhaul: Collapsible grouped sections, inline field validation with error hints, color picker with presets, motion preset cards with previews.
- [ ] Timeline Upgrades: Zoom (Ctrl+Wheel / pinch), Pan (middle-mouse / Space+drag), ruler scrubbing, snap toggle, edge duration dragging, multi-select, right-click context menu.
- [ ] Preview Sync: Bidirectional postMessage sync between timeline and `scene-runtime` iframe for seek, play, and pause.
- [ ] Status & Feedback: Auto-save indicator (`● Unsaved`, `◌ Saving…`, `✓ Saved`, `⚠ Failed`), stacking actionable toasts, rich empty states, loading skeletons.
- [ ] Power User Features (Phase 2): Multi-scene tabs, Asset vault panel with drag-and-drop upload, SFX cue editor, Camera keyframe editor, Transitions editor, persistent Render queue with polling, scene templates, JSON import/export, recent scenes, fullscreen preview (`F`), layer copy/paste (`Ctrl+C`/`Ctrl+V`).
- [ ] Visual & Functional Verification: Verified against running core-engine at 1440×900, 1920×1080, and 2560×1440 with Playwright screenshots.

## Approach
1. **Zero-regression foundation**: Keep current working API and canvas logic while modernizing styling and modularizing into clean ES modules.
2. **Atomic commit checkpoints**: Commit each phase cleanly as specified.
3. **Runtime sync**: Enhance `packages/scene-runtime/src/index.ts` with postMessage message handlers for seamless seek/play/pause and build it so `/preview/` immediately gains live synchronization.
4. **Automated visual inspection**: Take and inspect screenshots across 3 viewport sizes to catch and fix any visual defects.

## Scope
- **IN SCOPE:**
  - Complete overhaul of `index.html`, `styles.css`, `app.js` (modularized into `js/`)
  - Integration of `scene-runtime` postMessage listener and rebuilding bundle
  - All Phase 1 requirements (1.1 through 1.10)
  - All Phase 2 power features (2.1 through 2.11)
  - Phase 3 polish features (panel resizing, performance HUD, settings dialog, inline docs)
  - Playwright visual verification at 3 resolutions
  - Documentation files: `docs/03_UI_REDESIGN_PLAN.md`, `docs/04_UI_KEYBOARD_SHORTCUTS.md`, `docs/05_UI_UX_GUIDE.md`, updated `README.md`
- **OUT OF SCOPE:**
  - Rewriting Fastify core-engine backend or altering server endpoints
  - Introducing npm build step to UI directory

## Dependencies
- MotionForge Core Engine on `http://127.0.0.1:4000`
- Built scene-runtime in `packages/scene-runtime/dist`
- Playwright for multi-viewport screenshot verification

## Estimated Complexity
XL (Complete UI rewrite, modularization, 20+ major features, cross-frame protocol, automated multi-viewport testing)
