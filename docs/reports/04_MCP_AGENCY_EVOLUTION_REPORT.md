# MotionForge v5.0 Agency Engine — Final Evolution Report

**Date:** 2026-10-23  
**Scope:** M0–M12  
**Branch:** `feat/v5-agency-engine`

## Executive result

MotionForge v5.0 now exposes a production MCP surface for autonomous video
agency workflows: 17 tools, 16 declarative layer kinds, six themes, 12 layout
slots, and 14 procedural SFX cues. The real stdio flagship benchmark authored,
critiqued, rendered, and inspected a three-scene showcase in an isolated
workspace and completed with `EXIT=0`.

## Milestone ledger

| Milestone | Result |
| --- | --- |
| M0 governance | Completed: execution plan, tracker, agent rules, skills, and fact-checked hardware/render invariants. |
| M1 themePreset | Completed: six presets with schema, runtime CSS variables, field guide, and drift tests. |
| M2 layoutSlot | Completed: 12 slots, deterministic resolution precedence, sanitizer defaults, and containment tests. |
| M3 deviceMockup + cursorFlow | Completed: four device variants, deterministic cursor waypoints, runtime renderers, and tests. |
| M4 bentoGrid + connectorDiagram | Completed: validated cells/nodes/edges, Bezier connectors, pulse animation, and tests. |
| M5 metricTicker + comparisonSplit | Completed: 16-kind field-guide audit, deterministic ticker, comparison indicators, and tests. |
| M6 critique_and_autofix_scene | Completed: seven deterministic critique rules and non-destructive autofix passes. |
| M7 audio choreography | Completed: 14 procedural cues and `auto_choreograph_audio`. |
| M8 storyboard generation | Completed: brief-to-storyboard generation across five archetypes with scoring and dead-air checks. |
| M9 storyboard composition | Completed: sequential multi-scene composition with transitions, audio, probe, and background-job support. |
| M10 static-frame reuse | Completed: literal encoder contract (preview=85, draft=94, production=98), conservative frame signatures, reuse write telemetry (<1ms), and throughput proof. |
| M11 flagship benchmark | Completed: real 17-tool MCP stdio session, `generate_storyboard_from_brief` probe, exact audio timestamp assertions, and isolated three-scene master render. |
| M12 final gate | Completed by the sequential verification suite (typecheck, build, 672 tests, zero-emoji, flagship benchmark EXIT=0). |

## Flagship benchmark evidence

`node scripts/benchmark-agency-mcp-masterpiece.cjs` verified:

- exactly 17 advertised MCP tools;
- six theme presets and the complete 16-kind layer union;
- two uploaded asset fixtures: SVG logo and 60-frame Lottie JSON;
- `generate_storyboard_from_brief` invoked in the real MCP stdio session (latency `1144ms`), synthesizing three scenes with perfect scores (`100, 100, 100`), total duration `12000ms`, `linearMinimal` design tokens, and a complete 3-scene transition manifest;
- critique recovery from `53` to `100` on an intentionally broken scene;
- zero post-autofix issues on all three showcase scenes;
- the complete 14-cue SFX union across all scenes;
- literal scheduled timestamp verification for all required cues:
  - `ambientPad` at `0ms` (ambient stereo bed);
  - `whoosh` at `0ms` (`kineticText` entrance);
  - `counterTick` at `150ms` (`metricTicker` and `chart` offsets);
  - `typingTick` at `200ms` (`codeBlock` offset) and `350ms` (terminal `deviceMockup` offset);
  - `mouseClick` at `1800ms` and `2800ms` (`cursorFlow` waypoint click times);
  - `notificationChime` at `100ms` (`cta` offset);
- three sequential four-second scenes rendered with one worker each;
- H.264 video (`1280x720 @ 30fps`, High profile) plus AAC audio (`48kHz stereo`, LC profile), measured master duration `11.232s`, size `574926` bytes;
- six non-empty stills at `1s`, `3s`, `5s`, `7s`, `9s`, and `11s`;
- non-silent audio windows at `0.0s` (`-18.9 dB`), `3.6s` (`-22.6 dB`), and `7.2s` (`-22.2 dB`);
- no OOM or process-killed diagnostics; final output `EXIT=0`.

The benchmark uses `scripts/lib/test-env.cjs` conventions under
`/tmp/motionforge-bench-<pid>` and removes the workspace unless `--keep` is
provided.

## M10 telemetry and performance

The M10 encoder contract has been implemented literally:
- `page.screenshot` fast JPEG piping using quality ladder:
  - `preview`: `jpegQuality = 85` (`640x360 @ 12fps`);
  - `draft`: `jpegQuality = 94` (`1280x720 @ 30fps`);
  - `production`: `jpegQuality = 98` (`1920x1080 @ 60fps`).
- FFmpeg encodes via `-f image2pipe -framerate <fps> -c:v mjpeg -i pipe:0`, perfectly matching MJPEG streaming with zero disk writes.
- The isolated static-frame test suite (`static-frame-reuse.test.ts`) deterministically proved:
  - **Preview:** 24 total frames produced 4 fresh captures and 20 static-frame reuses (~83% reuse ratio). Captured frame time averaged ~45-55ms, while static reuse write latency (`reuseMsPerFrame`) measured `< 0.5ms` (far below the 5ms threshold). The effective per-frame render time dropped to `< 12ms`, proving a > 4x throughput speedup compared with full capture.
  - **Draft:** 60 total frames produced 8 captures and 52 static-frame reuses (~87% reuse ratio) with `jpegQuality = 94`. Reuse writes remained `< 0.5ms` with duration exactly 2.0s.
  - Telemetry fields (`capturedFrames`, `reusedStaticFrames`, `captureMsPerFrame`, `reuseMsPerFrame`) are reported in `ParallelRenderResult`, `RenderJobResult`, and MCP tool responses.

The flagship composition was intentionally dynamic to stress-test every layer kind, reporting 360 captured frames and zero reused frames at `111.58ms` average capture time per frame. The renderer maintains the strict single-Chromium sequential lifecycle and resets the frame signature buffer at each new render page or chunk.

## Known deviations

1. The flagship benchmark composition uses draft quality (`1280x720 @ 30fps`, `jpegQuality = 94`) to keep the end-to-end verification gate bounded on the 2 vCPU / 3.8 GB RAM reference host. Master production rendering (`1920x1080 @ 60fps`, `jpegQuality = 98`, ABR rate control) is fully tested and supported by the same encoder pipeline.
2. The flagship scene set is intentionally dynamic across all 16 layer types, so its zero reuse count is expected; static-frame deduplication and throughput speedup are proven deterministically by the isolated M10 test suite.

## Verification gate

The final gate is recorded by the sequential commands:

```text
npm run typecheck
npm run build
npm test -- --no-file-parallelism
npm run verify:no-emoji
node scripts/benchmark-agency-mcp-masterpiece.cjs
```

All 6 workspaces typechecked clean, all packages built cleanly, all 672 unit/integration tests passed across 48 test files, 157 source files passed zero-emoji verification, and the real MCP stdio flagship benchmark exited with `EXIT=0`.
