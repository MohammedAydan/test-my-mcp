# MotionForge Progress Record & Unified Architecture Blueprint

**Document Version:** 1.0.0  
**Date:** 2026-10-19  
**Status:** Canonical Reference & Architectural Pivot Specification  

---

## 1. Executive Summary & Context

MotionForge is a programmatic motion graphics and video editing suite with an Electron desktop shell (`@motionforge/desktop`), Solid.js NLE studio (`@motionforge/studio`), browser runtime canvas (`@motionforge/scene-runtime`), core rendering engine (`@motionforge/core-engine`), shared schemas (`@motionforge/scene-spec`), and an LLM control surface (`@motionforge/mcp-server`).

Following the zero-trust audit (`docs/11_CURRENT_STATE_AUDIT.md`), a strict one-item-per-session remediation protocol was executed. This document serves as the **authoritative checkpoint** of all completed work, remaining backlog items, and introduces the **Unified Architecture Pivot** to eliminate REST API communication in favor of direct in-memory domain logic with dual adapters (UI and MCP).

---

## 2. Completed Remediation Work (Everything Done)

Between commits `1aba1a4` and `d823fe1`, **seven major P0/P1 architectural and interaction defects** were fully designed, implemented, tested, and verified with zero regressions (all 18 test suites and 338 unit tests passing):

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                COMPLETED REMEDIATION MILESTONES                                        │
├──────────┬────────────────────────────────────────────────────────────────────────┬────────────────────┤
│ Item ID  │ Title & Scope                                                          │ Git Commit         │
├──────────┼────────────────────────────────────────────────────────────────────────┼────────────────────┤
│ Phase 0  │ Master Audit Verification & Zero-Trust Spot-Check                      │ 1aba1a4            │
│ BE-001   │ Multi-Clip TrackLane & trackIndex Schema Support                       │ 2785a2e            │
│ DA-002   │ Timeline Canvas Vertical Scrolling, Wheel Zoom & Track Virtualization  │ f6edd10            │
│ DA-001   │ Canvas Direct Manipulation Sync, Ephemeral Transform & Engine Save    │ 5ccae4b            │
│ DA-003   │ Draggable Panel Splitters, Pointer Capture, Collapse & LocalStorage   │ 495831b            │
│ DA-005   │ Multi-Clip Same-Row Packing with Real-time Collision Clamping          │ 320adb3            │
│ DA-004   │ Asset Vault Drag-and-Drop Ingestion to Canvas & Timeline               │ b574cf6            │
│ DA-006   │ Undo History Snapshot Timing on Threshold Drag & Reactive Toolbar      │ d823fe1            │
└──────────┴────────────────────────────────────────────────────────────────────────┴────────────────────┘
```

### Detailed Breakdown of Completed Items

#### 1. Phase 0: Audit Verification (`1aba1a4`)
- Verified audit purity (no code mixed in audit commit).
- Verified engine capabilities and desktop window launch.
- Established ground truth across the 39-row feature status matrix.

#### 2. BE-001: TrackLane & `trackIndex` Schema Support (`2785a2e`)
- **Files:** `packages/scene-spec/src/scene-spec.ts`, `packages/scene-spec/src/field-guide.ts`, `tests/track-lanes.spec.ts`.
- **Result:** Layer base schema extended with optional `trackIndex: z.number().int().min(0)`. Strict backward compatibility: old scenes without `trackIndex` default gracefully to layer order.

#### 3. DA-002: Timeline Canvas Vertical Scrolling (`f6edd10`)
- **Files:** `packages/studio/src/store.ts`, `packages/studio/src/components/Timeline.tsx`.
- **Result:** Mouse wheel vertical scrolling on canvas, scroll translation `ctx.translate(0, -scrollY)`, fixed 28px Time Ruler header, synchronized left track headers, and custom scrollbar thumb. Verified with 10-layer test scenes.

#### 4. DA-001 & BE-002: Canvas Direct Manipulation Sync (`5ccae4b`)
- **Files:** `packages/studio/src/components/CanvasOverlay.tsx`, `packages/studio/src/components/Preview.tsx`, `packages/scene-runtime/src/index.ts`.
- **Result:** Dragging SVG wireframe or 8 resize handles dispatches `ephemeralTransform` postMessage to preview iframe at 60fps. Layer matrix updates in real-time without reloading the iframe. On pointerup, debounced save persists to backend.

#### 5. DA-003: Draggable Workspace Panel Splitters (`495831b`)
- **Files:** `packages/studio/src/components/Splitter.tsx`, `packages/studio/src/App.tsx`, `packages/studio/src/store.ts`.
- **Result:** 4px draggable splitters between Left Dock, Monitor, Inspector, and Timeline. Support pointer capture, double-click collapse/restore, and persistent layout storage in `localStorage`.

#### 6. DA-005: Multi-Clip Track Lanes & Collision Clamping (`320adb3`)
- **Files:** `packages/studio/src/components/Timeline.tsx`.
- **Result:** Multiple non-overlapping clips share a single visual track lane when assigned the same `trackIndex` or `trackLane`. Dynamic collision detection prevents overlapping during clip move and trim operations.

#### 7. DA-004: Asset Vault Drag-and-Drop Ingestion (`b574cf6`)
- **Files:** `packages/studio/src/components/LayersPanel.tsx`, `packages/studio/src/components/CanvasOverlay.tsx`, `packages/studio/src/components/Timeline.tsx`, `packages/studio/src/store.ts`.
- **Result:** Project media cards and built-in SFX bank (`whoosh`, `pop`, `click`, `subImpact`, `shimmer`, `riser`) are draggable. Dropping onto Canvas projects normalized `{ xPct, yPct }` coordinates. Dropping onto Timeline schedules clips/audio cues at the drop timecode.

#### 8. DA-006: Undo History Snapshot Timing (`d823fe1`)
- **Files:** `packages/studio/src/store.ts`, `packages/studio/src/components/CanvasOverlay.tsx`, `packages/studio/src/components/Timeline.tsx`.
- **Result:** Deferred snapshotting until drag displacement exceeds 2px threshold. Zero spurious undo snapshots on simple selection clicks. Pre-drag coordinates captured before store mutation. Reactive `#btn-undo` and `#btn-redo` toolbar buttons. Complete undo/redo fidelity for canvas position and timeline trimming.

---

## 3. Remaining Backlog Items (Everything Left)

The remaining remediation backlog items from `docs/13_NEXT_STEPS.md` fall into visual polish and advanced NLE features:

| Rank | ID | Title | Domain | Priority | Complexity | Target Status |
| :---: | :--- | :--- | :---: | :---: | :---: | :--- |
| **9** | **UI-004** | Extract Exact Bounding Boxes & Add Smart Alignment Guides | Studio | P1 | M | Pending |
| **10** | **UI-001** | Apply High-Contrast Pro NLE Dark Theme & Surface Tokens | Studio | P1 | M | Pending |
| **11** | **BE-003** | Implement Authoritative Asset Listing (`GET /api/assets`) | Backend | P1 | S | To be subsumed by Domain Logic Layer |
| **12** | **BE-004** | Implement Scene Deletion (`DELETE /api/scenes/:id`) | Backend | P2 | S | To be subsumed by Domain Logic Layer |
| **13** | **UI-002** | Add Scrubbable Numeric Drag Inputs to Inspector | Studio | P1 | S | Pending |
| **14** | **UI-005** | Implement Dual-Handle Clip Trimming with Cursor States | Studio | P1 | M | Pending |
| **15** | **UI-003** | Separate Project Vault & Scene Hierarchy Tree | Studio | P1 | S | Pending |
| **16** | **UI-006** | Implement Pro NLE Keyboard Shortcuts Map & Cheat Sheet | Studio | P2 | S | Pending |
| **17** | **UI-007** | Pre-render Audio Waveforms on Timeline Tracks | Studio | P2 | M | Pending |
| **18** | **UI-008** | Replace Modal Tour with Non-Intrusive Drawer | Studio | P2 | S | Pending |
| **19** | **TS-001** | Add Automated Tests for Live Canvas Drag & Undo Parity | Tests | P0 | M | Covered by `test-undo-history.cjs` |
| **20** | **TS-002** | Add Automated Tests for Timeline Multi-Track & Vertical Scroll | Tests | P0 | M | Covered by `test-track-lanes-ui.cjs` |

---

## 4. The Architectural Pivot: Unified Domain Logic Layer

### 4.1 The Core Problem with REST APIs in a Single Desktop Application

Currently, MotionForge operates three separate processes communicating over loopback HTTP (`http://127.0.0.1:4000`):
1. **Core Engine:** Fastify HTTP server binding to a TCP port.
2. **Desktop Studio:** Electron renderer process fetching endpoints over HTTP (`fetch('/api/scenes')`).
3. **MCP Server:** Stdio process making HTTP requests to port 4000.

**Why this architecture is fundamentally flawed for an integrated product:**
1. **Network Latency & Unnecessary Serialization:**
   - Every single scene save serializes a large `SceneSpec` JSON tree, transmits it across the OS loopback network stack (TCP handshake, HTTP headers, buffer chunking), and parses it in Fastify.
   - This creates noticeable debounce delay, network latency, and memory garbage collection spikes.
2. **Port Allocation & Socket Fragility:**
   - Binding to port 4000 leads to port collisions, firewall prompts, and zombie server processes when the desktop shell terminates abruptly.
   - If the engine takes 2 seconds to boot, the UI displays "Engine Offline" errors.
3. **Double State of Truth & Coordination Latency:**
   - The UI maintains a local Solid.js store while the backend maintains a separate disk/memory store. Synchronizing requires polling or SSE event streams.
4. **Desktop Disconnect:**
   - Electron already provides a battle-tested, high-performance Inter-Process Communication (IPC) bus (`ipcMain` / `ipcRenderer`) capable of passing structured objects directly through shared Chromium memory with zero HTTP overhead.

### 4.2 Target Architecture: Three-Tier Unified Engine

Instead of treating the backend as an external HTTP server, we restructure the repository into a **Domain Logic Layer** with **Two Consumer Layers (UI and MCP)** and **Zero REST APIs**:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                 MOTIONFORGE UNIFIED APPLICATION                         │
│                                                                                         │
│   ┌─────────────────────────────────────────┐   ┌───────────────────────────────────┐   │
│   │             CONSUMER LAYER 1            │   │          CONSUMER LAYER 2         │   │
│   │             Desktop Studio UI           │   │             MCP Server            │   │
│   │             (Solid.js Renderer)         │   │          (LLM Stdio Adapter)      │   │
│   └────────────────────┬────────────────────┘   └─────────────────┬─────────────────┘   │
│                        │                                          │                     │
│                        │ Electron IPC Channel                     │ Direct In-Process   │
│                        │ ('engine:invoke')                        │ Function Invocation │
│                        ▼                                          ▼                     │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│   │                            DOMAIN LOGIC LAYER                                   │   │
│   │                         (@motionforge/core-engine)                              │   │
│   │                                                                                 │   │
│   │   ┌───────────────────────┐ ┌────────────────────────┐ ┌────────────────────┐   │   │
│   │   │     SceneService      │ │      AssetVault        │ │   InspectService   │   │   │
│   │   │   (CRUD, Hash, Rev,   │ │ (Storage, Resolution,  │ │ (Playwright Stills │   │   │
│   │   │    Disk Persistence)  │ │   Mime, Vault Ingest)  │ │   & DOM Bounds)    │   │   │
│   │   └───────────────────────┘ └────────────────────────┘ └────────────────────┘   │   │
│   │   ┌───────────────────────┐ ┌────────────────────────┐ ┌────────────────────┐   │   │
│   │   │     RenderService     │ │     ProjectManager     │ │    AudioMixer      │   │   │
│   │   │  (Playwright Pipe to  │ │  (Job Workspaces &     │ │  (Millisecond      │   │   │
│   │   │   FFmpeg image2pipe)  │ │    Disk File Sync)     │ │   adelay SFX)      │   │   │
│   │   └───────────────────────┘ └────────────────────────┘ └────────────────────┘   │   │
│   │                                                                                 │   │
│   └────────────────────────────────────────┬────────────────────────────────────────┘   │
│                                            │ Strict Contract Validation                 │
│                                            ▼                                            │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│   │                               @motionforge/scene-spec                           │   │
│   │                         (Zod Schemas, Types, Field Guide)                       │   │
│   └─────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Unified Communication Blueprint

### 5.1 The Domain Logic Interface (`EngineCore`)

The core engine becomes an exported TypeScript service class rather than an HTTP-only daemon:

```typescript
// packages/core-engine/src/engine-core.ts
export interface EngineCore {
  // Scene Operations
  getScene(sceneId: string): Promise<SceneSpec>;
  saveScene(scene: SceneSpecInput, projectPath?: string): Promise<SaveSceneResult>;
  deleteScene(sceneId: string): Promise<boolean>;
  listScenes(): Promise<Array<{ id: string; name: string; durationMs: number; updatedAt: Date }>>;

  // Asset Operations
  listAssets(projectPath?: string): Promise<AssetVaultItem[]>;
  ingestAsset(fileBuffer: Buffer, fileName: string, kind: string): Promise<AssetVaultItem>;

  // Inspection Operations
  inspectKeyframes(sceneId: string, options: InspectOptions): Promise<InspectResult>;
  getLayerBounds(sceneId: string, frame: number): Promise<Record<string, LayerBounds>>;

  // Rendering Operations
  startRender(sceneId: string, quality: 'draft' | 'production', projectPath?: string): Promise<RenderJob>;
  getRenderStatus(jobId: string): Promise<RenderJobStatus>;

  // Authoring Contract
  getCapabilities(): CapabilitiesResponse;
}
```

### 5.2 Consumer 1: Electron IPC Adapter (UI Communication)

#### In Electron Main Process (`packages/desktop/src/main.ts`):
```typescript
import { ipcMain } from 'electron';
import { createEngineCore } from '@motionforge/core-engine';

const engine = createEngineCore({
  storageDir: path.join(app.getPath('userData'), 'scenes'),
  vaultDir: path.join(app.getPath('userData'), 'vault'),
});

ipcMain.handle('engine:invoke', async (_event, method: string, ...args: any[]) => {
  if (typeof (engine as any)[method] !== 'function') {
    throw new Error(`Unknown engine method: ${method}`);
  }
  return await (engine as any)[method](...args);
});
```

#### In Electron Preload (`packages/desktop/src/preload.ts`):
```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('motionforgeEngine', {
  invoke: (method: string, ...args: any[]) => ipcRenderer.invoke('engine:invoke', method, ...args),
});
```

#### In Studio Frontend (`packages/studio/src/api.ts`):
```typescript
// Completely replaces window.fetch('http://127.0.0.1:4000/api/...')
export const api = {
  async getCapabilities() {
    return window.motionforgeEngine.invoke('getCapabilities');
  },
  async getScene(id: string) {
    return window.motionforgeEngine.invoke('getScene', id);
  },
  async saveScene(scene: StudioScene) {
    return window.motionforgeEngine.invoke('saveScene', scene);
  },
  async listAssets() {
    return window.motionforgeEngine.invoke('listAssets');
  },
  async renderVideo(sceneId: string, quality: 'draft' | 'production') {
    return window.motionforgeEngine.invoke('startRender', sceneId, quality);
  },
};
```

**Benefits for Desktop Studio:**
- **Zero HTTP overhead:** Sub-millisecond latency for auto-saves and layer operations.
- **No network ports:** Never fails due to port 4000 conflicts or firewall blocks.
- **Single executable distribution:** No child server processes to spawn, monitor, or kill.
- **Direct file system access:** Local asset drag-and-drop links directly without uploading over HTTP.

### 5.3 Consumer 2: Direct In-Process MCP Server

In `packages/mcp-server/src/server.ts`:
Instead of creating an HTTP client targeting `MOTIONFORGE_ENGINE_URL`, the MCP server directly instantiates `EngineCore`:

```typescript
import { createEngineCore } from '@motionforge/core-engine';

const engine = createEngineCore({
  storageDir: process.env.MOTIONFORGE_STORAGE_DIR || './data/scenes',
  vaultDir: process.env.MOTIONFORGE_VAULT_DIR || './data/vault',
});

// MCP Tools call engine directly:
server.tool('create_or_update_scene', sceneShapeSchema, async (args) => {
  const result = await engine.saveScene(args.scene, args.projectPath);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

server.tool('inspect_scene_keyframes', inspectKeyframesSchema, async (args) => {
  const result = await engine.inspectKeyframes(args.sceneId, args);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});
```

**Benefits for MCP Server:**
- **Rock-solid execution:** An LLM agent invoking tools never suffers from "Connection Refused on 127.0.0.1:4000".
- **Zero IPC serialization bottlenecks:** Image buffers for inspection frames remain in Node memory rather than serialized over loopback HTTP twice.
- **CLI/Skill parity:** MCP operates cleanly in standalone headless mode.

---

## 6. Phased Implementation Strategy for the Architecture Pivot

1. **Phase 1: Abstract Core Engine Services into `EngineCore`**
   - Extract `scene-store`, `render-pipeline`, `inspect-keyframes`, and `asset-vault` into an exported `EngineCore` interface in `packages/core-engine`.
   - Ensure `packages/core-engine/src/index.ts` exports both the Fastify server (for standalone/remote deployment) and the direct `createEngineCore()` factory.

2. **Phase 2: Wire Electron Preload IPC Bridge**
   - Update `packages/desktop/src/main.ts` to instantiate `EngineCore` in the Electron main process.
   - Expose `window.motionforgeEngine.invoke()` in `packages/desktop/src/preload.ts`.

3. **Phase 3: Switch Studio `api.ts` to IPC Bridge**
   - Replace HTTP `fetch` calls in `packages/studio/src/api.ts` with `window.motionforgeEngine.invoke()`.
   - Provide an in-memory/mock fallback only when running purely in a standalone Vite web browser dev environment.

4. **Phase 4: Wire In-Process MCP Server**
   - Allow `packages/mcp-server` to run with `EngineCore` directly, eliminating the need to launch Fastify before starting the MCP toolchain.

---

## 7. Current Project Health & Verification Status

- **Unit & Contract Tests:** 18/18 test files passing, 338/338 tests passing (`npm test`).
- **Phase 0 Audit Verification:** 100% verified (`docs/14_AUDIT_VERIFICATION.md`).
- **Feature Status Matrix:** Updated to reflect 8 completed milestones (`docs/12_FEATURE_STATUS_MATRIX.md`).
- **E2E Visual Tests Passing:**
  - `scripts/test-undo-history.cjs` (PASS)
  - `scripts/test-drag-drop-vault.cjs` (PASS)
  - `scripts/test-track-lanes-ui.cjs` (PASS)
  - `scripts/test-panel-splitters.cjs` (PASS)
  - `scripts/test-canvas-drag.cjs` (PASS)
