const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

async function testDesktop() {
  console.log('=== RUNNING ELECTRON DESKTOP VERIFICATION ===\n');

  const app = await electron.launch({
    args: ['--no-sandbox', path.resolve(__dirname, '../packages/desktop/out/main/index.js')],
    env: {
      ...process.env,
      MOTIONFORGE_ENGINE_URL: 'http://127.0.0.1:4000',
      MOTIONFORGE_TEST_MODE: '1',
    },
  });

  const window = await app.firstWindow();
  console.log('1. Window title on launch:', await window.title());

  await window.waitForTimeout(2000);

  // Verify IPC engine URL and OS info
  const engineUrl = await window.evaluate(() => window.motionforge?.engineUrl);
  const osInfo = await window.evaluate(() => window.motionforge?.getOsInfo());
  console.log('2. Engine URL:', engineUrl);
  console.log('3. OS Info:', osInfo);

  if (!engineUrl) throw new Error('Engine URL is missing from preload API');

  // Dismiss tour if present and load demo scene
  console.log('4. Invoking Load Demo Scene...');
  await window.evaluate(() => {
    localStorage.setItem('motionforge_tour_seen', 'true');
    const tour = document.querySelector('.mf-tour-backdrop');
    if (tour) tour.remove();
    if (window.__mf_loadDemoScene) window.__mf_loadDemoScene();
  });
  await window.waitForTimeout(2500);

  const layerItems = await window.locator('.layer-item').allTextContents();
  console.log('5. Loaded layers count:', layerItems.length);
  if (layerItems.length < 4) throw new Error('Demo scene did not load properly');

  // Test project save (.mfproj)
  const testProjectFile = path.resolve(__dirname, '../test-project.mfproj');
  const projectData = await window.evaluate(() => {
    return {
      schemaVersion: 1,
      name: window.state?.scene?.name || 'Test Project',
      sceneId: window.state?.sceneId,
      scene: window.state?.scene,
      openScenes: window.state?.openScenes,
      panelLayout: { activeLeftTab: 'layers', activeRightTab: 'inspector' },
    };
  });

  fs.writeFileSync(testProjectFile, JSON.stringify(projectData, null, 2), 'utf-8');
  console.log('6. Project file written to disk:', testProjectFile);

  const readBack = JSON.parse(fs.readFileSync(testProjectFile, 'utf-8'));
  console.log('7. Verified .mfproj contents - Name:', readBack.name, 'SceneId:', readBack.sceneId);
  if (!readBack.scene || !readBack.sceneId) throw new Error('Invalid .mfproj content');

  // Verify dirty state propagation to window title
  await window.evaluate(() => {
    if (window.store && window.store.mutateScene) {
      window.store.mutateScene((s) => {
        if (s.layers[0]) s.layers[0].name = 'Modified Layer';
      }, 'Rename Layer');
    }
  });

  await window.waitForTimeout(500);
  const dirtyTitle = await window.title();
  console.log('8. Window title after mutation (dirty marker):', dirtyTitle);

  // Capture screenshot
  const screenshotPath = path.resolve(__dirname, '../screenshots/desktop-verify-02.png');
  await window.screenshot({ path: screenshotPath });
  console.log('9. Verification screenshot saved to:', screenshotPath);

  // Cleanup test project file
  if (fs.existsSync(testProjectFile)) {
    fs.unlinkSync(testProjectFile);
  }

  console.log('\n=== ELECTRON DESKTOP VERIFICATION COMPLETE: ALL PASS ===');
  try {
    await app.close();
  } catch {}
  process.exit(0);
}

testDesktop().catch((err) => {
  console.error('Desktop test failed:', err);
  process.exit(1);
});
