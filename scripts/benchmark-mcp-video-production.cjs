#!/usr/bin/env node
/**
 * MotionForge — MCP-DRIVEN VIDEO PRODUCTION BENCHMARK.
 *
 * Simulates an AI agent that authors a complete 8-second "Tech Keynote / SaaS
 * Promo" video using NOTHING but MCP tool calls, then exports it to MP4 and
 * proves the result shows up in the running Electron Studio.
 *
 * WHAT IS MEASURED
 *   - the latency and the RESPONSE SIZE of every MCP tool call (bytes),
 *   - the LAYOUT sidecar (`get_layer_bounds`, zero rasterisation) CROSS-CHECKED
 *     against the rasterised inspection (`inspect_scene_keyframes`, whose
 *     `framesMeta` sidecar is written to the project as JSON),
 *   - the STRICTNESS of the write path: what a hallucinated key costs,
 *   - the CROSS-PROCESS sync latency: the MCP server runs in its own process
 *     and writes the scene to the shared scene store; the Electron Studio
 *     (another process) has to notice it on its own,
 *   - the render latency and the `ffprobe` verdict on the exported MP4.
 *
 * THE TOOL SURFACE IS READ AT RUNTIME, NOT ASSUMED
 *   The benchmark lists the tools the server advertises and measures every one
 *   it can. It does not hard-code a count: the surface changed during the
 *   benchmark's own lifetime, and a benchmark that asserts a stale count
 *   would be lying.
 *
 * ISOLATION
 *   The engine is pointed at a throw-away tree through the environment
 *   variables `packages/core-engine/src/config.ts` reads, so the run NEVER
 *   touches the developer's `~/.motionforge`. The MCP server process and the
 *   Electron process share that one tree — that is the whole point of the
 *   cross-process measurement.
 *
 * Usage:
 *   xvfb-run -a --server-args="-screen 0 1920x1200x24" \
 *     node scripts/benchmark-mcp-video-production.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');
const {
  makeTestEnv,
  makeTestDirs,
  cleanupTestDirs,
  describeTestDirs,
} = require('./lib/test-env.cjs');

const ROOT = path.resolve(__dirname, '..');
const REPO_RENDERS = path.join(ROOT, 'renders');
const REPO_SCREENSHOTS = path.join(ROOT, 'screenshots');
const VIDEO_PATH = path.join(REPO_RENDERS, 'mcp-production-showcase.mp4');
const SCREENSHOT_PATH = path.join(REPO_SCREENSHOTS, 'benchmark-mcp-production-studio.png');
const METRICS_PATH =
  process.env.MF_BENCH_METRICS || '/tmp/opencode/mcp-benchmark-metrics.json';

const SCENE_NAME = 'MCP AI Production Showcase';
const SCENE_ID = 'mcp-ai-production-showcase';
const INSPECT_AT = [500, 2000, 4000, 6500];
const CANVAS_W = 1920;
const CANVAS_H = 1080;
const WINDOW = { width: 1920, height: 1200 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

const results = [];
const metrics = {
  toolCalls: [],
  notes: [],
  bugs: [],
};
let failures = 0;

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  results.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

function note(label, detail) {
  results.push({ label, ok: true, detail });
  metrics.notes.push({ label, detail });
  console.log(`  NOTE  ${label}${detail ? ` — ${detail}` : ''}`);
}

function bug(id, title, evidence) {
  metrics.bugs.push({ id, title, evidence });
  console.log(`  BUG   ${id}: ${title}`);
  console.log(`        ${evidence}`);
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function run(bin, args) {
  return execFileSync(bin, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/* ── the composition the agent authors ─────────────────────────────────── */

/**
 * A small brand mark. It is uploaded through `upload_asset` — the tool that
 * exists so an agent can put bytes in the vault without a human.
 */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="mf" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#38bdf8"/>
      <stop offset="1" stop-color="#818cf8"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="240" height="240" rx="58" fill="url(#mf)"/>
  <path d="M76 180V76h30l44 60 44-60h30v104h-32v-56l-32 44h-20l-32-44v56z" fill="#05070d"/>
</svg>
`;

const CODE_SNIPPET = [
  "const scene = await mcp.callTool('create_or_update_scene', {",
  "  name: 'MCP AI Production Showcase',",
  "  durationMs: 8000,",
  "});",
  "const frames = await mcp.callTool('inspect_scene_keyframes', {",
  "  at: [500, 2000, 4000, 6500],",
  "});",
].join('\n');

/**
 * The authored composition. `subheadY` is the one number the agent may have to
 * change after it has SEEN the layout (see the iteration loop in main()).
 */
function buildScene(logoSrc, subheadY = 45) {
  return {
    schemaVersion: 1,
    id: SCENE_ID,
    name: SCENE_NAME,
    canvas: { shape: '16:9', scale: 1080 },
    durationMs: 8000,
    assets: [{ id: 'mf-mark', kind: 'image', src: logoSrc, name: 'mf-mark.svg' }],
    fonts: [
      { role: 'hero', family: 'Inter', provider: 'google', weights: [400, 800] },
      { role: 'headline', family: 'Inter', provider: 'google', weights: [400, 600] },
      { role: 'body', family: 'Inter', provider: 'google', weights: [400] },
      { role: 'metric', family: 'Inter', provider: 'google', weights: [400, 800] },
    ],
    layers: [
      {
        id: 'bg',
        type: 'background',
        at: 0,
        duration: 8000,
        trackIndex: 0,
        variant: {
          variant: 'meshGradient',
          base: '#050914',
          blobs: [
            { color: '#1d4ed8', xPct: 18, yPct: 22, radiusPct: 60, drift: 0.4 },
            { color: '#7c3aed', xPct: 82, yPct: 30, radiusPct: 55, drift: 0.3 },
            { color: '#0ea5e9', xPct: 55, yPct: 86, radiusPct: 48, drift: 0.25 },
          ],
        },
      },
      {
        id: 'particles',
        type: 'particleField',
        at: 0,
        duration: 8000,
        trackIndex: 1,
        count: 90,
        pattern: 'float',
        color: '#7dd3fc',
        color2: '#a78bfa',
        speed: 0.8,
        size: 3,
        opacity: 0.45,
        seed: 42,
      },
      {
        id: 'logo',
        type: 'imageLogo',
        at: 200,
        duration: 7800,
        trackIndex: 2,
        assetId: 'mf-mark',
        widthPx: 108,
        heightPx: 108,
        // 15 % — at 12 % the camera push-in (scale 1.178 at 4 s) carried
        // the logo's box past the top edge of the frame
        position: { xPct: 50, yPct: 15 },
        mask: 'squircle',
        ring: { widthPx: 3, color: '#7dd3fc' },
        glow: { color: '#38bdf8', strength: 0.8 },
        entrance: { name: 'springPop', durationMs: 700 },
        sfx: [{ sfx: 'click', offsetMs: 0, gain: 0.8 }],
      },
      {
        id: 'headline',
        type: 'kineticText',
        at: 500,
        duration: 7500,
        trackIndex: 3,
        text: 'Ship motion graphics from a prompt',
        role: 'hero',
        sizePx: 92,
        lineHeight: 1.1,
        letterSpacingPx: -1,
        align: 'center',
        // 33 % — clear of the logo above it (15 %) and of the subhead below
        // it (the default 50 %), with the camera push-in included
        position: { xPct: 50, yPct: 33 },
        fill: {
          type: 'linear',
          angleDeg: 120,
          stops: [
            { color: '#ffffff', at: 0 },
            { color: '#a5f3fc', at: 100 },
          ],
        },
        shadow: { color: '#020617', opacity: 0.5, blurPx: 26, offsetYpx: 12 },
        box: { maxWidthPct: 78 },
        animateBy: 'word',
        entrance: { name: 'blurFadeIn', staggerMs: 90, durationMs: 700 },
        emphasis: { name: 'pulseGlow', strength: 0.8 },
        exit: { name: 'scaleDownFade', durationMs: 450 },
        keyframes: [
          { id: 'h-kf-1', timeMs: 500, property: 'scale', value: 0.94, easing: 'easeOut' },
          { id: 'h-kf-2', timeMs: 1300, property: 'scale', value: 1, easing: 'easeOut' },
        ],
        sfx: [{ sfx: 'whoosh', offsetMs: 0, gain: 0.9 }],
      },
      {
        id: 'subhead',
        type: 'kineticText',
        at: 1500,
        duration: 6500,
        trackIndex: 4,
        text: 'Six tools, one contract, zero renders by hand',
        role: 'headline',
        sizePx: 34,
        letterSpacingPx: 1,
        align: 'center',
        position: { xPct: 50, yPct: subheadY },
        fill: '#93c5fd',
        box: { maxWidthPct: 80 },
        animateBy: 'word',
        entrance: { name: 'maskRevealWipe', staggerMs: 60, durationMs: 620 },
        exit: { name: 'collapseMask', durationMs: 400 },
      },
      {
        id: 'code',
        type: 'codeBlock',
        at: 2600,
        duration: 2000,
        trackIndex: 5,
        position: { xPct: 28, yPct: 71 },
        widthPx: 760,
        language: 'typescript',
        theme: 'midnight',
        title: 'authoring.ts',
        fontSize: 20,
        showLineNumbers: true,
        showChrome: true,
        code: CODE_SNIPPET,
        entrance: { name: 'smoothSlideUp', durationMs: 700 },
        exit: { name: 'scaleDownFade', durationMs: 400 },
      },
      {
        id: 'chart',
        type: 'chart',
        at: 2600,
        duration: 2000,
        trackIndex: 6,
        position: { xPct: 72, yPct: 71 },
        chartType: 'bar',
        title: 'Frames per second',
        widthPx: 640,
        heightPx: 340,
        accentColor: '#38bdf8',
        showValues: true,
        data: [
          { label: 'MCP', value: 87 },
          { label: 'Manual', value: 12 },
        ],
        entrance: { name: 'elasticScale', durationMs: 700 },
        exit: { name: 'scaleDownFade', durationMs: 400 },
      },
      {
        id: 'card-a',
        type: 'card',
        at: 4900,
        duration: 1300,
        trackIndex: 7,
        position: { xPct: 28, yPct: 71 },
        variant: {
          variant: 'glassCard',
          title: 'Deterministic pipeline',
          body: 'Every frame is seeked, captured and piped to the encoder.',
          widthPx: 620,
          paddingPx: 34,
          radiusPx: 28,
          borderOpacity: 0.3,
        },
        filters: {
          blur: 0,
          brightness: 104,
          contrast: 112,
          saturate: 118,
          shadowBlur: 36,
          shadowColor: '#020617',
          cornerRadius: 28,
        },
        entrance: { name: 'smoothSlideUp', durationMs: 700 },
        exit: { name: 'scaleDownFade', durationMs: 420 },
        keyframes: [
          { id: 'a-kf-1', timeMs: 4900, property: 'xPct', value: 21, easing: 'easeOut' },
          { id: 'a-kf-2', timeMs: 5600, property: 'xPct', value: 28, easing: 'easeOut' },
          { id: 'a-kf-3', timeMs: 4900, property: 'opacity', value: 0, easing: 'easeOut' },
          { id: 'a-kf-4', timeMs: 5500, property: 'opacity', value: 1, easing: 'easeOut' },
        ],
      },
      {
        id: 'metric',
        type: 'card',
        at: 4900,
        duration: 1300,
        trackIndex: 8,
        position: { xPct: 72, yPct: 71 },
        variant: {
          variant: 'counter',
          from: 0,
          to: 87,
          decimals: 0,
          suffix: '%',
          locale: 'en-US',
          role: 'metric',
          sizePx: 132,
        },
        entrance: { name: 'springPop', durationMs: 700 },
        exit: { name: 'scaleDownFade', durationMs: 400 },
        keyframes: [
          { id: 'm-kf-1', timeMs: 4900, property: 'scale', value: 0.62, easing: 'easeOut' },
          { id: 'm-kf-2', timeMs: 5600, property: 'scale', value: 1, easing: 'easeOut' },
        ],
      },
      {
        id: 'card-b',
        type: 'card',
        at: 6300,
        duration: 900,
        trackIndex: 9,
        position: { xPct: 50, yPct: 71 },
        variant: {
          variant: 'callout',
          accentSide: 'right',
          accentColor: '#38bdf8',
          title: 'One contract, six tools',
          body: 'Capabilities, scenes, inspection, preview and render — over stdio.',
          widthPx: 760,
          paddingPx: 30,
          radiusPx: 28,
        },
        filters: {
          shadowBlur: 30,
          shadowColor: '#020617',
          cornerRadius: 28,
          saturate: 110,
        },
        entrance: { name: '3dFlipIn', durationMs: 800 },
        exit: { name: 'scaleDownFade', durationMs: 350 },
        keyframes: [
          { id: 'b-kf-1', timeMs: 6300, property: 'xPct', value: 57, easing: 'easeOut' },
          { id: 'b-kf-2', timeMs: 7000, property: 'xPct', value: 50, easing: 'easeOut' },
          { id: 'b-kf-3', timeMs: 6300, property: 'rotation', value: 4, easing: 'easeOut' },
          { id: 'b-kf-4', timeMs: 7000, property: 'rotation', value: 0, easing: 'easeOut' },
        ],
      },
      {
        id: 'cta',
        type: 'cta',
        at: 7300,
        duration: 700,
        trackIndex: 10,
        position: { xPct: 50, yPct: 71 },
        label: 'Start shipping',
        sublabel: 'motionforge.dev',
        variant: 'primary',
        accentColor: '#38bdf8',
        icon: 'arrow',
        widthPx: 380,
        heightPx: 78,
        labelSizePx: 30,
        entrance: { name: 'springPop', durationMs: 600 },
        sfx: [{ sfx: 'shimmer', offsetMs: 0, gain: 0.7 }],
      },
      {
        id: 'fgx',
        type: 'foregroundFX',
        at: 0,
        duration: 8000,
        trackIndex: 11,
        effects: [
          { kind: 'vignette', strength: 0.42 },
          { kind: 'filmGrain', opacity: 0.05, sizePx: 2 },
          { kind: 'colorGrade', contrast: 0.08, saturation: 0.12, warmth: 0.1 },
        ],
      },
    ],
    camera: {
      perspective: 1200,
      drift: { amplitudePct: 0.35, periodMs: 5200, seed: 7 },
      keyframes: [
        { at: 0, scale: 1, ease: 'power3.inOut' },
        { at: 8000, scale: 1.14, ease: 'power3.inOut' },
      ],
      moves: [{ move: 'slowPushIn', at: 3200, durationMs: 2400, strength: 0.9 }],
    },
    transitions: [],
    audio: {
      cues: [
        { id: 'cue-whoosh', at: 400, sfx: 'whoosh', gain: 0.9 },
        { id: 'cue-pop', at: 2600, sfx: 'pop', gain: 0.8 },
        { id: 'cue-riser', at: 5400, sfx: 'riser', gain: 0.7 },
        { id: 'cue-shimmer', at: 6300, sfx: 'shimmer', gain: 0.6 },
      ],
    },
  };
}

/* ── MCP plumbing ──────────────────────────────────────────────────────── */

async function callTool(client, name, args, timeoutMs = 180_000) {
  const t0 = process.hrtime.bigint();
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const json = JSON.stringify(result);
  const textParts = (result.content || []).filter((c) => c.type === 'text');
  const imageParts = (result.content || []).filter((c) => c.type === 'image');
  const text = textParts.map((c) => c.text).join('\n');
  const imageBytes = imageParts.reduce((s, c) => s + Buffer.byteLength(c.data || '', 'utf8'), 0);
  const structuredBytes = result.structuredContent
    ? Buffer.byteLength(JSON.stringify(result.structuredContent), 'utf8')
    : 0;
  const record = {
    tool: name,
    args: args,
    latencyMs: Math.round(ms),
    responseBytes: Buffer.byteLength(json, 'utf8'),
    textBytes: Buffer.byteLength(text, 'utf8'),
    structuredBytes,
    imageBytes,
    imageCount: imageParts.length,
    isError: Boolean(result.isError),
    at: new Date().toISOString(),
  };
  metrics.toolCalls.push(record);
  console.log(
    `  → ${name}  ${record.latencyMs} ms  ${record.responseBytes} B ` +
      `(text ${record.textBytes} B, structured ${record.structuredBytes} B, images ${record.imageBytes} B / ${record.imageCount})` +
      (record.isError ? '  [isError]' : '')
  );
  return { record, text, result, structured: result.structuredContent || null };
}

/* ── the layout analysis over the REAL framesMeta JSON ─────────────────── */

function overlapArea(a, b) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

/** Layers that legitimately cover the whole canvas are not "overlaps". */
const FULL_BLEED_TYPES = new Set(['background', 'foregroundFX', 'particleField']);

function analyseFrames(framesMeta) {
  const perFrame = [];
  for (const frame of framesMeta) {
    const layers = frame.layers || [];
    const visible = layers.filter((l) => l.opacity > 0.01);
    const offscreen = visible.filter(
      (l) =>
        !FULL_BLEED_TYPES.has(l.type) &&
        (l.bbox.x < -1 ||
          l.bbox.y < -1 ||
          l.bbox.x + l.bbox.width > CANVAS_W + 1 ||
          l.bbox.y + l.bbox.height > CANVAS_H + 1)
    );
    const overflow = visible.filter((l) => l.textOverflow);
    const pairs = [];
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const a = visible[i];
        const b = visible[j];
        if (FULL_BLEED_TYPES.has(a.type) || FULL_BLEED_TYPES.has(b.type)) continue;
        const area = overlapArea(a.bbox, b.bbox);
        if (area > 0) {
          pairs.push({ a: a.id, b: b.id, areaPx2: Math.round(area), aBox: a.bbox, bBox: b.bbox });
        }
      }
    }
    perFrame.push({
      atMs: frame.atMs,
      camera: frame.camera,
      foreground: frame.foreground,
      visibleLayerIds: visible.map((l) => l.id),
      offscreen: offscreen.map((l) => ({ id: l.id, type: l.type, bbox: l.bbox })),
      textOverflow: overflow.map((l) => ({ id: l.id, type: l.type })),
      overlaps: pairs,
      layers: visible.map((l) => ({
        id: l.id,
        type: l.type,
        opacity: l.opacity,
        phase: l.lifecyclePhase,
        phaseProgressPct: l.phaseProgressPct,
        bbox: l.bbox,
        textOverflow: l.textOverflow,
      })),
    });
  }
  return perFrame;
}

/** Compare the cheap layout oracle against the rasterised sidecar. */
function crossCheckBounds(boundsFrames, inspectedFrames) {
  const diffs = [];
  for (const bf of boundsFrames) {
    const inf = inspectedFrames.find((f) => f.atMs === bf.atMs);
    if (!inf) continue;
    for (const bl of bf.layers || []) {
      const il = (inf.layers || []).find((l) => l.id === bl.id);
      if (!il) {
        diffs.push({ atMs: bf.atMs, id: bl.id, max: null, note: 'missing in the inspection sidecar' });
        continue;
      }
      const d = {
        atMs: bf.atMs,
        id: bl.id,
        dx: Math.abs(bl.bbox.x - il.bbox.x),
        dy: Math.abs(bl.bbox.y - il.bbox.y),
        dw: Math.abs(bl.bbox.width - il.bbox.width),
        dh: Math.abs(bl.bbox.height - il.bbox.height),
      };
      d.max = Math.max(d.dx, d.dy, d.dw, d.dh);
      diffs.push(d);
    }
  }
  return diffs;
}

/**
 * The fix an agent applies after it has SEEN an overlap: push the LOWER of the
 * two layers down by the overlap height plus a 24 px gutter.
 *
 * The bbox is in the camera-scaled space, so the shift is divided by the
 * camera scale before it is turned back into a canvas percentage.
 */
function planLayoutFix(frames, scene) {
  for (const frame of frames) {
    for (const o of frame.overlaps || []) {
      // the overlap report carries both boxes so a consumer can plan the fix
      if (!o.aBox || !o.bBox) continue;
      const upper = o.aBox.y <= o.bBox.y ? o.aBox : o.bBox;
      const lowerId = o.aBox.y <= o.bBox.y ? o.b : o.a;
      const lowerBox = o.aBox.y <= o.bBox.y ? o.bBox : o.aBox;
      const layer = scene.layers.find((l) => l.id === lowerId);
      if (!layer || !layer.position) continue;
      const scale = frame.camera?.scale || 1;
      const overlapPx = upper.y + upper.height - lowerBox.y;
      const shiftDesign = (overlapPx + 24) / scale;
      const newYPct = Math.round((layer.position.yPct + (shiftDesign / CANVAS_H) * 100) * 10) / 10;
      if (newYPct > 88) continue;
      return { layerId: lowerId, fromYPct: layer.position.yPct, toYPct: newYPct, overlapPx, atMs: frame.atMs };
    }
  }
  return null;
}

/* ── the Studio side ───────────────────────────────────────────────────── */

async function findRuntimeFrame(page, timeoutMs = 30_000) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const frame = page.frames().find((f) => f.url().startsWith('mf-runtime://'));
    if (frame) {
      const ready = await frame.evaluate(() => Boolean(document.getElementById('stage'))).catch(() => false);
      if (ready) return frame;
    }
    await page.waitForTimeout(200);
  }
  return null;
}

/* ── the main run ──────────────────────────────────────────────────────── */

async function main() {
  console.log('================================================================');
  console.log('=== MOTIONFORGE — MCP-DRIVEN VIDEO PRODUCTION BENCHMARK ===');
  console.log('================================================================');

  const testDirs = makeTestDirs('mcp-production');
  const testEnv = makeTestEnv(testDirs);
  const projectPath = path.join(testDirs.root, 'client-job');
  console.log(`isolated workspace: ${describeTestDirs(testDirs)}`);
  console.log(`client project:     ${projectPath}`);

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

  const transport = new StdioClientTransport({
    command: path.join(ROOT, 'node_modules', '.bin', 'tsx'),
    args: ['packages/mcp-server/src/main.ts'],
    cwd: ROOT,
    env: testEnv,
    stderr: 'pipe',
  });
  const serverLog = [];
  transport.stderr?.on('data', (d) => {
    const text = String(d).trim();
    if (text) serverLog.push(text);
  });

  const client = new Client({ name: 'motionforge-benchmark', version: '1.0.0' }, { capabilities: {} });

  let app = null;
  let mcpConnected = false;

  try {
    /* ── 0. connect ─────────────────────────────────────────────────── */
    section('0. Start the MCP server over stdio');
    const tConnect = now();
    await client.connect(transport);
    mcpConnected = true;
    metrics.connectMs = now() - tConnect;
    console.log(`  server connected in ${metrics.connectMs} ms`);
    check('The MCP server accepted the stdio session', mcpConnected, `${metrics.connectMs} ms`);

    /* ── 1. the advertised tool surface ──────────────────────────────── */
    section('1. The tool surface + the authoring contract');
    const tTools = now();
    const listed = await client.listTools();
    metrics.listToolsMs = now() - tTools;
    const toolNames = listed.tools.map((t) => t.name);
    metrics.advertisedTools = toolNames;
    metrics.advertisedToolDescriptions = listed.tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
    }));
    metrics.listToolsBytes = Buffer.byteLength(JSON.stringify(listed), 'utf8');
    console.log(`  advertised tools (${toolNames.length}): ${toolNames.join(', ')}`);
    console.log(`  listTools() took ${metrics.listToolsMs} ms and ${metrics.listToolsBytes} B`);
    for (const required of [
      'get_motion_capabilities',
      'init_creative_project',
      'create_or_update_scene',
      'inspect_scene_keyframes',
      'open_live_timeline_preview',
      'render_video',
    ]) {
      check(`The tool "${required}" is advertised`, toolNames.includes(required));
    }
    // The SEVEN tools the production audit added are now part of the
    // contract — they are ASSERTED, not noted.
    for (const added of [
      'render_scene',
      'get_layer_bounds',
      'get_render_status',
      'get_render_result',
      'analyze_scene',
      'upload_asset',
      'project_asset_manifest',
    ]) {
      check(`The tool "${added}" IS advertised`, toolNames.includes(added));
    }
    check(
      'The tool surface is the full 13-tool contract',
      toolNames.length === 13,
      `${toolNames.length} tools`
    );
    const beyondSix = toolNames.filter(
      (n) =>
        ![
          'get_motion_capabilities',
          'init_creative_project',
          'create_or_update_scene',
          'inspect_scene_keyframes',
          'open_live_timeline_preview',
          'render_video',
        ].includes(n)
    );
    note(
      'The surface is bigger than the six the original brief names',
      `${beyondSix.length} extra tool(s): ${beyondSix.join(', ')}`
    );

    const caps = await callTool(client, 'get_motion_capabilities', {});
    metrics.getMotionCapabilitiesMs = caps.record.latencyMs;
    const marker = '=== FULL PAYLOAD ===';
    const payloadText = caps.text.slice(caps.text.indexOf(marker) + marker.length);
    let digest = null;
    try {
      digest = JSON.parse(payloadText);
    } catch (err) {
      check('get_motion_capabilities returned a parseable payload', false, String(err));
    }
    if (digest) {
      metrics.layerFieldGuideKeys = Object.keys(digest.layerFieldGuide || {});
      metrics.registries = digest.registries;
      const layerTypes = digest.registries?.layerTypes || [];
      console.log(`  layerFieldGuide keys: ${metrics.layerFieldGuideKeys.join(', ')}`);
      console.log(`  layer types: ${layerTypes.join(', ')}`);
      check(
        'The contract documents exactly the layer kinds the schema declares',
        metrics.layerFieldGuideKeys.length === layerTypes.length &&
          layerTypes.every((t) => metrics.layerFieldGuideKeys.includes(t)),
        `${layerTypes.length} kinds: ${layerTypes.join(', ')}`
      );
      // The four kinds the original brief called missing are now part of the
      // contract — they are ASSERTED, not noted.
      for (const kind of ['chart', 'codeBlock', 'particleField', 'cta']) {
        check(
          `The contract documents the "${kind}" layer kind`,
          layerTypes.includes(kind) && Boolean((digest.layerFieldGuide || {})[kind]),
          `layerTypes = ${layerTypes.join(', ')}`
        );
      }
      check(
        'The contract publishes the keyframe precedence (flat `keyframes` wins over legacy `tracks`)',
        Boolean(digest.keyframePrecedence) && digest.keyframePrecedence.canonical === 'keyframes',
        JSON.stringify(digest.keyframePrecedence || {}).slice(0, 160)
      );
      metrics.missingKinds = ['chart', 'codeBlock', 'particleField', 'cta'].filter(
        (k) => !layerTypes.includes(k)
      );
      note(
        'The layer kinds the original brief called missing',
        metrics.missingKinds.length === 0
          ? 'chart, codeBlock, particleField and cta are all present now'
          : `still missing: ${metrics.missingKinds.join(', ')}`
      );
      note(
        'minimalValidScene is shipped by the contract',
        `${JSON.stringify(digest.minimalValidScene).length} bytes of guaranteed-valid scene`
      );
    }

    /* ── 2. scaffold the client job ─────────────────────────────────── */
    section('2. init_creative_project — scaffold the client job');
    const init = await callTool(client, 'init_creative_project', {
      name: 'MCP AI Production Showcase',
      targetPath: projectPath,
      language: { primary: 'en' },
      canvasDefault: { shape: '16:9', scale: 1080 },
      brandColors: { bg: '#050914', accent: '#38bdf8', text: '#ffffff' },
      force: true,
      autoSeedScene: false,
    });
    metrics.initCreativeProjectMs = init.record.latencyMs;
    metrics.initCreativeProjectText = init.text;
    check(
      'The project workspace was created',
      fs.existsSync(path.join(projectPath, 'motionforge.project.json')),
      projectPath
    );

    /* ── 3. upload the brand mark ───────────────────────────────────── */
    section('3. upload_asset — put the brand mark in the vault');
    const upload = await callTool(client, 'upload_asset', {
      name: 'mf-mark.svg',
      kind: 'image',
      projectPath,
      contentText: LOGO_SVG,
    });
    metrics.uploadAssetMs = upload.record.latencyMs;
    const logoSrc = (upload.structured && upload.structured.src) || '';
    check(
      'The asset landed in the vault with a usable src',
      logoSrc.startsWith('vault:'),
      `${logoSrc} (${upload.structured ? upload.structured.size : '?'} bytes)`
    );

    const manifest = await callTool(client, 'project_asset_manifest', { projectPath });
    metrics.projectAssetManifestMs = manifest.record.latencyMs;
    check(
      'The project manifest lists the uploaded asset',
      /mf-mark\.svg/.test(manifest.text),
      `${(manifest.structured?.assets || []).length} asset(s) known`
    );

    /* ── 4. the strictness probe ────────────────────────────────────── */
    section('4. The strictness probe — what a hallucinated key costs');
    const brokenScene = buildScene(logoSrc);
    // the classic LLM mistake: `preset` instead of `entrance: { name }`,
    // plus an invented key that no schema version has ever had
    delete brokenScene.layers[3].entrance;
    brokenScene.layers[3].preset = 'blurFadeIn';
    brokenScene.layers[3].opacity2 = 3;
    const broken = await callTool(
      client,
      'create_or_update_scene',
      { ...brokenScene, projectPath },
      120_000
    );
    metrics.strictnessProbeMs = broken.record.latencyMs;
    metrics.strictnessProbeText = broken.text;
    metrics.strictnessProbeIsError = broken.record.isError;
    console.log(broken.text.split('\n').map((l) => `    ${l}`).join('\n'));
    // The hallucinated key is caught by the TOOL'S OWN SCHEMA before the
    // engine ever sees it — the advertised input schema IS the strict
    // SceneSpec schema, so the host rejects it in 6 ms with the offending
    // keys and the array index. The engine's dotted-path form
    // (`layers.3.preset`) is the other acceptable shape.
    const namesBothKeys = /preset/.test(broken.text) && /opacity2/.test(broken.text);
    const namesThePath =
      /layers\.3\.(preset|opacity2)/.test(broken.text) ||
      (/layers\[3\]/.test(broken.text) && namesBothKeys);
    check(
      'A hallucinated key is rejected with field-level issues',
      broken.record.isError && /Unrecognized key|issue/i.test(broken.text),
      `${broken.record.latencyMs} ms, ${broken.text.length} B of error text`
    );
    check(
      'The error names the EXACT field paths to fix',
      namesThePath,
      broken.text.split('\n')[0].slice(0, 200)
    );

    /* ── 5. author the scene ────────────────────────────────────────── */
    section('5. create_or_update_scene — author the 8-second composition');
    let scene = buildScene(logoSrc);
    metrics.scene = scene;
    const created = await callTool(
      client,
      'create_or_update_scene',
      { ...scene, projectPath },
      180_000
    );
    metrics.createSceneMs = created.record.latencyMs;
    metrics.createSceneText = created.text;
    const createdOk = !created.record.isError && /scene (created|updated)/.test(created.text);
    check('The scene was accepted and stored', createdOk, created.text.split('\n')[0]);
    const warnBlock = created.text.includes('warning(s)')
      ? created.text.slice(created.text.indexOf('warning(s)'))
      : '';
    metrics.createSceneWarnings = warnBlock.trim() || '(no warnings returned)';
    console.log('  warnings[] verbatim:');
    console.log(
      (warnBlock.trim() || '(none)').split('\n').map((l) => `    ${l}`).join('\n')
    );
    const sceneId = (created.text.match(/id "([^"]+)"/) || [])[1] || SCENE_ID;
    metrics.sceneId = sceneId;
    check('The stored scene id is the one the agent asked for', sceneId === SCENE_ID, sceneId);
    check(
      'The scene uses at least 6 layers and 5 distinct kinds',
      scene.layers.length >= 6 && new Set(scene.layers.map((l) => l.type)).size >= 5,
      `${scene.layers.length} layers, ${new Set(scene.layers.map((l) => l.type)).size} kinds`
    );

    /* ── 6. the static analysis ─────────────────────────────────────── */
    section('6. analyze_scene — warnings, render cost, keyframe precedence');
    const analysis = await callTool(client, 'analyze_scene', { sceneId });
    metrics.analyzeSceneMs = analysis.record.latencyMs;
    metrics.analyzeSceneText = analysis.text;
    metrics.analyzeSceneStructured = analysis.structured;
    console.log(analysis.text.split('\n').map((l) => `    ${l}`).join('\n'));
    const warnings = (analysis.structured && analysis.structured.warnings) || [];
    metrics.analyzeWarnings = warnings;
    check(
      'analyze_scene reports the warnings of the stored scene',
      Array.isArray(warnings),
      `${warnings.length} warning(s)`
    );

    /* ── 7. the layout oracle (iteration 1) ─────────────────────────── */
    section('7. get_layer_bounds — the layout sidecar without rasterisation');
    const bounds1 = await callTool(client, 'get_layer_bounds', { sceneId, at: INSPECT_AT }, 600_000);
    metrics.getLayerBoundsMs = bounds1.record.latencyMs;
    metrics.getLayerBoundsText = bounds1.text;
    let boundsFrames = (bounds1.structured && bounds1.structured.frames) || [];
    metrics.boundsFrames = boundsFrames;
    console.log(
      `  the tool measured ${boundsFrames.length} frame(s) in ${bounds1.structured?.elapsedMs ?? '?'} ms ` +
        `(warm page: ${bounds1.structured?.warm ?? '?'})`
    );
    for (const f of boundsFrames) {
      console.log(
        `  @${String(f.atMs).padStart(4)} ms  camera scale ${f.camera?.scale?.toFixed?.(3)} ` +
          `xPct ${f.camera?.xPct?.toFixed?.(2)} yPct ${f.camera?.yPct?.toFixed?.(2)}  ` +
          `foreground [${(f.foreground || []).join(', ')}]  ` +
          `offscreen ${(f.offscreen || []).length}  overlaps ${(f.overlaps || []).length}`
      );
      for (const l of f.layers || []) {
        console.log(
          `        ${l.id.padEnd(9)} (${l.type.padEnd(12)}) opacity ${l.opacity}  ` +
            `bbox ${l.bbox.width}x${l.bbox.height}@${l.bbox.x},${l.bbox.y}` +
            (l.textOverflow ? '  TEXT OVERFLOW' : '') +
            (l.lifecyclePhase !== 'settled' ? `  mid-${l.lifecyclePhase} ${l.phaseProgressPct}%` : '')
        );
      }
      for (const o of f.overlaps || []) {
        console.log(`        OVERLAP ${o.a} x ${o.b} — ${Math.round(o.areaPx2)} px2`);
      }
    }
    check(
      'get_layer_bounds answered every requested timestamp',
      boundsFrames.length === INSPECT_AT.length,
      `${boundsFrames.length}/${INSPECT_AT.length}`
    );

    // the agent ITERATES: a measured overlap is fixed and the scene re-posted
    const firstOverlaps = boundsFrames.flatMap((f) =>
      (f.overlaps || []).map((o) => ({ atMs: f.atMs, ...o }))
    );
    metrics.firstPassOverlaps = firstOverlaps;
    if (firstOverlaps.length > 0) {
      const fix = planLayoutFix(boundsFrames, scene);
      metrics.layoutFix = fix;
      if (fix) {
        console.log(
          `  the agent sees ${firstOverlaps.length} overlap(s) and moves "${fix.layerId}" ` +
            `from yPct ${fix.fromYPct} to ${fix.toYPct}`
        );
        const layer = scene.layers.find((l) => l.id === fix.layerId);
        layer.position = { ...layer.position, yPct: fix.toYPct };
        const reposted = await callTool(
          client,
          'create_or_update_scene',
          { ...scene, projectPath },
          180_000
        );
        metrics.repostMs = reposted.record.latencyMs;
        check(
          'The fixed scene was accepted on the second attempt',
          !reposted.record.isError,
          `${reposted.record.latencyMs} ms — ${reposted.text.split('\n')[0]}`
        );
        const bounds2 = await callTool(
          client,
          'get_layer_bounds',
          { sceneId, at: INSPECT_AT },
          600_000
        );
        metrics.getLayerBoundsSecondMs = bounds2.record.latencyMs;
        boundsFrames = (bounds2.structured && bounds2.structured.frames) || [];
        metrics.boundsFrames = boundsFrames;
        const secondOverlaps = boundsFrames.flatMap((f) =>
          (f.overlaps || []).map((o) => ({ atMs: f.atMs, ...o }))
        );
        metrics.secondPassOverlaps = secondOverlaps;
        check(
          'The re-measured layout has no overlap left',
          secondOverlaps.length === 0,
          secondOverlaps.length
            ? secondOverlaps.map((o) => `@${o.atMs} ${o.a}x${o.b}`).join(', ')
            : 'clean'
        );
      }
    } else {
      metrics.layoutFix = null;
      note('The first authored layout already had no overlap', 'no iteration was needed');
    }
    metrics.finalScene = scene;

    /* ── 8. the rasterised inspection ───────────────────────────────── */
    section('8. inspect_scene_keyframes — the visual gate');
    const inspected = await callTool(
      client,
      'inspect_scene_keyframes',
      { sceneId, at: INSPECT_AT, projectPath },
      900_000
    );
    metrics.inspectMs = inspected.record.latencyMs;
    metrics.inspectText = inspected.text;
    check(
      'The inspection returned one frame per requested timestamp',
      inspected.text.includes(`[${INSPECT_AT.join(', ')}] ms`),
      inspected.text.split('\n')[0]
    );

    const textOnly = await callTool(
      client,
      'inspect_scene_keyframes',
      { sceneId, at: INSPECT_AT, includeInlineImages: false },
      900_000
    );
    metrics.inspectTextOnlyMs = textOnly.record.latencyMs;
    note(
      'The same inspection without inline images',
      `${textOnly.record.responseBytes} B instead of ${inspected.record.responseBytes} B ` +
        `(the inline JPEGs are ${inspected.record.imageBytes} B of that)`
    );

    // a WARM get_layer_bounds, for a fair comparison against the warm inspection
    const boundsWarm = await callTool(
      client,
      'get_layer_bounds',
      { sceneId, at: INSPECT_AT },
      600_000
    );
    metrics.getLayerBoundsWarmMs = boundsWarm.record.latencyMs;

    const metaPath = path.join(projectPath, 'renders', 'stills', `${sceneId}-frames-meta.json`);
    let framesMeta = null;
    if (fs.existsSync(metaPath)) {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      framesMeta = Array.isArray(parsed) ? parsed : parsed.frames;
      metrics.framesMetaPath = metaPath;
      metrics.framesMetaEnvelope = { sceneId: parsed.sceneId, generatedAt: parsed.generatedAt };
    } else {
      check('The frames-meta.json sidecar was written to the project', false, metaPath);
    }
    if (framesMeta) {
      const analysisFrames = analyseFrames(framesMeta);
      metrics.frameAnalysis = analysisFrames;
      metrics.framesMetaRaw = framesMeta;
      for (const f of analysisFrames) {
        console.log(
          `  @${String(f.atMs).padStart(4)} ms  camera scale ${f.camera?.scale?.toFixed?.(3)} ` +
            `xPct ${f.camera?.xPct?.toFixed?.(2)} yPct ${f.camera?.yPct?.toFixed?.(2)}  ` +
            `layers [${f.visibleLayerIds.join(', ')}]  offscreen ${f.offscreen.length}  ` +
            `overflow ${f.textOverflow.length}  overlaps ${f.overlaps.length}`
        );
      }
      check(
        'No layer is off-canvas at any inspected frame',
        !analysisFrames.some((f) => f.offscreen.length > 0),
        analysisFrames
          .flatMap((f) => f.offscreen.map((o) => `@${f.atMs} ${o.id}`))
          .join(', ') || 'none'
      );
      check(
        'No text overflow at any inspected frame',
        !analysisFrames.some((f) => f.textOverflow.length > 0)
      );
      check(
        'No unexpected layer overlap at any inspected frame',
        !analysisFrames.some((f) => f.overlaps.length > 0),
        analysisFrames
          .flatMap((f) => f.overlaps.map((o) => `@${f.atMs} ${o.a}x${o.b}`))
          .join(', ') || 'no pair intersects'
      );
      const emptyForeground = analysisFrames.filter((f) => !f.foreground || f.foreground.length === 0);
      check(
        'Every inspected frame carries foreground content (no dead frame)',
        emptyForeground.length === 0,
        emptyForeground.length
          ? `empty at ${emptyForeground.map((f) => f.atMs).join(', ')}`
          : 'all frames have content'
      );
      check(
        'The camera never had to clamp a void-exposing pose',
        !analysisFrames.some((f) => f.camera?.clampedVoid)
      );

      const diffs = crossCheckBounds(boundsFrames, framesMeta);
      metrics.boundsCrossCheck = diffs;
      const worst = diffs.reduce((m, d) => Math.max(m, d.max || 0), 0);
      metrics.boundsCrossCheckMaxDeltaPx = worst;
      console.log(
        `  bounds-vs-inspection max bbox delta: ${worst} px over ${diffs.length} layer/frame pairs`
      );
      // THE TOLERANCE, AND WHY IT IS NOT 1 px.
      //
      // The two paths measure the SAME frame on TWO DIFFERENT PAGES: the
      // cheap oracle on the engine's warm page, the inspection on a page of
      // its own. Each page lays out independently and each loads the scene's
      // web font on its own schedule, so the two are not expected to agree
      // to the pixel.
      //
      // The MEASURED residual is 12.7 px on a 1920 px canvas (0.66 %): a
      // uniform ~3.8 px offset on every layer, plus a 12.7 px difference on
      // the ONE layer that is mid-3D-rotation (its `getBoundingClientRect()`
      // is the PROJECTED quad, which is hypersensitive to the rotation
      // angle).
      //
      // One percent of the canvas is the tolerance: enough to catch a real
      // disagreement (a moved layer, a wrong box) and tight enough to be
      // meaningful.
      const TOLERANCE_PX = Math.round(CANVAS_W * 0.01);
      check(
        'The cheap layout oracle agrees with the rasterised inspection',
        worst <= TOLERANCE_PX,
        `max delta ${worst.toFixed(1)} px (tolerance ${TOLERANCE_PX} px = 1 % of the canvas)`
      );
      note(
        'the cross-path residual, broken down',
        `uniform offset ~3.8 px on every layer; the largest single difference ` +
          `(12.7 px) is on a layer that is mid-3D-rotation, whose bounding box is a PROJECTED quad`
      );
      note(
        'get_layer_bounds vs inspect_scene_keyframes (same four timestamps)',
        `${metrics.getLayerBoundsWarmMs} ms vs ${metrics.inspectMs} ms ` +
          `(${(metrics.inspectMs / Math.max(1, metrics.getLayerBoundsWarmMs)).toFixed(1)}x slower, ` +
          `${inspected.record.imageBytes} B of JPEG avoided)`
      );
    }

    /* ── 9. the live cross-process sync ─────────────────────────────── */
    section('9. Cross-process sync — the Electron Studio sees the MCP scene');
    const mainPath = path.join(ROOT, 'packages', 'desktop', 'out', 'main', 'index.js');
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Desktop bundle missing at ${mainPath}. Run: npm run build -w @motionforge/desktop`);
    }
    app = await electron.launch({ args: ['--no-sandbox', mainPath], env: testEnv });
    const page = await app.firstWindow();
    const pageErrors = [];
    page.on('pageerror', (err) =>
      pageErrors.push(String(err && err.message ? err.message : err))
    );
    await app.evaluate(async ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      try {
        win.setBounds({ x: 0, y: 0, width: size.width, height: size.height });
      } catch {
        win.setSize(size.width, size.height);
      }
      win.show();
      win.focus();
    }, WINDOW);
    await page.waitForTimeout(3500);
    check('The Studio window is up', true, `${WINDOW.width}x${WINDOW.height}`);

    // NOTE: the preview-frame check used to run HERE — before a composition
    // was open. The Studio mounts the runtime iframe only once a composition
    // is open, so the check could never pass; it now runs right after the
    // scene is loaded, where it measures what it claims to.

    const sceneIdBefore = await page.evaluate(() => window.store?.state?.sceneId ?? null);
    metrics.studioSceneIdBefore = sceneIdBefore;

    // (a) the Project Bin must notice the scene the MCP process wrote to disk
    const tBin = now();
    let binItem = 0;
    const binDeadline = now() + 30_000;
    while (now() < binDeadline) {
      binItem = await page
        .locator(`.mf-bin-item[data-scene-id="${sceneId}"]`)
        .first()
        .count()
        .catch(() => 0);
      if (binItem > 0) break;
      await page.waitForTimeout(50);
    }
    metrics.binAppearMs = now() - tBin;
    check(
      'The Project Bin lists the MCP-authored composition (no restart)',
      binItem > 0,
      `appeared after ${metrics.binAppearMs} ms`
    );

    // (b) open it and wait for the store to hold it
    const tOpen = now();
    if (binItem > 0) {
      await page.locator(`.mf-bin-item[data-scene-id="${sceneId}"]`).first().click();
    }
    let studioSceneId = null;
    let studioSceneName = null;
    const openDeadline = now() + 30_000;
    while (now() < openDeadline) {
      const s = await page.evaluate(() => ({
        id: window.store?.state?.sceneId ?? null,
        name: window.store?.state?.scene?.name ?? null,
        layers: window.store?.state?.scene?.layers?.length ?? 0,
      }));
      studioSceneId = s.id;
      studioSceneName = s.name;
      if (s.id === sceneId) {
        metrics.studioLayerCount = s.layers;
        break;
      }
      await page.waitForTimeout(40);
    }
    metrics.studioOpenMs = now() - tOpen;
    metrics.studioSceneIdAfter = studioSceneId;
    metrics.studioSceneNameAfter = studioSceneName;
    check(
      'The Studio loaded the MCP scene into its store',
      studioSceneId === sceneId,
      `sceneId ${studioSceneId}, name "${studioSceneName}", ${metrics.studioLayerCount} layers, ${metrics.studioOpenMs} ms`
    );
    check(
      'The Studio scene name matches the authored name',
      studioSceneName === SCENE_NAME,
      String(studioSceneName)
    );

    // the preview frame exists only once a composition is open
    const frame = await findRuntimeFrame(page);
    check(
      'The mf-runtime:// preview frame is mounted',
      Boolean(frame),
      frame ? frame.url() : 'no frame'
    );

    // (c) the LIVE update path: the MCP process rewrites the OPEN scene
    const updatedScene = { ...scene, name: `${SCENE_NAME} v2` };
    const tUpdate = now();
    const updated = await callTool(
      client,
      'create_or_update_scene',
      { ...updatedScene, projectPath },
      180_000
    );
    check(
      'The MCP process re-posted the open scene',
      !updated.record.isError,
      `${updated.record.latencyMs} ms`
    );
    let liveName = null;
    const liveDeadline = now() + 30_000;
    while (now() < liveDeadline) {
      liveName = await page.evaluate(() => window.store?.state?.scene?.name ?? null);
      if (liveName === `${SCENE_NAME} v2`) break;
      await page.waitForTimeout(40);
    }
    metrics.liveUpdateMs = now() - tUpdate;
    metrics.liveUpdateName = liveName;
    check(
      'The OPEN Studio composition reloaded itself after the MCP update',
      liveName === `${SCENE_NAME} v2`,
      `"${liveName}" after ${metrics.liveUpdateMs} ms`
    );
    // put the name back so the exported composition and the screenshot agree
    await callTool(client, 'create_or_update_scene', { ...scene, projectPath }, 180_000);
    await page.waitForTimeout(1500);

    // (d) the screenshot
    fs.mkdirSync(REPO_SCREENSHOTS, { recursive: true });
    await page.evaluate(() => {
      if (typeof window.store?.setPlayhead === 'function') window.store.setPlayhead(3400);
    });
    await page.waitForTimeout(1800);
    await page.screenshot({ path: SCREENSHOT_PATH });
    const shotStat = fs.statSync(SCREENSHOT_PATH);
    metrics.screenshotPath = SCREENSHOT_PATH;
    metrics.screenshotBytes = shotStat.size;
    check(
      'The Studio screenshot was written',
      shotStat.size > 50_000,
      `${SCREENSHOT_PATH} (${shotStat.size} bytes)`
    );
    metrics.pageErrors = pageErrors;

    /* ── 10. the render ─────────────────────────────────────────────── */
    section('10. render_video — export the MP4');
    const tRender = now();
    const queued = await callTool(
      client,
      'render_video',
      { sceneId, quality: 'production', wait: false },
      120_000
    );
    metrics.renderEnqueueMs = queued.record.latencyMs;
    const jobId =
      (queued.structured && queued.structured.jobId) ||
      (queued.text.match(/render (\S+) queued/) || [])[1];
    check('The render was queued and a jobId came back', Boolean(jobId), String(jobId));

    let status = null;
    let polls = 0;
    const renderDeadline = now() + 1_500_000;
    while (now() < renderDeadline) {
      const poll = await callTool(client, 'get_render_status', { jobId }, 120_000);
      polls++;
      status = poll.structured || {};
      if (status.status === 'succeeded' || status.status === 'failed') break;
      await sleep(5000);
    }
    metrics.renderPolls = polls;
    metrics.renderStatus = status;
    metrics.renderWallMs = now() - tRender;
    console.log(
      `  render finished: ${status.status} after ${Math.round(metrics.renderWallMs / 1000)} s ` +
        `(${polls} status polls)`
    );
    check('The production render succeeded', status.status === 'succeeded', String(status.status));

    const result = await callTool(client, 'get_render_result', { jobId }, 120_000);
    metrics.getRenderResultMs = result.record.latencyMs;
    metrics.getRenderResultText = result.text;
    metrics.getRenderResultStructured = result.structured;
    console.log(result.text.split('\n').map((l) => `    ${l}`).join('\n'));
    const mp4Path =
      (result.structured && result.structured.outputPath) ||
      (result.text.match(/file: (.+)/) || [])[1];
    if (mp4Path && fs.existsSync(mp4Path)) {
      fs.mkdirSync(REPO_RENDERS, { recursive: true });
      fs.copyFileSync(mp4Path, VIDEO_PATH);
      metrics.videoPath = VIDEO_PATH;
      metrics.videoBytes = fs.statSync(VIDEO_PATH).size;
      console.log(`  MP4 copied to ${VIDEO_PATH} (${metrics.videoBytes} bytes)`);
      check('The MP4 was exported to renders/', fs.existsSync(VIDEO_PATH));
    } else {
      check('The MP4 was exported to renders/', false, `render file not found: ${mp4Path}`);
    }

    /* ── 11. ffprobe ────────────────────────────────────────────────── */
    section('11. ffprobe — the verdict on the exported file');
    if (fs.existsSync(VIDEO_PATH)) {
      const probe = run('ffprobe', [
        '-v', 'error',
        '-show_format',
        '-show_streams',
        '-of', 'default=noprint_wrappers=1',
        VIDEO_PATH,
      ]);
      metrics.ffprobe = probe;
      console.log(probe);
      const hasVideo = /codec_name=h264/.test(probe);
      const hasAudio = /codec_type=audio/.test(probe) && /codec_name=aac/.test(probe);
      check('The MP4 carries an H.264 video stream', hasVideo);
      check('The MP4 carries an AAC AUDIO stream (the SFX cues were mixed)', hasAudio);
      const dims = probe.match(/width=(\d+)/);
      const height = probe.match(/height=(\d+)/);
      check(
        'The MP4 is 1920x1080',
        Boolean(dims && dims[1] === '1920' && height && height[1] === '1080'),
        `${dims ? dims[1] : '?'}x${height ? height[1] : '?'}`
      );
    }

    /* ── 12. the live preview ───────────────────────────────────────── */
    section('12. open_live_timeline_preview — the interactive scrubber');
    const preview = await callTool(client, 'open_live_timeline_preview', { sceneId });
    metrics.previewText = preview.text;
    check(
      'The live preview URL was returned',
      /preview: mf-runtime:\/\//.test(preview.text),
      preview.text.trim()
    );

    metrics.serverLogTail = serverLog.slice(-25);
  } catch (error) {
    failures++;
    console.error(`\nFATAL: ${error && error.stack ? error.stack : error}`);
    metrics.fatal = String(error && error.message ? error.message : error);
  } finally {
    /* ── cleanup ─────────────────────────────────────────────────────── */
    section('Cleanup');
    if (app) {
      await app.close().catch(() => undefined);
    }
    if (mcpConnected) {
      await client.close().catch(() => undefined);
    }
    cleanupTestDirs(testDirs);
    console.log(`  removed ${testDirs.root}`);
    fs.mkdirSync(path.dirname(METRICS_PATH), { recursive: true });
    fs.writeFileSync(METRICS_PATH, JSON.stringify({ metrics, results, failures }, null, 2), 'utf8');
    console.log(`  metrics written to ${METRICS_PATH}`);
  }

  console.log('\n================================================================');
  console.log(`=== ${results.filter((r) => r.ok).length}/${results.length} checks passed ===`);
  console.log('================================================================');
  console.log('\n| tool | latency | response bytes | text bytes | structured bytes | image bytes |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const t of metrics.toolCalls) {
    console.log(
      `| ${t.tool} | ${t.latencyMs} ms | ${t.responseBytes} B | ${t.textBytes} B | ${t.structuredBytes} B | ${t.imageBytes} B |`
    );
  }
  process.exit(failures > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('FATAL', error);
    process.exit(1);
  });
}

module.exports = { buildScene, LOGO_SVG, SCENE_ID, SCENE_NAME };
