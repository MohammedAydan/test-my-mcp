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
| M6 | critique_and_autofix_scene | core-engine, mcp-server, scene-spec | PENDING | pending | pending | pending | pending |
| M7 | 14 SFX + auto_choreograph_audio | core-engine, scene-spec, mcp-server | PENDING | pending | pending | pending | pending |
| M8 | generate_storyboard_from_brief | core-engine, mcp-server, scene-spec | PENDING | pending | pending | pending | pending |
| M9 | compose_storyboard_video | core-engine, mcp-server | PENDING | pending | pending | preview / full render | pending |
| M10 | static-frame dedup + JPEG piping | core-engine, scene-runtime | PENDING | pending | pending | pending | pending |
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
