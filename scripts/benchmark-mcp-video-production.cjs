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
 *   - the `framesMeta[]` layout sidecar (per-layer bbox at 4 timestamps),
 *     the overlap / off-screen / text-overflow analysis,
 *   - the CROSS-PROCESS sync latency: the MCP server runs in its own process
 *     and writes the scene to the shared scene store; the Electron Studio
 *     (another process) has to notice it on its own,
 *   - the render latency and the `ffprobe` verdict on the exported MP4.
 *
 * THE REAL TOOL SURFACE (six tools, no more)
 *   get_motion_capabilities | init_creative_project | create_or_update_scene |
 *   inspect_scene_keyframes | open_live_timeline_preview | render_video
 *   There is NO bounds tool, NO render-scene tool and NO render-status tool:
 *   `inspect_scene_keyframes` is the only layout oracle and it costs a full
 *   frame render.
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
 * A small brand mark, written into the project workspace so the scene can
 * reference it as `vault:mf-mark.svg` (the engine copies it into the vault on
 * first use). An agent WITHOUT filesystem access could only reach this through
 * a `data:` URI — there is no MCP upload tool. That gap is recorded.
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

function buildScene() {
  return {
    schemaVersion: 1,
    id: SCENE_ID,
    name: SCENE_NAME,
    canvas: { shape: '16:9', scale: 1080 },
    durationMs: 8000,
    assets: [{ id: 'mf-mark', kind: 'image', src: 'vault:mf-mark.svg', name: 'mf-mark.svg' }],
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
            { color: '#1d4ed8', xPct: 20, yPct: 24, radiusPct: 58, drift: 0.35 },
            { color: '#7c3aed', xPct: 80, yPct: 32, radiusPct: 52, drift: 0.28 },
            { color: '#0ea5e9', xPct: 52, yPct: 84, radiusPct: 44, drift: 0.22 },
          ],
        },
      },
      {
        id: 'logo',
        type: 'imageLogo',
        at: 200,
        duration: 7800,
        trackIndex: 1,
        assetId: 'mf-mark',
        widthPx: 108,
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
        trackIndex: 2,
        text: 'Ship motion graphics from a prompt',
        role: 'hero',
        sizePx: 92,
        lineHeight: 1.1,
        letterSpacingPx: -1,
        align: 'center',
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
        trackIndex: 3,
        text: 'MCP-authored  ·  deterministic frames  ·  eight seconds',
        role: 'headline',
        sizePx: 38,
        letterSpacingPx: 2,
        align: 'center',
        position: { xPct: 50, yPct: 45 },
        fill: '#93c5fd',
        box: { maxWidthPct: 80 },
        animateBy: 'word',
        entrance: { name: 'maskRevealWipe', staggerMs: 60, durationMs: 620 },
        exit: { name: 'collapseMask', durationMs: 400 },
      },
      {
        id: 'card-a',
        type: 'card',
        at: 2600,
        duration: 2200,
        trackIndex: 4,
        position: { xPct: 28, yPct: 68 },
        variant: {
          variant: 'glassCard',
          title: 'Deterministic pipeline',
          body: 'Every frame is seeked, captured and piped to the encoder.',
          widthPx: 540,
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
          { id: 'a-kf-1', timeMs: 2600, property: 'xPct', value: 21, easing: 'easeOut' },
          { id: 'a-kf-2', timeMs: 3300, property: 'xPct', value: 28, easing: 'easeOut' },
          { id: 'a-kf-3', timeMs: 2600, property: 'opacity', value: 0, easing: 'easeOut' },
          { id: 'a-kf-4', timeMs: 3200, property: 'opacity', value: 1, easing: 'easeOut' },
        ],
      },
      {
        id: 'card-b',
        type: 'card',
        at: 4900,
        duration: 2200,
        trackIndex: 5,
        position: { xPct: 72, yPct: 68 },
        variant: {
          variant: 'callout',
          accentSide: 'right',
          accentColor: '#38bdf8',
          title: 'Six tools, one contract',
          body: 'Capabilities, scenes, inspection, preview and render — over stdio.',
          widthPx: 540,
          paddingPx: 34,
          radiusPx: 28,
        },
        filters: {
          shadowBlur: 30,
          shadowColor: '#020617',
          cornerRadius: 28,
          saturate: 110,
        },
        entrance: { name: '3dFlipIn', durationMs: 800 },
        exit: { name: 'whipOutLeft', durationMs: 400 },
        keyframes: [
          { id: 'b-kf-1', timeMs: 4900, property: 'xPct', value: 79, easing: 'easeOut' },
          { id: 'b-kf-2', timeMs: 5600, property: 'xPct', value: 72, easing: 'easeOut' },
          { id: 'b-kf-3', timeMs: 4900, property: 'rotation', value: 4, easing: 'easeOut' },
          { id: 'b-kf-4', timeMs: 5600, property: 'rotation', value: 0, easing: 'easeOut' },
        ],
      },
      {
        id: 'metric',
        type: 'card',
        at: 6200,
        duration: 1400,
        trackIndex: 6,
        position: { xPct: 50, yPct: 68 },
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
        keyframes: [
          { id: 'm-kf-1', timeMs: 6200, property: 'scale', value: 0.62, easing: 'easeOut' },
          { id: 'm-kf-2', timeMs: 6900, property: 'scale', value: 1, easing: 'easeOut' },
        ],
      },
      {
        id: 'fgx',
        type: 'foregroundFX',
        at: 0,
        duration: 8000,
        trackIndex: 7,
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
  const record = {
    tool: name,
    args: args,
    latencyMs: Math.round(ms),
    responseBytes: Buffer.byteLength(json, 'utf8'),
    textBytes: Buffer.byteLength(text, 'utf8'),
    imageBytes,
    imageCount: imageParts.length,
    isError: Boolean(result.isError),
    at: new Date().toISOString(),
  };
  metrics.toolCalls.push(record);
  console.log(
    `  → ${name}  ${record.latencyMs} ms  ${record.responseBytes} B ` +
      `(text ${record.textBytes} B, images ${record.imageBytes} B / ${record.imageCount})` +
      (record.isError ? '  [isError]' : '')
  );
  return { record, text, result };
}

/* ── the layout analysis over the REAL framesMeta JSON ─────────────────── */

function overlapArea(a, b) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

/** Layers that legitimately cover the whole canvas are not "overlaps". */
const FULL_BLEED_TYPES = new Set(['background', 'foregroundFX']);

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
          pairs.push({
            a: a.id,
            b: b.id,
            areaPx2: Math.round(area),
            aBox: a.bbox,
            bBox: b.bbox,
          });
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
    console.log(`  advertised tools (${toolNames.length}): ${toolNames.join(', ')}`);
    check(
      'The server advertises exactly the six documented tools',
      toolNames.length === 6,
      toolNames.join(', ')
    );
    for (const missing of ['get_layer_bounds', 'render_scene', 'get_render_status']) {
      check(`The tool "${missing}" does NOT exist (documented gap)`, !toolNames.includes(missing));
    }

    const caps = await callTool(client, 'get_motion_capabilities', {});
    metrics.getMotionCapabilitiesMs = caps.record.latencyMs;
    const payloadText = caps.text.slice(caps.text.indexOf('=== FULL PAYLOAD ===') + '=== FULL PAYLOAD ==='.length);
    let digest = null;
    try {
      digest = JSON.parse(payloadText);
    } catch (err) {
      check('get_motion_capabilities returned a parseable payload', false, String(err));
    }
    if (digest) {
      metrics.layerFieldGuideKeys = Object.keys(digest.layerFieldGuide || {});
      metrics.registries = digest.registries;
      console.log(`  layerFieldGuide keys: ${metrics.layerFieldGuideKeys.join(', ')}`);
      console.log(
        `  layer types: ${(digest.registries?.layerTypes || []).join(', ')}`
      );
      check(
        'The contract documents one entry per real layer kind',
        metrics.layerFieldGuideKeys.length === 6,
        metrics.layerFieldGuideKeys.join(', ')
      );
      check(
        'The contract has NO chart / codeBlock / particleField / cta layer kind',
        !['chart', 'codeBlock', 'particleField', 'cta'].some((k) =>
          (digest.registries?.layerTypes || []).includes(k)
        ),
        `layerTypes = ${(digest.registries?.layerTypes || []).join(', ')}`
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

    // the brand mark: the ONLY way an agent can get a file into the vault
    // without an upload tool is to write it into the project workspace.
    const logoDir = path.join(projectPath, 'assets', 'images');
    fs.mkdirSync(logoDir, { recursive: true });
    fs.writeFileSync(path.join(logoDir, 'mf-mark.svg'), LOGO_SVG, 'utf8');
    note(
      'Brand mark written into the project workspace by hand',
      'assets/images/mf-mark.svg — there is NO MCP tool that uploads a file into the vault'
    );

    /* ── 3. author the scene ────────────────────────────────────────── */
    section('3. create_or_update_scene — author the 8-second composition');
    const scene = buildScene();
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
    check(
      'The scene was accepted and stored',
      createdOk,
      created.text.split('\n')[0]
    );
    // the warnings are the interesting part — keep them VERBATIM
    const warnBlock = created.text.includes('warning(s)')
      ? created.text.slice(created.text.indexOf('warning(s)'))
      : '';
    metrics.createSceneWarnings = warnBlock.trim() || '(no warnings returned)';
    console.log('  warnings[] verbatim:');
    console.log(
      (warnBlock.trim() || '(none)')
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n')
    );
    const sceneId = (created.text.match(/id "([^"]+)"/) || [])[1] || SCENE_ID;
    metrics.sceneId = sceneId;
    check('The stored scene id is the one the agent asked for', sceneId === SCENE_ID, sceneId);

    /* ── 4. inspect the layout ──────────────────────────────────────── */
    section('4. inspect_scene_keyframes — verify the layout');
    const inspected = await callTool(
      client,
      'inspect_scene_keyframes',
      { sceneId, at: INSPECT_AT, projectPath },
      300_000
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
      300_000
    );
    metrics.inspectTextOnlyMs = textOnly.record.latencyMs;
    note(
      'The same inspection without inline images',
      `${textOnly.record.responseBytes} B instead of ${inspected.record.responseBytes} B ` +
        `(the inline JPEGs are ${inspected.record.imageBytes} B of that)`
    );

    // the REAL framesMeta JSON — written to the project as a sidecar
    const metaPath = path.join(projectPath, 'renders', 'stills', `${sceneId}-frames-meta.json`);
    let framesMeta = null;
    if (fs.existsSync(metaPath)) {
      const sidecar = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      // the sidecar is `{ sceneId, generatedAt, frames: [...] }`
      framesMeta = Array.isArray(sidecar) ? sidecar : (sidecar.frames ?? []);
      metrics.framesMetaPath = metaPath;
      metrics.framesMetaSidecarKeys = Array.isArray(sidecar)
        ? '(array)'
        : Object.keys(sidecar).join(', ');
    } else {
      check('The frames-meta.json sidecar was written to the project', false, metaPath);
    }
    if (framesMeta) {
      const analysis = analyseFrames(framesMeta);
      metrics.frameAnalysis = analysis;
      metrics.framesMetaRaw = framesMeta;
      for (const f of analysis) {
        console.log(
          `  @${String(f.atMs).padStart(4)} ms  camera scale ${f.camera?.scale} xPct ${f.camera?.xPct} ` +
            `yPct ${f.camera?.yPct}  layers [${f.visibleLayerIds.join(', ')}]  ` +
            `offscreen ${f.offscreen.length}  overflow ${f.textOverflow.length}  overlaps ${f.overlaps.length}`
        );
      }
      const anyOffscreen = analysis.some((f) => f.offscreen.length > 0);
      const anyOverflow = analysis.some((f) => f.textOverflow.length > 0);
      const anyOverlap = analysis.some((f) => f.overlaps.length > 0);
      check('No layer is off-canvas at any inspected frame', !anyOffscreen);
      check('No text overflow at any inspected frame', !anyOverflow);
      check('No unexpected layer overlap at any inspected frame', !anyOverlap);
      const emptyForeground = analysis.filter((f) => !f.foreground || f.foreground.length === 0);
      check(
        'Every inspected frame carries foreground content (no dead frame)',
        emptyForeground.length === 0,
        emptyForeground.length ? `empty at ${emptyForeground.map((f) => f.atMs).join(', ')}` : 'all frames have content'
      );
      const clamped = analysis.filter((f) => f.camera?.clampedVoid);
      check('The camera never had to clamp a void-exposing pose', clamped.length === 0);
    }

    /* ── 5. the live cross-process sync ─────────────────────────────── */
    section('5. Cross-process sync — the Electron Studio sees the MCP scene');
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

    const frame = await findRuntimeFrame(page);
    check('The mf-runtime:// preview frame is mounted', Boolean(frame), frame ? frame.url() : 'no frame');

    const sceneIdBefore = await page.evaluate(() => window.store?.state?.sceneId ?? null);
    metrics.studioSceneIdBefore = sceneIdBefore;

    // (a) the Project Bin must notice the scene the MCP process wrote to disk
    const tBin = now();
    let binItem = null;
    const binDeadline = now() + 20_000;
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
    const openDeadline = now() + 20_000;
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
    const liveDeadline = now() + 20_000;
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

    // (d) the screenshot
    fs.mkdirSync(REPO_SCREENSHOTS, { recursive: true });
    await page.evaluate(() => {
      const s = window.store?.state;
      if (s?.playhead !== undefined) window.store.setPlayhead?.(2200);
    });
    await page.waitForTimeout(1200);
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

    /* ── 6. the render ──────────────────────────────────────────────── */
    section('6. render_video — export the MP4');
    const tRender = now();
    const rendered = await callTool(
      client,
      'render_video',
      { sceneId, quality: 'production', waitMaxSec: 900 },
      1_500_000
    );
    metrics.renderMs = now() - tRender;
    metrics.renderText = rendered.text;
    const mp4Path = (rendered.text.match(/file: (.+)/) || [])[1];
    check(
      'The production render succeeded',
      rendered.text.includes('render SUCCEEDED'),
      rendered.text.split('\n').slice(0, 6).join(' | ')
    );
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

    /* ── 7. ffprobe ──────────────────────────────────────────────────── */
    section('7. ffprobe — the verdict on the exported file');
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
      const hasAudio = /codec_name=aac/.test(probe);
      const audioStream = /codec_type=audio/.test(probe);
      check('The MP4 carries an H.264 video stream', hasVideo);
      check('The MP4 carries an AAC AUDIO stream (the SFX cues were mixed)', hasAudio && audioStream);
      const dims = probe.match(/width=(\d+)/);
      const height = probe.match(/height=(\d+)/);
      check(
        'The MP4 is 1920x1080',
        dims && dims[1] === '1920' && height && height[1] === '1080',
        `${dims ? dims[1] : '?'}x${height ? height[1] : '?'}`
      );
    }

    /* ── 8. the preview tool (the sixth one) ────────────────────────── */
    section('8. open_live_timeline_preview — the sixth tool');
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
    fs.writeFileSync(
      METRICS_PATH,
      JSON.stringify({ metrics, results, failures }, null, 2),
      'utf8'
    );
    console.log(`  metrics written to ${METRICS_PATH}`);
  }

  console.log('\n================================================================');
  console.log(`=== ${results.filter((r) => r.ok).length}/${results.length} checks passed ===`);
  console.log('================================================================');
  const table = metrics.toolCalls
    .map(
      (t) =>
        `| ${t.tool} | ${t.latencyMs} ms | ${t.responseBytes} B | ${t.textBytes} B | ${t.imageBytes} B |`
    )
    .join('\n');
  console.log('\n| tool | latency | response bytes | text bytes | image bytes |');
  console.log('| --- | --- | --- | --- | --- |');
  console.log(table);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('FATAL', error);
  process.exit(1);
});
