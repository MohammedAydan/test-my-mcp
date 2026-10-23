# MotionForge v5.0 Agency Engine — Progress Tracker

Single source of truth for the v5.0 "Headless AI Video Agency Engine" milestone execution.

| ID | Milestone / Feature | Packages Touched | Status | Unit Tests | Typecheck | Benchmark / Verification | Commit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M0 | governance | docs/mcp-evolution, .cursor, .agents, AGENTS.md, CLAUDE.md | COMPLETED | n/a (docs) | n/a (docs) | files present + no-emoji scan + lead fact-check (2 correction rounds) | a3b92d8 |
| M1 | themePreset | scene-spec, scene-runtime | COMPLETED | 8 new (3 files, 29 assertions green) | PASS (6/6 workspaces) | npm test 579/579; no-emoji 139 files; 6 presets x 10 tokens verified | pending (M12) |
| M2 | layoutSlot | scene-spec, scene-runtime | COMPLETED | 10 new (2 files, 31 targeted green) | PASS (6/6 workspaces) | npm test 589/589; no-emoji 140 files; 12 slots, 3-slot zero-overlap + centerStage containment | pending (M12) |
| M3 | deviceMockup + cursorFlow | scene-spec, scene-runtime, studio | PENDING | pending | pending | pending | pending |
| M4 | bentoGrid + connectorDiagram | scene-spec, scene-runtime, studio | PENDING | pending | pending | pending | pending |
| M5 | metricTicker + comparisonSplit (+ field guide for 16 kinds) | scene-spec, scene-runtime, studio | PENDING | pending | pending | pending | pending |
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
