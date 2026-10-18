# MotionForge Studio — UI/UX Design System Guide

> **Design Direction: "Cinematic Amber"**  
> A studio-grade aesthetic engineered for desktop-class motion design workflows, merging the warm visual ergonomics of DaVinci Resolve with the surgical micro-precision of Linear and Figma.

---

## 1. Visual Identity & Color Tokens

MotionForge Studio eliminates generic violet hues in favor of a dark, low-fatigue slate canvas punctuated by radiant amber primaries and functional semantic accents.

### 1.1 Surfaces & Backgrounds
Layered near-black surfaces create depth and visual hierarchy while ensuring video previews and keyframe thumbnails remain the brightest objects on screen.

```css
:root {
  --bg-0: #0a0a0f; /* Deepest canvas floor / backdrop */
  --bg-1: #101017; /* Primary workspace panels & toolbars */
  --bg-2: #18181f; /* Elevated cards, inspect inputs, tabs */
  --bg-3: #22222c; /* Hover surfaces, dividers, active tracks */
  --bg-4: #2c2c38; /* Pressed controls, active border states */
}
```

### 1.2 Borders & Focus States
Borders are kept whisper-thin and low-contrast to avoid cognitive noise, while `:focus-visible` states provide undeniable feedback.

```css
:root {
  --border:        rgba(255, 255, 255, 0.06); /* Standard structural line */
  --border-strong: rgba(255, 255, 255, 0.12); /* Panel headers, active items */
  --border-focus:  #f59e0b;                   /* 2px solid radiant amber outline */
}
```

### 1.3 Accents & Semantics

```css
:root {
  /* Primary: Amber (Main actions, selected layer highlight, timeline playhead) */
  --primary:       #f59e0b;
  --primary-hover: #fbbf24;
  --primary-dim:   rgba(245, 158, 11, 0.12);

  /* Secondary: Teal (Secondary tools, camera tracks, scene indicators) */
  --secondary:       #14b8a6;
  --secondary-hover: #2dd4bf;
  --secondary-dim:   rgba(20, 184, 166, 0.12);

  /* Accent: Rose (Render indicators, alerts, destructive-adjacent CTAs) */
  --accent:       #f43f5e;
  --accent-hover: #fb7185;
  --accent-dim:   rgba(244, 63, 94, 0.12);

  /* Status Tokens */
  --success: #22c55e;
  --warning: #f59e0b;
  --danger:  #ef4444;
  --info:    #3b82f6;
}
```

### 1.4 Layer Type Semantic Mapping
Every layer type is assigned a distinct color signature reflected across layer list badges, inspector headers, and timeline canvas bars:

| Layer Type | Hex Code | Visual Swatch / Role |
| :--- | :--- | :--- |
| `background` | `#52525b` | Neutral zinc (canvas baseline) |
| `imageLogo` | `#f59e0b` | Amber (brand assets, logos, graphics) |
| `kineticText` | `#f43f5e` | Rose (typography animations, kinetic headlines) |
| `card` | `#14b8a6` | Teal (containers, backdrop cards, shapes) |
| `lottie` | `#22c55e` | Green (vector animations, illustrations) |
| `foregroundFX`| `#3b82f6` | Blue (particles, overlays, noise layers) |

---

## 2. Typography Hierarchy

To maintain optical clarity across varying resolutions, MotionForge Studio enforces a strict **3-tier font size system**, completely eliminating tiny 9px/10px micro-text.

| Tier | Size | Weight | Tracking | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Labels & Badges** | `11px` | `500` (Medium) | `0.02em` | Input field labels, status pills, category tags, hotkey hints |
| **Body & Controls** | `13px` | `400` / `500` | `-0.01em` | Text inputs, dropdowns, table cells, toasts, tooltips, buttons |
| **Headers & Titles**| `15px` | `600` (SemiBold) | `-0.02em` | Panel titles, modal headings, section group headers |

- **Font Family (UI)**: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- **Font Family (Code/Timings)**: `JetBrains Mono, ui-monospace, Menlo, monospace` (used for IDs, millisecond values, coordinates, and raw JSON).

---

## 3. Spatial System & Control Metrics

- **Control Height**: Standardized at `28px` to `32px` across buttons, inputs, tabs, and selects for rapid tactile targeting.
- **Grid Gaps**: Section spacing follows a 4px modular rhythm: `4px`, `8px`, `12px`, `16px`, `24px`, and `32px`.
- **Radii**:
  - `--radius-sm: 4px` (Inputs, buttons, badges)
  - `--radius: 6px` (Cards, panels, tabs)
  - `--radius-lg: 10px` (Modals, command palette, toast notifications)
  - `--radius-xl: 14px` (Overlays, dialog containers)

---

## 4. Motion & Micro-Interactions

- **Timing Function**: High-precision snappy cubic bezier: `cubic-bezier(0.16, 1, 0.3, 1)`
- **Duration**: `140ms` for hover transitions, active state shifts, tab switches, and collapse toggles.
- **Modal Transitions**: `180ms` spring fade with backdrop blur (`backdrop-filter: blur(8px)`).
- **Focus Rings**: Interactive elements never hide outlines without replacement; `:focus-visible` applies a crisp `2px solid var(--border-focus)` with a `1px` offset.

---

## 5. Core Component Specifications

### 5.1 Command Palette (`Ctrl+K` / `⌘K`)
- Fullscreen backdrop blur with centered 540px elevated dialog.
- Search input with clear button and live category badges (`Layer`, `Action`, `Scene`).
- Keyboard navigable with <kbd>↑</kbd> / <kbd>↓</kbd> arrows, <kbd>Enter</kbd> to execute, and <kbd>Esc</kbd> to dismiss.

### 5.2 Canvas Timeline
- Double-buffered HTML5 canvas operating at a locked 60fps.
- Mouse-anchored horizontal zooming via <kbd>Ctrl+Wheel</kbd>.
- Smooth horizontal panning via <kbd>Space+Drag</kbd> or Middle-Click.
- Layer duration edge resize handles with magnetic snapping to nearby keyframes and playback markers.
- Context menu support for quick action triggers.

### 5.3 Inspector Groups
- Collapsible accordions with persistent open/close states.
- Inline validation checking against Core Engine schema constraints (e.g., duration bounds, font size 8–600px).
- Embedded color pickers with hex inputs and quick-palette swatches.

### 5.4 Toast System
- Stacking bottom-right notifications with automatic timeout and manual dismiss.
- Types: `info`, `success`, `warning`, `error`.
- Actionable undo triggers directly within toasts (e.g., "Layer deleted [Undo]").

### 5.5 Skeletons & Empty States
- Zero blank screens: every empty panel (empty layers, empty render queue, empty assets) renders an SVG iconography badge, a clear human-readable explanation, and an immediate primary CTA button.
