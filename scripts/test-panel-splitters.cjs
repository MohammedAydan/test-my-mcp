const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

async function testPanelSplitters() {
  console.log('=== DA-003: DRAGGABLE PANEL SPLITTERS VERIFICATION ===\n');

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
  await window.waitForTimeout(2000);

  // 2. Dismiss tour & reset workspace layout to baseline
  console.log('2. Dismissing tour & resetting workspace to default baseline...');
  await window.evaluate(() => {
    localStorage.setItem('motionforge_tour_seen', 'true');
    const tour = document.querySelector('.mf-tour-backdrop');
    if (tour) tour.remove();
    window.store?.resetWorkspaceLayout();
  });
  await window.waitForTimeout(1000);

  // 3. Locate panel elements and splitters
  console.log('3. Locating panels and splitter divider elements...');
  const leftPanel = window.locator('.panel.panel-left');
  const splitterLeft = window.locator('#splitter-left');
  const previewPanel = window.locator('.panel-center');
  const splitterRight = window.locator('#splitter-right');
  const rightPanel = window.locator('.panel.panel-right');
  const splitterTimeline = window.locator('#splitter-timeline');
  const timeline = window.locator('.timeline-area');

  await leftPanel.waitFor({ state: 'visible', timeout: 5000 });
  await splitterLeft.waitFor({ state: 'visible', timeout: 5000 });
  await previewPanel.waitFor({ state: 'visible', timeout: 5000 });
  await splitterRight.waitFor({ state: 'visible', timeout: 5000 });
  await rightPanel.waitFor({ state: 'visible', timeout: 5000 });
  await splitterTimeline.waitFor({ state: 'visible', timeout: 5000 });
  await timeline.waitFor({ state: 'visible', timeout: 5000 });

  // 4. Measure initial baseline dimensions
  const initLeftBox = await leftPanel.boundingBox();
  const initRightBox = await rightPanel.boundingBox();
  const initTimelineBox = await timeline.boundingBox();
  if (!initLeftBox || !initRightBox || !initTimelineBox) {
    throw new Error('Failed to read initial bounding boxes of panels');
  }

  console.log('   Initial Left Panel:', initLeftBox);
  console.log('   Initial Right Panel:', initRightBox);
  console.log('   Initial Timeline:', initTimelineBox);

  // Assert baseline defaults
  if (Math.abs(initLeftBox.width - 280) > 10) {
    throw new Error(`Left panel initial width was ${initLeftBox.width}, expected ~280px`);
  }
  if (Math.abs(initRightBox.width - 340) > 10) {
    throw new Error(`Right panel initial width was ${initRightBox.width}, expected ~340px`);
  }
  if (Math.abs(initTimelineBox.height - 240) > 10) {
    throw new Error(`Timeline initial height was ${initTimelineBox.height}, expected ~240px`);
  }

  // Capture before screenshot
  const beforeScreenshotPath = path.resolve(__dirname, '../screenshots/panel-splitters-before.png');
  await window.screenshot({ path: beforeScreenshotPath });
  console.log('   Saved panel-splitters-before.png at:', beforeScreenshotPath);

  // 5. Test Dragging Horizontal Timeline Splitter upward by 80px
  console.log('\n4. Dragging horizontal timeline splitter upward by 80px...');
  const tSplitterBox = await splitterTimeline.boundingBox();
  if (!tSplitterBox) throw new Error('Could not locate splitter-timeline bounding box');

  const tStartX = tSplitterBox.x + tSplitterBox.width / 2;
  const tStartY = tSplitterBox.y + tSplitterBox.height / 2;

  await window.mouse.move(tStartX, tStartY);
  await window.mouse.down();
  await window.mouse.move(tStartX, tStartY - 80, { steps: 10 });
  await window.mouse.up();
  await window.waitForTimeout(500);

  const resizedTimelineBox = await timeline.boundingBox();
  const timelineDiff = resizedTimelineBox.height - initTimelineBox.height;
  console.log(`   Timeline height: before=${initTimelineBox.height.toFixed(1)}px, after=${resizedTimelineBox.height.toFixed(1)}px (delta=${timelineDiff.toFixed(1)}px)`);
  if (Math.abs(timelineDiff - 80) > 15) {
    throw new Error(`Timeline height delta was ${timelineDiff}px, expected ~80px`);
  }

  // 6. Test Dragging Left Splitter rightward by 70px
  console.log('\n5. Dragging left splitter rightward by 70px...');
  const lSplitterBox = await splitterLeft.boundingBox();
  if (!lSplitterBox) throw new Error('Could not locate splitter-left bounding box');

  const lStartX = lSplitterBox.x + lSplitterBox.width / 2;
  const lStartY = lSplitterBox.y + lSplitterBox.height / 2;

  await window.mouse.move(lStartX, lStartY);
  await window.mouse.down();
  await window.mouse.move(lStartX + 70, lStartY, { steps: 10 });
  await window.mouse.up();
  await window.waitForTimeout(500);

  const resizedLeftBox = await leftPanel.boundingBox();
  const leftDiff = resizedLeftBox.width - initLeftBox.width;
  console.log(`   Left panel width: before=${initLeftBox.width.toFixed(1)}px, after=${resizedLeftBox.width.toFixed(1)}px (delta=${leftDiff.toFixed(1)}px)`);
  if (Math.abs(leftDiff - 70) > 15) {
    throw new Error(`Left panel width delta was ${leftDiff}px, expected ~70px`);
  }

  // 7. Test Dragging Right Splitter leftward by 60px
  console.log('\n6. Dragging right splitter leftward by 60px...');
  const rSplitterBox = await splitterRight.boundingBox();
  console.log('   rSplitterBox:', rSplitterBox);
  if (!rSplitterBox) throw new Error('Could not locate splitter-right bounding box');

  const rStartX = rSplitterBox.x + rSplitterBox.width / 2;
  const rStartY = rSplitterBox.y + rSplitterBox.height / 2;

  await window.mouse.move(rStartX, rStartY);
  await window.mouse.down();
  await window.mouse.move(rStartX - 60, rStartY, { steps: 10 });
  await window.mouse.up();
  await window.waitForTimeout(500);

  const resizedRightBox = await rightPanel.boundingBox();
  const rightDiff = resizedRightBox.width - initRightBox.width;
  console.log(`   Right panel width: before=${initRightBox.width.toFixed(1)}px, after=${resizedRightBox.width.toFixed(1)}px (delta=${rightDiff.toFixed(1)}px)`);
  if (Math.abs(rightDiff - 60) > 15) {
    throw new Error(`Right panel width delta was ${rightDiff}px, expected ~60px`);
  }

  // Capture after screenshot with expanded panels
  const afterScreenshotPath = path.resolve(__dirname, '../screenshots/panel-splitters-after.png');
  await window.screenshot({ path: afterScreenshotPath });
  console.log('   Saved panel-splitters-after.png at:', afterScreenshotPath);

  // 8. Test Double-Click Collapse on Left Panel
  console.log('\n7. Testing double-click collapse on left panel...');
  await splitterLeft.dblclick();
  await window.waitForTimeout(500);

  const collapsedLeftVisible = await leftPanel.isVisible();
  console.log('   Left panel visible after double-click collapse:', collapsedLeftVisible);
  if (collapsedLeftVisible) {
    const collapsedLeftBox = await leftPanel.boundingBox();
    if (collapsedLeftBox && collapsedLeftBox.width > 10) {
      throw new Error(`Expected left panel to collapse to 0 or hide, but width was ${collapsedLeftBox.width}`);
    }
  }

  // Double-click again to restore
  console.log('   Double-clicking left splitter again to restore...');
  await splitterLeft.dblclick();
  await window.waitForTimeout(500);

  const restoredLeftBox = await leftPanel.boundingBox();
  console.log('   Restored left panel box:', restoredLeftBox);
  if (!restoredLeftBox || restoredLeftBox.width < 180) {
    throw new Error(`Expected left panel to restore, but width was ${restoredLeftBox?.width}`);
  }

  // 9. Test Double-Click Collapse on Timeline
  console.log('\n8. Testing double-click collapse on timeline...');
  await splitterTimeline.dblclick();
  await window.waitForTimeout(500);

  const collapsedTimelineVisible = await timeline.isVisible();
  console.log('   Timeline visible after double-click collapse:', collapsedTimelineVisible);
  if (collapsedTimelineVisible) {
    const collapsedTimelineBox = await timeline.boundingBox();
    if (collapsedTimelineBox && collapsedTimelineBox.height > 10) {
      throw new Error(`Expected timeline to collapse, but height was ${collapsedTimelineBox.height}`);
    }
  }

  // Double-click again to restore timeline
  console.log('   Double-clicking timeline splitter again to restore...');
  await splitterTimeline.dblclick();
  await window.waitForTimeout(500);

  const restoredTimelineBox = await timeline.boundingBox();
  console.log('   Restored timeline box:', restoredTimelineBox);
  if (!restoredTimelineBox || restoredTimelineBox.height < 140) {
    throw new Error(`Expected timeline to restore, but height was ${restoredTimelineBox?.height}`);
  }

  // 10. Test Reset Workspace Layout
  console.log('\n9. Testing Reset Workspace Layout to defaults...');
  await window.evaluate(() => window.store.resetWorkspaceLayout());
  await window.waitForTimeout(500);

  const resetLeftBox = await leftPanel.boundingBox();
  const resetRightBox = await rightPanel.boundingBox();
  const resetTimelineBox = await timeline.boundingBox();

  console.log('   Reset Left Panel width:', resetLeftBox.width);
  console.log('   Reset Right Panel width:', resetRightBox.width);
  console.log('   Reset Timeline height:', resetTimelineBox.height);

  if (Math.abs(resetLeftBox.width - 280) > 10) {
    throw new Error(`Reset left panel width was ${resetLeftBox.width}, expected ~280px`);
  }
  if (Math.abs(resetRightBox.width - 340) > 10) {
    throw new Error(`Reset right panel width was ${resetRightBox.width}, expected ~340px`);
  }
  if (Math.abs(resetTimelineBox.height - 240) > 10) {
    throw new Error(`Reset timeline height was ${resetTimelineBox.height}, expected ~240px`);
  }

  // 11. Verify LocalStorage persistence
  console.log('\n10. Verifying localStorage persistence of workspace layout...');
  const persistedRaw = await window.evaluate(() => localStorage.getItem('motionforge_workspace_v1'));
  console.log('    Persisted localStorage entry:', persistedRaw);
  if (!persistedRaw) {
    throw new Error('No motionforge_workspace_v1 entry found in localStorage');
  }
  const persisted = JSON.parse(persistedRaw);
  if (typeof persisted.leftPanelWidth !== 'number' || typeof persisted.timelineHeight !== 'number') {
    throw new Error('Persisted workspace layout is missing required numeric dimensions');
  }

  console.log('\n=== DA-003 VERIFICATION SUCCEEDED: ALL CHECKS PASSED ===');
  await app.close();
}

testPanelSplitters().catch((err) => {
  console.error('\nDA-003 verification failed:', err);
  process.exit(1);
});
