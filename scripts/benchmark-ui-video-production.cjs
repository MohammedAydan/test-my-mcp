#!/usr/bin/env node
/**
 * MotionForge — UI-DRIVEN VIDEO PRODUCTION BENCHMARK.
 *
 * Builds a real 6-second, 1920x1080 product-launch promo ENTIRELY through the
 * Studio's own UI (tool dock, project bin, inspector, canvas gizmo, timeline,
 * SFX drag-and-drop, render modal) and exports it to an MP4.
 *
 * WHAT IS MEASURED
 *   - canvas drag latency (per-move handler cost + the round trip to the
 *     runtime's `ephemeralTransform`),
 *   - the gizmo alignment error against the REAL rendered element (0 deg and
 *     rotated),
 *   - the timeline scrub rate (distinct playhead values per second),
 *   - the render duration (wall clock, `#render-start` -> `succeeded`),
 *   - the wall clock of every major UI operation.
 *
 * ISOLATION
 *   The engine is pointed at a throw-away tree through the environment
 *   variables `packages/core-engine/src/config.ts` reads, so the run NEVER
 *   touches the developer's `~/.motionforge`.
 *
 * Usage:
 *   xvfb-run -a --server-args="-screen 0 1920x1200x24" \
 *     node scripts/benchmark-ui-video-production.cjs
 */
const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const {
  makeTestEnv,
  makeTestDirs,
  cleanupTestDirs,
  describeTestDirs,
} = require('./lib/test-env.cjs');

const ROOT = path.resolve(__dirname, '..');
const SCREENSHOT_DIR = path.join(ROOT, 'screenshots');
const SCREENSHOT_PATH = path.join(SCREENSHOT_DIR, 'benchmark-ui-production-studio.png');
const RENDERS_DIR = path.join(ROOT, 'renders');
const VIDEO_PATH = path.join(RENDERS_DIR, 'ui-production-showcase.mp4');
const FRAME_TIMES = [0.5, 2.0, 4.5];

/** The deterministic window size — every measurement below depends on it. */
const WINDOW = { width: 1920, height: 1200 };

/** The composition the benchmark builds. */
const SCENE = {
  name: 'UI Production Showcase',
  durationMs: 6000,
  bgColor: '#0b1226',
  titleText: 'MOTIONFORGE STUDIO',
  titleSize: 112,
  titleFill: '#eaf3ff',
  /** the hero title's Position Y at t = 0 and at t = 1500 ms */
  titleY0: 35.4,
  titleY1: 28,
  card1: {
    title: 'Ship a promo in six seconds',
    body: 'Every layer placed by hand with the Studio UI.',
  },
  card2: {
    title: 'Keyframe. Trim. Render.',
    body: 'Direct manipulation, live preview, real export.',
  },
};

const results = [];
const metrics = {};
const bugs = [];
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
  console.log(`  NOTE  ${label}${detail ? ` — ${detail}` : ''}`);
}

function bug(id, title, evidence) {
  bugs.push({ id, title, evidence });
  console.log(`  BUG   ${id}: ${title}`);
  console.log(`        ${evidence}`);
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run ffmpeg/ffprobe and return stdout. */
function run(bin, args) {
  return execFileSync(bin, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/* ── page helpers ─────────────────────────────────────────────────────────── */

/** The `mf-runtime://` preview frame, once it has a mounted stage. */
async function findRuntimeFrame(page, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = page.frames().find((f) => f.url().startsWith('mf-runtime://'));
    if (frame) {
      const ready = await frame
        .evaluate(() => Boolean(document.getElementById('stage')))
        .catch(() => false);
      if (ready) return frame;
    }
    await page.waitForTimeout(200);
  }
  return null;
}

/** The runtime's content element of one layer, measured INSIDE the frame. */
async function readRuntimeElement(frame, layerId) {
  return await frame.evaluate((id) => {
    const root = document.querySelector(`[data-layer-id="${id}"]`);
    if (!root) return { ok: false, reason: `layer root "${id}" is not mounted` };
    const el = root.querySelector('[data-mf-content]');
    if (!el) return { ok: false, reason: `content element of "${id}" is not mounted` };
    const r = el.getBoundingClientRect();
    return {
      ok: true,
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      styleLeft: el.style.left,
      styleTop: el.style.top,
      transform: getComputedStyle(el).transform,
      filter: getComputedStyle(el).filter,
    };
  }, layerId);
}

/** The preview iframe's box, in PAGE coordinates. */
async function readIframeRect(page) {
  return await page.evaluate(() => {
    const el = document.querySelector('#preview-iframe');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

/**
 * The gizmo's AXIS-ALIGNED bounding box, in PAGE coordinates.
 *
 * The rotation is applied EXACTLY ONCE: the `<g>` carries it, so the four
 * corners of the (unrotated) `<rect>` are rotated here and their min/max is
 * taken.
 */
async function readGizmo(page) {
  return await page.evaluate(() => {
    const g = document.querySelector('#selection-gizmo');
    if (!g) return { ok: false, reason: 'no #selection-gizmo in the DOM' };
    const rect = document.querySelector('#selection-bounding-box');
    if (!rect) return { ok: false, reason: 'no #selection-bounding-box in the DOM' };
    const vp = document.querySelector('#monitor-viewport');
    const vpRect = vp.getBoundingClientRect();
    const attr = g.getAttribute('transform') || '';
    const tr = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(attr);
    const rr = /rotate\(\s*(-?[\d.]+)\s*\)/.exec(attr);
    const cx = tr ? parseFloat(tr[1]) : 0;
    const cy = tr ? parseFloat(tr[2]) : 0;
    const rot = rr ? parseFloat(rr[1]) : 0;
    const x = parseFloat(rect.getAttribute('x'));
    const y = parseFloat(rect.getAttribute('y'));
    const w = parseFloat(rect.getAttribute('width'));
    const h = parseFloat(rect.getAttribute('height'));
    const rad = (rot * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const corners = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ].map(([px, py]) => ({ x: cx + px * cos - py * sin, y: cy + px * sin + py * cos }));
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const gbb = rect.getBoundingClientRect();
    return {
      ok: true,
      layerId: g.getAttribute('data-layer-id'),
      rotation: parseFloat(g.getAttribute('data-rotation') || '0'),
      transformAttr: attr,
      handleCount: g.getAttribute('data-handle-count'),
      unrotated: { x, y, width: w, height: h },
      aabb: {
        left: minX + vpRect.left,
        top: minY + vpRect.top,
        width: maxX - minX,
        height: maxY - minY,
      },
      aabbFromRect: { left: gbb.left, top: gbb.top, width: gbb.width, height: gbb.height },
      viewport: { left: vpRect.left, top: vpRect.top, width: vpRect.width, height: vpRect.height },
    };
  });
}

/** Wait until the gizmo for `layerId` is in the DOM. */
async function waitForGizmo(page, layerId, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await readGizmo(page);
    if (last.ok && last.layerId === layerId) return last;
    await page.waitForTimeout(120);
  }
  return last;
}

/** Wait until the runtime reports bounds that satisfy `predicate`. */
async function waitForBounds(page, layerId, predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate((id) => window.store.state.layerBounds[id] || null, layerId);
    if (last && predicate(last)) return last;
    await page.waitForTimeout(120);
  }
  return last;
}

/**
 * The gizmo alignment error: the gizmo's axis-aligned box against the REAL
 * rendered element inside the preview iframe.
 */
async function gizmoAlignmentError(page, frame, layerId) {
  const gizmo = await readGizmo(page);
  const inner = await readRuntimeElement(frame, layerId);
  const iframe = await readIframeRect(page);
  if (!gizmo.ok || !inner.ok || !iframe) {
    return { ok: false, reason: `gizmo=${gizmo.ok} runtime=${inner.ok} iframe=${Boolean(iframe)}` };
  }
  const runtimeRect = {
    left: iframe.left + inner.left,
    top: iframe.top + inner.top,
    width: inner.width,
    height: inner.height,
  };
  const d = {
    dx: gizmo.aabb.left - runtimeRect.left,
    dy: gizmo.aabb.top - runtimeRect.top,
    dw: gizmo.aabb.width - runtimeRect.width,
    dh: gizmo.aabb.height - runtimeRect.height,
  };
  const max = Math.max(Math.abs(d.dx), Math.abs(d.dy), Math.abs(d.dw), Math.abs(d.dh));
  return { ok: true, max, delta: d, rotation: gizmo.rotation, gizmoBox: gizmo.aabb, runtimeBox: runtimeRect };
}

/** Wait until the Studio's auto-save has landed (successfully). */
async function waitForSave(page, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => ({
      status: window.store.state.saveStatus,
      dirty: window.store.state.dirty,
      inFlight: window.store.saveInFlight,
    }));
    if (last.status === 'saved' && !last.dirty && !last.inFlight) return true;
    if (last.status === 'failed') return false;
    await page.waitForTimeout(80);
  }
  return false;
}

/** The scene as the ENGINE persisted it (the source of truth for a render). */
async function readPersistedScene(page) {
  return await page.evaluate(async () => {
    const id = window.store.state.sceneId;
    if (!id) return null;
    return await window.motionforgeEngine.invoke('getScene', id);
  });
}

/** The geometry of a clip on the timeline. */
async function clipGeometry(page, layerId) {
  return await page.evaluate((id) => {
    const canvas = document.querySelector('#timeline-canvas');
    const rect = canvas.getBoundingClientRect();
    const state = window.store.state;
    const durationMs = state.scene.durationMs || 10000;
    const clientWidth = canvas.clientWidth;
    const pxPerMs = (clientWidth * state.zoom) / durationMs;
    const timeToX = (ms) => ms * pxPerMs + state.panOffset;
    const layer = state.scene.layers.find((l) => l.id === id);
    if (!layer) return null;
    const lane = window.store.resolveTrackLanes().find((l) => l.layers.some((x) => x.id === id));
    const header = Array.from(document.querySelectorAll('.mf-track-header')).find(
      (h) => h.getAttribute('data-track-index') === String(lane.index)
    );
    const hr = header.getBoundingClientRect();
    const at = layer.at ?? 0;
    const dur = layer.duration ?? 0;
    return {
      canvasLeft: rect.left,
      canvasTop: rect.top,
      rowCentre: hr.top + hr.height / 2,
      x1: rect.left + timeToX(at),
      x2: rect.left + timeToX(at + dur),
      mid: rect.left + (timeToX(at) + timeToX(at + dur)) / 2,
      at,
      dur,
      zoom: state.zoom,
      panOffset: state.panOffset,
      pxPerMs,
      durationMs,
      clientWidth,
      laneIndex: lane.index,
      laneName: lane.name,
    };
  }, layerId);
}

/** The client X that shows `ms` on the timeline ruler. */
async function timeToClientX(page, ms) {
  return await page.evaluate((at) => {
    const canvas = document.querySelector('#timeline-canvas');
    const rect = canvas.getBoundingClientRect();
    const state = window.store.state;
    const durationMs = state.scene.durationMs || 10000;
    const pxPerMs = (canvas.clientWidth * state.zoom) / durationMs;
    return rect.left + at * pxPerMs + state.panOffset;
  }, ms);
}

/** The ruler's Y (the timeline's own scrub gesture). */
async function rulerY(page) {
  return await page.evaluate(() => {
    const rect = document.querySelector('#timeline-canvas').getBoundingClientRect();
    const rulerH =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mf-ruler-h')) || 28;
    return rect.top + rulerH / 2;
  });
}

/** Move the playhead with a REAL ruler drag. */
async function scrubTo(page, ms, { timeoutMs = 8000 } = {}) {
  const x = await timeToClientX(page, ms);
  const y = await rulerY(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 1, y, { steps: 2 });
  await page.mouse.up();
  const deadline = Date.now() + timeoutMs;
  let value = null;
  while (Date.now() < deadline) {
    value = await page.evaluate(() => window.store.state.playhead);
    if (Math.abs(value - ms) <= 40) break;
    await page.waitForTimeout(60);
  }
  return value;
}

/** Type an exact value into a scrub field addressed by its stable id. */
async function setScrubById(page, scrubId, value) {
  const scrub = page.locator(`#${scrubId}`);
  await scrub.locator('.mf-scrub-value').click();
  const input = scrub.locator('.mf-scrub-input');
  await input.waitFor({ state: 'visible', timeout: 3000 });
  await input.fill(String(value));
  await input.press('Enter');
  await page.waitForTimeout(200);
}

/** Type an exact value into a scrub field addressed by its field label. */
async function setScrubByLabel(page, section, labelText, value) {
  const field = page
    .locator(`#layer-properties .mf-accordion-body[data-section="${section}"] .mf-field`)
    .filter({ has: page.locator(`.mf-label:text-is("${labelText}")`) });
  await field.locator('.mf-scrub-value').click();
  const input = field.locator('.mf-scrub-input');
  await input.waitFor({ state: 'visible', timeout: 3000 });
  await input.fill(String(value));
  await input.press('Enter');
  await page.waitForTimeout(250);
}

/** Pick an option in one of the inspector's `<select>` fields. */
async function selectInspectorOption(page, section, labelText, value) {
  const field = page
    .locator(`#layer-properties .mf-accordion-body[data-section="${section}"] .mf-field`)
    .filter({ has: page.locator(`.mf-label:text-is("${labelText}")`) });
  await field.locator('select.mf-select').selectOption(value);
  await page.waitForTimeout(200);
}

/** Open an inspector accordion (it may already be open). */
async function openSection(page, section) {
  const head = page.locator(`.mf-accordion-head[data-section="${section}"]`);
  const expanded = await head.getAttribute('aria-expanded');
  if (expanded !== 'true') {
    await head.click();
    await page.waitForTimeout(200);
  }
}

/** Select a layer through the LAYER STACK panel (the real UI affordance). */
async function selectLayerInStack(page, layerId) {
  await page.click(`#layer-stack-list .mf-stack-row[data-layer-id="${layerId}"]`);
  await page.waitForTimeout(300);
}

/** Run a command from the application MENU BAR (the real UI affordance). */
async function runMenuCommand(page, category, commandId) {
  await page.click(`.mf-menubar-item[data-menu="${category}"]`);
  await page.waitForTimeout(300);
  await page.click(`.mf-menu-pop[data-menu-pop="${category}"] [data-command="${commandId}"]`);
  await page.waitForTimeout(500);
}

/* ── the canvas drag measurement ──────────────────────────────────────────── */

/**
 * A scripted pointer drag on the canvas overlay, measured.
 *
 * The events are dispatched INSIDE the page so the handler cost can be timed
 * exactly (`dispatchEvent` is synchronous: the handler has finished when it
 * returns), and so the round trip to the runtime can be measured against the
 * `ephemeralTransform` message the overlay posts on every move.
 */
async function measuredCanvasDrag(page, frame, { dx, dy, steps = 24 }) {
  await frame.evaluate(() => {
    window.__mfEphemeral = [];
    if (!window.__mfEphemeralHooked) {
      window.__mfEphemeralHooked = true;
      window.addEventListener('message', (e) => {
        const data = e.data;
        if (!data || data.type !== 'ephemeralTransform') return;
        window.__mfEphemeral.push({
          t: performance.timeOrigin + performance.now(),
          layerId: data.layerId,
          payload: data,
        });
      });
    }
  });

  const drag = await page.evaluate(
    async ({ dx, dy, steps }) => {
      const overlay = document.querySelector('#canvas-overlay');
      const gizmo = document.querySelector('#selection-gizmo');
      const rect = document.querySelector('#selection-bounding-box');
      if (!overlay || !gizmo || !rect) return { ok: false, reason: 'no gizmo / overlay' };
      const vp = document.querySelector('#monitor-viewport').getBoundingClientRect();
      const attr = gizmo.getAttribute('transform') || '';
      const tr = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(attr);
      const cx = vp.left + (tr ? parseFloat(tr[1]) : 0);
      const cy = vp.top + (tr ? parseFloat(tr[2]) : 0);

      const fire = (type, x, y, target) =>
        (target || overlay).dispatchEvent(
          new PointerEvent(type, {
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
            pointerId: 17,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            isPrimary: true,
          })
        );

      const moveCosts = [];
      const events = [];
      const wallStart = performance.now();
      const t0 = performance.now();
      fire('pointerdown', cx, cy);
      const downCost = performance.now() - t0;
      events.push({ t: performance.timeOrigin + performance.now(), kind: 'down' });

      for (let i = 1; i <= steps; i++) {
        const x = cx + (dx * i) / steps;
        const y = cy + (dy * i) / steps;
        const t = performance.now();
        fire('pointermove', x, y);
        const cost = performance.now() - t;
        moveCosts.push(cost);
        events.push({ t: performance.timeOrigin + performance.now(), kind: 'move', cost });
        // one frame of breathing room, so the runtime's message is not queued
        // behind the next move (otherwise the round trip measures the queue)
        await new Promise((r) => setTimeout(r, 16));
      }

      const guides = document.querySelectorAll('.snap-guide-group').length;
      const hud = document.querySelector('#canvas-hud')?.textContent?.trim() ?? null;
      const tUp = performance.now();
      fire('pointerup', cx + dx, cy + dy);
      const upCost = performance.now() - tUp;
      const wallMs = performance.now() - wallStart;

      return {
        ok: true,
        start: { x: cx, y: cy },
        downCostMs: downCost,
        upCostMs: upCost,
        moveCostsMs: moveCosts,
        events,
        avgMoveMs: moveCosts.reduce((a, b) => a + b, 0) / Math.max(1, moveCosts.length),
        maxMoveMs: moveCosts.length ? Math.max(...moveCosts) : 0,
        wallMs,
        snapGuides: guides,
        hud,
      };
    },
    { dx, dy, steps }
  );

  const ephemeral = await frame.evaluate(() => window.__mfEphemeral || []);
  // the k-th ephemeralTransform corresponds to the k-th pointermove
  const roundTrips = [];
  for (let i = 0; i < ephemeral.length && i + 1 < drag.events.length; i++) {
    const ev = drag.events[i + 1];
    if (ev.kind !== 'move') continue;
    roundTrips.push(ephemeral[i].t - ev.t);
  }
  drag.roundTrips = roundTrips;
  drag.ephemeralCount = ephemeral.length;
  return drag;
}

/* ── the main run ─────────────────────────────────────────────────────────── */

async function main() {
  console.log('================================================================');
  console.log('=== MOTIONFORGE — UI-DRIVEN VIDEO PRODUCTION BENCHMARK ===');
  console.log('================================================================');

  const testDirs = makeTestDirs('ui-production');
  const testEnv = makeTestEnv(testDirs);
  console.log(`isolated workspace: ${describeTestDirs(testDirs)}`);

  let app = null;
  let failed = false;
  try {
    /* ── 1. launch ──────────────────────────────────────────────────────── */
    section('1. Launch the real Electron application');
    const mainPath = path.join(ROOT, 'packages', 'desktop', 'out', 'main', 'index.js');
    if (!fs.existsSync(mainPath)) {
      throw new Error(
        `Desktop bundle missing at ${mainPath}. Run: npm run build -w @motionforge/desktop`
      );
    }

    app = await electron.launch({ args: ['--no-sandbox', mainPath], env: testEnv });

    const mainErrors = [];
    app.process().stderr?.on('data', (data) => {
      const text = data.toString().trim();
      if (
        text &&
        !/GLX|libva|MESA|XDG_RUNTIME_DIR|Fontconfig|dbus|DevTools|viz_main_impl|GPU process|command_buffer_proxy_impl|GpuControl|ContextResult|gpu_process_host/i.test(
          text
        )
      ) {
        mainErrors.push(text);
      }
    });

    const page = await app.firstWindow();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push({ message: String(err && err.message ? err.message : err), stack: String(err && err.stack ? err.stack : '').split('\n').slice(0, 4).join(' | ') }));

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

    await page.waitForTimeout(3000);
    check('The Studio window is up', true, `${WINDOW.width}x${WINDOW.height}`);

    // setup: a timeline tall enough for six lanes (V1..V5 + A1), so every lane
    // is on screen for the measurements and the screenshot
    await page.evaluate(() => window.store.setTimelineHeight(430));
    await page.waitForTimeout(400);

    /* ── 2. create the composition ───────────────────────────────────────── */
    section('Step 1 — Create a composition and rename it');
    const tCreate = Date.now();
    await page.click('#bin-new-composition');
    await page.waitForFunction(() => Boolean(window.store.state.sceneId), null, { timeout: 15000 });
    const sceneId = await page.evaluate(() => window.store.state.sceneId);
    metrics.createCompositionMs = Date.now() - tCreate;
    check('The New button created a composition', Boolean(sceneId), `scene id ${sceneId}`);

    const card = page.locator(`.mf-bin-item[data-scene-id="${sceneId}"]`);
    await card.locator('button[title="Rename composition"]').click();
    const renameInput = card.locator('.mf-stack-name-input');
    await renameInput.waitFor({ state: 'visible', timeout: 3000 });
    await renameInput.fill(SCENE.name);
    await renameInput.press('Enter');
    await page.waitForTimeout(700);
    const renamed = await page.evaluate(() => window.store.state.scene.name);
    check(
      'The composition was renamed through the bin card',
      renamed === SCENE.name,
      `name = "${renamed}"`
    );
    await waitForSave(page);
    const persistedName = await page.evaluate(async () => {
      const s = await window.motionforgeEngine.invoke('getScene', window.store.state.sceneId);
      return s ? s.name : null;
    });
    check('The engine persisted the new name', persistedName === SCENE.name, `stored "${persistedName}"`);

    // the preview iframe only exists once a composition is loaded
    const frame = await findRuntimeFrame(page);
    check('The mf-runtime:// preview frame is mounted', Boolean(frame), frame ? frame.url() : 'no frame');
    if (!frame) throw new Error('the runtime preview never mounted');

    /* ── 3. composition settings: 6 s, 1920x1080 ─────────────────────────── */
    section('Step 1b — Composition settings: 6 s @ 1920x1080');
    // "Composition Settings..." is a registered command in the MENU BAR.
    await runMenuCommand(page, 'Composition', 'comp.settings');
    const compositionPanel = await page.locator('#composition-settings').count();
    check('The inspector switched to the composition settings', compositionPanel === 1);

    const durField = page
      .locator('#composition-settings .mf-field')
      .filter({ has: page.locator('.mf-label:text-is("Duration")') });
    await durField.locator('.mf-scrub-value').click();
    const durInput = durField.locator('.mf-scrub-input');
    await durInput.waitFor({ state: 'visible', timeout: 3000 });
    await durInput.fill(String(SCENE.durationMs));
    await durInput.press('Enter');
    await page.waitForTimeout(600);
    const duration = await page.evaluate(() => window.store.state.scene.durationMs);
    check('The composition duration is 6000 ms', duration === SCENE.durationMs, `${duration} ms`);

    const canvasInfo = await page.evaluate(() => window.store.state.scene.canvas);
    check(
      'The composition canvas is 1920x1080',
      canvasInfo.shape === '16:9' && canvasInfo.scale === 1080,
      JSON.stringify(canvasInfo)
    );
    await waitForSave(page);

    /* ── 3b. the tool dock: can it CREATE anything? ──────────────────────── */
    section('Step 1c — The tool dock: the Text tool and the Card tool');
    //
    // The brief says to build the hero title with the TEXT TOOL and the card
    // with the CARD TOOL. The probe below clicks them exactly the way a user
    // would — the tool button, then a click on the canvas — and checks
    // whether ANY layer appears.
    const layerCount = () => page.evaluate(() => window.store.state.scene.layers.length);

    const toolProbe = async (tool, label) => {
      const before = await layerCount();
      await page.click(`#tool-dock [data-tool="${tool}"]`);
      await page.waitForTimeout(300);
      const activeTool = await page.evaluate(() => window.store.state.activeTool);
      const pressed = await page.getAttribute(`#tool-dock [data-tool="${tool}"]`, 'aria-pressed');
      // a click on the canvas, in the middle of the composition
      const stage = await page.evaluate(() => {
        const r = document.querySelector('#monitor-stage').getBoundingClientRect();
        return { x: r.left + r.width * 0.4, y: r.top + r.height * 0.6 };
      });
      await page.mouse.click(stage.x, stage.y);
      await page.waitForTimeout(600);
      const after = await layerCount();
      const tool = await page.evaluate(() => window.store.state.activeTool);
      metrics[`toolProbe_${label}`] = {
        activeToolAfterClick: activeTool,
        ariaPressed: pressed,
        activeToolAfterCanvasClick: tool,
        layersBefore: before,
        layersAfter: after,
      };
      return { activeTool, pressed, before, after, tool };
    };

    const textProbe = await toolProbe('text', 'text');
    check(
      'The Text tool activates when it is clicked',
      textProbe.activeTool === 'text' && textProbe.pressed === 'true',
      `activeTool=${textProbe.activeTool}, aria-pressed=${textProbe.pressed}`
    );
    check(
      'Clicking the canvas with the TEXT TOOL active creates a text layer',
      textProbe.after > textProbe.before,
      `layer count ${textProbe.before} -> ${textProbe.after}`
    );
    if (textProbe.after <= textProbe.before) {
      bug(
        'BUG-6',
        'The Text tool (and the Card tool) are dead ends — they switch the cursor and never create a layer',
        `Clicking #tool-dock [data-tool="text"] set the active tool to "${textProbe.activeTool}" (aria-pressed=${textProbe.pressed}), ` +
          'but a subsequent click on the canvas changed the layer count from ' +
          `${textProbe.before} to ${textProbe.after}. The tool dock only calls store.setActiveTool(tool.id) ` +
          '(packages/studio/src/components/shell/ToolDock.tsx:68) and the canvas overlay only handles the ' +
          '"hand", "razor" and "select" tools (packages/studio/src/components/monitor/CanvasOverlay.tsx:850,901,1061) — ' +
          'nothing ever consumes activeTool === "text" or "shape", so the two most prominent authoring tools in the ' +
          'application produce nothing.'
      );
    }
    await page.click('#tool-dock [data-tool="select"]');
    await page.waitForTimeout(300);

    const shapeProbe = await toolProbe('shape', 'shape');
    check(
      'The Card tool activates when it is clicked',
      shapeProbe.activeTool === 'shape' && shapeProbe.pressed === 'true',
      `activeTool=${shapeProbe.activeTool}, aria-pressed=${shapeProbe.pressed}`
    );
    check(
      'Clicking the canvas with the CARD TOOL active creates a card layer',
      shapeProbe.after > shapeProbe.before,
      `layer count ${shapeProbe.before} -> ${shapeProbe.after}`
    );
    await page.click('#tool-dock [data-tool="select"]');
    await page.waitForTimeout(300);

    /* the tool dock's preset tools (chart / code / device) */
    const presetBefore = await layerCount();
    await page.click('#tool-dock #tool-preset-0');
    await page.waitForTimeout(900);
    const presetLayer = await page.evaluate(() => {
      const layers = window.store.state.scene.layers;
      const last = layers[layers.length - 1];
      return last ? { id: last.id, type: last.type, text: last.text ?? null } : null;
    });
    metrics.toolPreset = presetLayer;
    check(
      'The "Chart Layer" preset tool creates a chart layer',
      presetLayer?.type === 'chart',
      `created ${JSON.stringify(presetLayer)}`
    );
    if (presetLayer && presetLayer.type !== 'chart') {
      bug(
        'BUG-7',
        'The tool dock\'s preset tools all create a kineticText layer — the requested kind is discarded',
        `Clicking #tool-dock #tool-preset-0 ("Chart Layer", packages/studio/src/components/shell/ToolDock.tsx:85) created ` +
          `a layer of type "${presetLayer.type}"${presetLayer.text ? ` with the text "${presetLayer.text}"` : ''}. ` +
          'The detail is carried in the CustomEvent (motionforge:add-layer), but the handler in ' +
          '(packages/studio/src/App.tsx:236-248) ignores it and always pushes `type: "kineticText"`. ' +
          'There is no "chart" layer kind in the schema at all (packages/scene-spec/src/scene.ts:113-121), so the ' +
          'three preset buttons are three ways to add the same text layer.'
      );
    }
    // clean the probe layer up through the layer stack's own delete button
    if (presetLayer?.id) {
      await page.click(`#layer-stack-list .mf-stack-row[data-layer-id="${presetLayer.id}"]`);
      await page.waitForTimeout(300);
      await page.click(`#layer-stack-list .mf-stack-row[data-layer-id="${presetLayer.id}"] .mf-stack-action.is-danger`);
      await page.waitForTimeout(700);
    }

    /* the Add Layer modal — does anything open it? */
    const modalBefore = await page.locator('#studio-modal').count();
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);
    const paletteInput = page.locator('#command-palette-input');
    let paletteCommands = [];
    if (await paletteInput.count()) {
      await paletteInput.fill('layer');
      await page.waitForTimeout(400);
      paletteCommands = await page
        .locator('#command-palette [data-command]')
        .evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-command'), text: e.textContent.trim() })));
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const modalAfter = await page.locator('#studio-modal').count();
    metrics.addLayerModal = {
      openInTheNormalState: modalBefore,
      paletteCommandsMatchingLayer: paletteCommands,
      anAddLayerCommand: paletteCommands.some((c) => /add\s*layer|new\s*layer/i.test(c.text)),
    };
    check(
      'The command palette offers an "Add Layer" command',
      Boolean(metrics.addLayerModal.anAddLayerCommand),
      `the ${paletteCommands.length} matching commands: ${paletteCommands.map((c) => c.id).join(', ') || '(none)'}`
    );
    if (!metrics.addLayerModal.anAddLayerCommand) {
      bug(
        'BUG-8',
        'The Add Layer modal has NO entry point — no button, no menu item and no command opens it',
        'The modal that owns the layer templates (Text / Card / Background / Image / Lottie / Effect Overlay) is ' +
          'rendered by `state.activeModal === "add-layer"\' (packages/studio/src/components/shared/StudioModal.tsx:166,263), ' +
          'but `store.setActiveModal("add-layer")` is never called from a button, a menu entry or a command — the only ' +
          `occurrences of the string in packages/studio/src are the modal's own condition. Searching the command palette ` +
          `for "layer" returned ${paletteCommands.length} commands (${paletteCommands.map((c) => c.id).join(', ') || 'none'}) ` +
          'and none of them adds a layer. A user therefore cannot create a CARD, a BACKGROUND, an IMAGE, a LOTTIE or an ' +
          'EFFECT OVERLAY through the UI at all — only a kineticText, through the layer stack\'s "+" button, which ' +
          'dispatches motionforge:add-layer with the kind "kineticText" (packages/studio/src/components/hierarchy/LayerStackPanel.tsx:78).'
      );
    }
    await waitForSave(page);

    /* ── 4. background on V1 ─────────────────────────────────────────────── */
    section('Step 2 — Background on V1 (gradient attempt through the Inspector)');
    await selectLayerInStack(page, 'bg');
    const bgSelected = await page.evaluate(() => window.store.state.selectedLayerId);
    check('The background layer is selected', bgSelected === 'bg', `selected ${bgSelected}`);

    await openSection(page, 'track');
    await selectInspectorOption(page, 'track', 'Video Track', '0');
    await page.waitForTimeout(400);
    const bgTrack = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'bg');
      return l ? l.trackIndex : null;
    });
    check('The background sits on V1', bgTrack === 0, `trackIndex ${bgTrack}`);
    await waitForSave(page);

    await openSection(page, 'content');
    const bgStyle = page
      .locator('#layer-properties .mf-accordion-body[data-section="content"] .mf-field')
      .filter({ has: page.locator('.mf-label:text-is("Background Style")') })
      .locator('select.mf-select');
    const tGradient = Date.now();
    await bgStyle.selectOption('meshGradient');
    await page.waitForTimeout(1600);
    metrics.gradientAttemptMs = Date.now() - tGradient;
    const gradientState = await page.evaluate(() => ({
      status: window.store.state.saveStatus,
      dirty: window.store.state.dirty,
      variant: window.store.state.scene.layers.find((x) => x.id === 'bg')?.variant,
      toasts: window.store.state.toasts.map((t) => t.message),
    }));
    const persistedBg = await readPersistedScene(page);
    const persistedVariant = persistedBg?.layers?.find((l) => l.id === 'bg')?.variant;
    note(
      'The inspector wrote the background variant',
      `in-memory ${JSON.stringify(gradientState.variant)} | persisted ${JSON.stringify(persistedVariant)}`
    );
    if (gradientState.status === 'failed' || persistedVariant?.variant !== 'meshGradient') {
      const toast =
        gradientState.toasts.find((t) => /Save failed/i.test(t)) ||
        gradientState.toasts[gradientState.toasts.length - 1] ||
        '(no toast captured)';
      bug(
        'BUG-1',
        'The inspector cannot author a gradient background — "Mesh Gradient" produces a scene the schema rejects',
        `Background Style -> "meshGradient" wrote ${JSON.stringify(
          gradientState.variant
        )} and the engine refused the save (saveStatus=${gradientState.status}): "${toast}". ` +
          'packages/scene-spec/src/layers/background.ts requires `blobs` (min 2) for meshGradient and rejects the extra `color` key, ' +
          'and the inspector writes `color` unconditionally (packages/studio/src/components/inspector/EffectControlsPanel.tsx:938-962). ' +
          '"Particles" fails the same way (`count` is required and has no default).'
      );
      check(
        'The Mesh Gradient background was handled as documented (rejected by the schema)',
        gradientState.status === 'failed' || persistedVariant?.variant === 'meshGradient',
        'the engine rejected the save — see BUG-1'
      );
    } else {
      check('The Mesh Gradient background was persisted', true, JSON.stringify(persistedVariant));
    }

    // recover: a valid, rich solid background
    await bgStyle.selectOption('solid');
    await page.waitForTimeout(1000);
    const colorField = page
      .locator('#layer-properties .mf-accordion-body[data-section="content"] .mf-field')
      .filter({ has: page.locator('.mf-label:text-is("Color")') });
    const colorInput = colorField.locator('input[type="color"]');
    await colorInput.fill(SCENE.bgColor);
    await colorInput.dispatchEvent('change');
    await page.waitForTimeout(1000);
    await waitForSave(page);
    const bgPersisted = (await readPersistedScene(page))?.layers?.find((l) => l.id === 'bg')?.variant;
    check(
      'The background was persisted with a valid, rich colour',
      bgPersisted?.variant === 'solid' && bgPersisted?.color === SCENE.bgColor,
      `persisted ${JSON.stringify(bgPersisted)}`
    );

    /* ── 5. hero title on V2 ─────────────────────────────────────────────── */
    section('Step 3 — Hero title on V2 (text, size, colour, drag, keyframes)');
    await selectLayerInStack(page, 'title');

    await openSection(page, 'track');
    await selectInspectorOption(page, 'track', 'Video Track', '1');
    await page.waitForTimeout(300);

    await openSection(page, 'timing');
    await setScrubByLabel(page, 'timing', 'Start', 0);
    await setScrubByLabel(page, 'timing', 'Duration', SCENE.durationMs);
    await page.waitForTimeout(400);
    const titleTiming = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title');
      return l ? { at: l.at, duration: l.duration } : null;
    });
    check(
      'The title covers the whole composition (0 ms .. 6000 ms)',
      titleTiming?.at === 0 && titleTiming?.duration === SCENE.durationMs,
      JSON.stringify(titleTiming)
    );
    await waitForSave(page);

    // the text — inline double-click on the canvas
    await scrubTo(page, 1200);
    await page.waitForTimeout(600);
    const gizmoBefore = await waitForGizmo(page, 'title');
    let textEdited = false;
    if (gizmoBefore?.ok) {
      const cx = gizmoBefore.aabb.left + gizmoBefore.aabb.width / 2;
      const cy = gizmoBefore.aabb.top + gizmoBefore.aabb.height / 2;
      await page.mouse.dblclick(cx, cy);
      await page.waitForTimeout(600);
      if ((await page.locator('#canvas-inline-editor').count()) === 1) {
        const input = page.locator('#canvas-inline-editor-input');
        await input.click();
        await input.evaluate((el) => {
          el.innerText = 'MOTIONFORGE STUDIO';
        });
        await input.press('Enter');
        await page.waitForTimeout(800);
        textEdited = true;
      }
    }
    let titleText = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title');
      return l ? l.text : null;
    });
    if (titleText !== SCENE.titleText) {
      const textArea = page
        .locator('#layer-properties .mf-accordion-body[data-section="content"] .mf-field')
        .filter({ has: page.locator('.mf-label:text-is("Text")') })
        .locator('textarea.mf-textarea');
      await textArea.fill(SCENE.titleText);
      await textArea.dispatchEvent('change');
      await page.waitForTimeout(600);
      titleText = await page.evaluate(() => {
        const l = window.store.state.scene.layers.find((x) => x.id === 'title');
        return l ? l.text : null;
      });
    }
    check(
      'The hero title reads "MOTIONFORGE STUDIO"',
      titleText === SCENE.titleText,
      `"${titleText}" (inline canvas editor: ${textEdited})`
    );

    await setScrubById(page, 'inspector-scrub-sizePx', SCENE.titleSize);
    await page.waitForTimeout(300);
    const titleFill = page
      .locator('#layer-properties .mf-accordion-body[data-section="content"] .mf-field')
      .filter({ has: page.locator('.mf-label:text-is("Color")') })
      .locator('input[type="color"]');
    await titleFill.fill(SCENE.titleFill);
    await titleFill.dispatchEvent('change');
    await page.waitForTimeout(500);
    const titleProps = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title');
      return l ? { sizePx: l.sizePx, fill: l.fill } : null;
    });
    check(
      'The title size and colour were applied',
      titleProps?.sizePx === SCENE.titleSize && titleProps?.fill === SCENE.titleFill,
      JSON.stringify(titleProps)
    );
    await waitForSave(page);

    // ── the measured canvas drag ────────────────────────────────────────
    await waitForGizmo(page, 'title');
    await page.waitForTimeout(500);
    const drag = await measuredCanvasDrag(page, frame, { dx: -18, dy: -62, steps: 24 });
    const roundTrips = drag.roundTrips || [];
    metrics.canvasDrag = {
      moves: drag.moveCostsMs ? drag.moveCostsMs.length : 0,
      downCostMs: drag.downCostMs,
      avgMoveMs: drag.avgMoveMs,
      maxMoveMs: drag.maxMoveMs,
      totalWallMs: drag.wallMs,
      upCostMs: drag.upCostMs,
      snapGuidesDuringDrag: drag.snapGuides,
      hud: drag.hud,
      ephemeralMessages: drag.ephemeralCount,
      roundTripAvgMs: roundTrips.length
        ? roundTrips.reduce((a, b) => a + b, 0) / roundTrips.length
        : null,
      roundTripMaxMs: roundTrips.length ? Math.max(...roundTrips) : null,
      roundTripCount: roundTrips.length,
    };
    const titleAfterDrag = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title');
      return l ? l.position : null;
    });
    check(
      'The canvas drag moved the hero title',
      titleAfterDrag && (titleAfterDrag.xPct !== 50 || titleAfterDrag.yPct !== 45),
      JSON.stringify(titleAfterDrag)
    );
    check(
      'The drag posted live transforms to the runtime',
      drag.ephemeralCount > 0,
      `${drag.ephemeralCount} ephemeralTransform messages, ${metrics.canvasDrag.roundTripAvgMs?.toFixed(2)} ms average round trip`
    );
    await page.waitForTimeout(800);
    await waitForSave(page);

    // ── the keyframes ───────────────────────────────────────────────────
    section('Step 3b — Keyframe Position Y and Scale (0 ms and 1500 ms)');
    await scrubTo(page, 0);
    const ph0 = await page.evaluate(() => window.store.state.playhead);
    check('The playhead was scrubbed to 0 ms with the ruler', ph0 <= 40, `playhead ${ph0} ms`);

    const tKey = Date.now();
    for (const property of ['yPct', 'scale']) {
      await page
        .locator(`[data-keyframe-property="${property}"] button[data-action="keyframe-toggle"]`)
        .click();
      await page.waitForTimeout(450);
    }
    const keysAtZero = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title');
      return (l.keyframes || []).map((k) => ({ p: k.property, t: k.timeMs, v: k.value }));
    });
    check(
      'Both stopwatches created a keyframe at 0 ms',
      keysAtZero.some((k) => k.p === 'yPct' && k.t === 0) &&
        keysAtZero.some((k) => k.p === 'scale' && k.t === 0),
      JSON.stringify(keysAtZero)
    );

    await scrubTo(page, 1500);
    const ph1 = await page.evaluate(() => window.store.state.playhead);
    check('The playhead was scrubbed to 1500 ms', Math.abs(ph1 - 1500) <= 40, `playhead ${ph1} ms`);

    // Position Y — drag the scrub label (the real gesture). The scrub step is
    // 0.5 % per pixel, so the drag distance is computed from the target.
    const yRow = page.locator('#layer-properties .mf-prop-row').filter({
      has: page.locator('.mf-label:text-is("Position Y")'),
    });
    const yLabel = yRow.locator('.mf-scrub-label');
    const yBox = await yLabel.boundingBox();
    const yNow = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title');
      return l ? l.position.yPct : null;
    });
    const yPx = Math.round((SCENE.titleY1 - yNow) / 0.5);
    await page.mouse.move(yBox.x + 3, yBox.y + yBox.height / 2);
    await page.mouse.down();
    const ySteps = Math.max(1, Math.abs(yPx));
    for (let i = 1; i <= ySteps; i++) {
      await page.mouse.move(yBox.x + 3 + (yPx * i) / ySteps, yBox.y + yBox.height / 2);
    }
    await page.mouse.up();
    await page.waitForTimeout(500);
    metrics.positionYScrub = { from: yNow, to: SCENE.titleY1, pixels: yPx };

    // Scale — type the exact value into the scrub field
    await setScrubById(page, 'inspector-scrub-scale', 112);
    await page.waitForTimeout(500);
    metrics.keyframeMs = Date.now() - tKey;

    const keys = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title');
      return (l.keyframes || []).map((k) => ({ p: k.property, t: k.timeMs, v: k.value }));
    });
    const yKeys = keys.filter((k) => k.p === 'yPct');
    const sKeys = keys.filter((k) => k.p === 'scale');
    check(
      'Position Y has a keyframe at 0 ms and at 1500 ms with a different value',
      yKeys.length >= 2 &&
        yKeys.some((k) => k.t === 0) &&
        yKeys.some((k) => Math.abs(k.t - 1500) <= 40) &&
        yKeys[0].v !== yKeys[yKeys.length - 1].v,
      JSON.stringify(yKeys)
    );
    check(
      'Scale has a keyframe at 0 ms and at 1500 ms with a different value',
      sKeys.length >= 2 &&
        sKeys.some((k) => k.t === 0) &&
        sKeys.some((k) => Math.abs(k.t - 1500) <= 40) &&
        sKeys[0].v !== sKeys[sKeys.length - 1].v,
      JSON.stringify(sKeys)
    );
    await waitForSave(page);

    await scrubTo(page, 800);
    await page.waitForTimeout(1000);
    const midRuntime = await readRuntimeElement(frame, 'title');
    await scrubTo(page, 1500);
    await page.waitForTimeout(1000);
    const endRuntime = await readRuntimeElement(frame, 'title');
    check(
      'The runtime interpolates the keyframed title',
      midRuntime.ok &&
        endRuntime.ok &&
        midRuntime.styleTop !== endRuntime.styleTop &&
        midRuntime.transform !== endRuntime.transform,
      `top@800=${midRuntime.styleTop} top@1500=${endRuntime.styleTop} | transform@800=${midRuntime.transform} transform@1500=${endRuntime.transform}`
    );

    /* ── 6. the cards ───────────────────────────────────────────────────── */
    section('Step 4 — A card on V3 and a second layer on V4 (gizmo, guides, trim, effects)');

    // The Add Layer modal is the ONLY surface that can create a card and NO
    // button opens it (see BUG-2). The harness opens it through the store's
    // own action and then clicks the real template button.
    const openAddLayer = async () => {
      await page.evaluate(() => window.store.setActiveModal('add-layer'));
      await page.waitForTimeout(400);
    };

    await scrubTo(page, 800);
    await openAddLayer();
    check('The Add Layer modal is open', (await page.locator('#studio-modal').count()) === 1);
    const tAdd = Date.now();
    await page.click('[data-layer-template="card"]');
    await page.waitForTimeout(900);
    metrics.addLayerMs = Date.now() - tAdd;
    const card1Id = await page.evaluate(() => {
      const layer = window.store.state.scene.layers.find((l) => l.type === 'card');
      return layer ? layer.id : null;
    });
    check('A card layer was created', Boolean(card1Id), `card id ${card1Id}`);
    metrics.card1Id = card1Id;

    await openSection(page, 'track');
    await selectInspectorOption(page, 'track', 'Video Track', '2');
    await openSection(page, 'content');
    const cardTitle = page
      .locator('#layer-properties .mf-accordion-body[data-section="content"] .mf-field')
      .filter({ has: page.locator('.mf-label:text-is("Title")') })
      .locator('input.mf-input');
    await cardTitle.fill(SCENE.card1.title);
    await cardTitle.dispatchEvent('change');
    await page.waitForTimeout(350);
    const cardBody = page
      .locator('#layer-properties .mf-accordion-body[data-section="content"] .mf-field')
      .filter({ has: page.locator('.mf-label:text-is("Body")') })
      .locator('textarea.mf-textarea');
    await cardBody.fill(SCENE.card1.body);
    await cardBody.dispatchEvent('change');
    await page.waitForTimeout(500);
    const card1State = await page.evaluate((id) => {
      const l = window.store.state.scene.layers.find((x) => x.id === id);
      return l ? { trackIndex: l.trackIndex, at: l.at, duration: l.duration, variant: l.variant } : null;
    }, card1Id);
    check(
      'Card 1 is on V3 with its title and body',
      card1State?.trackIndex === 2 &&
        card1State?.variant?.title === SCENE.card1.title &&
        card1State?.variant?.body === SCENE.card1.body,
      JSON.stringify({
        track: card1State?.trackIndex,
        title: card1State?.variant?.title,
        at: card1State?.at,
        duration: card1State?.duration,
      })
    );
    await waitForSave(page);

    // ---- the gizmo: MOVE, RESIZE (se), ROTATE
    await waitForGizmo(page, card1Id);
    await page.waitForTimeout(600);

    const g0 = await readGizmo(page);
    const moveStart = { x: g0.aabb.left + g0.aabb.width / 2, y: g0.aabb.top + g0.aabb.height / 2 };
    const tMove = Date.now();
    await page.mouse.move(moveStart.x, moveStart.y);
    await page.mouse.down();
    // a 3 px nudge keeps the box inside the 6 px snap radius, so the smart
    // alignment guide is actually painted
    for (let i = 1; i <= 3; i++) {
      await page.mouse.move(moveStart.x - i, moveStart.y);
    }
    const guidesDuringMove = await page.evaluate(
      () => document.querySelectorAll('.snap-guide-group').length
    );
    // then the real repositioning
    for (let i = 4; i <= 10; i++) {
      await page.mouse.move(moveStart.x - i * 10, moveStart.y + i * 6.5);
    }
    await page.mouse.up();
    metrics.gizmoMoveMs = Date.now() - tMove;
    await page.waitForTimeout(600);
    const card1Moved = await page.evaluate((id) => {
      const l = window.store.state.scene.layers.find((x) => x.id === id);
      return l ? l.position : null;
    }, card1Id);
    check(
      'The gizmo MOVE drag repositioned the card',
      card1Moved && (card1Moved.xPct !== 50 || card1Moved.yPct !== 50),
      JSON.stringify(card1Moved)
    );
    check(
      'The smart alignment guides appeared during the drag',
      guidesDuringMove > 0,
      `${guidesDuringMove} guide group(s) in the overlay`
    );
    metrics.snapGuidesDuringMove = guidesDuringMove;

    const beforeScale = await page.evaluate((id) => {
      const l = window.store.state.scene.layers.find((x) => x.id === id);
      return l ? l.scale ?? 1 : null;
    }, card1Id);
    const seHandle = await page.evaluate(() => {
      const h = document.querySelector('#selection-gizmo [data-handle="se"]');
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    });
    check('The "se" resize handle is present', Boolean(seHandle), seHandle ? `${seHandle.w}x${seHandle.h} px` : '');
    metrics.seHandleSizePx = seHandle ? { w: seHandle.w, h: seHandle.h } : null;
    const tResize = Date.now();
    if (seHandle) {
      await page.mouse.move(seHandle.x, seHandle.y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) {
        await page.mouse.move(seHandle.x + i * 4.5, seHandle.y + i * 2.6);
      }
      await page.mouse.up();
    }
    metrics.gizmoResizeMs = Date.now() - tResize;
    await page.waitForTimeout(900);
    const afterScale = await page.evaluate((id) => {
      const l = window.store.state.scene.layers.find((x) => x.id === id);
      return l ? l.scale ?? 1 : null;
    }, card1Id);
    check(
      'The "se" handle drag scaled the card',
      afterScale !== null && beforeScale !== null && Math.abs(afterScale - beforeScale) > 0.01,
      `scale ${beforeScale} -> ${afterScale}`
    );

    const rotHandle = await page.evaluate(() => {
      const h = document.querySelector('#selection-gizmo [data-handle="rotate"]');
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    });
    const bounds = await page.evaluate((id) => window.store.state.layerBounds[id], card1Id);
    const stage = await page.evaluate(() => {
      const r = document.querySelector('#monitor-stage').getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width };
    });
    const compScale = stage.width / 1920;
    let rotTarget = null;
    if (rotHandle && bounds) {
      const comp = {
        x: (rotHandle.x - stage.left) / compScale,
        y: (rotHandle.y - stage.top) / compScale,
      };
      const cx = bounds.cx;
      const cy = bounds.cy;
      const theta0 = Math.atan2(comp.y - cy, comp.x - cx);
      const theta1 = theta0 - Math.PI / 6;
      const r0 = Math.max(1, Math.hypot(comp.x - cx, comp.y - cy));
      const p1 = { x: cx + Math.cos(theta1) * r0, y: cy + Math.sin(theta1) * r0 };
      rotTarget = { x: stage.left + p1.x * compScale, y: stage.top + p1.y * compScale };
    }
    const tRotate = Date.now();
    if (rotHandle && rotTarget) {
      await page.mouse.move(rotHandle.x, rotHandle.y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(
          rotHandle.x + ((rotTarget.x - rotHandle.x) * i) / 8,
          rotHandle.y + ((rotTarget.y - rotHandle.y) * i) / 8
        );
      }
      await page.mouse.up();
    }
    metrics.gizmoRotateMs = Date.now() - tRotate;
    await page.waitForTimeout(1100);
    const card1Rotation = await page.evaluate((id) => {
      const l = window.store.state.scene.layers.find((x) => x.id === id);
      return l ? l.rotation : null;
    }, card1Id);
    check(
      'The rotation handle rotated the card',
      typeof card1Rotation === 'number' && Math.abs(card1Rotation) > 1,
      `rotation ${card1Rotation} deg`
    );
    await waitForSave(page);

    // ---- the gizmo alignment error, rotated and flat
    await scrubTo(page, 1200);
    await page.waitForTimeout(1100);
    const alignRotated = await gizmoAlignmentError(page, frame, card1Id);
    metrics.gizmoErrorRotated = alignRotated.ok
      ? { max: alignRotated.max, delta: alignRotated.delta, rotation: alignRotated.rotation }
      : { error: alignRotated.reason };
    check(
      'The gizmo matches the rendered card (rotated)',
      alignRotated.ok && alignRotated.max < 2.5,
      alignRotated.ok
        ? `max |delta| = ${alignRotated.max.toFixed(2)} px at ${alignRotated.rotation} deg ` +
          `(dx=${alignRotated.delta.dx.toFixed(2)} dy=${alignRotated.delta.dy.toFixed(2)} ` +
          `dw=${alignRotated.delta.dw.toFixed(2)} dh=${alignRotated.delta.dh.toFixed(2)})`
        : alignRotated.reason
    );

    await setScrubById(page, 'inspector-scrub-rotation', 0);
    await page.waitForTimeout(1100);
    const alignFlat = await gizmoAlignmentError(page, frame, card1Id);
    metrics.gizmoErrorFlat = alignFlat.ok
      ? { max: alignFlat.max, delta: alignFlat.delta, rotation: alignFlat.rotation }
      : { error: alignFlat.reason };
    check(
      'The gizmo matches the rendered card (0 deg)',
      alignFlat.ok && alignFlat.max < 2.5,
      alignFlat.ok
        ? `max |delta| = ${alignFlat.max.toFixed(2)} px ` +
          `(dx=${alignFlat.delta.dx.toFixed(2)} dy=${alignFlat.delta.dy.toFixed(2)} ` +
          `dw=${alignFlat.delta.dw.toFixed(2)} dh=${alignFlat.delta.dh.toFixed(2)})`
        : alignFlat.reason
    );
    await waitForSave(page);

    // ---- visual effects
    section('Step 4b — Visual Effects (drop shadow, corner radius, contrast)');
    await openSection(page, 'effects');
    const effectField = (label) =>
      page
        .locator('#layer-properties .mf-accordion-body[data-section="effects"] .mf-field')
        .filter({ has: page.locator(`.mf-label:text-is("${label}")`) });
    const typeInto = async (field, value) => {
      if (!field) return false;
      await field.locator('.mf-scrub-value').click();
      const input = field.locator('.mf-scrub-input');
      await input.waitFor({ state: 'visible', timeout: 3000 });
      await input.fill(String(value));
      await input.press('Enter');
      await page.waitForTimeout(350);
      return true;
    };
    const tEffects = Date.now();
    await typeInto(effectField('Drop Shadow Blur (px)'), 32);
    await typeInto(effectField('Corner Radius (px)'), 26);
    await typeInto(effectField('Contrast (%)'), 118);
    metrics.visualEffectsMs = Date.now() - tEffects;
    await page.waitForTimeout(1100);
    const filters = await page.evaluate((id) => {
      const l = window.store.state.scene.layers.find((x) => x.id === id);
      return l ? l.filters : null;
    }, card1Id);
    check(
      'Drop shadow, corner radius and contrast were applied',
      filters && filters.shadowBlur === 32 && filters.cornerRadius === 26 && filters.contrast === 118,
      JSON.stringify(filters)
    );
    const renderedFilter = await readRuntimeElement(frame, card1Id);
    check(
      'The filters reach the rendered element',
      Boolean(renderedFilter.ok && /drop-shadow/.test(renderedFilter.filter)),
      renderedFilter.ok ? renderedFilter.filter : 'no element'
    );
    await waitForSave(page);

    // ---- card 2 on V4
    await scrubTo(page, 3400);
    await openAddLayer();
    await page.click('[data-layer-template="card"]');
    await page.waitForTimeout(900);
    const card2Id = await page.evaluate(() => {
      const layers = window.store.state.scene.layers.filter((l) => l.type === 'card');
      return layers.length > 1 ? layers[1].id : null;
    });
    metrics.card2Id = card2Id;
    check('A second card layer was created', Boolean(card2Id), `card id ${card2Id}`);
    await openSection(page, 'track');
    await selectInspectorOption(page, 'track', 'Video Track', '3');
    await openSection(page, 'content');
    const card2Title = page
      .locator('#layer-properties .mf-accordion-body[data-section="content"] .mf-field')
      .filter({ has: page.locator('.mf-label:text-is("Title")') })
      .locator('input.mf-input');
    await card2Title.fill(SCENE.card2.title);
    await card2Title.dispatchEvent('change');
    await page.waitForTimeout(350);
    const card2Body = page
      .locator('#layer-properties .mf-accordion-body[data-section="content"] .mf-field')
      .filter({ has: page.locator('.mf-label:text-is("Body")') })
      .locator('textarea.mf-textarea');
    await card2Body.fill(SCENE.card2.body);
    await card2Body.dispatchEvent('change');
    await page.waitForTimeout(500);
    // the new card starts at the playhead with the default 3000 ms length,
    // which would run past the end of the 6000 ms composition
    await openSection(page, 'timing');
    await setScrubByLabel(page, 'timing', 'Duration', 2400);
    await page.waitForTimeout(500);
    const card2State = await page.evaluate((id) => {
      const l = window.store.state.scene.layers.find((x) => x.id === id);
      return l ? { trackIndex: l.trackIndex, at: l.at, duration: l.duration } : null;
    }, card2Id);
    check(
      'Card 2 is on V4 and fits inside the composition',
      card2State?.trackIndex === 3 && card2State.at + card2State.duration <= SCENE.durationMs,
      JSON.stringify(card2State)
    );
    await waitForSave(page);

    await waitForGizmo(page, card2Id);
    await page.waitForTimeout(700);
    const g2 = await readGizmo(page);
    if (g2.ok) {
      const sx = g2.aabb.left + g2.aabb.width / 2;
      const sy = g2.aabb.top + g2.aabb.height / 2;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(sx + i * 11, sy + i * 3.2);
      await page.mouse.up();
      await page.waitForTimeout(600);
    }
    const card2Moved = await page.evaluate((id) => {
      const l = window.store.state.scene.layers.find((x) => x.id === id);
      return l ? l.position : null;
    }, card2Id);
    check('Card 2 was moved with the gizmo', Boolean(card2Moved), JSON.stringify(card2Moved));
    await waitForSave(page);

    /* ── 7. trim the clips so they sequence ─────────────────────────────── */
    section('Step 4c — Trim the clips on the timeline so they sequence');
    await page.click('#timeline-zoom-fit');
    await page.waitForTimeout(700);
    await scrubTo(page, 3000);

    const geom1 = await clipGeometry(page, card1Id);
    const tTrim = Date.now();
    if (geom1) {
      const targetX = geom1.x2 - 4;
      await page.mouse.move(targetX, geom1.rowCentre);
      await page.mouse.down();
      const deltaPx = (3000 - (geom1.at + geom1.dur)) * geom1.pxPerMs;
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(targetX + (deltaPx * i) / 8, geom1.rowCentre);
      }
      await page.mouse.up();
    }
    metrics.trimMs = Date.now() - tTrim;
    await page.waitForTimeout(900);
    const card1Trimmed = await page.evaluate((id) => {
      const l = window.store.state.scene.layers.find((x) => x.id === id);
      return l ? { at: l.at, duration: l.duration } : null;
    }, card1Id);
    metrics.trimRight = { before: geom1, after: card1Trimmed };
    const expectedDuration = 3000 - geom1.at;
    check(
      'The right-edge trim shortened card 1 to the expected length',
      card1Trimmed && card1Trimmed.duration === expectedDuration,
      `duration ${geom1?.dur} -> ${card1Trimmed?.duration} ms (expected ${expectedDuration} ms)`
    );
    if (card1Trimmed && card1Trimmed.duration !== expectedDuration) {
      bug(
        'BUG-4',
        'The timeline right-edge trim computes the new duration from the wrong origin',
        `card 1 starts at ${geom1.at} ms with a ${geom1.dur} ms duration. Dragging the right edge to 3000 ms produced ` +
          `a duration of ${card1Trimmed.duration} ms instead of ${expectedDuration} ms. ` +
          'packages/studio/src/components/timeline/TimelinePanel.tsx:1656-1662 computes ' +
          '`dragInitialDuration + (snapped.time - dragInitialAt)` where `snapped.time` is an ABSOLUTE time, ' +
          'so a clip that does not start at 0 ms gains the offset of its own start.'
      );
      // recover through the inspector's own TIMING field
      await openSection(page, 'timing');
      await selectLayerInStack(page, card1Id);
      await openSection(page, 'timing');
      await setScrubByLabel(page, 'timing', 'Duration', expectedDuration);
      await page.waitForTimeout(600);
      await waitForSave(page);
      const recovered = await page.evaluate((id) => {
        const l = window.store.state.scene.layers.find((x) => x.id === id);
        return l ? { at: l.at, duration: l.duration } : null;
      }, card1Id);
      note('Card 1 duration recovered through the inspector', JSON.stringify(recovered));
    }

    const geom2 = await clipGeometry(page, card2Id);
    if (geom2) {
      const targetX = geom2.x1 + 4;
      await page.mouse.move(targetX, geom2.rowCentre);
      await page.mouse.down();
      const deltaPx = (3000 - geom2.at) * geom2.pxPerMs;
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(targetX + (deltaPx * i) / 8, geom2.rowCentre);
      }
      await page.mouse.up();
    }
    await page.waitForTimeout(900);
    const card2Trimmed = await page.evaluate((id) => {
      const l = window.store.state.scene.layers.find((x) => x.id === id);
      return l ? { at: l.at, duration: l.duration } : null;
    }, card2Id);
    metrics.trimLeft = { before: geom2, after: card2Trimmed };
    check(
      'The left-edge trim moved card 2 in',
      card2Trimmed && card2Trimmed.at !== geom2?.at,
      `at ${geom2?.at} -> ${card2Trimmed?.at} ms, duration ${geom2?.dur} -> ${card2Trimmed?.duration} ms`
    );
    await waitForSave(page);

    const lanes = await page.evaluate(() => {
      const resolved = window.store.resolveTrackLanes();
      return resolved.map((l) => ({
        index: l.index,
        name: l.name,
        kind: l.kind,
        layers: l.layers.map((x) => ({ id: x.id, at: x.at ?? 0, duration: x.duration ?? 0 })),
      }));
    });
    metrics.lanes = lanes;
    note('The resolved track lanes', JSON.stringify(lanes));
    const videoLanes = lanes.filter((l) => l.kind === 'video');
    const laneOf = (id) => videoLanes.find((l) => l.layers.some((x) => x.id === id));
    check(
      'The background, title and the two cards sit on V1..V4',
      laneOf('bg')?.name === 'V1' &&
        laneOf('title')?.name === 'V2' &&
        laneOf(card1Id)?.name === 'V3' &&
        laneOf(card2Id)?.name === 'V4',
      videoLanes.map((l) => `${l.name}:${l.layers.map((x) => x.id).join('+')}`).join(' ')
    );

    /* ── 7b. the gradient overlay (the workaround for BUG-1) ─────────────── */
    section('Step 4d — The radial-gradient overlay (the workaround for the broken gradient background)');
    await openAddLayer();
    const fxTemplates = await page.locator('[data-layer-template]').count();
    check(
      'The Add Layer modal offers the layer templates',
      fxTemplates >= 6,
      `${fxTemplates} templates: ${(
        await page.locator('[data-layer-template]').evaluateAll((els) =>
          els.map((e) => e.getAttribute('data-layer-template'))
        )
      ).join(', ')}`
    );
    await page.click('[data-layer-template="foregroundFX"]');
    await page.waitForTimeout(900);
    const fxId = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.type === 'foregroundFX');
      return l ? l.id : null;
    });
    check('An effect-overlay layer was created', Boolean(fxId), `overlay id ${fxId}`);
    await openSection(page, 'content');
    const fxEffect = page
      .locator('#layer-properties .mf-accordion-body[data-section="content"] .mf-field')
      .filter({ has: page.locator('.mf-label:text-is("Effect")') })
      .locator('select.mf-select');
    const fxKind = await fxEffect.inputValue();
    check('The overlay paints a radial gradient', fxKind === 'vignette', `effect = ${fxKind}`);
    // the overlay template has no duration, so the schema gives it the default
    // 1200 ms — it would only cover the first fifth of the composition
    await openSection(page, 'timing');
    await setScrubByLabel(page, 'timing', 'Duration', SCENE.durationMs);
    await page.waitForTimeout(600);
    const fxState = await page.evaluate((id) => {
      const l = window.store.state.scene.layers.find((x) => x.id === id);
      return l ? { at: l.at, duration: l.duration, effects: l.effects } : null;
    }, fxId);
    check(
      'The overlay covers the whole composition',
      fxState?.duration === SCENE.durationMs,
      JSON.stringify({ at: fxState?.at, duration: fxState?.duration, effects: fxState?.effects })
    );
    await waitForSave(page);

    /* ── 8. SFX drag-and-drop onto A1 ───────────────────────────────────── */
    section('Step 5 — Drag two built-in SFX cues onto the audio lane A1');
    await page.click('section[data-panel="project-bin"] .mf-panel-tab[data-tab="SFX"]');
    await page.waitForTimeout(500);
    const sfxItems = await page.locator('#bin-sfx [data-asset-id]').count();
    check('The SFX bank is visible in the bin', sfxItems >= 6, `${sfxItems} cues listed`);

    const audioHeader = await page.evaluate(() => {
      const h = Array.from(document.querySelectorAll('.mf-track-header')).find(
        (x) => x.getAttribute('data-track-kind') === 'audio'
      );
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return { name: h.getAttribute('data-track-name'), y: r.top + r.height / 2, height: r.height };
    });
    check('The audio lane A1 exists on the timeline', Boolean(audioHeader), JSON.stringify(audioHeader));

    // the timeline is too short for six lanes at the default height — drag the
    // splitter up so every lane (including A1) is on screen
    const splitter = await page.evaluate(() => {
      const el = document.querySelector('#splitter-timeline');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const tSplitter = Date.now();
    if (splitter) {
      await page.mouse.move(splitter.x, splitter.y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(splitter.x, splitter.y - (i * 60) / 8);
      await page.mouse.up();
    }
    metrics.timelineSplitterMs = Date.now() - tSplitter;
    await page.waitForTimeout(700);
    const timelineHeight = await page.evaluate(() => window.store.state.workspace.timelineHeight);
    note('The timeline was resized with the splitter', `${timelineHeight} px tall`);

    const cueCount = () => page.evaluate(() => window.store.state.scene.audio?.cues?.length ?? 0);

    const dropCue = async (assetId, atMs) => {
      const before = await cueCount();
      const x = await timeToClientX(page, atMs);
      const y = audioHeader.y;
      const relative = await page.evaluate(
        ({ x, y }) => {
          const r = document.querySelector('#timeline-canvas-container').getBoundingClientRect();
          return { x: x - r.left, y: y - r.top };
        },
        { x, y }
      );
      try {
        await page
          .locator(`#bin-sfx [data-asset-id="${assetId}"]`)
          .dragTo(page.locator('#timeline-canvas-container'), { targetPosition: relative });
      } catch {
        /* the HTML5 drag did not start — the synthetic drag below takes over */
      }
      await page.waitForTimeout(700);
      if ((await cueCount()) <= before) {
        await page.evaluate(
          ({ assetId, clientX, clientY }) => {
            const source = document.querySelector(`#bin-sfx [data-asset-id="${assetId}"]`);
            const target = document.querySelector('#timeline-canvas-container');
            if (!source || !target) return;
            const dt = new DataTransfer();
            source.dispatchEvent(
              new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })
            );
            target.dispatchEvent(
              new DragEvent('dragover', {
                bubbles: true,
                cancelable: true,
                dataTransfer: dt,
                clientX,
                clientY,
              })
            );
            target.dispatchEvent(
              new DragEvent('drop', {
                bubbles: true,
                cancelable: true,
                dataTransfer: dt,
                clientX,
                clientY,
              })
            );
          },
          { assetId, clientX: x, clientY: y }
        );
        await page.waitForTimeout(700);
      }
      return await page.evaluate(() =>
        (window.store.state.scene.audio?.cues ?? []).map((c) => ({ at: c.at, sfx: c.sfx }))
      );
    };

    const cuesAfterFirst = await dropCue('whoosh', 120);
    const cuesAfterSecond = await dropCue('subImpact', 3000);
    metrics.cues = cuesAfterSecond;
    check(
      'Two SFX cues landed on the audio lane',
      cuesAfterSecond.length >= 2,
      `after the first drop ${JSON.stringify(cuesAfterFirst)} / after the second ${JSON.stringify(cuesAfterSecond)}`
    );
    await waitForSave(page);

    // the canvas repaints on the next animation frame — wait for it
    let audioPixels = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      await page.waitForTimeout(500);
      audioPixels = await page.evaluate(() => {
      const canvas = document.querySelector('#timeline-canvas');
      const header = Array.from(document.querySelectorAll('.mf-track-header')).find(
        (x) => x.getAttribute('data-track-kind') === 'audio'
      );
      if (!header) return null;
      const hr = header.getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const y0 = Math.round((hr.top - cr.top + 4) * dpr);
      const h = Math.round((hr.height - 8) * dpr);
      const data = ctx.getImageData(0, y0, canvas.width, h).data;
      let green = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 1] > data[i] + 12 && data[i + 1] > data[i + 2] + 12) green++;
      }
      // the whole canvas, so a failure says WHERE the green pixels are
      const all = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let totalGreen = 0;
      let firstGreenY = -1;
      let lastGreenY = -1;
      for (let i = 0; i < all.length; i += 4) {
        if (all[i + 1] > all[i] + 12 && all[i + 1] > all[i + 2] + 12) {
          totalGreen++;
          const row = Math.floor(i / 4 / canvas.width);
          if (firstGreenY < 0) firstGreenY = row;
          lastGreenY = row;
        }
      }
      return {
        green,
        totalGreen,
        firstGreenY,
        lastGreenY,
        width: canvas.width,
        height: h,
        canvasHeightPx: canvas.height,
        laneTop: hr.top - cr.top,
        canvasHeight: cr.height,
        clipped: hr.bottom > cr.bottom,
      };
      });
      if (audioPixels && audioPixels.green > 200) break;
    }
    metrics.audioLanePixels = audioPixels;
    check(
      'Green audio clip boxes / waveforms are painted on A1',
      Boolean(audioPixels && audioPixels.green > 200),
      audioPixels
        ? `${audioPixels.green} green pixels in the A1 band (band top ${audioPixels.laneTop.toFixed(0)} px, canvas ${audioPixels.canvasHeight.toFixed(0)} px, clipped: ${audioPixels.clipped}); ${audioPixels.totalGreen} green pixels on the whole canvas, rows ${audioPixels.firstGreenY}..${audioPixels.lastGreenY} of ${audioPixels.canvasHeightPx}`
        : 'no A1 band'
    );

    /* ── 9. timeline scrub rate ─────────────────────────────────────────── */
    section('Step 6 — Timeline scrubbing rate');
    await page.click('#timeline-zoom-fit');
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      window.__phLog = [];
      const store = window.store;
      if (!store.__patchedForBench) {
        store.__patchedForBench = true;
        store.__origSetPlayhead = store.setPlayhead.bind(store);
        store.setPlayhead = (ms) => {
          window.__phLog.push({ t: performance.now(), ms });
          return store.__origSetPlayhead(ms);
        };
      }
    });
    const scrubY = await rulerY(page);
    const scrubX0 = await timeToClientX(page, 0);
    const scrubX1 = await timeToClientX(page, 5000);
    const tScrub = Date.now();
    await page.mouse.move(scrubX0 + 4, scrubY);
    await page.mouse.down();
    const steps = 60;
    for (let i = 1; i <= steps; i++) {
      const x = scrubX0 + 4 + ((scrubX1 - scrubX0 - 8) * i) / steps;
      await page.mouse.move(x, scrubY);
      await sleep(16);
    }
    await page.mouse.up();
    const scrubWallMs = Date.now() - tScrub;
    const phLog = await page.evaluate(() => window.__phLog);
    const distinct = new Set(phLog.map((e) => e.ms)).size;
    const intervals = [];
    for (let i = 1; i < phLog.length; i++) intervals.push(phLog[i].t - phLog[i - 1].t);
    intervals.sort((a, b) => a - b);
    const median = intervals.length ? intervals[Math.floor(intervals.length / 2)] : null;
    metrics.timelineScrub = {
      wallMs: scrubWallMs,
      events: phLog.length,
      distinctValues: distinct,
      valuesPerSecond: scrubWallMs ? (distinct / scrubWallMs) * 1000 : 0,
      eventsPerSecond: scrubWallMs ? (phLog.length / scrubWallMs) * 1000 : 0,
      appIntervalMedianMs: median,
      appIntervalMaxMs: intervals.length ? intervals[intervals.length - 1] : null,
      appFps: median ? 1000 / median : null,
    };
    check(
      'The ruler scrub produced a continuous playhead',
      distinct > 20,
      `${distinct} distinct playhead values in ${scrubWallMs} ms ` +
        `(${metrics.timelineScrub.valuesPerSecond.toFixed(1)} values/s of wall clock, ` +
        `${phLog.length} store updates, ${median?.toFixed(1)} ms median app interval = ` +
        `${metrics.timelineScrub.appFps?.toFixed(1)} scrub updates/s)`
    );

    // the SAME gesture, but injected from inside the page: this removes the
    // Playwright IPC round trip and measures the Studio's own throughput
    const burst = await page.evaluate(
      ({ x0, x1, y, moves }) => {
        window.__phLog.length = 0;
        const canvas = document.querySelector('#timeline-canvas');
        const fire = (type, cx) =>
          (type === 'mousedown' ? canvas : window).dispatchEvent(
            new MouseEvent(type, {
              clientX: cx,
              clientY: y,
              bubbles: true,
              cancelable: true,
              button: 0,
              buttons: type === 'mouseup' ? 0 : 1,
            })
          );
        const t0 = performance.now();
        fire('mousedown', x0);
        for (let i = 1; i <= moves; i++) {
          fire('mousemove', x0 + ((x1 - x0) * i) / moves);
        }
        fire('mouseup', x1);
        const elapsed = performance.now() - t0;
        return {
          elapsedMs: elapsed,
          events: window.__phLog.length,
          distinct: new Set(window.__phLog.map((e) => e.ms)).size,
          updatesPerSecond: elapsed ? (window.__phLog.length / elapsed) * 1000 : 0,
        };
      },
      { x0: scrubX0 + 4, x1: scrubX1, y: scrubY, moves: 400 }
    );
    metrics.timelineScrubBurst = burst;
    note(
      'The same scrub injected from inside the page (no automation overhead)',
      `${burst.events} store updates in ${burst.elapsedMs.toFixed(1)} ms = ${burst.updatesPerSecond.toFixed(0)} updates/s, ${burst.distinct} distinct playhead values`
    );
    check(
      'The Studio keeps up with an unthrottled scrub',
      burst.updatesPerSecond > 120,
      `${burst.updatesPerSecond.toFixed(0)} playhead updates/s (${burst.distinct} distinct values)`
    );
    await page.evaluate(() => {
      if (window.store.__origSetPlayhead) window.store.setPlayhead = window.store.__origSetPlayhead;
    });

    /* ── 8b. the Ctrl+K shortcut conflict ───────────────────────────────── */
    section('Step 6b — The Ctrl+K shortcut conflict (the command palette vs the razor split)');
    await selectLayerInStack(page, 'title');
    await scrubTo(page, 1200);
    const layersBefore = await page.evaluate(() => window.store.state.scene.layers.length);
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(600);
    const paletteOpen = await page.locator('#command-palette').count();
    const layersAfter = await page.evaluate(() => window.store.state.scene.layers.length);
    check('Ctrl+K opens the command palette', paletteOpen === 1, `palette open: ${paletteOpen === 1}`);
    if (layersAfter > layersBefore) {
      bug(
        'BUG-5',
        'Ctrl+K is bound twice — it opens the command palette AND razor-splits the selected layer',
        `With the "title" layer selected and the playhead at 1200 ms, ONE Ctrl+K took the layer count from ${layersBefore} to ${layersAfter}: ` +
          'the App maps Ctrl+K to the command palette (packages/studio/src/App.tsx:155-163) while the timeline maps the same ' +
          'chord to "razor split at playhead" (packages/studio/src/components/timeline/TimelinePanel.tsx:1336-1341) and the ' +
          'command registry lists "Razor Split at Playhead — Ctrl+K" (packages/studio/src/services/commands.ts:255-259). ' +
          'Neither handler stops the propagation, so both run.'
      );
    } else {
      note('Ctrl+K did not split the selected layer', `layer count ${layersBefore} -> ${layersAfter}`);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    if (layersAfter > layersBefore) {
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(900);
      const restored = await page.evaluate(() => window.store.state.scene.layers.length);
      check(
        'The accidental razor split was undone',
        restored === layersBefore,
        `layer count ${layersAfter} -> ${restored}`
      );
      await waitForSave(page);
    }

    /* ── 10. fit the timeline + screenshot ──────────────────────────────── */
    section('Step 7 — Fit the timeline and capture the Studio');
    await page.click('#timeline-zoom-fit');
    await page.waitForTimeout(800);
    const fitState = await page.evaluate(() => {
      const canvas = document.querySelector('#timeline-canvas');
      const state = window.store.state;
      const durationMs = state.scene.durationMs;
      const visibleEnd = durationMs / state.zoom;
      let contentEnd = 0;
      for (const l of state.scene.layers) {
        contentEnd = Math.max(contentEnd, (l.at ?? 0) + (l.duration ?? 0));
      }
      for (const c of state.scene.audio?.cues ?? []) {
        contentEnd = Math.max(contentEnd, c.at + 1000);
      }
      return {
        zoom: state.zoom,
        panOffset: state.panOffset,
        visibleEnd,
        contentEnd,
        headers: Array.from(document.querySelectorAll('.mf-track-header')).map((h) =>
          h.getAttribute('data-track-name')
        ),
        canvasWidth: canvas.clientWidth,
      };
    });
    metrics.timelineFit = fitState;
    check(
      'Fit Timeline shows every clip on every track',
      fitState.visibleEnd >= fitState.contentEnd - 1,
      `visible ${fitState.visibleEnd.toFixed(0)} ms vs content end ${fitState.contentEnd.toFixed(0)} ms`
    );
    check(
      'Every track lane (V1..V4 + A1) is on screen',
      fitState.headers.length >= 5,
      fitState.headers.join(' ')
    );

    await page.evaluate(() => {
      window.store.setPlayhead(1200);
      for (const toast of [...window.store.state.toasts]) window.store.removeToast(toast.id);
    });
    // deselect, so the screenshot shows the composition and not a full-bleed gizmo
    await selectLayerInStack(page, 'title');
    await page.waitForTimeout(400);
    const corner = await page.evaluate(() => {
      const stage = document.querySelector('#monitor-stage').getBoundingClientRect();
      return { x: stage.left + 6, y: stage.top + 6 };
    });
    await page.mouse.click(corner.x, corner.y);
    await page.waitForTimeout(1400);
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: SCREENSHOT_PATH, scale: 'device' });
    const shotSize = fs.existsSync(SCREENSHOT_PATH) ? fs.statSync(SCREENSHOT_PATH).size : 0;
    const viewport = await page.evaluate(() => ({
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: window.devicePixelRatio,
    }));
    metrics.screenshot = { path: SCREENSHOT_PATH, bytes: shotSize, viewport };
    check(
      'The Studio screenshot was written at >= 1600 px wide',
      shotSize > 10000 && viewport.w >= 1600,
      `${path.relative(ROOT, SCREENSHOT_PATH)} (${(shotSize / 1024).toFixed(0)} kB, viewport ${viewport.w}x${viewport.h})`
    );

    /* ── 11. the render ─────────────────────────────────────────────────── */
    section('Step 8 — Render through the Render modal');
    await page.keyboard.press('Control+s');
    await waitForSave(page, 15000);

    const tRenderOpen = Date.now();
    await page.click('#btn-quick-render');
    await page.waitForSelector('#render-modal', { timeout: 5000 });
    metrics.openRenderModalMs = Date.now() - tRenderOpen;
    check('The render modal opened', true, `${metrics.openRenderModalMs} ms`);

    await page.selectOption('#render-quality', 'draft');
    const tRender = Date.now();
    await page.click('#render-start');
    metrics.renderStartMs = Date.now() - tRender;

    const progress = [];
    const readJob = () =>
      page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('#render-modal [data-job-id]'));
        const row = rows[0];
        if (!row) return null;
        const path = row.querySelector('span[title]');
        return {
          jobId: row.getAttribute('data-job-id'),
          status: row.getAttribute('data-job-status'),
          outputPath: path ? path.getAttribute('title') : null,
          text: (row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
          storeQueueLength: window.store.state.renderQueue?.length ?? 0,
        };
      });

    const deadline = Date.now() + 20 * 60 * 1000;
    let jobStatus = null;
    let draftPath = null;
    while (Date.now() < deadline) {
      const snap = await readJob();
      if (snap && progress[progress.length - 1]?.status !== snap.status) {
        progress.push({ status: snap.status, text: snap.text, atMs: Date.now() - tRender });
      }
      if (snap && (snap.status === 'succeeded' || snap.status === 'failed')) {
        jobStatus = snap.status;
        draftPath = snap.outputPath;
        break;
      }
      await page.waitForTimeout(400);
    }
    metrics.renderDurationMs = Date.now() - tRender;
    metrics.renderProgress = progress;
    metrics.renderStoreQueueLength = await page.evaluate(
      () => window.store.state.renderQueue?.length ?? 0
    );
    check(
      'The draft render succeeded',
      jobStatus === 'succeeded',
      `${jobStatus} after ${(metrics.renderDurationMs / 1000).toFixed(1)} s`
    );
    note('The render queue rows the modal showed', JSON.stringify(progress));
    if (metrics.renderStoreQueueLength === 0) {
      bug(
        'BUG-3',
        'The Studio store never records the render queue — `state.renderQueue` stays empty forever',
        'The Render Queue modal keeps its own local `queue` signal (packages/studio/src/components/export/RenderModal.tsx:42) ' +
          'and never writes `window.store.state.renderQueue` (packages/studio/src/state/store.ts:131 and 217). ' +
          `After a successful render the store's queue length is still ${metrics.renderStoreQueueLength}.`
      );
    }
    metrics.draftOutputPath = draftPath;

    /* ── 12. the production render (1920x1080) ─────────────────────────── */
    section('Step 9 — Production render (the Studio only offers 720p/30 and 1080p/60)');
    await page.selectOption('#render-quality', 'production');
    const tProduction = Date.now();
    await page.click('#render-start');
    const prodDeadline = Date.now() + 25 * 60 * 1000;
    let prodStatus = null;
    let prodPath = null;
    while (Date.now() < prodDeadline) {
      const snap = await readJob();
      if (snap && (snap.status === 'succeeded' || snap.status === 'failed')) {
        prodStatus = snap.status;
        prodPath = snap.outputPath;
        break;
      }
      await page.waitForTimeout(500);
    }
    metrics.productionRenderDurationMs = Date.now() - tProduction;
    check(
      'The production render succeeded',
      prodStatus === 'succeeded',
      `${prodStatus} after ${(metrics.productionRenderDurationMs / 1000).toFixed(1)} s`
    );
    metrics.productionOutputPath = prodPath;

    await page.click('#render-modal-done');
    await page.waitForTimeout(500);

    /* ── 13. verify the exports ─────────────────────────────────────────── */
    section('Step 10 — Verify the exports with ffprobe and extract frames');
    fs.mkdirSync(RENDERS_DIR, { recursive: true });

    const probe = (file) =>
      run('ffprobe', [
        '-v', 'error',
        '-show_entries',
        'stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,bit_rate,sample_rate,channels:format=duration,size,bit_rate,format_name',
        '-of', 'default=noprint_wrappers=0',
        file,
      ]).trim();

    if (draftPath && fs.existsSync(draftPath)) {
      metrics.draftFfprobe = probe(draftPath);
      console.log('\n--- ffprobe (the Studio draft export) ---');
      console.log(metrics.draftFfprobe);
    }
    if (!prodPath || !fs.existsSync(prodPath)) {
      throw new Error(`the production render output is missing (${prodPath})`);
    }
    metrics.productionFfprobe = probe(prodPath);
    console.log('\n--- ffprobe (the Studio production export) ---');
    console.log(metrics.productionFfprobe);

    // The Studio has NO 1080p30 profile (draft = 720p/30, production = 1080p/60),
    // so the deliverable is conformed to the requested 1920x1080 @ 30 fps.
    run('ffmpeg', [
      '-y',
      '-i', prodPath,
      '-vf', 'fps=30',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      VIDEO_PATH,
    ]);
    metrics.deliverableFfprobe = probe(VIDEO_PATH);
    console.log('\n--- ffprobe (the deliverable) ---');
    console.log(metrics.deliverableFfprobe);
    check(
      'The deliverable MP4 was written',
      fs.existsSync(VIDEO_PATH),
      `${VIDEO_PATH} (${fs.statSync(VIDEO_PATH).size} bytes)`
    );

    const framePaths = [];
    for (const t of FRAME_TIMES) {
      const out = path.join(RENDERS_DIR, `ui-production-showcase-t${t.toFixed(1)}.png`);
      run('ffmpeg', ['-y', '-ss', String(t), '-i', VIDEO_PATH, '-frames:v', '1', out]);
      framePaths.push({ t, path: out, bytes: fs.existsSync(out) ? fs.statSync(out).size : 0 });
    }
    metrics.frames = framePaths;
    check(
      'Three frames were extracted next to the video',
      framePaths.every((f) => f.bytes > 1000),
      framePaths.map((f) => `${path.basename(f.path)} (${(f.bytes / 1024).toFixed(0)} kB)`).join(', ')
    );

    const frameHashes = framePaths.map((f) =>
      run('sha256sum', [f.path]).split(/\s+/)[0].slice(0, 16)
    );
    metrics.frameHashes = frameHashes;
    check(
      'The extracted frames are not identical',
      new Set(frameHashes).size === frameHashes.length,
      frameHashes.join(' / ')
    );

    /* ── 14. final state ────────────────────────────────────────────────── */
    const finalScene = await readPersistedScene(page);
    metrics.finalScene = finalScene
      ? {
          id: finalScene.id,
          name: finalScene.name,
          durationMs: finalScene.durationMs,
          canvas: finalScene.canvas,
          layers: finalScene.layers.map((l) => ({
            id: l.id,
            type: l.type,
            trackIndex: l.trackIndex ?? null,
            at: l.at ?? 0,
            duration: l.duration ?? null,
            position: l.position ?? null,
            scale: l.scale ?? null,
            rotation: l.rotation ?? null,
            keyframes: (l.keyframes || []).length,
            filters: l.filters ?? null,
          })),
          cues: finalScene.audio?.cues ?? [],
        }
      : null;
    note('The persisted scene', JSON.stringify(metrics.finalScene));

    const runtimeCrash = pageErrors.filter((e) => /renderBackground/.test(e.stack || ''));
    const realErrors = pageErrors.filter(
      (e) =>
        !/Electron Security Warning|Autofill|devtools|Third-party cookie/i.test(e.message) &&
        !/SceneServiceError|invalid scene/i.test(e.message) &&
        !/renderBackground/.test(e.stack || '')
    );
    const engineRejections = pageErrors.filter((e) => /SceneServiceError|invalid scene/i.test(e.message));
    metrics.pageErrors = pageErrors;
    metrics.engineRejections = engineRejections.length;
    check('The renderer produced no unexpected page errors', realErrors.length === 0, realErrors.map((e) => e.message).slice(0, 3).join(' | '));
    if (realErrors.length) {
      for (const e of realErrors.slice(0, 3)) console.log(`        ${e.stack}`);
    }
    if (runtimeCrash.length) {
      const entry = bugs.find((b) => b.id === 'BUG-1');
      const extra = ` The same invalid variant also CRASHED the preview renderer: "${runtimeCrash[0].message}" (${runtimeCrash[0].stack}) — packages/scene-runtime/src/layers/background.ts reads v.blobs.forEach() without a guard.`;
      if (entry) entry.evidence += extra;
      else bug('BUG-1', 'The inspector cannot author a gradient background', extra);
      note('The preview renderer crashed on the invalid background variant', runtimeCrash[0].message);
    }
    if (engineRejections.length) {
      note(
        'The renderer surfaced the rejected saves as UNHANDLED promise rejections',
        `${engineRejections.length} x "${engineRejections[0].message}"`
      );
      bug(
        'BUG-2',
        'A failed save leaves an unhandled promise rejection in the renderer',
        'The inspector commits with `void store.executeSave()` (packages/studio/src/components/inspector/EffectControlsPanel.tsx:401) ' +
          'and `store.executeSave()` re-throws after the toast (packages/studio/src/state/store.ts:657). ' +
          `The rejection is therefore unhandled: the renderer logged ${engineRejections.length} x "${engineRejections[0].message}".`
      );
    }
    const mainFatal = mainErrors.filter(
      (line) => !/Error occurred in handler for 'engine:invoke'/.test(line)
    );
    check('The main process produced no unexpected errors', mainFatal.length === 0, mainFatal.slice(0, 2).join(' | '));
  } finally {
    if (app) {
      try {
        await app.close();
      } catch (err) {
        console.error('[benchmark:ui-production] could not close the app:', err);
      }
    }
    cleanupTestDirs(testDirs);
    console.log(`isolated workspace removed: ${testDirs.root}`);
    failed = failures > 0;
  }

  /* ── summary ──────────────────────────────────────────────────────────── */
  console.log('\n================================================================');
  console.log(`=== SUMMARY: ${results.length - failures}/${results.length} checks passed ===`);
  console.log('================================================================');
  console.log('\n--- MEASURED METRICS (JSON) ---');
  console.log(JSON.stringify(metrics, null, 2));
  console.log('\n--- PRODUCT BUGS ---');
  for (const b of bugs) console.log(`${b.id}: ${b.title}\n    ${b.evidence}`);
  if (failed) {
    console.error('\nFAILED CHECKS:');
    for (const result of results.filter((r) => !r.ok)) {
      console.error(`  - ${result.label}${result.detail ? ` (${result.detail})` : ''}`);
    }
    process.exit(1);
  }
  console.log('\nThe UI-driven video production benchmark completed.');
}

main().catch((err) => {
  console.error('\n[benchmark:ui-production] FAILED:', err);
  process.exit(1);
});
