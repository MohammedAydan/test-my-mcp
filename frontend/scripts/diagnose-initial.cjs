const { chromium } = require('D:/Projects/mcps/test-my-mcp/node_modules/playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  const consoleMessages = [];
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on('console', (msg) => {
    const text = msg.text();
    consoleMessages.push({ type: msg.type(), text });
    if (msg.type() === 'error') {
      consoleErrors.push(text);
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push(err.message || String(err));
  });

  page.on('requestfailed', (req) => {
    failedRequests.push({
      url: req.url(),
      failure: req.failure() ? req.failure().errorText : 'unknown',
    });
  });

  // Fresh initial visit
  await page.goto('http://127.0.0.1:5174');
  await page.waitForTimeout(3000);

  // Capture diagnostic initial screenshot
  const screenshotPath = path.resolve('screenshots/diagnostic-01-initial.png');
  await page.screenshot({ path: screenshotPath });

  const summary = {
    url: page.url(),
    consoleErrors,
    pageErrors,
    failedRequests,
    allConsole: consoleMessages,
    screenshot: screenshotPath,
  };

  console.log('--- DIAGNOSTIC RESULT ---');
  console.log(JSON.stringify(summary, null, 2));

  await browser.close();
})();
