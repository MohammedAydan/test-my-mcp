# MotionForge Feature Status Matrix (Truth Table)

**Audit Date:** 2026-10-19  
**Architecture:** Unified Architecture Pivot v2.0 (Zero-Port Direct In-Memory Logic Layer + Electron IPC + MCP)  
**Status:** All 20 Remediation Backlog Items & Unified Architecture Pivot Complete — Verified with 19 Automated Suites (346 Tests) & 7 Visual E2E Scripts.

---

## Feature Matrix

| Area | Feature | Status | Evidence / Implementation |
|---|---|---|---|
| **Architecture** | Zero-port in-process `EngineCore` | **PASS** | `EngineCore` class instantiated directly in Electron desktop and MCP server; zero REST API dependencies |
| **Architecture** | Cross-process sync (`fs.watch`) | **PASS** | Atomic `.tmp.<uuid>` + `rename` disk writes with debounced filesystem watcher syncing external edits live |
| **Architecture** | Safe IPC Serialization | **PASS** | `unwrapPayload` deep proxy stripper prevents V8 clone DOMExceptions; strict allowlisted methods |
| **Architecture** | Streaming media protocol (`mf-vault://`)| **PASS** | Privileged custom protocol with HTTP 206 byte-range scrubbing for preview `<video>`, `<img>`, `<audio>` |
| **Architecture** | Dual-transport Studio Adapter | **PASS** | Prefers `window.motionforgeEngine.invoke` with seamless dev/runner HTTP fallback |
| **Canvas** | Click layer to select | **PASS** | Selects in store, renders `#selection-bounding-box` wireframe with exact coordinates |
| **Canvas** | Direct layer drag (60fps) | **PASS** | 60fps ephemeral transform to preview iframe via postMessage + debounced engine save (`test-canvas-drag.cjs`) |
| **Canvas** | 8 Resize handles | **PASS** | Handles scale layer and transform DOM node live |
| **Canvas** | Lollipop rotation handle | **PASS** | Rotates element smoothly with ephemeral matrix transform |
| **Canvas** | Smart snapping guides | **PASS** | Dual-color dashed guides (cyan for canvas center/edges, amber for sibling layers) with floating labels |
| **Canvas** | Marquee multi-selection | **PASS** | Drag on empty canvas selects intersected layers |
| **Canvas** | Zoom & pan navigation | **PASS** | Ctrl+wheel zoom and Space+drag / middle-mouse pan work smoothly |
| **Canvas** | Arrow keys nudge | **PASS** | Arrow keys nudge selected layer by 0.5% (or 2% with Shift) |
| **Canvas** | Real-time playback bounds tracking | **PASS** | Automatic DOM bounds measurement reporting (`layerBounds`) on seek, scrub, and ephemeralTransform |
| **Canvas** | Drag-and-drop assets onto canvas | **PASS** | Drag media/SFX from vault onto canvas with screen-to-canvas coordinate projection (`test-drag-drop-vault.cjs`) |
| **Timeline** | Horizontal playhead scrubbing | **PASS** | Scrubs playhead at 60fps and synchronizes preview iframe |
| **Timeline** | Play / Pause transport (Space) | **PASS** | Toggles playback smoothly at 60fps |
| **Timeline** | Vertical scrolling | **PASS** | Canvas mouse wheel vertical scroll + scrollbar synchronization + track virtualization (`test-timeline-scroll.cjs`) |
| **Timeline** | Multi-clip track lanes & collision | **PASS** | Multiple non-overlapping clips pack onto single track lane using `trackIndex` + collision clamping (`test-track-lanes-ui.cjs`) |
| **Timeline** | 220px fixed left track headers | **PASS** | Headers render with color badges, names, and carets |
| **Timeline** | Collapsible property sub-tracks | **PASS** | Expands xPct, yPct, rotation, opacity, size sub-tracks |
| **Timeline** | Diamond keyframe markers (◆) | **PASS** | Renders keyframes on property sub-tracks with drag-repositioning |
| **Timeline** | In/Out point bracket markers | **PASS** | `I`, `O`, and `X` hotkeys and buttons shade non-work areas |
| **Timeline** | Razor split at playhead (Ctrl+K) | **PASS** | Splits layer into two segments at current timecode |
| **Timeline** | Ripple delete (Shift+Delete) | **PASS** | Deletes layer and pulls subsequent layers earlier |
| **Timeline** | JKL transport loop | **PASS** | `L` accelerates forward (1x/2x/4x), `K` pauses, `J` reverses |
| **Timeline** | Dual-handle trim precision & delta tooltip| **PASS** | `col-resize` trim handles with live floating delta tooltip (`+120ms (3.12s)`) |
| **Timeline** | Audio waveform visualization | **PASS** | Dedicated Audio & SFX track with procedural pre-rendered audio waveforms for cues |
| **Panels** | Resizable splitters | **PASS** | 4px draggable horizontal & vertical splitters with pointer capture, collapse, and localStorage (`test-panel-splitters.cjs`) |
| **Panels** | Left sidebar tabs (Layers/Scene/Assets) | **PASS** | Dedicated Scene Hierarchy and Asset Vault tabs with media cards and built-in SFX bank |
| **Panels** | Panel collapse / maximize | **PASS** | Double-click splitter collapses/restores adjacent panel |
| **Inspector** | Grouped accordion sections | **PASS** | Timing, Transform, Typography, Appearance, Motion Presets |
| **Inspector** | Field editing & debounced save | **PASS** | Updates values and saves to engine |
| **Inspector** | Drag-to-scrub numeric inputs (`<ScrubInput />`)| **PASS** | Horizontal drag scrubbing with Shift (10x) and Alt (0.1x) multipliers |
| **State** | 50-step undo / redo | **PASS** | Movement snapshotting, zero spurious click history, reactive buttons, Ctrl+Z/Ctrl+Shift+Z on canvas & timeline (`test-undo-history.cjs`) |
| **Command** | Command palette (Ctrl+K) | **PASS** | Fuzzy search across layers, actions, and scenes |
| **Engine** | Draft video render (720p 30fps) | **PASS** | Verified with real FFmpeg and `ffprobe` stream metadata |
| **Engine** | Production video render (1080p 60fps)| **PASS** | Verified with real FFmpeg and `ffprobe` stream metadata |
| **Engine** | Keyframe inspection stills | **PASS** | Extracts lightweight JPEGs via headless Chromium |
| **Engine** | Sub-pixel layer bounds endpoint | **PASS** | `GET /api/scenes/:id/frame/:frameIndex/bounds` and `EngineCore.getLayerBounds` |
| **Engine** | Scene Deletion & Asset Listing | **PASS** | `deleteScene` (`BE-004`) and `listAssets` (`BE-003`) APIs and UI modal actions |
| **Desktop** | Standalone executable (`MotionForge.exe`)| **PASS** | Electron desktop shell launches and runs cleanly (`test-desktop-launch.cjs`) |
| **Desktop** | Native OS menus & window title | **PASS** | File/Edit menus and dirty indicator (`*`) functional |
| **Desktop** | Project file format (`.mfproj`) | **PASS** | JSON project file saves and loads via native dialogs |
| **Onboarding**| Non-modal Quickstart Drawer | **PASS** | Unobtrusive collapsible bottom-right drawer replaces full-screen blocking tour |
| **Help** | Searchable Keyboard Shortcuts Modal | **PASS** | Filterable cheat sheet with all 20 NLE hotkeys |
