# MotionForge Studio

> **Desktop-class motion graphics workstation for programmatic and visual authoring.**  
> Powered by the MotionForge Core Engine (`:4000`) with a pure vanilla ES Module frontend, bidirectional preview synchronization, and the "Cinematic Amber" design system.

---

## 1. Quick Start

### Prerequisites
- Node.js 18+ (for serving static assets and running Core Engine)
- MotionForge Core Engine active at `http://127.0.0.1:4000`

### Running the Studio UI
Start the local studio server:
```bash
node scripts/serve.cjs
```
The studio interface will open and be accessible at:
```
http://127.0.0.1:5174
```

Alternatively, open `index.html` via any modern static file server (e.g. `npx serve -l 5174`).

---

## 2. Visual Identity — "Cinematic Amber"

MotionForge Studio features a custom studio-grade palette inspired by DaVinci Resolve, Linear, and Figma.

| Surface / Accent | Color Hex | Role |
| :--- | :--- | :--- |
| **Canvas Floor** | `#0a0a0f` | Deep dark slate backdrop |
| **Panels** | `#101017` | Workspace cards, toolbars, inspector |
| **Primary Accent** | `#f59e0b` | Radiant Amber (Active selections, playhead, primary CTAs) |
| **Secondary Accent** | `#14b8a6` | Teal (Camera, scene elements, indicators) |
| **Accent / Destructive** | `#f43f5e` | Rose (Renders, alerts, kinetic text) |

For complete token specifications, see [docs/05_UI_UX_GUIDE.md](docs/05_UI_UX_GUIDE.md).

---

## 3. Architecture & File Structure

MotionForge Studio is authored in 100% vanilla JavaScript (ES Modules) with zero build step, zero bundler dependencies, and native browser performance:

```
test-1/
├── index.html                   # Semantic HTML app shell (ARIA-compliant)
├── styles.css                   # Cinematic Amber CSS variables & component styles
├── app.js                       # Studio initialization coordinator
├── js/
│   ├── api.js                   # REST client + SSE subscriber + binary asset uploader
│   ├── state.js                 # Central reactive store with 50-step undo/redo stack
│   ├── util/
│   │   ├── dom.js               # DOM query, builder, and debounce utilities
│   │   ├── time.js              # Timecode formatting and parsing
│   │   └── validate.js          # Client-side SceneSpec schema validators
│   ├── ui/
│   │   ├── toast.js             # Stacking actionable notifications
│   │   ├── modal.js             # Accessible modal dialog system
│   │   ├── tooltip.js           # Universal 400ms hover tooltip manager
│   │   ├── command-palette.js   # Ctrl+K fuzzy launcher across layers & actions
│   │   ├── onboarding.js        # First-run 5-step interactive tour
│   │   └── shortcuts.js         # Hotkey dispatcher and '?' modal reference
│   └── panels/
│       ├── layers.js            # Layer management (reorder, duplicate, lock, hide)
│       ├── inspector.js         # Grouped collapsible property inspector with validation
│       ├── capabilities.js      # Engine capabilities browser
│       ├── timeline.js          # 60fps HTML5 canvas timeline (zoom, pan, snap, context menu)
│       ├── preview.js           # Bidirectional postMessage preview synchronizer
│       ├── assets.js            # Asset vault browser with drag-and-drop upload
│       ├── render-queue.js      # Background render tracking and polling
│       └── templates.js         # Scene generator with starter templates
├── screenshots/                 # Multi-viewport Playwright verification screenshots
│   ├── verification-1440x900.png
│   ├── verification-1920x1080.png
│   ├── verification-2560x1440.png
│   └── ...
├── scripts/
│   ├── serve.cjs                # Minimal static HTTP server with correct ES MIME types
│   └── test-ui.cjs              # Playwright automated test suite (19/19 tests)
└── docs/
    ├── 03_UI_REDESIGN_PLAN.md   # Architectural redesign plan and API gap analysis
    ├── 04_UI_KEYBOARD_SHORTCUTS.md # Comprehensive keyboard shortcuts guide
    └── 05_UI_UX_GUIDE.md        # UI/UX design tokens and component standards
```

---

## 4. Key Capabilities

- **Bidirectional Preview Synchronization**: Scrubbing the timeline or clicking playhead markers dispatches `motionforge:seek`, `motionforge:play`, and `motionforge:pause` events to the GSAP runtime in the preview iframe, eliminating desync.
- **50-Step Undo / Redo**: Every mutation (property edit, layer addition, deletion, reorder) is tracked in an undo/redo stack (<kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Shift+Z</kbd>) with descriptive toasts.
- **Command Palette (<kbd>Ctrl+K</kbd>)**: Jump to any layer, trigger render jobs, inspect keyframes, switch themes, or load demo scenes instantly.
- **Desktop Timeline**: HTML5 canvas timeline with <kbd>Ctrl+Wheel</kbd> zoom, <kbd>Space+Drag</kbd> pan, magnetic edge snapping, and right-click context menus.
- **Asset Vault & Upload**: Upload PNG/JPG/SVGs directly to the Core Engine asset vault with automatic thumbnail previews and drag-and-drop support.
- **Render Queue**: Track ongoing draft and production render jobs in the background with live progress bars and direct MP4 downloads.
- **Multi-Scene Tabs**: Switch between scenes seamlessly with dirty indicators and keyboard switching.

---

## 5. Visual Verification & Automated Testing

The entire UI is tested against a comprehensive Playwright automation suite verifying responsive layout stability, zero console errors, layer selection, inspector updates, command palette execution, and shortcuts overlay across 3 standard viewports:

- **1440 × 900** (Standard Laptop)
- **1920 × 1080** (Desktop Full HD)
- **2560 × 1440** (QHD Ultrawide / Studio Display)

Run the test suite locally:
```bash
node scripts/test-ui.cjs
```
All 19 automated tests pass with 0 errors.

---

## 6. Keyboard Shortcuts

Press <kbd>?</kbd> in the application or see [docs/04_UI_KEYBOARD_SHORTCUTS.md](docs/04_UI_KEYBOARD_SHORTCUTS.md) for the complete reference.
