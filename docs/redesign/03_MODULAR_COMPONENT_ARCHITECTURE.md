# Modular Component Architecture — `packages/studio/src/`

> The Studio is a **composition of isolated modules**, not one giant `App.tsx`.
> Each module owns one responsibility, reads one state slice and talks to the
> engine through one service adapter.

---

## 1. Target tree

```
packages/studio/src/
├── index.tsx                       # entry: renders <App/> into #root
├── App.tsx                         # composition root ONLY (wires modules, no feature logic)
├── types.ts                        # shared UI types (StudioScene, StudioLayer, …)
│
├── styles/
│   ├── tokens.css                  # colour / type / metric tokens  (Law 1)
│   ├── nle-layout.css              # app grid, panel chrome, splitters, title bar
│   └── components.css              # reusable component classes (buttons, tabs, rows, chips)
│
├── state/
│   ├── store.ts                    # the reactive store (createStore + actions)
│   ├── slices/
│   │   ├── workspace.ts            # panel sizes, collapsed flags, maximizedPanelId, activePanelId
│   │   ├── scene.ts                # the loaded scene, selection, dirty flag
│   │   ├── transport.ts            # playhead, playing, playbackRate, in/out points
│   │   ├── tools.ts                # activeTool, snapEnabled, viewport zoom/pan
│   │   └── render.ts               # render queue, job statuses
│   └── timecode.ts                 # formatTimecode(ms, fps) -> "00:00:00:00"
│
├── services/
│   ├── engine-bridge.ts            # the ONLY place that touches window.motionforgeEngine
│   ├── scene-service.ts            # load / save / create / duplicate / delete scenes
│   ├── asset-service.ts            # list / ingest assets, SFX bank
│   ├── render-service.ts           # start render, poll status, progress events
│   └── commands.ts                 # the named command registry (menus, palette, shortcuts)
│
├── components/
│   ├── icons/
│   │   └── NleIcons.tsx            # the entire vector icon system (Law 2)
│   ├── shell/
│   │   ├── TitleBar.tsx            # frameless chrome: emblem, menu bar, breadcrumb, pills, window controls
│   │   ├── AppMenuBar.tsx          # File/Edit/Composition/Layer/Timeline/View/Window/Help
│   │   ├── ToolDock.tsx            # vertical Premiere-style tool rail
│   │   └── StatusBar.tsx           # 22px bottom bar
│   ├── workspace/
│   │   ├── PanelContainer.tsx      # tab bar, focus border, maximise (`` ` ``)
│   │   ├── Splitter.tsx            # 4px draggable splitters with localStorage persistence
│   │   └── WorkspaceLayout.tsx     # Editing / Motion / Audio / Effects / Export presets
│   ├── project-bin/
│   │   └── ProjectBinPanel.tsx     # scenes + media vault + SFX bank
│   ├── hierarchy/
│   │   └── LayerStackPanel.tsx     # After Effects style layer table
│   ├── monitor/
│   │   ├── ProgramMonitorPanel.tsx # composition bar + mf-runtime iframe
│   │   ├── CanvasOverlay.tsx       # SVG selection box, handles, smart guides, 60fps drag
│   │   └── TransportBar.tsx        # SMPTE readout + transport buttons
│   ├── inspector/
│   │   ├── ScrubInput.tsx          # Pro numeric scrub field
│   │   └── EffectControlsPanel.tsx # layer + composition property inspector
│   ├── timeline/
│   │   ├── TimelinePanel.tsx       # ruler, tracks, clips, razor, trim
│   │   └── AudioVuMeter.tsx        # stereo L/R dB meter
│   ├── export/
│   │   └── RenderModal.tsx         # render queue / export manager
│   ├── modals/
│   │   ├── ShortcutsModal.tsx      # searchable shortcut map
│   │   └── HelpDrawer.tsx          # quickstart guide
│   └── shared/
│       ├── Toasts.tsx
│       ├── CommandPalette.tsx
│       ├── OnboardingTour.tsx
│       └── Modal.tsx
```

---

## 2. Module contracts

### 2.1 `state/store.ts`

Owns **all** reactive application state and the actions that mutate it.
Components never call `setState` directly with a nested path — they call a
named action, so every mutation goes through one place and can be reasoned
about (and undone).

State slices (grouped logically, stored in one `createStore`):

| Slice | Keys |
| --- | --- |
| `engine` | `online`, `url`, `latencyMs` |
| `capabilities` | the capability registry from `EngineCore.getCapabilities()` |
| `scene` | the loaded `StudioScene` |
| `sceneId`, `selectedLayerId`, `selectedLayerIds` | selection |
| `playhead`, `playing`, `playbackRate`, `inPoint`, `outPoint` | transport |
| `zoom`, `panOffset`, `timelineScrollY` | timeline view |
| `viewportZoom`, `viewportPan` | monitor view |
| `activeTool` | `'select' \| 'hand' \| 'razor' \| 'text' \| 'shape' \| 'zoom'` |
| `snapEnabled` | magnetic snapping |
| `layerBounds` | runtime-measured bounds per layer id |
| `workspace` | `leftPanelWidth`, `rightPanelWidth`, `timelineHeight`, collapsed flags |
| `activePanelId`, `maximizedPanelId` | focus + maximise |
| `workspacePreset` | `'editing' \| 'motion' \| 'audio' \| 'effects' \| 'export'` |
| `renderQueue` | job records |
| `toasts`, `activeModal`, `dirty`, `saveStatus` | chrome |

Actions (the public API of the store):

| Action | Effect |
| --- | --- |
| `mutateScene(fn, description)` | push history → clone → mutate → mark dirty → schedule save |
| `updateSceneWithoutHistory(fn)` | mutate without a history entry (used during a drag) |
| `pushHistory(description)` | snapshot the scene into the undo stack |
| `undo()` / `redo()` | restore a snapshot, re-save, toast |
| `executeSave()` | `sceneService.save(scene)` — **sanitizes before IPC** |
| `selectLayer(id, multi)` | selection |
| `setPlayhead(ms)` | clamped to `[0, durationMs]` |
| `setActiveTool(tool)` | tool state |
| `setActivePanel(id)` / `toggleMaximizedPanel(id)` | focus + `` ` `` maximise |
| `razorSplitAtPlayhead()` / `razorSplitLayerAt(id, ms)` | clip split |
| `addKeyframe` / `deleteKeyframe` | keyframe tracks |
| `addToast(message, type)` | toast queue |

### 2.2 `state/timecode.ts`

```ts
formatTimecode(ms: number, fps = 30): string   // "00:00:02:15"
formatFrameCount(ms: number, fps = 30): string   // "00075f"
formatDuration(ms: number): string              // "00:00:08:00"
```

Non-drop-frame SMPTE. Hours are not wrapped at 24 (`HH:MM:SS:FF`).

### 2.3 `services/engine-bridge.ts`

The **only** module that reads `window.motionforgeEngine`. It:

- exposes `invoke(method, ...args)` with the method allow-list mirrored from
  the main process,
- exposes `onEvent(cb)` returning an unsubscribe function,
- provides a graceful fallback (a mock bridge) when the renderer is not running
  inside Electron, so the Studio can be developed in a plain browser.

### 2.4 `services/commands.ts`

A single registry of named commands:

```ts
interface Command {
  id: string;
  title: string;
  category: 'File' | 'Edit' | 'Composition' | 'Layer' | 'Timeline' | 'View' | 'Window' | 'Help';
  shortcut?: string;
  run: () => void | Promise<void>;
}
```

The application menu bar, the command palette (`Ctrl+K`), the tool dock and the
shortcuts modal are **all** views over this one registry. A menu entry can
therefore never be a dead button, and a shortcut can never drift from the menu.

---

## 3. Component boundaries

### 3.1 `shell/TitleBar.tsx`

**Owns:** the frameless window chrome.
**Reads:** `state.scene`, `state.dirty`, `state.engine`, `state.workspacePreset`.
**Calls:** `commands.run(id)`, `window.motionforge.window.*`.

Must not own any editing logic.

### 3.2 `shell/ToolDock.tsx`

**Owns:** the active tool.
**Reads:** `state.activeTool`, `state.snapEnabled`.
**Calls:** `store.setActiveTool`, `store.setSnapEnabled`, `store.undo/redo`.

Tools: Selection (`V`), Hand (`H`), Razor (`C`), Text (`T`), Shape (`R`),
Preset dropdown (chart / code / device), Magnet (`S`), Undo, Redo.

### 3.3 `shell/StatusBar.tsx`

**Owns:** nothing. Pure projection of state into a 22px bar:
active tool hint, engine status, resolution/FPS badge, layer count, auto-save state.

### 3.4 `workspace/PanelContainer.tsx`

Props: `id`, `title`, `icon`, `children`, `actions?`.
**Owns:** the focused-panel border and the double-click / `` ` `` maximise.
**Calls:** `store.setActivePanel(id)`, `store.toggleMaximizedPanel(id)`.

### 3.5 `workspace/Splitter.tsx`

Props: `orientation`, `onResize`, `onDoubleClick?`, `storageKey?`.
**Owns:** pointer capture during the drag, the hover highlight, and the
`localStorage` persistence of the resulting size.
Must call `onResize` with the **client** coordinate so the caller can map it
into its own geometry.

### 3.6 `project-bin/ProjectBinPanel.tsx`

**Owns:** the scene list (create / duplicate / rename / delete / activate) and
the asset + SFX vault with drag-to-canvas and drag-to-timeline payloads.
**Calls:** `sceneService`, `assetService`.

Drag payload format (shared with the monitor and the timeline):

```json
{ "assetId": "logo", "kind": "image", "src": "vault:logo.png", "name": "logo.png" }
```

### 3.7 `hierarchy/LayerStackPanel.tsx`

An After Effects style table:

```
👁 👁 solo 🔒 #  ▮ Label   Layer Name        Kind      Track
```

**Owns:** inline rename, visibility, solo, lock, reorder, duplicate, delete.
**Calls:** `store.mutateScene`.

Visibility and lock are stored **in the scene** (`visible`, `locked`), not as
UI-only `_hidden` / `_locked` keys — the Phase 1 schema addition exists exactly
so that the Studio can persist them.

### 3.8 `monitor/ProgramMonitorPanel.tsx`

**Owns:** the composition bar (zoom selector, safe guides, checkerboard) and
the `mf-runtime://app/index.html` iframe.
**Calls:** `postMessage` for `motionforge:seek / play / pause / updateScene /
initScene / getLayerBounds`.

### 3.9 `monitor/CanvasOverlay.tsx`

**Owns:** the SVG overlay: selection box, 8 resize handles, rotation stem,
centre anchor, marquee, smart guides, and the 60fps drag.
**Rule:** it never writes to the engine directly — it mutates the scene through
the store, and the store schedules the save. During a drag it uses
`updateSceneWithoutHistory` (one history entry per gesture, pushed at gesture
start) and pushes the atomic save on pointer-up.

### 3.10 `monitor/TransportBar.tsx`

**Owns:** the SMPTE readout and the transport buttons.
**Calls:** `store.setPlayhead`, `store.setPlaying`, `store.setPlaybackRate`.

### 3.11 `inspector/ScrubInput.tsx`

A controlled numeric field with a drag-scrub mode. Its contract:

```
value            current number
onChange(v)      called continuously during a drag
onScrubStart()   called once, at the first pixel of movement
onCommit(v)      called once, on release (or on a typed commit)
```

`onScrubStart` is where the undo snapshot is pushed, `onCommit` is where the
atomic save happens. That gives exactly one undo entry and one save per edit.

### 3.12 `inspector/EffectControlsPanel.tsx`

**Owns:** the property inspector. Its content is dynamic per layer kind:

| Accordion | Content |
| --- | --- |
| Layer header | swatch, name input, kind badge, track-lane selector |
| Transform | position %, size, scale %, rotation °, opacity %, quick-align bar, reset |
| Timing | start ms, duration ms, out ms, entrance / exit preset pickers |
| Content & Style | per kind (text / card / chart / code / background) |

With **no** layer selected it shows the **Composition Settings**: title,
resolution, FPS, duration, camera preset, seam transitions.

### 3.13 `timeline/TimelinePanel.tsx`

**Owns:** the SMPTE ruler, the track headers, the clip bars, the razor tool,
the dual-handle trim, the wheel zoom and the vertical scroll.
**Rule:** all geometry is computed from `state.zoom` + `state.panOffset` +
`state.timelineScrollY`; there is no second source of truth.

### 3.14 `timeline/AudioVuMeter.tsx`

Docked on the right edge of the timeline panel. A stereo L/R vertical meter,
`-60 dB … 0 dB`, driven by the audio cues that are live under the playhead.
It is a **projection**, not a WebAudio graph — the deterministic-rendering rule
forbids a `performance.now()`-driven animation path in the runtime, and the
meter is a UI affordance derived from cue positions.

### 3.15 `export/RenderModal.tsx`

**Owns:** the render queue dialog: quality preset, output settings, live
progress, output path.

### 3.16 `modals/ShortcutsModal.tsx` + `modals/HelpDrawer.tsx`

The shortcut map is generated from `services/commands.ts` so it can never drift
from the actual bindings.

---

## 4. Composition root (`App.tsx`)

`App.tsx` is **only** allowed to:

- own the global keyboard-shortcut listener,
- own the debounced auto-save effect,
- own the IPC event subscription,
- lay out the modules.

It must **not** contain feature logic. If `App.tsx` grows past ~250 lines, the
logic belongs in a module.

---

## 5. Rules of the road

1. **One direction of data flow.** UI → action → store → service → engine.
   No component reaches into another component.
2. **No engine access from components.** Only `services/*` may call the bridge.
3. **No direct `setState` with a nested path** from a component — use a named
   store action, so history and dirty-tracking stay consistent.
4. **No emoji.** Icons come from `components/icons/NleIcons.tsx`.
5. **No stubs.** A button that cannot act is not rendered.
6. **No cross-package leakage.** The Studio imports `@motionforge/scene-spec`
   (types + `sanitizeSceneInput`) and nothing else from the monorepo.
