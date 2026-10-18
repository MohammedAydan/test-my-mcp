# MotionForge Studio — Keyboard Shortcuts Reference

> **Desktop-class authoring efficiency.** MotionForge Studio is designed for keyboard-driven precision, mimicking professional non-linear editors (NLEs) and modern design tools like DaVinci Resolve, Linear, and Figma.

---

## 1. Quick Cheat Sheet

Press <kbd>?</kbd> anywhere in the application to bring up the live interactive shortcuts modal with instant fuzzy filtering.

| Shortcut | Action | Scope / Context |
| :--- | :--- | :--- |
| <kbd>Space</kbd> | Play / Pause scene playback | Global (unfocused) |
| <kbd>←</kbd> / <kbd>→</kbd> | Step playhead back / forward 100ms | Global (unfocused) |
| <kbd>Shift</kbd> + <kbd>←</kbd> / <kbd>→</kbd> | Step playhead back / forward 1000ms (1s) | Global (unfocused) |
| <kbd>Home</kbd> / <kbd>End</kbd> | Jump playhead to scene start / end | Global (unfocused) |
| <kbd>Ctrl</kbd> + <kbd>K</kbd> / <kbd>⌘K</kbd> | Open Command Palette | Global |
| <kbd>?</kbd> | Open Keyboard Shortcuts modal | Global (unfocused) |
| <kbd>F</kbd> | Toggle Fullscreen preview mode | Global (unfocused) |
| <kbd>Ctrl</kbd> + <kbd>Z</kbd> / <kbd>⌘Z</kbd> | Undo last mutation (50 steps) | Global (unfocused) |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> | Redo previously undone mutation | Global (unfocused) |
| <kbd>Ctrl</kbd> + <kbd>S</kbd> / <kbd>⌘S</kbd> | Force save scene to Core Engine | Global |
| <kbd>Ctrl</kbd> + <kbd>D</kbd> / <kbd>⌘D</kbd> | Duplicate selected layer | Layer selection |
| <kbd>Ctrl</kbd> + <kbd>C</kbd> / <kbd>⌘C</kbd> | Copy selected layer to clipboard buffer | Layer selection |
| <kbd>Ctrl</kbd> + <kbd>V</kbd> / <kbd>⌘V</kbd> | Paste copied layer at current playhead | Global |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd> | Delete selected layer (undoable) | Layer selection |
| <kbd>Ctrl</kbd> + <kbd>W</kbd> | Close active scene tab | Global |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> | Toggle real-time Performance HUD | Global |
| <kbd>Ctrl</kbd> + <kbd>Wheel</kbd> | Zoom timeline horizontally (mouse-anchored) | Timeline canvas |
| <kbd>Space</kbd> + Drag / Middle-Click | Pan timeline horizontally | Timeline canvas |
| <kbd>Shift</kbd> + Click | Multi-select layers on timeline | Timeline canvas |
| <kbd>Esc</kbd> | Dismiss modal, palette, or active tooltip | Overlays & modals |

---

## 2. Detailed Functional Breakdown

### 2.1 Playback & Transport Controls
- **<kbd>Space</kbd>**: Initiates or pauses 60fps playback. Automatically syncs with the embedded preview iframe via bidirectional `motionforge:play` / `motionforge:pause` postMessage calls.
- **<kbd>←</kbd> and <kbd>→</kbd>**: Nudges the playhead by exactly 100 milliseconds. Ideal for precision keyframe alignment.
- **<kbd>Shift</kbd> + <kbd>←</kbd> and <kbd>Shift</kbd> + <kbd>→</kbd>**: Nudges the playhead by 1.0 second for rapid scrubbing.
- **<kbd>Home</kbd> and <kbd>End</kbd>**: Snaps the playhead directly to `0ms` or `durationMs`.

### 2.2 History & Editing
- **<kbd>Ctrl</kbd> + <kbd>Z</kbd> / <kbd>⌘Z</kbd>**: Steps back through the reactive state history stack (capacity: 50 snapshots). Reverts layer properties, additions, deletions, renames, and timeline repositioning. Triggers an actionable toast indicating what action was undone.
- **<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd>**: Re-applies undone actions.
- **<kbd>Ctrl</kbd> + <kbd>D</kbd>**: Creates a deep-clone of the selected layer with a new unique ID, auto-offset entry time, and registers an undo entry.
- **<kbd>Ctrl</kbd> + <kbd>C</kbd> / <kbd>Ctrl</kbd> + <kbd>V</kbd>**: Copies the active layer payload and pastes a duplicate positioned at the exact current playhead timestamp.
- **<kbd>Delete</kbd> / <kbd>Backspace</kbd>**: Safely deletes the active layer with full undo capability.

### 2.3 Navigation & Tools
- **<kbd>Ctrl</kbd> + <kbd>K</kbd> / <kbd>⌘K</kbd> (Command Palette)**: Launches the blurred modal search palette. Supports instant fuzzy filtering across:
  - **Layers**: Jump directly to and select any layer in the active scene.
  - **Actions**: Trigger render draft, render production, inspect keyframes, toggle preview, reload demo, create new scene.
  - **Scenes**: Switch between open tabs or load known scenes.
- **<kbd>F</kbd> (Fullscreen Preview)**: Maximizes the canvas/iframe preview to the full viewport for client presentations and artifact quality inspections. Press <kbd>Esc</kbd> or <kbd>F</kbd> to return to the studio layout.
- **<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> (Performance HUD)**: Displays live FPS, memory usage, DOM nodes count, and timeline render duration in a floating HUD.

### 2.4 Timeline Interaction
- **Horizontal Zoom**: Hold <kbd>Ctrl</kbd> (or <kbd>⌘</kbd>) while scrolling the mouse wheel over the timeline canvas. Zoom is time-anchored to the mouse cursor position.
- **Horizontal Pan**: Hold <kbd>Space</kbd> and click-drag horizontally, or drag with the middle mouse button.
- **Edge Duration Drag**: Hover over the right edge of any layer bar on the canvas; the cursor changes to `ew-resize`. Dragging resizes the layer's duration with visual snapping.
- **Right-Click Context Menu**: Right-clicking any layer bar brings up a desktop context menu: *Duplicate*, *Delete*, *Lock*, *Hide*, and *Inspect*.

---

## 3. Focus Isolation & Safety Rules

To prevent accidental destructive actions while authoring text:
1. When any `<input>`, `<textarea>`, or `<select>` has focus:
   - <kbd>Space</kbd> enters whitespace as normal and does **not** trigger transport playback.
   - <kbd>Backspace</kbd> / <kbd>Delete</kbd> deletes typed characters and does **not** delete the active layer.
   - <kbd>←</kbd> and <kbd>→</kbd> navigate caret position and do **not** scrub the timeline.
   - <kbd>Ctrl</kbd> + <kbd>Z</kbd> / <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> performs native input undo/redo instead of mutating the scene history stack.
2. <kbd>Ctrl</kbd> + <kbd>K</kbd> and <kbd>Ctrl</kbd> + <kbd>S</kbd> are universally accessible regardless of focus.
