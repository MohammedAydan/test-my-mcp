# Desktop App Remediation Plan

**Document Version:** 1.0.0  
**Date:** 2026-10-19  
**Status:** Actionable Proposal (No code changes implemented)

---

## 1. Current Desktop State (Verified)

- **Electron Version:** 31.7.7 (configured in `packages/desktop/package.json` and `electron-builder.yml`).
- **Security Profile:** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- **Packaged Executables:**
  - Standalone unpacked directory at `packages/desktop/dist/win-unpacked/MotionForge.exe` (180MB binary). Verified runnable via `scripts/test-packaged-exe.cjs`.
- **Packaging Pipeline:** Built via `electron-builder --dir`.
- **Known Launch Issues:**
  - When the app is launched fresh without an existing project, `#btn-demo` only appears if the tour is dismissed and `localStorage` is empty. If a corrupt project was previously loaded, the app can mount into a blank canvas without recovery prompts.

---

## 2. Issues (Severity-Ranked)

### Issue DA-001: Canvas Direct Manipulation Disconnected from Preview & Engine
- **ID:** DA-001
- **Severity:** P0 (Core authoring workflow broken)
- **Title:** Canvas Drag Does Not Update Video Layer or Commit Backend Saves
- **Symptom:** Dragging resize/position handles updates the SVG bounding box, but the actual layer in the video preview remains stationary. On pointerup, no save request is sent to the backend engine. Undo (`Ctrl+Z`) restores the post-drag state rather than pre-drag state.
- **Root cause:** `packages/studio/src/components/CanvasOverlay.tsx:458-470, 536-542`.
- **Proposed fix:**
  1. On `pointerdown`, save pre-drag snapshot to undo stack immediately (`store.pushHistory()`).
  2. On `pointermove`, send lightweight postMessage `{ type: 'ephemeralTransform', layerId, xPct, yPct, rotation }` to the preview iframe so GSAP transforms the DOM node in real-time.
  3. On `pointerup`, trigger debounced `executeSave()` to commit changes to the backend engine atomically.
- **Test to add:** Playwright test asserting that dragging an element by 100px shifts both the SVG wireframe AND the iframe DOM node by 100px, and that `Ctrl+Z` reverts the layer to its exact starting coordinates.
- **Blocks:** User Complaints #3, #9, #10.

### Issue DA-002: Timeline Canvas Lacks Vertical Scrolling & Clipping Virtualization
- **ID:** DA-002
- **Severity:** P0 (Blocks scenes with >3 layers)
- **Title:** Timeline Track Canvas Cannot Be Scrolled Vertically
- **Symptom:** In scenes with 4 or more layers, or when tracks are expanded to show keyframe subtracks, tracks below ~146px are rendered outside the canvas clipping rect and cannot be scrolled into view.
- **Root cause:** `packages/studio/src/components/Timeline.tsx:107-136, 139-152`. `computeTrackLayout()` calculates cumulative Y without subtracting a vertical scroll offset (`scrollY`). Canvas does not listen to wheel events on the Y-axis.
- **Proposed fix:**
  1. Add `timelineScrollY` signal to `store.ts`.
  2. In `Timeline.tsx:draw()`, wrap track rendering with `ctx.save(); ctx.translate(0, -state.timelineScrollY); ... ctx.restore();`.
  3. Keep the Time Ruler (0..28px) fixed at the top regardless of `timelineScrollY`.
  4. Bind vertical wheel scroll on the timeline canvas to adjust `timelineScrollY` bounded by `[0, totalHeight - visibleHeight]`.
  5. Synchronize `timelineScrollY` with `tracksScrollRef.scrollTop` of the left track headers panel.
- **Test to add:** Playwright test adding 10 layers, scrolling down by 200px, and verifying that layer 10's bar is visible and clickable on the canvas.
- **Blocks:** User Complaint #5.

### Issue DA-003: Fixed Panel Dimensions and Missing Resizable Splitters
- **ID:** DA-003
- **Severity:** P1 (Poor workspace flexibility)
- **Title:** No Drag-to-Resize Splitters Between Studio Panels
- **Symptom:** Users cannot enlarge the timeline, preview, or inspector. Dimensions are locked to fixed pixel values in `styles.css`.
- **Root cause:** `packages/studio/src/styles.css:136, 377`.
- **Proposed fix:**
  1. Replace fixed CSS grid template rules with dynamic layout state: `leftPanelWidth` (default 280px), `rightPanelWidth` (default 340px), `timelineHeight` (default 260px).
  2. Insert 4px splitter divider components (`SplitterHorizontal`, `SplitterVertical`) between panels.
  3. Add pointer drag handlers with minimum bounds (Left: 200–500px, Right: 260–450px, Timeline: 160–600px).
  4. Persist customized layout dimensions to `localStorage.setItem('motionforge_layout', ...)`.
- **Test to add:** Playwright test dragging the timeline top border upward by 100px and verifying the timeline container height increases by 100px.
- **Blocks:** User Complaint #6.

### Issue DA-004: Missing Drag-and-Drop Ingestion for Media & Layers
- **ID:** DA-004
- **Severity:** P0 (Modern NLE workflow missing)
- **Title:** Canvas and Timeline Reject Drag-and-Drop Events
- **Symptom:** Dragging images, videos, audio, or Lottie files from the Assets panel or OS Explorer onto the canvas or timeline shows the "not-allowed" cursor.
- **Root cause:** Absence of `ondragover` / `ondrop` handlers in `Preview.tsx`, `CanvasOverlay.tsx`, and `Timeline.tsx`.
- **Proposed fix:**
  1. Add `ondragover={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}` to CanvasOverlay and Timeline.
  2. On CanvasOverlay `ondrop`: read dragged file or asset ID, calculate drop coordinates in `{ xPct, yPct }` via `screenToCanvas()`, and add layer centered at cursor.
  3. On Timeline `ondrop`: calculate drop timecode via `xToTime()` and target track row via `yToTrack()`, and insert layer clip at that timestamp.
- **Test to add:** Playwright test dragging a mock asset onto the canvas at (50%, 50%) and verifying a new layer is instantiated with matching `{ xPct: 50, yPct: 50 }`.
- **Blocks:** User Complaint #7.

---

## 3. Direct Manipulation Architecture Redesign

### Current vs Target Architecture

```
CURRENT (Broken):
User Drag → CanvasOverlay SVG moves local rect
          → Preview Iframe stays FROZEN (no IPC/postMessage)
          → Backend Engine NEVER notified
          → Undo pushed on pointerup with POST-DRAG state (cannot undo!)

TARGET (Fixed):
User Drag → pointerdown: store.pushHistory() (Pre-drag snapshot saved)
          → pointermove: postMessage({ type: 'ephemeralTransform', ... })
                         Preview Iframe receives message → GSAP quickSetter moves layer at 60fps
          → pointerup: debounced executeSave() commits to engine
                       Undo stack properly restores pre-drag coordinates
```

### Coordinate Translation Strategy
- The design canvas operates at logical **1920×1080** (or 1080×1920 for vertical).
- The `TransformBridge` converts between Container Screen Pixels and Design Canvas Space using:
  $$\text{relX} = \frac{\text{screenX} - \text{centerX}}{\text{totalScale}}$$
  $$\text{canvasX} = \frac{\text{cW}}{2} + \text{relX}$$
- Snapping is evaluated in Design Canvas Space with a 5px threshold scaled by `1 / totalScale` so snapping feels tactile regardless of viewport zoom level.

---

## 4. Panel Management & Layout System

```
┌────────────────────────────────────────────────────────────────────────┐
│ Titlebar: Tabs · Transport · Window Controls                           │
├──────────────┬──────────────────────────────────────────┬──────────────┤
│ Project Bin  │ Canvas Viewport (Fit / 100% / Overlays)  │ Inspector    │
│ & Layers     │                                          │ (Accordion)  │
│ [280px]      │                                          │ [340px]      │
│              │                                          │              │
│ ◄||► Splitter│                                          │ ◄||► Splitter│
├──────────────┴──────────────────────────────────────────┴──────────────┤
│ ▲||▼ Horizontal Splitter                                               │
├────────────────────────────────────────────────────────────────────────┤
│ Multi-Track NLE Timeline (Virtualized Canvas + Vertical Scroll)        │
│ [260px resizable]                                                      │
├────────────────────────────────────────────────────────────────────────┤
│ Status Bar                                                             │
└────────────────────────────────────────────────────────────────────────┘
```

- **Persistence:** Layout dimensions saved to `localStorage` under `motionforge_workspace_v1`.
- **Reset to Default:** Action in View menu and Command Palette (`View: Reset Default Workspace`).
- **Panel Collapse:** Double-clicking splitters collapses/restores adjacent panel.

---

## 5. First-Run Experience & Onboarding

1. **Clean First-Run Boot:** When no project exists, open a welcoming "Get Started" modal offering:
   - Create Blank Scene (16:9, 9:16, 1:1)
   - Open Interactive Tutorial Scene (seeded with interactive tasks: "Drag this text", "Split this clip", "Add a keyframe")
   - Open Recent Project (.mfproj)
2. **Contextual Tooltips:** Replace generic tooltip titles with descriptive action shortcuts (e.g., `Razor Tool (Ctrl+K) — Split active clip at playhead`).
