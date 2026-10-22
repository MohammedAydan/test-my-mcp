# Master Execution Plan: MotionForge v5.0 "Headless AI Video Agency Engine"

## 1. Executive Summary & Vision

MotionForge v5.0 evolves the engine from a programmatic motion graphics renderer and desktop NLE into a fully autonomous, headless AI Video Agency Engine. Operating over Model Context Protocol (MCP) and programmatic CLI interfaces, v5.0 enables language models to act as end-to-end creative directors: translating unformatted client briefs into multi-scene commercial video spots, orchestrating professional art direction, resolving typographic and layout hierarchies, synthesizing Foley sound effects, and compiling broadcast-grade MP4 exports.

The architecture preserves all core invariants established in v3.0 and v4.0:
- Dependency direction remains strictly one-way (`mcp-server -> core-engine -> scene-spec` and `scene-runtime -> scene-spec`).
- Declarative scene definition via strict Zod schemas with zero runtime dependencies beyond Zod in `@motionforge/scene-spec`.
- Deterministic browser-driven rendering via Playwright and GSAP v3 timelines where frames never touch disk during export.
- **In-Process EngineCore (Zero HTTP Servers):** `mcp-server` and `studio` communicate with `core-engine` directly in-process via `createEngineCore()`. There is no HTTP listener in `core-engine` or `mcp-server`; `EngineConfig.port` is vestigial and the legacy project kit still substitutes an `ENGINE_URL` default into its templates.

---

## 2. End-to-End System Data Flow

The v5.0 agency pipeline executes sequentially across seven discrete stages to transform an unstructured brief into a broadcast-ready deliverable:

```
+---------------------------------------------------------------------------------------------------+
|                                     Client / User Brief                                           |
|       "30-second high-energy product launch for an AI-powered developer CLI called OctoFlow"      |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|               Storyboard Generator (generate_storyboard_from_brief)                               |
|               - Decomposes brief into multi-scene creative narrative                              |
|               - Assigns pacing, narrative arc, durations, and asset placeholders                  |
|               - Computes scene-to-scene emotional cadence and visual variety                      |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|               Theme & Layout Slot Resolver (themePreset & layoutSlot)                             |
|               - Resolves 6 Theme Presets (appleKeynoteDark, linearMinimal, stripeVibrant, etc.)   |
|               - Maps 12 Layout Slots (heroCenter, splitLeft, splitRight, etc.) to canvas space    |
|               - Binds design tokens: color ramps, typography, radii, spacing, and safe zones      |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|               16 Agency Layer Primitives (SceneSpec Contract)                                     |
|               - 10 Existing: background, imageLogo, kineticText, card, lottie,                    |
|                              foregroundFX, chart, codeBlock, particleField, cta                   |
|               - 6 New Agency: deviceMockup, cursorFlow, bentoGrid, connectorDiagram,              |
|                               metricTicker, comparisonSplit                                       |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|               Autonomous Art Director & Auto-Fix Solver (critique_and_autofix_scene)              |
|               - Evaluates contrast, visual hierarchy, temporal collisions, text bounds            |
|               - Executes multi-pass deterministic heuristic solver to resolve layout violations   |
|               - Iterates until Scene Quality Score >= 95 / 100                                    |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|               Auto-SFX Choreographer (auto_choreograph_audio)                                     |
|               - Analyzes layer lifecycles (entrance, exit, emphasis) and transition midpoints     |
|               - Choreographs 14 procedural SFX cues (whoosh, pop, click, subImpact, riser, etc.)  |
|               - Applies ducking, loudness normalization, and millisecond adelay mixing            |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|               Multi-Scene FFmpeg Xfade Sequencer (compose_storyboard_video)                       |
|               - Renders constituent scenes via bounded single-Chromium workers                    |
|               - Executes FFmpeg xfade transition filtergraph (fade, wipeleft, slideright, etc.)   |
|               - Encodes unified audio track with seamless cross-scene transitions                 |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                  Master MP4 (Deliverable)                                         |
|                 Broadcast H.264 / AAC export with temporal film grain & audio mix                 |
+---------------------------------------------------------------------------------------------------+
```

---

## 3. Hardware Execution Envelope & Invariants

MotionForge v5.0 is rigorously engineered to execute inside a constrained baseline environment:
- **Compute:** 2 vCPU cores.
- **Memory:** 3.8 GB RAM maximum budget.
- **GPU:** Zero GPU acceleration. Software rasterisation is the host default (headless Chromium, no GPU flags requested; launch args: `--disable-lcd-text`, `--font-render-hinting=none`, `--force-device-scale-factor=1`, `--hide-scrollbars`).
- **Concurrency:** Strictly **ONE** Chromium instance active across the entire operating system at any moment.

### Operating Rules Under Hardware Constraints:
1. **Sequential Browser Operations:** Keyframe inspections (`inspect_scene_keyframes`), layer bounds telemetry queries (`get_layer_bounds`), and video frame render runs (`render_video`) must execute sequentially. The engine locks browser access through promise chains (`warm-page.ts` and `RendererPool`).
2. **Warm Page Lifetime:** Layout analysis and keyframe inspection share a single warm browser page (`warm-page.ts`). The page is booted once with empty state and mounts scenes dynamically via `window.mountSceneFromHost`. Layout inspection never rasterises (`window.seekToFrameForLayout`).
3. **Chunked Surface Flush:** For video rendering on hosts with <= 6 GB RAM, heavy scenes render in bounded chunks of 60 frames (`HEAVY_SCENE_PIXEL_FRAME_BUDGET = 60 * 1280 * 720`). The browser process terminates after each chunk to release all unmanaged Skia raster surfaces and GPU memory back to the OS kernel before starting the next chunk.
4. **Zero-Disk Rendering:** Playwright extracts PNG/JPEG frame buffers directly in memory and streams them through Node child process stdin pipes into FFmpeg (`-f image2pipe`). Frames never touch physical or virtual disk. Only client-facing keyframe deliverables are written to disk.

---

## 4. Comprehensive Inventory Targets

| Category | Baseline (v4.0) | v5.0 Target | Additions / Delta |
| --- | --- | --- | --- |
| **MCP Tools** | 13 tools | **17 tools** | +4: `critique_and_autofix_scene`, `auto_choreograph_audio`, `generate_storyboard_from_brief`, `compose_storyboard_video` |
| **Layer Kinds** | 10 kinds | **16 kinds** | +6: `deviceMockup`, `cursorFlow`, `bentoGrid`, `connectorDiagram`, `metricTicker`, `comparisonSplit` |
| **Theme Presets** | 0 presets (manual) | **6 presets** | `appleKeynoteDark`, `linearMinimal`, `stripeVibrant`, `vercelMonochrome`, `emeraldFintech`, `editorialLight` |
| **Layout Slots** | 0 slots (freeform) | **12 slots** | `heroCenter`, `topHeader`, `topSubhead`, `bottomSubhead`, `bottomCenterCta`, `splitLeft`, `splitRight`, `gridTopLeft`, `gridTopRight`, `gridBottomLeft`, `gridBottomRight`, `centerStage` |
| **Procedural SFX** | 6 cues | **14 cues** | +8: `typingTick`, `mouseClick`, `notificationChime`, `bassDrop`, `glitchHit`, `softSwoosh`, `counterTick`, `ambientPad` |

### Detailed Inventory Specifications

#### 17 MCP Tools (Protocol Surface)
1. `get_motion_capabilities`: Returns scene schemas, motion vocabularies, theme presets, layout slots, and minimal valid examples.
2. `init_creative_project`: Scaffolds a disk-synced client project workspace.
3. `create_or_update_scene`: Validates, sanitizes, and stores a `SceneSpec` in the persistent scene store.
4. `inspect_scene_keyframes`: Renders millisecond-accurate inspection stills with metadata sidecars.
5. `open_live_timeline_preview`: Launches an interactive browser preview session.
6. `render_video`: Queues or synchronously renders a scene to MP4.
7. `render_scene`: Canonical alias for `render_video`.
8. `get_layer_bounds`: Sub-second telemetry query returning bounding boxes without rasterisation.
9. `get_render_status`: Queries async progress and state for queued render jobs.
10. `get_render_result`: Fetches finished export paths, file size, and ffprobe stream metadata.
11. `analyze_scene`: Pre-flight report covering render cost, keyframe density, and potential performance risks.
12. `upload_asset`: Ingests binary assets (images, SVGs, Lottie, audio) into the vault.
13. `project_asset_manifest`: Queries assets currently mapped to the active project.
14. `critique_and_autofix_scene` *(v5.0 M6)*: Analyzes composition quality against design heuristics and auto-resolves defects.
15. `auto_choreograph_audio` *(v5.0 M7)*: Automatically maps procedural SFX cues and music bed to visual scene events.
16. `generate_storyboard_from_brief` *(v5.0 M8)*: Decomposes creative brief text into a multi-scene structured storyboard.
17. `compose_storyboard_video` *(v5.0 M9)*: Sequentially renders storyboard scenes and splices them with FFmpeg transitions.

#### 16 Layer Primitives
1. `background`: Flat, linear/radial/mesh gradient, or media backdrops.
2. `imageLogo`: Bitmap and SVG logos with border, shadow, and fit modes.
3. `kineticText`: Typographic engine supporting stagger, split by word/char, and RTL text.
4. `card`: Container cards with solid, glassmorphism, or bordered variants.
5. `lottie`: Vector animations parsed via lottie-web.
6. `foregroundFX`: Post-processing overlays (film grain, vignette, letterbox, color grading).
7. `chart`: Animated bar, line, and donut data visualizations.
8. `codeBlock`: Formatted syntax-highlighted code editors with typing and cursor effects.
9. `particleField`: Ambient floating particles, dust, and grid nodes.
10. `cta`: Call-to-action buttons with animated badges, icons, and shine sweeps.
11. `deviceMockup` *(v5.0 M3)*: 3D-angled or flat modern laptop, phone, and browser chrome shells with viewport clipping.
12. `cursorFlow` *(v5.0 M3)*: Vector pointer simulating realistic user navigation, click ripples, drag interactions, and trails.
13. `bentoGrid` *(v5.0 M4)*: Modern multi-cell asymmetric grid container with responsive slot animations and auto-layout.
14. `connectorDiagram` *(v5.0 M4)*: Flowchart node network with animated SVG bezier pathways, pulse pulses, and data packets.
15. `metricTicker` *(v5.0 M5)*: Rolling animated counters for numerical metrics (e.g., "$10M+", "99.9%") with prefix/suffix.
16. `comparisonSplit` *(v5.0 M5)*: Before/after interactive split-screen with moving wipe divider line and dual content viewports.

#### 6 Theme Presets
Exact order (see `packages/scene-spec/src/themes.ts`):
1. `appleKeynoteDark`: bg `#05070e`, accent `#38bdf8`
2. `linearMinimal`: bg `#08090c`, accent `#6366f1`
3. `stripeVibrant`: bg `#0a0f24`, accent `#818cf8`
4. `vercelMonochrome`: bg `#000000`, accent `#ffffff`
5. `emeraldFintech`: bg `#041311`, accent `#10b981`
6. `editorialLight`: bg `#f8fafc`, accent `#2563eb`

#### 12 Layout Slots
The 12 layout slots (exact):
1. `heroCenter`
2. `topHeader`
3. `topSubhead`
4. `bottomSubhead`
5. `bottomCenterCta`
6. `splitLeft`
7. `splitRight`
8. `gridTopLeft`
9. `gridTopRight`
10. `gridBottomLeft`
11. `gridBottomRight`
12. `centerStage`

*Note on layout composition:* `centerStage` is a central CONTAINER slot that intentionally overlaps `topSubhead` / `bottomCenterCta`; the disjoint triple is `topHeader` + `topSubhead` + `bottomCenterCta`.

#### 14 Procedural SFX Cues
The 6 existing bank cues plus 8 new procedural sound effects (cues and intended use):
1. `shimmer`: ambient pad swell
2. `riser`: air swell
3. `whoosh`: air pass
4. `subImpact`: sub-bass thud
5. `pop`: tactile UI tap
6. `click`: tactile UI click
7. `typingTick`: typing burst
8. `mouseClick`: UI click
9. `notificationChime`: glassy chime
10. `bassDrop`: sub-bass drop
11. `glitchHit`: digital stutter
12. `softSwoosh`: airy swoosh
13. `counterTick`: tick cascade
14. `ambientPad`: loopable pad at gain 0.18

---

## 5. Phase-by-Phase Execution Plan

### Phase 0: Governance, Architecture & Agent Skills (Milestone M0)
- **Goal:** Establish contracts, architectural invariants, automated linting gates, and agent development playbooks.
- **Deliverables:**
  - `docs/mcp-evolution/00_MASTER_EXECUTION_PLAN.md`: Complete blueprint and execution roadmap.
  - `docs/mcp-evolution/01_PROGRESS_TRACKER.md`: Single source of truth milestone tracker initialized M0-M12.
  - `CLAUDE.md`: Operational brief for AI coding agents.
  - `AGENTS.md`: Updated with v5.0 targets and tool rewordings.
  - `.cursor/rules/`: Architecture invariants (`01-architecture-invariants.mdc`) and development SOP (`02-feature-development-sop.mdc`).
  - `.agents/skills/`: Four complete operational skills (`add-layer-primitive`, `add-mcp-tool`, `engine-performance-guard`, `ai-video-creative-director`).
- **Target Files:** Root documentation, `.cursor/`, `.agents/`.

### Phase 1: Theme Engine & Layout Slots (Milestones M1 & M2)
- **Milestone M1 (Theme Engine):**
  - Schema definition for `themePresetSchema` in `@motionforge/scene-spec` supporting 6 themes (`appleKeynoteDark`, `linearMinimal`, `stripeVibrant`, `vercelMonochrome`, `emeraldFintech`, `editorialLight`).
  - Colour, typography, card background/border token mapping in `packages/scene-spec/src/themes.ts`.
  - Normalization in `sanitize.ts` and integration into `field-guide.ts`.
  - Runtime application in `packages/scene-runtime/src/theme.ts` binding CSS custom properties to `#stage`.
- **Milestone M2 (Layout Slots):**
  - `layoutSlotSchema` in `@motionforge/scene-spec` with 12 slot configurations (`heroCenter`, `topHeader`, `topSubhead`, `bottomSubhead`, `bottomCenterCta`, `splitLeft`, `splitRight`, `gridTopLeft`, `gridTopRight`, `gridBottomLeft`, `gridBottomRight`, `centerStage`).
  - Pure layout solver `resolveLayoutSlot(layer: PlacementInput)` computing percentage bounds `{ position: { xPct?, yPct? }, size: { widthPct?, heightPct? }, used }`. Note that `centerStage` is a central CONTAINER slot that intentionally overlaps `topSubhead` / `bottomCenterCta`; the disjoint triple is `topHeader` + `topSubhead` + `bottomCenterCta`.
  - Normalization in `sanitize.ts` allowing layers to specify `layoutSlot` instead of raw coordinates.
  - Verification in `makeFrameDescriber()` (`packages/scene-runtime/src/scene-builder.ts` / `index.ts`) confirming calculated layer bboxes match slot bounds.

### Phase 2: Six New Layer Primitives (Milestones M3, M4, M5)
- **Milestone M3 (Device Mockup + Cursor Flow):**
  - `deviceMockup`: SVG/CSS modern laptop, smartphone, and browser chrome shells with nested iframe/image clipping.
  - `cursorFlow`: deterministic waypoint interpolator (cubic ease-in-out) for pointer travel, click dips and dual shockwave rings, with optional hover labels.
  - Schemas in `packages/scene-spec/src/layers/device-mockup.ts` and `cursor-flow.ts`.
  - Renderers in `packages/scene-runtime/src/layers/`.
- **Milestone M4 (Bento Grid + Connector Diagram):**
  - `bentoGrid`: 2-3 column glassmorphic cell grid with 1-2 column spans and deterministic staggered entrance (`cellIndex * staggerMs`).
  - `connectorDiagram`: Dynamic node network with animated SVG bezier curves and traveling pulse signals.
  - Schemas in `packages/scene-spec/src/layers/bento-grid.ts` and `connector-diagram.ts`.
  - Renderers in `packages/scene-runtime/src/layers/`.
- **Milestone M5 (Metric Ticker + Comparison Split & Field Guide 16):**
  - `metricTicker`: Smooth numerical rolling counter with ease curves, prefixes, and suffixes.
  - `comparisonSplit`: dual-column before/after comparison card with negative/positive SVG indicators, central VS badge and staggered row reveals.
  - Field guide expansion in `packages/scene-spec/src/field-guide.ts` documenting all 16 layer types with valid examples.
  - Schema unions updated in `scene.ts` and sanitizer coverage verified in `sanitize.ts`.

### Phase 3: Autonomous Art Director & Auto-Fix Solver (Milestone M6)
- **Milestone M6 (critique_and_autofix_scene):**
  - Heuristic analysis engine in `packages/core-engine/src/scene-critic.ts`:
    - Bounding-box intersections > 400 px2 between simultaneously visible foreground content layers (excluding full-bleed kinds and cursorFlow).
    - Title-safe violations outside the 4%..96% zone, excluding layers mid-entrance/exit.
    - WCAG contrast below 4.2:1 between text and the active background base.
    - Dead-air timestamps with zero visible foreground layers.
    - Clutter timestamps with more than six visible foreground layers.
    - Layer windows or keyframes extending past `scene.durationMs`.
    - FILTERED_LAYER_LARGE_SCALE render-cost hazards (scale > 4 on filtered full-frame layers).
  - Seven rules: `FOREGROUND_OVERLAP`, `SAFE_MARGIN_VIOLATION`, `LOW_CONTRAST`, `DEAD_AIR_FRAME`, `VISUAL_CLUTTER`, `TIMING_OVERFLOW`, `RENDER_COST_HAZARD`.
  - Auto-fix solver: 4-pass overlap separation (>= 3% gap, positions kept in 8..92%), safe-margin clamp, contrast raised to >= 7:1, dead-air window extension, filtered-layer scale clamp (4.0 -> 3.5), timing clamp.
  - EngineCore method `critiqueAndAutofixScene(sceneId, options)`.
  - In-process forwarding in `packages/mcp-server/src/engine-client.ts`.
  - MCP Tool `critique_and_autofix_scene` registered in `packages/mcp-server/src/tools.ts` returning structured score and diff.

### Phase 4: Sound Studio, Auto-SFX & Multi-Scene Sequencer (Milestones M7, M8, M9)
- **Milestone M7 (14 SFX Bank + auto_choreograph_audio):**
  - Expand `packages/core-engine/src/sfx-bank.ts` with 8 new procedural sound synthesis graphs (14 total).
  - Audio choreography solver (implementation file chosen at M7; `autoChoreographAudio` is an EngineCore method):
    - Scans layer entrance/exit timestamps and transition peaks.
    - Cue map: opening 0-150 ms (`bassDrop`/`shimmer` 0.55); kineticText entrance (`whoosh`/`softSwoosh` 0.65); card/bentoGrid/comparisonSplit (`pop`/`softSwoosh` 0.6); codeBlock/terminal (`typingTick` at start+200, 0.55); chart/metricTicker (`counterTick` at start+150, 0.5); cursorFlow clicks (`mouseClick` at `waypoint.atMs`, 0.75); cta (`notificationChime` at start+100, 0.65); ending (`riser` at duration-1400, 0.45); ambient bed gain 0.18; 120 ms per-cue deduplication window.
    - Generates audio cue events with appropriate SFX kinds and gain levels.
  - EngineCore method and MCP tool `auto_choreograph_audio`.
- **Milestone M8 (generate_storyboard_from_brief):**
  - Storyboard narrative generator in `packages/core-engine/src/storyboard-generator.ts`.
  - sceneCount 2..5; three archetypes: hook + metrics, interactive product, proof + CTA.
  - EngineCore method and MCP tool `generate_storyboard_from_brief`.
- **Milestone M9 (compose_storyboard_video):**
  - Multi-scene compositor in `packages/core-engine/src/storyboard-composer.ts`.
  - Renders constituent scenes sequentially via bounded single-Chromium workers.
  - Compiles intermediate video segments into a master MP4 using FFmpeg `xfade` (`cut | fade | wipeleft | slideright | smoothleft | circleopen`) and `acrossfade` audio transitions.
  - EngineCore method and MCP tool `compose_storyboard_video`.

### Phase 5: Render Engine Optimization (Milestone M10)
- **Milestone M10 (Static-Frame Deduplication & JPEG Piping):**
  - `window.getSceneFrameSignature(timeMs)` in `packages/scene-runtime/src/index.ts`; reused in `packages/core-engine/src/render-runner.ts`.
  - If a frame is mathematically identical to the previous frame (no active tweens, no procedural shaders), reuse the previously encoded buffer rather than capturing a new Playwright buffer.
  - Optimize memory transport by piping JPEG buffers instead of PNG when quality profile is `draft` or `preview`. JPEG quality 85 (preview) / 94 (draft); production stays PNG at quality 98.
  - Telemetry: `capturedFrames`, `reusedStaticFrames`, `captureMsPerFrame`.
  - Measurable throughput increase on CPU-constrained hosts without visual degradation.

### Phase 6: Flagship Benchmark & Stress Verification (Milestone M11)
- **Milestone M11 (Flagship Commercial Benchmark):**
  - Author a flagship THREE-scene / TWELVE-second commercial test suite exercising all 16 layer primitives, 6 theme presets, 12 layout slots, and 14 SFX cues, with the exact per-scene layer list from the specification. Six inspection stills at t = 1, 3, 5, 7, 9, 11 s.
  - Execute end-to-end rendering on 2 vCPU / 3.8 GB RAM environment.
  - Assert zero OOM kills, strict single-Chromium concurrency, and complete audio-visual synchronization.

### Phase 7: Final Governance Gate & Ecosystem Release (Milestone M12)
- **Milestone M12 (Report & Final Gate):**
  - Compile final benchmark telemetry report: `docs/reports/04_MCP_AGENCY_EVOLUTION_REPORT.md`.
  - Execute complete verification suite:
    - `npm run typecheck -ws` across all six workspaces.
    - `npm run build -ws`.
    - `npm test` across all workspaces.
    - `node scripts/verify-no-emoji.cjs` zero-emoji scan.
    - Then the benchmark script.
  - Note: `npm run verify:pro-nle` is NOT part of this gate (it requires a display and tests v3/v4 Studio UX, not v5.0 agency features); run it separately if desired.

---

## 6. Real Module Map & Codebase Landing Sites

```
packages/
  scene-spec/
    src/
      layers/                <-- [Phase 2] New schemas: device-mockup.ts, cursor-flow.ts,
                             |   bento-grid.ts, connector-diagram.ts, metric-ticker.ts,
                             |   comparison-split.ts
      themes.ts              <-- [Phase 1] 6 Theme Presets schema and token dictionaries (target M1)
      layout-slots.ts        <-- [Phase 1] 12 Layout Slots schema and coordinate resolver (target M2)
      scene.ts               <-- [Phase 1, 2] Root schema: LAYER_TYPES union, theme/slot registrations
      sanitize.ts            <-- [Phase 1, 2] Sanitizer healing for new layers, themes, slots
      field-guide.ts         <-- [Phase 1, 2] LLM authoring guidance & examples for all 16 layers
      contracts.ts           <-- [Phase 3, 4] Report schemas for critique, storyboard, sequence

  scene-runtime/
    src/
      layers/index.ts        <-- renderLayer switch — the ONLY renderer registration point
      layers/<kind>.ts       <-- [Phase 2] Deterministic f(timeMs) DOM/SVG renderers for 6 new layers
      scene-builder.ts       <-- [Phase 1, 2] buildScene + makeFrameDescriber telemetry for primitives
      index.ts               <-- [Phase 1, 2] window.describeFrame, layerBoundsReport, seekToFrameForLayout
      theme.ts               <-- [Phase 1] CSS variable injector applying active theme tokens (target M1)
      transform.ts           <-- placement/keyframe resolution
      stage.ts

  core-engine/
    src/
      sfx-bank.ts            <-- [Phase 4] 14 procedural SFX synthesis definitions
      scene-critic.ts        <-- [Phase 3] Art director analysis and auto-fix solver (target M6)
      storyboard-generator.ts <-- [Phase 4] Creative brief decomposition engine (target M8)
      storyboard-composer.ts <-- [Phase 4] Multi-scene FFmpeg xfade transition compositor (target M9)
      render-runner.ts + renderer.ts <-- [Phase 5] Static frame dedup and buffer streaming
      engine-core.ts         <-- [Phase 3, 4] EngineCore API domain method bindings

  mcp-server/
    src/
      engine-client.ts       <-- [Phase 3, 4] In-process client bindings for 4 new tools
      tools.ts               <-- [Phase 3, 4] MCP tool registration (17 tools total)

  studio/
    src/
      state/store.ts         <-- Type union updates ensuring NLE compatibility
      components/            <-- Minimal fallback rendering so Studio remains clean
```

---

## 7. Risks & Mitigation Strategies

### Risk 1: Memory Exhaustion on 3.8 GB RAM Hardware
- **Failure Mode:** Playwright Chromium instances accumulating unmanaged WebGL/Skia render surfaces during 1080p rendering, leading to Linux kernel OOM kills.
- **Mitigation:**
  - Strict chunking: limit rendering batches to `HEAVY_SCENE_PIXEL_FRAME_BUDGET` (60 frames @ 720p).
  - Explicit process termination: close and restart the browser instance between chunks to flush OS memory.
  - Worker concurrency cap: `computeWorkerBudget()` forces `workerCount = 1` whenever system RAM is <= 4.5 GB.

### Risk 2: Software Rasterisation Bottlenecks
- **Failure Mode:** SwiftShader CPU rasterisation of heavy blur filters and full-screen mesh gradients causes severe per-frame render spikes (> 1500 ms/frame).
- **Mitigation:**
  - `analyze_scene` pre-flight detects and emits `FILTERED_LAYER_LARGE_SCALE` warning when scaled above 4x.
  - Static-frame deduplication (M10) bypasses rendering for static periods.
  - Offload expensive visual effects (e.g., film grain) to FFmpeg post-processing filters (`noise=c0s=...:c0f=t+u`).

### Risk 3: MCP Stdio Pipe Overflows (EPIPE Crashes)
- **Failure Mode:** Returning high-resolution base64 PNG inspection frames directly in the MCP stdio JSON-RPC response exceeds pipe buffers, causing client disconnection and unhandled `write EPIPE` server crashes.
- **Mitigation:**
  - Strictly enforce `PREVIEW_MAX_WIDTH = 960` and `PREVIEW_JPEG_QUALITY = 75` for all inline previews.
  - Master full-resolution PNG stills are saved directly to project disk storage (`renders/stills/`), returning file paths rather than unbounded raw bytes.

### Risk 4: Benchmark CPU & Resource Thrashing
- **Failure Mode:** Attempting to benchmark multiple scenes or run validation suites in parallel starves the 2 vCPU environment, causing timeouts and unstable timing metrics.
- **Mitigation:**
  - The benchmark suite executes browser tasks in strictly serial fashion.
  - Memory and swap metrics are captured before and after each scene run.
