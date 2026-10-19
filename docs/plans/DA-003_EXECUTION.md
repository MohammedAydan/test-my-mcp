# DA-003 Execution Plan: Drag-to-Resize Panel Splitters

**Document Version:** 1.0.0  
**Date:** 2026-10-19  
**Status:** Approved for Implementation

---

## 1. Problem Statement

MotionForge Studio currently has rigid, non-resizable panel dimensions defined as static CSS grid rules in `packages/studio/src/styles.css`:
- Left Panel (Layers / Scene / Assets) is locked to `280px`.
- Center Preview is forced into `1fr`.
- Right Panel (Inspector / Capabilities) is locked to `340px`.
- Timeline is locked to `210px` height.

Users working on complex multi-track timelines, large 4K compositions, or detailed inspector properties cannot resize panels to optimize their workspace, violating User Complaint #6 and desktop NLE conventions.

---

## 2. Architecture & Design Specification

### 2.1 Workspace Layout State
In `packages/studio/src/store.ts`, add workspace layout properties to `StudioState`:
```ts
export interface WorkspaceLayout {
  leftPanelWidth: number;       // default 280px (min: 180px, max: 600px)
  rightPanelWidth: number;      // default 340px (min: 240px, max: 650px)
  timelineHeight: number;       // default 240px (min: 140px, max: 600px)
  leftPanelCollapsed: boolean;  // default false
  rightPanelCollapsed: boolean; // default false
  timelineCollapsed: boolean;   // default false
}
```

### 2.2 Persistence
- Persist to `localStorage.getItem('motionforge_workspace_v1')` on resize pointer up and collapse toggle.
- Provide `store.resetWorkspaceLayout()` to revert to default proportions.
- Expose `View: Reset Workspace Layout` in `CommandPalette.tsx`.

### 2.3 Splitter Components & Interaction
1. **Vertical Splitter (`SplitterVertical`):**
   - 4px visible line with 10px transparent hitbox (`::after`).
   - Positioned between Left Panel & Preview (`#splitter-left`) and between Preview & Inspector (`#splitter-right`).
   - Pointer events with `setPointerCapture` on pointer down to guarantee smooth tracking even when cursor leaves splitter hitbox.
   - Double-click toggles collapse/restore of adjacent panel.
2. **Horizontal Splitter (`SplitterHorizontal`):**
   - 4px visible line with 10px transparent hitbox.
   - Positioned between Main Area & Timeline (`#splitter-timeline`).
   - Pointer drag adjusts `timelineHeight` relative to window bottom.
   - Double-click toggles timeline collapse/restore.

### 2.4 CSS Grid Integration
Update `.app` and `.main` layout templates in `packages/studio/src/styles.css` to respect dynamic dimensions:
- `.app`: `grid-template-rows: 42px auto 1fr 4px var(--timeline-height) 26px;`
- `.main`: `grid-template-columns: var(--left-panel-width) 4px 1fr 4px var(--right-panel-width);`

---

## 3. Files Touched

1. `packages/studio/src/store.ts`
   - Add `workspace` state with defaults and localStorage loader.
   - Add mutators: `setLeftPanelWidth`, `setRightPanelWidth`, `setTimelineHeight`, `toggleLeftPanelCollapsed`, `toggleRightPanelCollapsed`, `toggleTimelineCollapsed`, `resetWorkspaceLayout`.
2. `packages/studio/src/styles.css`
   - Define `.splitter-vertical`, `.splitter-horizontal`, and active dragging styles.
   - Update `.app` and `.main` grid template definitions to use CSS variables.
3. `packages/studio/src/components/Splitter.tsx` (New component)
   - Resusable vertical & horizontal splitter with pointer capture, clamp bounds, and double-click collapse.
4. `packages/studio/src/App.tsx`
   - Mount splitters into `.main` and between `.main` and `<Timeline />`.
   - Bind CSS variables dynamically to `.app` and `.main`.
5. `packages/studio/src/components/CommandPalette.tsx`
   - Add "View: Reset Default Workspace" command.

---

## 4. Acceptance Criteria & Verification

1. **E2E Playwright Test (`scripts/test-panel-splitters.cjs`):**
   - Launch Electron desktop shell.
   - Capture initial layout bounding boxes.
   - Drag `#splitter-timeline` upward by 80px: assert timeline height increases by ~80px.
   - Drag `#splitter-left` rightward by 60px: assert left panel width increases by ~60px.
   - Drag `#splitter-right` leftward by 50px: assert right panel width increases by ~50px.
   - Double-click `#splitter-left`: assert left panel collapses to 0px.
   - Double-click `#splitter-left`: assert left panel restores to previous width.
   - Reset workspace: assert layout dimensions return to defaults (280px, 340px, 240px).
2. **Screenshots:**
   - `screenshots/panel-splitters-before.png`: Default initial layout.
   - `screenshots/panel-splitters-after.png`: Resized timeline and panels.
3. **Monorepo Suite:**
   - `npm test` passes 338/338 tests.
