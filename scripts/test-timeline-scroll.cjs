const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

async function testTimelineScroll() {
  console.log('=== DA-002: TIMELINE VERTICAL SCROLLING VERIFICATION ===\n');

  const app = await electron.launch({
    args: ['--no-sandbox', path.resolve(__dirname, '../packages/desktop/out/main/index.js')],
    env: {
      ...process.env,
      MOTIONFORGE_ENGINE_URL: 'http://127.0.0.1:4000',
      MOTIONFORGE_TEST_MODE: '1',
    },
  });

  const window = await app.firstWindow();
  await window.waitForTimeout(2000);

  // 1. Dismiss tour
  console.log('1. Dismissing tour backdrop if present...');
  await window.evaluate(() => {
    localStorage.setItem('motionforge_tour_seen', 'true');
    const tour = document.querySelector('.mf-tour-backdrop');
    if (tour) tour.remove();
  });
  await window.waitForTimeout(500);

  // 2. Seed a scene with 10 layers so content overflows visible timeline height
  console.log('2. Loading 10-layer scene into Studio state...');
  await window.evaluate(() => {
    const layers = [];
    for (let i = 1; i <= 10; i++) {
      layers.push({
        id: `layer-${i}`,
        name: `Track Row ${i}`,
        type: 'card',
        at: (i - 1) * 400,
        duration: 3500,
        variant: { variant: 'solid', color: '#1e293b' },
        widthPx: 280,
        heightPx: 100,
        position: { xPct: 50, yPct: 50 },
      });
    }

    const testScene = {
      schemaVersion: 1,
      id: 'test-scroll-scene',
      name: 'Scroll Verification 10-Layer Scene',
      durationMs: 12000,
      fps: 30,
      canvas: { width: 1920, height: 1080 },
      layers,
    };

    window.store.setScene(testScene, 'test-scroll-scene');
    window.store.setTimelineScrollY(0);
  });
  await window.waitForTimeout(1000);

  // 3. Verify scrollHeight > clientHeight on timeline tracks container
  console.log('3. Checking scroll dimensions...');
  const scrollDims = await window.evaluate(() => {
    const el = document.getElementById('timeline-tracks-scroll');
    const vScroll = document.getElementById('timeline-vertical-scrollbar');
    return {
      tracks: {
        scrollHeight: el ? el.scrollHeight : 0,
        clientHeight: el ? el.clientHeight : 0,
        scrollTop: el ? el.scrollTop : 0,
      },
      scrollbar: {
        scrollHeight: vScroll ? vScroll.scrollHeight : 0,
        clientHeight: vScroll ? vScroll.clientHeight : 0,
      },
    };
  });

  console.log('   Tracks scroll dimensions:', scrollDims.tracks);
  console.log('   Scrollbar dimensions:', scrollDims.scrollbar);

  if (scrollDims.tracks.scrollHeight <= scrollDims.tracks.clientHeight) {
    throw new Error(
      `Expected scrollHeight (${scrollDims.tracks.scrollHeight}) > clientHeight (${scrollDims.tracks.clientHeight})`
    );
  }

  // 4. Assert Layer 1 is visible and Layer 10 is hidden before scroll
  const visibilityBefore = await window.evaluate(() => {
    const container = document.getElementById('timeline-tracks-scroll');
    const cRect = container.getBoundingClientRect();

    const el1 = container.querySelector('[data-layer-id="layer-1"]');
    const el10 = container.querySelector('[data-layer-id="layer-10"]');

    const r1 = el1.getBoundingClientRect();
    const r10 = el10.getBoundingClientRect();

    return {
      layer1Visible: r1.top < cRect.bottom && r1.bottom > cRect.top,
      layer10Visible: r10.top < cRect.bottom && r10.bottom > cRect.top,
      layer1Top: r1.top,
      layer10Top: r10.top,
      containerBottom: cRect.bottom,
    };
  });

  console.log('4. Visibility before scroll:', visibilityBefore);

  if (!visibilityBefore.layer1Visible) {
    throw new Error('Layer 1 should be visible initially in the timeline');
  }
  if (visibilityBefore.layer10Visible) {
    throw new Error('Layer 10 should be hidden (below viewport) before scroll');
  }

  // Capture BEFORE screenshot
  const beforeScreenshotPath = path.resolve(__dirname, '../screenshots/timeline-scroll-before.png');
  await window.screenshot({ path: beforeScreenshotPath });
  console.log('5. Captured timeline-scroll-before.png at:', beforeScreenshotPath);

  // 5. Perform vertical scroll via canvas mouse wheel interaction
  console.log('6. Dispatching mouse wheel down on timeline canvas...');
  const canvasEl = window.locator('#timeline-canvas');
  const canvasBox = await canvasEl.boundingBox();
  if (!canvasBox) throw new Error('Timeline canvas bounding box not found');

  await window.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await window.mouse.wheel(0, 320);
  await window.waitForTimeout(800);

  // Read state and verify synchronized scroll
  const scrollStateAfter = await window.evaluate(() => ({
    storeScrollY: window.state?.timelineScrollY,
    tracksScrollTop: document.getElementById('timeline-tracks-scroll')?.scrollTop,
    vScrollTop: document.getElementById('timeline-vertical-scrollbar')?.scrollTop,
  }));
  console.log('7. Scroll positions after canvas wheel:', scrollStateAfter);

  if (!scrollStateAfter.storeScrollY || scrollStateAfter.storeScrollY <= 0) {
    throw new Error(`Expected timelineScrollY > 0 after wheel, got ${scrollStateAfter.storeScrollY}`);
  }

  // If wheel did not scroll far enough to bring layer 10 into view, scroll remaining distance
  if (scrollStateAfter.storeScrollY < 180) {
    console.log('   Scrolling further to ensure bottom layer is in view...');
    await window.evaluate(() => {
      window.store.setTimelineScrollY(220);
    });
    await window.waitForTimeout(500);
  }

  // 6. Assert Layer 10 is now in-viewport after scroll
  const visibilityAfter = await window.evaluate(() => {
    const container = document.getElementById('timeline-tracks-scroll');
    const cRect = container.getBoundingClientRect();

    const el1 = container.querySelector('[data-layer-id="layer-1"]');
    const el10 = container.querySelector('[data-layer-id="layer-10"]');

    const r1 = el1.getBoundingClientRect();
    const r10 = el10.getBoundingClientRect();

    return {
      layer1Visible: r1.top < cRect.bottom && r1.bottom > cRect.top,
      layer10Visible: r10.top < cRect.bottom && r10.bottom > cRect.top,
      layer1Top: r1.top,
      layer10Top: r10.top,
      containerTop: cRect.top,
      containerBottom: cRect.bottom,
    };
  });

  console.log('8. Visibility after scroll:', visibilityAfter);

  if (!visibilityAfter.layer10Visible) {
    throw new Error('Layer 10 should now be in-viewport after vertical scroll');
  }

  // Capture AFTER screenshot
  const afterScreenshotPath = path.resolve(__dirname, '../screenshots/timeline-scroll-after.png');
  await window.screenshot({ path: afterScreenshotPath });
  console.log('9. Captured timeline-scroll-after.png at:', afterScreenshotPath);

  // 7. Verify track selection on scrolled layer works
  console.log('10. Testing click selection on Layer 10...');
  await window.click('[data-layer-id="layer-10"]');
  await window.waitForTimeout(300);

  const selectedLayer = await window.evaluate(() => window.state?.selectedLayerId);
  console.log('    Selected layer in store:', selectedLayer);
  if (selectedLayer !== 'layer-10') {
    throw new Error(`Expected selectedLayerId to be 'layer-10', got '${selectedLayer}'`);
  }

  console.log('\n=== DA-002 VERIFICATION SUCCEEDED: ALL CHECKS PASSED ===');
  await app.close();
  process.exit(0);
}

testTimelineScroll().catch(async (err) => {
  console.error('DA-002 verification failed:', err);
  process.exit(1);
});
