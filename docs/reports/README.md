# Engineering reports

Three production-audit reports, written after the benchmarks were **run** — every
number in them was measured on this machine, not estimated. Each report names
the script that produced its data, and each script is re-runnable and isolated
(it never touches `~/.motionforge`).

| Report | Question it answers | Script | Result |
| --- | --- | --- | --- |
| [01 — UI video production](01_UI_VIDEO_PRODUCTION_REPORT.md) | Can a *person* build a real promo in the Studio UI, and how fast does the UI feel? | `scripts/benchmark-ui-video-production.cjs` | **102/102** — a 6 s / 1920×1080 H.264+AAC MP4, built by hand, and every defect/friction point closed |
| [02 — MCP video production](02_MCP_VIDEO_PRODUCTION_REPORT.md) | Can an *AI agent* build the same thing through the MCP tools, and what is missing from that surface? | `scripts/benchmark-mcp-video-production.cjs` | **61/61** — an 8 s SaaS promo, authored over MCP, rendered and cross-checked in the live Studio |
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

## The audit found ten defects — every one is now closed

| # | Finding | Where | Status |
| --- | --- | --- | --- |
| 1 | The inspector could not author a gradient background — it wrote a `solid` payload into a `meshGradient` variant, and the engine refused the save. | 01 §5 (BUG-1) | ✅ FIXED |
| 2 | The same malformed variant **crashed the preview renderer** (`v.blobs.forEach()` with no guard). | 01 §5 (BUG-1b) | ✅ FIXED |
| 3 | A failed save left an **unhandled promise rejection** in the renderer. | 01 §5 (BUG-2) | ✅ FIXED |
| 4 | The Studio store **never recorded the render queue** — `state.renderQueue` stayed `0` forever. | 01 §5 (BUG-3) | ✅ FIXED |
| 5 | `Ctrl+K` was bound **twice** — one keypress opened the command palette *and* razor-split the layer. | 01 §5 (BUG-5) | ✅ FIXED |
| 6 | A legacy `tracks` entry that used the **unified** property name (`yPct`) fell through to a GSAP element tween, which GSAP rejected (`Invalid property yPct set to 40`) — the value was silently dropped. | 03 §5 | ✅ FIXED |
| 7 | **25 concurrent `saveScene` calls to one scene id all returned revision 1** — 24 saves were silently lost. The atomic temp-file+rename kept the JSON valid, so the loss was invisible. | 03 §3 | ✅ FIXED |
| 8 | `inspect_scene_keyframes` costs **~5.9 s per frame** in a 10-frame call, because every call re-launches a context and re-navigates the page. | 03 §4 | ✅ FIXED |
| 9 | A **70 px-blurred mesh-gradient background** dominates the frame cost; the blur is rasterised in software when no GPU is present. | 03 §6 | ✅ FIXED |
| 10 | The MCP surface has **no bounds query, no render-status query and no chart/code-block/particle layer kinds** — an agent must render frames to learn the layout. | 02 §6 | ✅ FIXED |

Two more surfaced while the fixes were landing:

| # | Finding | Where | Status |
| --- | --- | --- | --- |
| 11 | The **Text tool and the Card tool were dead ends** — they armed the cursor and never created anything. | 01 §7.2 (BUG-6) | ✅ FIXED |
| 12 | The **"Add Layer" modal had no entry point** — no button, no menu item, no command opened it, so a card, a background, an image, a Lottie or an overlay could not be created through the UI at all. | 01 §7.2 (BUG-8) | ✅ FIXED |

## What the Phase-7 remediation changed

| | Before | After |
| --- | --- | --- |
| MCP tools | 6 | **13** |
| Scene layer kinds | 6 | **10** (`chart`, `codeBlock`, `particleField`, `cta` added) |
| Machine-readable tool payloads | none | `structuredContent` on **every** result |
| Layout query | a full frame capture per timestamp | `get_layer_bounds` — **zero rasterisation** |
| Render lifecycle | blocking, unpollable | `render_video { wait: false }` → `get_render_status` → `get_render_result` |
| Engine inspection | a fresh browser context per call | **one warm page** for the life of the engine |
| Heavy effects | a live 70 px Gaussian blur + a live `feTurbulence` filter | a **pre-softened gradient** + a **pre-baked noise tile** |
| Render worker budget | `min(4, cpuCount)` | `min(cpus, RAM <= 4.5 GB \|\| heavy ? 1 : 4)` |
| Render pre-flight | none | the scene is **priced and validated** before a worker is spawned |
| Render tiers | 2 (draft, production) | **3** — `preview` (640×360 @ 12) is 4.1× faster than the draft |
| The render's blocking shape | one long call | `wait: false` → `get_render_status` → `get_render_result` |
