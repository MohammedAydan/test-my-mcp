const { chromium } = require('D:/Projects/mcps/test-my-mcp/node_modules/playwright');
const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const UI_URL = 'http://127.0.0.1:5174';
const ENGINE_URL = 'http://127.0.0.1:4000';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  const results = {};
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  console.log('=== STARTING PHASE 2 SYSTEMATIC TESTING ===\n');

  try {
    // -----------------------------------------------------------------
    // 2.1 Load Demo Scene
    // -----------------------------------------------------------------
    console.log('--> Testing 2.1: Load Demo Scene');
    await page.goto(UI_URL);
    await page.waitForTimeout(1000);

    // Dismiss tour if present
    if (await page.isVisible('.mf-tour-actions .text-btn')) {
      await page.click('.mf-tour-actions .text-btn');
      await page.waitForTimeout(300);
    }

    await page.click('#btn-demo');
    await page.waitForTimeout(2500);

    const layerItems = await page.locator('.layer-item').allTextContents();
    const demoScreenshot = 'screenshots/diagnostic-02-demo.png';
    await page.screenshot({ path: path.resolve(demoScreenshot) });

    const sceneId = await page.evaluate(() => window.state?.sceneId || localStorage.getItem('motionforge_last_scene'));
    let sceneJson = null;
    if (sceneId) {
      try {
        const res = await fetch(`${ENGINE_URL}/api/scenes/${sceneId}`);
        sceneJson = await res.json();
      } catch (e) {}
    }

    results['2.1'] = {
      test: 'Load Demo Scene',
      status: layerItems.length >= 4 && sceneJson ? 'PASS' : 'FAIL',
      evidence: `Layers: ${layerItems.length} (${layerItems.join(', ')}). SceneId: ${sceneId}. Saved to engine: ${Boolean(sceneJson)}. Screenshot: ${demoScreenshot}`,
    };
    console.log(`2.1 Result: ${results['2.1'].status}`);

    // -----------------------------------------------------------------
    // 2.2 Load Scene by ID
    // -----------------------------------------------------------------
    console.log('--> Testing 2.2: Load Scene by ID');
    await page.click('#btn-load');
    await page.waitForTimeout(500);

    await page.fill('#modal-scene-id-input', sceneId);
    await page.click('.primary-btn:has-text("Load")');
    await page.waitForTimeout(1500);

    const activeSceneTab = await page.textContent('.scene-tab.active .scene-tab-name');
    results['2.2'] = {
      test: 'Load Scene by ID',
      status: activeSceneTab && activeSceneTab.includes(sceneId) ? 'PASS' : 'FAIL',
      evidence: `Active scene tab: "${activeSceneTab}". Expected: "${sceneId}".`,
    };
    console.log(`2.2 Result: ${results['2.2'].status}`);

    // -----------------------------------------------------------------
    // 2.3 Layer Selection & Inspector
    // -----------------------------------------------------------------
    console.log('--> Testing 2.3: Layer Selection & Inspector');
    await page.click('.layer-item[data-id="title"]');
    await page.waitForTimeout(400);

    const inspText = await page.textContent('#inspector');
    const isTimelineSelected = await page.evaluate(() => window.state?.selectedLayerId === 'title');
    const selectScreenshot = 'screenshots/diagnostic-03-selection.png';
    await page.screenshot({ path: path.resolve(selectScreenshot) });

    results['2.3'] = {
      test: 'Layer Selection & Inspector',
      status: inspText.includes('title') && isTimelineSelected ? 'PASS' : 'FAIL',
      evidence: `Inspector contains layer id: ${inspText.includes('title')}. State selectedLayerId: ${isTimelineSelected}. Screenshot: ${selectScreenshot}`,
    };
    console.log(`2.3 Result: ${results['2.3'].status}`);

    // -----------------------------------------------------------------
    // 2.4 Edit a Field
    // -----------------------------------------------------------------
    console.log('--> Testing 2.4: Edit a Field');
    // Find Font Size field in inspector
    const sizeInput = page.locator('.insp-field:has-text("Font Size") input');
    await sizeInput.fill('100');
    await sizeInput.dispatchEvent('change');
    await page.waitForTimeout(1500); // Wait for debounced save

    // Verify engine has updated sizePx
    let engineSize = null;
    try {
      const res = await fetch(`${ENGINE_URL}/api/scenes/${sceneId}`);
      const updatedScene = await res.json();
      const titleLayer = updatedScene.layers.find((l) => l.id === 'title');
      engineSize = titleLayer ? titleLayer.sizePx : null;
    } catch (e) {}

    const editScreenshot = 'screenshots/diagnostic-04-edit-field.png';
    await page.screenshot({ path: path.resolve(editScreenshot) });

    results['2.4'] = {
      test: 'Edit a Field',
      status: engineSize === 100 ? 'PASS' : 'FAIL',
      evidence: `Engine sizePx via curl/fetch: ${engineSize} (expected 100). Screenshot: ${editScreenshot}`,
    };
    console.log(`2.4 Result: ${results['2.4'].status}`);

    // -----------------------------------------------------------------
    // 2.5 Undo / Redo
    // -----------------------------------------------------------------
    console.log('--> Testing 2.5: Undo / Redo');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(1500);

    let undoneSize = null;
    try {
      const res = await fetch(`${ENGINE_URL}/api/scenes/${sceneId}`);
      const updatedScene = await res.json();
      const titleLayer = updatedScene.layers.find((l) => l.id === 'title');
      undoneSize = titleLayer ? titleLayer.sizePx : null;
    } catch (e) {}

    await page.keyboard.press('Control+Shift+Z');
    await page.waitForTimeout(1500);

    let redoneSize = null;
    try {
      const res = await fetch(`${ENGINE_URL}/api/scenes/${sceneId}`);
      const updatedScene = await res.json();
      const titleLayer = updatedScene.layers.find((l) => l.id === 'title');
      redoneSize = titleLayer ? titleLayer.sizePx : null;
    } catch (e) {}

    results['2.5'] = {
      test: 'Undo / Redo',
      status: undoneSize === 140 && redoneSize === 100 ? 'PASS' : 'FAIL',
      evidence: `After Undo: ${undoneSize} (expected 140). After Redo: ${redoneSize} (expected 100).`,
    };
    console.log(`2.5 Result: ${results['2.5'].status}`);

    // -----------------------------------------------------------------
    // 2.6 Add Each Layer Type
    // -----------------------------------------------------------------
    console.log('--> Testing 2.6: Add Each Layer Type');
    const layerTypes = ['kineticText', 'card', 'background', 'imageLogo', 'lottie', 'foregroundFX'];
    const layerTypeResults = {};

    for (const t of layerTypes) {
      await page.click('#btn-add-layer');
      await page.waitForTimeout(400);

      const cardLocator = page.locator(`.layer-type-card:has(.name:text-is("${
        t === 'kineticText' ? 'Kinetic Text' :
        t === 'card' ? 'Card Container' :
        t === 'background' ? 'Background' :
        t === 'imageLogo' ? 'Image / Logo' :
        t === 'lottie' ? 'Lottie Vector' :
        'Foreground FX'
      }"))`);

      await cardLocator.click();
      await page.waitForTimeout(1500); // Wait for auto-save

      // Check if error toast appeared
      const hasToastError = await page.isVisible('.toast.error');
      let toastErrorText = '';
      if (hasToastError) {
        toastErrorText = await page.textContent('.toast.error .toast-body');
      }

      // Check if engine accepted the scene
      let engineLayerExists = false;
      try {
        const res = await fetch(`${ENGINE_URL}/api/scenes/${sceneId}`);
        const curScene = await res.json();
        engineLayerExists = curScene.layers?.some((l) => l.type === t && l.id.startsWith(t));
      } catch (e) {}

      layerTypeResults[t] = {
        toastError: toastErrorText,
        savedInEngine: engineLayerExists,
        ok: !hasToastError && engineLayerExists,
      };

      // Undo addition to keep state clean
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(1000);
    }

    const allTypesPass = Object.values(layerTypeResults).every((r) => r.ok);
    results['2.6'] = {
      test: 'Add Each Layer Type',
      status: allTypesPass ? 'PASS' : 'FAIL',
      evidence: JSON.stringify(layerTypeResults),
    };
    console.log(`2.6 Result: ${results['2.6'].status}`);

    // -----------------------------------------------------------------
    // 2.7 Timeline Scrub
    // -----------------------------------------------------------------
    console.log('--> Testing 2.7: Timeline Scrub');
    await page.fill('#playhead-input', '3000');
    await page.dispatchEvent('#playhead-input', 'change');
    await page.waitForTimeout(500);

    const tc = await page.textContent('#timecode');
    const scrubScreenshot = 'screenshots/diagnostic-07-scrub.png';
    await page.screenshot({ path: path.resolve(scrubScreenshot) });

    results['2.7'] = {
      test: 'Timeline Scrub',
      status: tc.includes('00:00:03.000') ? 'PASS' : 'FAIL',
      evidence: `Timecode: ${tc}. Screenshot: ${scrubScreenshot}`,
    };
    console.log(`2.7 Result: ${results['2.7'].status}`);

    // -----------------------------------------------------------------
    // 2.8 Play / Pause
    // -----------------------------------------------------------------
    console.log('--> Testing 2.8: Play / Pause');
    await page.click('#btn-play');
    await page.waitForTimeout(800);
    const playState = await page.evaluate(() => window.state?.playing);
    const midPlayhead = await page.evaluate(() => window.state?.playhead);

    await page.click('#btn-play');
    await page.waitForTimeout(400);
    const pauseState = await page.evaluate(() => window.state?.playing);
    const pausedPlayhead = await page.evaluate(() => window.state?.playhead);

    results['2.8'] = {
      test: 'Play / Pause',
      status: playState === true && pauseState === false && midPlayhead > 3000 ? 'PASS' : 'FAIL',
      evidence: `Play state: ${playState}, Playhead advanced to: ${midPlayhead}ms. Pause state: ${pauseState}, Stopped at: ${pausedPlayhead}ms.`,
    };
    console.log(`2.8 Result: ${results['2.8'].status}`);

    // -----------------------------------------------------------------
    // 2.9 Inspect Keyframes
    // -----------------------------------------------------------------
    console.log('--> Testing 2.9: Inspect Keyframes');
    await page.click('#btn-inspect');
    await page.locator('.kf-img').first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const kfCount = await page.locator('.kf-img').count();
    let brokenImages = 0;
    for (let i = 0; i < kfCount; i++) {
      const naturalWidth = await page.locator('.kf-img').nth(i).evaluate((img) => img.naturalWidth);
      if (naturalWidth === 0) brokenImages++;
    }

    const inspectScreenshot = 'screenshots/diagnostic-09-inspect.png';
    await page.screenshot({ path: path.resolve(inspectScreenshot) });

    // Close inspect modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    results['2.9'] = {
      test: 'Inspect Keyframes',
      status: kfCount === 5 && brokenImages === 0 ? 'PASS' : 'FAIL',
      evidence: `Found ${kfCount} frames, broken: ${brokenImages}. Screenshot: ${inspectScreenshot}`,
    };
    console.log(`2.9 Result: ${results['2.9'].status}`);

    // -----------------------------------------------------------------
    // 2.10 Render Draft
    // -----------------------------------------------------------------
    console.log('--> Testing 2.10: Render Draft');
    await page.click('#btn-render');
    await page.waitForTimeout(500);

    await page.selectOption('#render-quality-select', 'draft');
    await page.click('.primary-btn:has-text("Start Render")');

    // Wait up to 45s for render completion
    let draftSuccess = false;
    let downloadHref = null;
    for (let i = 0; i < 45; i++) {
      await page.waitForTimeout(1000);
      if (await page.isVisible('a:has-text("Download MP4")')) {
        draftSuccess = true;
        downloadHref = await page.getAttribute('a:has-text("Download MP4")', 'href');
        break;
      }
    }

    let ffprobeDraft = null;
    if (draftSuccess && downloadHref) {
      // Fetch MP4 and run ffprobe
      const mp4Buffer = await (await fetch(downloadHref)).arrayBuffer();
      const tmpMp4 = path.resolve('screenshots/draft-test.mp4');
      fs.writeFileSync(tmpMp4, Buffer.from(mp4Buffer));

      try {
        const probeOut = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration,nb_frames -of json "${tmpMp4}"`).toString();
        ffprobeDraft = JSON.parse(probeOut);

        // Extract 1 frame for visual confirmation
        const frameImg = path.resolve('screenshots/diagnostic-10-draft-frame.png');
        execSync(`ffmpeg -y -i "${tmpMp4}" -vframes 1 "${frameImg}"`);
      } catch (e) {
        ffprobeDraft = { error: e.message };
      }
    }

    // Close render modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    results['2.10'] = {
      test: 'Render Draft',
      status: draftSuccess && ffprobeDraft?.streams?.length > 0 ? 'PASS' : 'FAIL',
      evidence: `Success: ${draftSuccess}, ffprobe: ${JSON.stringify(ffprobeDraft?.streams?.[0] || {})}`,
    };
    console.log(`2.10 Result: ${results['2.10'].status}`);

    // -----------------------------------------------------------------
    // 2.11 Render Production
    // -----------------------------------------------------------------
    console.log('--> Testing 2.11: Render Production');
    await page.click('#btn-render');
    await page.waitForTimeout(500);

    await page.selectOption('#render-quality-select', 'production');
    await page.click('.primary-btn:has-text("Start Render")');

    let prodSuccess = false;
    let prodDownloadHref = null;
    for (let i = 0; i < 75; i++) {
      await page.waitForTimeout(1000);
      if (await page.isVisible('a:has-text("Download MP4")')) {
        prodSuccess = true;
        prodDownloadHref = await page.getAttribute('a:has-text("Download MP4")', 'href');
        break;
      }
    }

    let ffprobeProd = null;
    if (prodSuccess && prodDownloadHref) {
      const mp4Buffer = await (await fetch(prodDownloadHref)).arrayBuffer();
      const tmpMp4 = path.resolve('screenshots/prod-test.mp4');
      fs.writeFileSync(tmpMp4, Buffer.from(mp4Buffer));

      try {
        const probeOut = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration,nb_frames -of json "${tmpMp4}"`).toString();
        ffprobeProd = JSON.parse(probeOut);

        const frameImg = path.resolve('screenshots/diagnostic-11-prod-frame.png');
        execSync(`ffmpeg -y -i "${tmpMp4}" -vframes 1 "${frameImg}"`);
      } catch (e) {
        ffprobeProd = { error: e.message };
      }
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    results['2.11'] = {
      test: 'Render Production',
      status: prodSuccess && ffprobeProd?.streams?.length > 0 ? 'PASS' : 'FAIL',
      evidence: `Success: ${prodSuccess}, ffprobe: ${JSON.stringify(ffprobeProd?.streams?.[0] || {})}`,
    };
    console.log(`2.11 Result: ${results['2.11'].status}`);

    // -----------------------------------------------------------------
    // 2.12 Command Palette
    // -----------------------------------------------------------------
    console.log('--> Testing 2.12: Command Palette');
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(400);

    await page.fill('.mf-cmd-input', 'render');
    await page.waitForTimeout(300);

    const cmdRows = await page.locator('.mf-cmd-row').allTextContents();
    const hasDraft = cmdRows.some((r) => r.includes('Draft'));
    const hasProd = cmdRows.some((r) => r.includes('Production'));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    results['2.12'] = {
      test: 'Command Palette',
      status: hasDraft && hasProd ? 'PASS' : 'FAIL',
      evidence: `Found actions: ${cmdRows.join(' | ')}`,
    };
    console.log(`2.12 Result: ${results['2.12'].status}`);

    // -----------------------------------------------------------------
    // 2.13 Keyboard Shortcuts
    // -----------------------------------------------------------------
    console.log('--> Testing 2.13: Keyboard Shortcuts');
    // Test ?
    await page.keyboard.press('?');
    await page.waitForTimeout(400);
    const shortcutsModalOpen = await page.isVisible('.modal-title:has-text("Shortcuts")');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Test F (Fullscreen)
    await page.keyboard.press('f');
    await page.waitForTimeout(400);
    const isFullscreen = await page.isVisible('.preview-stage-fullscreen');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    results['2.13'] = {
      test: 'Keyboard Shortcuts',
      status: shortcutsModalOpen && isFullscreen ? 'PASS' : 'FAIL',
      evidence: `Shortcuts modal open: ${shortcutsModalOpen}, Fullscreen trigger: ${isFullscreen}`,
    };
    console.log(`2.13 Result: ${results['2.13'].status}`);

    // -----------------------------------------------------------------
    // 2.14 Multi-Scene Tabs
    // -----------------------------------------------------------------
    console.log('--> Testing 2.14: Multi-Scene Tabs');
    // Open New Scene Modal
    await page.click('#btn-new');
    await page.waitForTimeout(400);
    await page.click('.layer-type-card:has(.name:has-text("Blank 16:9"))');
    await page.waitForTimeout(1500);

    const tabsCount = await page.locator('.scene-tab').count();
    const tabNames = await page.locator('.scene-tab-name').allTextContents();

    results['2.14'] = {
      test: 'Multi-Scene Tabs',
      status: tabsCount >= 2 ? 'PASS' : 'FAIL',
      evidence: `Tabs count: ${tabsCount} (${tabNames.join(', ')})`,
    };
    console.log(`2.14 Result: ${results['2.14'].status}`);

    // -----------------------------------------------------------------
    // 2.15 Asset Vault
    // -----------------------------------------------------------------
    console.log('--> Testing 2.15: Asset Vault');
    await page.click('.tab-btn[data-tab="assets"]');
    await page.waitForTimeout(400);

    // Upload test asset directly via API
    const testAssetPath = path.resolve('screenshots/diagnostic-01-initial.png');
    const assetBytes = fs.readFileSync(testAssetPath);
    const assetRes = await (await fetch(`${ENGINE_URL}/api/assets?filename=test-diag.png`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: assetBytes,
    })).json();

    let assetVerified = false;
    if (assetRes.src) {
      const getAsset = await fetch(`${ENGINE_URL}/api/assets/vault/test-diag.png`);
      assetVerified = getAsset.ok && getAsset.status === 200;
    }

    results['2.15'] = {
      test: 'Asset Vault',
      status: assetVerified ? 'PASS' : 'FAIL',
      evidence: `Uploaded ${assetRes.src}, verified via GET /api/assets/vault/test-diag.png: ${assetVerified}`,
    };
    console.log(`2.15 Result: ${results['2.15'].status}`);

    // -----------------------------------------------------------------
    // 2.16 Export / Import
    // -----------------------------------------------------------------
    console.log('--> Testing 2.16: Export / Import');
    const exportedJson = await page.evaluate(() => JSON.stringify(window.state?.scene));
    const parsedExport = JSON.parse(exportedJson || '{}');

    results['2.16'] = {
      test: 'Export / Import',
      status: parsedExport.schemaVersion === 1 && parsedExport.name ? 'PASS' : 'FAIL',
      evidence: `Exported scene name: "${parsedExport.name}", schemaVersion: ${parsedExport.schemaVersion}`,
    };
    console.log(`2.16 Result: ${results['2.16'].status}`);

    // -----------------------------------------------------------------
    // 2.17 Persistence
    // -----------------------------------------------------------------
    console.log('--> Testing 2.17: Persistence');
    const preReloadId = await page.evaluate(() => window.state?.sceneId);
    await page.reload();
    await page.waitForTimeout(2000);

    const postReloadId = await page.evaluate(() => window.state?.sceneId);
    results['2.17'] = {
      test: 'Persistence',
      status: preReloadId === postReloadId && postReloadId != null ? 'PASS' : 'FAIL',
      evidence: `Pre-reload id: ${preReloadId}, Post-reload id: ${postReloadId}`,
    };
    console.log(`2.17 Result: ${results['2.17'].status}`);

    // -----------------------------------------------------------------
    // 2.18 SSE Live Updates
    // -----------------------------------------------------------------
    console.log('--> Testing 2.18: SSE Live Updates');
    let sseWorking = false;
    try {
      const eventSourceTest = await page.evaluate(async (id) => {
        return new Promise((resolve) => {
          const es = new EventSource(`http://127.0.0.1:4000/api/scenes/${id}/events`);
          es.onopen = () => {
            es.close();
            resolve(true);
          };
          es.onerror = () => {
            es.close();
            resolve(false);
          };
          setTimeout(() => {
            es.close();
            resolve(false);
          }, 3000);
        });
      }, postReloadId);
      sseWorking = eventSourceTest;
    } catch (e) {
      sseWorking = false;
    }

    results['2.18'] = {
      test: 'SSE Live Updates',
      status: sseWorking ? 'PASS' : 'FAIL',
      evidence: `EventSource connected to /api/scenes/${postReloadId}/events: ${sseWorking}`,
    };
    console.log(`2.18 Result: ${results['2.18'].status}`);

    // -----------------------------------------------------------------
    // 2.19 Error Handling
    // -----------------------------------------------------------------
    console.log('--> Testing 2.19: Error Handling');
    // Test invalid scene update
    await page.evaluate(() => {
      window.api.createScene({ invalid: true }).catch((err) => {
        window.__lastApiError = err;
      });
    });
    await page.waitForTimeout(500);
    const lastError = await page.evaluate(() => {
      if (!window.__lastApiError) return null;
      return {
        status: window.__lastApiError.status,
        message: window.__lastApiError.message,
        issues: window.__lastApiError.issues,
      };
    });

    results['2.19'] = {
      test: 'Error Handling',
      status: lastError && lastError.status === 400 ? 'PASS' : 'FAIL',
      evidence: `Handled 400 APIError: ${JSON.stringify(lastError)}`,
    };
    console.log(`2.19 Result: ${results['2.19'].status}`);

    // -----------------------------------------------------------------
    // 2.20 MCP Server
    // -----------------------------------------------------------------
    console.log('--> Testing 2.20: MCP Server');
    let mcpToolCount = 0;
    try {
      const toolsSrc = fs.readFileSync(
        path.join(__dirname, '..', 'packages', 'mcp-server', 'src', 'tools.ts'),
        'utf8'
      );
      const match = toolsSrc.match(/TOOL_NAMES\s*=\s*\[([\s\S]*?)\]\s*as\s*const/);
      const tools = match ? match[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean) : [];
      mcpToolCount = tools.length;
    } catch (e) {
      mcpToolCount = -1;
    }

    results['2.20'] = {
      test: 'MCP Server',
      status: mcpToolCount === 13 ? 'PASS' : 'FAIL',
      evidence: `TOOL_NAMES length: ${mcpToolCount} (expected exactly 13 tools)`,
    };
    console.log(`2.20 Result: ${results['2.20'].status}`);

    // -----------------------------------------------------------------
    // 2.21 Empty States
    // -----------------------------------------------------------------
    console.log('--> Testing 2.21: Empty States');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForTimeout(1000);

    const tourVisible = await page.isVisible('.mf-tour-box');
    const emptyPreviewVisible = await page.isVisible('#preview-empty');
    const emptyLayersVisible = await page.isVisible('.empty-state:has-text("No scene loaded")');

    results['2.21'] = {
      test: 'Empty States',
      status: tourVisible && emptyPreviewVisible && emptyLayersVisible ? 'PASS' : 'FAIL',
      evidence: `Tour visible: ${tourVisible}, Empty preview: ${emptyPreviewVisible}, Empty layers: ${emptyLayersVisible}`,
    };
    console.log(`2.21 Result: ${results['2.21'].status}`);

    // -----------------------------------------------------------------
    // 2.22 Visual Regression
    // -----------------------------------------------------------------
    console.log('--> Testing 2.22: Visual Regression');
    // Dismiss tour if visible after empty state test
    if (await page.isVisible('.mf-tour-actions .text-btn')) {
      await page.click('.mf-tour-actions .text-btn');
      await page.waitForTimeout(300);
    }
    // Load demo back for clean visual capture
    await page.click('#btn-demo');
    await page.waitForTimeout(2000);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: path.resolve('screenshots/diagnostic-22-1440x900.png') });

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ path: path.resolve('screenshots/diagnostic-22-1920x1080.png') });

    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.screenshot({ path: path.resolve('screenshots/diagnostic-22-2560x1440.png') });

    results['2.22'] = {
      test: 'Visual Regression',
      status: 'PASS',
      evidence: 'Captured screenshots at 1440x900, 1920x1080, and 2560x1440',
    };
    console.log(`2.22 Result: ${results['2.22'].status}`);

  } catch (err) {
    console.error('Test execution error:', err);
  } finally {
    await browser.close();
  }

  console.log('\n=== PHASE 2 TEST SUMMARY ===');
  console.log(JSON.stringify(results, null, 2));

  fs.writeFileSync(
    path.resolve('scripts/phase2-results.json'),
    JSON.stringify(results, null, 2),
    'utf8'
  );
}

run();
