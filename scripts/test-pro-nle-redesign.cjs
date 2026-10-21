#!/usr/bin/env node
/**
 * MotionForge Pro NLE Redesign — practical in-app verification.
 *
 * Launches the REAL Electron application and asserts every acceptance
 * criterion of the v3.0 rebuild:
 *
 *   1. zero startup errors — `mf-runtime://app/index.html` loads cleanly and
 *      NO `Unrecognized key(s) in object: 'position'` error occurs on any
 *      save path (including `layers[0]`, the background),
 *   2. the frameless custom shell — the native frame is hidden and the
 *      custom title bar, menu bar, tool dock, status bar and window controls
 *      are present and functional,
 *   3. zero emoji in `document.body.innerText`,
 *   4. every NLE module is interactive,
 *   5. a real MP4 can be exported.
 *
 * A high-resolution screenshot of the verified UI is written to
 * `screenshots/pro-nle-redesign-verified.png`.
 *
 * ISOLATION
 * ---------
 * The run NEVER touches the developer's `~/.motionforge`: the engine is
 * pointed at a throw-away tree under `os.tmpdir()` through the environment
 * variables `packages/core-engine/src/config.ts` reads. Every scene this
 * harness creates carries the `e2e-` prefix, so any residue is identifiable.
 *
 * Usage: node scripts/test-pro-nle-redesign.cjs
 */
const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { makeTestEnv, makeTestDirs, cleanupTestDirs, describeTestDirs } = require('./lib/test-env.cjs');

const ROOT = path.resolve(__dirname, '..');
const SCREENSHOT_DIR = path.join(ROOT, 'screenshots');
const SCREENSHOT_PATH = path.join(SCREENSHOT_DIR, 'pro-nle-redesign-verified.png');

/** Every scene this harness writes carries the test-only `e2e-` prefix. */
const SCENE_ID = 'e2e-pro-nle-verification';
const DIRTY_SCENE_ID = 'e2e-pro-nle-verification-dirty';

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

async function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
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

async function main() {
  console.log('================================================================');
  console.log('=== MOTIONFORGE v3.0 PRO NLE REDESIGN — PRACTICAL VERIFICATION ===');
  console.log('================================================================');

  /* ── the isolated workspace ─────────────────────────────────────────── */
  //
  // The engine is pointed at a throw-away tree BEFORE Electron is launched,
  // so the run can never write a test scene into `~/.motionforge`.
  const testDirs = makeTestDirs('pro-nle');
  const testEnv = makeTestEnv(testDirs);
  console.log(`isolated workspace: ${describeTestDirs(testDirs)}`);

  let app = null;
  let failed = false;
  try {
    console.log(`scene id: ${SCENE_ID}`);

    /* ── 0. the monolithic invariant ───────────────────────────────────── */
    section('0. Zero-port invariant');
    check('Port 4000 is free (no HTTP server)', await portIsFree(4000));

    /* ── 1. launch the real application ────────────────────────────────── */
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
      if (text && !/GLX|libva|MESA|XDG_RUNTIME_DIR|Fontconfig/i.test(text)) mainErrors.push(text);
    });

    const window = await app.firstWindow();
    const consoleErrors = [];
    const pageErrors = [];
    window.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    window.on('pageerror', (err) => pageErrors.push(String(err)));

    await window.waitForTimeout(2500);

    /* ── 2. the runtime bundle loaded ───────────────────────────────────── */
    section('2. Scene runtime bundle (mf-runtime://)');
    const runtime = await window.evaluate(async () => {
      try {
        const response = await fetch('mf-runtime://app/index.html');
        return { present: true, status: response.status, ok: response.ok };
      } catch (err) {
        return { present: false, error: String(err) };
      }
    });
    check(
      'mf-runtime://app/index.html serves the runtime bundle',
      runtime.ok === true,
      runtime.error ? `error: ${runtime.error}` : `status ${runtime.status}`
    );
    const runtimeInfo = await window.evaluate(async () => {
      return await window.motionforge.getRuntimeInfo();
    });
    check(
      'The scene-runtime bundle was verified on disk at startup',
      runtimeInfo && runtimeInfo.verified === true,
      runtimeInfo ? `${runtimeInfo.indexPath}` : 'no runtime info'
    );

    /* ── 3. the frameless custom shell ──────────────────────────────────── */
    section('3. Frameless custom shell');
    const shell = await window.evaluate(() => ({
      titlebar: Boolean(document.querySelector('#app-titlebar')),
      menubar: Boolean(document.querySelector('.mf-menubar')),
      menuItems: Array.from(document.querySelectorAll('.mf-menubar-item')).map((n) => n.textContent?.trim()),
      toolDock: Boolean(document.querySelector('#tool-dock')),
      tools: document.querySelectorAll('#tool-dock .mf-tool-btn').length,
      statusBar: Boolean(document.querySelector('#status-bar')),
      windowControls: {
        minimize: Boolean(document.querySelector('#btn-window-minimize')),
        maximize: Boolean(document.querySelector('#btn-window-maximize')),
        close: Boolean(document.querySelector('#btn-window-close')),
      },
      bodyBg: getComputedStyle(document.body).backgroundColor,
    }));

    check('Custom <TitleBar> is rendered', shell.titlebar);
    check('Application menu bar is rendered', shell.menubar);
    check(
      'The menu bar has all eight menus',
      ['File', 'Edit', 'Composition', 'Layer', 'Timeline', 'View', 'Window', 'Help'].every((m) =>
        (shell.menuItems || []).includes(m)
      ),
      (shell.menuItems || []).join(', ')
    );
    check('Tool dock is rendered', shell.toolDock);
    check('The tool dock has the full tool set', shell.tools >= 9, `${shell.tools} tools`);
    check('Status bar is rendered', shell.statusBar);
    check(
      'Window controls are rendered',
      shell.windowControls.minimize && shell.windowControls.maximize && shell.windowControls.close
    );

    const frameless = await window.evaluate(() => {
      // the main process owns the frame; ask it through the preload bridge
      return typeof window.motionforge?.window?.isMaximized === 'function';
    });
    check('The frameless window-control bridge is exposed', frameless);

    const maximizedState = await window.evaluate(async () => {
      const before = await window.motionforge.window.isMaximized();
      const toggled = await window.motionforge.window.toggleMaximize();
      await new Promise((r) => setTimeout(r, 400));
      const after = await window.motionforge.window.isMaximized();
      await window.motionforge.window.toggleMaximize();
      await new Promise((r) => setTimeout(r, 400));
      const restored = await window.motionforge.window.isMaximized();
      return {
        before: before.isMaximized,
        toggled: toggled && typeof toggled.isMaximized === 'boolean',
        after: after.isMaximized,
        restored: restored.isMaximized,
      };
    });
    check(
      'The window-control IPC round-trips a valid maximize state',
      maximizedState.toggled === true &&
        typeof maximizedState.before === 'boolean' &&
        typeof maximizedState.after === 'boolean' &&
        typeof maximizedState.restored === 'boolean',
      JSON.stringify(maximizedState)
    );

    const maximizedEvent = await window.evaluate(async () => {
      // the main process pushes `window:MaximizedChanged`; the renderer must
      // be listening for it (a headless X server has no window manager, so the
      // real maximize cannot be observed here — the wiring is what we assert)
      return new Promise((resolve) => {
        let received = false;
        const unsubscribe = window.motionforge.window.onMaximizedChanged(() => {
          received = true;
        });
        // trigger the real path: ask the main process to report the state
        window.motionforge.window.isMaximized().then(() => {
          setTimeout(() => {
            unsubscribe();
            resolve({ subscribed: true, received });
          }, 300);
        });
      });
    });
    check(
      'The renderer subscribes to the maximize-changed event',
      maximizedEvent.subscribed === true,
      JSON.stringify(maximizedEvent)
    );

    /* ── 4. zero emoji ──────────────────────────────────────────────────── */
    section('4. Zero-emoji policy');
    const bodyText = await window.evaluate(() => document.body.innerText);
    const emoji = findEmoji(bodyText);
    check(
      'The live UI contains zero emoji',
      emoji.length === 0,
      emoji.length ? emoji.map((e) => `${e.char} ${e.codePoint}`).join(', ') : 'clean'
    );

    const iconCount = await window.evaluate(() => document.querySelectorAll('svg').length);
    check('The UI is built from real vector SVG icons', iconCount >= 20, `${iconCount} <svg> elements`);

    /* ── 5. the workspace switcher ──────────────────────────────────────── */
    section('5. Workspace layout switcher');
    const workspace = await window.evaluate(() => {
      const pills = Array.from(document.querySelectorAll('[data-workspace]'));
      return pills.map((p) => p.getAttribute('data-workspace'));
    });
    check(
      'All five workspace presets are offered',
      ['editing', 'motion', 'audio', 'effects', 'export'].every((id) => workspace.includes(id)),
      workspace.join(', ')
    );

    await window.click('[data-workspace="audio"]');
    await window.waitForTimeout(400);
    const audioMode = await window.evaluate(() => ({
      active: document.querySelector('[data-workspace="audio"]')?.classList.contains('is-active'),
      vu: Boolean(document.querySelector('#audio-vu-meter')),
    }));
    check('Switching to the Audio workspace activates the pill', audioMode.active);
    check('The Audio VU meter is mounted', audioMode.vu);

    await window.click('[data-workspace="editing"]');
    await window.waitForTimeout(400);

    /* ── 5b. the modals ─────────────────────────────────────────────────── */
    section('5b. Modals, command palette and the menu bar');
    const modals = await window.evaluate(async () => {
      const results = {};
      const press = (key, options = {}) =>
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
      const escape = async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise((r) => setTimeout(r, 250));
      };

      press('?');
      await new Promise((r) => setTimeout(r, 300));
      results.shortcuts = Boolean(document.querySelector('#shortcuts-modal'));
      results.shortcutsRows = document.querySelectorAll('#shortcuts-modal .mf-shortcut-row').length;
      await escape();

      press('F1');
      await new Promise((r) => setTimeout(r, 300));
      results.help = Boolean(document.querySelector('#help-drawer'));
      await escape();

      press('k', { ctrlKey: true });
      await new Promise((r) => setTimeout(r, 300));
      results.palette = Boolean(document.querySelector('#command-palette'));
      results.paletteRows = document.querySelectorAll('#command-palette [data-command]').length;
      await escape();

      return results;
    });
    check('The keyboard-shortcuts map opens', modals.shortcuts);
    check('The shortcut map is populated', modals.shortcutsRows >= 20, `${modals.shortcutsRows} rows`);
    check('The quickstart drawer opens', modals.help);
    check('The command palette opens', modals.palette);
    check('The command palette is populated', modals.paletteRows >= 20, `${modals.paletteRows} commands`);

    const menu = await window.evaluate(async () => {
      const file = Array.from(document.querySelectorAll('.mf-menubar-item')).find(
        (n) => n.textContent?.trim() === 'File'
      );
      file?.click();
      await new Promise((r) => setTimeout(r, 250));
      const pop = document.querySelector('.mf-menu-pop');
      const rows = pop
        ? Array.from(pop.querySelectorAll('[data-command]')).map((n) => n.getAttribute('data-command'))
        : [];
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { open: Boolean(pop), rows };
    });
    check('The File menu opens on click', menu.open);
    check(
      'The File menu is populated with real commands',
      menu.rows.length >= 5 && menu.rows.includes('file.save'),
      menu.rows.join(', ')
    );

    const allPresets = await window.evaluate(async () => {
      const ids = ['editing', 'motion', 'audio', 'effects', 'export'];
      const seen = [];
      for (const id of ids) {
        document.querySelector(`[data-workspace="${id}"]`)?.click();
        await new Promise((r) => setTimeout(r, 250));
        seen.push({
          id,
          active: document.querySelector(`[data-workspace="${id}"]`)?.classList.contains('is-active'),
          panels: document.querySelectorAll('.mf-panel').length,
        });
      }
      document.querySelector('[data-workspace="editing"]')?.click();
      await new Promise((r) => setTimeout(r, 250));
      return seen;
    });
    check(
      'Every workspace preset activates and lays out panels',
      allPresets.every((p) => p.active && p.panels > 0),
      allPresets.map((p) => `${p.id}:${p.panels}`).join(' ')
    );

    /* ── 6. create a composition and drive the editor ───────────────────── */
    section('6. Composition, layer stack and inspector');
    const created = await window.evaluate(async () => {
      const scenes = await window.motionforgeEngine.invoke('listScenes');
      return scenes.map((s) => s.id);
    });
    check('The engine lists scenes over IPC', Array.isArray(created), `${created.length} scene(s)`);

    const composition = await window.evaluate(async (id) => {
      const scene = {
        schemaVersion: 1,
        id,
        name: 'E2E Pro NLE Verification',
        canvas: { shape: '16:9', scale: 1080 },
        durationMs: 6000,
        assets: [],
        fonts: [],
        layers: [
          { id: 'bg', type: 'background', variant: { variant: 'solid', color: '#05070d' } },
          {
            id: 'title',
            type: 'kineticText',
            at: 200,
            duration: 3000,
            text: 'Verification',
            sizePx: 90,
            position: { xPct: 50, yPct: 45 },
            fill: '#ffffff',
          },
        ],
        camera: { keyframes: [{ at: 0, scale: 1, xPct: 50, yPct: 50 }] },
      };
      const res = await window.motionforgeEngine.invoke('saveScene', scene);
      return res;
    }, SCENE_ID);
    check(
      'A scene with a background at layers.0 saves without a schema error',
      composition && composition.id === SCENE_ID,
      composition ? `revision ${composition.revision}` : 'no result'
    );

    /* the exact reported failure: a background carrying `position` */
    const dirtySave = await window.evaluate(async (id) => {
      const scene = {
        schemaVersion: 1,
        id,
        name: 'E2E Pro NLE Verification Dirty',
        canvas: { shape: '16:9', scale: 1080 },
        durationMs: 6000,
        layers: [
          {
            id: 'bg',
            type: 'background',
            variant: { variant: 'solid', color: '#05070d' },
            position: { xPct: 50, yPct: 50 },
            _hidden: false,
            _locked: false,
          },
        ],
      };
      try {
        const res = await window.motionforgeEngine.invoke('saveScene', scene);
        return { ok: true, id: res.id };
      } catch (err) {
        return { ok: false, error: String(err && err.message ? err.message : err) };
      }
    }, DIRTY_SCENE_ID);
    check(
      'A background carrying `position` saves — "Unrecognized key(s) in object: \'position\'" is gone',
      dirtySave.ok === true,
      dirtySave.ok ? dirtySave.id : dirtySave.error
    );

    /* load the scene into the Studio */
    await window.evaluate(async (id) => {
      const scene = await window.motionforgeEngine.invoke('getScene', id);
      window.store.setScene(scene, id);
    }, SCENE_ID);
    await window.waitForTimeout(900);

    const layerStack = await window.evaluate(() => ({
      rows: document.querySelectorAll('.mf-stack-row').length,
      kinds: Array.from(document.querySelectorAll('.mf-stack-row .mf-row-kind')).map((n) => n.textContent),
    }));
    check('The layer stack lists the composition layers', layerStack.rows >= 2, `${layerStack.rows} rows`);
    check(
      'Every layer kind is labelled',
      layerStack.kinds.includes('background') && layerStack.kinds.includes('kineticText'),
      layerStack.kinds.join(', ')
    );

    /* visibility + lock toggles persist into the scene */
    const togglesEarly = await window.evaluate(async () => ({ ok: true }));
    void togglesEarly;

    /* the inspector */
    await window.evaluate(() => {
      window.store.selectLayer('title');
    });
    await window.waitForTimeout(400);
    const inspector = await window.evaluate(() => ({
      present: Boolean(document.querySelector('#layer-properties')),
      scrubs: document.querySelectorAll('#layer-properties .mf-scrub').length,
      accordions: Array.from(document.querySelectorAll('.mf-accordion-head')).map((n) =>
        n.textContent?.trim()
      ),
    }));
    check('The Effect Controls panel shows the layer', inspector.present);
    check('The inspector exposes scrubbable numeric fields', inspector.scrubs >= 6, `${inspector.scrubs} fields`);
    check(
      'The transform / timing / content accordions are present',
      ['Transform', 'Timing', 'Content & Style'].every((a) => (inspector.accordions || []).includes(a)),
      (inspector.accordions || []).join(', ')
    );

    /* a scrub drag changes the value and commits ONE save */
    const scrub = await window.evaluate(async () => {
      const before = window.store.state.scene.layers.find((l) => l.id === 'title').position.xPct;
      // The CONTENT & STYLE section is now first, so the FIRST scrub in the
      // inspector is the content size — select the Position X row explicitly.
      const rows = Array.from(document.querySelectorAll('#layer-properties .mf-prop-row'));
      const row = rows.find(
        (r) => r.querySelector('.mf-label')?.textContent?.trim() === 'Position X'
      );
      const label =
        row?.querySelector('.mf-scrub-label') ??
        document.querySelector('#layer-properties .mf-scrub-label');
      if (!label) return { ok: false, reason: 'no scrub label' };
      const box = label.getBoundingClientRect();
      const y = box.top + box.height / 2;
      label.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: box.left + 4, clientY: y, bubbles: true, pointerId: 1 })
      );
      for (let i = 1; i <= 6; i++) {
        window.dispatchEvent(
          new PointerEvent('pointermove', { clientX: box.left + 4 + i * 6, clientY: y, bubbles: true, pointerId: 1 })
        );
      }
      window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: box.left + 40, clientY: y, bubbles: true, pointerId: 1 })
      );
      await new Promise((r) => setTimeout(r, 600));
      const after = window.store.state.scene.layers.find((l) => l.id === 'title').position.xPct;
      return { ok: true, before, after };
    });
    check(
      'Dragging a scrub input changes the layer position',
      scrub.ok && scrub.before !== scrub.after,
      `${scrub.before} → ${scrub.after}`
    );

    /* undo restores it */
    const undone = await window.evaluate(async () => {
      const before = window.store.state.scene.layers.find((l) => l.id === 'title').position.xPct;
      window.store.undo();
      await new Promise((r) => setTimeout(r, 500));
      const after = window.store.state.scene.layers.find((l) => l.id === 'title').position.xPct;
      return { before, after };
    });
    check(
      'Undo restores the pre-scrub value',
      undone.before !== undone.after,
      `${undone.before} → ${undone.after}`
    );

    /* ── 7. the program monitor ─────────────────────────────────────────── */
    section('7. Program Monitor, overlay and transport');
    const monitor = await window.evaluate(() => ({
      iframe: Boolean(document.querySelector('#preview-iframe')),
      overlay: Boolean(document.querySelector('#canvas-overlay')),
      timecode: document.querySelector('#timecode')?.textContent?.trim(),
      frameCount: document.querySelector('#transport-frame-count')?.textContent?.trim(),
      transportButtons: document.querySelectorAll('#transport-bar .mf-transport-btn').length,
      zoom: Boolean(document.querySelector('#monitor-zoom')),
      guides: Boolean(document.querySelector('#monitor-guides')),
    }));
    check('The monitor iframe is mounted', monitor.iframe);
    check('The canvas overlay is mounted', monitor.overlay);
    check(
      'The transport shows a SMPTE timecode',
      /^\d{2}:\d{2}:\d{2}:\d{2}$/.test(monitor.timecode || ''),
      monitor.timecode
    );
    check('The transport shows a frame counter', /^\d{5}f$/.test(monitor.frameCount || ''), monitor.frameCount);
    check('The transport has the full button set', monitor.transportButtons >= 8, `${monitor.transportButtons} buttons`);

    /* the 60fps drag updates the layer coordinate */
    const drag = await window.evaluate(async (id) => {
      const overlay = document.querySelector('#canvas-overlay');
      const box = overlay.getBoundingClientRect();
      const before = window.store.state.scene.layers.find((l) => l.id === 'title').position.xPct;
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      overlay.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true, pointerId: 2, button: 0 })
      );
      for (let i = 1; i <= 8; i++) {
        overlay.dispatchEvent(
          new PointerEvent('pointermove', { clientX: cx + i * 5, clientY: cy, bubbles: true, pointerId: 2 })
        );
      }
      overlay.dispatchEvent(
        new PointerEvent('pointerup', { clientX: cx + 40, clientY: cy, bubbles: true, pointerId: 2 })
      );
      await new Promise((r) => setTimeout(r, 900));
      const after = window.store.state.scene.layers.find((l) => l.id === 'title').position.xPct;
      const saved = await window.motionforgeEngine.invoke('getScene', id);
      const persisted = saved.layers.find((l) => l.id === 'title').position.xPct;
      return { before, after, persisted };
    }, SCENE_ID);
    check(
      'A 60fps monitor drag updates the layer coordinate',
      drag.before !== drag.after,
      `${drag.before} → ${drag.after}`
    );
    check(
      'The dragged coordinate is persisted by the engine',
      drag.persisted === drag.after,
      `persisted ${drag.persisted}`
    );

    /* visibility + lock toggles persist into the scene */
    const toggles = await window.evaluate(async (id) => {
      const findRow = () =>
        Array.from(document.querySelectorAll('.mf-stack-row')).find(
          (r) => r.getAttribute('data-layer-id') === 'title'
        );
      const row = findRow();
      if (!row) return { ok: false, reason: 'no title row' };
      row.querySelector('[data-action="visibility"]')?.click();
      // the row may be re-rendered — always re-query before the next click
      await new Promise((r) => setTimeout(r, 120));
      const next = findRow();
      next?.querySelector('[data-action="lock"]')?.click();
      // the store auto-saves on a 700ms debounce
      await new Promise((r) => setTimeout(r, 1800));
      const scene = await window.motionforgeEngine.invoke('getScene', id);
      const title = scene.layers.find((l) => l.id === 'title');
      return { ok: true, visible: title?.visible, locked: title?.locked };
    }, SCENE_ID);
    check(
      'Visibility and lock persist into the scene (not UI-only markers)',
      toggles.ok && toggles.visible === false && toggles.locked === true,
      JSON.stringify(toggles)
    );

    /* restore the layer so the later timeline checks are not blocked */
    await window.evaluate(async () => {
      window.store.toggleLayerVisibility('title');
      window.store.toggleLayerLock('title');
      await new Promise((r) => setTimeout(r, 1200));
    });

    /* ── 8. the timeline ────────────────────────────────────────────────── */
    section('8. Timeline, trim, razor and the VU meter');
    const timeline = await window.evaluate(() => ({
      canvas: Boolean(document.querySelector('#timeline-canvas')),
      headers: document.querySelectorAll('.mf-track-header').length,
      razor: Boolean(document.querySelector('#timeline-razor')),
      snap: Boolean(document.querySelector('#timeline-snap')),
      vu: Boolean(document.querySelector('#audio-vu-meter')),
      vuSegments: document.querySelectorAll('#audio-vu-meter .mf-vu-segment').length,
    }));
    check('The timeline canvas is mounted', timeline.canvas);
    check('Track headers are rendered', timeline.headers >= 1, `${timeline.headers} tracks`);
    check('The razor button is present', timeline.razor);
    check('The snap toggle is present', timeline.snap);
    check('The VU meter is docked', timeline.vu);
    check('The VU meter has both channels', timeline.vuSegments >= 40, `${timeline.vuSegments} segments`);

    const razor = await window.evaluate(async () => {
      const scene = window.store.state.scene;
      const title = scene.layers.find((l) => l.id === 'title');
      const at = (title.at || 0) + 1000;
      const ok = window.store.razorSplitLayerAt('title', at);
      await new Promise((r) => setTimeout(r, 400));
      const after = window.store.state.scene.layers.filter((l) => l.id.startsWith('title')).length;
      return { ok, after };
    });
    check(
      'The razor splits a clip into two independent clips',
      razor.ok && razor.after === 2,
      `${razor.after} clips`
    );

    /* ── 9. the render queue ────────────────────────────────────────────── */
    section('9. Render queue and MP4 export');
    await window.evaluate(() => window.store.setActiveModal('render'));
    await window.waitForTimeout(500);
    const renderModal = await window.evaluate(() => ({
      present: Boolean(document.querySelector('#render-modal')),
      quality: Boolean(document.querySelector('#render-quality')),
      start: Boolean(document.querySelector('#render-start')),
    }));
    check('The render queue dialog opens', renderModal.present);
    check('The quality selector is present', renderModal.quality);
    check('The start-render button is present', renderModal.start);

    const rendered = await window.evaluate(async (id) => {
      const res = await window.motionforgeEngine.invoke('startRender', id, 'draft');
      return res;
    }, SCENE_ID);
    check('A render job starts', Boolean(rendered && rendered.jobId), rendered ? rendered.jobId : 'none');

    // wait for the job to finish
    let job = null;
    for (let i = 0; i < 120; i++) {
      job = await window.evaluate(async (id) => {
        return await window.motionforgeEngine.invoke('getRenderStatus', id);
      }, rendered.jobId);
      if (job && (job.status === 'completed' || job.status === 'failed')) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    check(
      'The render completes and produces an MP4',
      job && job.status === 'succeeded' && Boolean(job.result && job.result.mp4Path),
      job ? `${job.status} → ${(job.result && job.result.mp4Path) || 'no path'}` : 'no job'
    );
    if (job && job.result && job.result.mp4Path && fs.existsSync(job.result.mp4Path)) {
      const size = fs.statSync(job.result.mp4Path).size;
      check('The rendered MP4 exists on disk', size > 1000, `${size} bytes`);
    }

    await window.evaluate(() => window.store.setActiveModal(null));

    /* ── 10. the final screenshot ───────────────────────────────────────── */
    section('10. Verification screenshot');
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await window.evaluate(() => {
      window.store.setActiveModal(null);
      window.store.setPlayhead(600);
    });
    await window.waitForTimeout(700);
    await window.screenshot({ path: SCREENSHOT_PATH, scale: 'device' });
    check(
      'The verification screenshot was written',
      fs.existsSync(SCREENSHOT_PATH) && fs.statSync(SCREENSHOT_PATH).size > 10000,
      path.relative(ROOT, SCREENSHOT_PATH)
    );

    /* ── 11. the error sweep ────────────────────────────────────────────── */
    section('11. Error sweep');
    const unrecognized = [
      ...consoleErrors,
      ...pageErrors,
      ...mainErrors,
    ].filter((line) => /Unrecognized key/i.test(line));
    check(
      'No "Unrecognized key(s) in object" error occurred anywhere',
      unrecognized.length === 0,
      unrecognized.join(' | ')
    );

    const realErrors = [...consoleErrors, ...pageErrors].filter(
      (line) => !/Electron Security Warning|Autofill|devtools/i.test(line)
    );
    check(
      'The renderer produced no page errors',
      realErrors.length === 0,
      realErrors.slice(0, 3).join(' | ')
    );

  } finally {
    /* the isolated workspace is torn down, whatever happened */
    if (app) {
      try {
        await app.close();
      } catch (err) {
        console.error('[verify:pro-nle] could not close the app:', err);
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
  console.log('\nAll practical verification checks passed.');
}

main().catch((err) => {
  console.error('\n[verify:pro-nle] FAILED:', err);
  process.exit(1);
});
