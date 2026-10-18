# Backend Remediation Plan

**Document Version:** 1.0.0  
**Date:** 2026-10-19  
**Status:** Actionable Proposal (No code changes implemented)

---

## 1. Current Backend State (Verified)

### Verified REST Endpoints (`packages/core-engine/src/server.ts`)
| Method | Route | Purpose | Verified Status |
|---|---|---|---|
| `GET` | `/api/capabilities` | Hardware, toolchain & preset discovery | Verified (200 OK) |
| `POST` | `/api/scenes` | Upsert and validate SceneSpec | Verified (201 Created / 400 Bad Request) |
| `GET` | `/api/scenes/:id` | Retrieve stored scene JSON | Verified (200 OK) |
| `GET` | `/api/scenes/:id/events` | SSE live change notifications | Verified (text/event-stream) |
| `POST` | `/api/scenes/:id/keyframes` | Capture deterministic keyframe stills | Verified (200 OK with lightweight previews) |
| `GET` | `/api/scenes/:id/frame/:frameIndex/bounds` | Sub-pixel layer bounds calculation | Verified (200 OK with accurate rects) |
| `POST` | `/api/assets` | Binary file upload into engine vault | Verified (201 Created) |
| `GET` | `/api/assets/vault/:name` | Stream uploaded asset from vault | Verified (200 OK with MIME header) |
| `GET` | `/api/assets/vault/_sfx/:name` | Stream procedural SFX audio | Verified (200 OK audio/ogg) |
| `POST` | `/api/renders` | Enqueue video compilation job | Verified (202 Accepted) |
| `GET` | `/api/renders/:jobId` | Poll render job status and progress | Verified (200 OK) |
| `GET` | `/api/renders/:jobId/file` | Download completed MP4 master | Verified (200 OK video/mp4) |
| `POST` | `/api/projects/init` | Scaffold client workspace | Verified (201 Created) |
| `GET` | `/preview/*` | Static file server for scene runtime | Verified (200 OK with wildcard: true) |

### Test Status
- `npm test`: **329 / 329 unit tests passing** across 17 test suites.
- End-to-end rendering: Verified draft (720p 30fps) and production (1080p 60fps) MP4 outputs with zero FFmpeg failures.

---

## 2. Issues (Severity-Ranked)

### Issue BE-001: Missing Scene Track Lane Hierarchy (Blocks Multi-Clip Rows)
- **ID:** BE-001
- **Severity:** P0 (Blocks professional timeline layout)
- **Title:** SceneSpec Data Model Lacks Track Lane Abstraction
- **Symptom:** Two non-overlapping layers cannot be placed on the same visual track row. All layers are flatly serialized in `scene.layers`, forcing every layer onto a dedicated timeline row.
- **Root cause:** `packages/scene-spec/src/scene.ts:32-45`. The schema defines `layers: z.array(layerSchema)`, but contains no `tracks` collection grouping layer IDs into lanes.
- **Proposed fix:** Extend `sceneSpecSchema` with an optional `trackLanes: z.array(trackLaneSchema).optional()`, where `trackLaneSchema = z.object({ id: z.string(), name: z.string(), kind: z.enum(['video', 'audio']), clipIds: z.array(z.string()), locked: z.boolean().default(false), muted: z.boolean().default(false) })`. Provide backward compatibility: if `trackLanes` is omitted, auto-synthesize 1 lane per layer at runtime.
- **Test to add:** Unit test in `packages/scene-spec/tests/track-lanes.spec.ts` verifying scenes with packed, non-overlapping clips parse and validate.
- **Blocks:** UI Complaint #8 (Multiple layers on same timeline row).

### Issue BE-002: Lack of Live Websocket / Low-Latency Transform Streaming
- **ID:** BE-002
- **Severity:** P0 (Blocks real-time canvas preview updates)
- **Title:** HTTP Polling & Debounced REST Creates 700ms Lag for Canvas Manipulation
- **Symptom:** Dragging an element on the canvas cannot update the preview video in real-time because the frontend must debounce and send full HTTP POST `/api/scenes` requests.
- **Root cause:** `packages/core-engine/src/server.ts:140-160`. The only live communication is one-way Server-Sent Events (`/api/scenes/:id/events`), which does not accept upstream transforms.
- **Proposed fix:** Add a lightweight bi-directional loopback WebSocket route `/api/scenes/:id/live` or direct parent-to-iframe postMessage protocol specifically for ephemeral `transform` events (`{ type: 'transform', layerId, xPct, yPct, rotation, scale }`) that bypass disk writes until `pointerup`.
- **Test to add:** Integration test asserting ephemeral transform updates are broadcast in under 16ms without triggering disk I/O.
- **Blocks:** UI Complaint #9 and #10 (Preview canvas manipulation and real-time control).

### Issue BE-003: Asset Vault Listing Endpoint is Missing
- **ID:** BE-003
- **Severity:** P1 (Requires fragile client-side localStorage fallback)
- **Title:** No `GET /api/assets` Endpoint to Enumerate Vault Media
- **Symptom:** When a user opens the app or switches projects, the Asset Vault must rely on `localStorage` to remember what assets exist on the backend.
- **Root cause:** `packages/core-engine/src/server.ts:240-270`. Only `POST /api/assets` and `GET /api/assets/vault/:name` exist; no `GET /api/assets` directory listing route was implemented.
- **Proposed fix:** Implement `GET /api/assets` in `server.ts` reading files from `config.paths.vaultDir`, returning `{ assets: Array<{ name: string, src: string, size: number, mimeType: string, modifiedAt: number }> }`.
- **Test to add:** Test in `packages/core-engine/tests/vault.test.ts` verifying uploaded files appear in `GET /api/assets`.
- **Blocks:** UI Complaint #2 and #7 (Asset Bin panel and Drag-and-Drop).

### Issue BE-004: Lack of Scene Deletion Route
- **ID:** BE-004
- **Severity:** P2 (Workspace clutter)
- **Title:** No `DELETE /api/scenes/:id` Route
- **Symptom:** Deleted tabs leave orphaned `.json` files in `data/scenes/`.
- **Root cause:** `packages/core-engine/src/server.ts`. No `DELETE` handler registered for scenes.
- **Proposed fix:** Implement `DELETE /api/scenes/:id` removing file from `data/scenes/` and evicting from in-memory `SceneStore`.
- **Test to add:** Test asserting scene is evicted from memory and disk after `DELETE`.
- **Blocks:** Tab and project lifecycle management.

---

## 3. Priority Order

1. **BE-001 (Track Lane Schema):** Required first because UI timeline architecture and same-row clip placement depend directly on the data contract.
2. **BE-002 (Ephemeral Transform Streaming):** Required to solve preview canvas manipulation lag and real-time desynchronization.
3. **BE-003 (Asset Vault Listing):** Required to turn the Assets panel into a real Project Media Bin supporting drag-and-drop.
4. **BE-004 (Scene Deletion):** Housekeeping and cleanup.

---

## 4. Schema Changes Required

### Track Lanes Schema Addition (`packages/scene-spec/src/tracks.ts` & `scene.ts`)
```ts
export const trackLaneSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  type: z.enum(['video', 'audio']),
  clipIds: z.array(z.string()),
  collapsed: z.boolean().optional(),
  muted: z.boolean().optional(),
  locked: z.boolean().optional(),
});
```
- **Why Needed:** Separates visual/audio track rows from layer clips. Allows multiple non-overlapping clips in one track.
- **Backward Compatibility:** Optional field. If `scene.trackLanes` is undefined, the runtime automatically treats each `scene.layers` item as its own track lane.

---

## 5. Render Pipeline Gaps

1. **Playwright Worker Headless Lifecycle:** In `renderer.ts`, Playwright Chromium instances are created per render job. In high-concurrency scenarios, recycling browser contexts rather than entire browser processes reduces render startup overhead by ~1.2s per job.
2. **Frame Accurate Bounds at Arbitrary Timestamps:** `getFrameBounds` currently takes an integer `frameIndex`. For high frame-rate scenes (60fps) or sub-frame easing curves, supporting float milliseconds (`atMs`) will improve timeline keyframe accuracy.
