# Project: MotionForge Studio

## Purpose
MotionForge Studio is a desktop-class motion graphics web application for programmatic and visual authoring of video scenes. It connects to the MotionForge core-engine at `:4000`, enabling real-time previewing, timeline scrubbing, multi-layer inspection, dynamic keyframe rendering, asset vault management, and video generation.

## Current Status
- Active feature: desktop-app-remediation (Audit & Remediation Planning Complete)
- Overall health: yellow (Core engine green; Desktop UI/UX requires remediation across 11 areas)
- Last updated: 2026-10-19

## Critical Constraints
- Locked Tech Stack: Electron 31 (`electron-vite`), Solid.js 1.8+, Tailwind CSS 3.4, Kobalte, Canvas 2D
- Pro NLE dark design palette (strict adherence to specified design tokens)
- Security Model: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, typed IPC preload
- Zero test regression: Maintain all 329 backend unit tests and automated E2E tests
- ZERO CODE CHANGES during audit phase (plans and docs only)

## Active Features
- [audit-and-remediation-planning]: Completed exhaustive zero-trust audit reproducing all 11 user complaints with visual screenshot proof (`docs/11_CURRENT_STATE_AUDIT.md`, `docs/12_FEATURE_STATUS_MATRIX.md`). Authored comprehensive remediation plans: `docs/plans/BACKEND_PLAN.md`, `docs/plans/DESKTOP_APP_PLAN.md`, `docs/plans/UI_UX_PLAN.md`, and `docs/13_NEXT_STEPS.md`.
- [desktop-app]: Electron 31 shell and Solid.js UI package built and runnable. Requires remediation of canvas direct manipulation synchronization, timeline vertical scrolling, panel splitters, and multi-clip track lane support.
- [core-engine]: Verified healthy (329/329 unit tests pass). Headless Playwright renderer, FFmpeg encoder, and MCP adapter operational.

## Known Issues / Tech Debt (Audited October 2026)
- Canvas direct manipulation SVG overlay does not stream live transforms to preview iframe DOM and does not commit saves on pointerup (Issue DA-001).
- Undo (`Ctrl+Z`) restores post-drag state rather than pre-drag snapshot due to late history push (Issue DA-006).
- Timeline canvas lacks vertical scrolling (`scrollY`), clipping scenes with >3 layers (Issue DA-002).
- Hardcoded CSS grid dimensions with zero draggable splitters (Issue DA-003).
- SceneSpec lacks track-lane hierarchy (`trackIndex`), preventing non-overlapping clips from sharing a row (Issue BE-001, DA-005).
- Drag-and-drop from asset vault to canvas and timeline is not implemented (Issue DA-004).
- Engine missing `GET /api/assets` and `DELETE /api/scenes/:id` endpoints (Issues BE-003, BE-004).

## Team / Ownership
- UI / Frontend: Senior Software Engineer (AI Pair Programmer)
- Backend / Engine: MotionForge Core Engine (`localhost:4000`)
