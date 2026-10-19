# MotionForge Unified Architecture Blueprint (v2.0)
## Zero-Port, In-Memory Domain Logic with Dual UI & MCP Adapters

**Document Version:** 2.0.0  
**Date:** 2026-10-19  
**Status:** Approved Master Architecture Specification  

---

## 1. Executive Architecture Summary

MotionForge v2.0 transitions the architecture from a loosely-coupled HTTP microservice model to a **single-process, zero-port unified domain logic engine**.

### Previous Flawed Architecture (HTTP REST over Loopback)
```
[ Electron Desktop Studio ] ─── HTTP (Port 4000) ───► [ Fastify Server ]
[ MCP Stdio Server (AI)   ] ─── HTTP (Port 4000) ───► [ Fastify Server ]
```
- **Flaws:** Network serialization overhead for 60fps canvas operations, port 4000 collisions, detached child processes, firewall popups, and lack of true live synchronization.

### Target Unified Architecture (In-Memory Core + Dual Adapters)
```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                MOTIONFORGE UNIFIED CORE                                │
│                                                                                        │
│   ┌────────────────────────────────────────┐   ┌───────────────────────────────────┐   │
│   │            CONSUMER LAYER 1            │   │          CONSUMER LAYER 2         │   │
│   │            Desktop Studio UI           │   │             MCP Server            │   │
│   │            (Solid.js Renderer)         │   │          (LLM Stdio Adapter)      │   │
│   └───────────────────┬────────────────────┘   └─────────────────┬─────────────────┘   │
│                       │                                          │                     │
│                       │ Electron IPC Bridge                      │ Direct In-Process   │
│                       │ ('engine:invoke')                        │ Function Invocation │
│                       ▼                                          ▼                     │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │                           DOMAIN LOGIC LAYER (EngineCore)                      │   │
│   │                              (@motionforge/core-engine)                        │   │
│   │                                                                                │   │
│   │  • SceneService      (CRUD, revisions, content hashing, atomic persistence)    │   │
│   │  • AssetVault        (Local storage, MIME detection, SHA-256 deduplication)    │   │
│   │  • InspectService    (Headless Chromium inspection, sub-pixel layer bounds)    │   │
│   │  • RenderService     (Playwright memory pipe into FFmpeg image2pipe)           │   │
│   │  • ProjectManager    (Manifest syncing, job directories, disk auto-sync)       │   │
│   │  • EventBus          (Bi-directional typed event emitter)                      │   │
│   │  • StateWatcher      (Cross-process fs.watch with debounce & reconciliation)   │   │
│   └───────────────────────────────────────┬────────────────────────────────────────┘   │
│                                           │ Strict Zod Contract Validation             │
│                                           ▼                                            │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │                            @motionforge/scene-spec                             │   │
│   │                      (Zod Schemas, Types, Field Guide)                         │   │
│   └────────────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Five Mandatory Architectural Guarantees

### 1. Anti-Split-Brain & Cross-Process State Synchronization
- **Deterministic Path Resolution (`resolveEnginePaths`):**
  Priority hierarchy:
  1. Explicit `options.storageDir` / `options.vaultDir`.
  2. Environment variables `MOTIONFORGE_STORAGE_DIR` and `MOTIONFORGE_VAULT_DIR`.
  3. Canonical user-level directory `~/.motionforge/scenes` and `~/.motionforge/vault` (or monorepo local `./data` during development).
- **Atomic Disk Persistence:**
  All writes execute through a temporary file `<target>.tmp.<uuid>` followed by atomic `fs.rename()`.
- **Real-time `fs.watch` Reconciliation:**
  `EngineCore` monitors storage directories for changes made by external processes (e.g. MCP agent creating a scene), immediately reloads state, and emits `scene:updated` or `vault:updated`.

### 2. Solid.js Proxy Unwrapping & Secure Electron IPC Allowlisting
- **No Cloned Proxy Errors:**
  Before passing payloads over `window.motionforgeEngine.invoke()`, Studio automatically unwraps Solid.js reactive proxies into plain JavaScript objects (`JSON.parse(JSON.stringify(payload))` or `unwrap()`).
- **Strict Method Allowlist:**
  Electron IPC accepts only explicitly allowlisted methods:
  `['getCapabilities', 'getScene', 'saveScene', 'deleteScene', 'listScenes', 'listAssets', 'ingestAsset', 'inspectKeyframes', 'getLayerBounds', 'startRender', 'getRenderStatus']`.

### 3. Bi-Directional IPC Event Bus (`engine:invoke` + `engine:event`)
- `EngineCore` extends Node's `EventEmitter`.
- Emits real-time domain events:
  - `render:progress` (`{ jobId, sceneId, progressPct, currentFrame, totalFrames }`)
  - `render:completed` (`{ jobId, sceneId, outputPath, durationMs }`)
  - `render:failed` (`{ jobId, sceneId, error }`)
  - `scene:updated` (`{ sceneId, revision, hash, source: 'internal' | 'external' }`)
  - `scene:deleted` (`{ sceneId }`)
  - `vault:updated` (`{ assets: AssetVaultItem[] }`)
- Electron forwards all events to `mainWindow.webContents.send('engine:event', payload)`.
- Preload exposes `window.motionforgeEngine.onEvent((event) => void)`.

### 4. Zero-Port Asset & Runtime Serving (`mf-vault://` + Playwright `page.route`)
- **Electron Custom Scheme `mf-vault://`:**
  Registered with `standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true`. Handled via `protocol.handle('mf-vault', ...)` backed by `net.fetch(pathToFileURL(...))` supporting HTTP 206 byte-range streaming for video/audio scrubber without network ports.
- **Playwright Route Interception:**
  Headless rendering and keyframe inspection serve runtime scripts and vault assets in memory via `page.route('**/*', ...)`.
- **Dual-Transport Fallback:**
  In standalone browser mode (Vite dev or Playwright test runner), `packages/studio/src/api.ts` seamlessly falls back to local engine endpoints.

### 5. Dual-Path Bounding Box Architecture
- **Path A (Studio Live 60fps):**
  Measured directly inside `@motionforge/scene-runtime` via `getBoundingClientRect()`, posted to Studio parent via `window.parent.postMessage({ type: 'layerBoundsReport', bounds }, '*')` on frame update and ephemeral transform.
- **Path B (Headless AI/MCP):**
  `EngineCore.getLayerBounds(sceneId, frame)` measures exact DOM rects using Playwright for agent quality gating.

---

## 3. Progress Record (Current State)

| Milestone | Status | Verification Evidence |
|---|---|---|
| **Phase 0** (Audit Verification) | **PASS** | `docs/14_AUDIT_VERIFICATION.md` |
| **BE-001** (TrackLane & `trackIndex` Schema) | **PASS** | `packages/scene-spec/tests/track-lanes.spec.ts` |
| **DA-002** (Timeline Canvas Vertical Scroll & Virtualization) | **PASS** | `screenshots/timeline-scroll-after.png` |
| **DA-001** (Canvas Direct Manipulation & 60fps Ephemeral Transform) | **PASS** | `screenshots/canvas-drag-verify.png` |
| **DA-003** (Draggable Workspace Splitters & Collapse) | **PASS** | `screenshots/panel-splitters.png` |
| **DA-005** (Multi-Clip Track Lanes & Collision Clamping) | **PASS** | `screenshots/track-lanes-multiclip.png` |
| **DA-004** (Asset Vault Drag-and-Drop Ingestion) | **PASS** | `screenshots/drag-drop-vault.png` |
| **DA-006** (Threshold Undo History & Reactive Toolbar Buttons) | **PASS** | `screenshots/undo-history.png` |
| **Unit Test Suite** (All 18 packages) | **338/338 PASS** | `npm test` |
