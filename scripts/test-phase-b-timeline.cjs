const { chromium } = require('playwright');
const path = require('path');

const UI_URL = 'http://127.0.0.1:5174';

async function run() {
  console.log('=== TESTING PHASE B: MULTI-TRACK TIMELINE NLE & KEYFRAME EDITOR ===\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    // 1. Load Studio and dismiss tour
    console.log('1. Loading Studio UI...');
    await page.goto(UI_URL);
    await page.waitForTimeout(1000);

    if (await page.isVisible('.mf-tour-actions .text-btn')) {
      await page.click('.mf-tour-actions .text-btn');
      await page.waitForTimeout(300);
    }

    // 2. Load demo scene
    console.log('2. Loading Demo Scene...');
    await page.click('#btn-demo');
    await page.waitForTimeout(2000);

    // 3. Verify Multi-track layout
    console.log('3. Verifying Multi-track layout and left headers...');
    const trackHeaders = await page.locator('.timeline-area .w-\\[220px\\] > div').count();
    console.log(`   Found ${trackHeaders} track headers in left panel`);
    if (trackHeaders < 4) {
      throw new Error(`Expected at least 4 track headers, found ${trackHeaders}`);
    }

    // 4. Expand track properties
    console.log('4. Expanding track properties for title layer...');
    const expandBtn = page.locator('.timeline-area button:has-text("▶")').first();
    await expandBtn.click();
    await page.waitForTimeout(400);

    const subtrackCount = await page.locator('.timeline-area .bg-\\[\\#08080c\\] > div').count();
    console.log(`   Expanded subtracks count: ${subtrackCount}`);
    if (subtrackCount < 4) {
      throw new Error(`Expected animatable property subtracks, found ${subtrackCount}`);
    }

    // 5. Add Keyframe
    console.log('5. Adding keyframe at playhead...');
    await page.evaluate(() => window.store?.setPlayhead(1200));
    await page.waitForTimeout(300);

    const addKfBtn = page.locator('.timeline-area button:has-text("◆")').first();
    await addKfBtn.click();
    await page.waitForTimeout(400);

    const keyframesInStore = await page.evaluate(() => {
      const l = window.state?.scene?.layers?.[0];
      return l?.tracks?.[0]?.keyframes;
    });
    console.log('   Keyframes in layer track:', keyframesInStore);
    if (!keyframesInStore || keyframesInStore.length === 0) {
      throw new Error('Keyframe was not added to layer track!');
    }

    // 6. Test In / Out points
    console.log('6. Testing In and Out points...');
    await page.evaluate(() => window.store?.setPlayhead(500));
    await page.keyboard.press('i');
    await page.waitForTimeout(200);

    await page.evaluate(() => window.store?.setPlayhead(3000));
    await page.keyboard.press('o');
    await page.waitForTimeout(200);

    const inOut = await page.evaluate(() => ({
      inPoint: window.state?.inPoint,
      outPoint: window.state?.outPoint,
    }));
    console.log('   In / Out points:', inOut);
    if (inOut.inPoint !== 500 || inOut.outPoint !== 3000) {
      throw new Error(`In/Out marks incorrect: ${JSON.stringify(inOut)}`);
    }

    // 7. Test Razor Split (Ctrl+K)
    console.log('7. Testing Razor Split at playhead...');
    await page.click('.layer-item[data-id="title"]');
    await page.evaluate(() => window.store?.setPlayhead(1500));
    await page.waitForTimeout(300);

    const preSplitLayers = await page.evaluate(() => window.state?.scene?.layers?.length || 0);
    await page.click('button:has-text("Split")');
    await page.waitForTimeout(500);

    const postSplitLayers = await page.evaluate(() => window.state?.scene?.layers?.length || 0);
    console.log(`   Layer count before split: ${preSplitLayers}, after split: ${postSplitLayers}`);
    if (postSplitLayers !== preSplitLayers + 1) {
      throw new Error(`Expected ${preSplitLayers + 1} layers after split, got ${postSplitLayers}`);
    }

    // 8. Test JKL Transport Loop
    console.log('8. Testing JKL Transport loop...');
    // L -> play 1x
    await page.keyboard.press('l');
    await page.waitForTimeout(200);
    let trans = await page.evaluate(() => ({ playing: window.state?.playing, rate: window.state?.playbackRate }));
    console.log('   Press L (1x):', trans);
    if (!trans.playing || trans.rate !== 1) throw new Error('Failed L 1x forward play');

    // L -> play 2x
    await page.keyboard.press('l');
    await page.waitForTimeout(200);
    trans = await page.evaluate(() => ({ playing: window.state?.playing, rate: window.state?.playbackRate }));
    console.log('   Press L again (2x):', trans);
    if (trans.rate !== 2) throw new Error('Failed L 2x forward play');

    // K -> pause
    await page.keyboard.press('k');
    await page.waitForTimeout(200);
    trans = await page.evaluate(() => ({ playing: window.state?.playing, rate: window.state?.playbackRate }));
    console.log('   Press K (pause):', trans);
    if (trans.playing) throw new Error('Failed K pause');

    // J -> reverse -1x
    await page.keyboard.press('j');
    await page.waitForTimeout(200);
    trans = await page.evaluate(() => ({ playing: window.state?.playing, rate: window.state?.playbackRate }));
    console.log('   Press J (-1x reverse):', trans);
    if (!trans.playing || trans.rate !== -1) throw new Error('Failed J reverse play');

    await page.keyboard.press('k'); // pause again

    // 9. Test Ripple Delete (Shift+Del)
    console.log('9. Testing Ripple Delete...');
    const preRippleCount = await page.evaluate(() => window.state?.scene?.layers?.length || 0);
    // select the split layer
    await page.evaluate(() => {
      const splitLayer = window.state?.scene?.layers?.find((l) => l.id.includes('_split'));
      if (splitLayer) window.store?.selectLayer(splitLayer.id);
    });
    await page.waitForTimeout(200);

    await page.click('button:has-text("Ripple Del")');
    await page.waitForTimeout(500);

    const postRippleCount = await page.evaluate(() => window.state?.scene?.layers?.length || 0);
    console.log(`   Layer count before ripple: ${preRippleCount}, after ripple: ${postRippleCount}`);
    if (postRippleCount !== preRippleCount - 1) {
      throw new Error(`Expected ${preRippleCount - 1} layers after ripple delete, got ${postRippleCount}`);
    }

    // 10. Capture Phase B verification screenshot
    const screenshotPath = path.resolve('screenshots/phase-b-timeline.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`10. Phase B verification screenshot saved to: ${screenshotPath}`);

    console.log('\n=== PHASE B TIMELINE NLE VERIFICATION: ALL PASS ===');
  } catch (err) {
    console.error('\nTest failed:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
