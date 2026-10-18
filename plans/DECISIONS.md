# Architecture Decisions

## ADR-001: Adoption of Vanilla ES Modules Architecture
- **Date:** 2026-10-18
- **Status:** Accepted
- **Context:** MotionForge Studio needs to remain portable, easy to hack on without build friction, and instantly loadable in any browser while scaling to 15+ rich feature modules.
- **Decision:** Split monolithic `app.js` into clean ES Modules (`<script type="module" src="app.js">`) without adding Webpack, Vite, or npm bundlers.
- **Alternatives considered:** Bundling via Vite or esbuild. Rejected because zero-build keeps the studio light, transparent, and aligned with project constraints.
- **Consequences:** All modules use native `import`/`export`. Testing and development require serving files over HTTP rather than `file://` (due to CORS on local modules).

## ADR-002: Dual-ended PostMessage Preview Synchronization
- **Date:** 2026-10-18
- **Status:** Accepted
- **Context:** The preview iframe was out-of-sync with the timeline scrubber, requiring full reloads or failing to track playhead movement.
- **Decision:** Implement a structured message protocol (`motionforge:seek`, `motionforge:play`, `motionforge:pause`, `motionforge:ready`) in the studio UI and integrate the corresponding listener in `packages/scene-runtime/src/index.ts` connecting directly to `window.seekToFrame`.
- **Alternatives considered:** Polling or re-fetching iframe URLs. Rejected due to latency, flashing stage, and poor scrub performance.
- **Consequences:** Real-time 60fps scrub synchronization between the timeline canvas and the iframe stage.
