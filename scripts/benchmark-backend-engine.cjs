#!/usr/bin/env node
/**
 * MotionForge — BACKEND / ENGINE BENCHMARK.
 *
 * Four measurements against the REAL `@motionforge/core-engine`:
 *
 *   1. SCHEMA & SANITIZER STRESS  — validate + sanitize many scenes that cover
 *      every real layer kind (background, imageLogo, kineticText, card, lottie,
 *      foregroundFX) with dense keyframes, every filter key at its legal
 *      extreme, out-of-range coordinates and legacy/transient properties.
 *   2. CONCURRENCY & ATOMIC PERSISTENCE — 25 concurrent `saveScene` calls on
 *      one id and across five ids; checks for corrupted JSON, leftover `.tmp`
 *      files and revision monotonicity.
 *   3. PLAYWRIGHT ZERO-PORT INSPECTION LATENCY — cold vs warm latency of
 *      `inspectKeyframes` and `getLayerBounds` (the cold path is measured in a
 *      CHILD process so the browser launch is really cold).
 *   4. FFmpeg RENDER THROUGHPUT & AUDIO MIXING — a real multi-layer render
 *      with three delayed SFX cues, ffprobe-verified, with the capture phase
 *      and the encode phase measured separately.
 *
 * ISOLATION
 *   The engine resolves its storage from MOTIONFORGE_DATA_DIR /
 *   MOTIONFORGE_STORAGE_DIR / MOTIONFORGE_VAULT_DIR / MOTIONFORGE_RENDERS_DIR.
 *   They are pointed at a throw-away tree under the OS temp dir and removed in
 *   a `finally`, so the developer's `~/.motionforge` is never read or written.
 *
 * Usage:
 *   node scripts/benchmark-backend-engine.cjs
 *   node scripts/benchmark-backend-engine.cjs --skip-production
 */
'use strict';

require('tsx/cjs');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync, spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const {
  makeTestDirs,
  makeTestEnv,
  cleanupTestDirs,
  describeTestDirs,
} = require('./lib/test-env.cjs');

const ROOT = path.resolve(__dirname, '..');

// The public package surface + the internal modules the phase breakdown needs.
const SPEC = require('@motionforge/scene-spec');
const CORE = require('@motionforge/core-engine');
const RENDERER = require(path.join(ROOT, 'packages/core-engine/src/renderer.ts'));
const ENCODER = require(path.join(ROOT, 'packages/core-engine/src/encoder.ts'));

const { validateScene, sanitizeSceneInput, sanitizeSceneInputWithReport } = SPEC;
const { createEngineCore } = CORE;

const ARGV = process.argv.slice(2);
const HAS_FLAG = (flag) => ARGV.includes(flag);
const PHASE = (() => {
  const hit = ARGV.find((a) => a.startsWith('--phase='));
  return hit ? hit.slice('--phase='.length) : null;
})();

/* ── output helpers ─────────────────────────────────────────────────────── */

const startedAt = Date.now();
function section(title) {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
}
function sub(title) {
  console.log(`\n--- ${title} ---`);
}
function line(label, value) {
  console.log(`  ${String(label).padEnd(46)} ${value}`);
}
function fail(message) {
  console.log(`  !! ${message}`);
}

/* ── statistics ─────────────────────────────────────────────────────────── */

/** Nearest-rank percentile over an ascending array (p in 0..1). */
function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return NaN;
  const rank = Math.ceil(p * sortedAsc.length);
  const index = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[index];
}
function mean(values) {
  if (values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function summarize(values, decimals = 3) {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (n) => Number(n.toFixed(decimals));
  return {
    n: sorted.length,
    mean: round(mean(sorted)),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
  };
}
function fmtStats(stats, unit = 'ms') {
  return (
    `n=${stats.n} mean=${stats.mean}${unit} p50=${stats.p50}${unit} ` +
    `p95=${stats.p95}${unit} p99=${stats.p99}${unit} min=${stats.min}${unit} max=${stats.max}${unit}`
  );
}
function fmtMs(v) {
  return `${Number(v).toFixed(1)} ms`;
}

/* ── scene construction ─────────────────────────────────────────────────── */

const SCENE_DURATION_MS = 6000;

/**
 * Dense keyframes across all five animatable properties.
 * Eight samples per property = 40 keyframes per layer.
 */
function denseKeyframes(layerId, mode, perProperty = 8) {
  const out = [];
  const props = ['xPct', 'yPct', 'scale', 'rotation', 'opacity'];
  const legal = {
    xPct: [-300, -120, 0, 60, 120, 300, -300, 300],
    yPct: [300, 90, 0, -45, -90, -300, 300, -300],
    scale: [0.05, 0.5, 1, 1.75, 3, 10, 0.05, 10],
    rotation: [-3600, -540, 0, 180, 540, 3600, -3600, 3600],
    opacity: [0, 0.25, 0.5, 0.75, 1, 1, 0, 1],
  };
  const illegal = {
    xPct: [-900, 900, 0, 500, -500, 1200, -1200, 300],
    yPct: [900, -900, 0, 400, -400, 700, -700, -300],
    scale: [50, 0.001, 1, 25, 12, 0.02, 99, 10],
    rotation: [9000, -9000, 0, 4500, -4500, 7200, -7200, 3600],
    opacity: [5, -3, 0.5, 1, 0, 2, -1, 1],
  };
  const table = mode === 'illegal' ? illegal : legal;
  let n = 0;
  for (const property of props) {
    const values = table[property];
    for (let i = 0; i < Math.min(perProperty, values.length); i++) {
      out.push({
        id: `kf-${layerId}-${property}-${i}`.slice(0, 60),
        timeMs: Math.round((i / 7) * (SCENE_DURATION_MS - 200)),
        property,
        value: values[i],
        easing: ['linear', 'easeIn', 'easeOut', 'easeInOut', 'cubic'][i % 5],
      });
      n++;
    }
  }
  return out;
}

/** Every filter key, at its legal extreme (or beyond it in `illegal` mode). */
function extremeFilters(mode) {
  if (mode === 'illegal') {
    return {
      blur: 900,
      brightness: 2000,
      contrast: -50,
      saturate: 900,
      shadowBlur: 400,
      shadowColor: 'not-a-colour',
      cornerRadius: 900,
    };
  }
  return {
    blur: 200,
    brightness: 400,
    contrast: 400,
    saturate: 400,
    shadowBlur: 200,
    shadowColor: '#00000080',
    cornerRadius: 400,
  };
}

/**
 * Build a scene that exercises EVERY real layer kind.
 *
 * mode:
 *   'legal'   — every value inside its legal range (the extremes themselves)
 *   'illegal' — the same scene with out-of-range values (the sanitizer's job)
 *   'legacy'  — 'legal' plus the retired `_hidden` / `_locked` markers and an
 *               unknown `_`-prefixed transient key
 */
function buildRichScene(mode, overrides = {}, opts = {}) {
  const filters = extremeFilters(mode);
  const illegal = mode === 'illegal';
  const kfCount = opts.keyframeCount ?? 8;

  const pos = (x, y) => (illegal ? { xPct: x * 2, yPct: y * 2 } : { xPct: x, yPct: y });
  const rot = (r) => (illegal ? r * 3 : r);
  const scl = (s) => (illegal ? (s > 1 ? s * 3 : s / 20) : s);

  const layers = [
    {
      id: 'bg',
      type: 'background',
      name: 'Background',
      variant: {
        variant: 'meshGradient',
        base: '#05070d',
        blobs: [
          { color: '#3b1f7a', xPct: 20, yPct: 28, radiusPct: 62, drift: 0.45 },
          { color: '#1b3a80', xPct: 80, yPct: 36, radiusPct: 55, drift: 0.3 },
          { color: '#0f766e', xPct: 50, yPct: 90, radiusPct: 40, drift: 0.8 },
        ],
      },
      position: pos(50, 50),
      rotation: rot(0),
      scale: scl(1),
      filters,
      keyframes: denseKeyframes('bg', mode, kfCount),
    },
    {
      id: 'logo',
      type: 'imageLogo',
      name: 'Logo',
      assetId: 'logo',
      widthPx: 320,
      position: pos(-300, -300),
      mask: 'squircle',
      cornerRadiusPx: 48,
      shadow: { color: '#000000', opacity: 0.45, blurPx: 24, offsetYpx: 10 },
      ring: { widthPx: 4, color: '#a5f3fc', opacity: 0.6 },
      glow: { color: '#22d3ee', strength: 1.4 },
      glass: { blurPx: 18, tintColor: '#ffffff', tintOpacity: 0.08 },
      lightSweep: { at: 400, durationMs: 900, angleDeg: 25, color: '#ffffff', widthFactor: 0.35 },
      rotation: rot(3600),
      scale: scl(0.05),
      opacity: 1,
      filters,
      keyframes: denseKeyframes('logo', mode, kfCount),
      sfx: [{ sfx: 'whoosh', offsetMs: 0, gain: 1, pan: 0 }],
    },
    {
      id: 'headline',
      type: 'kineticText',
      name: 'Headline',
      text: 'Motion, engineered.',
      role: 'hero',
      googleFamily: 'Cairo',
      sizePx: 96,
      lineHeight: 1.15,
      letterSpacingPx: -2,
      align: 'center',
      position: pos(300, 300),
      fill: {
        type: 'linear',
        angleDeg: 120,
        stops: [
          { color: '#ffffff', at: 0 },
          { color: '#a5f3fc', at: 100 },
        ],
      },
      stroke: { color: '#0b1020', widthPx: 2 },
      shadow: { color: '#000000', opacity: 0.45, blurPx: 24, offsetYpx: 10 },
      box: { maxWidthPct: 70, paddingPx: 12, chip: { color: '#22d3ee', opacity: 0.14, radiusPx: 18 } },
      highlight: { color: '#22d3ee', radiusPx: 12, paddingPx: 8 },
      animateBy: 'word',
      entrance: { name: 'blurFadeIn', staggerMs: 140 },
      emphasis: { name: 'pulseGlow' },
      exit: { name: 'scaleDownFade' },
      rotation: rot(-3600),
      scale: scl(10),
      opacity: 1,
      filters,
      keyframes: denseKeyframes('headline', mode, kfCount),
      sfx: [{ sfx: 'pop', offsetMs: 120, gain: 0.5, pan: -0.2 }],
    },
    {
      id: 'card',
      type: 'card',
      name: 'Glass card',
      position: pos(50, 32),
      variant: {
        variant: 'glassCard',
        title: 'Deterministic Pipeline',
        body: 'Every frame seeked, captured and piped.',
        iconAssetId: 'logo',
        widthPx: 640,
        paddingPx: 36,
        radiusPx: 28,
        glass: { blurPx: 22, tintColor: '#0b0f1a', tintOpacity: 0.35 },
        borderOpacity: 0.25,
      },
      entrance: { name: '3dFlipIn' },
      rotation: rot(120),
      scale: scl(1),
      filters,
      keyframes: denseKeyframes('card', mode, kfCount),
    },
    {
      id: 'bar',
      type: 'card',
      name: 'Progress bar',
      position: pos(50, 62),
      variant: {
        variant: 'progressBar',
        label: 'Encoding pipeline',
        value: 94,
        trackColor: 'rgba(255,255,255,0.12)',
        fill: {
          type: 'linear',
          angleDeg: 90,
          stops: [
            { color: '#22d3ee', at: 0 },
            { color: '#a78bfa', at: 100 },
          ],
        },
        heightPx: 18,
        radiusPx: 120,
        showPercentage: true,
        widthPx: 640,
      },
      entrance: { name: 'maskRevealWipe' },
      filters,
      keyframes: denseKeyframes('bar', mode, kfCount),
    },
    {
      id: 'anim',
      type: 'lottie',
      name: 'Lottie',
      assetId: 'anim',
      widthPx: 240,
      position: pos(12, 78),
      filters,
      keyframes: denseKeyframes('anim', mode, kfCount),
    },
    {
      id: 'fx',
      type: 'foregroundFX',
      name: 'Foreground FX',
      effects: [
        { kind: 'vignette', strength: 0.5, color: '#000000' },
        { kind: 'filmGrain', opacity: 0.06, sizePx: 2 },
        { kind: 'colorGrade', warmth: 0.12, contrast: 0.06, saturation: 0.08 },
      ],
      filters,
      keyframes: denseKeyframes('fx', mode, kfCount),
    },
  ];

  // Legacy systems: the retired `tracks` array is STILL schema-legal, so it is
  // present in every mode — it is the `_`-prefixed markers that break the
  // strict schema before the sanitizer runs.
  layers[2].tracks = [
    {
      property: 'yPct',
      keyframes: [
        { at: 0, value: 40, ease: 'power2.out' },
        { at: 1200, value: 55, ease: 'power2.inOut' },
      ],
    },
  ];

  if (mode === 'legacy') {
    layers[3]._hidden = true;
    layers[4]._locked = true;
    layers[1]._transientDragState = { x: 12, y: -4 };
  }

  const scene = {
    schemaVersion: 1,
    name: `Benchmark ${mode} scene`,
    canvas: { shape: '16:9', scale: 1080 },
    durationMs: SCENE_DURATION_MS,
    assets: [
      { id: 'logo', kind: 'image', src: 'vault:logo.png' },
      { id: 'anim', kind: 'lottie', src: 'vault:anim.json' },
    ],
    fonts: [{ role: 'hero', family: 'Cairo', provider: 'google', weights: [700, 900] }],
    layers,
    camera: {
      perspective: 1200,
      drift: { amplitudePct: 0.5, periodMs: 5200, seed: 7 },
      keyframes: [
        { at: 0, scale: 1 },
        { at: 5000, scale: 1.28, ease: 'power3.inOut' },
      ],
      moves: [{ move: 'slowPushIn', at: 3000, durationMs: 2200, strength: 0.9 }],
    },
    transitions: [{ kind: 'wipe', at: 2800, direction: 'left', durationMs: 700, color: '#0b1020', featherPx: 90 }],
    audio: {
      cues: [
        { at: 0, sfx: 'whoosh', gain: 1, pan: 0 },
        { at: 900, sfx: 'pop', gain: 0.5, pan: -0.2 },
        { at: 2000, sfx: 'riser', gain: 0.8, pan: 0.35 },
        { at: 3500, sfx: 'subImpact', gain: 0.7, pan: 0 },
      ],
    },
  };

  if (mode === 'legacy') {
    scene._sceneBookmark = { openedBy: 'benchmark', pane: 'inspector' };
  }

  return { ...scene, ...overrides };
}

/**
 * Compress a scene's TIMELINE into a shorter duration.
 *
 * Every timed element of a scene (a layer window, a keyframe, a transition,
 * an audio cue, a camera keyframe or move) has to be scaled together, or the
 * scene fails validation with "…at or after scene end".
 */
function compressScene(scene, targetMs) {
  const ratio = targetMs / scene.durationMs;
  const scale = (t) => Math.max(0, Math.round(t * ratio));
  const out = JSON.parse(JSON.stringify(scene));
  out.durationMs = targetMs;
  for (const layer of out.layers ?? []) {
    if (typeof layer.at === 'number') layer.at = scale(layer.at);
    if (typeof layer.duration === 'number') {
      layer.duration = Math.min(scale(layer.duration), targetMs - layer.at);
    }
    for (const kf of layer.keyframes ?? []) kf.timeMs = scale(kf.timeMs);
    for (const track of layer.tracks ?? []) {
      for (const kf of track.keyframes ?? []) kf.at = scale(kf.at);
    }
  }
  for (const t of out.transitions ?? []) t.at = scale(t.at);
  for (const cue of out.audio?.cues ?? []) cue.at = scale(cue.at);
  for (const kf of out.camera?.keyframes ?? []) kf.at = scale(kf.at);
  for (const move of out.camera?.moves ?? []) {
    move.at = scale(move.at);
    if (typeof move.durationMs === 'number') {
      move.durationMs = Math.max(50, scale(move.durationMs));
    }
  }
  return out;
}

/** A variant of a scene with a different name — a real content change. */
function withVariant(scene, suffix) {
  return { ...scene, name: `${scene.name} #${suffix}` };
}

/* ── assets for the vault ───────────────────────────────────────────────── */

const LOTTIE_JSON = {
  v: '5.7.4',
  fr: 30,
  ip: 0,
  op: 60,
  w: 240,
  h: 240,
  nm: 'benchmark-ring',
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: 'ring',
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: {
          a: 1,
          k: [
            { i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] }, t: 0, s: [0] },
            { t: 60, s: [360] },
          ],
        },
        p: { a: 0, k: [120, 120, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 0, k: [100, 100, 100] },
      },
      ao: 0,
      shapes: [
        {
          ty: 'gr',
          it: [
            { ind: 0, ty: 'el', s: { a: 0, k: [140, 140] }, p: { a: 0, k: [0, 0] } },
            { ty: 'st', c: { a: 0, k: [0.13, 0.83, 0.93, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 12 }, lc: 2, lj: 1 },
            {
              ty: 'tr',
              p: { a: 0, k: [0, 0] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 },
            },
          ],
        },
      ],
      ip: 0,
      op: 60,
      st: 0,
      bm: 0,
    },
  ],
};

function writeVaultAssets(vaultDir) {
  fs.mkdirSync(vaultDir, { recursive: true });
  const pngPath = path.join(vaultDir, 'logo.png');
  execFileSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x1b3a80:s=320x320', '-frames:v', '1', pngPath],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const lottiePath = path.join(vaultDir, 'anim.json');
  fs.writeFileSync(lottiePath, JSON.stringify(LOTTIE_JSON), 'utf8');
  return { pngPath, lottiePath };
}

/* ── BENCHMARK 1 — schema & sanitizer stress ────────────────────────────── */

function benchmarkSchemaSanitizer() {
  section('BENCHMARK 1 — SCHEMA & SANITIZER STRESS');
  console.log(
    '  Every layer kind (background, imageLogo, kineticText, card, lottie, foregroundFX)\n' +
      '  with 40 dense keyframes per layer, every filter key, extreme coordinates,\n' +
      '  legacy `tracks` arrays and legacy/transient `_`-prefixed properties.'
  );

  const MODES = ['legal', 'illegal', 'legacy'];
  const PER_MODE = 120;
  const WARMUP = 20;

  const rawScenes = [];
  for (const mode of MODES) {
    for (let i = 0; i < PER_MODE; i++) {
      rawScenes.push({ mode, scene: buildRichScene(mode, { name: `Bench ${mode} ${i}` }) });
    }
  }

  // ── correctness first: what is rejected, what is healed ────────────────
  const modeStats = new Map();
  const rawIssuePaths = new Map();
  const sanitizedIssuePaths = new Map();
  let healed = 0;
  let rawRejected = 0;
  let sanitizedRejected = 0;
  let clampEvents = 0;
  let healEvents = 0;

  for (const { mode, scene } of rawScenes) {
    const stat = modeStats.get(mode) || { rawRejected: 0, sanitizedRejected: 0, healed: 0, total: 0 };
    stat.total++;
    const rawResult = validateScene(scene);
    if (!rawResult.ok) {
      rawRejected++;
      stat.rawRejected++;
      for (const issue of rawResult.issues) {
        const pathKey = issue.split(':')[0].trim();
        rawIssuePaths.set(pathKey, (rawIssuePaths.get(pathKey) || 0) + 1);
      }
    }
    const report = sanitizeSceneInputWithReport(scene);
    clampEvents += report.clamped.length;
    healEvents += report.healed.length;
    const sanitizedResult = validateScene(report.scene);
    if (!sanitizedResult.ok) {
      sanitizedRejected++;
      stat.sanitizedRejected++;
      for (const issue of sanitizedResult.issues) {
        const pathKey = issue.split(':')[0].trim();
        sanitizedIssuePaths.set(pathKey, (sanitizedIssuePaths.get(pathKey) || 0) + 1);
      }
    } else if (!rawResult.ok) {
      healed++;
      stat.healed++;
    }
    modeStats.set(mode, stat);
  }

  sub('acceptance / healing');
  line('scenes generated', rawScenes.length);
  line('  mode legal   (raw ok / raw rejected / healed)', JSON.stringify(modeStats.get('legal')));
  line('  mode illegal (raw ok / raw rejected / healed)', JSON.stringify(modeStats.get('illegal')));
  line('  mode legacy  (raw ok / raw rejected / healed)', JSON.stringify(modeStats.get('legacy')));
  line('REJECTED before sanitization', `${rawRejected} / ${rawScenes.length}`);
  line('REJECTED after sanitization', `${sanitizedRejected} / ${rawScenes.length}`);
  line('HEALED by sanitizeSceneInput', `${healed} (rejected raw, accepted after sanitize)`);
  line('sanitizer clamp events', clampEvents);
  line('sanitizer heal events', healEvents);

  sub('issue paths on the RAW payload (top 12)');
  const rawTop = [...rawIssuePaths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [p, n] of rawTop) console.log(`    ${String(n).padStart(5)} x  ${p}`);
  if (sanitizedIssuePaths.size > 0) {
    sub('issue paths that SURVIVED sanitization');
    for (const [p, n] of [...sanitizedIssuePaths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`    ${String(n).padStart(5)} x  ${p}`);
    }
  } else {
    sub('issue paths that SURVIVED sanitization');
    console.log('    (none — every sanitized payload validated)');
  }

  // ── timing ─────────────────────────────────────────────────────────────
  sub('timing (validate + sanitize, per scene)');
  for (let i = 0; i < WARMUP; i++) {
    const s = rawScenes[i % rawScenes.length].scene;
    validateScene(sanitizeSceneInput(s));
  }

  const combined = [];
  const sanitizeOnly = [];
  const validateOnly = [];
  const t0 = performance.now();
  for (const { scene } of rawScenes) {
    const a = performance.now();
    const sanitized = sanitizeSceneInput(scene);
    const b = performance.now();
    validateScene(sanitized);
    const c = performance.now();
    sanitizeOnly.push(b - a);
    validateOnly.push(c - b);
    combined.push(c - a);
  }
  const totalMs = performance.now() - t0;

  const sCombined = summarize(combined);
  const sSanitize = summarize(sanitizeOnly);
  const sValidate = summarize(validateOnly);
  line('combined (sanitize + validate)', fmtStats(sCombined));
  line('sanitizeSceneInput only', fmtStats(sSanitize));
  line('validateScene only', fmtStats(sValidate));
  line('throughput', `${(rawScenes.length / (totalMs / 1000)).toFixed(1)} scenes/sec`);
  line('wall clock for the measured batch', fmtMs(totalMs));

  return {
    scenes: rawScenes.length,
    combined: sCombined,
    sanitize: sSanitize,
    validate: sValidate,
    throughput: Number((rawScenes.length / (totalMs / 1000)).toFixed(1)),
    rawRejected,
    sanitizedRejected,
    healed,
    clampEvents,
    healEvents,
    rawIssuePaths: [...rawIssuePaths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
    sanitizedIssuePaths: [...sanitizedIssuePaths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
    modeStats: Object.fromEntries(modeStats),
  };
}

/* ── BENCHMARK 2 — concurrency & atomic persistence ─────────────────────── */

function inspectScenesDir(scenesDir) {
  const files = fs.existsSync(scenesDir) ? fs.readdirSync(scenesDir) : [];
  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  const tmpFiles = files.filter((f) => f.includes('.tmp'));
  const corrupt = [];
  const envelopes = [];
  for (const f of jsonFiles) {
    const full = path.join(scenesDir, f);
    try {
      const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
      envelopes.push({ file: f, revision: parsed.revision, hash: parsed.hash, id: parsed.scene?.id });
    } catch (err) {
      corrupt.push({ file: f, error: err.message });
    }
  }
  return { jsonFiles: jsonFiles.length, tmpFiles, corrupt, envelopes };
}

/**
 * Fire N concurrent `saveScene` calls and report what the store did.
 */
async function timedBurst(core, payloads) {
  const latencies = [];
  const t0 = performance.now();
  const promises = payloads.map((payload) => {
    const start = performance.now();
    return core
      .saveScene(payload)
      .then((res) => {
        latencies.push(performance.now() - start);
        return { ok: true, id: res.id, revision: res.revision, status: res.status };
      })
      .catch((err) => {
        latencies.push(performance.now() - start);
        return { ok: false, error: err.message, issues: err.issues || [] };
      });
  });
  const settled = await Promise.all(promises);
  return { settled, wall: performance.now() - t0, latencies };
}

/** Is the revision list a gapless 1..N monotonic run? */
function revisionAnalysis(revisions) {
  const sorted = [...revisions].sort((a, b) => a - b);
  const unique = [...new Set(sorted)];
  const gapless = unique.length > 0 && unique[unique.length - 1] === unique.length && unique.every((v, i) => v === i + 1);
  return {
    returned: revisions.length,
    uniqueRevisions: unique.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    sorted,
    gapless,
    duplicates: sorted.length - unique.length,
  };
}

async function benchmarkConcurrency(core) {
  section('BENCHMARK 2 — CONCURRENCY & ATOMIC PERSISTENCE');
  const scenesDir = core.paths.storageDir;
  line('scene store directory', scenesDir);

  const base = buildRichScene('legal', { id: 'bench-concurrent-single', name: 'Concurrent single' });

  // ---- 2A: 25 concurrent saves, ONE scene id ------------------------------
  sub('2A — 25 concurrent saveScene() calls, ONE scene id');
  const payloadsA = [];
  for (let i = 0; i < 25; i++) {
    payloadsA.push({ ...withVariant(base, i), id: 'bench-concurrent-single' });
  }
  const burstA = await timedBurst(core, payloadsA);
  // let the fs watcher settle (100 ms debounce) before reading the store
  await new Promise((r) => setTimeout(r, 600));
  const diskA = inspectScenesDir(scenesDir);
  const revA = revisionAnalysis(burstA.settled.filter((r) => r.ok).map((r) => r.revision));
  const memA = core.store.get('bench-concurrent-single');

  line('wall clock (25 parallel saves)', fmtMs(burstA.wall));
  line('per-save latency', fmtStats(summarize(burstA.latencies)));
  line('failed saves', burstA.settled.filter((r) => !r.ok).length);
  line('corrupted JSON files', diskA.corrupt.length);
  line('leftover .tmp files', diskA.tmpFiles.length);
  line('returned revisions', JSON.stringify(revA.sorted));
  line('unique revisions', `${revA.uniqueRevisions} (duplicates: ${revA.duplicates})`);
  line('revisions gapless 1..25?', revA.gapless ? 'YES' : 'NO');
  line('persisted envelope revision', diskA.envelopes.find((e) => e.id === 'bench-concurrent-single')?.revision);
  line('in-memory store revision (after watcher)', memA?.revision);

  // ---- 2B: 25 concurrent saves across FIVE ids ---------------------------
  sub('2B — 25 concurrent saveScene() calls across FIVE scene ids');
  const ids = ['bench-c-1', 'bench-c-2', 'bench-c-3', 'bench-c-4', 'bench-c-5'];
  const payloadsB = [];
  for (let i = 0; i < 25; i++) {
    payloadsB.push({ ...withVariant(base, i), id: ids[i % ids.length] });
  }
  const burstB = await timedBurst(core, payloadsB);
  await new Promise((r) => setTimeout(r, 600));
  const diskB = inspectScenesDir(scenesDir);
  const revB = revisionAnalysis(burstB.settled.filter((r) => r.ok).map((r) => r.revision));
  const perId = {};
  for (const id of ids) {
    const mem = core.store.get(id);
    const env = diskB.envelopes.find((e) => e.id === id);
    perId[id] = { memoryRevision: mem?.revision, diskRevision: env?.revision };
  }
  line('wall clock (25 parallel saves, 5 ids)', fmtMs(burstB.wall));
  line('per-save latency', fmtStats(summarize(burstB.latencies)));
  line('failed saves', burstB.settled.filter((r) => !r.ok).length);
  line('corrupted JSON files', diskB.corrupt.length);
  line('leftover .tmp files', diskB.tmpFiles.length);
  line('returned revisions (sorted)', JSON.stringify(revB.sorted));
  line('unique revisions', `${revB.uniqueRevisions} (duplicates: ${revB.duplicates})`);
  line('revisions gapless 1..25?', revB.gapless ? 'YES' : 'NO');
  line('per-id memory vs disk revision', JSON.stringify(perId));

  // ---- 2C: SEQUENTIAL control -------------------------------------------
  sub('2C — CONTROL: 25 SEQUENTIAL saves on the same id');
  const seqLatencies = [];
  const seqRevisions = [];
  const tSeq = performance.now();
  for (let i = 0; i < 25; i++) {
    const start = performance.now();
    const res = await core.saveScene({ ...withVariant(base, i), id: 'bench-sequential' });
    seqLatencies.push(performance.now() - start);
    seqRevisions.push(res.revision);
  }
  const seqWall = performance.now() - tSeq;
  await new Promise((r) => setTimeout(r, 600));
  const diskC = inspectScenesDir(scenesDir);
  const revC = revisionAnalysis(seqRevisions);
  line('wall clock (25 sequential saves)', fmtMs(seqWall));
  line('per-save latency', fmtStats(summarize(seqLatencies)));
  line('returned revisions', JSON.stringify(revC.sorted));
  line('revisions gapless 1..25?', revC.gapless ? 'YES' : 'NO');
  line('persisted envelope revision', diskC.envelopes.find((e) => e.id === 'bench-sequential')?.revision);
  line('leftover .tmp files', diskC.tmpFiles.length);
  line('corrupted JSON files', diskC.corrupt.length);

  return {
    single: {
      wall: burstA.wall,
      latency: summarize(burstA.latencies),
      revisions: revA,
      corrupt: diskA.corrupt.length,
      tmp: diskA.tmpFiles.length,
      diskRevision: diskA.envelopes.find((e) => e.id === 'bench-concurrent-single')?.revision,
      memoryRevision: memA?.revision,
    },
    multi: {
      wall: burstB.wall,
      latency: summarize(burstB.latencies),
      revisions: revB,
      corrupt: diskB.corrupt.length,
      tmp: diskB.tmpFiles.length,
      perId,
    },
    sequential: {
      wall: seqWall,
      latency: summarize(seqLatencies),
      revisions: revC,
      diskRevision: diskC.envelopes.find((e) => e.id === 'bench-sequential')?.revision,
      tmp: diskC.tmpFiles.length,
      corrupt: diskC.corrupt.length,
    },
  };
}

/* ── BENCHMARK 3 — Playwright inspection latency ────────────────────────── */

/** Run a cold phase in a CHILD process (a fresh browser handle). */
function runColdPhase(phase) {
  const res = spawnSync(process.execPath, [__filename, `--phase=${phase}`], {
    encoding: 'utf8',
    env: { ...process.env },
    maxBuffer: 32 * 1024 * 1024,
    timeout: 180000,
  });
  if (res.status !== 0) {
    fail(`cold phase "${phase}" failed (status ${res.status}): ${(res.stderr || '').slice(-800)}`);
    return null;
  }
  const match = /__PHASE_RESULT__\s*(\{[\s\S]*?\})\s*__END_PHASE__/.exec(res.stdout || '');
  if (!match) {
    fail(`cold phase "${phase}" produced no result marker`);
    return null;
  }
  return JSON.parse(match[1]);
}

async function benchmarkInspection(core) {
  section('BENCHMARK 3 — PLAYWRIGHT ZERO-PORT INSPECTION LATENCY');
  const sceneId = 'bench-inspect';
  const scene = buildRichScene('legal', { id: sceneId, name: 'Inspection latency scene' });
  await core.saveScene(scene);
  line('scene layers', String(scene.layers.length));
  line('scene assets', String(scene.assets.length));

  // ---- cold, in a child process (truly cold browser) ---------------------
  //
  // The cold phase spawns a child that launches a FRESH Chromium, so the
  // browser-launch cost is measured without the parent's warm browser. It is
  // skipped when MOTIONFORGE_BENCH_SKIP_COLD=1 (the child occasionally
  // contends with the parent for the engine's port on a small host).
  sub('cold measurements (child process, fresh Chromium)');
  const skipCold = process.env.MOTIONFORGE_BENCH_SKIP_COLD === '1';
  if (skipCold) line('cold phase', 'SKIPPED (MOTIONFORGE_BENCH_SKIP_COLD=1)');
  const coldInspect = skipCold ? null : runColdPhase('inspect-cold');
  const coldBounds = skipCold ? null : runColdPhase('bounds-cold');
  if (coldInspect) {
    line('inspectKeyframes COLD (browser launch + page + 1 frame)', fmtMs(coldInspect.totalMs));
    line('  of which page setup (goto -> renderConfig ready)', fmtMs(coldInspect.setupMs));
    line('  of which frame capture (seek + screenshot)', fmtMs(coldInspect.frameMs));
    line('  browser launch share (cold - warm setup)', fmtMs(coldInspect.totalMs - coldInspect.setupMs));
  }
  if (coldBounds) {
    line('getLayerBounds COLD (browser launch + page + bounds)', fmtMs(coldBounds.totalMs));
    line('  of which page setup', fmtMs(coldBounds.setupMs));
    line('  of which bounds evaluation', fmtMs(coldBounds.boundsMs));
  }

  // ---- warm, in THIS process ---------------------------------------------
  sub('warm measurements (this process)');
  const t1 = performance.now();
  const res1 = await core.inspectKeyframes(sceneId, { at: [0] });
  const frames1 = res1.frames ?? [];
  const warm1 = performance.now() - t1;

  const t2 = performance.now();
  const res2 = await core.inspectKeyframes(sceneId, { at: [0] });
  const frames2 = res2.frames ?? [];
  const warm2 = performance.now() - t2;

  const stamps = [];
  for (let i = 0; i < 10; i++) stamps.push(i * 200);
  const t3 = performance.now();
  const res10 = await core.inspectKeyframes(sceneId, { at: stamps });
  const frames10 = res10.frames ?? [];
  const warm10 = performance.now() - t3;

  line('inspectKeyframes call #1 (1 frame, browser already launched here)', fmtMs(warm1));
  line('inspectKeyframes call #2 (1 frame)', fmtMs(warm2));
  line('inspectKeyframes call #3 (10 frames)', fmtMs(warm10));
  line('  steady-state per-frame cost (10-frame call - 1-frame call)/9', fmtMs((warm10 - warm2) / 9));
  line('  frames returned', `${frames1.length}, ${frames2.length}, ${frames10.length}`);
  line('  full-res PNG requested?', String(frames1[0].image.length > 0));

  const b1 = performance.now();
  const bounds1 = await core.getLayerBounds(sceneId, 30);
  const warmB1 = performance.now() - b1;
  const b2 = performance.now();
  const bounds2 = await core.getLayerBounds(sceneId, 30);
  const warmB2 = performance.now() - b2;
  const b3 = performance.now();
  const bounds3 = await core.getLayerBounds(sceneId, 31);
  const warmB3 = performance.now() - b3;

  line('getLayerBounds call #1 (warm browser)', fmtMs(warmB1));
  line('getLayerBounds call #2', fmtMs(warmB2));
  line('getLayerBounds call #3', fmtMs(warmB3));
  line('  layers reported', String(Object.keys(bounds1).length));
  line('  bounds identical between calls #1/#2?', JSON.stringify(bounds1) === JSON.stringify(bounds2) ? 'YES' : 'NO');
  line('  bounds differ between frame 30 and 31?', JSON.stringify(bounds2) !== JSON.stringify(bounds3) ? 'YES' : 'NO');

  const coldInspectTotal = coldInspect ? coldInspect.totalMs : null;
  const warmInspectTotal = warm2;
  const coldBoundsTotal = coldBounds ? coldBounds.totalMs : null;

  return {
    coldInspect: coldInspectTotal,
    coldInspectSetup: coldInspect ? coldInspect.setupMs : null,
    coldInspectFrame: coldInspect ? coldInspect.frameMs : null,
    coldBounds: coldBoundsTotal,
    coldBoundsSetup: coldBounds ? coldBounds.setupMs : null,
    coldBoundsEval: coldBounds ? coldBounds.boundsMs : null,
    warmInspect1: warm1,
    warmInspect2: warm2,
    warmInspect10: warm10,
    perFrame: (warm10 - warm2) / 9,
    warmBounds: [warmB1, warmB2, warmB3],
    layerCount: Object.keys(bounds1).length,
    coldWarmRatio: coldInspectTotal ? Number((coldInspectTotal / warmInspectTotal).toFixed(2)) : null,
    boundsColdWarmRatio: coldBoundsTotal ? Number((coldBoundsTotal / warmB2).toFixed(2)) : null,
  };
}

/* ── in-page phase breakdown (zero-port setup, fonts, assets) ───────────── */

/**
 * Open one render page the way the renderer does, and read the browser's own
 * performance timeline: navigation, runtime bundle, scene JSON, vault assets.
 */
async function pagePhaseBreakdown(paths, store, scene, sceneId, label) {
  const { chromium } = require('playwright');
  const profile = ENCODER.profileFor('draft', scene);
  const tLaunch = performance.now();
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-lcd-text', '--font-render-hinting=none', '--force-device-scale-factor=1', '--hide-scrollbars'],
  });
  const launchMs = performance.now() - tLaunch;
  const tCtx = performance.now();
  const context = await browser.newContext({
    viewport: { width: profile.outWidth, height: profile.outHeight },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
    colorScheme: 'dark',
  });
  const ctxMs = performance.now() - tCtx;
  const tRoutes = performance.now();
  await RENDERER.setupPlaywrightZeroPortRoutes(context, { sceneId, scene, store, paths });
  const routesMs = performance.now() - tRoutes;
  const tPage = performance.now();
  const page = await context.newPage();
  const pageMs = performance.now() - tPage;
  const tGoto = performance.now();
  await page.goto(`http://127.0.0.1:4000/preview?scene=${encodeURIComponent(sceneId)}&render=1&fps=${profile.fps}`, {
    waitUntil: 'networkidle',
  });
  const gotoMs = performance.now() - tGoto;
  const tReady = performance.now();
  await page.waitForFunction(
    () => {
      const g = globalThis;
      return typeof g.renderConfig === 'object' && typeof g.seekToFrame === 'function';
    },
    null,
    { timeout: 30000 }
  );
  await page.evaluate(() => (globalThis.whenSceneReady ? globalThis.whenSceneReady() : undefined));
  const readyMs = performance.now() - tReady;

  const timeline = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource').map((r) => ({
      name: r.name,
      kind: r.initiatorType,
      start: Math.round(r.startTime),
      duration: Math.round(r.duration),
      size: r.transferSize,
    }));
    return {
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadEventEnd: nav ? Math.round(nav.loadEventEnd) : null,
      responseEnd: nav ? Math.round(nav.responseEnd) : null,
      resources,
    };
  });

  const fontsReadyMs = await page.evaluate(async () => {
    const t = performance.now();
    await document.fonts.ready;
    return Math.round(performance.now() - t);
  });

  await context.close();
  await browser.close();

  const byName = (frag) => timeline.resources.find((r) => r.name.includes(frag)) || null;
  return {
    label,
    launchMs,
    ctxMs,
    routesMs,
    pageMs,
    gotoMs,
    readyMs,
    fontsReadyMs,
    timeline,
    bundle: byName('/assets/index-'),
    css: byName('/assets/index-') ? timeline.resources.find((r) => r.name.endsWith('.css')) : null,
    sceneJson: byName('/api/scenes/'),
    vaultLogo: byName('/api/assets/vault/logo.png'),
    vaultLottie: byName('/api/assets/vault/anim.json'),
    googleFont: timeline.resources.find((r) => r.name.includes('fonts.googleapis.com')) || null,
  };
}

/* ── BENCHMARK 4 — render + audio ───────────────────────────────────────── */

function ffprobe(file, extraArgs = []) {
  return execFileSync(
    'ffprobe',
    ['-v', 'error', '-hide_banner', ...extraArgs, '-show_format', '-show_streams', '-of', 'json', file],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
}

/** Parse a 16-bit PCM WAV and return the samples as a Float32Array (-1..1). */
function readWavPcm16(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let offset = 12;
  let channels = 2;
  let sampleRate = 48000;
  let bitsPerSample = 16;
  let dataStart = -1;
  let dataLength = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      dataStart = body;
      dataLength = size;
      break;
    }
    offset = body + size + (size % 2);
  }
  if (dataStart < 0) throw new Error('no data chunk');
  if (bitsPerSample !== 16) throw new Error(`expected 16-bit PCM, got ${bitsPerSample}`);
  const frames = Math.floor(dataLength / 2 / channels);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const p = dataStart + (i * channels + c) * 2;
      acc += buf.readInt16LE(p) / 32768;
    }
    out[i] = acc / channels;
  }
  return { samples: out, sampleRate, channels, durationSec: frames / sampleRate };
}

/** RMS (dBFS) of a sample range. */
function rmsDb(samples, from, to) {
  let sum = 0;
  let count = 0;
  for (let i = from; i < to && i < samples.length; i++) {
    sum += samples[i] * samples[i];
    count++;
  }
  if (count === 0) return -Infinity;
  const rms = Math.sqrt(sum / count);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

function volumedetect(file, startSec, endSec) {
  const res = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-ss', String(startSec), '-to', String(endSec), '-i', file, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const stderr = String(res.stderr || '');
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  const max = /max_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  return {
    meanVolumeDb: mean ? Number(mean[1]) : null,
    maxVolumeDb: max ? Number(max[1]) : null,
    stderrTail: stderr.slice(-200),
  };
}

/** The RMS envelope of the mix, 50 ms per window. */
function rmsEnvelope(samples, sampleRate, windowMs = 50) {
  const win = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const out = [];
  for (let start = 0; start < samples.length; start += win) {
    const end = Math.min(samples.length, start + win);
    const db = rmsDb(samples, start, end);
    out.push({ tMs: Math.round((start / sampleRate) * 1000), db: Number.isFinite(db) ? db : -120 });
  }
  return out;
}

async function benchmarkRender(core, paths) {
  section('BENCHMARK 4 — FFMPEG RENDER THROUGHPUT & AUDIO MIXING');
  //
  // The throughput render uses the SOLID-BACKGROUND variant of the rich
  // scene. The mesh-gradient variant is measured in the A/B above (and it is
  // what OOM-kills a GPU-less browser — see the last section, which attempts
  // it deliberately).
  const sceneId = 'bench-render';
  const scene = buildRichScene(
    'legal',
    { id: sceneId, name: 'Render throughput scene' },
    { keyframeCount: 2 }
  );
  // The throughput scene is the AFFORDABLE variant: a solid background and a
  // vignette (no film grain, no blurred mesh gradient). The A/B above
  // attributes what the expensive variants cost, and the last section
  // attempts the full scene deliberately.
  scene.layers = scene.layers.map((l) => {
    if (l.type === 'background') return { ...l, variant: { variant: 'solid', color: '#05070d' } };
    if (l.type === 'foregroundFX') {
      return { ...l, effects: [{ kind: 'vignette', strength: 0.5, color: '#000000' }] };
    }
    return l;
  });
  await core.saveScene(scene);
  line('scene layers', String(scene.layers.length));
  line('scene duration', `${scene.durationMs} ms`);
  line('audio cues', scene.audio.cues.map((c) => `${c.sfx}@${c.at}ms(g=${c.gain},pan=${c.pan})`).join('  '));

  // ---- encoder selection cost -------------------------------------------
  sub('encoder selection');
  const tEnc = performance.now();
  const encoder = await ENCODER.pickEncoder('draft');
  const encoderMs = performance.now() - tEnc;
  line('pickEncoder("draft")', `${encoder}  (${fmtMs(encoderMs)})`);
  line('available encoders', (await ENCODER.availableEncoders()).join(', '));

  // ---- SFX bank synthesis cost (fresh vault) ------------------------------
  sub('SFX bank synthesis (fresh vault directory)');
  const sfxProbeDir = path.join(os.tmpdir(), `mf-sfx-probe-${process.pid}-${crypto.randomBytes(3).toString('hex')}`);
  const sfxPaths = { ...paths, sfxDir: sfxProbeDir };
  const tSfx = performance.now();
  await CORE.ensureSfxBank(sfxPaths);
  const sfxMs = performance.now() - tSfx;
  const sfxFiles = fs.readdirSync(sfxProbeDir).filter((f) => f.endsWith('.ogg'));
  line('ensureSfxBank (6 files, cold)', fmtMs(sfxMs));
  line('files produced', `${sfxFiles.length} (${sfxFiles.join(', ')})`);
  fs.rmSync(sfxProbeDir, { recursive: true, force: true });

  // ---- in-page phase breakdown -------------------------------------------
  sub('zero-port page setup breakdown (browser-side timings)');
  const breakdown = await pagePhaseBreakdown(paths, core.store, scene, sceneId, 'render page');
  line('chromium.launch', fmtMs(breakdown.launchMs));
  line('browser.newContext', fmtMs(breakdown.ctxMs));
  line('setupPlaywrightZeroPortRoutes', fmtMs(breakdown.routesMs));
  line('context.newPage', fmtMs(breakdown.pageMs));
  line('page.goto (/preview, networkidle)', fmtMs(breakdown.gotoMs));
  line('renderConfig + whenSceneReady', fmtMs(breakdown.readyMs));
  line('document.fonts.ready (after ready)', fmtMs(breakdown.fontsReadyMs));
  if (breakdown.bundle) {
    line('runtime bundle (in-page)', `${breakdown.bundle.duration} ms, ${breakdown.bundle.size} B transferred`);
  }
  if (breakdown.sceneJson) {
    line('scene JSON (in-page)', `${breakdown.sceneJson.duration} ms, ${breakdown.sceneJson.size} B`);
  }
  if (breakdown.vaultLogo) {
    line('vault logo.png (in-page)', `${breakdown.vaultLogo.duration} ms, ${breakdown.vaultLogo.size} B`);
  }
  if (breakdown.vaultLottie) {
    line('vault anim.json (in-page)', `${breakdown.vaultLottie.duration} ms, ${breakdown.vaultLottie.size} B`);
  }
  if (breakdown.googleFont) {
    line('Google Fonts CSS (in-page)', `${breakdown.googleFont.duration} ms, ${breakdown.googleFont.size} B`);
  } else {
    line('Google Fonts CSS (in-page)', 'not requested');
  }

  // ---- fonts A/B: google vs system ---------------------------------------
  sub('font loading A/B (is it in the critical path?)');
  const systemFontsScene = buildRichScene('legal', {
    id: 'bench-render-systemfonts',
    name: 'Render throughput scene (system fonts)',
    fonts: [{ role: 'hero', family: 'Inter', provider: 'system', weights: [400, 700] }],
  });
  await core.saveScene(systemFontsScene);
  const googleBreak = await pagePhaseBreakdown(paths, core.store, scene, sceneId, 'google fonts');
  const systemBreak = await pagePhaseBreakdown(paths, core.store, systemFontsScene, 'bench-render-systemfonts', 'system fonts');
  line('page setup + ready, GOOGLE fonts', fmtMs(googleBreak.readyMs));
  line('page setup + ready, SYSTEM fonts', fmtMs(systemBreak.readyMs));
  line('difference (font network cost)', fmtMs(googleBreak.readyMs - systemBreak.readyMs));

  // ---- WHAT ACTUALLY COSTS THE RENDER -----------------------------------
  //
  // The same scene, three times, at the same (short) duration: the only
  // difference is ONE visual feature per variant. This is the only way to
  // find out what dominates the frame cost instead of guessing.
  sub('cost attribution A/B (same scene, one feature changed per variant)');
  const abResults = [];
  //
  // The LIGHT variants run FIRST and the heavy baseline LAST: when the heavy
  // scene OOM-kills the browser, the light measurements are already collected.
  //
  // Four variants, LIGHTEST FIRST. The A/B scene is deliberately LIGHT (2
  // keyframes per property instead of 8) so the measurement is about the
  // FEATURE, not about the keyframe count: on this host the full-density
  // scene does not fit in memory at all.
  const stripMesh = (sc) => {
    sc.layers = sc.layers.map((l) =>
      l.type === 'background' ? { ...l, variant: { variant: 'solid', color: '#05070d' } } : l
    );
    return sc;
  };
  const stripGrain = (sc) => {
    sc.layers = sc.layers.map((l) =>
      l.type === 'foregroundFX'
        ? { ...l, effects: [{ kind: 'vignette', strength: 0.5, color: '#000000' }] }
        : l
    );
    return sc;
  };
  const abVariants = [
    {
      label: 'neither (solid background + vignette only)',
      mutate: (sc) => stripGrain(stripMesh(sc)),
    },
    {
      label: 'film grain only (solid background + grain)',
      mutate: (sc) => stripMesh(sc),
    },
    {
      label: 'mesh gradient only (blurred mesh + vignette)',
      mutate: (sc) => stripGrain(sc),
    },
    {
      label: 'both (blurred mesh + film grain)',
      mutate: (sc) => sc,
    },
  ];
  for (const variant of abVariants) {
    const abId = `bench-ab-${abResults.length}`;
    const abScene = variant.mutate(
      compressScene(
        buildRichScene('legal', { id: abId, name: `A/B ${variant.label}` }, { keyframeCount: 2 }),
        1500
      )
    );
    await core.saveScene(abScene);
    const tAb = Date.now();
    let abStatus = 'failed';
    let abError = null;
    try {
      const { jobId } = await core.startRender(abId, 'draft');
      const abJob = await new Promise((resolve, reject) => {
        const timer = setInterval(() => {
          const j = core.getRenderStatus(jobId);
          if (!j) return;
          if (j.status === 'succeeded' || j.status === 'failed') {
            clearInterval(timer);
            resolve(j);
          }
        }, 25);
        setTimeout(() => {
          clearInterval(timer);
          reject(new Error(`A/B render ${jobId} timed out`));
        }, 300000);
      });
      abStatus = abJob.status;
      abError = abJob.error ?? null;
      const abWall = Date.now() - tAb;
      const abFrames = abJob.result?.frames ?? 0;
      abResults.push({
        label: variant.label,
        status: abStatus,
        wallMs: abWall,
        frames: abFrames,
        msPerFrame: abFrames ? Number((abWall / abFrames).toFixed(1)) : null,
        error: abError,
      });
      line(
        `A/B: ${variant.label}`,
        `${abStatus} — ${abWall} ms for ${abFrames} frames` +
          (abFrames ? ` (${(abWall / abFrames).toFixed(1)} ms/frame)` : '') +
          (abError ? ` — ${String(abError).slice(0, 120)}` : '')
      );
    } catch (err) {
      abResults.push({ label: variant.label, status: 'failed', error: String(err).slice(0, 200) });
      line(`A/B: ${variant.label}`, `FAILED — ${String(err).slice(0, 160)}`);
    }
  }
  const base = abResults.find((r) => r.label.startsWith('neither'));
  for (const r of abResults) {
    if (base && base.msPerFrame && r.msPerFrame) {
      r.relativeToBaseline = Number((r.msPerFrame / base.msPerFrame).toFixed(2));
      line(
        `  relative cost of "${r.label}"`,
        `${r.relativeToBaseline}x the baseline (${r.msPerFrame} vs ${base.msPerFrame} ms/frame)`
      );
    }
  }

  // ---- the real render ----------------------------------------------------
  sub('render (draft)');
  const memSamples = [];
  const memTimer = setInterval(() => {
    const m = process.memoryUsage();
    memSamples.push({ rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal, external: m.external });
  }, 50);
  const memBefore = process.memoryUsage();

  const progressEvents = [];
  const onProgress = (evt) => progressEvents.push({ t: Date.now(), frames: evt.currentFrame });
  core.on('render:progress', onProgress);

  const renderStarted = Date.now();
  let renderTarget = sceneId;
  let { jobId } = await core.startRender(renderTarget, 'draft');
  const job = await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const j = core.getRenderStatus(jobId);
      if (!j) return;
      if (j.status === 'succeeded' || j.status === 'failed') {
        clearInterval(timer);
        resolve(j);
      }
    }, 25);
    setTimeout(() => {
      clearInterval(timer);
      reject(new Error(`render ${jobId} timed out`));
    }, 900000);
  });
  const renderWall = Date.now() - renderStarted;
  clearInterval(memTimer);
  core.off('render:progress', onProgress);

  if (job.status !== 'succeeded') {
    // A failed render is a FINDING, not a crash: the A/B data above is kept
    // and the report continues.
    fail(`render failed: ${String(job.error).slice(0, 160)}`);
    return { failed: true, error: job.error, ab: abResults };
  }

  const peakRss = Math.max(...memSamples.map((s) => s.rss));
  const peakHeap = Math.max(...memSamples.map((s) => s.heapUsed));
  const peakHeapTotal = Math.max(...memSamples.map((s) => s.heapTotal));
  const result = job.result;

  line('render wall clock (wall)', fmtMs(renderWall));
  line('render wall clock (engine job.result.wallMs)', fmtMs(result.wallMs));
  line('frames', String(result.frames));
  line('profile', `${result.profile.outWidth}x${result.profile.outHeight} @ ${result.profile.fps}fps (${result.profile.quality})`);
  line('encoder', result.encoder);
  line('parallel workers', String(result.workerCount));
  line('effective render speed', `${result.effectiveFps} fps  (${result.frames} frames in ${fmtMs(result.wallMs)})`);
  line('realtime factor (scene seconds / wall seconds)', `${(scene.durationMs / 1000 / (renderWall / 1000)).toFixed(3)}x`);
  line('memory before render', `rss ${(memBefore.rss / 1048576).toFixed(1)} MB, heapUsed ${(memBefore.heapUsed / 1048576).toFixed(1)} MB`);
  line('PEAK rss', `${(peakRss / 1048576).toFixed(1)} MB`);
  line('PEAK heapUsed', `${(peakHeap / 1048576).toFixed(1)} MB`);
  line('PEAK heapTotal', `${(peakHeapTotal / 1048576).toFixed(1)} MB`);
  line('memory samples', String(memSamples.length));

  // ---- ffprobe ------------------------------------------------------------
  sub('ffprobe — rendered MP4');
  const probeRaw = ffprobe(result.mp4Path, ['-count_frames']);
  const probe = JSON.parse(probeRaw);
  console.log(probeRaw.trim());
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');

  // ---- audio verification -------------------------------------------------
  sub('audio mix verification');
  const wavPath = path.join(paths.rendersDir, 'bench-audio.wav');
  execFileSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', result.mp4Path, '-vn', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '2', wavPath],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const wav = readWavPcm16(wavPath);
  line('decoded WAV', `${wav.durationSec.toFixed(3)} s, ${wav.sampleRate} Hz, ${wav.channels} ch`);

  const segments = [
    { label: 'whoosh @0ms', start: 0.05, end: 0.85 },
    { label: 'pop @900ms', start: 0.9, end: 1.07 },
    { label: 'riser @2000ms', start: 2.05, end: 3.55 },
    { label: 'subImpact @3500ms', start: 3.55, end: 4.35 },
    { label: 'control (no cue)', start: 4.6, end: 5.8 },
  ];
  const segmentRows = [];
  for (const seg of segments) {
    const vd = volumedetect(wavPath, seg.start, seg.end);
    const from = Math.round(seg.start * wav.sampleRate);
    const to = Math.round(seg.end * wav.sampleRate);
    const computed = rmsDb(wav.samples, from, to);
    segmentRows.push({ ...seg, ...vd, computedRmsDb: Number(computed.toFixed(2)) });
    line(
      `segment ${seg.label} [${seg.start}-${seg.end}s]`,
      `mean ${vd.meanVolumeDb} dB, max ${vd.maxVolumeDb} dB, computed RMS ${computed.toFixed(2)} dB`
    );
  }

  // envelope: the ON-SET of each cue proves the `adelay` schedule
  const env = rmsEnvelope(wav.samples, wav.sampleRate, 50);
  const FLOOR = -55;
  const onsets = [];
  let armed = true;
  for (const w of env) {
    if (armed && w.db > FLOOR) {
      onsets.push(w.tMs);
      armed = false;
    }
    if (!armed && w.db < FLOOR - 10) armed = true;
  }
  line('audio onsets detected (> -55 dBFS, 50 ms windows)', `${onsets.join(' ms, ')} ms`);
  const expected = scene.audio.cues.map((c) => c.at).sort((a, b) => a - b);
  line('expected cue onsets', `${expected.join(' ms, ')} ms`);

  // ---- capture vs encode, measured separately ----------------------------
  sub('capture phase vs encode phase (measured separately)');
  const split = await measureCaptureVsEncode(paths, core.store, scene, sceneId, result.profile, result.encoder);
  line('CAPTURE: browser launch', fmtMs(split.launchMs));
  line('CAPTURE: page setup (routes + goto + ready)', fmtMs(split.setupMs));
  line('CAPTURE: N frames seek + screenshot', fmtMs(split.captureMs));
  line('  per-frame capture cost', fmtMs(split.perFrameMs));
  line('  frames captured', String(split.frames));
  line('ENCODE: ffmpeg image2pipe for the same frames', fmtMs(split.encodeMs));
  line('  per-frame encode cost', fmtMs(split.perFrameEncodeMs));
  line('  sum of phases (capture + encode)', fmtMs(split.captureMs + split.encodeMs));
  line('  real draft render wall clock', fmtMs(renderWall));
  line('  encode as share of the phase sum', `${((split.encodeMs / (split.captureMs + split.encodeMs)) * 100).toFixed(1)}%`);
  line('  capture as share of the phase sum', `${((split.captureMs / (split.captureMs + split.encodeMs)) * 100).toFixed(1)}%`);

  fs.rmSync(wavPath, { force: true });

  // ---- the heavy scene, attempted deliberately ----------------------------
  //
  // The A/B above says the mesh gradient is the expensive part. This section
  // PROVES it end to end: the SAME scene with a blurred mesh-gradient
  // background is rendered at full length, and the failure mode is recorded.
  sub('the heavy variant, rendered at full length (expected to fail on a GPU-less host)');
  const heavyId = 'bench-render-heavy';
  const heavy = buildRichScene('legal', { id: heavyId, name: 'Render throughput scene (mesh gradient)' });
  // the FULL density: 8 keyframes per property per layer, the blurred mesh
  // gradient AND the film grain
  await core.saveScene(heavy);
  const tHeavy = Date.now();
  let heavyOutcome = null;
  try {
    const { jobId: heavyJobId } = await core.startRender(heavyId, 'draft');
    const heavyJob = await new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        const j = core.getRenderStatus(heavyJobId);
        if (!j) return;
        if (j.status === 'succeeded' || j.status === 'failed') {
          clearInterval(timer);
          resolve(j);
        }
      }, 25);
      setTimeout(() => {
        clearInterval(timer);
        reject(new Error('the heavy render timed out after 10 minutes'));
      }, 600000);
    });
    heavyOutcome = {
      status: heavyJob.status,
      wallMs: Date.now() - tHeavy,
      error: heavyJob.error ? String(heavyJob.error).slice(0, 400) : null,
    };
  } catch (err) {
    heavyOutcome = { status: 'failed', wallMs: Date.now() - tHeavy, error: String(err).slice(0, 400) };
  }
  line(
    'the heavy variant (blurred mesh gradient)',
    `${heavyOutcome.status} after ${heavyOutcome.wallMs} ms` +
      (heavyOutcome.error ? ` — ${heavyOutcome.error.split('\n')[0].slice(0, 160)}` : '')
  );
  if (heavyOutcome.status !== 'succeeded') {
    fail(
      'the blurred mesh gradient cannot be rendered on this host',
      `the browser was killed: ${String(heavyOutcome.error).split('\n')[0].slice(0, 140)}`
    );
  }

  return {
    heavy: heavyOutcome,
    ab: abResults,
    wall: renderWall,
    frames: result.frames,
    profile: result.profile,
    encoder: result.encoder,
    effectiveFps: result.effectiveFps,
    workerCount: result.workerCount,
    peakRss,
    peakHeap,
    peakHeapTotal,
    memBefore,
    probeRaw: probeRaw.trim(),
    video: v,
    audio: a,
    wav: { durationSec: wav.durationSec, sampleRate: wav.sampleRate, channels: wav.channels },
    segments: segmentRows,
    onsets,
    expectedOnsets: expected,
    breakdown,
    fonts: { google: googleBreak.readyMs, system: systemBreak.readyMs },
    encoderProbeMs: encoderMs,
    sfxBankMs: sfxMs,
    split,
    mp4Path: result.mp4Path,
  };
}

/**
 * Capture N frames with the real zero-port route, then encode exactly those
 * buffers with the real encoder args — the two phases, measured apart.
 */
async function measureCaptureVsEncode(paths, store, scene, sceneId, profile, encoder) {
  const { chromium } = require('playwright');
  const N = 30;
  const tLaunch = performance.now();
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-lcd-text', '--font-render-hinting=none', '--force-device-scale-factor=1', '--hide-scrollbars'],
  });
  const launchMs = performance.now() - tLaunch;
  const context = await browser.newContext({
    viewport: { width: profile.outWidth, height: profile.outHeight },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
    colorScheme: 'dark',
  });
  const tSetup = performance.now();
  await RENDERER.setupPlaywrightZeroPortRoutes(context, { sceneId, scene, store, paths });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:4000/preview?scene=${encodeURIComponent(sceneId)}&render=1&fps=${profile.fps}`, {
    waitUntil: 'networkidle',
  });
  await page.waitForFunction(
    () => {
      const g = globalThis;
      return typeof g.renderConfig === 'object' && typeof g.seekToFrame === 'function';
    },
    null,
    { timeout: 30000 }
  );
  await page.evaluate(() => (globalThis.whenSceneReady ? globalThis.whenSceneReady() : undefined));
  const setupMs = performance.now() - tSetup;

  const buffers = [];
  const tCapture = performance.now();
  for (let frame = 0; frame < N; frame++) {
    await page.evaluate((f) => globalThis.seekToFrame(f), frame);
    const buf = await page.screenshot({ type: 'jpeg', quality: profile.jpegQuality, fullPage: false });
    buffers.push(buf);
  }
  const captureMs = performance.now() - tCapture;
  await context.close();
  await browser.close();

  const outPath = path.join(os.tmpdir(), `mf-encode-probe-${process.pid}-${Date.now()}.mp4`);
  const tEncode = performance.now();
  await new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'image2pipe', '-framerate', String(profile.fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
      '-vf', `fps=${profile.fps},format=yuv420p`,
      ...ENCODER.encoderArgs(encoder, profile.quality),
      '-pix_fmt', 'yuv420p',
      '-f', 'mp4',
      outPath,
    ]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += String(d)));
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`))
    );
    (async () => {
      for (const buf of buffers) {
        if (!proc.stdin.write(buf)) await new Promise((r) => proc.stdin.once('drain', r));
      }
      proc.stdin.end();
    })().catch(reject);
  });
  const encodeMs = performance.now() - tEncode;
  fs.rmSync(outPath, { force: true });

  return {
    launchMs,
    setupMs,
    captureMs,
    perFrameMs: captureMs / N,
    encodeMs,
    perFrameEncodeMs: encodeMs / N,
    frames: N,
    jpegBytes: buffers.reduce((a, b) => a + b.length, 0),
  };
}

/* ── cold child phases ──────────────────────────────────────────────────── */

async function runColdPhaseMain(phase) {
  const dirs = {
    root: process.env.MOTIONFORGE_DATA_DIR,
    scenes: process.env.MOTIONFORGE_STORAGE_DIR,
    vault: process.env.MOTIONFORGE_VAULT_DIR,
    renders: process.env.MOTIONFORGE_RENDERS_DIR,
  };
  const core = await createEngineCore({ enableWatcher: false });
  const sceneId = 'bench-inspect';
  const scene = buildRichScene('legal', { id: sceneId, name: 'Inspection latency scene' });
  await core.saveScene(scene);

  let result;
  if (phase === 'inspect-cold') {
    const t0 = performance.now();
    const frames = await core.inspectKeyframes(sceneId, { at: [0] });
    const totalMs = performance.now() - t0;
    // a second call measures the warm cost in the SAME process
    const t1 = performance.now();
    await core.inspectKeyframes(sceneId, { at: [0] });
    const warmMs = performance.now() - t1;
    result = {
      phase,
      totalMs,
      warmMs,
      setupMs: totalMs - warmMs,
      frameMs: warmMs,
      frames: frames.length,
    };
  } else if (phase === 'bounds-cold') {
    const t0 = performance.now();
    const bounds = await core.getLayerBounds(sceneId, 30);
    const totalMs = performance.now() - t0;
    const t1 = performance.now();
    await core.getLayerBounds(sceneId, 30);
    const warmMs = performance.now() - t1;
    result = {
      phase,
      totalMs,
      warmMs,
      setupMs: totalMs - warmMs,
      boundsMs: warmMs,
      layers: Object.keys(bounds).length,
    };
  } else {
    throw new Error(`unknown phase ${phase}`);
  }

  console.log(`__PHASE_RESULT__ ${JSON.stringify(result)} __END_PHASE__`);
  await core.dispose();
}

/* ── main ───────────────────────────────────────────────────────────────── */

async function main() {
  if (PHASE) {
    await runColdPhaseMain(PHASE);
    return;
  }

  const dirs = makeTestDirs('bench-backend');
  // the engine reads these four variables — point them at the throw-away tree
  Object.assign(process.env, makeTestEnv(dirs));

  console.log('MotionForge — BACKEND / ENGINE BENCHMARK');
  console.log(`  started            ${new Date().toISOString()}`);
  console.log(`  node               ${process.version}`);
  console.log(`  cpus               ${os.cpus().length}`);
  console.log(`  isolated workspace ${describeTestDirs(dirs)}`);
  console.log(`  host ffmpeg        ${execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0]}`);

  let core = null;
  const report = {};
  try {
    const doctor = await CORE.doctor(CORE.engineConfig({ port: 4000 }));
    line('doctor ok', String(doctor.ok));
    line('doctor problems', doctor.problems.length ? doctor.problems.join(' | ') : '(none)');

    core = await createEngineCore({ port: 4000, log: (m) => console.log(`  [engine] ${m}`) });
    writeVaultAssets(core.paths.vaultDir);

    report.schema = benchmarkSchemaSanitizer();
    report.concurrency = await benchmarkConcurrency(core);
    report.inspection = await benchmarkInspection(core);
    report.render = await benchmarkRender(core, core.paths);

    if (!HAS_FLAG('--skip-production') && report.render && !report.render.failed) {
      sub('render (production) — 1920x1080 @ 60fps');
      const prodId = 'bench-render-prod';
      const prodScene = buildRichScene('legal', { id: prodId, name: 'Render throughput scene (production)' });
      await core.saveScene(prodScene);
      const t = Date.now();
      const { jobId } = await core.startRender(prodId, 'production');
      const job = await new Promise((resolve, reject) => {
        const timer = setInterval(() => {
          const j = core.getRenderStatus(jobId);
          if (j && (j.status === 'succeeded' || j.status === 'failed')) {
            clearInterval(timer);
            resolve(j);
          }
        }, 50);
        setTimeout(() => {
          clearInterval(timer);
          reject(new Error('production render timed out'));
        }, 1800000);
      });
      const wall = Date.now() - t;
      if (job.status === 'succeeded') {
        line('production wall clock', fmtMs(wall));
        line('frames', String(job.result.frames));
        line('profile', `${job.result.profile.outWidth}x${job.result.profile.outHeight} @ ${job.result.profile.fps}fps`);
        line('effective render speed', `${job.result.effectiveFps} fps`);
        report.production = {
          wall,
          frames: job.result.frames,
          profile: job.result.profile,
          effectiveFps: job.result.effectiveFps,
          encoder: job.result.encoder,
        };
      } else {
        fail(`production render failed: ${job.error}`);
      }
    }
  } finally {
    if (core) await core.dispose().catch(() => undefined);
    cleanupTestDirs(dirs);
  }

  section('SUMMARY');
  console.log(JSON.stringify(report, null, 2));
  console.log(`\n  total benchmark wall clock: ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
  console.log('  isolated workspace removed; ~/.motionforge was never touched');
  // The pooled Playwright browser keeps a handle open, so the process would
  // linger for minutes after the last measurement. Exit explicitly.
  process.exit(0);
}

main().catch((err) => {
  console.error('benchmark failed:', err);
  process.exit(1);
});
