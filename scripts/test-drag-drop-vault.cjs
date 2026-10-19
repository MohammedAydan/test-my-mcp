const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

async function testDragDropVault() {
  console.log('=== DA-004: ASSET VAULT DRAG-AND-DROP VERIFICATION ===\n');

  // 1. Launch Electron desktop shell
  console.log('1. Launching Electron desktop shell...');
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
  window.on('pageerror', (err) => console.log('PAGE ERROR:', err.message, err.stack));
  await window.waitForTimeout(2000);

  // 2. Dismiss onboarding tour & reset workspace layout
  console.log('2. Dismissing onboarding tour backdrop & resetting workspace layout...');
  await window.evaluate(() => {
    localStorage.setItem('motionforge_tour_seen', 'true');
    const tour = document.querySelector('.mf-tour-backdrop');
    if (tour) tour.remove();
    window.store?.resetWorkspaceLayout();
  });
  await window.waitForTimeout(500);

  // 3. Seed test scene in engine and store
  console.log('3. Seeding test scene with image asset into engine and store...');
  const testScene = {
    schemaVersion: 1,
    id: 'test-vault-drag-drop',
    name: 'Vault Drag and Drop Verification',
    durationMs: 8000,
    canvas: { shape: '16:9', scale: 1080 },
    assets: [
      {
        id: 'brand-logo',
        kind: 'image',
        name: 'Brand Amber Emblem',
        src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiB2aWV3Qm94PSIwIDAgMTAwIDEwMCI+PGNpcmNsZSBjeD0iNTAiIGN5PSI1MCIgcj0iNDAiIGZpbGw9IiNmNTllMGIiLz48L3N2Zz4=',
      },
    ],
    layers: [
      {
        id: 'bg-1',
        name: 'Background Solid',
        type: 'background',
        at: 0,
        duration: 8000,
        variant: { variant: 'solid', color: '#09090b' },
      },
    ],
    audio: {
      cues: [],
    },
  };

  const seedRes = await fetch('http://127.0.0.1:4000/api/scenes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testScene),
  });
  if (!seedRes.ok) {
    throw new Error(`Failed to seed test scene: ${await seedRes.text()}`);
  }

  await window.evaluate((scene) => {
    window.store.setScene(scene, 'test-vault-drag-drop');
    window.store.setZoom(1);
    window.store.setPanOffset(0);
    window.store.setTimelineScrollY(0);
    window.store.setActiveLeftTab('assets');
  }, testScene);
  await window.waitForTimeout(1000);

  // 4. Verify Asset Vault UI in Left Panel
  console.log('4. Verifying Asset Vault in Left Panel...');
  const vaultItem = window.locator('[data-asset-id="brand-logo"]');
  await vaultItem.waitFor({ state: 'visible', timeout: 5000 });

  const isDraggable = await vaultItem.getAttribute('draggable');
  console.log('   Brand logo card draggable attribute:', isDraggable);
  if (isDraggable !== 'true') {
    throw new Error('Expected asset card to have draggable="true"');
  }

  // Also verify built-in SFX Bank
  const sfxItem = window.locator('[data-asset-id="whoosh"]');
  await sfxItem.waitFor({ state: 'visible', timeout: 5000 });
  console.log('   Built-in SFX bank item "whoosh" found and visible');

  // 5. Test Drag & Drop from Vault to Canvas Monitor at (60%, 40%)
  console.log('5. Testing drag and drop from Asset Vault onto Canvas Monitor at (60%, 40%)...');
  const overlay = window.locator('#canvas-overlay-container');
  await overlay.waitFor({ state: 'visible', timeout: 5000 });
  const overlayBox = await overlay.boundingBox();
  if (!overlayBox) throw new Error('Could not find canvas overlay bounding box');

  // In 16:9 canvas centered in container, calculate client (X, Y) corresponding to canvas 60% X and 40% Y
  const dropCoords = await window.evaluate(() => {
    const el = document.getElementById('canvas-overlay-container');
    const rect = el.getBoundingClientRect();
    // In CanvasOverlay: canvas is 1920x1080. Fit scale is Math.min((cWidth-40)/1920, (cHeight-40)/1080)
    const fitScale = Math.min((rect.width - 40) / 1920, (rect.height - 40) / 1080);
    const stageW = 1920 * fitScale;
    const stageH = 1080 * fitScale;
    const stageX = rect.left + rect.width / 2 - stageW / 2;
    const stageY = rect.top + rect.height / 2 - stageH / 2;
    return {
      clientX: stageX + stageW * 0.6,
      clientY: stageY + stageH * 0.4,
    };
  });
  console.log('   Target Canvas drop coordinates:', dropCoords);

  // Simulate HTML5 drag-and-drop onto Canvas
  await window.evaluate(
    ({ clientX, clientY }) => {
      const target = document.getElementById('canvas-overlay-container');
      const payload = {
        assetId: 'brand-logo',
        kind: 'image',
        name: 'Brand Amber Emblem',
        src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiB2aWV3Qm94PSIwIDAgMTAwIDEwMCI+PGNpcmNsZSBjeD0iNTAiIGN5PSI1MCIgcj0iNDAiIGZpbGw9IiNmNTllMGIiLz48L3N2Zz4=',
      };

      const dataTransfer = new DataTransfer();
      dataTransfer.setData('application/json', JSON.stringify(payload));
      dataTransfer.setData('text/plain', 'brand-logo');

      const dragOverEvt = new DragEvent('dragover', {
        clientX,
        clientY,
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      target.dispatchEvent(dragOverEvt);

      const dropEvt = new DragEvent('drop', {
        clientX,
        clientY,
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      target.dispatchEvent(dropEvt);
    },
    dropCoords
  );
  await window.waitForTimeout(1000);

  // Verify layer was added to scene
  const postCanvasLayers = await window.evaluate(() => {
    return window.store.state.scene.layers.map((l) => ({
      id: l.id,
      type: l.type,
      assetId: l.assetId,
      position: l.position,
    }));
  });
  console.log('   Post-canvas-drop layers:', postCanvasLayers);

  const droppedImageLayer = postCanvasLayers.find((l) => l.type === 'imageLogo' && l.assetId === 'brand-logo');
  if (!droppedImageLayer) {
    throw new Error('Image layer was not created from canvas drop!');
  }
  console.log('   Dropped Image Layer:', droppedImageLayer);

  // Verify position is near (60%, 40%)
  if (Math.abs(droppedImageLayer.position.xPct - 60) > 3 || Math.abs(droppedImageLayer.position.yPct - 40) > 3) {
    throw new Error(
      `Layer position mismatch: expected ~(60%, 40%), got (${droppedImageLayer.position.xPct}%, ${droppedImageLayer.position.yPct}%)`
    );
  }
  console.log('   Position verification PASS: dropped at exact canvas coordinates!');

  // 6. Test Drag & Drop from Vault to Timeline at timecode ~3000ms
  console.log('\n6. Testing drag and drop from SFX Bank onto Timeline at ~3000ms...');
  const timelineCanvas = window.locator('#timeline-canvas');
  await timelineCanvas.waitFor({ state: 'visible', timeout: 5000 });
  const timelineBox = await timelineCanvas.boundingBox();
  if (!timelineBox) throw new Error('Could not find timeline canvas bounding box');

  // Total duration is 8000ms, zoom=1, pan=0. timeToX(3000) = timelineBox.x + (3000 / 8000) * timelineBox.width
  const timelineDropCoords = {
    clientX: timelineBox.x + (3000 / 8000) * timelineBox.width,
    clientY: timelineBox.y + 40,
  };
  console.log('   Timeline drop coordinates:', timelineDropCoords);

  await window.evaluate(
    ({ clientX, clientY }) => {
      const target = document.getElementById('timeline-canvas-container');
      const payload = {
        assetId: 'whoosh',
        kind: 'audio',
        name: 'SFX: whoosh',
      };

      const dataTransfer = new DataTransfer();
      dataTransfer.setData('application/json', JSON.stringify(payload));
      dataTransfer.setData('text/plain', 'whoosh');

      const dragOverEvt = new DragEvent('dragover', {
        clientX,
        clientY,
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      target.dispatchEvent(dragOverEvt);

      const dropEvt = new DragEvent('drop', {
        clientX,
        clientY,
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      target.dispatchEvent(dropEvt);
    },
    timelineDropCoords
  );
  await window.waitForTimeout(1000);

  // Verify audio cue was added to scene.audio.cues at ~3000ms
  const postTimelineAudio = await window.evaluate(() => {
    return window.store.state.scene.audio;
  });
  console.log('   Post-timeline-drop audio:', postTimelineAudio);

  const droppedCue = postTimelineAudio?.cues?.find((c) => c.sfx === 'whoosh');
  if (!droppedCue) {
    throw new Error('Audio cue "whoosh" was not created from timeline drop!');
  }
  console.log('   Dropped Audio Cue:', droppedCue);

  if (Math.abs(droppedCue.at - 3000) > 100) {
    throw new Error(`Audio cue time mismatch: expected ~3000ms, got ${droppedCue.at}ms`);
  }
  console.log('   Timestamp verification PASS: audio cue scheduled at exact timecode!');

  // 7. Verify auto-save to engine
  const saveStatus = await window.evaluate(() => window.store.state.saveStatus);
  console.log('   Save status after drops:', saveStatus);
  if (saveStatus !== 'saved' && saveStatus !== 'saving') {
    throw new Error(`Expected save status 'saved', got: ${saveStatus}`);
  }

  // 8. Capture verification screenshot
  const screenshotPath = path.resolve(__dirname, '../screenshots/drag-drop-vault.png');
  await window.screenshot({ path: screenshotPath });
  console.log('   Saved screenshots/drag-drop-vault.png at:', screenshotPath);

  await app.close();
  console.log('\n=== DA-004: ALL VERIFICATIONS PASSED ===');
}

testDragDropVault().catch((err) => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
