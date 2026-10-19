# DA-006 Execution Plan: Fix Undo History Snapshot Timing

**Document Version:** 1.0.0  
**Date:** 2026-10-19  
**Status:** Approved for Implementation  
**Item ID:** `DA-006`  
**Severity:** P0  
**Directly Solves:** User Complaints #3 and #10 ("Undo restores layer to pre-drag state instead of mid-drag ephemeral steps or broken post-drag state").

---

## 1. Problem Diagnosis

### Root Causes
1. **Spurious Snapshots on Simple Clicks in CanvasOverlay:**
   - In `packages/studio/src/components/CanvasOverlay.tsx` (lines 322, 363), `store.pushHistory()` is called immediately on `pointerdown` as soon as a layer or transform handle is touched.
   - If the user merely clicks a layer to select it without moving, a full snapshot is pushed to `undoStack`, and on `pointerup`, `store.executeSave()` is dispatched to the backend engine.
   - Result: Selecting 3 layers pushes 3 duplicate entries to `undoStack`. When the user attempts to undo subsequent edits, pressing `Ctrl+Z` repeatedly pops identical states, making undo appear non-responsive or broken.

2. **Inverted Snapshot Timing in Timeline Canvas:**
   - In `packages/studio/src/components/Timeline.tsx` (lines 780–786), `store.pushHistory(\`Timeline edit: \${dragMode}\`)` is called on `onMouseUp`.
   - By the time `onMouseUp` fires, `onMouseMove` has already mutated `state.scene` (clip `at` and `duration`).
   - Consequently, `store.pushHistory` records the **POST-DRAG** state on the undo stack!
   - When the user presses `Ctrl+Z`, `store.undo()` restores the top of `undoStack`—which is identical to the post-drag state. Timeline dragging and trimming are completely irreversible.

3. **Non-Reactive Undo/Redo UI Buttons:**
   - In `packages/studio/src/store.ts`, `undoStack` and `redoStack` are plain JavaScript arrays.
   - The `#btn-undo` and `#btn-redo` buttons in `Header.tsx` use `disabled={!store.canUndo()}`, but Solid.js cannot track mutations to plain arrays. The buttons do not reactively enable or disable when actions are pushed or popped.

---

## 2. Proposed Architecture & Timing Flow

### Target State Machine

```
Interaction Start (pointerdown / mousedown):
  - Record dragStart coordinates.
  - Set hasDragged = false.
  - Prepare pendingHistoryDescription (e.g. "Move layer: Title").
  - Do NOT push history yet.

Interaction Active (pointermove / mousemove):
  - If Math.hypot(dx, dy) >= 2px (drag threshold exceeded):
      If !hasDragged:
        hasDragged = true
        store.pushHistory(pendingHistoryDescription) // CAPTURES PRE-DRAG STATE!
      Apply live updates to store.setState and iframe ephemeral transform.

Interaction Release (pointerup / mouseup):
  - If hasDragged:
      store.setState('dirty', true)
      store.syncDesktopDirty()
      store.executeSave()
  - If !hasDragged:
      Pure selection / click.
      No history pushed.
      No save dispatched.
```

---

## 3. Implementation Details

### 3.1 `packages/studio/src/store.ts`
- Add reactive `historyCount` signal:
  ```typescript
  const [historyCount, setHistoryCount] = createSignal({ undo: 0, redo: 0 });
  ```
- In `pushHistory`, `undo`, `redo`, `setScene`, update `setHistoryCount({ undo: undoStack.length, redo: redoStack.length })`.
- Update `canUndo()` and `canRedo()` to read `historyCount().undo > 0` and `historyCount().redo > 0`.
- In `undo()` and `redo()`, dispatch a toast notification indicating the action undone/redone.

### 3.2 `packages/studio/src/components/CanvasOverlay.tsx`
- Introduce `let hasDragged = false;` and `let pendingHistoryDescription: string | null = null;`.
- Remove premature `store.pushHistory()` from `handlePointerDown`.
- In `handlePointerDown`, set `hasDragged = false` and assign `pendingHistoryDescription`.
- In `handlePointerMove`, when `mode === 'move' | 'resize' | 'rotate'`, check if displacement exceeds threshold (`Math.hypot(dx, dy) >= 2` or `Math.abs(dx) >= 2 || Math.abs(dy) >= 2`).
- On first exceed:
  ```typescript
  if (!hasDragged) {
    hasDragged = true;
    store.pushHistory(pendingHistoryDescription || 'Transform layer');
  }
  ```
- In `handlePointerUp`, guard `executeSave()` behind `if (hasDragged)`. Reset `hasDragged = false` and `pendingHistoryDescription = null`.

### 3.3 `packages/studio/src/components/Timeline.tsx`
- Introduce `let hasDragged = false;`.
- In `onMouseDown`, initialize `hasDragged = false`.
- In `onMouseMove`, when `dragMode && (dragLayer || dragKeyframeInfo)`:
  ```typescript
  if (Math.abs(dx) >= 2) {
    if (!hasDragged) {
      hasDragged = true;
      store.pushHistory(`Timeline edit: ${dragMode}`);
    }
  }
  ```
- In `onMouseUp`, guard `executeSave()` behind `if (hasDragged)`. Remove the post-drag `store.pushHistory()` call. Reset `hasDragged = false`.

---

## 4. Acceptance Criteria & Test Verification

### Automated Test: `scripts/test-undo-history.cjs`
1. Launch Electron desktop shell with Playwright.
2. Seed test scene with layer at `{ xPct: 50, yPct: 50 }` and clip at `at: 1000`.
3. Assert `#btn-undo` is initially `disabled`.
4. Click layer on canvas without dragging:
   - Assert `#btn-undo` remains `disabled`.
   - Assert undo stack length is 0.
5. Drag layer on canvas to `{ xPct: 75, yPct: 25 }`:
   - Assert `#btn-undo` becomes enabled (`disabled: false`).
   - Assert layer updated to new position.
6. Click `#btn-undo` (or send `Ctrl+Z`):
   - Assert layer position immediately reverts to exact `{ xPct: 50, yPct: 50 }`.
   - Assert `#btn-redo` becomes enabled.
7. Click `#btn-redo` (or send `Ctrl+Shift+Z`):
   - Assert layer position restores to `{ xPct: 75, yPct: 25 }`.
8. Drag timeline clip from `at: 1000` to `at: 3000`:
   - Assert clip moved to `at: 3000`.
9. Send `Ctrl+Z`:
   - Assert clip immediately reverts to `at: 1000`.
10. Capture screenshot `screenshots/undo-history.png`.

---

## 5. Rollback Plan
- All changes are confined to Studio UI components and store.
- If regressions occur, revert via `git revert HEAD`.
