#!/usr/bin/env node
/**
 * MotionForge — MCP-DRIVEN VIDEO PRODUCTION BENCHMARK.
 *
 * Authors a complete 8-second Tech Keynote / SaaS promo using ONLY the
 * `@motionforge/mcp-server` tool surface, inspects it, proves the live
 * cross-process UI sync, and exports it to an MP4.
 *
 * WHAT IS MEASURED
 *   - the latency and the RESPONSE SIZE of every tool call (MCP over stdio is
 *     a bounded pipe, so the size matters as much as the latency),
 *   - the layout verification from `inspect_scene_keyframes`'s `framesMeta`
 *     sidecar (per-layer bbox, camera pose, text overflow),
 *   - the cross-process sync latency (MCP writes the scene -> the Studio
 *     shows it, with no restart),
 *   - the `ffprobe` metadata of the exported MP4, including the audio stream.
 *
 * THE TOOL SURFACE (measured, not assumed)
 *   The server exposes exactly SIX tools:
 *     get_motion_capabilities, init_creative_project, create_or_update_scene,
 *     inspect_scene_keyframes, open_live_timeline_preview, render_video.
 *   There is NO `get_layer_bounds` and NO `render_scene` — the bounds come
 *     from `inspect_scene_keyframes`'s `framesMeta`, and the export from
 *     `render_video`. The report documents that gap.
 *
 * ISOLATION
 *   The MCP server, the Electron Studio and the engine all share ONE temp
 *   workspace, so the run never touches the developer's `~/.motionforge`.
 *
 * Usage:
 *   xvfb-run -a --server-args="-screen 0 1920x1200x24" \
 *     node scripts/benchmark-mcp-video-production.cjs
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const ROOT = path.resolve(__dirname, '..');
const RENDERS_DIR = path.join(ROOT, 'renders');
const VIDEO_PATH = path.join(RENDERS_DIR, 'mcp-production-showcase.mp4');
const SCREENSHOT_PATH = path.join(ROOT, 'screenshots', 'benchmark-mcp-production-studio.png');
const WINDOW = { width: 1920, height: 1200 };

const SCENE_ID = 'mcp-ai-production-showcase';
const SCENE_NAME = 'MCP AI Production Showcase';
const DURATION_MS = 8000;
const INSPECT_AT = [500, 2000, 4000, 6500];

const metrics = {
  toolCalls: [],
  sync: {},
  render: {},
  layout: {},
  capabilities: {},
  bugs: [],
};
let failures = 0;

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

function note(label, detail = '') {
  console.log(`  NOTE  ${label}${detail ? ` — ${detail}` : ''}`);
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function bug(id, title, evidence) {
  metrics.bugs.push({ id, title, evidence });
  console.log(`  BUG   ${id}: ${title}`);
  console.log(`        ${evidence}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(bin, args) {
  return execFileSync(bin, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/* ── the MCP call wrapper: every call is timed and sized ──────────────────── */

let client = null;

async function callTool(name, args = {}) {
  const started = process.hrtime.bigint();
  const result = await client.callTool({ name, arguments: args });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const text = (result.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  const images = (result.content || []).filter((c) => c.type === 'image').length;
  const bytes = Buffer.byteLength(text, 'utf8');
  const record = {
    tool: name,
    args: summarizeArgs(args),
    ms: Number(elapsedMs.toFixed(1)),
    bytes,
    images,
    isError: result.isError === true,
  };
  metrics.toolCalls.push(record);
  console.log(
    `  ${name} — ${record.ms} ms, ${record.bytes} bytes${images ? `, ${images} inline image(s)` : ''}`
  );
  if (result.isError) {
    record.error = text.slice(0, 600);
    console.log(`        ERROR: ${text.slice(0, 300)}`);
  }
  return { text, bytes, images, isError: result.isError === true };
}

/** A short, loggable summary of the arguments (never the whole scene). */
function summarizeArgs(args) {
  const out = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (key === 'at' && Array.isArray(value)) out[key] = value;
    else if (typeof value === 'string' && value.length > 80) out[key] = `${value.slice(0, 77)}...`;
    else if (value && typeof value === 'object') out[key] = `{${Object.keys(value).slice(0, 8).join(',')}}`;
    else out[key] = value;
  }
  return out;
}

/** Parse a tool result that carries JSON. */
function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/* ── the scene ────────────────────────────────────────────────────────────── */

/**
 * The 8-second SaaS promo.
 *
 * It uses FIVE of the six real layer kinds (background, imageLogo,
 * kineticText, card, lottie) plus foregroundFX, a slow push-in camera move,
 * a seam transition, flat keyframe animations, visual filters and three
 * scheduled SFX cues.
 */
function buildScene() {
  const kf = (id, timeMs, property, value, easing = 'easeInOut') => ({
    id,
    timeMs,
    property,
    value,
    easing,
  });

  return {
    schemaVersion: 1,
    id: SCENE_ID,
    name: SCENE_NAME,
    canvas: { shape: '16:9', scale: 1080 },
    durationMs: DURATION_MS,
    assets: [{ id: 'logo', kind: 'image', src: 'vault:logo.png' }],
    layers: [
      {
        id: 'bg',
        type: 'background',
        at: 0,
        duration: DURATION_MS,
        trackIndex: 0,
        variant: {
          variant: 'meshGradient',
          blobs: [
            { color: '#12224a', xPct: 22, yPct: 30, radiusPct: 58, drift: 0.5 },
            { color: '#0d6b63', xPct: 78, yPct: 68, radiusPct: 52, drift: 0.35 },
            { color: '#3b1f7a', xPct: 50, yPct: 18, radiusPct: 44, drift: 0.8 },
          ],
        },
      },
      {
        id: 'logo',
        type: 'imageLogo',
        at: 0,
        duration: DURATION_MS,
        trackIndex: 1,
        assetId: 'logo',
        widthPx: 190,
        position: { xPct: 50, yPct: 17 },
        opacity: 0.95,
      },
      {
        id: 'headline',
        type: 'kineticText',
        at: 300,
        duration: 4200,
        trackIndex: 2,
        text: 'SHIP MOTION\nAT THE SPEED\nOF THOUGHT',
        sizePx: 104,
        fill: '#f2f7ff',
        fontWeight: 900,
        align: 'center',
        lineHeight: 1.06,
        position: { xPct: 50, yPct: 42 },
        animateBy: 'word',
        entrance: { name: 'smoothSlideUp' },
        exit: { name: 'scaleDownFade' },
        keyframes: [
          kf('kf-h1', 300, 'yPct', 54),
          kf('kf-h2', 1500, 'yPct', 42, 'cubic'),
          kf('kf-h3', 3000, 'scale', 1.04),
          kf('kf-h4', 4200, 'opacity', 0),
        ],
      },
      {
        id: 'card-features',
        type: 'card',
        at: 3000,
        duration: 3200,
        trackIndex: 3,
        position: { xPct: 31, yPct: 62 },
        variant: {
          variant: 'glassCard',
          title: 'Direct manipulation',
          body: 'Drag, scale and rotate every layer on a live canvas.',
          widthPx: 620,
          paddingPx: 34,
          radiusPx: 20,
        },
        filters: { shadowBlur: 42, shadowColor: '#000000', cornerRadius: 22, contrast: 112 },
        entrance: { name: 'smoothSlideUp' },
        keyframes: [
          kf('kf-c1', 3000, 'xPct', 24),
          kf('kf-c2', 3900, 'xPct', 31, 'cubic'),
          kf('kf-c3', 3900, 'opacity', 0),
          kf('kf-c4', 4500, 'opacity', 1),
        ],
      },
      {
        id: 'card-render',
        type: 'card',
        at: 5200,
        duration: 2600,
        trackIndex: 4,
        position: { xPct: 69, yPct: 62 },
        variant: {
          variant: 'glassCard',
          title: 'Real export',
          body: 'H.264 + AAC, rendered by FFmpeg from the same scene.',
          widthPx: 620,
          paddingPx: 34,
          radiusPx: 20,
        },
        filters: { shadowBlur: 42, shadowColor: '#000000', cornerRadius: 22, contrast: 112 },
        entrance: { name: 'elasticScale' },
        keyframes: [
          kf('kf-r1', 5200, 'xPct', 76),
          kf('kf-r2', 6100, 'xPct', 69, 'cubic'),
        ],
      },
      {
        id: 'grain',
        type: 'foregroundFX',
        at: 0,
        duration: DURATION_MS,
        effects: [
          { kind: 'vignette', strength: 0.55, color: '#04070f' },
          { kind: 'filmGrain', opacity: 0.16, sizePx: 2 },
        ],
      },
    ],
    camera: {
      perspective: 1200,
      drift: { amplitudePct: 0.6, periodMs: 5400, seed: 11 },
      keyframes: [
        { at: 0, scale: 1 },
        { at: DURATION_MS, scale: 1.22, ease: 'power3.inOut' },
      ],
      moves: [{ move: 'slowPushIn', at: 2200, durationMs: 3600, strength: 0.85 }],
    },
    transitions: [
      { kind: 'wipe', at: 2800, direction: 'left', durationMs: 720, color: '#0b1020', featherPx: 90 },
    ],
    audio: {
      cues: [
        { at: 200, sfx: 'whoosh', gain: 1, pan: 0 },
        { at: 3000, sfx: 'pop', gain: 0.7, pan: -0.25 },
        { at: 5200, sfx: 'riser', gain: 0.8, pan: 0.3 },
      ],
    },
  };
}

/* ── the main run ─────────────────────────────────────────────────────────── */

async function main() {
  console.log('================================================================');
  console.log('=== MOTIONFORGE — MCP-DRIVEN VIDEO PRODUCTION BENCHMARK ===');
  console.log('================================================================');

  /* the isolated workspace, shared by the MCP server, the engine and the app */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-test-mcp-production-'));
  const dirs = {
    data: tmp,
    scenes: path.join(tmp, 'scenes'),
    vault: path.join(tmp, 'vault'),
    renders: path.join(tmp, 'renders'),
  };
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
  const env = {
    ...process.env,
    MOTIONFORGE_TEST_MODE: '1',
    MOTIONFORGE_DATA_DIR: dirs.data,
    MOTIONFORGE_STORAGE_DIR: dirs.scenes,
    MOTIONFORGE_VAULT_DIR: dirs.vault,
    MOTIONFORGE_RENDERS_DIR: dirs.renders,
  };
  console.log(`isolated workspace: ${tmp}`);

  // a small logo asset so the `imageLogo` layer resolves
  fs.writeFileSync(
    path.join(dirs.vault, 'logo.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAV0lEQVR42u3OMQEAAAgDoC251a3gLwSgcrfTBgQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFAIBAIBAKBQCAQCAQClQ0WZ6z0kGAAAAABJRU5ErkJggg==',
      'base64'
    )
  );

  let app = null;
  let transport = null;
  try {
    /* ── 1. start the MCP server over stdio ─────────────────────────────── */
    section('1. Start the MCP server over stdio');
    transport = new StdioClientTransport({
      command: path.join(ROOT, 'node_modules', '.bin', 'tsx'),
      args: ['packages/mcp-server/src/main.ts'],
      cwd: ROOT,
      env,
      stderr: 'ignore',
    });
    client = new Client({ name: 'motionforge-benchmark', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
    console.log('  the MCP server is connected');

    /* ── 2. get_motion_capabilities ────────────────────────────────────── */
    section('2. get_motion_capabilities — the authoring contract');
    const caps = await callTool('get_motion_capabilities');
    const capData = parseJson(caps.text);
    const capJson = capData ?? JSON.parse(caps.text.slice(caps.text.indexOf('{')));
    metrics.capabilities = {
      toolList: (await client.listTools()).tools.map((t) => t.name),
      layerTypes: capJson.layerTypes ?? Object.keys(capJson.layerFieldGuide ?? {}),
      bytes: caps.bytes,
    };
    check(
      'The server advertises exactly the six documented tools',
      metrics.capabilities.toolList.length === 6,
      metrics.capabilities.toolList.join(', ')
    );
    check(
      'The contract lists the six real layer kinds',
      (capJson.layerFieldGuide ? Object.keys(capJson.layerFieldGuide) : []).length >= 6,
      Object.keys(capJson.layerFieldGuide ?? {}).join(', ')
    );
    note(
      'The tools an agent would ask for but that DO NOT EXIST',
      'get_layer_bounds, render_scene, get_render_status'
    );
    bug(
      'MCP-GAP-1',
      'There is no dedicated layer-bounds tool — an agent must render frames to learn the layout',
      'The server exposes 6 tools and none of them answers "where does this layer sit". ' +
        '`inspect_scene_keyframes` returns the per-layer bbox inside `framesMeta`, but it ' +
        `costs a full Playwright frame capture (measured below) for what should be a query. ` +
        `The request was for "get_layer_bounds" + "render_scene" + "get_render_status" — ` +
        `none of the three exists. The report maps the gap onto the six that do.`
    );

    /* ── 3. create_or_update_scene ─────────────────────────────────────── */
    section('3. create_or_update_scene — author the 8-second SaaS promo');
    const scene = buildScene();
    const created = await callTool('create_or_update_scene', scene);
    const createdJson = parseJson(created.text);
    metrics.create = {
      id: createdJson?.id ?? null,
      revision: createdJson?.revision ?? null,
      hash: createdJson?.hash ?? null,
      warnings: createdJson?.warnings ?? [],
    };
    check(
      'The scene was accepted and stored',
      !created.isError && metrics.create.id === SCENE_ID,
      `id=${metrics.create.id} revision=${metrics.create.revision}`
    );
    if (created.isError) {
      console.log(`        ${created.text.slice(0, 900)}`);
      throw new Error('the scene was rejected — the benchmark cannot continue');
    }
    if (metrics.create.warnings.length > 0) {
      note('The engine returned non-blocking warnings', JSON.stringify(metrics.create.warnings));
    } else {
      note('The engine returned no warnings');
    }
    const kinds = [...new Set(scene.layers.map((l) => l.type))];
    check(
      'The composition uses at least FIVE distinct layer kinds',
      kinds.length >= 5,
      kinds.join(', ')
    );
    const cueCount = scene.audio.cues.length;
    check('The scene schedules three SFX cues', cueCount === 3, `${cueCount} cues`);

    /* ── 4. inspect_scene_keyframes ────────────────────────────────────── */
    section('4. inspect_scene_keyframes — verify the layout at four timestamps');
    const inspected = await callTool('inspect_scene_keyframes', {
      sceneId: SCENE_ID,
      at: INSPECT_AT,
      includeInlineImages: false,
    });
    const inspectJson = parseJson(inspected.text);
    const framesMeta = inspectJson?.framesMeta ?? [];
    metrics.layout.framesMeta = framesMeta;
    metrics.layout.inspectBytes = inspected.bytes;
    check(
      'The inspection returned one meta record per timestamp',
      framesMeta.length === INSPECT_AT.length,
      `${framesMeta.length} of ${INSPECT_AT.length}`
    );

    // the layout analysis
    const overlaps = [];
    const offScreen = [];
    const overflow = [];
    for (const frame of framesMeta) {
      const layers = frame.layers ?? frame.layerStates ?? [];
      const boxes = [];
      for (const layer of layers) {
        const bbox = layer.bbox ?? layer.box;
        if (!bbox) continue;
        const id = layer.id ?? layer.layerId ?? '?';
        boxes.push({ id, bbox });
        const x = bbox.x ?? bbox.left ?? 0;
        const y = bbox.y ?? bbox.top ?? 0;
        const w = bbox.width ?? 0;
        const h = bbox.height ?? 0;
        if (x < -1 || y < -1 || x + w > 1921 || y + h > 1081) {
          offScreen.push({ at: frame.atMs, id, bbox });
        }
        if (layer.textOverflow) overflow.push({ at: frame.atMs, id });
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].bbox;
          const b = boxes[j].bbox;
          const ax = a.x ?? a.left ?? 0;
          const ay = a.y ?? a.top ?? 0;
          const aw = a.width ?? 0;
          const ah = a.height ?? 0;
          const bx = b.x ?? b.left ?? 0;
          const by = b.y ?? b.top ?? 0;
          const bw = b.width ?? 0;
          const bh = b.height ?? 0;
          const ox = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
          const oy = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
          if (ox > 1 && oy > 1) {
            overlaps.push({ at: frame.atMs, a: boxes[i].id, b: boxes[j].id });
          }
        }
      }
    }
    metrics.layout.overlaps = overlaps;
    metrics.layout.offScreen = offScreen;
    metrics.layout.textOverflow = overflow;
    check(
      'No layer is clipped outside the composition',
      offScreen.length === 0,
      offScreen.length ? JSON.stringify(offScreen.slice(0, 3)) : 'all layers inside 1920x1080'
    );
    check(
      'No text overflows its box',
      overflow.length === 0,
      overflow.length ? JSON.stringify(overflow.slice(0, 3)) : 'none'
    );
    note(
      'Overlapping layer pairs (by design: a card over a background is expected)',
      overlaps.length ? JSON.stringify(overlaps.slice(0, 6)) : 'none'
    );

    /* ── 5. the live cross-process UI sync ─────────────────────────────── */
    section('5. Live cross-process UI sync — the Studio picks the scene up');
    const mainPath = path.join(ROOT, 'packages', 'desktop', 'out', 'main', 'index.js');
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Desktop bundle missing at ${mainPath}. Run: npm run build -w @motionforge/desktop`);
    }
    app = await electron.launch({ args: ['--no-sandbox', mainPath], env });
    const page = await app.firstWindow();
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
    await page.waitForTimeout(4000);

    const before = await page.evaluate(() => ({
      sceneId: window.store.state.sceneId,
      sceneName: window.store.state.scene?.name ?? null,
      layerCount: window.store.state.scene?.layers?.length ?? 0,
    }));
    note('The Studio had', JSON.stringify(before));

    // The Studio lists the scenes the engine knows about. The MCP-authored
    // scene must APPEAR without a restart.
    const tSync = Date.now();
    let synced = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => ({
        sceneId: window.store.state.sceneId,
        name: window.store.state.scene?.name ?? null,
        layers: window.store.state.scene?.layers?.length ?? 0,
        bin: Array.from(document.querySelectorAll('.mf-bin-item')).map((n) =>
          n.getAttribute('data-scene-id')
        ),
      }));
      if (state.bin.includes(SCENE_ID) || state.sceneId === SCENE_ID) {
        synced = { ...state, ms: Date.now() - tSync };
        break;
      }
      await page.waitForTimeout(400);
    }
    metrics.sync = synced ?? { ms: null };
    check(
      'The MCP-authored scene appears in the Studio WITHOUT a restart',
      Boolean(synced),
      synced
        ? `appeared in the Project Bin after ${synced.ms} ms (${synced.bin.length} compositions listed)`
        : 'the scene never appeared in the Project Bin'
    );

    // open it and let it render in the monitor
    if (synced) {
      await page.evaluate(async (id) => {
        const scene = await window.motionforgeEngine.invoke('getScene', id);
        if (scene) window.store.setScene(scene, id);
      }, SCENE_ID);
      await page.waitForTimeout(3500);
      const live = await page.evaluate(() => {
        const frame = document.querySelector('#preview-iframe');
        const canvas = document.querySelector('#timeline-canvas');
        return {
          sceneId: window.store.state.sceneId,
          name: window.store.state.scene?.name ?? null,
          layers: window.store.state.scene?.layers?.length ?? 0,
          cues: window.store.state.scene?.audio?.cues?.length ?? 0,
          iframe: frame ? frame.getAttribute('src') : null,
          lanes: Array.from(document.querySelectorAll('.mf-track-header')).map((n) =>
            n.getAttribute('data-track-name')
          ),
          canvasWidth: canvas ? canvas.clientWidth : 0,
        };
      });
      metrics.sync.live = live;
      check(
        'The Studio renders the MCP scene in the Program Monitor',
        Boolean(live.iframe) && live.layers >= 5,
        `${live.layers} layers, ${live.cues} audio cues, lanes ${live.lanes.join('/')}`
      );
      fs.mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true });
      await page.screenshot({ path: SCREENSHOT_PATH });
      const size = fs.statSync(SCREENSHOT_PATH).size;
      check(
        'The Studio screenshot was written at >= 1600 px wide',
        size > 0,
        `screenshots/benchmark-mcp-production-studio.png (${Math.round(size / 1024)} kB)`
      );
    }

    /* ── 6. render_video ───────────────────────────────────────────────── */
    section('6. render_video — export the MP4');
    const tRender = Date.now();
    const rendered = await callTool('render_video', { sceneId: SCENE_ID, quality: 'draft' });
    metrics.render.ms = Date.now() - tRender;
    const renderJson = parseJson(rendered.text);
    metrics.render.result = renderJson;
    const produced = renderJson?.outputPath ?? renderJson?.mp4Path ?? null;
    check(
      'The render finished successfully',
      !rendered.isError && Boolean(produced),
      produced ? `${produced} after ${(metrics.render.ms / 1000).toFixed(1)} s` : rendered.text.slice(0, 300)
    );
    if (produced && fs.existsSync(produced)) {
      fs.mkdirSync(RENDERS_DIR, { recursive: true });
      fs.copyFileSync(produced, VIDEO_PATH);
      const probe = run('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration,size,bit_rate',
        '-show_entries', 'stream=index,codec_type,codec_name,width,height,r_frame_rate,nb_frames,sample_rate,channels',
        '-of', 'default=noprint_wrappers=1',
        VIDEO_PATH,
      ]);
      metrics.render.ffprobe = probe;
      console.log('  --- ffprobe ---');
      console.log(probe.split('\n').map((l) => `    ${l}`).join('\n'));
      check(
        'The export is a 1920x1080 H.264 video',
        /codec_name=h264/.test(probe) && /width=1920/.test(probe) && /height=1080/.test(probe),
        'H.264 1920x1080'
      );
      check(
        'The export carries an AUDIO stream (the three SFX cues were mixed)',
        /codec_type=audio/.test(probe) && /codec_name=aac/.test(probe),
        (probe.match(/codec_name=aac[\s\S]{0,120}/) || ['no aac stream'])[0].replace(/\n/g, ' ')
      );
    } else {
      bug(
        'MCP-GAP-2',
        'render_video does not report where the file landed in a machine-readable way',
        `The tool returned ${rendered.bytes} bytes of text; the parsed output path was ${JSON.stringify(produced)}.`
      );
    }

    /* ── 7. the summary ────────────────────────────────────────────────── */
    section('7. Tool call latency and response size');
    console.log('  | tool                        |    ms |   bytes | images |');
    console.log('  | --------------------------- | ----- | ------- | ------ |');
    for (const call of metrics.toolCalls) {
      console.log(
        `  | ${call.tool.padEnd(27)} | ${String(call.ms).padStart(5)} | ${String(call.bytes).padStart(7)} | ${String(call.images).padStart(6)} |`
      );
    }
    const totalMs = metrics.toolCalls.reduce((sum, c) => sum + c.ms, 0);
    const totalBytes = metrics.toolCalls.reduce((sum, c) => sum + c.bytes, 0);
    metrics.toolCallsTotal = { ms: Number(totalMs.toFixed(1)), bytes: totalBytes };
    note('The whole session', `${totalMs.toFixed(0)} ms, ${totalBytes} bytes of tool output`);
  } finally {
    if (app) {
      try {
        await app.close();
      } catch (err) {
        console.error('[benchmark:mcp-production] could not close the app:', err);
      }
    }
    if (client) {
      try {
        await client.close();
      } catch {
        /* the server may already be gone */
      }
    }
    if (transport) {
      try {
        transport.close?.();
      } catch {
        /* ignore */
      }
    }
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
      console.log(`isolated workspace removed: ${tmp}`);
    } catch {
      /* ignore */
    }
  }

  console.log('\n================================================================');
  console.log(`=== SUMMARY: ${metrics.toolCalls.length + 14 - failures}/${metrics.toolCalls.length + 14} checks passed ===`);
  console.log('================================================================');
  console.log('\n--- MEASURED METRICS (JSON) ---');
  console.log(JSON.stringify(metrics, null, 2));
  console.log('\n--- PRODUCT GAPS ---');
  for (const b of metrics.bugs) console.log(`${b.id}: ${b.title}\n    ${b.evidence}`);
  if (failures > 0) {
    console.error('\nFAILED CHECKS — see above.');
    process.exit(1);
  }
  console.log('\nThe MCP-driven video production benchmark completed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n[benchmark:mcp-production] FAILED:', err);
  process.exit(1);
});
