# Engineering reports

Three production-audit reports, written after the benchmarks were **run** — every
number in them was measured on this machine, not estimated. Each report names
the script that produced its data, and each script is re-runnable and isolated
(it never touches `~/.motionforge`).

| Report | Question it answers | Script | Result |
| --- | --- | --- | --- |
| [01 — UI video production](01_UI_VIDEO_PRODUCTION_REPORT.md) | Can a *person* build a real promo in the Studio UI, and how fast does the UI feel? | `scripts/benchmark-ui-video-production.cjs` | 72/72 checks; a 6 s / 1920×1080 H.264+AAC MP4 |
| [02 — MCP video production](02_MCP_VIDEO_PRODUCTION_REPORT.md) | Can an *AI agent* build the same thing through the MCP tools, and what is missing from that surface? | `scripts/benchmark-mcp-video-production.cjs` | an 8 s SaaS promo, authored over MCP, rendered and cross-checked in the live Studio |
| [03 — Backend engine audit](03_BACKEND_ENGINE_AUDIT_REPORT.md) | Where does the engine's time and memory actually go, and is it safe under concurrency? | `scripts/benchmark-backend-engine.cjs` | schema/sanitizer, concurrency, inspection latency, render throughput and audio mixing |

## How to run them

```bash
npm run build -w @motionforge/desktop

# 1 — the UI workflow (needs a display)
xvfb-run -a --server-args="-screen 0 1920x1200x24" \
  node scripts/benchmark-ui-video-production.cjs

# 2 — the MCP workflow (needs a display for the cross-process check)
xvfb-run -a --server-args="-screen 0 1920x1200x24" \
  node scripts/benchmark-mcp-video-production.cjs

# 3 — the engine audit (headless is fine)
node scripts/benchmark-backend-engine.cjs
```

> **Run them one at a time.** Each one drives a Chromium (and, for 1 and 2, an
> Electron app). On a 2-core / 4 GB host, running two at once will get the
> browser OOM-killed mid-render — which is itself the finding reported in
> §3 of the backend audit.

## What the audit found, in one place

| # | Finding | Where |
| --- | --- | --- |
| 1 | The inspector could not author a gradient background — it wrote a `solid` payload into a `meshGradient` variant, and the engine refused the save. | 01 §5 (BUG-1) |
| 2 | The same malformed variant **crashed the preview renderer** (`v.blobs.forEach()` with no guard). | 01 §5 (BUG-1b) |
| 3 | A failed save left an **unhandled promise rejection** in the renderer. | 01 §5 (BUG-2) |
| 4 | The Studio store **never recorded the render queue** — `state.renderQueue` stayed `0` forever. | 01 §5 (BUG-3) |
| 5 | `Ctrl+K` was bound **twice** — one keypress opened the command palette *and* razor-split the layer. | 01 §5 (BUG-5) |
| 6 | A legacy `tracks` entry that used the **unified** property name (`yPct`) fell through to a GSAP element tween, which GSAP rejected (`Invalid property yPct set to 40`) — the value was silently dropped. | 03 §5 |
| 7 | **25 concurrent `saveScene` calls to one scene id all returned revision 1** — 24 saves were silently lost. The atomic temp-file+rename kept the JSON valid, so the loss was invisible. | 03 §3 |
| 8 | `inspect_scene_keyframes` costs **~5.9 s per frame** in a 10-frame call, because every call re-launches a context and re-navigates the page. | 03 §4 |
| 9 | A **70 px-blurred mesh-gradient background** dominates the frame cost; the blur is rasterised in software when no GPU is present. | 03 §6 |
| 10 | The MCP surface has **no bounds query, no render-status query and no chart/code-block/particle layer kinds** — an agent must render frames to learn the layout. | 02 §6 |
