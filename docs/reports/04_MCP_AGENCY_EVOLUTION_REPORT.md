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
| M10 static-frame reuse | Completed: conservative frame signatures, JPEG reuse, and render telemetry. |
| M11 flagship benchmark | Completed: real 17-tool MCP stdio session and isolated three-scene master render. |
| M12 final gate | Completed by the verification commands listed below. |

## Flagship benchmark evidence

`node scripts/benchmark-agency-mcp-masterpiece.cjs` verified:

- exactly 17 advertised MCP tools;
- six theme presets and the complete 16-kind layer union;
- two uploaded asset fixtures: SVG logo and 60-frame Lottie JSON;
- critique recovery from `53` to `100` on an intentionally broken scene;
- zero post-autofix issues on all three showcase scenes;
- the complete 14-cue SFX union;
- three sequential four-second scenes rendered with one worker each;
- H.264 video plus AAC audio, measured master duration `11.232s`;
- six non-empty stills and non-silent audio windows at `0.0s`, `3.6s`, and `7.2s`;
- no OOM or process-killed diagnostics; final output `EXIT=0`.

The benchmark uses `scripts/lib/test-env.cjs` conventions under
`/tmp/motionforge-bench-<pid>` and removes the workspace unless `--keep` is
provided.

## M10 telemetry and performance

The isolated static-frame test rendered 24 preview frames with four fresh
captures and 20 static-frame reuses, averaging 55.5ms per captured frame.
Static signatures reject transitions, camera motion, future keyframes,
visibility changes, non-static layers, and automatic exit windows.

The flagship composition was intentionally dynamic and therefore reported 360
captured frames and zero reused frames, at 107.52ms per captured frame. The
renderer keeps the one-Chromium sequential lifecycle and resets the previous
frame buffer at each new render page or chunk.

## Known deviations

1. JPEG frame piping was already present before M10. M10 retained the existing
   quality ladder (`70` preview, `80` draft, `92` production) and added reuse and
   telemetry rather than changing the established encoder contract.
2. The flagship benchmark uses draft quality to keep the verification gate
   bounded on the constrained host. Production rendering remains available via
   the normal `production` quality profile and was not substituted by the
   benchmark.
3. The flagship scene set is intentionally dynamic, so its zero reuse count is
   expected; static reuse is proven separately by the isolated M10 render test.

## Verification gate

The final gate is recorded by the commands run for M12:

```text
npm run typecheck
npm run build
npm test -- --no-file-parallelism
npm run verify:no-emoji
node scripts/benchmark-agency-mcp-masterpiece.cjs
```

The progress tracker is the compact verification ledger; this report is the
human-readable M0–M12 result and deviation record.
