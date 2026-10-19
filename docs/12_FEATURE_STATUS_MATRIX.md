# MotionForge Feature Status Matrix (Truth Table)

**Audit Date:** 2026-10-19  
**Purpose:** Single-glance comprehensive truth table cross-referencing all claimed features against verified real behavior.

---

## Feature Matrix

| Area | Feature | Claimed by Prev Report | Actually Works? | Evidence | Severity | Blocker For |
|---|---|---|---|---|---|---|
| **Canvas** | Click layer to select | Yes | **PASS** — selects in store, renders `#selection-bounding-box` wireframe with exact coordinates | `screenshots/canvas-drag-verify.png` | — | — |
| **Canvas** | Direct layer drag | Yes | **PASS** — 60fps ephemeral transform to preview iframe via postMessage + engine persistence | `screenshots/canvas-drag-verify.png` | — | — |
| **Canvas** | 8 Resize handles | Yes | **PASS** — handles scale layer and transform DOM node live | `screenshots/canvas-drag-verify.png` | — | — |
| **Canvas** | Lollipop rotation handle | Yes | **PASS** — rotates element smoothly with ephemeral matrix transform | `screenshots/canvas-drag-verify.png` | — | — |
| **Canvas** | Snapping guides (5px cyan) | Yes | **PASS** — guides render at center and canvas edges | `phase-a-overlay.png` | — | — |
| **Canvas** | Marquee multi-selection | Yes | **PASS** — drag on empty canvas selects intersected layers | `phase-a-overlay.png` | — | — |
| **Canvas** | Zoom & pan navigation | Yes | **PASS** — Ctrl+wheel zoom and Space+drag pan work smoothly | `audit-01-initial-launch.png` | — | — |
| **Canvas** | Arrow keys nudge | No | **Missing** — arrow keys do not nudge selected elements on canvas | `audit-complaint-3.png` | P1 | Micro-alignment |
| **Canvas** | Real-time playback tracking | Yes | **FAIL** — bounding box stays frozen at frame 0 while layer animates in video | `audit-complaint-10.png` | P0 | Animation preview |
| **Canvas** | Drag-and-drop assets onto canvas | No | **PASS** — drag media/SFX from vault onto canvas with screen-to-canvas coordinate projection | `screenshots/drag-drop-vault.png` | — | — |
| **Timeline** | Horizontal playhead scrubbing | Yes | **PASS** — scrubs playhead and synchronizes preview iframe | `diagnostic-07-scrub.png` | — | — |
| **Timeline** | Play / Pause transport (Space) | Yes | **PASS** — toggles playback at 60fps | `test-phase2.cjs:2.8` | — | — |
| **Timeline** | Vertical scrolling | No | **PASS** — canvas mouse wheel vertical scroll + scrollbar synchronization + track virtualization | `screenshots/timeline-scroll-after.png` | — | — |
| **Timeline** | Multi-clip same-row packing | No | **PASS** — multiple non-overlapping clips pack onto single track lane using `trackIndex` + collision clamping | `screenshots/track-lanes-multiclip.png` | — | — |
| **Timeline** | 220px fixed left track headers | Yes | **PASS** — headers render with color badges, names, and carets | `phase-b-timeline.png` | — | — |
| **Timeline** | Collapsible property sub-tracks | Yes | **PASS** — expands xPct, yPct, rotation, opacity, size | `phase-b-timeline.png` | — | — |
| **Timeline** | Diamond keyframe markers (◆) | Yes | **PASS** — renders keyframes on property sub-tracks | `phase-b-timeline.png` | — | — |
| **Timeline** | In/Out point bracket markers | Yes | **PASS** — [ I ] and [ O ] hotkeys and buttons shade non-work areas | `phase-b-timeline.png` | — | — |
| **Timeline** | Razor split at playhead (Ctrl+K) | Yes | **PASS** — splits layer into two segments at current timecode | `phase-b-timeline.png` | — | — |
| **Timeline** | Ripple delete (Shift+Delete) | Yes | **PASS** — deletes layer and pulls subsequent layers earlier | `phase-b-timeline.png` | — | — |
| **Timeline** | JKL transport loop | Yes | **PASS** — L accelerates forward (1x/2x/4x), K pauses, J reverses | `phase-b-timeline.png` | — | — |
| **Timeline** | Trim handle precision | Yes | **FAIL** — 6px hit zone is too small; no live frame readout tooltip | `audit-complaint-4.png` | P1 | Precise trimming |
| **Timeline** | Audio waveform visualization | No | **Missing** — audio cues are only text badges without waveforms | `audit-complaint-11.png` | P1 | Audio synchronization |
| **Panels** | Resizable splitters | No | **PASS** — 4px draggable horizontal & vertical splitters with pointer capture, collapse, and localStorage | `screenshots/panel-splitters.png` | — | — |
| **Panels** | Left sidebar tabs (Layers/Scene/Assets) | Yes | **PASS** — Dedicated Asset Vault tab with media cards and SFX bank | `screenshots/drag-drop-vault.png` | — | — |
| **Panels** | Panel collapse / maximize | No | **PASS** — double-click splitter collapses/restores adjacent panel | `screenshots/panel-splitters.png` | — | — |
| **Inspector** | Grouped accordion sections | Yes | **PASS** — Timing, Motion Presets, Typography, Appearance render | `diagnostic-03-selection.png` | — | — |
| **Inspector** | Field editing & debounced save | Yes | **PASS** — updates values and saves to engine | `diagnostic-04-edit-field.png` | — | — |
| **Inspector** | Drag-to-scrub numeric inputs | No | **Missing** — numbers must be manually typed; no scrub handles | `audit-complaint-11.png` | P1 | Rapid iteration |
| **State** | 50-step undo / redo | Yes | **PASS** — threshold movement snapshotting, zero spurious click history, reactive buttons, Ctrl+Z/Ctrl+Shift+Z on canvas & timeline | `screenshots/undo-history.png` | — | — |
| **Command** | Command palette (Ctrl+K) | Yes | **PASS** — fuzzy search across layers, actions, and scenes | `diagnostic-12-palette.png` | — | — |
| **Engine** | Draft video render (720p 30fps) | Yes | **PASS** — verified with real FFmpeg and `ffprobe` stream metadata | `diagnostic-10-draft-frame.png` | — | — |
| **Engine** | Production video render (1080p 60fps)| Yes | **PASS** — verified with real FFmpeg and `ffprobe` stream metadata | `diagnostic-11-prod-frame.png` | — | — |
| **Engine** | Keyframe inspection stills | Yes | **PASS** — extracts 5 lightweight JPEGs via headless Chromium | `diagnostic-09-inspect.png` | — | — |
| **Engine** | Sub-pixel layer bounds endpoint | Yes | **PASS** — `GET /api/scenes/:id/frame/:frameIndex/bounds` returns accurate rects | `curl output` | — | — |
| **Desktop** | Standalone executable (`MotionForge.exe`)| Yes | **PASS** — 180MB unpacked binary launches and runs cleanly | `packaged-exe-verify.png` | — | — |
| **Desktop** | Dynamic port allocation | Yes | **PASS** — binds to OS-assigned port when launched in production mode | `main.ts` | — | — |
| **Desktop** | Native OS menus & window title | Yes | **PASS** — File/Edit menus and dirty indicator (`*`) functional | `desktop-verify-02.png` | — | — |
| **Desktop** | Project file format (`.mfproj`) | Yes | **PASS** — JSON project file saves and loads via native dialogs | `test-desktop-launch.cjs` | — | — |
