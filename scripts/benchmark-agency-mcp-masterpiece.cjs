#!/usr/bin/env node
/** MotionForge v5.0 flagship benchmark: a real 17-tool MCP stdio session. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeTestEnv, cleanupTestDirs } = require('./lib/test-env.cjs');

const ROOT = path.resolve(__dirname, '..');
const KEEP = process.argv.includes('--keep');
const SFX_NAMES = new Set([
  'shimmer', 'riser', 'whoosh', 'subImpact', 'pop', 'click',
  'typingTick', 'mouseClick', 'notificationChime', 'bassDrop',
  'glitchHit', 'softSwoosh', 'counterTick', 'ambientPad',
]);
const allLayers = new Set();
const latencies = [];
const scores = [];
const cues = [];
const serverLog = [];
const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };
const section = (title) => console.log(`\n=== ${title} ===`);

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect x="4" y="4" width="112" height="112" rx="26" fill="#38bdf8"/><path d="M30 82V38h14l16 22 16-22h14v44H76V62L64 78H56L44 62v20z" fill="#07111f"/></svg>`;
const LOTTIE_JSON = JSON.stringify({
  v: '5.7.0', fr: 15, ip: 0, op: 60, w: 120, h: 120, nm: 'check', ddd: 0,
  assets: [], layers: [{ ddd: 0, ind: 1, ty: 4, nm: 'check', sr: 1,
    ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [60, 60, 0] }, a: { a: 0, k: [0, 0, 0] },
      s: { a: 1, k: [{ t: 0, s: [0, 0, 100], e: [100, 100, 100] }, { t: 30, s: [100, 100, 100], e: [100, 100, 100] }] } },
    ao: 0, shapes: [{ ty: 'gr', it: [{ ty: 'rc', d: 1, s: { a: 0, k: [72, 72] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 14 }, nm: 'box' }, { ty: 'fl', c: { a: 0, k: [0.22, 0.78, 0.98, 1] }, o: { a: 0, k: 100 }, r: 1, nm: 'fill' }, { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }] }], ip: 0, op: 60, st: 0, bm: 0,
  }],
});

function makeBenchDirs() {
  const root = path.join(os.tmpdir(), `motionforge-bench-${process.pid}`);
  const result = { root, data: root, scenes: path.join(root, 'scenes'), vault: path.join(root, 'vault'), renders: path.join(root, 'renders') };
  for (const dir of [result.root, result.scenes, result.vault, result.renders]) fs.mkdirSync(dir, { recursive: true });
  return result;
}
function toolPayload(result) {
  return result.structuredContent || {};
}
async function callTool(client, name, args, timeout = 900000) {
  const started = process.hrtime.bigint();
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout });
  const wallMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
  latencies.push({ tool: name, wallMs });
  const structured = toolPayload(result);
  const text = (result.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
  console.log(`  ${name.padEnd(32)} ${wallMs} ms`);
  if (result.isError) fail(`${name} failed: ${text}`);
  return { result, structured, text };
}
function run(bin, args) {
  const p = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  return { status: p.status, stdout: p.stdout || '', stderr: p.stderr || '' };
}
function baseScene(id, name, layers, assets) {
  return { schemaVersion: 1, id, name, canvas: { shape: '16:9', scale: 1080 }, durationMs: 4000,
    assets, fonts: [], themePreset: 'linearMinimal', audio: { cues: [] }, transitions: [], layers };
}
function timed(layer) { return { at: 0, duration: 4000, direction: 'ltr', ...layer }; }
function kinetic(id, text, extra = {}) {
  return timed({ id, type: 'kineticText', text, role: 'headline', fontWeight: 700, sizePx: 54, lineHeight: 1.15, letterSpacingPx: 0, align: 'center', animateBy: 'word', fill: '#f8fafc', ...extra });
}
function assets() { return [{ id: 'brandLogo', kind: 'image', src: 'vault:logo.svg' }, { id: 'checkAnim', kind: 'lottie', src: 'vault:check.json' }]; }

function sceneOne() {
  return baseScene('agency-hook', 'Agency Showcase Hook', [
    timed({ id: 'bg-hook', type: 'background', variant: { variant: 'meshGradient', base: '#07111f', blobs: [
      { color: '#075985', xPct: 20, yPct: 22, radiusPct: 45, drift: 0 }, { color: '#312e81', xPct: 80, yPct: 28, radiusPct: 42, drift: 0 }, { color: '#164e63', xPct: 52, yPct: 82, radiusPct: 38, drift: 0 },
    ] } }),
    kinetic('hook-title', 'From brief to broadcast-ready', { layoutSlot: 'topHeader', size: { widthPct: 68, heightPct: 12 }, entrance: { name: 'smoothSlideUp', durationMs: 500 } }),
    timed({ id: 'hook-logo', type: 'imageLogo', assetId: 'brandLogo', widthPx: 120, heightPx: 120, position: { xPct: 50, yPct: 29 }, layoutSlot: 'topSubhead', size: { widthPct: 20, heightPct: 10 }, mask: 'squircle', glow: { color: '#38bdf8', strength: 0.7 } }),
    timed({ id: 'hook-metric', type: 'metricTicker', label: 'SCENES ORCHESTRATED', fromValue: 0, toValue: 16, suffix: ' layers', accentColor: '#38bdf8', layoutSlot: 'bottomCenterCta', size: { widthPct: 36, heightPct: 12 } }),
    timed({ id: 'hook-bento', type: 'bentoGrid', layoutSlot: 'centerStage', size: { widthPct: 44, heightPct: 24 }, columns: 2, staggerMs: 100, cells: [
      { title: 'Author', subtitle: 'Strict SceneSpec', metricValue: '01', badge: 'JSON', accentColor: '#38bdf8' },
      { title: 'Critique', subtitle: 'Deterministic checks', metricValue: '07', badge: 'QA', accentColor: '#818cf8' },
      { title: 'Compose', subtitle: 'Sequential render', metricValue: '60', badge: 'FPS', accentColor: '#22c55e' },
      { title: 'Deliver', subtitle: 'Master MP4', metricValue: '100', badge: 'READY', accentColor: '#f59e0b' },
    ] }),
    timed({ id: 'hook-dust', type: 'particleField', count: 60, pattern: 'float', color: '#7dd3fc', color2: '#a78bfa', speed: 0.6, size: 2, seed: 42, opacity: 0.28 }),
    timed({ id: 'hook-vignette', type: 'foregroundFX', effects: [{ kind: 'vignette', strength: 0.32, color: '#000000' }] }),
  ], assets());
}
function sceneTwo() {
  return baseScene('agency-product', 'Agency Product Proof', [
    timed({ id: 'bg-product', type: 'background', variant: { variant: 'solid', color: '#07111f' } }),
    timed({ id: 'product-code', type: 'codeBlock', position: { xPct: 50, yPct: 16 }, layoutSlot: 'topHeader', size: { widthPct: 62, heightPct: 10 }, language: 'typescript', title: 'scene.ts', code: "const master = await composeStoryboardVideo({ wait: true });", theme: 'midnight', highlightLines: [1] }),
    timed({ id: 'product-device', type: 'deviceMockup', deviceType: 'browser', theme: 'dark', contentVariant: 'dashboard', titleOrUrl: 'agency.motionforge.ai', headline: 'Live render telemetry', accentColor: '#38bdf8', layoutSlot: 'splitLeft', size: { widthPct: 36, heightPct: 40 } }),
    timed({ id: 'product-diagram', type: 'connectorDiagram', position: { xPct: 72, yPct: 38 }, layoutSlot: 'splitRight', size: { widthPct: 36, heightPct: 40 }, nodes: [
      { id: 'brief', label: 'Brief', sublabel: 'Input', xPct: 20, yPct: 50, accentColor: '#38bdf8' },
      { id: 'engine', label: 'Engine', sublabel: 'Critique + render', xPct: 80, yPct: 50, accentColor: '#818cf8' },
    ], edges: [{ from: 'brief', to: 'engine', label: 'SceneSpec', animatedPulse: true }] }),
    timed({ id: 'product-card', type: 'card', position: { xPct: 29, yPct: 84 }, layoutSlot: 'gridBottomLeft', size: { widthPct: 36, heightPct: 12 }, variant: { variant: 'glassCard', title: 'One contract', body: 'Validate, inspect, render', widthPx: 520, paddingPx: 24, radiusPx: 20, borderOpacity: 0.25 } }),
    timed({ id: 'product-lottie', type: 'lottie', assetId: 'checkAnim', position: { xPct: 86, yPct: 90 }, layoutSlot: 'gridBottomRight', size: { widthPct: 12, heightPct: 8 }, widthPx: 120 }),
    timed({ id: 'product-cursor', type: 'cursorFlow', cursorStyle: 'pointer', accentColor: '#38bdf8', waypoints: [
      { atMs: 0, xPct: 22, yPct: 55, action: 'move' }, { atMs: 1000, xPct: 36, yPct: 55, action: 'hover', label: 'Preview' }, { atMs: 1800, xPct: 36, yPct: 55, action: 'click' }, { atMs: 2800, xPct: 64, yPct: 55, action: 'click' },
    ] }),
  ], assets());
}
function sceneThree() {
  return baseScene('agency-proof', 'Agency Results Proof', [
    timed({ id: 'bg-proof', type: 'background', variant: { variant: 'solid', color: '#07111f' } }),
    kinetic('proof-title', 'Proof you can ship', { layoutSlot: 'topHeader', size: { widthPct: 60, heightPct: 10 } }),
    timed({ id: 'proof-chart', type: 'chart', chartType: 'bar', position: { xPct: 50, yPct: 29 }, layoutSlot: 'topSubhead', size: { widthPct: 60, heightPct: 10 }, title: 'Iteration speed', data: [{ label: 'Draft', value: 4.2, color: '#38bdf8' }, { label: 'Master', value: 9.8, color: '#818cf8' }], accentColor: '#38bdf8', labelColor: '#f8fafc', showValues: true, widthPx: 760, heightPx: 260 }),
    timed({ id: 'proof-comparison', type: 'comparisonSplit', layoutSlot: 'centerStage', size: { widthPct: 54, heightPct: 26 }, leftTitle: 'Old workflow', leftItems: ['Manual fixes', 'Hidden layout bugs'], rightTitle: 'Agency engine', rightItems: ['Autofix report', 'Deterministic master'], leftAccent: '#fb7185', rightAccent: '#34d399', vsBadge: 'VS' }),
    timed({ id: 'proof-subhead', type: 'kineticText', text: 'Critique. Choreograph. Compose.', role: 'body', fontWeight: 600, sizePx: 30, lineHeight: 1.15, letterSpacingPx: 0, align: 'center', animateBy: 'word', fill: '#cbd5e1', layoutSlot: 'bottomSubhead', size: { widthPct: 60, heightPct: 8 } }),
    timed({ id: 'proof-cta', type: 'cta', position: { xPct: 50, yPct: 90 }, layoutSlot: 'bottomCenterCta', label: 'Ship the showcase', sublabel: '17 tools. One engine.', variant: 'primary', accentColor: '#38bdf8', icon: 'arrow', widthPx: 420, heightPx: 68, labelSizePx: 20 }),
  ], assets());
}
function brokenScene() {
  return baseScene('agency-broken', 'Intentional Critique Probe', [
    timed({ id: 'broken-bg', type: 'background', variant: { variant: 'solid', color: '#0f172a' } }),
    timed({ id: 'broken-text', type: 'kineticText', text: 'Low contrast overlap', position: { xPct: 90, yPct: 50 }, fill: '#111827', sizePx: 110, role: 'headline', fontWeight: 800, lineHeight: 1.1, letterSpacingPx: 0, align: 'center', animateBy: 'word' }),
    timed({ id: 'broken-card', type: 'card', position: { xPct: 110, yPct: 50 }, variant: { variant: 'glassCard', title: 'Too far right', body: 'This is intentionally broken', widthPx: 1000, paddingPx: 30, radiusPx: 20, borderOpacity: 0.2 } }),
  ], assets());
}

async function main() {
  let dirs;
  let client;
  let transport;
  try {
    dirs = makeBenchDirs();
    const env = makeTestEnv(dirs);
    console.log(`isolated workspace: ${dirs.root}`);
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'packages/mcp-server/src/main.ts'], cwd: ROOT, env, stderr: 'pipe' });
    transport.stderr?.on('data', (data) => serverLog.push(String(data)));
    client = new Client({ name: 'agency-flagship-benchmark', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);

    section('1. Contract and assets');
    const listed = await client.listTools();
    assert(listed.tools.length === 17, `expected 17 tools, got ${listed.tools.length}`);
    console.log(`  tools (${listed.tools.length}): ${listed.tools.map((tool) => tool.name).join(', ')}`);
    const capsCall = await callTool(client, 'get_motion_capabilities', {});
    const caps = capsCall.structured.capabilities || capsCall.structured;
    const layerTypes = caps.layerTypes || caps.registries?.layerTypes || Object.keys(caps.layerFieldGuide || {});
    const themePresets = caps.themePresets || caps.registries?.themePresets || [];
    assert(layerTypes.length === 16, `expected 16 layer kinds, got ${layerTypes.length}`);
    assert(themePresets.length === 6, `expected 6 themes, got ${themePresets.length}`);
    await callTool(client, 'upload_asset', { name: 'logo.svg', kind: 'image', contentText: LOGO_SVG });
    await callTool(client, 'upload_asset', { name: 'check.json', kind: 'lottie', contentText: LOTTIE_JSON });

    section('2. Author three flagship scenes');
    const scenes = [sceneOne(), sceneTwo(), sceneThree()];
    for (const scene of scenes) {
      const call = await callTool(client, 'create_or_update_scene', scene);
      const payload = call.structured;
      assert(payload.id === scene.id, `scene ${scene.id} did not return its id`);
      assert(!payload.issues || payload.issues.length === 0, `scene ${scene.id} issues: ${JSON.stringify(payload.issues)}`);
      for (const layer of scene.layers) allLayers.add(layer.type);
    }
    assert(allLayers.size === 16, `flagship layer union has ${allLayers.size}, expected 16`);
    console.log(`  layer union: ${[...allLayers].join(', ')}`);

    section('3. Critique and autofix');
    const brokenCall = await callTool(client, 'create_or_update_scene', brokenScene());
    assert(brokenCall.structured.id === 'agency-broken', 'broken scene was not stored');
    const brokenCritique = await callTool(client, 'critique_and_autofix_scene', { sceneId: 'agency-broken', autoApplyFixes: true });
    const brokenReport = brokenCritique.structured;
    assert(brokenReport.scoreBefore < 65, `broken scoreBefore ${brokenReport.scoreBefore} is not <65`);
    assert(brokenReport.scoreAfter >= 95, `broken scoreAfter ${brokenReport.scoreAfter} is not >=95`);
    assert(!(brokenReport.issuesAfter || []).some((issue) => issue.rule === 'FOREGROUND_OVERLAP'), 'broken scene retained foreground overlap');
    scores.push({ scene: 'agency-broken', before: brokenReport.scoreBefore, after: brokenReport.scoreAfter, issues: (brokenReport.issuesAfter || []).length });

    for (const scene of scenes) {
      const reportCall = await callTool(client, 'critique_and_autofix_scene', { sceneId: scene.id, autoApplyFixes: true });
      const report = reportCall.structured;
      scores.push({ scene: scene.id, before: report.scoreBefore, after: report.scoreAfter, issues: (report.issuesAfter || []).length });
      if ((report.issuesAfter || []).length) {
        const bounds = await callTool(client, 'get_layer_bounds', { sceneId: scene.id, at: [250] });
        console.dir(bounds.structured, { depth: 6 });
      }
      assert((report.issuesAfter || []).length === 0, `${scene.id} retained issues: ${JSON.stringify(report.issuesAfter)}`);
    }
    console.table(scores);

    section('4. Audio choreography');
    const cueUnion = new Set();
    for (const scene of scenes) {
      const call = await callTool(client, 'auto_choreograph_audio', { sceneId: scene.id, includeAmbientBed: true, overwriteExisting: true, masterGain: 0.7 });
      const report = call.structured;
      for (const [name, count] of Object.entries(report.bySfx || {})) { if (count) cueUnion.add(name); }
      cues.push({ scene: scene.id, total: report.totalCues, bySfx: JSON.stringify(report.bySfx || {}) });
    }
    assert(cueUnion.size === 14 && [...SFX_NAMES].every((name) => cueUnion.has(name)), `audio union missing: ${[...SFX_NAMES].filter((name) => !cueUnion.has(name)).join(', ')}`);
    console.table(cues);

    section('5. Compose draft masterpiece');
    const compose = await callTool(client, 'compose_storyboard_video', { outputName: 'agency-masterpiece-showcase', quality: 'draft', wait: true, scenes: [
      { sceneId: 'agency-hook', transitionToNext: 'fade', transitionDurationMs: 400 },
      { sceneId: 'agency-product', transitionToNext: 'fade', transitionDurationMs: 400 },
      { sceneId: 'agency-proof', transitionToNext: 'cut', transitionDurationMs: 0 },
    ] }, 1_200_000);
    const report = compose.structured;
    assert(report.probe && report.probe.durationSec >= 10.9 && report.probe.durationSec <= 11.5, `master duration ${report.probe?.durationSec} is not 11.2s`);
    const video = report.probe.streams.filter((stream) => stream.type === 'video');
    const audio = report.probe.streams.filter((stream) => stream.type === 'audio');
    assert(video.length === 1 && video[0].codec === 'h264', `master video stream invalid: ${JSON.stringify(video)}`);
    assert(audio.length === 1 && audio[0].codec === 'aac', `master audio stream invalid: ${JSON.stringify(audio)}`);
    assert(report.scenes.length === 3 && report.scenes.every((scene) => scene.workerCount === 1), 'compose did not render all scenes on one worker');
    assert(!serverLog.join('\n').match(/OOM|out of memory|killed/i), 'server log contains OOM/out-of-memory/killed');
    console.log(`  master: ${report.durationMs}ms, ${report.probe.sizeBytes} bytes`);
    console.table(report.scenes.map((scene) => ({ scene: scene.sceneId, durationMs: scene.durationMs, frames: scene.frames, workerCount: scene.workerCount, renderWallMs: scene.renderWallMs })));
    console.table(report.telemetry ? [report.telemetry] : []);

    section('6. Stills and audio proof');
    for (const second of [1, 3, 5, 7, 9, 11]) {
      const output = path.join(dirs.renders, `agency-masterpiece-t${second}.png`);
      const still = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(second), '-i', report.outputPath, '-frames:v', '1', '-y', output]);
      assert(still.status === 0 && fs.statSync(output).size > 0, `still at ${second}s failed`);
    }
    for (const start of [0, 3.6, 7.2]) {
      const audio = run('ffmpeg', ['-hide_banner', '-ss', String(start), '-t', '4', '-i', report.outputPath, '-af', 'volumedetect', '-f', 'null', '-']);
      const match = `${audio.stdout}\n${audio.stderr}`.match(/mean_volume:\s*(-?[0-9.]+) dB/);
      const mean = match ? Number(match[1]) : -Infinity;
      assert(audio.status === 0 && mean > -50, `audio window ${start}s is silent (${mean} dB)`);
      console.log(`  audio ${start.toFixed(1)}s mean_volume=${mean} dB`);
    }

    section('7. Benchmark tables');
    console.table(latencies);
    console.log(JSON.stringify(report.probe, null, 2));
    console.log('EXIT=0');
  } catch (error) {
    console.error(`\nBENCHMARK FAILED: ${error instanceof Error ? error.stack : String(error)}`);
    console.log('EXIT=1');
    process.exitCode = 1;
  } finally {
    await client?.close().catch(() => undefined);
    if (dirs && (KEEP ? console.log(`kept workspace: ${dirs.root}`) : cleanupTestDirs(dirs))) {
      // cleanupTestDirs intentionally returns undefined; this branch only keeps the finally explicit.
    }
  }
}

void main();
