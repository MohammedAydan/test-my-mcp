const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

async function testUndoHistory() {
  console.log('=== DA-006: UNDO HISTORY SNAPSHOT TIMING VERIFICATION ===\n');

  // 1. Launch Electron desktop shell
  console.log('1. Launching Electron desktop shell...');
  const app = await electron.launch({
    args: [path.resolve(__dirname, '../packages/desktop/out/main/index.js')],
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
  console.log('3. Seeding test scene with kinetic text layer...');
  const testScene = {
    schemaVersion: 1,
    id: 'test-undo-history-scene',
    name: 'Undo History Verification',
    durationMs: 8000,
    canvas: { shape: '16:9', scale: 1080 },
    layers: [
      {
        id: 'bg-1',
        name: 'Background Solid',
        type: 'background',
        at: 0,
        duration: 8000,
        variant: { variant: 'solid', color: '#09090b' },
      },
      {
        id: 'title-text',
        name: 'Main Title',
        type: 'kineticText',
        text: 'HELLO MOTIONFORGE',
        sizePx: 72,
        position: { xPct: 50, yPct: 50 },
        at: 1000,
        duration: 4000,
        entrance: { name: 'smoothSlideUp' },
      },
    ],
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
    window.store.setScene(scene, 'test-undo-history-scene');
    window.store.setZoom(1);
    window.store.setPanOffset(0);
    window.store.setTimelineScrollY(0);
    window.store.selectLayer('title-text');
  }, testScene);
  await window.waitForTimeout(1000);

  // 4. Assert initial undo / redo state
  console.log('4. Checking initial Undo and Redo button state...');
  const undoBtn = window.locator('#btn-undo');
  const redoBtn = window.locator('#btn-redo');

  const initialCanUndo = await undoBtn.isDisabled();
  const initialCanRedo = await redoBtn.isDisabled();
  console.log('   #btn-undo isDisabled:', initialCanUndo);
  console.log('   #btn-redo isDisabled:', initialCanRedo);
  if (!initialCanUndo) {
    throw new Error('Expected #btn-undo to be disabled initially on clean scene load');
  }
  if (!initialCanRedo) {
    throw new Error('Expected #btn-redo to be disabled initially on clean scene load');
  }

  // 5. Test pure selection click without drag: undo should remain disabled!
  console.log('5. Clicking text layer on canvas without dragging (selection click)...');
  const boxWireframe = window.locator('#selection-bounding-box');
  await boxWireframe.waitFor({ state: 'visible', timeout: 5000 });
  const initialWireframeRect = await boxWireframe.boundingBox();
  if (!initialWireframeRect) throw new Error('Could not find #selection-bounding-box');

  const startX = initialWireframeRect.x + initialWireframeRect.width / 2;
  const startY = initialWireframeRect.y + initialWireframeRect.height / 2;

  // Pure click on the layer wireframe
  await window.mouse.click(startX, startY);
  await window.waitForTimeout(400);

  const postClickCanUndo = await undoBtn.isDisabled();
  console.log('   #btn-undo isDisabled after click-without-drag:', postClickCanUndo);
  if (!postClickCanUndo) {
    throw new Error('FAILED: Clicking without dragging pushed a spurious undo snapshot!');
  }
  console.log('   PASS: Selection click did not pollute the undo stack.');

  // 6. Drag text layer on canvas by +120px X and +80px Y
  console.log('6. Dragging text layer on canvas by +120px X and +80px Y...');
  await window.mouse.move(startX, startY);
  await window.mouse.down();
  await window.waitForTimeout(100);

  await window.mouse.move(startX + 60, startY + 40, { steps: 5 });
  await window.mouse.move(startX + 120, startY + 80, { steps: 5 });
  await window.waitForTimeout(200);
  await window.mouse.up();
  await window.waitForTimeout(1000);

  // Verify post-drag state
  const postDragState = await window.evaluate(() => {
    const l = window.store.state.scene.layers.find((ly) => ly.id === 'title-text');
    return {
      xPct: l.position.xPct,
      yPct: l.position.yPct,
      canUndo: window.store.canUndo(),
      canRedo: window.store.canRedo(),
    };
  });
  console.log('   Post-canvas-drag position:', postDragState);
  if (postDragState.xPct <= 50 || postDragState.yPct <= 50) {
    throw new Error(`Expected layer to move beyond (50%, 50%), got: ${JSON.stringify(postDragState)}`);
  }
  const postDragCanUndo = await undoBtn.isDisabled();
  console.log('   #btn-undo isDisabled after canvas drag:', postDragCanUndo);
  if (postDragCanUndo) {
    throw new Error('FAILED: #btn-undo should be enabled after canvas drag!');
  }
  console.log('   PASS: Canvas drag enabled #btn-undo and updated layer coordinates.');

  // 7. Click Undo button: layer should revert to exact initial coordinates (50%, 50%)!
  console.log('7. Triggering Undo via #btn-undo...');
  await undoBtn.click();
  await window.waitForTimeout(1000);

  const postUndoState = await window.evaluate(() => {
    const l = window.store.state.scene.layers.find((ly) => ly.id === 'title-text');
    return {
      xPct: l.position.xPct,
      yPct: l.position.yPct,
      canUndo: window.store.canUndo(),
      canRedo: window.store.canRedo(),
    };
  });
  console.log('   Post-undo state:', postUndoState);
  if (postUndoState.xPct !== 50 || postUndoState.yPct !== 50) {
    throw new Error(`FAILED: Undo did not restore layer to exact (50%, 50%)! Got: ${JSON.stringify(postUndoState)}`);
  }
  const postUndoCanRedo = await redoBtn.isDisabled();
  console.log('   #btn-redo isDisabled after undo:', postUndoCanRedo);
  if (postUndoCanRedo) {
    throw new Error('FAILED: #btn-redo should be enabled after undo!');
  }
  console.log('   PASS: Undo perfectly restored pre-drag (50%, 50%) coordinates and enabled Redo!');

  // 8. Trigger Redo via #btn-redo: layer should restore to post-drag position!
  console.log('8. Triggering Redo via #btn-redo...');
  await redoBtn.click();
  await window.waitForTimeout(1000);

  const postRedoState = await window.evaluate(() => {
    const l = window.store.state.scene.layers.find((ly) => ly.id === 'title-text');
    return {
      xPct: l.position.xPct,
      yPct: l.position.yPct,
    };
  });
  console.log('   Post-redo state:', postRedoState);
  if (postRedoState.xPct !== postDragState.xPct || postRedoState.yPct !== postDragState.yPct) {
    throw new Error(`FAILED: Redo did not restore layer to post-drag position! Got: ${JSON.stringify(postRedoState)}`);
  }
  console.log('   PASS: Redo restored layer to post-drag position!');

  // 9. Test Timeline Drag & Undo
  console.log('9. Testing Timeline clip drag and undo...');
  const tlCoords = await window.evaluate(() => {
    const canvas = document.getElementById('timeline-canvas');
    const rect = canvas.getBoundingClientRect();
    const dur = window.store.state.scene.durationMs;
    const zoom = window.store.state.zoom;
    const pxPerMs = (canvas.clientWidth * zoom) / dur;
    const clipX = rect.left + 1000 * pxPerMs + window.store.state.panOffset + 50;
    const clipY = rect.top + 78; // Track 1
    return {
      startX: clipX,
      startY: clipY,
      targetX: clipX + 150,
    };
  });

  await window.mouse.move(tlCoords.startX, tlCoords.startY);
  await window.mouse.down();
  await window.waitForTimeout(100);

  await window.mouse.move(tlCoords.startX + 75, tlCoords.startY, { steps: 5 });
  await window.mouse.move(tlCoords.targetX, tlCoords.startY, { steps: 5 });
  await window.waitForTimeout(200);
  await window.mouse.up();
  await window.waitForTimeout(1000);

  const postTlDragState = await window.evaluate(() => {
    const l = window.store.state.scene.layers.find((ly) => ly.id === 'title-text');
    return {
      at: l.at,
      duration: l.duration,
    };
  });
  console.log('   Post-timeline-drag state:', postTlDragState);
  if (postTlDragState.at <= 1200) {
    throw new Error(`Expected timeline clip to move from 1000ms forward, got: ${postTlDragState.at}`);
  }

  // Trigger Undo via keyboard Ctrl+Z
  console.log('10. Triggering Undo via keyboard Ctrl+Z for timeline edit...');
  await window.keyboard.press('Control+z');
  await window.waitForTimeout(1000);

  const postTlUndoState = await window.evaluate(() => {
    const l = window.store.state.scene.layers.find((ly) => ly.id === 'title-text');
    return {
      at: l.at,
      duration: l.duration,
    };
  });
  console.log('   Post-timeline-undo state:', postTlUndoState);
  if (postTlUndoState.at !== 1000) {
    throw new Error(`FAILED: Undo did not restore timeline clip at to exact 1000ms! Got: ${postTlUndoState.at}`);
  }
  console.log('   PASS: Timeline drag successfully undone back to exact initial 1000ms!');

  // 11. Capture screenshot of verified state
  console.log('11. Capturing verification screenshot...');
  const screenshotPath = path.resolve(__dirname, '../screenshots/undo-history.png');
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await window.screenshot({ path: screenshotPath });
  console.log(`   Saved screenshot at: ${screenshotPath}\n`);

  console.log('=== DA-006: ALL VERIFICATIONS PASSED ===\n');
  await app.close();
}

testUndoHistory().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
