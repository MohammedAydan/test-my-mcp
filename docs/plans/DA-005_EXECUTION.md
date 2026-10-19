# DA-005 Execution Plan: Multi-Clip Track Rows (trackIndex) & Boundary Collision Prevention

**Document Version:** 1.0.0  
**Date:** 2026-10-19  
**Status:** Approved for Implementation

---

## 1. Problem Statement

MotionForge currently displays layers in a strict 1:1 mapping where each layer unconditionally receives its own vertical timeline row:
- A scene with two sequential 3-second clips (e.g. 0–3s and 3–6s) occupies two separate rows, wasting vertical space and violating standard NLE conventions.
- When dragging or trimming clips, there is no boundary collision enforcement against neighboring clips on the same track, which can produce invalid overlapping scenes rejected by `core-engine` validation.

---

## 2. Architecture & Design Specification

### 2.1 Track Lane Grouping (`getTrackLanes`)
Group scene layers into logical Track Lanes:
```ts
export interface TrackLaneInfo {
  index: number;
  name: string;
  kind: 'video' | 'audio' | 'overlay' | 'general';
  layers: StudioLayer[];
  y: number;
  h: number;
}
```
1. **Explicit `trackIndex`:** If layers specify `trackIndex` (or alias `trackLane`), group layers with matching `trackIndex` into Track `trackIndex`.
2. **Top-Level `scene.trackLanes`:** If declared, use the defined `name`, `kind`, `locked`, and `muted` properties. Otherwise, generate default name `"Track " + (index + 1)`.
3. **Backward Compatibility for Legacy Scenes:** Any layer with `trackIndex === undefined` is assigned to a unique auto-allocated track index, ensuring existing 1-clip-per-layer scenes render identically with zero regression.
4. **Ordering:** Tracks are ordered ascending by `track.index`; layers within each track are ordered chronologically by `layer.at`.

### 2.2 Layout Calculation (`computeTrackLayout`)
- Compute `y` position per **Track** rather than per layer.
- All layers residing on the same track share that track's vertical `y` and `h`.
- Total canvas height is derived from cumulative track heights rather than `layers.length`.

### 2.3 Canvas Rendering & Hit Testing
- **Track Lanes:** Render continuous horizontal lane background `(0, track.y, w, track.h)`.
- **Clip Rendering:** Each layer clip is drawn at `timeToX(layer.at)` to `timeToX(layer.at + duration)` on its track's `y` coordinate.
- **Hit Testing:** When clicking at `(x, y)`:
  - Match track row: `y >= track.y && y <= track.y + track.h`.
  - Match clip in time: `x >= timeToX(layer.at) && x <= timeToX(layer.at + duration)`.
  - Accurately picks the specific clip clicked on the shared track.

### 2.4 Real-Time Boundary Collision Enforcement
When dragging (`mode === 'move'`) or trimming (`mode === 'trim-left' | 'trim-right'`):
- Identify neighboring clips on the same track:
  - `prevClip`: clip immediately preceding the active clip (`at + duration <= dragInitialAt`).
  - `nextClip`: clip immediately following the active clip (`at >= dragInitialAt + dragInitialDuration`).
- **Move:** Clamp `newAt` within `[prevClip ? prevClip.at + prevClip.duration : 0, nextClip ? nextClip.at - duration : totalDuration - duration]`.
- **Trim Left:** Clamp `newAt` to `[prevClip ? prevClip.at + prevClip.duration : 0, dragInitialAt + duration - 200]`.
- **Trim Right:** Clamp `duration` such that `layer.at + newDur <= (nextClip ? nextClip.at : totalDuration)`.

### 2.5 Track Headers Sidebar
- Render track lanes on the left sidebar:
  - Track badge: `T${track.index + 1}`
  - Track name: `track.name`
  - Clip count indicator: `N clips`
  - Maintains pixel-perfect vertical synchronization with canvas tracks.

---

## 3. Files Touched

1. `packages/studio/src/components/Timeline.tsx`
   - Add `getTrackLanes()` grouping logic.
   - Refactor `computeTrackLayout()` to lay out tracks and assign clips to track rows.
   - Update canvas drawing to render track backgrounds and side-by-side clips.
   - Add boundary collision clamping in `onMouseMove`.
   - Update left sidebar track headers to render track lanes.
   - Add `store.executeSave()` on `onMouseUp`.

---

## 4. Acceptance Criteria & Verification

1. **E2E Playwright Test (`scripts/test-track-lanes-ui.cjs`):**
   - Seed a test scene with 2 non-overlapping clips sharing `trackIndex: 0` (Clip A: 0–3s, Clip B: 3–6s), and 1 clip on `trackIndex: 1` (0–4s).
   - Launch Electron desktop shell.
   - Assert only 2 track rows exist on the canvas.
   - Assert Clip A and Clip B share the exact same `y` coordinate on Track 0.
   - Drag Clip A rightward: assert it stops at 3s and does not collide with Clip B.
   - Trim Clip A left edge rightward: assert duration updates smoothly.
   - Drag Clip B rightward by 1s: assert Clip B moves to 4s.
   - Assert save status is `'saved'` after pointer up.
2. **Visual Verification:**
   - Save `screenshots/track-lanes-multiclip.png`.
3. **Monorepo Suite:**
   - `npm test` passes all 338 tests.
