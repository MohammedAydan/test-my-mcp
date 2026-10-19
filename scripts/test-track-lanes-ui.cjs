const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

async function testTrackLanesUI() {
  console.log('=== DA-005: MULTI-CLIP TRACK LANES & COLLISION VERIFICATION ===\n');

  // 1. Launch Electron desktop shell
  console.log('1. Launching Electron desktop shell...');
  const app = await electron.launch({
    args: ['--no-sandbox', path.resolve(__dirname, '../packages/desktop/out/main/index.js')],
    env: {
      ...process.env,
      MOTIONFORGE_TEST_MODE: '1',
    },
  });

  const window = await app.firstWindow();
  window.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
  window.on('pageerror', (err) => console.log('PAGE ERROR:', err.message, err.stack));
  await window.waitForTimeout(2000);

  // 2. Dismiss onboarding tour & reset workspace layout to default uncollapsed baseline
  console.log('2. Dismissing onboarding tour backdrop & resetting workspace layout...');
  await window.evaluate(() => {
    localStorage.setItem('motionforge_tour_seen', 'true');
    const tour = document.querySelector('.mf-tour-backdrop');
    if (tour) tour.remove();
    window.store?.resetWorkspaceLayout();
  });
  await window.waitForTimeout(500);

  // 3. Seed scene directly in core-engine first, then load into Studio store
  console.log('3. Seeding multi-clip test scene into engine and store...');
  const testScene = {
    schemaVersion: 1,
    id: 'test-multiclip-scene',
    name: 'Multi-Clip Track Lanes Verification',
    durationMs: 10000,
    canvas: { shape: '16:9', scale: 1080 },
    trackLanes: [
      { id: 'track-video-1', name: 'Video Track 1', kind: 'video' },
      { id: 'track-bg-1', name: 'Background Track', kind: 'video' },
    ],
    layers: [
      {
        id: 'clip-0-1',
        name: 'Hero Intro',
        type: 'kineticText',
        at: 0,
        duration: 3000,
        trackIndex: 0,
        text: 'MotionForge',
        sizePx: 90,
        position: { xPct: 50, yPct: 50 },
        fill: '#ffffff',
        animateBy: 'word',
        entrance: { name: 'springPop' },
      },
      {
        id: 'clip-0-2',
        name: 'Feature Callout',
        type: 'card',
        at: 3500,
        duration: 3000,
        trackIndex: 0,
        position: { xPct: 50, yPct: 50 },
        variant: { variant: 'glassCard', title: 'Feature Callout', body: 'Studio multi-clip track lane' },
      },
      {
        id: 'clip-1-1',
        name: 'Base Background',
        type: 'background',
        at: 0,
        duration: 8000,
        trackIndex: 1,
        variant: { variant: 'solid', color: '#09090b' },
      },
      {
        id: 'clip-legacy',
        name: 'Legacy Watermark',
        type: 'card',
        at: 1000,
        duration: 4000,
        position: { xPct: 90, yPct: 90 },
        variant: { variant: 'glassCard', title: 'Legacy Watermark', body: 'Auto-allocated track' },
      },
    ],
  };

  await window.evaluate(async (scene) => {
    if (window.motionforgeEngine) {
      await window.motionforgeEngine.invoke('saveScene', scene);
    }
    window.store.setScene(scene, 'test-multiclip-scene');
    window.store.setZoom(1);
    window.store.setPanOffset(0);
    window.store.setTimelineScrollY(0);
  }, testScene);
  await window.waitForTimeout(1000);

  // 4. Verify Track headers render T1, T2, T3 badges and multi-clip count
  console.log('4. Verifying left track headers panel...');
  const trackHeaders = await window.evaluate(() => {
    const container = document.getElementById('timeline-tracks-scroll');
    if (!container) return [];
    const rows = container.querySelectorAll('[data-track-index]');
    return Array.from(rows).map((r) => {
      const trackIdx = r.getAttribute('data-track-index');
      const badge = r.querySelector('.font-mono')?.textContent?.trim();
      const text = r.querySelector('.truncate')?.textContent?.trim();
      const rect = r.getBoundingClientRect();
      return { trackIdx, badge, text, y: rect.y, h: rect.height };
    });
  });

  console.log('   Track Headers:', trackHeaders);
  if (trackHeaders.length !== 3) {
    throw new Error(`Expected exactly 3 track headers (T1, T2, T3), found ${trackHeaders.length}`);
  }
  if (trackHeaders[0].badge !== 'T1' || !trackHeaders[0].text.includes('2 clips')) {
    throw new Error(`Track 1 header should show badge T1 and mention 2 clips, got: ${JSON.stringify(trackHeaders[0])}`);
  }
  if (trackHeaders[1].badge !== 'T2') {
    throw new Error(`Track 2 header should show badge T2, got: ${trackHeaders[1].badge}`);
  }
  if (trackHeaders[2].badge !== 'T3') {
    throw new Error(`Track 3 (auto-allocated legacy) should show badge T3, got: ${trackHeaders[2].badge}`);
  }

  // 5. Test Canvas Hit & Collision Clamping on Drag
  console.log('5. Testing canvas interaction & collision clamping...');
  const canvas = window.locator('#timeline-canvas');
  await canvas.waitFor({ state: 'visible', timeout: 5000 });
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Could not find timeline canvas bounding box');

  // Let's inspect the layout calculated on the timeline canvas
  const canvasLayout = await window.evaluate(() => {
    const s = window.store.state;
    const layers = s.scene.layers;
    return layers.map((l) => ({
      id: l.id,
      trackIndex: l.trackIndex,
      at: l.at,
      duration: l.duration,
    }));
  });
  console.log('   Initial Canvas Layers:', canvasLayout);

  // Inspect layout and clip positions on canvas
  const debugInfo = await window.evaluate(() => {
    const canvas = document.getElementById('timeline-canvas');
    const rect = canvas.getBoundingClientRect();
    const w = canvas.clientWidth;
    const s = window.store.state;
    const dur = s.scene.durationMs;
    const pxPerMs = (w * s.zoom) / dur;
    return {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      w,
      dur,
      zoom: s.zoom,
      pan: s.panOffset,
      scrollY: s.timelineScrollY,
      clip01: { x1: 0 * pxPerMs, x2: 3000 * pxPerMs },
      clip02: { x1: 3500 * pxPerMs, x2: 6500 * pxPerMs },
    };
  });
  console.log('   Debug Info:', debugInfo);

  // In canvas local coordinates:
  // track 0 row: y is between 28 and 56 (RULER_H=24 + 4 = 28, height = 28).
  // Midpoint is 28 + 14 = 42.
  // In client viewport coordinates:
  const clientY = debugInfo.rect.y + 42;
  const clip02ClientX = debugInfo.rect.x + (debugInfo.clip02.x1 + debugInfo.clip02.x2) / 2;
  const targetClientX = debugInfo.rect.x + debugInfo.clip02.x1 - 1000 * (debugInfo.w / debugInfo.dur); // drag left towards clip 1

  const elemAtPoint = await window.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el ? { tagName: el.tagName, id: el.id, className: el.className } : null;
  }, { x: clip02ClientX, y: clientY });
  console.log('   Element at click point:', elemAtPoint);

  console.log(`   Dispatching mousedown on clip-0-2 at (${clip02ClientX.toFixed(1)}, ${clientY.toFixed(1)})...`);
  const dispatchRes = await window.evaluate(({ clientX, clientY }) => {
    const canvas = document.getElementById('timeline-canvas');
    const evt = new MouseEvent('mousedown', {
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    canvas.dispatchEvent(evt);
    return window.store.state.selectedLayerId;
  }, { clientX: clip02ClientX, clientY });
  console.log('   Selected layer after dispatchEvent mousedown:', dispatchRes);

  await window.mouse.move(targetClientX, clientY, { steps: 10 });
  await window.waitForTimeout(100);
  await window.mouse.up();
  await window.waitForTimeout(500);

  const postDragLayers = await window.evaluate(() => {
    const s = window.store.state;
    return s.scene.layers.map((l) => ({ id: l.id, at: l.at, duration: l.duration }));
  });
  console.log('   Post-drag layers:', postDragLayers);

  const draggedClip = postDragLayers.find((l) => l.id === 'clip-0-2');
  if (!draggedClip) throw new Error('clip-0-2 not found');

  if (draggedClip.at < 3000) {
    throw new Error(
      `COLLISION VIOLATION: clip-0-2 was dragged to ${draggedClip.at}ms, overlapping clip-0-1 (ends at 3000ms)!`
    );
  }
  if (draggedClip.at !== 3000) {
    throw new Error(
      `Expected clip-0-2 to be clamped exactly at 3000ms (touching clip-0-1), but got ${draggedClip.at}ms`
    );
  }
  console.log('   Collision prevention PASS: clip-0-2 was clamped precisely at boundary 3000ms!');

  // 6. Verify save was triggered on mouse up
  const saveStatus = await window.evaluate(() => window.store.state.saveStatus);
  console.log('   Save status after timeline drag:', saveStatus);
  if (saveStatus !== 'saved' && saveStatus !== 'saving') {
    throw new Error(`Expected saveStatus to be 'saved' or 'saving', got: ${saveStatus}`);
  }

  // 7. Capture screenshot for verification evidence
  const screenshotPath = path.resolve(__dirname, '../screenshots/track-lanes-multiclip.png');
  await window.screenshot({ path: screenshotPath });
  console.log('   Saved screenshots/track-lanes-multiclip.png at:', screenshotPath);

  await app.close();
  console.log('\n=== DA-005: ALL VERIFICATIONS PASSED ===');
}

testTrackLanesUI().catch((err) => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
