# MotionForge v5.0 Agency Engine — Progress Tracker

Single source of truth for the v5.0 "Headless AI Video Agency Engine" milestone execution.

| ID | Milestone / Feature | Packages Touched | Status | Unit Tests | Typecheck | Benchmark / Verification | Commit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M0 | governance | docs/mcp-evolution, .cursor, .agents, AGENTS.md, CLAUDE.md | COMPLETED | n/a (docs) | n/a (docs) | files present + no-emoji scan + lead fact-check (2 correction rounds) | a3b92d8 |
| M1 | themePreset | scene-spec, scene-runtime | COMPLETED | 8 new (3 files, 29 assertions green) | PASS (6/6 workspaces) | npm test 579/579; no-emoji 139 files; 6 presets x 10 tokens verified | pending (M12) |
| M2 | layoutSlot | scene-spec, scene-runtime | COMPLETED | 10 new (2 files, 31 targeted green) | PASS (6/6 workspaces) | npm test 589/589; no-emoji 140 files; 12 slots, 3-slot zero-overlap + centerStage containment | pending (M12) |
| M3 | deviceMockup + cursorFlow | scene-spec, scene-runtime | COMPLETED | 19 new (2 files, 40 targeted green) | PASS (6/6 workspaces) | npm test 608/608; no-emoji 144 files; 12 kinds verified (browser/macbook/iphone/terminal, waypoints cubic ease) | pending (M12) |
| M4 | bentoGrid + connectorDiagram | scene-spec, scene-runtime | COMPLETED | 12 new (2 new test files, 35 targeted green) | PASS (6/6 workspaces) | npm test 620/620; no-emoji 148 files; 14 kinds verified (glassmorphic bento cards staggered, cubic Bezier connector diagram with pulse) | pending (M12) |
| M5 | metricTicker + comparisonSplit (+ field guide for 16 kinds) | scene-spec, scene-runtime | COMPLETED | 12 new (2 new test files, 37 targeted green) | PASS (6/6 workspaces) | npm test 632/632; no-emoji 152 files; 16 kinds verified (tabular digits cubic count ticker, split comparison with check/cross indicators) | pending (M12) |
| M6 | critique_and_autofix_scene | core-engine, mcp-server | COMPLETED | 5 new (2 files, 38 targeted green) | PASS (6/6 workspaces) | npm test 637/637; no-emoji 153 files; 7 rules, 4-pass overlap, WCAG >= 7:1 auto-fix, 14 MCP tools | pending (M12) |
| M7 | 14 SFX + auto_choreograph_audio | core-engine, scene-spec, mcp-server | COMPLETED | 7 new (2 files, 41 targeted green) | PASS (6/6 workspaces) | npm test 644/644; no-emoji 154 files; 14 clean procedural SFX, 15 MCP tools | pending (M12) |
| M8 | generate_storyboard_from_brief | core-engine, mcp-server | COMPLETED | 9 new (2 files, 44 targeted green) | PASS (6/6 workspaces) | npm test 653/653; no-emoji 155 files; 5 archetypes, zero dead air, score >= 95, 16 MCP tools | pending (M12) |
| M9 | compose_storyboard_video | core-engine, mcp-server | COMPLETED | 7 new (2 files, 43 targeted green) | PASS (6/6 workspaces) | npm test 660/660; no-emoji 156 files; preview / full render, 17 MCP tools | pending (M12) |
| M10 | static-frame dedup + render telemetry | core-engine, scene-runtime | COMPLETED | 10 new (2 files, 10 targeted green) | PASS (6/6 workspaces) | preview: 24 frames, 4 captured + 20 reused, 55.5ms/captured frame; JPEG pipe pre-existed | pending (M12) |
| M11 | flagship benchmark | core-engine, mcp-server | PENDING | pending | pending | pending | pending |
| M12 | report + final gate | docs/mcp-evolution, root | PENDING | pending | pending | pending | pending |

## Milestone Log

### M0: governance
- Established core governance files: `00_MASTER_EXECUTION_PLAN.md`, `01_PROGRESS_TRACKER.md`.
- Authored machine-readable cursor rules: `01-architecture-invariants.mdc`, `02-feature-development-sop.mdc`.
- Created agent skill playbooks: `add-layer-primitive`, `add-mcp-tool`, `engine-performance-guard`, `ai-video-creative-director`.
- Created root `CLAUDE.md` and appended v5.0 operational instructions to `AGENTS.md`.
- Verified zero emoji across all new governance and documentation assets.
- Corrected specification facts per M0-FIX: aligned 6 theme presets, 12 layout slots, 8 new procedural SFX cues, real Chromium launch args, and verified telemetry/schema paths.

### M1: themePreset (2026-10-23)
- Added `packages/scene-spec/src/themes.ts`: six presets, exact token tables, the
  `themePresetSchema`, and a `THEME_CSS_VARS` map whose `bgBlobs` entry expands to the
  three numbered `--mf-bg-blob-*` variables.
- Added `themePreset` to `sceneShapeSchema` (optional — absence stays absence) and exported the
  theme surface from `packages/scene-spec/src/index.ts`.
- Added `applyThemeVars()` / `getThemeCssVars()` in `packages/scene-runtime/src/theme.ts`;
  the runtime applies the variables on `#stage` at mount and clears them on unmount.
- Wired theme fallbacks into `kineticText`, `card`, `cta` and the `background` mesh gradient,
  keeping today's literals as the CSS fallback so an unthemed scene is unchanged.
- Field guide documents `themePreset`, the six preset names and the theming note; the
  layer-kind note is now generated from `LAYER_TYPES` so the count cannot drift.
- Verification: typecheck 6/6, targeted 3 files / 29 tests, full suite 34 files / 579 tests,
  zero-emoji scan 139 files.

### M2: layoutSlot (2026-10-23)
- Added `packages/scene-spec/src/layout-slots.ts`: the 12 fixed boxes and
  `resolveLayoutSlot()` (keyframe > explicit > slot > default).
- `layerBaseSchema` now accepts `layoutSlot`; the sanitizer fills missing position/size and
  records the dotted paths in `SanitizeReport.resolved` without overriding explicit values.
- `resolveTransform()` resolves the same slot box (position and layout size) so a raw layer
  measured outside the engine agrees with the sanitized scene.
- `centerStage` is documented as a container slot; the zero-overlap test covers
  `topHeader` + `topSubhead` + `bottomCenterCta`, and `centerStage` is asserted inside the
  safe margin and around the canvas centre.
- Verification: typecheck 6/6, targeted 3 files / 31 tests, full suite 36 files / 589 tests,
  zero-emoji scan 140 files.

### M3: deviceMockup + cursorFlow (2026-10-23)
- Exported `hexColorSchema` in `packages/scene-spec/src/common.ts` (accepts #38bdf8 / #fff, rejects non-hex / rgb).
- Added `packages/scene-spec/src/layers/device-mockup.ts`: 4 device types (`browser`, `macbook`, `iphone`, `terminal`), 2 themes (`dark`, `light`), 5 content variants (`dashboard`, `code`, `metrics`, `analytics`, `blank`), `headline`, `accentColor`, and `tiltDeg` (rotateX/rotateY restricted to [-35, 35] deg).
- Added `packages/scene-spec/src/layers/cursor-flow.ts`: 3 cursor styles (`macos`, `pointer`, `collaborator`), 3 waypoint actions (`move`, `click`, `hover`), `cursorScale`, `accentColor`, and `waypoints` (1-20 waypoints with `atMs`, `xPct`, `yPct`, `action`, `label`).
- Registered `deviceMockup` and `cursorFlow` in `LAYER_TYPES` (10 -> 12 kinds), `layerSchema`, and field guide with schema-valid examples and registry entries. `deviceMockup` joined `FOREGROUND_LAYER_TYPES`; `cursorFlow` stayed decorative (it cannot close a coverage gap).
- Updated sanitizer in `packages/scene-spec/src/sanitize.ts` to stably sort cursor waypoints by `atMs` into `SanitizeReport.healed`.
- Added runtime renderers:
  - `packages/scene-runtime/src/layers/device-mockup.ts`: authentic frame rendering for browser (traffic lights + URL pill), macbook (camera dot + hinge base), iphone (notch / dynamic island + rounded frame), and terminal (prompt marker + monospace output), with deterministic UI variants and `tiltDeg` applied strictly to the inner frame.
  - `packages/scene-runtime/src/layers/cursor-flow.ts`: vector SVG cursor silhouettes, cubic ease-in-out waypoint interpolation (`t < 0.5 ? 4t^3 : 1 - (-2t + 2)^3 / 2`), scale dipping to 0.82 with dual expanding ripple rings on click, soft accent halo on hover, and floating label pills driven via `ctx.tl`.
- Verification: typecheck 6/6 workspaces PASS, targeted 3 files / 40 tests green, full suite 38 files / 608 tests green, zero-emoji scan 144 files clean.

### M4: bentoGrid + connectorDiagram (2026-10-23)
- Added `packages/scene-spec/src/layers/bento-grid.ts`: `BENTO_COLUMNS` (2, 3), `bentoCellSchema` (`title`, `subtitle`, `metricValue`, `badge`, `spanCols` 1-3, `accentColor`), and `bentoGridLayerSchema` (`columns` 2|3 default 3, `cells` 2-6, `staggerMs` 0-600 default 110).
- Added `packages/scene-spec/src/layers/connector-diagram.ts`: `diagramNodeSchema` (`id`, `label`, `sublabel`, `xPct` 5-95, `yPct` 5-95, `accentColor`), `diagramEdgeSchema` (`from`, `to`, `label`, `animatedPulse` default true), and `connectorDiagramLayerSchema` (`nodes` 2-8, `edges` 1-12).
- Enforced cross-field validation in `sceneSpecSchema.superRefine`: unique node IDs within connectorDiagram layer, and edge `from`/`to` references resolving to declared nodes with paths `layers.<i>.edges.<j>.from` / `.to`.
- Registered `bentoGrid` and `connectorDiagram` in `LAYER_TYPES` (12 -> 14 kinds), `layerSchema`, and field guide with schema-valid examples and registry entries. Both joined `FOREGROUND_LAYER_TYPES` in `packages/scene-spec/src/coverage.ts`; `cursorFlow` joined `FULL_BLEED_LAYER_TYPES` so the critic never treats the overlay as an overlap.
- Updated sanitizer in `packages/scene-spec/src/sanitize.ts` to clamp `spanCols` to `columns` and record in `SanitizeReport.clamped`.
- Added runtime renderers:
  - `packages/scene-runtime/src/layers/bento-grid.ts`: CSS grid with `repeat(columns, 1fr)`, glassmorphic cards with 1px gradient accent border, badge pills, metric values in headline font, subtitles in body font, and deterministic staggered entrance (cell i starts at `at + i * staggerMs`, 0.45s `power2.out` tween on inner cell).
  - `packages/scene-runtime/src/layers/connector-diagram.ts`: SVG canvas sized to stage with `0 0 100 100` viewBox and `preserveAspectRatio="none"`, HTML node cards absolutely positioned at `(xPct, yPct)` with `translate(-50%, -50%)` inner wrapper, cubic Bezier edges with horizontal/vertical bias and `stroke-dashoffset` animation over 0.6s, Bezier midpoint edge labels, and glowing pulse circles driven by `registerSeekable` and timeline driver with jsdom geometry guard.
- Verification: typecheck 6/6 workspaces PASS, targeted 3 files / 35 tests green, full suite 40 files / 620 tests green, zero-emoji scan 148 files clean.

### M5: metricTicker + comparisonSplit (2026-10-23)
- Added `packages/scene-spec/src/layers/metric-ticker.ts`: `metricTickerLayerSchema` (`label`, `fromValue` finite default 0, `toValue` finite, `prefix` default "", `suffix` default "", `decimals` 0-4 default 0, `countDurationMs` 200-10000 default 1600, `deltaBadge`, `accentColor`).
- Added `packages/scene-spec/src/layers/comparison-split.ts`: `comparisonSplitLayerSchema` (`leftTitle`, `leftItems` 1-6, `rightTitle`, `rightItems` 1-6, `leftAccent` default "#ef4444", `rightAccent` default "#10b981", `vsBadge` default "VS").
- Registered `metricTicker` and `comparisonSplit` in `LAYER_TYPES` (14 -> 16 kinds), `layerSchema`, exported from `packages/scene-spec/src/index.ts`, and joined `FOREGROUND_LAYER_TYPES` in `packages/scene-spec/src/coverage.ts`.
- Completed full 16-kind field guide audit in `packages/scene-spec/src/field-guide.ts`: added `summary`, audited required keys, defaults, nested shapes, and valid asset-free examples across all 16 layer types. Drift guard `field-guide.spec.ts` verifies `summary`, `required`, `optional`, and schema validity for all 16 kinds.
- Added runtime renderers:
  - `packages/scene-runtime/src/layers/metric-ticker.ts`: uppercase label, giant number with tabular figures and monospace font, optional delta pill with accent tint rising in at `layerAtSec + 0.25s`, deterministic cubic easing count (`1 - (1 - p)^3`) registered via `ctx.registerSeekable` and driven by timeline scrubber.
  - `packages/scene-runtime/src/layers/comparison-split.ts`: glass card with two columns, negative cross SVG indicators with `leftAccent` and positive check SVG indicators with `rightAccent`, row stagger entrance at `layerAtSec + 0.08 * rowIndex` (opacity and `translateX(±14px) -> 0`, 0.35s `power2.out` on inner elements only), and central `vsBadge` pill with back.out scale pop at `layerAtSec + 0.15s`.
- Verification: typecheck 6/6 workspaces PASS, targeted 3 files / 37 tests green, full suite 42 files / 632 tests green, zero-emoji scan 152 files clean.

### M6: critique_and_autofix_scene (2026-10-23)
- Added `packages/core-engine/src/scene-critic.ts`:
  - Seven critique rules: `FOREGROUND_OVERLAP` (> 400 px^2 intersection), `SAFE_MARGIN_VIOLATION` (outside 4%..96% safe zone, excluding entrance/exit), `LOW_CONTRAST` (WCAG < 4.2:1 against active background base), `DEAD_AIR_FRAME` (0 visible foreground layers), `VISUAL_CLUTTER` (> 6 visible foreground layers), `TIMING_OVERFLOW` (window or keyframe past scene duration), `RENDER_COST_HAZARD` (`FILTERED_LAYER_LARGE_SCALE`).
  - Deterministic sampling: 5 evenly spaced timestamps in `[250, durationMs - 250]` plus midpoint of every foreground content layer's active window, deduplicated, sorted, capped at 40 samples.
  - Deterministic scoring: 100 minus rule deductions (overlap 15 per pair, margin 10 per layer, contrast 12 per layer, dead air 8 per timestamp, clutter 6 per timestamp, timing 20 per layer, cost 10 per warning), clamped to 0..100.
  - 6-step auto-fix solver: 4-pass vertical/horizontal overlap separation (>= 3% gap inside [8, 92]%), safe margin position clamp and scale reduction, contrast adjustment to >= 7:1 (lightening on dark bg, darkening on light bg), dead air window extension, cost hazard scale clamping (<= 3.5), timing overflow duration clamping and past-duration keyframe dropping.
- Added `EngineCore.critiqueAndAutofixScene(sceneId, options)` in `packages/core-engine/src/engine-core.ts`: loads scene, runs bounds query on warm page, evaluates issues, applies fixes, saves fixed scene, re-evaluates and returns `CritiqueReport`.
- Forwarded in `packages/mcp-server/src/engine-client.ts` and registered MCP tool `critique_and_autofix_scene` in `packages/mcp-server/src/tools.ts` with input schema `{ sceneId, autoApplyFixes, sampleTimesMs }`, expanding MCP surface to 14 tools (`TOOL_NAMES`).
- Verification: typecheck 6/6 workspaces PASS, targeted 2 files / 38 tests green (`scene-critic.test.ts` 4/4, `tools.test.ts` 34/34), full suite 43 files / 637 tests green, zero-emoji scan 153 files clean.

### M7: 14 SFX + auto_choreograph_audio (2026-10-23)
- Extended `SFX_NAMES` in `packages/scene-spec/src/audio.ts` with 8 new procedural sound effects: `typingTick`, `mouseClick`, `notificationChime`, `bassDrop`, `glitchHit`, `softSwoosh`, `counterTick`, `ambientPad` (14 total).
- Implemented 8 deterministic FFmpeg synthesis graphs in `packages/core-engine/src/sfx-bank.ts` (48 kHz stereo, seeded noise, clean lowpass filtering, exact millisecond durations).
- Added `choreographSceneAudio` and `EngineCore.autoChoreographAudio` in `packages/core-engine`:
  - Full cue mapping across all 14 bank entries (opening bassDrop + shimmer, layer entrance cues, interactive cursor clicks and hovers, terminal extra typingTick, ending riser, ambientPad bed).
  - Deduplication: suppresses identical SFX within 120 ms window, recording dropped events into `skipped[]`.
  - Gain scaling with `masterGain` clamped to 0..2, optional ambient bed toggle, and non-destructive `overwriteExisting` cue retention with stable IDs (`cue-<index>`).
- Forwarded in `packages/mcp-server/src/engine-client.ts` and registered MCP tool `auto_choreograph_audio` in `packages/mcp-server/src/tools.ts`, expanding the MCP tool registry to 15 tools (`TOOL_NAMES`).
- Verification: typecheck 6/6 workspaces PASS, targeted 2 files / 41 tests green (`audio-choreography.test.ts` 6/6, `tools.test.ts` 35/35), full suite 44 files / 644 tests green, zero-emoji scan 154 files clean.

### M8: generate_storyboard_from_brief (2026-10-23)
- Added `packages/core-engine/src/storyboard-generator.ts`:
  - Defined `BriefMetric`, `BriefFeature`, `StoryboardBrief`, `StoryboardSceneSummary`, `StoryboardReport` interfaces and Zod schemas (`storyboardBriefSchema`, `briefMetricSchema`, `briefFeatureSchema`).
  - Deterministic slug generator `slug(projectTitle)` (lowercase, non-alphanumerics to '-', trimmed, max 40 chars, fallback to 'storyboard').
  - Normalization helpers: `normalizeMetrics` (at least 2, max 4 points), `normalizeFeatures` (at least 4, max 6 items), and `parseMetricNumber` (extracts numeric values, prefix, suffix, decimals with 99.9 fallback).
  - 5 distinct scene archetypes: `hook` (background meshGradient + kineticText + metricTicker + bentoGrid), `product` (deviceMockup + connectorDiagram + codeBlock + card + cursorFlow with 2 clicks), `proof` (comparisonSplit + chart + cta), `features` (bentoGrid + kineticText + card), `close` (metricTicker + comparisonSplit + cta + kineticText).
  - Mandatory lead layout decisions: explicit disjoint containers keeping every foreground layer non-overlapping and inside 4%..96% safe margins across all 5 archetypes.
  - Integration with `critiqueAndAutofixScene` (evaluating layout/contrast/clutter/timing/costs) and `autoChoreographAudio` (cues across 14-bank SFX).
  - Manifest generation with `"fade"` transitions between scenes and `"cut"` on the final scene.
- Added `EngineCore.generateStoryboardFromBrief(brief)` in `packages/core-engine/src/engine-core.ts` and exported from `packages/core-engine/src/index.ts`.
- Forwarded in `packages/mcp-server/src/engine-client.ts` and registered MCP tool `generate_storyboard_from_brief` in `packages/mcp-server/src/tools.ts` with prose summary and `structuredContent`, expanding the MCP surface to 16 tools (`TOOL_NAMES`).
- Verification: typecheck 6/6 workspaces PASS, targeted 2 files / 44 tests green (`storyboard-generator.test.ts` 8/8, `tools.test.ts` 36/36), full suite 45 files / 653 tests green, zero-emoji scan 155 files clean.

### M9: compose_storyboard_video (2026-10-23)
- Added `packages/core-engine/src/storyboard-composer.ts`:
  - Defined types: `ComposeTransition` (`cut | fade | wipeleft | slideright | smoothleft | circleopen`), `ComposeSceneInput`, `ComposeInput`, `ComposeSceneResult`, `ComposeReport`, `StoryboardPlan`, and Zod schemas (`composeInputSchema`, `composeSceneInputSchema`, `composeTransitionSchema`).
  - Implemented pure planner `planStoryboardCompose(input, durations)`: computes `totalDurationMs`, `totalDurationSec`, every xfade video offset (seconds, 3 decimals), and validates `transitionDurationMs < min(adjacent scene durations) - 100` (rejecting transitions longer than adjacent scenes, treating cuts as 0 timeline overlap).
  - Implemented sequential rendering in `StoryboardComposer.compose`: renders scenes strictly one at a time via `RenderRunner.enqueue` awaiting `completed` or `failed` events to protect 3.8 GB RAM / 1 Chromium budget.
  - Probes every segment (`probeMedia`), enforces geometry consistency (outWidth, outHeight, fps match), normalizes missing audio streams with temp `anullsrc` inputs, and stitches via concat demuxer (when all transitions are cuts and audio is present) or FFmpeg `filter_complex` (`xfade` + `acrossfade` chains, with cut microfades).
- Added `EngineCore.composeStoryboardVideo(input)` in `packages/core-engine/src/engine-core.ts`:
  - Maintains `private readonly composeJobs = new Map<string, RenderJob>()`.
  - Updated `getRenderStatus(jobId)` to check `composeJobs` first, enabling existing `get_render_status` and `get_render_result` to inspect finished compose jobs.
  - Supports `wait: false` by immediately returning `{ jobId, status: "running" }` and executing composition in the background with progress reporting and error handling.
- Forwarded in `packages/mcp-server/src/engine-client.ts` and registered MCP tool `compose_storyboard_video` in `packages/mcp-server/src/tools.ts` with schema validation, prose telemetry, and `structuredContent` (`ComposeReport` for wait:true, `{ jobId, status }` for wait:false), bringing the server tool surface to 17 tools (`TOOL_NAMES`).
- Unit and integration tests in `packages/core-engine/tests/storyboard-composer.test.ts`:
  - Unit 1: offset math for [2, 2] + fade 0.5 -> total 3.5, offset 1.5.
  - Unit 2: three scenes [2, 3, 2] with fades [0.5, 0.25] -> total 6.25, offsets 1.5 and 4.25.
  - Unit 3: rejection of transition duration >= min(adjacent) - 100.
  - Unit 4: cut between segments preserving total = sum of durations.
  - Integration 5: end-to-end rendering and stitching of two 2-second scenes with 500 ms fade at preview quality, probe assertions for 3.5s +/- 0.15, H.264 video, AAC audio, and file size > 10 KB.
  - Integration 6: `wait: false` background job lifecycle, status polling, output verification, and `getRenderResult` probe verification.
- Verification: typecheck 6/6 workspaces PASS, targeted 2 files / 43 tests green (`storyboard-composer.test.ts` 6/6, `tools.test.ts` 37/37), full suite 46 files / 660 tests green, zero-emoji scan 156 files clean.

### M10: static-frame reuse + render telemetry (2026-10-23)
- Added `packages/scene-runtime/src/frame-signature.ts` and published
  `window.getSceneFrameSignature(timeMs)`. The signature is deliberately
  conservative: it rejects active or imminent transitions, camera motion,
  future keyframes, non-static layer kinds, visibility changes, and auto-exit
  fades. Static signatures are currently limited to settled `kineticText`,
  `imageLogo`, `cta`, `deviceMockup`, and solid backgrounds.
- Added `plans: Map<string, MotionSlotPlan>` to `BuiltScene` so the runtime and
  renderer share the same lifecycle windows.
- Updated the renderer to evaluate the signature before each capture, reuse the
  previous JPEG only for consecutive identical signatures, and report
  `capturedFrames`, `reusedStaticFrames`, and `captureMsPerFrame` through
  `RenderJob` and `RenderResultReport`.
- Chunk telemetry is aggregated per worker; each new Chromium page resets its
  previous frame buffer and signature. `EngineCore.closeWarmPage()` is called
  before renders and storyboard composition to preserve the one-Chromium memory
  envelope.
- The JPEG image pipe was already present before M10 and was intentionally left
  unchanged at the measured 70/80/92 preview/draft/production quality ladder.
- Verification: runtime signature tests 9/9, isolated preview render test 1/1;
  24 total frames produced 4 captures and 20 static reuses at 55.5ms per
  captured frame, with a full-duration 2-second MP4.
