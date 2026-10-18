const { chromium } = require('playwright');
const path = require('path');

const UI_URL = 'http://127.0.0.1:5174';

async function run() {
  console.log('=== TESTING PHASE A: DIRECT CANVAS MANIPULATION OVERLAY ===\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

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

    // 3. Verify CanvasOverlay rendered
    const overlay = page.locator('svg.w-full.h-full');
    await overlay.waitFor({ state: 'visible', timeout: 5000 });
    console.log('3. CanvasOverlay SVG element visible!');

    // 4. Select a layer (e.g. title)
    console.log('4. Selecting title layer...');
    await page.click('.layer-item[data-id="title"]');
    await page.waitForTimeout(600);

    // 5. Verify resize & rotation handles rendered
    const handles = await page.locator('[data-handle]').count();
    console.log(`5. Number of active handles rendered: ${handles}`);
    if (handles < 9) {
      throw new Error(`Expected at least 9 handles (8 resize + 1 rotate), found ${handles}`);
    }

    // 6. Test direct dragging layer on canvas
    console.log('6. Testing direct layer drag & position update...');
    const selectedRect = page.locator('rect[class*="cursor-move"]');
    const box = await selectedRect.boundingBox();
    if (!box) throw new Error('Selected bounding box not found');

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    const initialPos = await page.evaluate(() => {
      const l = window.state?.scene?.layers?.find((x) => x.id === window.state?.selectedLayerId);
      return { xPct: l?.position?.xPct, yPct: l?.position?.yPct };
    });
    console.log('   Initial layer position:', initialPos);

    // Perform drag move
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY + 50, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    const movedPos = await page.evaluate(() => {
      const l = window.state?.scene?.layers?.find((x) => x.id === window.state?.selectedLayerId);
      return { xPct: l?.position?.xPct, yPct: l?.position?.yPct };
    });
    console.log('   Moved layer position:', movedPos);
    if (movedPos.xPct === initialPos.xPct && movedPos.yPct === initialPos.yPct) {
      throw new Error('Layer position did not change after canvas drag!');
    }

    // 7. Test rotation handle drag
    console.log('7. Testing rotation handle...');
    const rotateHandle = page.locator('[data-handle="rotate"]');
    const rotBox = await rotateHandle.boundingBox();
    if (!rotBox) throw new Error('Rotate handle not found');

    await page.mouse.move(rotBox.x + rotBox.width / 2, rotBox.y + rotBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(rotBox.x + 80, rotBox.y + 40, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    const rotation = await page.evaluate(() => {
      const l = window.state?.scene?.layers?.find((x) => x.id === window.state?.selectedLayerId);
      return l?.rotation;
    });
    console.log('   Layer rotation after drag:', rotation);

    // 8. Test Viewport Zoom & Pan
    console.log('8. Testing Viewport Zoom & Pan toolbar...');
    await page.selectOption('.absolute.bottom-3 select', '1.5');
    await page.waitForTimeout(400);

    const currentZoom = await page.evaluate(() => window.state?.viewportZoom);
    console.log('   Viewport zoom level:', currentZoom);
    if (currentZoom !== 1.5) throw new Error(`Expected zoom 1.5, got ${currentZoom}`);

    // Click Fit Viewport button
    await page.click('button:has-text("Fit")');
    await page.waitForTimeout(300);
    const fitZoom = await page.evaluate(() => window.state?.viewportZoom);
    console.log('   Reset zoom level:', fitZoom);
    if (fitZoom !== 1) throw new Error(`Expected fit zoom 1, got ${fitZoom}`);

    // 9. Capture screenshot of Phase A direct manipulation
    const screenshotPath = path.resolve('screenshots/phase-a-overlay.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`9. Phase A verification screenshot saved to: ${screenshotPath}`);

    console.log('\n=== PHASE A DIRECT CANVAS MANIPULATION VERIFICATION: ALL PASS ===');
  } catch (err) {
    console.error('\nTest failed:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
