# MotionForge API Documentation

**Version:** 1.0.0 (SceneSpec schemaVersion 1)
**Date:** 2026-10-18

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Engine HTTP API](#core-engine-http-api)
3. [MCP Server Tools](#mcp-server-tools)
4. [SceneSpec Schema](#scenespec-schema)
5. [Creative Project Manifest](#creative-project-manifest)
6. [Asset Vault](#asset-vault)
7. [Render Pipeline](#render-pipeline)
8. [Error Handling](#error-handling)
9. [Quick Start](#quick-start)

---

## Architecture Overview

MotionForge is a **production-grade programmatic motion graphics & video engine** organized as an npm-workspaces monorepo with four packages:

```
packages/
  scene-spec/      @motionforge/scene-spec   — Zod SceneSpec schema + TS types (shared contract)
  core-engine/     @motionforge/core-engine  — Fastify API, assets, Playwright frame renderer, FFmpeg encoder, SFX mixer
  scene-runtime/   @motionforge/scene-runtime — Vite + TS + Tailwind + GSAP browser canvas (DOM/SVG/Lottie layers, camera rig, timeline UI)
  mcp-server/      @motionforge/mcp-server   — Thin MCP wrapper exposing exactly 6 tools, talks to core-engine over HTTP
```

### Key Principles

- **Declarative, not imperative:** Videos are described by a `SceneSpec` JSON + named motion presets
- **Deterministic rendering:** Browser runtime exposes `window.renderConfig`, `window.seekToFrame(n)`, awaits `document.fonts.ready` + image decode
- **Frames never touch disk:** Playwright captures JPEG/PNG buffers in memory and pipes them into FFmpeg stdin
- **Single LLM surface:** Exactly 6 MCP tools — no more, no less
- **Every temporary effect has In/Out envelope:** Must start at identity and return to identity
- **No layout animation on text:** Use `clip-path` masks only

### Ports & Endpoints

| Service | Default Port | Protocol |
|---------|-------------|----------|
| Core Engine HTTP API | 4000 | HTTP/REST |
| Scene Runtime Preview (dev) | 5173 | HTTP (Vite proxy to 4000) |
| MCP Server | N/A | stdio (MCP protocol) |

---

## Core Engine HTTP API

**Base URL:** `http://127.0.0.1:4000` (configurable via `MOTIONFORGE_ENGINE_URL` or `PORT`)

### Health & Identity

#### `GET /api/capabilities`

Returns the complete authoring contract: layer field guides, registries, minimal valid scene, showcase scene, and engine identity.

**Response:** `application/json`

```json
{
  "schemaVersion": 1,
  "units": { "time": "milliseconds", "position": "canvas percent {xPct,yPct}", "size": "design px via *Px keys" },
  "sceneTopLevel": { "required": [...], "optional": [...] },
  "commonLayerRequired": ["id", "type"],
  "commonLayerOptional": [...],
  "layerFieldGuide": { ... },
  "nestedShapeNotes": [...],
  "minimalValidScene": { ... },
  "fullShowcaseSketch": { ... },
  "registries": {
    "layerTypes": [...],
    "backgroundVariants": [...],
    "cardVariants": [...],
    "presets": { "entrance": [...], "emphasis": [...], "exit": [...] },
    "easings": [...],
    "cameraMoves": [...],
    "cameraKeyframeFields": [...],
    "cameraMoveShapes": { ... },
    "transitionShapes": { ... },
    "nestedFieldShapes": { ... },
    "canvas": { "shapes": [...], "scales": [...] },
    "sfxBank": [...],
    "transitions": [...],
    "textRoles": [...],
    "logoMasks": [...],
    "assetKinds": [...]
  },
  "notes": { ... },
  "engine": { "version": "0.1.0", "buildTimestamp": "2026-01-15T10:30:00.000Z", "runtimeBuilt": true }
}
```

### Scene Management

#### `POST /api/scenes`

Validate, asset-resolve, and store a SceneSpec. Returns the stored scene with metadata.

**Request Body:** `SceneSpecInput` (see [SceneSpec Schema](#scenespec-schema))

**Optional Headers:**
- `X-MotionForge-Project: <projectPath>` — enables project asset resolution + disk sync

**Optional Body Field:**
- `projectPath: string` — same as header, for MCP auto-sync

**Response (201 Created / 200 OK):**
```json
{
  "id": "scene-abc123",
  "status": "created|updated",
  "revision": 1,
  "hash": "sha256...",
  "warnings": [
    { "code": "CAMERA_VIEWPORT_EXCEEDS_CANVAS", "path": "camera.keyframes.1.xPct", "message": "...", "detail": {...} }
  ],
  "previewUrl": "http://127.0.0.1:4000/preview/?scene=scene-abc123",
  "scene": { ... },
  "savedSceneFilePath": "/path/to/project/scenes/scene-abc123.json",
  "assetsResolved": [
    { "assetId": "logo", "vaultName": "logo.png", "bytes": 12345, "kind": "image" }
  ]
}
```

**Error Response (400):**
```json
{ "error": "invalid scene", "issues": ["layers.0.variant: Expected object, received string", "layers.1.at: layer starts at or after scene end"] }
```

#### `GET /api/scenes/:id`

Retrieve a stored scene by ID.

**Response (200):** `SceneSpec` object

**Error (404):** `{ "error": "unknown scene \"scene-abc123\"" }`

#### `POST /api/scenes/:id/keyframes`

Render exact frames for visual inspection.

**Request Body:**
```json
{
  "at": [0, 1000, 2000],
  "includeFullResolution": false
}
```

- `at`: Array of timestamps in milliseconds (default: `[0]`)
- `includeFullResolution`: If `true`, returns full-resolution PNG base64 (large!); if `false` (default), returns lightweight JPEG previews

**Response (200):**
```json
{
  "frames": [
    {
      "atMs": 0,
      "image": "data:image/png;base64,...",
      "preview": "data:image/jpeg;base64,...",
      "meta": { ... }
    }
  ],
  "framesMeta": [
    {
      "atMs": 0,
      "camera": { "scale": 1, "xPct": 50, "yPct": 50, "roll": 0, "yaw": 0, "pitch": 0, "clampedVoid": false },
      "activeTransitions": [],
      "layers": [
        { "id": "bg", "type": "background", "lifecyclePhase": "settled", "phaseProgressPct": 100, "opacity": 1, "bbox": {...}, "textOverflow": false }
      ]
    }
  ]
}
```

#### `GET /api/scenes/:id/events`

Server-Sent Events stream for live preview updates. Re-posting a scene pushes an event here.

**Events:** `scene:updated` (empty payload)

---

### Creative Projects (HTTP parity for MCP tool + CLI)

All project routes require `X-MotionForge-Project: <projectPath>` header.

#### `POST /projects/init`

Scaffold a new creative project workspace.

**Request Body:** `InitCreativeProjectOptions`

```json
{
  "name": "client-reel",
  "targetPath": "../jobs/client-reel",
  "language": { "primary": "ar", "secondary": "en" },
  "canvasDefault": { "shape": "16:9", "scale": 1080 },
  "brandColors": { "bg": "#05070d", "accent": "#38bdf8", "text": "#ffffff" },
  "force": false,
  "autoSeedScene": true
}
```

**Response (201):**
```json
{
  "projectPath": "/absolute/path/to/jobs/client-reel",
  "manifest": { ... },
  "initialSceneId": "scene-01",
  "previewUrl": "http://127.0.0.1:4000/preview/?scene=scene-01",
  "filesCreatedCount": 15,
  "seedError": null,
  "operationalChecklist": [...]
}
```

#### `POST /projects/sync`

Store a scene into a project (disk sync + engine store).

**Request Body:**
```json
{ "scene": { ... }, "projectPath": "/path/to/project" }
```

**Response:** Same as `POST /api/scenes`

#### `POST /projects/renders`

File a finished render MP4 into the project and update manifest status.

**Request Body:**
```json
{ "sceneId": "scene-01", "quality": "production", "mp4Base64": "AAAA..." }
```

**Response (201):**
```json
{
  "file": "renders/production/scene-01-1705123456789.mp4",
  "latest": "renders/production/latest.mp4",
  "status": "production",
  "projectRenderFilePath": "/path/to/project/renders/production/latest.mp4"
}
```

#### `POST /projects/stills`

Write captured stills (keyframes) into project's `renders/stills/`.

**Request Body:**
```json
{
  "sceneId": "scene-01",
  "frames": [{ "atMs": 1000, "image": "data:image/png;base64,..." }],
  "framesMeta": [...]
}
```

**Response (201):**
```json
{
  "files": ["renders/stills/scene-01-1000ms.png"],
  "metaFile": "renders/stills/scene-01-frames-meta.json",
  "savedStillsFilePaths": ["/abs/path/renders/stills/scene-01-1000ms.png"],
  "savedFramesMetaFilePath": "/abs/path/renders/stills/scene-01-frames-meta.json"
}
```

---

### Asset Vault

#### `POST /api/assets?filename=<name>`

Upload a binary asset to the vault. Body is raw binary.

**Query:** `filename` (sanitized: alphanumeric, `-`, `_`, `.`)

**Response (201):**
```json
{ "src": "vault:logo.png", "bytes": 12345 }
```

#### `GET /api/assets/vault/:name`

Serve a vault file.

**Response:** Binary file with correct `Content-Type`

#### `GET /api/assets/vault/_sfx/:name`

Serve an SFX file (`.ogg` only, alphanumeric name).

---

### Render Pipeline

#### `POST /api/renders`

Enqueue a render job.

**Request Body:**
```json
{ "sceneId": "scene-abc123", "quality": "draft|production" }
```

**Response (202 Accepted):**
```json
{ "jobId": "job-xyz789", "status": "queued" }
```

#### `GET /api/renders/:jobId`

Poll render job status.

**Response (200):**
```json
{
  "id": "job-xyz789",
  "sceneId": "scene-abc123",
  "quality": "production",
  "status": "running",
  "progress": 0.45,
  "result": null
}
```

**On success:**
```json
{
  "id": "job-xyz789",
  "sceneId": "scene-abc123",
  "quality": "production",
  "status": "succeeded",
  "progress": 1,
  "result": {
    "mp4Path": "/abs/path/data/renders/job-xyz789.mp4",
    "mp4Url": "http://127.0.0.1:4000/api/renders/job-xyz789/file",
    "frames": 1800,
    "wallMs": 45200,
    "effectiveFps": 39.8,
    "encoder": "h264_nvenc",
    "workerCount": 4,
    "profile": { "quality": "production", "fps": 60, "outWidth": 1920, "outHeight": 1080, "jpegQuality": 95 }
  }
}
```

#### `GET /api/renders/:jobId/file`

Stream the finished MP4 (video/mp4).

#### `GET /api/renders/:jobId/file/base64`

Get finished MP4 as base64 (for MCP auto-filing).

**Response:**
```json
{
  "jobId": "job-xyz789",
  "sceneId": "scene-abc123",
  "quality": "production",
  "bytes": 12345678,
  "mp4Base64": "AAAA..."
}
```

---

## MCP Server Tools

The MCP server exposes **exactly 6 tools** via stdio. All tools connect to core-engine at `MOTIONFORGE_ENGINE_URL` (default `http://127.0.0.1:4000`).

### 1. `get_motion_capabilities`

**START HERE.** Returns the complete authoring contract.

**Input:** `{}`

**Output:** Text + JSON (see `GET /api/capabilities`)

**Usage:**
```json
{ "tool": "get_motion_capabilities", "arguments": {} }
```

### 2. `init_creative_project`

Scaffold a complete client-job workspace.

**Input:** `InitCreativeProjectOptions`
```typescript
{
  name: string;                    // project name (1-80 chars)
  targetPath: string;              // absolute or relative path to create project
  language?: { primary: "ar"|"en"|"both", secondary?: "ar"|"en"|"both" };
  canvasDefault?: { shape: "16:9"|"9:16"|"1:1"|"4:5", scale: 720|1080|1440|2160 };
  brandColors?: { bg?: string, accent?: string, text?: string }; // hex colors
  force?: boolean;                 // overwrite non-empty directory
  autoSeedScene?: boolean;         // seed starter scene into engine (default true)
}
```

**Output:** Text with project path, manifest, initial scene ID, preview URL, and checklist.

### 3. `create_or_update_scene`

Validate and store a SceneSpec. **The input schema IS the real strict schema** — unknown keys are rejected.

**Input:** `SceneSpecInput & { projectPath?: string }`

**Key Rules (from field guide):**
- Every layer needs `id` + `type`
- `background.variant` and `card.variant` are **objects** discriminated by `variant`
- Motion is `{ name: <preset> }` in `entrance`/`emphasis`/`exit` — no `preset` field
- Positions are `{ xPct, yPct }`; sizes use `*Px` keys; all times are milliseconds
- Unknown keys are rejected

**Output:** Text with scene ID, revision, hash, preview URL, warnings, and auto-sync path.

### 4. `inspect_scene_keyframes`

Render exact frames for visual verification. **Call BEFORE production render.**

**Input:**
```typescript
{
  sceneId: string;
  at?: number[];              // timestamps in ms (default: [0])
  projectPath?: string;       // enables full-res PNG sync to renders/stills/
  saveStills?: boolean;       // default true when projectPath provided
  includeInlineImages?: boolean; // default true (lightweight JPEG previews)
}
```

**Output:** Inline JPEG previews (≤960px) + `framesMeta` text sidecar (camera pose, transition phase, per-layer lifecycle/opacity/bbox/textOverflow).

**Note:** Full-resolution PNGs + `frames-meta.json` are written to `<projectPath>/renders/stills/` when `projectPath` provided.

### 5. `open_live_timeline_preview`

Open interactive browser preview (play/pause, frame-accurate scrubber, SSE updates).

**Input:** `{ sceneId: string }`

**Output:** `{ "content": [{ "type": "text", "text": "preview: http://127.0.0.1:4000/preview/?scene=..." }] }`

### 6. `render_video`

Render a stored scene to MP4. Blocks until completion.

**Input:**
```typescript
{
  sceneId: string;
  quality: "draft" | "production";
  waitMaxSec?: number;        // default 300
  projectPath?: string;       // auto-file MP4 into project + update manifest
}
```

- **draft:** 720p / 30fps (fast iteration)
- **production:** full canvas (1080p/1440p/2160p) / 60fps

**Output:** Render telemetry + auto-sync confirmation if `projectPath` provided.

---

### MCP Resource

**`motionforge://scenespec/v1`** — Read-only resource with the same authoring digest as `get_motion_capabilities`. Works offline (served from `@motionforge/scene-spec`).

---

## SceneSpec Schema

All fields are strictly validated (unknown keys rejected). All times in **milliseconds**. Canvas positions in **percent** (`{xPct, yPct}`). Sizes in **design pixels** (`*Px` keys).

### Top-Level Structure

```typescript
interface SceneSpec {
  schemaVersion: 1;                    // REQUIRED
  id?: string;                         // optional stable ID (re-posting same ID updates)
  name: string;                        // REQUIRED (1-120 chars)
  canvas: { shape: CanvasShape, scale: CanvasScale }; // REQUIRED
  durationMs: number;                  // REQUIRED (300-600,000 ms)
  assets: Asset[];                     // optional, max 64
  fonts: FontRef[];                    // optional, max 12
  layers: Layer[];                     // REQUIRED, max 40
  camera: Camera;                      // optional, defaults to {}
  transitions: Transition[];           // optional, max 32
  audio: Audio;                        // optional, defaults to {}
}
```

### Canvas

| Shape | Valid Scales | Dimensions (scale) |
|-------|--------------|-------------------|
| `16:9` | 720, 1080, 1440, 2160 | 1280×720, 1920×1080, 2560×1440, 3840×2160 |
| `9:16` | 720, 1080, 1440, 2160 | 720×1280, 1080×1920, 1440×2560, 2160×3840 |
| `1:1` | 1080, 2160 | 1080×1080, 2160×2160 |
| `4:5` | 1080, 2160 | 1080×1350, 2160×2700 |

### Assets

```typescript
interface Asset {
  id: string;                    // alphanumeric + -_
  kind: "image" | "video" | "audio" | "lottie";
  src: string;                   // https://, data:, or vault:
  mime?: string;
  name?: string;
}
```

### Fonts

```typescript
interface FontRef {
  role: "hero" | "headline" | "body" | "accent" | "metric";
  family: string;                // e.g. "Cairo", "Inter"
  provider: "google" | "system"; // default "google"
  weights: number[];             // default [400, 800]
}
```

### Common Layer Fields (all layers)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | **required** | Unique, alphanumeric + `-_` |
| `type` | string | **required** | One of 6 layer types |
| `name` | string | - | Human label |
| `z` | number (0-999) | array order | Stacking order |
| `at` | ms | 0 | Start time |
| `duration` | ms | until scene end | Visible window |
| `direction` | "ltr"\|"rtl" | "ltr" | Reading direction |
| `entrance` | PresetRef | - | Entrance animation |
| `emphasis` | PresetRef | - | Mid-scene emphasis |
| `exit` | PresetRef | - | Exit animation |
| `sfx` | SfxTrigger[] | - | Layer-relative SFX cues |

### PresetRef (motion)

```typescript
{
  name: MotionPreset;           // from registries below
  durationMs?: number;
  delayMs?: number;
  ease?: EasingName | { bezier: [x1,y1,x2,y2] };
  staggerMs?: number;           // for word/char splits
  strength?: number;            // 0.2-2.0, scales preset intensity
}
```

### Layer Types

#### 1. `background` (exactly one recommended)

```typescript
{
  type: "background",
  variant: {
    variant: "solid" | "meshGradient" | "particles" | "media",
    // solid:
    color?: string;              // CSS color
    // meshGradient:
    base?: string;               // default #05070d
    blobs: Array<{
      color: string;
      xPct: number; yPct: number;
      radiusPct: number;         // 5-200
      drift?: number;            // 0-2, default 0.3
    }>;                          // 2-6 blobs
    // particles:
    count?: number;              // 40-600
    color?: string;              // default #8ab4ff
    sizePx?: number;             // 1-12, default 2.5
    speed?: number;              // 0.1-3, default 1
    direction?: "up"|"down"|"radial"|"sideways"; // default "up"
    // media:
    assetId: string;             // declared in assets (image|video)
    blurPx?: number;             // 0-60, default 0
    dimOpacity?: number;         // 0-1, default 0
    kenBurns?: {
      fromScale: number;         // 1-2
      toScale: number;           // 1-2.5
      panFrom?: { xPct, yPct };
      panTo?: { xPct, yPct };
    };
  }
}
```

#### 2. `imageLogo`

```typescript
{
  type: "imageLogo",
  assetId: string,               // declared in assets (kind: image)
  widthPx: number,               // 16-4000
  heightPx?: number,             // optional, preserves aspect if omitted
  position: { xPct, yPct },      // REQUIRED
  mask?: "rect"|"circle"|"squircle"|"hexagon"|"blob", // default "rect"
  cornerRadiusPx?: number,       // 0-400
  shadow?: { color, opacity, blurPx, offsetYpx },
  ring?: { widthPx, color, opacity? },
  glass?: { blurPx, tintColor, tintOpacity },
  glow?: { color, strength },    // 0-2
  lightSweep?: {                 // absolute time
    at: number,
    durationMs?: number,         // default 900
    angleDeg?: number,           // -180 to 180, default 25
    color?: string,              // default #ffffff
    widthFactor?: number         // 0.1-1, default 0.35
  }
}
```

#### 3. `kineticText`

```typescript
{
  type: "kineticText",
  text: string,                  // 1-600 chars
  direction?: "ltr"|"rtl",       // "rtl" for Arabic/Hebrew
  role?: "hero"|"headline"|"body"|"accent"|"metric", // default "headline"
  googleFamily?: string,         // explicit Google Font
  fontWeight?: number,           // 100-900, default 800
  sizePx: number,                // 8-600, REQUIRED
  lineHeight?: number,           // 0.7-2.5, default 1.15
  letterSpacingPx?: number,      // -10 to 60, default 0
  align?: "left"|"center"|"right", // default "center"
  position?: { xPct, yPct },     // default {50,50}
  box?: {
    maxWidthPct: number,         // 10-100, default 70
    paddingPx?: number,          // 0-200, default 0
    chip?: { color, opacity, radiusPx } // optional badge behind text
  },
  fill: string | {               // CSS color OR gradient
    type: "linear",
    angleDeg: number,            // 0-360, default 90
    stops: Array<{ color, at: 0-100, opacity? }>
  },
  stroke?: { color, widthPx },
  shadow?: { color, opacity, blurPx, offsetYpx },
  animateBy?: "word"|"char"|"line", // default "word"
  highlight?: {                  // ONE pill per line (borderless)
    color: string,
    radiusPx?: number,           // default 12
    paddingPx?: number           // default 8
  }
}
```

#### 4. `card`

```typescript
{
  type: "card",
  position: { xPct, yPct },      // REQUIRED
  variant: {
    variant: "glassCard" | "callout" | "progressBar" | "counter",
    // glassCard:
    title?: string, body?: string,
    iconAssetId?: string,        // image asset
    widthPx?, paddingPx?, radiusPx?,
    glass?: { blurPx, tintColor, tintOpacity },
    borderOpacity?: number,      // 0-1, default 0.25
    // callout:
    accentColor: string,         // REQUIRED
    accentSide?: "left"|"right", // default "left"
    title?, body?, widthPx?, paddingPx?, radiusPx?, glass?,
    // progressBar:
    value: number,               // 0-100, REQUIRED (animated to)
    fill: string | gradient,     // REQUIRED
    label?: string,
    trackColor?: string,         // default rgba(255,255,255,0.12)
    heightPx?: number,           // 4-120, default 18
    radiusPx?: number,           // 0-200, default 120
    showPercentage?: boolean,    // default false
    widthPx?: number,
    // counter:
    from: number, to: number,    // REQUIRED
    decimals?: number,           // 0-4, default 0
    prefix?: string, suffix?: string,
    locale?: string,             // BCP-47 e.g. "ar-EG"
    role?: "hero"|"headline"|"body"|"accent"|"metric", // default "metric"
    sizePx?: number              // 12-600, default 120
  }
}
```

#### 5. `lottie`

```typescript
{
  type: "lottie",
  assetId: string,               // declared in assets (kind: lottie)
  widthPx?: number,              // 16-4000
  position: { xPct, yPct }       // REQUIRED
}
```

#### 6. `foregroundFX` (full-frame overlays)

```typescript
{
  type: "foregroundFX",
  effects: Array<                // 1-6 effects
    { kind: "vignette", strength?: 0-1, color?: string } |
    { kind: "filmGrain", opacity?: 0-1, sizePx?: 1-6 } |
    { kind: "colorGrade", warmth?: -1..1, contrast?: -1..1, saturation?: -1..1, tint?: { color, opacity } }
  >
}
```

### Camera

```typescript
{
  perspective?: number,          // 200-4000, default 1200
  drift?: {                      // subtle handheld feel
    amplitudePct: number,        // 0-3
    periodMs: number,            // ms
    seed?: number                // integer
  },
  keyframes: Array<{             // sorted by `at`, inherit unset fields
    at: number,                  // REQUIRED, ms
    ease?: EasingName | { bezier: [4] },
    scale?: number,              // 0.1-6, default 1
    xPct?: number,               // 0-100, default 50
    yPct?: number,               // 0-100, default 50
    roll?: number,               // -360 to 360
    pitch?: number,              // -89 to 89
    yaw?: number                 // -89 to 89
  }>,
  moves: Array<{                 // temporary moves (ramp in/hold/ramp out)
    move: "slowPushIn" | "whipPanLeft" | "whipPanRight" | "shakeImpact" | "focusTarget",
    at: number,                  // ms
    durationMs?: number,         // default varies
    targetLayerId?: string,      // REQUIRED for focusTarget
    strength?: number            // 0.1-3, default 1
  }>
}
```

**Safe Pan Range at Scale `s`:** `xPct`/`yPct` must stay inside `[50/s, 100 - 50/s]` or the frame shows black void. Engine warns `CAMERA_VIEWPORT_EXCEEDS_CANVAS` and runtime clamps automatically.

**Camera Move Shapes:**
| Move | Peak Effect | Envelope |
|------|-------------|----------|
| `slowPushIn` | `+0.12 * strength` scale | ramp-in 28% / hold / ramp-out 28% |
| `whipPanLeft/Right` | `±26 * strength %` horizontal pan | 3-stage ramp |
| `shakeImpact` | Sinusoidal decay on rotation + scale | Sampled decay (snaps in, settles) |
| `focusTarget` | Scale `1.45 * strength` on layer box | Ramp in/hold/ramp out — **returns to pre-move pose** |

### Transitions (scene-level, NOT layers)

**Hard Rule:** AT MOST ONE TRANSITION AT A TIME. Overlapping windows rejected.

```typescript
// wipe
{ kind: "wipe", at: ms, durationMs?: ms (default 700), direction: "left"|"right"|"up"|"down" (default "right"), featherPx?: 0-400 (default 0), color?: string (default #000000) }

// glitch
{ kind: "glitch", at: ms, durationMs?: ms (default 500), intensity?: 0-1 (default 0.6) }

// whipPan
{ kind: "whipPan", at: ms, durationMs?: ms (default 500), direction: "left"|"right" (default "left") }

// morph
{ kind: "morph", at: ms, durationMs?: ms (default 800) }
```

**Transition Shape:** 2-phase bell curve. Midpoint (48-52% for wipe) = full cover = act seam swap. Peak hold ~100ms target. Engine warns `TRANSITION_PEAK_TOO_LONG` if exceeded.

### Audio

```typescript
{
  music?: {                    // vault: audio asset
    assetId: string,
    gain?: 0-2 (default 0.6),
    fadeInMs?: ms (default 0),
    fadeOutMs?: ms (default 0),
    normalize?: boolean (default true)
  },
  cues: Array<{                // absolute timeline cues
    id?: string,
    at: ms,                    // REQUIRED
    sfx: "whoosh"|"pop"|"click"|"subImpact"|"shimmer"|"riser",
    gain?: 0-2 (default 1),
    pan?: -1..1 (default 0)
  }>
}
```

**Layer SFX** (fires at `layer.at + offsetMs`):
```typescript
sfx: [{ sfx: "whoosh", offsetMs?: ms, gain?: 0-2, pan?: -1..1 }]
```

---

## Creative Project Manifest

File: `motionforge.project.json` at project root.

```typescript
interface ProjectManifest {
  schemaVersion: 1;
  name: string;                        // 1-80 chars
  createdAt: string;                   // ISO-8601
  engine: { url: string, preferredQuality: "draft"|"production" };
  canvasDefault: { shape: CanvasShape, scale: CanvasScale };
  language: { primary: "ar"|"en"|"both", secondary?: "ar"|"en"|"both" };
  brand: {
    colors: Record<string, string>;    // hex colors (bg, accent, text, ...)
    logoAssetId: string | null;
  };
  scenes: Array<{
    id: string;                        // scene ID
    file: string;                      // relative path, e.g. "scenes/scene-01.json"
    status: "draft"|"approved"|"delivered"|"production"
  }>;
  workflow: {
    requireInspectBeforeProduction: boolean; // default true
    autoOpenPreview: boolean;               // default true
  };
}
```

### Project CLI Commands

```bash
# Scaffold project
npm run init-project -- --name "client-reel" --path "../jobs/client-reel"

# Push scene to engine + disk sync
npm run sync-scene -- --project ../jobs/client-reel --file scenes/scene-01.json

# Pull finished render
npm run pull-render -- --project ../jobs/client-reel --jobId <id> --quality draft

# Regenerate template scenes from scene-spec
npm run sync-template-scenes
```

---

## Asset Vault

- **Location:** `<engine>/data/vault/`
- **Reference:** `vault:filename` in SceneSpec `assets[]`
- **Upload:** `POST /api/assets?filename=logo.png` (raw binary body)
- **Serve:** `GET /api/assets/vault/logo.png`
- **SFX Bank:** Fixed 6 files in `data/vault/_sfx/` — `whoosh.ogg`, `pop.ogg`, `click.ogg`, `subImpact.ogg`, `shimmer.ogg`, `riser.ogg`
- **Project Assets:** When scene stored with `projectPath`, `<project>/assets/{images,lottie,video,audio,…}/` and `<project>/brand/logo/` are auto-copied into vault on first use.

---

## Render Pipeline

### Quality Profiles

| Quality | Resolution | FPS | Use Case |
|---------|-----------|-----|----------|
| `draft` | 720p (1280×720 for 16:9) | 30 | Fast iteration |
| `production` | Full canvas scale (1080p/1440p/2160p) | 60 | Final delivery |

### Pipeline Stages

1. **Enqueue:** `POST /api/renders` → returns `jobId`
2. **Poll:** `GET /api/renders/:jobId` until `status: "succeeded"`
3. **Download:** `GET /api/renders/:jobId/file` (stream) or `/file/base64` (JSON)
4. **Auto-file (optional):** With `projectPath`, MP4 copied to `renders/<quality>/` and manifest status updated

### Deterministic Rendering

- Playwright launches Chromium, loads `/preview/?scene=<id>`
- Waits for `document.fonts.ready` + all images decoded
- Seeks to exact frame via `window.seekToFrame(n)`
- Captures frame buffer → pipes to FFmpeg stdin (`-f image2pipe`)
- SFX mixed with millisecond `adelay` precision
- No `Date.now()`/`performance.now()` in animation paths

---

## Error Handling

### HTTP Errors

| Status | Meaning |
|--------|---------|
| 200 | OK (scene retrieved, job polled) |
| 201 | Created (scene stored, project init, render filed) |
| 202 | Accepted (render enqueued) |
| 400 | Invalid input (validation issues in `issues[]`) |
| 404 | Not found (scene, job, asset) |
| 409 | Conflict (project directory not empty) |
| 500 | Internal error |

### Validation Error Format

```json
{ "error": "invalid scene", "issues": ["layers.0.variant: Expected object, received string", "camera.keyframes.1.at: must be sorted ascending"] }
```

### EngineError (MCP)

Thrown by engine client, carries:
- `status`: HTTP status (0 = unreachable)
- `message`: Human-readable
- `issues[]`: Field-level validation issues (when available)

**MCP Tool Errors** include full issues list:
```
core-engine 400: invalid scene
3 issue(s) — fix these exact field paths and re-post:
- layers.0.variant: Expected object, received string
- layers.1.position: Required
- assets.0.src: src must start with https://, http://, data: or vault:
Shapes for every field: get_motion_capabilities().layerFieldGuide / .minimalValidScene
```

### Scene Warnings (Non-blocking)

Returned in `warnings[]` on scene store. Runtime auto-corrects but author should fix:

| Code | Meaning |
|------|---------|
| `CAMERA_VIEWPORT_EXCEEDS_CANVAS` | Camera pan would show black void at this zoom |
| `FOREGROUND_COVERAGE_GAP` | Gap >200ms with no visible content (transition bridge needed) |
| `TRANSITION_PEAK_TOO_LONG` | Peak hold >120ms — shorten durationMs |
| `PROJECT_MANIFEST_MISSING` | Scene written but manifest not found (run init-project first) |

---

## Quick Start

### 1. Start Core Engine

```bash
npm install
npm run build -ws
npm run dev -w @motionforge/core-engine
# Engine on http://127.0.0.1:4000
```

### 2. Start MCP Server (in another terminal)

```bash
npm run start -w @motionforge/mcp-server
# Connects to engine at MOTIONFORGE_ENGINE_URL (default :4000)
```

### 3. Author a Scene (via MCP tools)

```json
// 1. Get capabilities
{ "tool": "get_motion_capabilities", "arguments": {} }

// 2. Create project (optional but recommended)
{ "tool": "init_creative_project", "arguments": {
  "name": "my-reel",
  "targetPath": "../jobs/my-reel",
  "language": { "primary": "en" }
} }

// 3. Post minimal scene (copy from capabilities.minimalValidScene)
{ "tool": "create_or_update_scene", "arguments": {
  "schemaVersion": 1,
  "name": "My Scene",
  "canvas": { "shape": "16:9", "scale": 1080 },
  "durationMs": 6000,
  "layers": [
    { "id": "bg", "type": "background", "variant": { "variant": "solid", "color": "#05070d" } },
    { "id": "title", "type": "kineticText", "at": 400, "text": "Hello MotionForge", "sizePx": 96, "position": { "xPct": 50, "yPct": 50 }, "fill": "#ffffff", "entrance": { "name": "smoothSlideUp" } }
  ],
  "projectPath": "../jobs/my-reel"
} }

// 4. Inspect keyframes
{ "tool": "inspect_scene_keyframes", "arguments": {
  "sceneId": "returned-id",
  "at": [0, 1000, 2000, 4000, 6000],
  "projectPath": "../jobs/my-reel"
} }

// 5. Render draft
{ "tool": "render_video", "arguments": {
  "sceneId": "returned-id",
  "quality": "draft",
  "projectPath": "../jobs/my-reel"
} }

// 6. Render production (after approval)
{ "tool": "render_video", "arguments": {
  "sceneId": "returned-id",
  "quality": "production",
  "projectPath": "../jobs/my-reel"
} }
```

### 4. Open Live Preview

```json
{ "tool": "open_live_timeline_preview", "arguments": { "sceneId": "returned-id" } }
```

---

## Registry Reference (Closed Vocabularies)

### Layer Types
`background`, `imageLogo`, `kineticText`, `card`, `lottie`, `foregroundFX`

### Background Variants
`solid`, `meshGradient`, `particles`, `media`

### Card Variants
`glassCard`, `callout`, `progressBar`, `counter`

### Motion Presets

| Entrance | Emphasis | Exit |
|----------|----------|------|
| `springPop` | `pulseGlow` | `scaleDownFade` |
| `smoothSlideUp` | `floatIdle` | `whipOutLeft` |
| `maskRevealWipe` | `lightSweep` | `collapseMask` |
| `elasticScale` | `cameraShakeImpact` | |
| `blurFadeIn` | | |
| `3dFlipIn` | | |

### Easings (GSAP subset + cubic-bezier)
`linear`, `power1.in/out/inOut`, `power2.in/out/inOut`, `power3.in/out/inOut`, `power4.in/out/inOut`, `expo.in/out/inOut`, `circ.in/out/inOut`, `sine.in/out/inOut`, `back.in(1.7)`, `back.out(1.7/2.5/4)`, `back.inOut(1.7)`, `elastic.in(1,0.75)`, `elastic.out(1,0.5/0.75)`, `bounce.in/out`, `steps(12)`, or `{ bezier: [x1,y1,x2,y2] }`

### Camera Moves
`slowPushIn`, `whipPanLeft`, `whipPanRight`, `shakeImpact`, `focusTarget`

### Transitions
`wipe`, `glitch`, `whipPan`, `morph`

### SFX Bank
`whoosh`, `pop`, `click`, `subImpact`, `shimmer`, `riser`

### Font Roles
`hero`, `headline`, `body`, `accent`, `metric`

### Logo Masks
`rect`, `circle`, `squircle`, `hexagon`, `blob`

### Asset Kinds
`image`, `video`, `audio`, `lottie`

### Foreground FX Kinds
`vignette`, `filmGrain`, `colorGrade`

### Canvas Shapes
`16:9`, `9:16`, `1:1`, `4:5`

### Canvas Scales
`720`, `1080`, `1440`, `2160` (shape-dependent)

### Project Languages
`ar`, `en`, `both`

### Project Scene Statuses
`draft`, `approved`, `delivered`, `production`

### Project Qualities
`draft`, `production`

---

## Building an External Interface

To build an official external interface **without modifying original project files**:

1. **Use the HTTP API directly** — all MCP tools are thin wrappers over the core-engine REST endpoints
2. **Consume `GET /api/capabilities`** for the complete authoring contract (or the MCP resource `motionforge://scenespec/v1`)
3. **Validate scenes client-side** using the same Zod schemas (import `@motionforge/scene-spec`)
4. **Handle auto-sync** by passing `projectPath` header/body to scene/render routes
5. **Poll renders** via `GET /api/renders/:jobId`
6. **Serve preview** from `/preview/?scene=<id>` (static runtime bundle)

### Required Dependencies (External)

- **FFmpeg 6.x** with NVENC/AMF hardware encoders
- **Playwright Chromium** (for frame capture)
- **Node.js ≥ 20** (ESM, TypeScript)

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4000 | Core engine HTTP port |
| `MOTIONFORGE_ENGINE_URL` | `http://127.0.0.1:4000` | MCP server → engine connection |

---

## Versioning & Breaking Changes

- **SceneSpec `schemaVersion`**: Incremented on breaking contract changes. Old versions parsed/migrated.
- **MCP Tools**: Fixed at 6 tools. Adding a tool = breaking change (requires docs update).
- **HTTP API**: Stable within major version. New optional fields = non-breaking.

---

*Generated from source: `@motionforge/scene-spec`, `@motionforge/core-engine`, `@motionforge/mcp-server`*