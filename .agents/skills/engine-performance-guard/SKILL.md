---
name: engine-performance-guard
description: Operational rules and safeguards for Playwright rendering, warm-page lifecycle, and memory management on 3.8 GB RAM environments
---

# Playbook: Engine Performance & Memory Guard

This playbook defines non-negotiable performance invariants and safeguards for `core-engine`, `scene-runtime`, and Playwright browser instances operating within the 2 vCPU / 3.8 GB RAM baseline.

## 1. Zero networkidle
- Never invoke `page.waitForLoadState("networkidle")`.
- `networkidle` introduces hundreds of milliseconds of dead time per call and hangs unpredictably if long-lived background connections or workers are active.
- Rely strictly on deterministic completion events:
  - `window.mountSceneFromHost(scene, id, fps)` resolves when the master timeline is constructed.
  - `document.fonts.ready` ensures web fonts are fully loaded.
  - Image decode promises (`HTMLImageElement.decode()`) guarantee bitmaps are ready.
  - Deterministic frame stepping via `window.seekToFrame(frameIndex)`.

## 2. Zero Per-Frame Viewport Resets
- Set the Playwright viewport size once during browser context creation or scene initialization.
- Never resize the viewport or mutate device pixel ratio inside the frame-stepping loop.
- Modifying viewport dimensions between frames triggers full browser reflow and layout recalculation, increasing frame render latency by orders of magnitude.

## 3. Warm Page Single Measurement Authority (`warm-page.ts`)
- Keep a single persistent Chromium browser context and page alive for inspection and layout telemetry across the engine process lifetime.
- Both `get_layer_bounds` and `inspect_scene_keyframes` must execute through `WarmPage.measureFrames()`.
- Layout queries must use `window.seekToFrameForLayout()` to compute layer bounding boxes without performing rasterisation, image decoding, or audio resynchronization.
- The warm page is serialized through a single promise chain so concurrent queries queue sequentially instead of corrupting page state.

## 4. RAM-Aware Worker Budget & Bounded Render Chunks
- In `packages/core-engine/src/cost-analysis.ts`:
  - `computeWorkerBudget()` checks host memory via `os.totalmem()`.
  - On hosts with <= 4.5 GB of RAM (e.g., standard 3.8 GB instances), the worker budget is strictly **1 worker**.
  - Attempting to spawn 2 or more Chromium instances in parallel on 3.8 GB RAM will trigger Linux kernel Out-Of-Memory (OOM) killer terminations.
- Heavy scene chunking (`packages/core-engine/src/renderer.ts`):
  - Scenes featuring heavy visual effects (e.g., blurred gradients, mesh backgrounds, full-screen particle fields) render in bounded batches of 60 frames (`HEAVY_SCENE_PIXEL_FRAME_BUDGET = 60 * 1280 * 720`).
  - The Playwright browser process is closed and restarted between chunks to release accumulated GPU/Skia textures back to the operating system.
  - Segment MP4 files from chunks are losslessly concatenated via FFmpeg concat demuxer (`concat -c copy`).

## 5. Static Frame Buffer Reuse & Deduplication
- For static durations (e.g., title holds, paused cards with no running animations or shaders), the rendering loop identifies consecutive identical frames via timeline activity checks.
- When an identical frame is detected, reuse the previously captured in-memory frame buffer and write it directly into FFmpeg stdin rather than invoking expensive `page.screenshot()`.
- For `draft` and `preview` render tiers, pipe JPEG buffers instead of PNG buffers to reduce memory copy bandwidth.

## 6. FILTERED_LAYER_LARGE_SCALE Protection
- Blurring or filtering a layer scaled to large dimensions creates enormous raster surfaces in Skia.
- `analyze_scene` evaluates all layers and keyframes:
  - If a layer with CSS filters (`blur`, `drop-shadow`, `backdrop-filter`) has a base or keyframed `scale > 4.0`, emit the non-blocking warning `FILTERED_LAYER_LARGE_SCALE`.
  - Warn that scale exceeds safe threshold and suggest reducing dimensions or removing raster filters.

## 7. Verification Checklist
- Run engine health check and toolchain diagnostics:
  ```bash
  npm run doctor -w @motionforge/core-engine
  npm run smoke -w @motionforge/core-engine
  ```
- Verify zero memory leaks or unhandled worker terminations during render passes.
