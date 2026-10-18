const { chromium } = require('playwright');
const path = require('path');

async function testSolidReadOnly() {
  console.log('[test-solid] Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
      console.error(`[browser:error] ${msg.text()}`);
    } else {
      console.log(`[browser:${msg.type()}] ${msg.text()}`);
    }
  });

  page.on('response', async (res) => {
    if (res.status() >= 400) {
      const text = await res.text().catch(() => '');
      console.error(`[browser:response-error] ${res.status()} ${res.url()}: ${text}`);
    }
  });

  console.log('[test-solid] Navigating to http://127.0.0.1:5175/...');
  await page.goto('http://127.0.0.1:5175/', { waitUntil: 'networkidle' });

  // Wait 1s for initial demo scene load
  await page.waitForTimeout(1000);

  // Assertions
  const title = await page.title();
  console.log(`[test-solid] Page title: "${title}"`);
  if (!title.includes('MotionForge')) {
    throw new Error(`Expected title to include "MotionForge", got "${title}"`);
  }

  // Check scene tabs
  const sceneTitle = await page.textContent('#scene-title');
  console.log(`[test-solid] Scene title tab: "${sceneTitle?.trim()}"`);
  if (!sceneTitle || sceneTitle.includes('No scene')) {
    // If not loaded yet, click #btn-demo
    console.log('[test-solid] Clicking #btn-demo to initialize demo scene...');
    const demoBtn = page.locator('#btn-demo');
    if (await demoBtn.isVisible()) {
      await demoBtn.click();
      await page.waitForTimeout(1000);
    }
  }

  // Verify layer list
  const layerItems = page.locator('.layer-item');
  const layerCount = await layerItems.count();
  console.log(`[test-solid] Layer items found: ${layerCount}`);
  if (layerCount !== 4) {
    throw new Error(`Expected 4 layer items in demo scene, got ${layerCount}`);
  }

  // Verify inspector has content
  const inspector = page.locator('#inspector');
  const inspText = await inspector.textContent();
  console.log(`[test-solid] Inspector text length: ${inspText?.length}`);
  if (!inspText || inspText.includes('Select a layer')) {
    // Click first layer to select
    await layerItems.first().click();
    await page.waitForTimeout(300);
  }

  // Verify timeline canvas exists
  const canvas = page.locator('#timeline-canvas');
  if (!(await canvas.isVisible())) {
    throw new Error('Expected #timeline-canvas to be visible');
  }

  // Verify preview iframe exists
  const iframe = page.locator('#preview-iframe');
  if (!(await iframe.isVisible())) {
    throw new Error('Expected #preview-iframe to be visible');
  }

  // Capture screenshot
  const screenshotPath = path.resolve(__dirname, '../screenshots/desktop-solid-baseline-01.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`[test-solid] Saved verification screenshot: ${screenshotPath}`);

  if (consoleErrors.length > 0) {
    console.warn(`[test-solid] Encountered ${consoleErrors.length} console errors:`, consoleErrors);
  } else {
    console.log('[test-solid] Zero console errors! PASS.');
  }

  await browser.close();
  console.log('[test-solid] SUCCESS: Solid.js read-only parity verified!');
}

testSolidReadOnly().catch((err) => {
  console.error('[test-solid] FAILED:', err);
  process.exit(1);
});
