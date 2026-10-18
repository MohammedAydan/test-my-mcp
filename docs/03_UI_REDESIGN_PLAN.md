# MotionForge Studio — UI Redesign Plan & Specification

> **⚠️ SUPERSEDED / AUDIT REALITY CHECK (October 2026):**  
> This prototype document outlined the initial browser-based redesign. An empirical audit revealed significant interaction shortcomings (disconnected canvas overlay, timeline clipping, missing splitters).  
> **See the active, verified remediation plan in [`plans/UI_UX_PLAN.md`](plans/UI_UX_PLAN.md) and [`11_CURRENT_STATE_AUDIT.md`](11_CURRENT_STATE_AUDIT.md).**

**Date:** 2026-10-18  
**Author:** MotionForge Studio Senior Software Engineer  
**Status:** Superseded by UI_UX_PLAN.md

---

## 1. Objectives & Scope

MotionForge Studio is undergoing a comprehensive UI overhaul and feature expansion to transition from a prototype to a desktop-class, high-efficiency motion design workstation.

### Core Goals:
1. **Visual Identity**: Replace the violet prototype theme with "Cinematic Amber" inspired by DaVinci Resolve, Linear, and Figma.
2. **Architecture**: Modularize into zero-build ES Modules while maintaining a fast, native browser footprint.
3. **Power Features**: Introduce Undo/Redo (50 snapshots), Command Palette (`Ctrl+K`), layer duplicate/reorder/hide/lock, timeline zoom/pan/snap/multi-select, asset vault, and render queue.
4. **Preview Synchronization**: Establish bidirectional `postMessage` synchronization between the timeline playhead and the GSAP runtime in the preview iframe.
5. **Discoverability & Guidance**: Embed inline field documentation, universal hover tooltips, a rotating tips bar, and a first-run interactive walkthrough.
6. **Zero Regression**: Retain 100% of existing functionality while expanding capability.

---

## 2. API Contract & Gaps Analysis

Based on a thorough review of `API_DOCUMENTATION.md` and live validation against the engine on port 4000:

### Supported Endpoints:
- `GET /api/capabilities`: Authoring contract, field guides, valid canvas shapes/scales, presets, and registries.
- `GET /api/scenes/:id`: Load scene by ID.
- `POST /api/scenes`: Create or update scene (validates against SceneSpec v1 schema).
- `POST /api/scenes/:id/keyframes`: Render exact frame previews for visual inspection.
- `GET /api/scenes/:id/events`: Server-Sent Events stream for external scene change notifications.
- `POST /api/renders`: Enqueue background draft or production render.
- `GET /api/renders/:id`: Poll render progress and download URL.
- `GET /api/renders/:id/file`: Stream finished MP4.
- `POST /api/assets?filename=<name>`: Upload binary asset to vault (`vault:<name>`).
- `GET /api/assets/vault/:name`: Fetch stored vault asset.
- `GET /api/assets/vault/_sfx/:name`: Fetch standard SFX audio file.

### Gaps & Workarounds:
1. **Asset Vault Listing Gap**:
   - *Problem*: The engine provides `GET /api/assets/vault/:name` to serve assets and `POST /api/assets` to upload, but no `GET /api/assets` endpoint to list vault files.
   - *Workaround*: MotionForge Studio maintains a local asset registry in `localStorage` (`motionforge_asset_vault`), storing uploaded asset names, types, sizes, and timestamps, seeded with standard demo assets and assets declared in loaded scenes.
2. **Scene Deletion Gap**:
   - *Problem*: There is no `DELETE /api/scenes/:id` endpoint in core-engine.
   - *Workaround*: UI allows closing scene tabs and removing scenes from local recents/tabs with clear user prompts.
3. **Layer `hidden` Attribute**:
   - *Problem*: `hidden` is not part of the standard `SceneSpecInput` strict schema and may cause validation warnings if unhandled.
   - *Workaround*: In the UI, hiding a layer sets `_hidden: true` in state (or client-side preview filter), dims the layer bar on the timeline, disables inspector edits, and is documented clearly as a client-side authoring toggle.

---

## 3. Design System: Cinematic Amber

### Color Tokens
```css
:root {
  --bg-0: #0a0a0f;
  --bg-1: #101017;
  --bg-2: #18181f;
  --bg-3: #22222c;
  --bg-4: #2c2c38;

  --border: rgba(255, 255, 255, 0.06);
  --border-strong: rgba(255, 255, 255, 0.12);
  --border-focus: #f59e0b;

  --text-1: #f1f5f9;
  --text-2: #a1a1aa;
  --text-3: #52525b;

  --primary: #f59e0b;
  --primary-hover: #fbbf24;
  --primary-dim: rgba(245, 158, 11, 0.12);

  --secondary: #14b8a6;
  --secondary-hover: #2dd4bf;
  --secondary-dim: rgba(20, 184, 166, 0.12);

  --accent: #f43f5e;
  --accent-hover: #fb7185;
  --accent-dim: rgba(244, 63, 94, 0.12);

  --success: #22c55e;
  --warning: #f59e0b;
  --danger: #ef4444;
  --info: #3b82f6;

  --radius-sm: 4px;
  --radius: 6px;
  --radius-lg: 10px;
  --radius-xl: 14px;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.6);
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  --duration: 140ms;
}
```

### Layer Type Colors
```javascript
const LAYER_COLORS = {
  background: '#52525b',
  imageLogo: '#f59e0b',
  kineticText: '#f43f5e',
  card: '#14b8a6',
  lottie: '#22c55e',
  foregroundFX: '#3b82f6',
};
```

---

## 4. Module Decomposition

The monolithic `app.js` (1218 lines) is decomposed into ES modules:
- `app.js` — App entry point & initialization coordinator
- `js/api.js` — Core Engine REST & SSE client
- `js/state.js` — Centralized reactive store + 50-step undo/redo stack
- `js/ui/toast.js` — Stacked actionable notifications & progress toasts
- `js/ui/modal.js` — Modal container with focus trap and backdrop blur
- `js/ui/tooltip.js` — Native-feel 400ms hover tooltips
- `js/ui/command-palette.js` — Ctrl+K searchable launcher
- `js/ui/onboarding.js` — 5-step guided tour
- `js/ui/shortcuts.js` — Keyboard shortcut registry and `?` modal
- `js/panels/layers.js` — Layer list, reorder, duplicate, lock, hide, rename
- `js/panels/inspector.js` — Collapsible grouped fields with live validation
- `js/panels/capabilities.js` — Capabilities browser
- `js/panels/timeline.js` — Canvas timeline with zoom, pan, snap, context menu
- `js/panels/preview.js` — Preview iframe controller & postMessage sync
- `js/panels/assets.js` — Asset vault panel & drag-drop uploader
- `js/panels/render-queue.js` — Multi-job render queue & history
- `js/panels/templates.js` — Scene templates generator
- `js/util/dom.js` — DOM helpers (`$`, `$$`, `h`, `debounce`)
- `js/util/time.js` — Time formatting & parsing
- `js/util/validate.js` — Schema pre-validators matching `API_DOCUMENTATION.md`

---

## 5. Preview Messaging Protocol

### UI to Runtime (Iframe)
- `{ type: 'motionforge:seek', atMs: number }`: Scrub to exact millisecond.
- `{ type: 'motionforge:play' }`: Start playback.
- `{ type: 'motionforge:pause' }`: Pause playback.
- `{ type: 'motionforge:setScene', scene: SceneSpec }`: Push in-memory scene update.

### Runtime (Iframe) to UI
- `{ type: 'motionforge:ready', fps: number, durationMs: number }`: Runtime ready signal.
- `{ type: 'motionforge:frame', atMs: number }`: Playback timecode update.

---

## 6. Implementation Checklist & Quality Gates

- [x] Phase 1a: Visual overhaul (Cinematic Amber, typography hierarchy, 0 violet remnants) — *Verified across styles.css and UI elements*
- [x] Phase 1b: Modular ES Module decomposition (`app.js`, `js/api.js`, `js/state.js`, `js/panels/*`, `js/ui/*`, `js/util/*`) — *Zero build step*
- [x] Phase 1c: Centralized State store + 50-step undo/redo stack (`Ctrl+Z`, `Ctrl+Shift+Z`) — *With toast notifications*
- [x] Phase 1d: Onboarding tour, tooltips, rotating tips bar, and shortcuts modal (`?`) — *All functional*
- [x] Phase 1e: Command palette (`Ctrl+K` / `⌘K`) with fuzzy search across layers, scenes, and actions — *Verified*
- [x] Phase 1f: Layer operations (duplicate, lock, hide, drag-reorder, inline rename, search filter) — *Complete*
- [x] Phase 1g: Inspector overhaul (collapsible groups, inline validation, color picker, motion presets) — *Complete*
- [x] Phase 1h: Timeline upgrades (zoom, pan, ruler scrub, snap, duration edge drag, multi-select, context menu) — *60fps canvas*
- [x] Phase 1i: Preview seek/play/pause sync via postMessage + `scene-runtime` listener — *Verified with GSAP engine*
- [x] Phase 1j: Auto-save status indicator, stacking actionable toasts, loading skeletons, rich empty states — *Integrated*
- [x] Phase 1 Quality Gate: Multi-viewport visual verification (1440x900, 1920x1080, 2560x1440) — *19/19 Playwright tests passed*
- [x] Phase 2: Multi-scene tabs, Asset vault, SFX cues, Camera editor, Transitions, Render queue, Templates, Export/Import, Recents, Fullscreen mode — *Shipped*
- [x] Phase 3: Draggable panel resizing dividers, Performance HUD (`Ctrl+Shift+P`), Settings modal, Full documentation suite (`04_UI_KEYBOARD_SHORTCUTS.md`, `05_UI_UX_GUIDE.md`, `README.md`) — *Shipped*

