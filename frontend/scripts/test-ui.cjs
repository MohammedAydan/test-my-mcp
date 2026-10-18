const { chromium } = require('D:/Projects/mcps/test-my-mcp/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  
  const results = [];
  function assert(name, condition, extra = '') {
    if (condition) {
      results.push(`✅ ${name} ${extra}`);
      console.log(`PASS: ${name}`);
    } else {
      results.push(`❌ ${name} ${extra}`);
      console.error(`FAIL: ${name}`);
    }
  }

  // Clear local storage for clean tour test
  await page.goto('http://127.0.0.1:5174');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(800);

  // 1. First-run tour
  const tourVisible = await page.isVisible('.mf-tour-box');
  assert('First-run tour visible on fresh state', tourVisible);
  if (tourVisible) {
    await page.click('.mf-tour-actions .primary-btn'); // Step 2
    await page.waitForTimeout(200);
    const step2Text = await page.textContent('.mf-tour-step');
    assert('Tour advances to Step 2', step2Text.includes('Step 2'));
    await page.click('.mf-tour-actions .text-btn'); // Skip
    await page.waitForTimeout(200);
    const tourGone = !(await page.isVisible('.mf-tour-box'));
    assert('Tour dismissed on skip', tourGone);
  }

  // 2. Load Demo Scene
  await page.click('#btn-demo');
  await page.waitForTimeout(2000);
  const layerCount = await page.locator('.layer-item').count();
  assert('Demo scene loaded with 4 layers', layerCount === 4, `(found ${layerCount})`);

  // 3. Layer Selection & Inspector
  await page.click('.layer-item[data-id="title"]');
  await page.waitForTimeout(400);
  const inspectorText = await page.textContent('#inspector');
  assert('Inspector populates with layer data', inspectorText.includes('kineticText : title'));
  assert('Inspector has Typography & Appearance', inspectorText.includes('Typography & Appearance'));

  // 4. Duplicate Layer
  const beforeCount = await page.locator('.layer-item').count();
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(600);
  const afterCount = await page.locator('.layer-item').count();
  assert('Duplicate layer increases count by 1', afterCount === beforeCount + 1, `(${beforeCount} -> ${afterCount})`);

  // 5. Undo & Redo
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  const undoneCount = await page.locator('.layer-item').count();
  assert('Undo restores previous layer count', undoneCount === beforeCount, `(${undoneCount} === ${beforeCount})`);

  await page.keyboard.press('Control+Shift+Z');
  await page.waitForTimeout(600);
  const redoneCount = await page.locator('.layer-item').count();
  assert('Redo re-applies duplicate', redoneCount === afterCount, `(${redoneCount} === ${afterCount})`);

  // 6. Delete Layer & Undo
  await page.click('.layer-item[data-id="title-copy"]');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(600);
  const afterDeleteCount = await page.locator('.layer-item').count();
  assert('Delete layer removes layer', afterDeleteCount === beforeCount);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  const afterUndoDelete = await page.locator('.layer-item').count();
  assert('Undo restores deleted layer', afterUndoDelete === afterCount);

  // 7. Command Palette
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(400);
  const paletteOpen = await page.isVisible('.mf-cmd-palette');
  assert('Command palette opens on Ctrl+K', paletteOpen);

  await page.fill('.mf-cmd-input', 'inspect');
  await page.waitForTimeout(300);
  const resultsCount = await page.locator('.mf-cmd-row').count();
  assert('Command palette fuzzy searches items', resultsCount > 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const paletteClosed = !(await page.isVisible('.mf-cmd-palette'));
  assert('Command palette closes on Escape', paletteClosed);

  // 8. Shortcuts Reference Modal
  await page.keyboard.press('?');
  await page.waitForTimeout(400);
  const shortcutsOpen = await page.isVisible('.modal-title');
  assert('Shortcuts reference modal opens on ?', shortcutsOpen);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 9. Timeline Scrubbing
  await page.fill('#playhead-input', '1500');
  await page.dispatchEvent('#playhead-input', 'change');
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(300);
  const timecodeVal = await page.textContent('#timecode');
  assert('Timecode updates on playhead input', timecodeVal.includes('00:00:01.500'), `(${timecodeVal})`);

  // 10. Playback toggle
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  const playBtnText = await page.textContent('#btn-play');
  assert('Playback starts and icon toggles to pause', playBtnText.includes('⏸'));
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);

  // 11. Assets panel switch
  await page.click('.tab-btn[data-tab="assets"]');
  await page.waitForTimeout(300);
  const assetsVisible = await page.isVisible('[data-panel="assets"]');
  assert('Assets vault tab opens', assetsVisible);

  // 12. Capabilities panel switch
  await page.click('.tab-btn[data-tab="caps"]');
  await page.waitForTimeout(300);
  const capsVisible = await page.isVisible('.cap-section');
  assert('Capabilities registries populate', capsVisible);

  // 13. Screen Capture at 1920x1080
  await page.screenshot({ path: 'screenshots/verification-1920x1080.png' });

  // 14. Viewport 1440x900
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/verification-1440x900.png' });

  // 15. Viewport 2560x1440
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/verification-2560x1440.png' });

  await browser.close();

  console.log('\n--- VERIFICATION SUMMARY ---');
  console.log(results.join('\n'));
})();
