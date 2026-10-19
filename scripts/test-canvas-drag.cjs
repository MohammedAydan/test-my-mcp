const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

async function testCanvasDrag() {
  console.log('=== DA-001: CANVAS DIRECT MANIPULATION & ENGINE SAVE VERIFICATION ===\n');

  // 1. Seed a test scene in core-engine
  console.log('1. Seeding test scene into core-engine on :4000...');
  const scenePayload = {
    schemaVersion: 1,
    id: 'test-drag-scene',
    name: 'Canvas Drag Test Scene',
    durationMs: 6000,
    canvas: { shape: '16:9', scale: 1080 },
    layers: [
      {
        id: 'box-card',
        name: 'Interactive Box Card',
        type: 'card',
        at: 0,
        duration: 6000,
        variant: {
          variant: 'glassCard',
          title: 'Interactive Box Card',
          body: 'Test content for direct manipulation',
          widthPx: 400,
        },
        position: { xPct: 50, yPct: 50 },
      },
    ],
  };

  const seedRes = await fetch('http://127.0.0.1:4000/api/scenes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scenePayload),
  });

  if (!seedRes.ok) {
    const errText = await seedRes.text();
    throw new Error(`Failed to seed test scene in engine: ${errText}`);
  }
  console.log('   Test scene seeded successfully in engine.');

  // 2. Launch Electron desktop shell
  console.log('2. Launching Electron desktop shell...');
  const app = await electron.launch({
    args: ['--no-sandbox', path.resolve(__dirname, '../packages/desktop/out/main/index.js')],
    env: {
      ...process.env,
      MOTIONFORGE_ENGINE_URL: 'http://127.0.0.1:4000',
      MOTIONFORGE_TEST_MODE: '1',
    },
  });

  const window = await app.firstWindow();
  window.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
  await window.waitForTimeout(2000);

  // 3. Dismiss tour & load test scene
  console.log('3. Loading test scene into Studio...');
  await window.evaluate((sc) => {
    localStorage.setItem('motionforge_tour_seen', 'true');
    const tour = document.querySelector('.mf-tour-backdrop');
    if (tour) tour.remove();
    window.store.setScene(sc, sc.id);
  }, scenePayload);
  await window.waitForTimeout(1500);

  // 4. Wait for preview iframe and locate target DOM elements
  console.log('4. Waiting for preview iframe DOM node to mount...');
  const frame = window.frameLocator('#preview-iframe');
  const layerInIframe = frame.locator('.mf-layer[data-layer-id="box-card"] .mf-exit > *');
  await layerInIframe.waitFor({ state: 'visible', timeout: 6000 });

  // Select the layer
  await window.evaluate(() => window.store.selectLayer('box-card'));
  await window.waitForTimeout(500);

  const boxWireframe = window.locator('#selection-bounding-box');
  await boxWireframe.waitFor({ state: 'visible', timeout: 3000 });

  // 5. Record initial positions
  const initialWireframeRect = await boxWireframe.boundingBox();
  const initialIframeRect = await layerInIframe.boundingBox();
  if (!initialWireframeRect || !initialIframeRect) {
    throw new Error('Could not read initial bounding boxes of wireframe or iframe node');
  }

  console.log('   Initial SVG wireframe box:', initialWireframeRect);
  console.log('   Initial Iframe DOM node box:', initialIframeRect);

  // 6. Perform drag: move by +120px X and +80px Y
  console.log('5. Dragging layer by +120px X and +80px Y...');
  const startX = initialWireframeRect.x + initialWireframeRect.width / 2;
  const startY = initialWireframeRect.y + initialWireframeRect.height / 2;

  await window.mouse.move(startX, startY);
  await window.mouse.down();
  await window.mouse.move(startX + 60, startY + 40, { steps: 5 });
  await window.mouse.move(startX + 120, startY + 80, { steps: 5 });
  await window.waitForTimeout(200);

  // Check real-time transform during drag
  const midDragIframeRect = await layerInIframe.boundingBox();
  const midDragWireframeRect = await boxWireframe.boundingBox();
  console.log('   Mid-drag SVG wireframe box:', midDragWireframeRect);
  console.log('   Mid-drag Iframe DOM node box:', midDragIframeRect);

  await window.mouse.up();
  await window.waitForTimeout(800);

  // 7. Verify both SVG wireframe and iframe DOM node shifted by ~120px / 80px
  const movedWireframeRect = await boxWireframe.boundingBox();
  const movedIframeRect = await layerInIframe.boundingBox();

  const wireframeShiftX = movedWireframeRect.x - initialWireframeRect.x;
  const wireframeShiftY = movedWireframeRect.y - initialWireframeRect.y;
  const iframeShiftX = movedIframeRect.x - initialIframeRect.x;
  const iframeShiftY = movedIframeRect.y - initialIframeRect.y;

  console.log(`6. Shifts detected:`);
  console.log(`   Wireframe: dx=${wireframeShiftX.toFixed(1)}px, dy=${wireframeShiftY.toFixed(1)}px`);
  console.log(`   Iframe DOM: dx=${iframeShiftX.toFixed(1)}px, dy=${iframeShiftY.toFixed(1)}px`);

  if (Math.abs(wireframeShiftX - 120) > 15) {
    throw new Error(`Wireframe X shift was ${wireframeShiftX}, expected ~120px`);
  }
  if (Math.abs(iframeShiftX - 120) > 25) {
    throw new Error(`Iframe DOM X shift was ${iframeShiftX}, expected ~120px`);
  }

  // Verify save status
  const saveStatus = await window.evaluate(() => window.state?.saveStatus);
  console.log('7. Save status after pointer up:', saveStatus);
  if (saveStatus !== 'saved') {
    throw new Error(`Expected saveStatus to be 'saved', got '${saveStatus}'`);
  }

  // Capture move screenshot
  const moveScreenshotPath = path.resolve(__dirname, '../screenshots/canvas-drag-move.png');
  await window.screenshot({ path: moveScreenshotPath });
  console.log('8. Saved canvas-drag-move.png at:', moveScreenshotPath);

  // 8. Test Undo (Ctrl+Z)
  console.log('9. Triggering Undo via Control+z...');
  await window.keyboard.press('Control+z');
  await window.waitForTimeout(1000);

  const undoneWireframeRect = await boxWireframe.boundingBox();
  const undoneIframeRect = await layerInIframe.boundingBox();
  const undonePosition = await window.evaluate(() => window.state?.scene?.layers?.[0]?.position);

  console.log('10. After Undo:');
  console.log('    Wireframe box:', undoneWireframeRect);
  console.log('    Iframe DOM box:', undoneIframeRect);
  console.log('    Position in store:', undonePosition);

  // Assert wireframe and iframe DOM node returned to exact initial coordinates
  const wireframeRevertErrorX = Math.abs(undoneWireframeRect.x - initialWireframeRect.x);
  const wireframeRevertErrorY = Math.abs(undoneWireframeRect.y - initialWireframeRect.y);
  const iframeRevertErrorX = Math.abs(undoneIframeRect.x - initialIframeRect.x);
  const iframeRevertErrorY = Math.abs(undoneIframeRect.y - initialIframeRect.y);

  console.log(`    Revert diff wireframe: dx=${wireframeRevertErrorX.toFixed(1)}px, dy=${wireframeRevertErrorY.toFixed(1)}px`);
  console.log(`    Revert diff iframe: dx=${iframeRevertErrorX.toFixed(1)}px, dy=${iframeRevertErrorY.toFixed(1)}px`);

  if (wireframeRevertErrorX > 2 || wireframeRevertErrorY > 2) {
    throw new Error(`Wireframe failed to revert on Undo! Started at (${initialWireframeRect.x}, ${initialWireframeRect.y}), now (${undoneWireframeRect.x}, ${undoneWireframeRect.y})`);
  }
  if (iframeRevertErrorX > 5 || iframeRevertErrorY > 5) {
    throw new Error(`Iframe DOM node failed to revert on Undo! Started at (${initialIframeRect.x}, ${initialIframeRect.y}), now (${undoneIframeRect.x}, ${undoneIframeRect.y})`);
  }
  if (undonePosition.xPct !== 50 || undonePosition.yPct !== 50) {
    throw new Error(`Store position failed to revert on Undo! Expected 50/50, got ${JSON.stringify(undonePosition)}`);
  }

  // Capture undo screenshot
  const undoScreenshotPath = path.resolve(__dirname, '../screenshots/canvas-drag-undo.png');
  await window.screenshot({ path: undoScreenshotPath });
  console.log('11. Saved canvas-drag-undo.png at:', undoScreenshotPath);

  console.log('\n=== DA-001 VERIFICATION SUCCEEDED: ALL CHECKS PASSED ===');
  await app.close();
  process.exit(0);
}

testCanvasDrag().catch(async (err) => {
  console.error('DA-001 verification failed:', err);
  process.exit(1);
});
