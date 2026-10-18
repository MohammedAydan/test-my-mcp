const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

async function testPackagedExe() {
  console.log('=== TESTING PACKAGED DESKTOP EXECUTABLE ===\n');

  const exePath = path.resolve(__dirname, '../packages/desktop/dist/win-unpacked/MotionForge.exe');
  if (!fs.existsSync(exePath)) {
    throw new Error('Packaged executable not found at: ' + exePath);
  }
  console.log('1. Found packaged executable:', exePath);

  const app = await electron.launch({
    executablePath: exePath,
    env: {
      ...process.env,
      MOTIONFORGE_ENGINE_URL: 'http://127.0.0.1:4000',
      MOTIONFORGE_TEST_MODE: '1',
    },
  });

  const window = await app.firstWindow();
  console.log('2. Window title on launch:', await window.title());

  await window.waitForTimeout(2000);

  const engineUrl = await window.evaluate(() => window.motionforge?.engineUrl);
  console.log('3. Packaged window engineUrl:', engineUrl);
  if (!engineUrl) throw new Error('engineUrl missing in packaged app');

  // Dismiss tour if present and click #btn-demo
  if (await window.isVisible('.mf-tour-actions .text-btn')) {
    await window.click('.mf-tour-actions .text-btn');
    await window.waitForTimeout(300);
  }

  await window.click('#btn-demo');
  await window.locator('.layer-item').first().waitFor({ timeout: 10000 });
  const layerCount = await window.locator('.layer-item').count();
  console.log('4. Packaged app loaded layer count:', layerCount);
  if (layerCount < 4) throw new Error('Expected at least 4 layers in packaged app');

  const screenshotPath = path.resolve(__dirname, '../screenshots/packaged-exe-verify.png');
  await window.screenshot({ path: screenshotPath });
  console.log('5. Packaged app screenshot saved to:', screenshotPath);

  await app.close();
  console.log('\n=== PACKAGED DESKTOP EXECUTABLE VERIFICATION: ALL PASS ===');
}

testPackagedExe().catch((err) => {
  console.error('Packaged exe test failed:', err);
  process.exit(1);
});
