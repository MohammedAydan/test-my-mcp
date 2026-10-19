# DA-001 Execution Plan: Canvas Direct Manipulation Disconnected from Preview & Engine

**Document Version:** 1.0.0  
**Date:** 2026-10-19  
**Status:** Approved for Implementation

---

## 1. Problem Statement

Dragging layers and transform handles in MotionForge Studio currently exhibits three critical failures:
1. **Frozen Preview:** Dragging resize/position handles updates the SVG wireframe in `CanvasOverlay`, but the underlying preview iframe receives no messages; its DOM remains stationary until a manual reload.
2. **Broken Undo History:** `store.pushHistory()` is invoked on `pointerup` with the *post-drag* state rather than on `pointerdown` with the *pre-drag* state. Furthermore, `state.layerBounds` retains the dragged coordinates, causing `getLayerBox()` to keep showing the moved position even after an undo.
3. **No Engine Save on Pointer Up:** Releasing the drag does not commit the new coordinates to `core-engine`. If the app or preview refreshes, changes are lost.

---

## 2. Architecture & Remediation Strategy

```
User Pointer Down → store.pushHistory('Move/Transform layer: ...')
                    Saves pre-drag scene snapshot to undo stack

User Pointer Move → CanvasOverlay updates store position & SVG wireframe
                  → postMessage({ type: 'ephemeralTransform', layerId, xPct, yPct, ... })
                    to preview iframe
                  → scene-runtime updates layer content element DOM style (left, top, transform)
                    at 60fps with zero layout thrashing

User Pointer Up   → store.executeSave() sends updated scene to core-engine via API
                  → core-engine commits to disk/memory and broadcasts 'updated' SSE
                  → saveStatus set to 'saved'

User Press Ctrl+Z → store.undo() pops pre-drag scene snapshot
                  → state.layerBounds restored to pre-drag coordinates
                  → store.executeSave() commits reverted scene
                  → SVG wireframe and iframe DOM node both restore exact initial coordinates
```

---

## 3. Files Touched & Exact Modifications

### 1. `packages/scene-runtime/src/index.ts`
- In `window.addEventListener("message", ...)`:
  - Add handler for `ephemeralTransform` / `motionforge:ephemeralTransform`.
  - Locate `.mf-layer[data-layer-id="${layerId}"]` and its content element inside `.mf-exit`.
  - Update `contentEl.style.left`, `contentEl.style.top`, `contentEl.style.transform`, `contentEl.style.width`, and `contentEl.style.height`.

### 2. `packages/studio/src/store.ts`
- Import `api` from `./api.js`.
- Add `executeSave()` to `store`.
- In `undo()` and `redo()`, restore snapshot `layerBounds` to preserve pre-drag coordinates, and invoke `this.executeSave()`.

### 3. `packages/studio/src/components/CanvasOverlay.tsx`
- In `handlePointerDown`:
  - When initiating `rotate` or `resize`: call `store.pushHistory(...)` immediately.
  - When initiating `move`: call `store.pushHistory(...)` immediately.
- In `handlePointerMove`:
  - Dispatch `props.iframeRef()?.contentWindow?.postMessage({ type: 'ephemeralTransform', ... }, '*')` on `move`, `resize`, and `rotate`.
- In `handlePointerUp`:
  - Remove `store.pushHistory()` (pre-drag snapshot was already saved).
  - Trigger `store.executeSave()`.

### 4. `packages/studio/src/App.tsx`
- Delegate local `executeSave` to `store.executeSave()`.

---

## 4. Acceptance Criteria & Verification

1. **E2E Playwright Test (`scripts/test-canvas-drag.cjs`):**
   - Launch Electron with a scene.
   - Record initial bounding rects of SVG wireframe and iframe DOM node.
   - Pointer drag layer by 100px.
   - Assert SVG wireframe shifted by ~100px AND iframe DOM node shifted by ~100px.
   - Release mouse: assert `store.state.saveStatus === 'saved'`.
   - Trigger Undo (`Ctrl+Z`): assert SVG wireframe AND iframe DOM node both revert to initial coordinates.
2. **Visual Verification:**
   - Save `screenshots/canvas-drag-move.png` and `screenshots/canvas-drag-undo.png`.
3. **Monorepo Tests:**
   - All 338 backend unit tests pass.
   - Studio and desktop packages build with 0 TypeScript/compilation errors.
