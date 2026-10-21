#!/usr/bin/env node
/**
 * MotionForge v4 — Full-Stack UX & Gizmo Overhaul verification.
 *
 * Launches the REAL Electron application and asserts, against the LIVE DOM,
 * the STORE and the LIVE `mf-runtime://` preview:
 *
 *   1. the Program Monitor AUTO-FITS its composition (and re-fits on resize),
 *   2. the selection gizmo is 1:1 with the rendered element (rotated too),
 *   3. drag / corner-scale / rotate manipulate the LIVE preview,
 *   4. the multi-track timeline separates, scrubs, moves, trims and zooms,
 *   5. keyframes interpolate IN THE RUNTIME and the visual filters apply,
 *   6. the design system is rounded (8px panels, 6px controls),
 *   7. the regression sweep: zero emoji, no schema errors, no page errors.
 *
 * A high-resolution screenshot of the verified UI is written to
 * `screenshots/pro-nle-v4-polished.png`.
 *
 * ISOLATION
 * ---------
 * The run NEVER touches the developer's `~/.motionforge`: the engine is
 * pointed at a throw-away tree under `os.tmpdir()` through the environment
 * variables `packages/core-engine/src/config.ts` reads. Every scene this
 * harness creates carries the `ux-` prefix, so any residue is identifiable.
 *
 * Usage:
 *   xvfb-run -a --server-args="-screen 0 1920x1200x24" \
 *     node scripts/test-full-ux-and-gizmo.cjs
 */
const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const { makeTestEnv, makeTestDirs, cleanupTestDirs, describeTestDirs } = require('./lib/test-env.cjs');

const ROOT = path.resolve(__dirname, '..');
const SCREENSHOT_DIR = path.join(ROOT, 'screenshots');
const SCREENSHOT_PATH = path.join(SCREENSHOT_DIR, 'pro-nle-v4-polished.png');

/** A unique scene id — the run never depends on a leftover. */
const SCENE_ID = `ux-verification-${Date.now().toString(36)}`;
/** The deterministic window size — the measurements must be reproducible. */
const WINDOW = { width: 1920, height: 1200 };

const results = [];
let failures = 0;

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  results.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

/** Scan a string for codepoints in the emoji ranges. */
function findEmoji(text) {
  const ranges = [
    [0x1f000, 0x1faff],
    [0x2600, 0x26ff],
    [0x2700, 0x27bf],
    [0x2b00, 0x2bff],
    [0x1f1e6, 0x1f1ff],
  ];
  const single = new Set([0xfe0f, 0x200d, 0x20e3]);
  const found = [];
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (single.has(cp) || ranges.some(([lo, hi]) => cp >= lo && cp <= hi)) {
      found.push({ char, codePoint: `U+${cp.toString(16).toUpperCase()}` });
    }
  }
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The `mf-runtime://` preview frame, once it has a mounted stage. */
async function findRuntimeFrame(page, timeoutMs = 25000) {
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
    const cs = getComputedStyle(el);
    return {
      ok: true,
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      styleLeft: el.style.left,
      styleTop: el.style.top,
      styleFilter: el.style.filter,
      transform: cs.transform,
      filter: cs.filter,
      offsetWidth: el.offsetWidth,
      offsetHeight: el.offsetHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
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
 * taken. `getBoundingClientRect()` of the rect is read as a cross-check.
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
    // The rect's x/y are in the GIZMO's LOCAL frame (centred on 0,0), so the
    // rotation happens about the local origin and the translation is applied
    // once, afterwards — the same order the SVG uses.
    const corners = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ].map(([px, py]) => ({
      x: cx + px * cos - py * sin,
      y: cy + px * sin + py * cos,
    }));
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
      viewport: {
        left: vpRect.left,
        top: vpRect.top,
        width: vpRect.width,
        height: vpRect.height,
      },
    };
  });
}

/** Wait until the gizmo for `layerId` is in the DOM (and report why not). */
async function waitForGizmo(page, layerId, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await readGizmo(page);
    if (last.ok && last.layerId === layerId) return last;
    await page.waitForTimeout(150);
  }
  return last;
}

/** Wait until the runtime reports bounds that satisfy `predicate`. */
async function waitForBounds(page, layerId, predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(
      (id) => window.store.state.layerBounds[id] || null,
      layerId
    );
    if (last && predicate(last)) return last;
    await page.waitForTimeout(150);
  }
  return last;
}

/** The monitor's fit geometry — the stage, the viewport and the scale. */
async function readMonitorFit(page) {
  return await page.evaluate(() => {
    const vp = document.querySelector('#monitor-viewport');
    const stage = document.querySelector('#monitor-stage');
    if (!vp || !stage) return { ok: false, reason: 'the monitor is not mounted' };
    const v = vp.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    const scale = Number(stage.getAttribute('data-scale') || '0');
    const compW = 1920;
    const compH = 1080;
    return {
      ok: true,
      viewport: { left: v.left, top: v.top, width: v.width, height: v.height },
      stage: { left: s.left, top: s.top, width: s.width, height: s.height },
      dataScale: scale,
      dataZoom: stage.getAttribute('data-zoom'),
      measuredScale: s.width / compW,
      fillWidth: s.width / v.width,
      fillHeight: s.height / v.height,
      aspect: s.width / s.height,
      compAspect: compW / compH,
      viewportZoom: window.store.state.viewportZoom,
    };
  });
}

async function main() {
  console.log('================================================================');
  console.log('=== MOTIONFORGE v4 — FULL-STACK UX & GIZMO VERIFICATION ===');
  console.log('================================================================');
  console.log(`scene id: ${SCENE_ID}`);

  /* ── the isolated workspace ─────────────────────────────────────────── */
  //
  // The engine is pointed at a throw-away tree BEFORE Electron is launched,
  // so the run can never write a test scene into `~/.motionforge`.
  const testDirs = makeTestDirs('ux-gizmo');
  const testEnv = makeTestEnv(testDirs);
  console.log(`isolated workspace: ${describeTestDirs(testDirs)}`);

  let app = null;
  let failed = false;
  try {
    /* ── 1. launch ──────────────────────────────────────────────────────── */
    section('1. Launch the real Electron application');
    const mainPath = path.join(ROOT, 'packages', 'desktop', 'out', 'main', 'index.js');
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Desktop bundle missing at ${mainPath}. Run: npm run build -w @motionforge/desktop`);
    }

    app = await electron.launch({
      args: ['--no-sandbox', mainPath],
      env: testEnv,
    });

    const mainLogs = [];
    const mainErrors = [];
    app.process().stdout?.on('data', (data) => {
      const text = data.toString().trim();
      if (text) mainLogs.push(text);
    });
    app.process().stderr?.on('data', (data) => {
      const text = data.toString().trim();
      // The GPU / graphics-stack messages are headless-X artifacts (no GLX
      // driver on the virtual display), not application errors.
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
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    /* a deterministic window size — every measurement below depends on it */
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

    await page.waitForTimeout(2500);

    const runtimeStatus = await page.evaluate(async () => {
      try {
        const response = await fetch('mf-runtime://app/index.html');
        return { ok: response.ok, status: response.status };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    });
    check(
      'mf-runtime://app/index.html serves the runtime bundle',
      runtimeStatus.ok === true,
      runtimeStatus.error ? `error: ${runtimeStatus.error}` : `status ${runtimeStatus.status}`
    );

    /* ── 2. the scene under test ────────────────────────────────────────── */
    section('2. The scene under test');
    const created = await page.evaluate(async (id) => {
      const scene = {
        schemaVersion: 1,
        id,
        name: `UX Verification ${id.slice(-6)}`,
        canvas: { shape: '16:9', scale: 1080 },
        durationMs: 8000,
        assets: [],
        fonts: [],
        layers: [
          {
            id: 'bg',
            name: 'bg',
            type: 'background',
            variant: { variant: 'solid', color: '#0b1020' },
            at: 0,
            duration: 8000,
            trackIndex: 0,
          },
          {
            id: 'title',
            name: 'title',
            type: 'kineticText',
            at: 0,
            duration: 4000,
            text: 'Verification Title',
            sizePx: 90,
            position: { xPct: 50, yPct: 45 },
            fill: '#ffffff',
            align: 'center',
            scale: 1,
            rotation: 0,
            trackIndex: 1,
          },
          {
            id: 'title-2',
            name: 'title (2)',
            type: 'kineticText',
            at: 1500,
            duration: 3000,
            text: 'Second Clip',
            sizePx: 60,
            position: { xPct: 28, yPct: 72 },
            fill: '#8cc2ff',
            align: 'center',
            scale: 1,
            rotation: 0,
            trackIndex: 2,
          },
        ],
        camera: { keyframes: [{ at: 0, scale: 1, xPct: 50, yPct: 50 }] },
      };
      const res = await window.motionforgeEngine.invoke('saveScene', scene);
      const loaded = await window.motionforgeEngine.invoke('getScene', id);
      window.store.setScene(loaded, id);
      return { res, layerCount: loaded.layers.length };
    }, SCENE_ID);
    check(
      'The verification scene saves through the engine',
      created && created.res && created.res.id === SCENE_ID,
      created && created.res ? `revision ${created.res.revision}, ${created.layerCount} layers` : 'no result'
    );

    await page.waitForTimeout(1500);
    const frame = await findRuntimeFrame(page);
    check('The mf-runtime:// preview frame is mounted', Boolean(frame), frame ? frame.url() : 'no frame');
    if (!frame) {
      throw new Error('the runtime preview never mounted — the rest of the suite cannot run');
    }

    const selected = await page.evaluate(() => {
      window.store.selectLayer('title');
      window.store.setActiveTool('select');
      window.store.setPlayhead(0);
      return {
        selected: window.store.state.selectedLayerId,
        sceneId: window.store.state.sceneId,
        tool: window.store.state.activeTool,
      };
    });
    check(
      'The "title" kineticText layer is selected',
      selected.selected === 'title',
      `selected=${selected.selected}, scene=${selected.sceneId}`
    );
    await page.waitForTimeout(600);

    /* ── 3. auto-fit viewport ───────────────────────────────────────────── */
    section('3. Program Monitor auto-fit');
    await page.selectOption('#monitor-zoom', 'fit');
    await page.waitForTimeout(700);

    const fit = await readMonitorFit(page);
    check(
      'The monitor zoom selector is on "Fit"',
      fit.dataZoom === 'fit',
      `data-zoom=${fit.dataZoom}, viewportZoom=${fit.viewportZoom}`
    );
    check(
      'The composition fills the panel (width >= 75%)',
      fit.fillWidth >= 0.75,
      `fill width ${(fit.fillWidth * 100).toFixed(1)}% (${fit.stage.width.toFixed(0)}x${fit.stage.height.toFixed(0)} in ${fit.viewport.width.toFixed(0)}x${fit.viewport.height.toFixed(0)})`
    );
    check(
      'The composition fills the panel (height >= 75%)',
      fit.fillHeight >= 0.75,
      `fill height ${(fit.fillHeight * 100).toFixed(1)}%`
    );
    check(
      'The composition keeps the 1920x1080 aspect ratio (within 2%)',
      Math.abs(fit.aspect - fit.compAspect) / fit.compAspect < 0.02,
      `aspect ${fit.aspect.toFixed(4)} vs ${fit.compAspect.toFixed(4)}`
    );
    check(
      'The stage reports the absolute scale in `data-scale`',
      Math.abs(fit.dataScale - fit.measuredScale) < 0.002,
      `data-scale=${fit.dataScale}, measured=${fit.measuredScale.toFixed(4)}`
    );
    // the auto-fit contract: the stage is the LARGEST 16:9 box inside the
    // panel minus the stage margin (STAGE_MARGIN in monitor/geometry.ts)
    const STAGE_MARGIN = 16;
    const idealFor = (w, h) => {
      const s = Math.min((w - STAGE_MARGIN) / 1920, (h - STAGE_MARGIN) / 1080);
      return { width: 1920 * s, height: 1080 * s, scale: s };
    };
    const ideal = idealFor(fit.viewport.width, fit.viewport.height);
    check(
      'The stage is the LARGEST 16:9 box inside the panel (16px margin)',
      Math.abs(fit.stage.width - ideal.width) < 1.5 && Math.abs(fit.stage.height - ideal.height) < 1.5,
      `stage ${fit.stage.width.toFixed(1)}x${fit.stage.height.toFixed(1)} vs ideal ${ideal.width.toFixed(1)}x${ideal.height.toFixed(1)}`
    );

    /* resize the panel — the stage must re-fit */
    const originalLeft = await page.evaluate(() => window.store.state.workspace.leftPanelWidth);
    await page.evaluate(() => {
      window.store.setLeftPanelWidth(430);
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(800);
    const refit = await readMonitorFit(page);
    const idealRefit = idealFor(refit.viewport.width, refit.viewport.height);
    check(
      'The stage re-fits after the panel is resized',
      Math.abs(refit.stage.width - idealRefit.width) < 1.5 &&
        Math.abs(refit.stage.height - idealRefit.height) < 1.5,
      `stage ${refit.stage.width.toFixed(1)}x${refit.stage.height.toFixed(1)} vs ideal ${idealRefit.width.toFixed(1)}x${idealRefit.height.toFixed(1)}`
    );
    check(
      'The re-fit keeps the panel filled on the LIMITING axis (>= 75%)',
      Math.max(refit.fillWidth, refit.fillHeight) >= 0.75,
      `fill width ${(refit.fillWidth * 100).toFixed(1)}%, fill height ${(refit.fillHeight * 100).toFixed(1)}% ` +
        `(the free axis cannot exceed 100% of a panel whose aspect is not 16:9)`
    );
    check(
      'The re-fit keeps the composition aspect ratio',
      Math.abs(refit.aspect - refit.compAspect) / refit.compAspect < 0.02,
      `aspect ${refit.aspect.toFixed(4)}`
    );
    console.log(
      `  INFO  the fit leaves a 16px margin, so on a panel that is wider than 16:9 the ` +
        `free axis fills only ${(Math.min(refit.fillWidth, refit.fillHeight) * 100).toFixed(1)}% ` +
        `(default layout: ${(Math.min(fit.fillWidth, fit.fillHeight) * 100).toFixed(1)}%)`
    );
    await page.evaluate((w) => {
      window.store.setLeftPanelWidth(w);
      window.dispatchEvent(new Event('resize'));
    }, originalLeft);
    await page.waitForTimeout(600);

    /* ── 4. 1:1 gizmo lockstep ──────────────────────────────────────────── */
    section('4. The gizmo is 1:1 with the rendered element');
    const lockstep = async (label) => {
      const gizmo = await readGizmo(page);
      const inner = await readRuntimeElement(frame, 'title');
      const iframe = await readIframeRect(page);
      if (!gizmo.ok || !inner.ok || !iframe) {
        check(label, false, `gizmo=${gizmo.ok} runtime=${inner.ok} iframe=${Boolean(iframe)}`);
        return null;
      }
      const runtimeRect = {
        left: iframe.left + inner.left,
        top: iframe.top + inner.top,
        width: inner.width,
        height: inner.height,
      };
      const dx = gizmo.aabb.left - runtimeRect.left;
      const dy = gizmo.aabb.top - runtimeRect.top;
      const dw = gizmo.aabb.width - runtimeRect.width;
      const dh = gizmo.aabb.height - runtimeRect.height;
      const corner = Math.max(
        Math.abs(gizmo.aabb.left - gizmo.aabbFromRect.left),
        Math.abs(gizmo.aabb.top - gizmo.aabbFromRect.top),
        Math.abs(gizmo.aabb.width - gizmo.aabbFromRect.width),
        Math.abs(gizmo.aabb.height - gizmo.aabbFromRect.height)
      );
      check(
        label,
        Math.abs(dx) < 2 && Math.abs(dy) < 2 && Math.abs(dw) < 2 && Math.abs(dh) < 2,
        `Δx=${dx.toFixed(2)} Δy=${dy.toFixed(2)} Δw=${dw.toFixed(2)} Δh=${dh.toFixed(2)} ` +
          `| gizmo ${gizmo.aabb.width.toFixed(1)}x${gizmo.aabb.height.toFixed(1)} @ ` +
          `${gizmo.aabb.left.toFixed(1)},${gizmo.aabb.top.toFixed(1)} | ` +
          `runtime ${runtimeRect.width.toFixed(1)}x${runtimeRect.height.toFixed(1)} @ ` +
          `${runtimeRect.left.toFixed(1)},${runtimeRect.top.toFixed(1)} | rot=${gizmo.rotation}`
      );
      check(
        `${label} — the computed corners agree with getBoundingClientRect()`,
        corner < 1,
        `corner mismatch ${corner.toFixed(3)}px`
      );
      return { gizmo, inner, runtimeRect, delta: { dx, dy, dw, dh } };
    };

    const lock0 = await lockstep('The gizmo matches the rendered text (rotation 0°)');
    if (lock0) {
      check(
        'The gizmo carries the layer id and the full handle set',
        lock0.gizmo.layerId === 'title' && Number(lock0.gizmo.handleCount) === 9,
        `data-layer-id=${lock0.gizmo.layerId}, data-handle-count=${lock0.gizmo.handleCount}`
      );
    }

    /* rotate the layer by 15° and re-measure — the ROTATED path is the hard one */
    await page.evaluate(() => {
      window.store.updateLayer('title', { rotation: 15 }, 'verification: rotate');
    });
    await page.waitForTimeout(1800);
    const rotated = await page.evaluate(() => {
      const b = window.store.state.layerBounds['title'];
      return b ? { rotation: b.rotation, cx: b.cx, cy: b.cy } : null;
    });
    check(
      'The runtime reports the rotated bounds back to the Studio',
      Boolean(rotated) && Math.abs(rotated.rotation - 15) < 0.5,
      rotated ? `bounds rotation=${rotated.rotation}°` : 'no bounds'
    );
    await lockstep('The gizmo matches the rendered text (rotation 15°)');

    /* back to 0 for the manipulation tests */
    await page.evaluate(() => {
      window.store.updateLayer('title', { rotation: 0 }, 'verification: un-rotate');
    });
    await waitForBounds(page, 'title', (b) => Math.abs(b.rotation) < 0.5);
    await waitForGizmo(page, 'title');
    await page.waitForTimeout(400);

    /* ── 5. drag / scale / rotate ───────────────────────────────────────── */
    section('5. Direct manipulation: drag, corner scale, rotate');

    /* --- 5a. drag --- */
    const beforeDrag = await waitForGizmo(page, 'title');
    const beforeRuntime = await readRuntimeElement(frame, 'title');
    const beforeX = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title');
      return l ? l.position.xPct : null;
    });
    if (!beforeDrag.ok || !beforeRuntime.ok) {
      check('The canvas drag can be measured', false, `gizmo=${beforeDrag.ok} runtime=${beforeRuntime.ok}`);
    } else {
      // the gizmo's AABB centre IS the layer's transformed centre
      const dragStart = {
        x: beforeDrag.aabb.left + beforeDrag.aabb.width / 2,
        y: beforeDrag.aabb.top + beforeDrag.aabb.height / 2,
      };
      await page.evaluate(
        ({ x, y }) => {
          const overlay = document.querySelector('#canvas-overlay');
          const fire = (type, cx, cy) =>
            overlay.dispatchEvent(
              new PointerEvent(type, {
                clientX: cx,
                clientY: cy,
                bubbles: true,
                cancelable: true,
                pointerId: 7,
                button: 0,
                buttons: type === 'pointerup' ? 0 : 1,
                isPrimary: true,
              })
            );
          fire('pointerdown', x, y);
          for (let i = 1; i <= 6; i++) fire('pointermove', x + i * 18, y);
          window.__hud = document.querySelector('#canvas-hud')?.textContent?.trim() ?? null;
          fire('pointerup', x + 108, y);
        },
        dragStart
      );
      await page.waitForTimeout(900);
      const hud = await page.evaluate(() => window.__hud ?? null);
      check(
        'The live coordinate HUD appears during the drag',
        Boolean(hud && /X:/.test(hud) && /Y:/.test(hud)),
        hud ? `"${hud}"` : 'no #canvas-hud'
      );

      const afterDrag = await waitForGizmo(page, 'title');
      const afterRuntime = await readRuntimeElement(frame, 'title');
      const afterX = await page.evaluate(() => {
        const l = window.store.state.scene.layers.find((x) => x.id === 'title');
        return l ? l.position.xPct : null;
      });
      const afterSelection = await page.evaluate(() => window.store.state.selectedLayerId);
      const gizmoDx = afterDrag.aabb.left - beforeDrag.aabb.left;
      const runtimeDx = afterRuntime.left - beforeRuntime.left;
      check(
        'A canvas drag changes the layer position',
        beforeX !== null && afterX !== null && beforeX !== afterX,
        `position.xPct ${beforeX} → ${afterX}`
      );
      check(
        'The drag grabbed the layer (the selection is kept)',
        afterSelection === 'title',
        `selectedLayerId=${afterSelection}`
      );
      check(
        'The gizmo and the rendered element move by the SAME delta',
        Math.abs(gizmoDx - runtimeDx) < 2,
        `gizmo Δ=${gizmoDx.toFixed(2)}px, runtime Δ=${runtimeDx.toFixed(2)}px`
      );
      check(
        'The drag actually moved the layer on screen',
        Math.abs(gizmoDx) > 20,
        `gizmo moved ${gizmoDx.toFixed(1)}px`
      );
    }

    /* --- 5b. corner scale --- */
    const scaleBefore = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title');
      return { scale: l.scale, width: l.sizePx };
    });
    const gizmoBeforeScale = await readGizmo(page);
    const scaleResult = await page.evaluate(() => {
      const handle = document.querySelector('#selection-gizmo [data-handle="se"]');
      if (!handle) return { ok: false, reason: 'no se handle' };
      const r = handle.getBoundingClientRect();
      const hx = r.left + r.width / 2;
      const hy = r.top + r.height / 2;
      const overlay = document.querySelector('#canvas-overlay');
      const vp = document.querySelector('#monitor-viewport').getBoundingClientRect();
      const stage = document.querySelector('#monitor-stage').getBoundingClientRect();
      const scale = stage.width / 1920;
      const stageLeft = stage.left - vp.left;
      const stageTop = stage.top - vp.top;
      const b = window.store.state.layerBounds['title'];
      const toComp = (cx, cy) => ({
        x: (cx - vp.left - stageLeft) / scale,
        y: (cy - vp.top - stageTop) / scale,
      });
      const p0 = toComp(hx, hy);
      const theta0 = Math.atan2(p0.y - b.cy, p0.x - b.cx);
      const r0 = Math.max(1, Math.hypot(p0.x - b.cx, p0.y - b.cy));
      // double the distance from the centre → the scale doubles
      const theta1 = theta0;
      const p1 = {
        x: b.cx + Math.cos(theta1) * r0 * 2,
        y: b.cy + Math.sin(theta1) * r0 * 2,
      };
      const toClient = (p) => ({
        x: vp.left + stageLeft + p.x * scale,
        y: vp.top + stageTop + p.y * scale,
      });
      const c1 = toClient(p1);
      const fire = (type, cx, cy, target) =>
        (target || overlay).dispatchEvent(
          new PointerEvent(type, {
            clientX: cx,
            clientY: cy,
            bubbles: true,
            cancelable: true,
            pointerId: 8,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            isPrimary: true,
          })
        );
      fire('pointerdown', hx, hy, handle);
      for (let i = 1; i <= 5; i++) {
        fire('pointermove', hx + ((c1.x - hx) * i) / 5, hy + ((c1.y - hy) * i) / 5);
      }
      fire('pointerup', c1.x, c1.y);
      return { ok: true, handleX: hx, handleY: hy, targetX: c1.x, targetY: c1.y };
    });
    check('The "se" corner handle is present and hittable', scaleResult.ok, scaleResult.reason || '');
    await page.waitForTimeout(900);
    const scaleAfter = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title');
      return { scale: l.scale, width: l.sizePx };
    });
    const gizmoAfterScale = await waitForGizmo(page, 'title');
    check(
      'A corner drag INCREASES the layer scale',
      scaleAfter.scale > scaleBefore.scale,
      `scale ${scaleBefore.scale} → ${scaleAfter.scale}`
    );
    const gizmoWidthRatio = gizmoAfterScale.unrotated.width / gizmoBeforeScale.unrotated.width;
    check(
      'The gizmo grows proportionally with the scale',
      Math.abs(gizmoWidthRatio - scaleAfter.scale / scaleBefore.scale) < 0.12,
      `gizmo width ×${gizmoWidthRatio.toFixed(3)}, scale ×${(scaleAfter.scale / scaleBefore.scale).toFixed(3)}`
    );

    /* --- 5c. rotate --- */
    await page.evaluate(() => {
      window.store.updateLayer('title', { rotation: 0, scale: 1 }, 'verification: reset transform');
    });
    await waitForBounds(page, 'title', (b) => Math.abs(b.rotation) < 0.5 && Math.abs(b.scaleX - 1) < 0.02);
    await waitForGizmo(page, 'title');
    await page.waitForTimeout(500);
    const rotateResult = await page.evaluate(() => {
      const handle = document.querySelector('#selection-gizmo [data-handle="rotate"]');
      if (!handle) return { ok: false, reason: 'no rotate handle' };
      const r = handle.getBoundingClientRect();
      const hx = r.left + r.width / 2;
      const hy = r.top + r.height / 2;
      const overlay = document.querySelector('#canvas-overlay');
      const vp = document.querySelector('#monitor-viewport').getBoundingClientRect();
      const stage = document.querySelector('#monitor-stage').getBoundingClientRect();
      const scale = stage.width / 1920;
      const stageLeft = stage.left - vp.left;
      const stageTop = stage.top - vp.top;
      const b = window.store.state.layerBounds['title'];
      const toComp = (cx, cy) => ({
        x: (cx - vp.left - stageLeft) / scale,
        y: (cy - vp.top - stageTop) / scale,
      });
      const p0 = toComp(hx, hy);
      const theta0 = Math.atan2(p0.y - b.cy, p0.x - b.cx);
      const r0 = Math.max(1, Math.hypot(p0.x - b.cx, p0.y - b.cy));
      // 45° around the centre
      const theta1 = theta0 + Math.PI / 4;
      const p1 = { x: b.cx + Math.cos(theta1) * r0, y: b.cy + Math.sin(theta1) * r0 };
      const c1 = {
        x: vp.left + stageLeft + p1.x * scale,
        y: vp.top + stageTop + p1.y * scale,
      };
      const fire = (type, cx, cy, target) =>
        (target || overlay).dispatchEvent(
          new PointerEvent(type, {
            clientX: cx,
            clientY: cy,
            bubbles: true,
            cancelable: true,
            pointerId: 9,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            isPrimary: true,
          })
        );
      fire('pointerdown', hx, hy, handle);
      for (let i = 1; i <= 6; i++) {
        fire('pointermove', hx + ((c1.x - hx) * i) / 6, hy + ((c1.y - hy) * i) / 6);
      }
      fire('pointerup', c1.x, c1.y);
      return { ok: true };
    });
    check('The rotation handle is present and hittable', rotateResult.ok, rotateResult.reason || '');
    await page.waitForTimeout(900);
    const rotation = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title');
      const g = document.querySelector('#selection-gizmo');
      return {
        rotation: l ? l.rotation : null,
        dataRotation: g ? parseFloat(g.getAttribute('data-rotation') || '0') : null,
        transform: g ? g.getAttribute('transform') : null,
      };
    });
    check(
      'A rotation drag rotates the layer',
      typeof rotation.rotation === 'number' && Math.abs(rotation.rotation - 45) < 1.5,
      `rotation = ${rotation.rotation}°`
    );
    check(
      'The gizmo `data-rotation` matches the layer rotation',
      rotation.dataRotation !== null && Math.abs(rotation.dataRotation - rotation.rotation) < 0.05,
      `data-rotation = ${rotation.dataRotation}°`
    );
    check(
      'The gizmo transform carries the same rotate()',
      Boolean(rotation.transform && /rotate\((-?[\d.]+)\)/.test(rotation.transform)) &&
        Math.abs(parseFloat(/rotate\((-?[\d.]+)\)/.exec(rotation.transform)[1]) - rotation.rotation) < 0.05,
      `transform = ${rotation.transform}`
    );

    /* --- 5d. the inline text editor --- */
    await page.evaluate(() => {
      window.store.updateLayer('title', { rotation: 0, scale: 1 }, 'verification: reset transform');
    });
    await waitForBounds(page, 'title', (b) => Math.abs(b.rotation) < 0.5 && Math.abs(b.scaleX - 1) < 0.02);
    await waitForGizmo(page, 'title');
    await page.waitForTimeout(400);
    const inline = await page.evaluate(() => {
      const gizmo = document.querySelector('#selection-gizmo');
      const r = gizmo.getBoundingClientRect();
      const overlay = document.querySelector('#canvas-overlay');
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      overlay.dispatchEvent(
        new MouseEvent('dblclick', { clientX: x, clientY: y, bubbles: true, cancelable: true })
      );
      return { x, y };
    });
    await page.waitForTimeout(600);
    const editor = await page.evaluate(() => {
      const el = document.querySelector('#canvas-inline-editor');
      const input = document.querySelector('#canvas-inline-editor-input');
      return {
        present: Boolean(el),
        layerId: el?.getAttribute('data-layer-id') ?? null,
        field: el?.getAttribute('data-field') ?? null,
        text: input?.innerText ?? null,
      };
    });
    check(
      'A double-click opens the INLINE text editor over the layer',
      editor.present && editor.layerId === 'title' && editor.field === 'text',
      `layer=${editor.layerId}, field=${editor.field}, text="${editor.text}"`
    );
    const committed = await page.evaluate(async () => {
      const input = document.querySelector('#canvas-inline-editor-input');
      if (!input) return { ok: false };
      input.focus();
      input.innerText = 'Edited Inline';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 900));
      const l = window.store.state.scene.layers.find((x) => x.id === 'title');
      return { ok: true, text: l.text, closed: !document.querySelector('#canvas-inline-editor') };
    });
    check(
      'The inline editor commits the text to the scene',
      committed.ok && committed.text === 'Edited Inline',
      `scene text = "${committed.text}"`
    );
    check(
      'The inline editor closes after the commit',
      committed.ok && committed.closed === true,
      `closed = ${committed.closed}`
    );

    /* ── 6. the multi-track timeline ────────────────────────────────────── */
    section('6. Multi-track timeline');
    const lanes = await page.evaluate(() => {
      const resolved = window.store.resolveTrackLanes();
      const headers = Array.from(document.querySelectorAll('.mf-track-header')).map((h) => {
        const r = h.getBoundingClientRect();
        return {
          index: h.getAttribute('data-track-index'),
          name: h.getAttribute('data-track-name'),
          kind: h.getAttribute('data-track-kind'),
          top: r.top,
          height: r.height,
        };
      });
      return {
        resolved: resolved.map((l) => ({
          index: l.index,
          name: l.name,
          kind: l.kind,
          layers: l.layers.map((x) => x.id),
        })),
        headers,
      };
    });
    const laneOf = (id) => lanes.resolved.find((l) => l.layers.includes(id));
    const bgLane = laneOf('bg');
    const titleLane = laneOf('title');
    const title2Lane = laneOf('title-2');
    check(
      'bg, title and title (2) resolve to SEPARATE lane rows',
      Boolean(bgLane && titleLane && title2Lane) &&
        new Set([bgLane.index, titleLane.index, title2Lane.index]).size === 3,
      `bg→V${bgLane ? bgLane.index + 1 : '?'}, title→V${titleLane ? titleLane.index + 1 : '?'}, ` +
        `title (2)→V${title2Lane ? title2Lane.index + 1 : '?'}`
    );
    const videoHeaders = lanes.headers.filter((h) => h.kind === 'video');
    const distinctTops = new Set(videoHeaders.map((h) => Math.round(h.top)));
    check(
      'The DOM track headers sit on DIFFERENT rows',
      videoHeaders.length >= 3 && distinctTops.size === videoHeaders.length,
      videoHeaders.map((h) => `${h.name}@y=${h.top.toFixed(1)}`).join(' ')
    );
    check(
      'The track headers carry the real track index',
      videoHeaders.every((h) => /^\d+$/.test(String(h.index))),
      videoHeaders.map((h) => `${h.name}=${h.index}`).join(' ')
    );

    /* --- 6a. scrub --- */
    const scrub = await page.evaluate(async () => {
      const canvas = document.querySelector('#timeline-canvas');
      const rect = canvas.getBoundingClientRect();
      const rulerH =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--mf-ruler-h')
        ) || 28;
      const y = rect.top + rulerH / 2;
      const startX = rect.left + 120;
      const values = [];
      const fire = (type, cx, cy, target) =>
        (target || window).dispatchEvent(
          new MouseEvent(type, {
            clientX: cx,
            clientY: cy,
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: type === 'mouseup' ? 0 : 1,
          })
        );
      fire('mousedown', startX, y, canvas);
      values.push(window.store.state.playhead);
      for (let i = 1; i <= 8; i++) {
        fire('mousemove', startX + i * 25, y);
        await new Promise((r) => setTimeout(r, 12));
        values.push(window.store.state.playhead);
      }
      fire('mouseup', startX + 200, y);
      return { values, rulerH, distinct: new Set(values).size };
    });
    check(
      'A ruler drag scrubs the playhead continuously',
      scrub.distinct > 2,
      `${scrub.distinct} distinct playhead values: ${scrub.values.join(', ')} (ruler ${scrub.rulerH}px)`
    );

    /* --- 6b. clip drag --- */
    const clipGeom = async (layerId) =>
      await page.evaluate((id) => {
        const canvas = document.querySelector('#timeline-canvas');
        const rect = canvas.getBoundingClientRect();
        const state = window.store.state;
        const scene = state.scene;
        const durationMs = scene.durationMs || 10000;
        const clientWidth = canvas.clientWidth;
        const pxPerMs = (clientWidth * state.zoom) / durationMs;
        const timeToX = (ms) => ms * pxPerMs + state.panOffset;
        const layer = scene.layers.find((l) => l.id === id);
        const lane = window.store
          .resolveTrackLanes()
          .find((l) => l.layers.some((x) => x.id === id));
        const header = Array.from(document.querySelectorAll('.mf-track-header')).find(
          (h) =>
            h.getAttribute('data-track-index') === String(lane.index) &&
            h.getAttribute('data-track-kind') === 'video'
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
        };
      }, layerId);

    const titleClip = await clipGeom('title-2');
    const clipBefore = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title-2');
      return { at: l.at, duration: l.duration };
    });
    await page.evaluate(
      ({ x, y }) => {
        const canvas = document.querySelector('#timeline-canvas');
        const fire = (type, cx, cy, target) =>
          (target || window).dispatchEvent(
            new MouseEvent(type, {
              clientX: cx,
              clientY: cy,
              bubbles: true,
              cancelable: true,
              button: 0,
              buttons: type === 'mouseup' ? 0 : 1,
            })
          );
        fire('mousedown', x, y, canvas);
        for (let i = 1; i <= 6; i++) fire('mousemove', x + i * 14, y);
        fire('mouseup', x + 84, y);
      },
      { x: titleClip.mid, y: titleClip.rowCentre }
    );
    await page.waitForTimeout(700);
    const clipAfter = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title-2');
      return { at: l.at, duration: l.duration };
    });
    check(
      'A clip drag MOVES the clip in time',
      clipAfter.at !== clipBefore.at,
      `at ${clipBefore.at}ms → ${clipAfter.at}ms (${titleClip.pxPerMs.toFixed(4)} px/ms, zoom ${titleClip.zoom})`
    );

    /* --- 6c. trim --- */
    const titleClip2 = await clipGeom('title');
    const trimBefore = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title');
      return { at: l.at, duration: l.duration };
    });
    await page.evaluate(
      ({ x, y }) => {
        const canvas = document.querySelector('#timeline-canvas');
        const fire = (type, cx, cy, target) =>
          (target || window).dispatchEvent(
            new MouseEvent(type, {
              clientX: cx,
              clientY: cy,
              bubbles: true,
              cancelable: true,
              button: 0,
              buttons: type === 'mouseup' ? 0 : 1,
            })
          );
        fire('mousedown', x, y, canvas);
        for (let i = 1; i <= 6; i++) fire('mousemove', x + i * 10, y);
        fire('mouseup', x + 60, y);
      },
      { x: titleClip2.x2 - 4, y: titleClip2.rowCentre }
    );
    await page.waitForTimeout(700);
    const trimAfter = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title');
      return { at: l.at, duration: l.duration };
    });
    check(
      'A right-edge drag TRIMS the clip (duration changes)',
      trimAfter.duration !== trimBefore.duration,
      `duration ${trimBefore.duration}ms → ${trimAfter.duration}ms`
    );
    check(
      'A right-edge trim does NOT move the clip',
      trimAfter.at === trimBefore.at,
      `at ${trimBefore.at}ms → ${trimAfter.at}ms`
    );

    /* --- 6d. zoom to fit --- */
    await page.evaluate(() => window.store.setZoom(3));
    await page.waitForTimeout(200);
    await page.click('#timeline-zoom-fit');
    await page.waitForTimeout(500);
    const zoomFit = await page.evaluate(() => {
      const canvas = document.querySelector('#timeline-canvas');
      return {
        zoom: window.store.state.zoom,
        panOffset: window.store.state.panOffset,
        width: canvas.clientWidth,
        durationMs: window.store.state.scene.durationMs,
        layers: window.store.state.scene.layers.map((l) => ({
          at: l.at ?? 0,
          duration: l.duration ?? 0,
        })),
      };
    });
    // The fit targets the CONTENT EXTENT (the last clip's end), not the
    // nominal duration: a clip may run past `durationMs`, and the fit must
    // show EVERY clip on EVERY track.
    const contentEnd = Math.max(
      ...zoomFit.layers.map((l) => (l.at ?? 0) + (l.duration ?? 0)),
      zoomFit.durationMs
    );
    const visibleEnd = zoomFit.durationMs / zoomFit.zoom; // ms the canvas now shows
    check(
      'Zoom-to-fit shows EVERY clip (it fits the content extent)',
      visibleEnd >= contentEnd - 1,
      `visible ${visibleEnd.toFixed(0)}ms vs content end ${contentEnd.toFixed(0)}ms`
    );
    check('Zoom-to-fit resets the pan offset', zoomFit.panOffset === 0, `panOffset=${zoomFit.panOffset}`);

    /* ── 7. keyframes & effects ─────────────────────────────────────────── */
    section('7. Keyframes and visual effects');
    await page.evaluate(() => {
      window.store.updateLayer(
        'title',
        { position: { xPct: 50, yPct: 45 }, scale: 1, rotation: 0 },
        'verification: reset transform'
      );
      window.store.selectLayer('title');
      window.store.setPlayhead(0);
    });
    await page.waitForTimeout(1600);

    const kfToggle = '[data-keyframe-property="xPct"] button[data-action="keyframe-toggle"]';
    check('The Position-X stopwatch control is mounted', (await page.locator(kfToggle).count()) > 0);
    await page.click(kfToggle);
    await page.waitForTimeout(700);
    const kf0 = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title');
      return (l.keyframes || []).filter((k) => k.property === 'xPct');
    });
    check(
      'The stopwatch creates a keyframe at the playhead (t = 0)',
      kf0.some((k) => Math.abs(k.timeMs) < 20),
      JSON.stringify(kf0.map((k) => ({ t: k.timeMs, v: k.value })))
    );

    /* AUTO-KEY: a keyframed property writes the edited value into the keyframe
       AT THE PLAYHEAD (After Effects semantics). So the playhead must move to
       1000ms BEFORE the scrub — otherwise the scrub would re-key the t=0
       keyframe and the two keyframes would carry the same value. */
    await page.evaluate(() => window.store.setPlayhead(1000));
    await page.waitForTimeout(600);

    /* change the value through the inspector's scrub input */
    const scrubBefore = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title');
      return l.position.xPct;
    });
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#layer-properties .mf-prop-row'));
      const row = rows.find((r) => r.querySelector('.mf-label')?.textContent?.trim() === 'Position X');
      const label = row?.querySelector('.mf-scrub-label');
      if (!label) throw new Error('no Position X scrub label');
      const box = label.getBoundingClientRect();
      const y = box.top + box.height / 2;
      const x = box.left + 4;
      label.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, pointerId: 11, button: 0, buttons: 1 })
      );
      for (let i = 1; i <= 10; i++) {
        window.dispatchEvent(
          new PointerEvent('pointermove', { clientX: x - i * 6, clientY: y, bubbles: true, pointerId: 11, buttons: 1 })
        );
      }
      window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: x - 60, clientY: y, bubbles: true, pointerId: 11, button: 0, buttons: 0 })
      );
    });
    await page.waitForTimeout(700);
    const scrubAfter = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title');
      return l.position.xPct;
    });
    check(
      'The inspector scrub changes the Position X value',
      scrubBefore !== scrubAfter,
      `xPct ${scrubBefore} → ${scrubAfter}`
    );

    const kfs = await page.evaluate(() => {
      const l = window.store.state.scene.layers.find((x) => x.id === 'title');
      return (l.keyframes || []).filter((k) => k.property === 'xPct');
    });
    check(
      'A second keyframe exists at ~1000ms (the scrub auto-keyed it)',
      kfs.some((k) => Math.abs(k.timeMs - 1000) < 20),
      JSON.stringify(kfs.map((k) => ({ t: k.timeMs, v: k.value })))
    );
    check(
      'The t=0 keyframe still holds the ORIGINAL value',
      kfs.some((k) => Math.abs(k.timeMs) < 20 && Math.abs(k.value - 50) < 0.01),
      JSON.stringify(kfs.map((k) => ({ t: k.timeMs, v: k.value })))
    );

    /* the runtime must INTERPOLATE between the two keyframes */
    const readAt = async (atMs) => {
      await page.evaluate((t) => window.store.setPlayhead(t), atMs);
      await page.waitForTimeout(900);
      const el = await readRuntimeElement(frame, 'title');
      return el.ok ? el : null;
    };
    const at0 = await readAt(0);
    const at500 = await readAt(500);
    const at1000 = await readAt(1000);
    const pct = (el) => (el ? parseFloat(el.styleLeft) : NaN);
    const v0 = pct(at0);
    const v500 = pct(at500);
    const v1000 = pct(at1000);
    check(
      'The runtime INTERPOLATES the keyframed position',
      Number.isFinite(v0) && Number.isFinite(v500) && v0 !== v500,
      `left@0=${at0 ? at0.styleLeft : '?'} left@500=${at500 ? at500.styleLeft : '?'} left@1000=${at1000 ? at1000.styleLeft : '?'}`
    );
    const lo = Math.min(v0, v1000);
    const hi = Math.max(v0, v1000);
    check(
      'The interpolated value lies BETWEEN the two keyframes',
      Number.isFinite(v500) && v500 >= lo - 0.01 && v500 <= hi + 0.01 && v500 !== v0 && v500 !== v1000,
      `v0=${v0} v500=${v500} v1000=${v1000} (expected ${lo}..${hi})`
    );

    /* the inspector must show the value the PREVIEW shows at the playhead */
    await page.evaluate(() => window.store.setPlayhead(0));
    await page.waitForTimeout(800);
    const atPlayhead = await readRuntimeElement(frame, 'title');
    const inspectorValue = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#layer-properties .mf-prop-row'));
      const row = rows.find(
        (r) => r.querySelector('.mf-label')?.textContent?.trim() === 'Position X'
      );
      const raw = row?.querySelector('.mf-scrub-value')?.textContent?.trim() ?? null;
      const parsed = raw === null ? null : parseFloat(raw);
      const layer = window.store.state.scene.layers.find((x) => x.id === 'title');
      return { raw, parsed, authored: layer?.position?.xPct ?? null };
    });
    const evaluated = atPlayhead ? parseFloat(atPlayhead.styleLeft) : NaN;
    check(
      'The inspector shows the KEYFRAMED value at the playhead (not the authored one)',
      Number.isFinite(evaluated) &&
        Number.isFinite(inspectorValue.parsed) &&
        Math.abs(evaluated - inspectorValue.parsed) < 0.05,
      `runtime renders xPct=${evaluated}% at t=0, the inspector shows "${inspectorValue.raw}" ` +
        `(the authored position.xPct is ${inspectorValue.authored})`
    );

    /* --- 7b. the visual filters --- */
    await page.evaluate(() => {
      window.store.setLayerFilter('title', 'blur', 12);
    });
    await page.waitForTimeout(1600);
    const blurred = await readRuntimeElement(frame, 'title');
    check(
      'A blur filter reaches the rendered element',
      Boolean(blurred && blurred.filter && blurred.filter.includes('blur(12px)')),
      blurred ? `filter = "${blurred.filter}"` : 'no element'
    );
    await page.evaluate(() => {
      window.store.setLayerFilter('title', 'brightness', 140);
    });
    await page.waitForTimeout(1600);
    const brightened = await readRuntimeElement(frame, 'title');
    // The runtime authors `brightness(140%)`; Chromium normalises the computed
    // value of a percentage filter function to a NUMBER, so the computed style
    // reads `brightness(1.4)` — 140% == 1.4x.
    check(
      'A brightness filter reaches the rendered element',
      Boolean(brightened && brightened.filter && brightened.filter.includes('brightness(1.4)')),
      brightened
        ? `computed filter = "${brightened.filter}" (authored: "${brightened.styleFilter}")`
        : 'no element'
    );
    check(
      'The authored filter keeps the percent form the inspector writes',
      Boolean(brightened && brightened.styleFilter && brightened.styleFilter.includes('brightness(140%)')),
      brightened ? `inline style.filter = "${brightened.styleFilter}"` : 'no element'
    );

    /* the scene must survive the whole run — checked while the filters are live */
    const persisted = await page.evaluate(async (id) => {
      const scene = await window.motionforgeEngine.invoke('getScene', id);
      const title = scene.layers.find((l) => l.id === 'title');
      return {
        layers: scene.layers.length,
        keyframes: (title?.keyframes || []).filter((k) => k.property === 'xPct').length,
        filters: title?.filters || null,
        rotation: title?.rotation ?? null,
        at: title?.at ?? null,
      };
    }, SCENE_ID);
    check(
      'The scene persisted through the engine with its keyframes and filters',
      persisted.layers === 3 && persisted.keyframes >= 2 && Boolean(persisted.filters?.blur),
      JSON.stringify(persisted)
    );

    /* ── 8. the rounded design system ───────────────────────────────────── */
    section('8. The rounded design system');
    const design = await page.evaluate(() => {
      const panel = document.querySelector('.panel-container');
      const panelRadius = panel ? getComputedStyle(panel).borderRadius : null;
      const nodes = Array.from(document.querySelectorAll('button, input, select, textarea'));
      const census = [];
      for (const n of nodes) {
        const r = n.getBoundingClientRect();
        const cs = getComputedStyle(n);
        const visible =
          r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
        if (!visible) continue;
        if ((n.getAttribute('type') || '').toLowerCase() === 'range') continue;
        const cls =
          typeof n.className === 'string' ? n.className : (n.className && n.className.baseVal) || '';
        census.push({
          tag: n.tagName.toLowerCase(),
          type: n.getAttribute('type') || '',
          id: n.id || '',
          cls: String(cls).split(/\s+/).filter(Boolean).join(' '),
          radius: cs.borderRadius.split(' ')[0],
        });
      }
      const standard = census.filter(
        (c) => c.cls.split(' ').includes('mf-btn') || c.cls.includes('mf-input') || c.cls.includes('mf-select')
      );
      const deviations = standard.filter((c) => c.radius !== '6px');
      const offStandard = census.filter((c) => !standard.includes(c));
      const offScale = census.filter((c) => !/^(4px|6px|8px|50%)$/.test(c.radius));
      const byRadius = {};
      for (const c of census) byRadius[c.radius] = (byRadius[c.radius] || 0) + 1;
      return {
        panelRadius,
        panelCount: document.querySelectorAll('.panel-container').length,
        total: census.length,
        standard: standard.length,
        deviations: deviations.map((d) => `${d.tag}#${d.id || '-'}.${d.cls}=${d.radius}`),
        offStandard: offStandard.map((d) => `${d.tag}#${d.id || '-'}.${d.cls}=${d.radius}`),
        offScale: offScale.map((d) => `${d.tag}#${d.id || '-'}.${d.cls}=${d.radius}`),
        byRadius,
      };
    });
    check(
      'The docked panel container has an 8px radius',
      design.panelRadius === '8px',
      `.panel-container border-radius = ${design.panelRadius} (${design.panelCount} panels)`
    );
    check(
      'Every standard control (.mf-btn / .mf-input / .mf-select) has a 6px radius',
      design.deviations.length === 0 && design.standard > 0,
      `${design.standard} controls checked` +
        (design.deviations.length ? ` — deviating: ${design.deviations.join(', ')}` : '')
    );
    check(
      'EVERY visible button / input / select has a 6px radius',
      design.offStandard.every((c) => c.endsWith('=6px')),
      `${design.total - design.standard} further controls checked` +
        (design.offStandard.some((c) => !c.endsWith('=6px'))
          ? ` — deviating: ${design.offStandard.filter((c) => !c.endsWith('=6px')).join(', ')}`
          : '')
    );
    check(
      'Every visible control uses a radius from the token scale',
      design.offScale.length === 0,
      `census ${design.total} controls: ${JSON.stringify(design.byRadius)}` +
        (design.offScale.length ? ` — off-scale: ${design.offScale.join(', ')}` : '')
    );
    console.log(
      `  INFO  the radius census covers ${design.total} visible controls: ${JSON.stringify(design.byRadius)}`
    );

    /* ── 9. the screenshot ──────────────────────────────────────────────── */
    section('9. High-resolution screenshot');
    await page.evaluate(() => {
      // a clean, presentable state for the capture
      window.store.setActiveModal(null);
      window.store.setActiveTool('select');
      window.store.setLayerFilter('title', 'blur', undefined);
      window.store.setLayerFilter('title', 'brightness', undefined);
      window.store.updateLayer(
        'title',
        { text: 'MotionForge v4', rotation: 0, scale: 1 },
        'verification: presentation state'
      );
      window.store.setPlayhead(0);
      window.store.selectLayer('title');
    });
    await page.waitForTimeout(1800);
    // clear the save toasts last, so the capture shows the editor and not the log
    await page.evaluate(() => {
      for (const toast of [...window.store.state.toasts]) window.store.removeToast(toast.id);
    });
    await page.waitForTimeout(400);
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: SCREENSHOT_PATH, scale: 'device' });
    const shot = fs.existsSync(SCREENSHOT_PATH) ? fs.statSync(SCREENSHOT_PATH) : { size: 0 };
    const shotSize = await page.evaluate(() => ({
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: window.devicePixelRatio,
    }));
    check(
      'The verification screenshot was written',
      shot.size > 10000,
      `${path.relative(ROOT, SCREENSHOT_PATH)} (${(shot.size / 1024).toFixed(0)} kB)`
    );
    check(
      'The screenshot is at least 1600px wide',
      shotSize.w >= 1600,
      `viewport ${shotSize.w}x${shotSize.h} @ dpr ${shotSize.dpr}`
    );

    /* ── 10. the regression sweep ───────────────────────────────────────── */
    section('10. Regression sweep');
    const bodyText = await page.evaluate(() => document.body.innerText);
    const emoji = findEmoji(bodyText);
    check(
      'The live UI contains zero emoji',
      emoji.length === 0,
      emoji.length ? emoji.map((e) => `${e.char} ${e.codePoint}`).join(', ') : 'clean'
    );

    const unrecognized = [...consoleErrors, ...pageErrors, ...mainErrors].filter((line) =>
      /Unrecognized key/i.test(line)
    );
    check(
      'No "Unrecognized key(s) in object" error occurred anywhere',
      unrecognized.length === 0,
      unrecognized.join(' | ')
    );

    const realErrors = [...consoleErrors, ...pageErrors].filter(
      (line) => !/Electron Security Warning|Autofill|devtools|Third-party cookie/i.test(line)
    );
    check(
      'The renderer produced no page errors',
      realErrors.length === 0,
      realErrors.slice(0, 4).join(' | ')
    );
    check(
      'The main process produced no errors',
      mainErrors.length === 0,
      mainErrors.slice(0, 3).join(' | ')
    );

    /* clean up: the run must not leave a scene behind for the other harness */
    const cleaned = await page.evaluate(async (id) => {
      try {
        const res = await window.motionforgeEngine.invoke('deleteScene', id);
        return { ok: true, res };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }, SCENE_ID);
    check('The verification scene is removed from the engine', cleaned.ok, cleaned.ok ? 'deleted' : cleaned.error);
    await page.waitForTimeout(600);

  } finally {
    /* the isolated workspace is torn down, whatever happened */
    if (app) {
      try {
        await app.close();
      } catch (err) {
        console.error('[verify:ux-gizmo] could not close the app:', err);
      }
    }
    cleanupTestDirs(testDirs);
    console.log(`isolated workspace removed: ${testDirs.root}`);
    failed = failures > 0;
  }

  /* ── summary ────────────────────────────────────────────────────────── */
  console.log('\n================================================================');
  console.log(`=== SUMMARY: ${results.length - failures}/${results.length} checks passed ===`);
  console.log('================================================================');
  if (failed) {
    console.error('\nFAILED CHECKS:');
    for (const result of results.filter((r) => !r.ok)) {
      console.error(`  - ${result.label}${result.detail ? ` (${result.detail})` : ''}`);
    }
    process.exit(1);
  }
  console.log('\nAll full-stack UX & gizmo verification checks passed.');
}

main().catch((err) => {
  console.error('\n[verify:ux-gizmo] FAILED:', err);
  process.exit(1);
});
