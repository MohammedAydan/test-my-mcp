# Project: MotionForge Studio

## Purpose
MotionForge Studio is a desktop-class motion graphics web application for programmatic and visual authoring of video scenes. It connects to the MotionForge core-engine at `:4000`, enabling real-time previewing, timeline scrubbing, multi-layer inspection, dynamic keyframe rendering, asset vault management, and video generation.

## Current Status
- Active feature: desktop-app (Complete: Standalone Electron NLE Application)
- Overall health: green
- Last updated: 2026-10-19

## Critical Constraints
- Locked Tech Stack: Electron 31 (`electron-vite`), Solid.js 1.8+, Tailwind CSS 3.4, Kobalte, Canvas 2D
- Cinematic Amber design palette (strict adherence to specified design tokens)
- Security Model: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, typed IPC preload
- Zero test regression: Maintain all 329 backend unit tests and 41+ E2E/UI tests passing
- Core engine API contract compliance (`API_DOCUMENTATION.md`)

## Active Features
- [desktop-app]: Production-grade desktop NLE application featuring Electron 31 shell, Solid.js fine-grained reactive UI, direct canvas SVG manipulation overlay with 8 resize handles, 1 rotation handle, cyan smart snapping guides, multi-track Canvas 2D timeline with keyframe tracks, JKL playback, razor split, ripple delete, and standalone Windows distributable packaging (`MotionForge.exe`).
- [deep-diagnostic-and-verification]: Complete zero-trust verification across all 22 end-to-end tests, resolving inspector lockup, schema mismatches, SSE CORS headers, and verifying draft/production video renders via ffprobe.
- [ui-overhaul]: Studio-grade overhaul with Cinematic Amber theme, ES module architecture, 50-step undo/redo, command palette, 60fps canvas timeline, preview postMessage sync, asset vault, render queue, shortcuts modal.

## Known Issues / Tech Debt
- API Gaps: No `GET /api/assets` vault listing endpoint (handled via client-side persistent registry in `localStorage`), no scene deletion endpoint (handled via tab/recents management).
- Layer `_hidden` and `_locked` toggles are stripped via `sanitizeSceneForEngine` prior to backend saves to maintain strict schema compliance.

## Team / Ownership
- UI / Frontend: Senior Software Engineer (AI Pair Programmer)
- Backend / Engine: MotionForge Core Engine (`localhost:4000`)
