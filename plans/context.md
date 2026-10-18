# Project: MotionForge Studio

## Purpose
MotionForge Studio is a desktop-class motion graphics web application for programmatic and visual authoring of video scenes. It connects to the MotionForge core-engine at `:4000`, enabling real-time previewing, timeline scrubbing, multi-layer inspection, dynamic keyframe rendering, asset vault management, and video generation.

## Current Status
- Active feature: desktop-app (Commit 3: Solid.js Skeleton with Read-Only Parity)
- Overall health: green
- Last updated: 2026-10-18

## Critical Constraints
- Keep it vanilla: No build step, no npm runtime dependencies for the UI
- Cinematic Amber design palette (strict adherence to specified design tokens)
- Backward compatibility: Do not break existing functionality
- Multi-viewport visual verification (1440x900, 1920x1080, 2560x1440)
- Core engine API contract compliance (`API_DOCUMENTATION.md`)

## Active Features
- [deep-diagnostic-and-verification]: Complete zero-trust verification across all 22 end-to-end tests, resolving inspector lockup, schema mismatches, SSE CORS headers, and verifying draft/production video renders via ffprobe.
- [ui-overhaul]: Studio-grade overhaul with Cinematic Amber theme, ES module architecture, 50-step undo/redo, command palette, 60fps canvas timeline, preview postMessage sync, asset vault, render queue, shortcuts modal.

## Known Issues / Tech Debt
- API Gaps: No `GET /api/assets` vault listing endpoint (handled via client-side persistent registry in `localStorage`), no scene deletion endpoint (handled via tab/recents management).
- Layer `_hidden` and `_locked` toggles are stripped via `sanitizeSceneForEngine` prior to backend saves to maintain strict schema compliance.

## Team / Ownership
- UI / Frontend: Senior Software Engineer (AI Pair Programmer)
- Backend / Engine: MotionForge Core Engine (`localhost:4000`)
