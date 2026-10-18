const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const consoleWarnings = [];
  const failedRequests = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    else if (msg.type() === 'warning') consoleWarnings.push(msg.text());
  });

  page.on('pageerror', (err) => {
    consoleErrors.push(`[PageError] ${err.message}`);
  });

  page.on('requestfailed', (req) => {
    failedRequests.push({
      url: req.url(),
      failure: req.failure() ? req.failure().errorText : 'unknown',
    });
  });

  console.log('Navigating to http://127.0.0.1:5174...');
  await page.goto('http://127.0.0.1:5174', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const screenshotPath1 = path.resolve('screenshots/desktop-baseline-01.png');
  const screenshotPath2 = path.resolve('frontend/screenshots/desktop-baseline-01.png');

  await page.screenshot({ path: screenshotPath1, fullPage: false });
  try {
    fs.copyFileSync(screenshotPath1, screenshotPath2);
  } catch (e) {}

  console.log('Screenshot saved to', screenshotPath1);
  console.log('Console Errors (' + consoleErrors.length + '):', JSON.stringify(consoleErrors, null, 2));
  console.log('Console Warnings (' + consoleWarnings.length + '):', JSON.stringify(consoleWarnings, null, 2));
  console.log('Failed Requests (' + failedRequests.length + '):', JSON.stringify(failedRequests, null, 2));

  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
