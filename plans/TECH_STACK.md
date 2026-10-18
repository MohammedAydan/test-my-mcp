# Tech Stack — MotionForge Studio

## Runtime
| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Language | JavaScript (ES2022+) | Native | Strict ESM modules (`<script type="module">`) |
| Runtime | Modern Chromium / Firefox / WebKit | Evergreen | Chrome, Edge, Safari, Firefox |
| Build Tool | None | N/A | Zero-build vanilla architecture |
| Package Manager | None (for UI) | N/A | No npm dependencies in UI shell |

## Frontend
| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Markup | HTML5 | Living Standard | Semantic, accessible ARIA roles |
| Styles | CSS3 | Living Standard | Custom Properties, Flexbox, Grid, backdrop-filter |
| Design System | Cinematic Amber | 1.0 | Custom design tokens (Resolve + Linear + Figma) |
| Typography | Inter, JetBrains Mono | Latest | Inter for UI, JetBrains Mono for timings/IDs |
| Rendering | HTML5 Canvas 2D API | Native | Hardware accelerated 60fps timeline scrub |
| State Management | Custom Vanilla Store | Custom | Reactive Pub/Sub + Undo/Redo stack |
| Network | Fetch API + EventSource (SSE) | Native | REST + Real-time SSE updates |
| Inter-frame Comm | Window.postMessage | Native | Bidirectional preview sync protocol |

## Backend Services
| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Engine Server | Node.js + Fastify | 4.x / Node 20+ | Running on `http://127.0.0.1:4000` |
| Video Pipeline | Playwright + FFmpeg | Latest | Headless Chromium + hardware encoders (NVENC/h264) |
| Scene Runtime | GSAP + Vite | 3.x / 5.x | Deterministic scene animation runner |

## Dev & Verification Tooling
| Tool | Version | Purpose |
|------|---------|---------|
| Playwright | Installed in monorepo | Multi-viewport screenshot & automated visual verification |
| Node HTTP Server | Native Node http / npx serve | Local hosting of studio static assets |
| Git | 2.x | Version control & commit checkpoints |

## Key Conventions
- Architecture: Pure ES Modules with clear folder boundaries (`js/ui/`, `js/panels/`, `js/util/`)
- Formatting: 2 spaces, standard modern JS idioms
- Palette: Amber (`#f59e0b`), Slate backgrounds (`#0a0a0f` to `#2c2c38`), Teal (`#14b8a6`), Rose (`#f43f5e`)
- Spacing Scale: Strictly 4, 8, 12, 16, 24, 32px
- Typography Hierarchy: 11px (labels), 13px (body/default), 15px (section titles)
