// ============================================================
// MotionForge Studio — Main Application Entry Point
// Modular ES Module Architecture
// ============================================================

// Desktop Electron Shim
if (window.motionforge?.engineUrl) {
  console.log('[desktop] Running inside Electron with engine at:', window.motionforge.engineUrl);
}

import { api } from './js/api.js';
import { store, state } from './js/state.js';
import { toast } from './js/ui/toast.js';
import { modal } from './js/ui/modal.js';
import { tooltip } from './js/ui/tooltip.js';
import { commandPalette } from './js/ui/command-palette.js';
import { onboarding } from './js/ui/onboarding.js';
import { initKeyboardShortcuts, openShortcutsModal } from './js/ui/shortcuts.js';
import { layersPanel } from './js/panels/layers.js';
import { inspectorPanel } from './js/panels/inspector.js';
import { capabilitiesPanel } from './js/panels/capabilities.js';
import { timelinePanel } from './js/panels/timeline.js';
import { previewPanel } from './js/panels/preview.js';
import { assetsPanel } from './js/panels/assets.js';
import { renderQueuePanel } from './js/panels/render-queue.js';
import { SCENE_TEMPLATES } from './js/panels/templates.js';
import { $, $$, h, debounce } from './js/util/dom.js';
import { fmtTime } from './js/util/time.js';
import { validateScene } from './js/util/validate.js';

// Expose global action hooks for keyboard shortcuts and panels
window.state = state;
window.store = store;
window.api = api;
window.__mf_duplicateLayer = (l) => layersPanel.duplicateLayer(l);
window.__mf_deleteLayer = (id) => layersPanel.deleteLayer(id);
window.__mf_loadScene = (id) => loadScene(id);
window.__mf_loadDemoScene = () => loadDemoScene();

// ---------- DEMO SCENE SPEC ----------
const DEMO_SCENE = {
  schemaVersion: 1,
  id: 'demo-' + Date.now().toString(36),
  name: 'MotionForge Demo',
  canvas: { shape: '16:9', scale: 1080 },
  durationMs: 8000,
  assets: [],
  fonts: [],
  layers: [
    {
      id: 'bg',
      type: 'background',
      variant: { variant: 'solid', color: '#101017' },
    },
    {
      id: 'title',
      type: 'kineticText',
      at: 400,
      duration: 4000,
      text: 'MotionForge',
      sizePx: 140,
      position: { xPct: 50, yPct: 45 },
      fill: '#ffffff',
      animateBy: 'word',
      entrance: { name: 'springPop', durationMs: 900 },
      exit: { name: 'scaleDownFade', durationMs: 600 },
    },
    {
      id: 'subtitle',
      type: 'kineticText',
      at: 1200,
      duration: 3200,
      text: 'Programmatic Motion Graphics',
      sizePx: 40,
      position: { xPct: 50, yPct: 62 },
      fill: '#fbbf24',
      animateBy: 'word',
      entrance: { name: 'smoothSlideUp', durationMs: 700, staggerMs: 60 },
      exit: { name: 'scaleDownFade', durationMs: 500 },
    },
    {
      id: 'card',
      type: 'card',
      at: 4500,
      duration: 3500,
      position: { xPct: 50, yPct: 50 },
      variant: {
        variant: 'glassCard',
        title: 'Studio Overhaul',
        body: 'Desktop-grade precision authoring with Cinematic Amber.',
        widthPx: 900,
        paddingPx: 40,
        radiusPx: 20,
        glass: { blurPx: 20, tintColor: '#f59e0b', tintOpacity: 0.1 },
      },
      entrance: { name: 'springPop', durationMs: 800 },
    },
  ],
  camera: {
    keyframes: [
      { at: 0, scale: 1, xPct: 50, yPct: 50 },
      { at: 4500, scale: 1.1, xPct: 50, yPct: 50, ease: 'power2.inOut' },
    ],
  },
};

// ---------- ROTATING PRO TIPS ----------
const PRO_TIPS = [
  'Press ⌘K or Ctrl+K anytime to open the Command Palette and access any layer or tool.',
  'Press Ctrl+Z to undo and Ctrl+Shift+Z to redo up to 50 operations.',
  'Hold Ctrl and scroll the timeline wheel to zoom in on complex keyframe timings.',
  'Press Space to play or pause, and use ← and → arrow keys to step frame by frame.',
  'Press F to toggle distraction-free Fullscreen preview mode.',
  'Drag and drop media files onto the preview stage to upload them directly into the vault.',
];

function initHelpTipBar() {
  const bar = $('#help-tip-bar');
  const textEl = $('#help-tip-text');
  const closeBtn = $('#btn-close-tip');
  if (!bar || !textEl) return;

  if (localStorage.getItem('motionforge_dismiss_tips') === 'true') {
    bar.classList.add('hidden');
    return;
  }

  let tipIndex = 0;
  textEl.textContent = PRO_TIPS[0];

  const interval = setInterval(() => {
    tipIndex = (tipIndex + 1) % PRO_TIPS.length;
    textEl.style.opacity = '0';
    setTimeout(() => {
      textEl.textContent = PRO_TIPS[tipIndex];
      textEl.style.opacity = '1';
    }, 200);
  }, 8000);

  closeBtn?.addEventListener('click', () => {
    clearInterval(interval);
    bar.classList.add('hidden');
    localStorage.setItem('motionforge_dismiss_tips', 'true');
  });
}

// ---------- AUTO-SAVE ROUTINE ----------
const debouncedSave = debounce(async () => {
  if (!state.scene || !state.dirty) return;
  await saveCurrentScene();
}, 700);

async function saveCurrentScene() {
  if (!state.scene) return;
  const validation = validateScene(state.scene);
  if (!validation.ok) {
    store.setSaveStatus('failed');
    toast.error('Validation Error', validation.issues[0]);
    return;
  }

  store.setSaveStatus('saving');
  try {
    const res = await api.createScene(state.scene);
    store.setSaveStatus('saved');
    if (res.warnings && res.warnings.length > 0) {
      toast.warn('Engine Warning', res.warnings[0].message);
    }
  } catch (err) {
    store.setSaveStatus('failed');
    toast.error('Save Failed', err.message, {
      label: 'Retry',
      onClick: () => saveCurrentScene(),
    });
  }
}

// Update Auto-Save Indicator UI
function updateSaveIndicator(status) {
  const el = $('#save-indicator');
  const text = el?.querySelector('.save-text');
  const icon = el?.querySelector('.save-icon');
  if (!el || !text) return;

  el.className = `save-indicator ${status}`;
  if (status === 'saved') {
    icon.textContent = '✓';
    text.textContent = 'Saved';
  } else if (status === 'saving') {
    icon.textContent = '◌';
    text.textContent = 'Saving…';
  } else if (status === 'unsaved') {
    icon.textContent = '●';
    text.textContent = 'Unsaved';
  } else if (status === 'failed') {
    icon.textContent = '⚠';
    text.textContent = 'Save failed';
  }
}

// ---------- SCENE TABS ----------
function renderSceneTabs() {
  const tabsContainer = $('#scene-tabs');
  if (!tabsContainer) return;
  tabsContainer.innerHTML = '';

  const openScenes = state.openScenes || [];
  if (!openScenes.length && state.sceneId) {
    openScenes.push(state.sceneId);
  }

  openScenes.forEach((id) => {
    const isActive = id === state.sceneId;
    const tabEl = h(
      'div',
      {
        class: `scene-tab ${isActive ? 'active' : ''}`,
        role: 'tab',
        'aria-selected': isActive ? 'true' : 'false',
        onClick: () => {
          if (!isActive) loadScene(id);
        },
      },
      isActive && state.dirty ? h('span', { class: 'scene-tab-dirty' }) : null,
      h('span', { class: 'scene-tab-name' }, id),
      h(
        'button',
        {
          class: 'scene-tab-close',
          'aria-label': `Close tab ${id}`,
          onClick: (e) => {
            e.stopPropagation();
            closeSceneTab(id);
          },
        },
        '×'
      )
    );
    tabsContainer.appendChild(tabEl);
  });
}

function closeSceneTab(id) {
  state.openScenes = state.openScenes.filter((s) => s !== id);
  store.saveOpenScenes();
  if (state.sceneId === id) {
    const next = state.openScenes[0];
    if (next) loadScene(next);
    else store.setScene(null, null);
  }
  renderSceneTabs();
}

// ---------- SCENE LOADING ----------
async function loadScene(id) {
  setStatus('Loading ' + id + '…', 'busy');
  try {
    const scene = await api.getScene(id);
    store.setScene(scene, id);
    setStatus('Ready', 'online');
    toast.success('Scene Loaded', `Loaded "${scene.name || id}"`);
    renderSceneTabs();
  } catch (e) {
    setStatus('Failed to load ' + id, 'offline');
    toast.error('Load Failed', e.message);
  }
}

async function loadDemoScene() {
  setStatus('Loading demo…', 'busy');
  try {
    const res = await api.createScene(DEMO_SCENE);
    store.setScene(DEMO_SCENE, res.id);
    setStatus('Ready', 'online');
    toast.success('Demo Loaded', 'Demo scene initialized and active.');
    renderSceneTabs();
  } catch (e) {
    setStatus('Failed to load demo', 'offline');
    toast.error('Demo Error', e.message);
  }
}

// ---------- STATUSBAR HELPERS ----------
function setStatus(msg, type = 'online') {
  const messageEl = $('#status-message');
  const dotEl = $('#status-dot');
  if (messageEl) messageEl.textContent = msg;
  if (dotEl) dotEl.className = 'dot ' + type;
}

function updateStatusbarStats() {
  const sceneEl = $('#status-scene');
  const layersEl = $('#status-layers');
  const titleEl = $('#scene-title');

  if (sceneEl) sceneEl.textContent = state.scene ? (state.scene.name || state.scene.id) : 'No scene';
  if (layersEl) layersEl.textContent = `${state.scene?.layers?.length || 0} layers`;
  if (titleEl) titleEl.textContent = state.scene ? (state.scene.name || state.scene.id) : 'No scene';
}

// ---------- MODAL DIALOGS ----------

// New Scene Templates Modal
function openNewSceneModal() {
  const container = h('div', { class: 'templates-wrap' });
  const grid = h('div', { class: 'layer-type-grid' });

  SCENE_TEMPLATES.forEach((tpl) => {
    const card = h(
      'div',
      {
        class: 'layer-type-card',
        onClick: async () => {
          modal.close();
          const spec = structuredClone(tpl.spec);
          spec.id = `scene-${Date.now().toString(36)}`;
          try {
            const res = await api.createScene(spec);
            store.setScene(spec, res.id);
            toast.success('Scene Created', `Started from "${tpl.name}"`);
            renderSceneTabs();
          } catch (err) {
            toast.error('Creation Failed', err.message);
          }
        },
      },
      h('div', { class: 'name' }, tpl.name),
      h('div', { class: 'desc' }, tpl.description)
    );
    grid.appendChild(card);
  });

  container.appendChild(grid);

  modal.open({
    title: 'Create New Scene',
    subtitle: 'Choose a canvas aspect ratio and starting motion template',
    content: container,
    actions: [{ label: 'Cancel', type: 'secondary', close: true }],
  });
}

// Load Scene Modal (with recents)
function openLoadSceneModal() {
  const container = h('div', { class: 'load-modal-wrap' });

  // Custom ID Input
  const inputWrap = h(
    'div',
    { style: 'margin-bottom: 20px;' },
    h('label', { class: 'insp-label', style: 'margin-bottom: 6px;' }, 'Enter Scene Identifier:'),
    h('div', { style: 'display: flex; gap: 8px;' },
      h('input', {
        id: 'modal-scene-id-input',
        class: 'insp-input',
        placeholder: 'e.g., scene-abc123 or demo-xxx',
        style: 'flex: 1;',
      }),
      h('button', {
        class: 'primary-btn',
        onClick: () => {
          const id = $('#modal-scene-id-input')?.value.trim();
          if (id) {
            modal.close();
            loadScene(id);
          }
        },
      }, 'Load')
    )
  );
  container.appendChild(inputWrap);

  // Recents List
  if (state.recentScenes?.length) {
    container.appendChild(h('div', { class: 'insp-section-title', style: 'margin-bottom: 8px;' }, 'Recent Scenes'));
    const recentsList = h('div', { style: 'max-height: 220px; overflow-y: auto;' });

    state.recentScenes.forEach((rec) => {
      const row = h(
        'div',
        {
          class: 'mf-context-item',
          style: 'display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; margin-bottom: 4px; background: var(--bg-2); border-radius: var(--radius); cursor: pointer;',
          onClick: () => {
            modal.close();
            loadScene(rec.id);
          },
        },
        h('span', { style: 'font-weight: 500;' }, rec.name || rec.id),
        h('span', { style: 'font-size: 11px; color: var(--text-3); font-family: monospace;' }, rec.id)
      );
      recentsList.appendChild(row);
    });
    container.appendChild(recentsList);
  }

  modal.open({
    title: 'Load Scene',
    subtitle: 'Open an existing scene from the engine or select from recents',
    content: container,
    actions: [{ label: 'Cancel', type: 'secondary', close: true }],
  });

  setTimeout(() => $('#modal-scene-id-input')?.focus(), 50);
}

// Add Layer Picker Modal
function openAddLayerModal() {
  const container = h('div', { class: 'layer-type-grid' });
  const types = [
    { type: 'kineticText', name: 'Kinetic Text', desc: 'Animated text with word, character, or line stagger masks.' },
    { type: 'card', name: 'Card Container', desc: 'Glassmorphic card, callout pill, progress bar, or counter.' },
    { type: 'imageLogo', name: 'Image / Logo', desc: 'Bitmap asset with mask reveal, spring entrance, and sizing.' },
    { type: 'background', name: 'Background', desc: 'Solid color, mesh gradient, or particles behind stage.' },
    { type: 'lottie', name: 'Lottie Vector', desc: 'Vector animation scrubbed synchronously with timeline.' },
    { type: 'foregroundFX', name: 'Foreground FX', desc: 'Color grading, film grain, or vignette overlay.' },
  ];

  types.forEach((t) => {
    const card = h(
      'div',
      {
        class: 'layer-type-card',
        onClick: () => {
          modal.close();
          addLayerToScene(t.type);
        },
      },
      h('div', { class: 'name' }, t.name),
      h('div', { class: 'desc' }, t.desc)
    );
    container.appendChild(card);
  });

  modal.open({
    title: 'Add Layer',
    subtitle: 'Select the element type to place at the current playhead',
    content: container,
    actions: [{ label: 'Cancel', type: 'secondary', close: true }],
  });
}

function addLayerToScene(type) {
  if (!state.scene) {
    toast.warn('No Scene', 'Load or create a scene before adding layers.');
    return;
  }
  const id = `${type}-${Math.random().toString(36).slice(2, 7)}`;
  const base = { id, type, at: state.playhead, duration: 3000 };
  let newLayer;

  switch (type) {
    case 'kineticText':
      newLayer = { ...base, text: 'New Text', sizePx: 80, position: { xPct: 50, yPct: 50 }, fill: '#ffffff', entrance: { name: 'springPop' } };
      break;
    case 'background':
      newLayer = { ...base, variant: { variant: 'solid', color: '#101017' } };
      break;
    case 'card':
      newLayer = { ...base, position: { xPct: 50, yPct: 50 }, variant: { variant: 'glassCard', title: 'Card Title', body: 'Description', widthPx: 800, paddingPx: 32, radiusPx: 16 } };
      break;
    case 'imageLogo':
      newLayer = { ...base, assetId: 'logo', widthPx: 240, position: { xPct: 50, yPct: 50 } };
      break;
    case 'lottie':
      newLayer = { ...base, assetId: 'lottie', position: { xPct: 50, yPct: 50 } };
      break;
    case 'foregroundFX':
      newLayer = { ...base, effects: [{ kind: 'vignette', strength: 0.5, color: '#000000' }] };
      break;
    default:
      newLayer = base;
  }

  store.mutateScene((scene) => {
    if (type === 'imageLogo') {
      if (!scene.assets) scene.assets = [];
      if (!scene.assets.some((a) => a.id === 'logo')) {
        scene.assets.push({
          id: 'logo',
          kind: 'image',
          src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiB2aWV3Qm94PSIwIDAgMTAwIDEwMCI+PGNpcmNsZSBjeD0iNTAiIGN5PSI1MCIgcj0iNDAiIGZpbGw9IiNmNTllMGIiLz48L3N2Zz4=',
          name: 'Default Logo',
        });
      }
    } else if (type === 'lottie') {
      if (!scene.assets) scene.assets = [];
      if (!scene.assets.some((a) => a.id === 'lottie')) {
        scene.assets.push({
          id: 'lottie',
          kind: 'lottie',
          src: 'data:application/json;base64,eyJ2IjoiNS41LjciLCJmciI6NjAsImlwIjowLCJvcCI6NjAsInciOjIwMCwiaCI6MjAwLCJubWFyIjowLCJkZGQiOjAsImFzc2V0cyI6W10sImxheWVycyI6W119',
          name: 'Default Lottie',
        });
      }
    }
    scene.layers.push(newLayer);
    store.selectLayer(id);
  }, `Added ${type} layer`);
  toast.success('Layer Added', `Created ${id}`);
}

// Render Video Modal
function openRenderModal() {
  if (!state.scene || !state.sceneId) {
    toast.warn('No Scene', 'Load a scene to render.');
    return;
  }

  const container = h('div', { class: 'render-modal-wrap' });

  // Quality selector
  const qualitySelect = h(
    'div',
    { class: 'insp-field', style: 'margin-bottom: 16px;' },
    h('label', { class: 'insp-label' }, 'Render Quality Profile:'),
    h(
      'select',
      { class: 'insp-input', id: 'render-quality-select' },
      h('option', { value: 'draft' }, 'Draft (30fps, 540p, fast preview encoding)'),
      h('option', { value: 'production', selected: true }, 'Production (60fps, 1080p Full HD, NVENC/Pro profile)')
    )
  );
  container.appendChild(qualitySelect);

  const statusWrap = h('div', { id: 'render-status-wrap', class: 'hidden' });
  container.appendChild(statusWrap);

  modal.open({
    title: `Render Scene: ${state.scene.name || state.sceneId}`,
    subtitle: 'Encode scene frames in memory and assemble with FFmpeg pipeline',
    content: container,
    actions: [
      { label: 'Cancel', type: 'secondary', close: true },
      {
        label: 'Start Render',
        type: 'primary',
        close: false,
        onClick: async () => {
          const quality = $('#render-quality-select')?.value || 'production';
          await executeRender(state.sceneId, quality);
        },
      },
    ],
  });
}

async function executeRender(sceneId, quality) {
  const statusWrap = $('#render-status-wrap');
  if (statusWrap) {
    statusWrap.classList.remove('hidden');
    statusWrap.innerHTML = `
      <div class="render-progress">
        <div class="render-progress-bar" id="render-bar" style="width: 5%;"></div>
      </div>
      <div id="render-msg" style="font-size: 11px; color: var(--text-2); text-align: center;">Queuing render job…</div>
    `;
  }

  try {
    const jobRes = await api.startRender(sceneId, quality);
    const jobId = jobRes.jobId;
    renderQueuePanel.addJob(jobId, sceneId, quality);

    // Poll until complete or closed
    const pollInterval = setInterval(async () => {
      try {
        const job = await api.getRender(jobId);
        const bar = $('#render-bar');
        const msg = $('#render-msg');

        if (bar) bar.style.width = `${Math.max(5, Math.round((job.progress || 0) * 100))}%`;
        if (msg) msg.textContent = `Status: ${job.status} (${Math.round((job.progress || 0) * 100)}%)`;

        if (job.status === 'succeeded') {
          clearInterval(pollInterval);
          const fileUrl = api.renderFileUrl(jobId);
          if (statusWrap) {
            statusWrap.innerHTML = `
              <div style="text-align: center; padding: 12px 0;">
                <div style="color: var(--success); font-weight: 600; font-size: 15px; margin-bottom: 6px;">✓ Render Succeeded</div>
                <div style="font-size: 11px; color: var(--text-2); margin-bottom: 16px;">Video compiled at ${job.result?.effectiveFps || 60} fps</div>
                <a href="${fileUrl}" download="${sceneId}-${quality}.mp4" class="primary-btn" style="display: inline-flex; text-decoration: none;">Download MP4</a>
              </div>
            `;
          }
        } else if (job.status === 'failed') {
          clearInterval(pollInterval);
          if (msg) msg.textContent = `Error: ${job.error || 'Render failed'}`;
        }
      } catch (e) {
        clearInterval(pollInterval);
      }
    }, 1200);
  } catch (err) {
    toast.error('Render Failed', err.message);
  }
}

// Inspect Keyframe Stills Modal
async function openInspectModal() {
  if (!state.scene || !state.sceneId) {
    toast.warn('No Scene', 'Load a scene to inspect.');
    return;
  }

  toast.info('Rendering Stills...', 'Capturing exact frames from headless Playwright', 3000);
  try {
    const dur = state.scene.durationMs || 8000;
    const timestamps = [0, Math.round(dur * 0.25), Math.round(dur * 0.5), Math.round(dur * 0.75), Math.round(dur * 0.95)];

    const res = await api.inspect(state.sceneId, timestamps, false);
    const container = h('div', { class: 'kf-grid' });

    (res.frames || []).forEach((frame) => {
      const src = frame.preview || frame.image;
      const item = h(
        'div',
        { class: 'kf-item' },
        h('img', { class: 'kf-img', src, alt: `Keyframe at ${frame.atMs}ms` }),
        h('div', { class: 'kf-label' }, `Time: ${frame.atMs} ms (${fmtTime(frame.atMs)})`)
      );
      container.appendChild(item);
    });

    modal.open({
      title: `Keyframes Inspection: ${state.scene.name || state.sceneId}`,
      subtitle: `${res.frames?.length || 0} deterministically rendered frame stills`,
      content: container,
      wide: true,
      actions: [{ label: 'Done', type: 'primary', close: true }],
    });
  } catch (err) {
    toast.error('Inspect Failed', err.message);
  }
}

// ---------- COMMAND PALETTE ACTIONS ----------
function registerCommandPaletteActions() {
  commandPalette.registerAction({
    title: 'Render Production Video',
    description: 'Compile 60fps Full HD MP4',
    shortcut: 'Render',
    run: () => openRenderModal(),
  });
  commandPalette.registerAction({
    title: 'Render Draft Video',
    description: 'Fast preview 30fps MP4',
    shortcut: '',
    run: () => executeRender(state.sceneId, 'draft'),
  });
  commandPalette.registerAction({
    title: 'Inspect Keyframe Stills',
    description: 'Capture and review PNG previews at intervals',
    shortcut: '',
    run: () => openInspectModal(),
  });
  commandPalette.registerAction({
    title: 'New Scene from Template',
    description: 'Open template picker for blank or preset scenes',
    shortcut: 'Ctrl+N',
    run: () => openNewSceneModal(),
  });
  commandPalette.registerAction({
    title: 'Load Scene by ID',
    description: 'Load an existing scene or open from recents',
    shortcut: 'Ctrl+O',
    run: () => openLoadSceneModal(),
  });
  commandPalette.registerAction({
    title: 'Load Demo Scene',
    description: 'Load standard MotionForge showcase scene',
    shortcut: '',
    run: () => loadDemoScene(),
  });
  commandPalette.registerAction({
    title: 'Add New Layer',
    description: 'Insert text, card, logo, or background at playhead',
    shortcut: '',
    run: () => openAddLayerModal(),
  });
  commandPalette.registerAction({
    title: 'Toggle Fullscreen Mode',
    description: 'View preview in immersive fullscreen',
    shortcut: 'F',
    run: () => previewPanel.toggleFullscreen(),
  });
  commandPalette.registerAction({
    title: 'Open Render Queue',
    description: 'View active rendering jobs and download history',
    shortcut: '',
    run: () => renderQueuePanel.openQueueModal(),
  });
  commandPalette.registerAction({
    title: 'Show Keyboard Shortcuts',
    description: 'View full cheat sheet of keyboard hotkeys',
    shortcut: '?',
    run: () => openShortcutsModal(),
  });
}

// ---------- PLAYHEAD / TRANSPORT WIRE-UP ----------
function initTransport() {
  const btnPrev = $('#btn-prev');
  const btnPlay = $('#btn-play');
  const btnNext = $('#btn-next');
  const playheadInput = $('#playhead-input');
  const timecodeEl = $('#timecode');
  const durationLabel = $('#duration-label');

  btnPlay?.addEventListener('click', () => {
    store.setPlaying(!state.playing);
  });

  btnPrev?.addEventListener('click', () => {
    store.setPlayhead(state.playhead - 100);
  });

  btnNext?.addEventListener('click', () => {
    store.setPlayhead(state.playhead + 100);
  });

  playheadInput?.addEventListener('change', (e) => {
    store.setPlayhead(Number(e.target.value));
  });

  // Timeline Snap Button
  const btnSnap = $('#btn-snap');
  btnSnap?.addEventListener('click', () => {
    state.snapEnabled = !state.snapEnabled;
    btnSnap.classList.toggle('active', state.snapEnabled);
    btnSnap.textContent = state.snapEnabled ? 'Snap: ON' : 'Snap: OFF';
    toast.info('Snap Mode', state.snapEnabled ? 'Magnetic snapping enabled' : 'Free scrubbing enabled');
  });

  // Fullscreen Button
  $('#btn-fullscreen')?.addEventListener('click', () => previewPanel.toggleFullscreen());

  // Store subscription for timecode updates
  store.subscribe((event, s, payload) => {
    if (event === 'playhead:moved') {
      if (playheadInput && playheadInput !== document.activeElement) {
        playheadInput.value = payload;
      }
      if (timecodeEl) timecodeEl.textContent = fmtTime(payload);
      const fsTimecode = $('#fs-timecode');
      if (fsTimecode) fsTimecode.textContent = fmtTime(payload);

      // Update ARIA slider
      const canvasEl = $('#timeline-canvas');
      if (canvasEl) canvasEl.setAttribute('aria-valuenow', payload);
    } else if (event === 'playback:changed') {
      if (btnPlay) {
        btnPlay.textContent = payload ? '⏸' : '▶';
      }
    } else if (event === 'scene:loaded') {
      if (durationLabel) {
        durationLabel.textContent = `${s.scene?.durationMs || 0} ms total`;
      }
      const canvasEl = $('#timeline-canvas');
      if (canvasEl && s.scene?.durationMs) {
        canvasEl.setAttribute('aria-valuemax', s.scene.durationMs);
      }
    }
  });

  // Playback requestAnimationFrame tick when playing
  let lastTick = performance.now();
  function playTick(now) {
    if (state.playing && state.scene) {
      const delta = now - lastTick;
      const next = state.playhead + delta;
      if (next >= state.scene.durationMs) {
        store.setPlayhead(0);
        store.setPlaying(false);
      } else {
        store.setPlayhead(next);
      }
    }
    lastTick = now;
    requestAnimationFrame(playTick);
  }
  requestAnimationFrame(playTick);
}

// ---------- UI TABS SWITCHING ----------
function initTabs() {
  $$('.panel-tabs').forEach((tabsContainer) => {
    tabsContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;

      const tabName = btn.dataset.tab;
      const parentPanel = tabsContainer.closest('.panel');

      // Update active tab buttons
      $$('.tab-btn', tabsContainer).forEach((b) => {
        const isSelected = b === btn;
        b.classList.toggle('active', isSelected);
        b.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      });

      // Update active panel content
      $$('.panel-content', parentPanel).forEach((panel) => {
        panel.classList.toggle('hidden', panel.dataset.panel !== tabName);
      });
    });
  });
}

function initDesktopMenuIntegration() {
  if (!window.motionforge?.onMenuAction) return;

  window.motionforge.onMenuAction((action, payload) => {
    switch (action) {
      case 'new-project':
        openNewSceneModal();
        break;
      case 'save-project':
      case 'save-project-as':
        if (state.scene) {
          const projectData = {
            schemaVersion: 1,
            name: state.scene.name || 'Untitled Project',
            sceneId: state.sceneId,
            scene: state.scene,
            openScenes: state.openScenes,
            activeTab: state.sceneId,
            panelLayout: {
              activeLeftTab: state.activeLeftTab,
              activeRightTab: state.activeRightTab,
            },
          };
          window.motionforge
            .saveProjectFile({ content: JSON.stringify(projectData, null, 2) })
            .then((res) => {
              if (!res.canceled) {
                store.setSaveStatus('saved');
                toast.success('Project Saved', res.filePath || 'Saved project file');
              }
            });
        }
        break;
      case 'open-project-content':
        if (payload?.content) {
          try {
            const data = JSON.parse(payload.content);
            if (data.scene) {
              const sid = data.sceneId || data.scene.id || 'loaded-project';
              store.setScene(data.scene, sid);
              api.saveScene(data.scene).catch(() => {});
              toast.success('Project Opened', data.name || sid);
            }
          } catch (e) {
            toast.error('Project Open Error', e.message);
          }
        }
        break;
      case 'undo': {
        const desc = store.undo();
        if (desc) toast.info('Undone', desc);
        break;
      }
      case 'redo': {
        const desc = store.redo();
        if (desc) toast.info('Redone', desc);
        break;
      }
      case 'render-draft':
        if (state.sceneId) executeRender(state.sceneId, 'draft');
        break;
      case 'render-production':
        if (state.sceneId) executeRender(state.sceneId, 'production');
        break;
      case 'open-queue':
        renderQueuePanel.openQueueModal();
        break;
      case 'open-shortcuts':
        openShortcutsModal();
        break;
      case 'open-command-palette':
        commandPalette.open();
        break;
      case 'canvas-fit':
        previewPanel.fitStage?.();
        break;
      case 'canvas-actual-size':
        previewPanel.resetZoom?.();
        break;
    }
  });
}

// ---------- BOOTSTRAP INITIALIZATION ----------
async function boot() {
  console.log('[MotionForge Studio] Booting studio workstation...');

  // Initialize UI systems
  initHelpTipBar();
  initTabs();
  initTransport();
  registerCommandPaletteActions();
  initDesktopMenuIntegration();

  // Wire titlebar buttons
  $('#btn-new')?.addEventListener('click', () => openNewSceneModal());
  $('#btn-load')?.addEventListener('click', () => openLoadSceneModal());
  $('#btn-load-2')?.addEventListener('click', () => openLoadSceneModal());
  $('#btn-demo')?.addEventListener('click', () => loadDemoScene());
  $('#btn-inspect')?.addEventListener('click', () => openInspectModal());
  $('#btn-render')?.addEventListener('click', () => openRenderModal());
  $('#btn-palette')?.addEventListener('click', () => commandPalette.toggle());
  $('#btn-queue')?.addEventListener('click', () => renderQueuePanel.openQueueModal());
  $('#btn-shortcuts')?.addEventListener('click', () => openShortcutsModal());
  $('#btn-add-layer')?.addEventListener('click', () => openAddLayerModal());
  $('#save-indicator')?.addEventListener('click', () => saveCurrentScene());

  $('#btn-preview-tab')?.addEventListener('click', () => {
    if (state.sceneId) {
      window.open(api.previewUrl(state.sceneId), '_blank');
    }
  });

  // Undo / Redo Buttons
  const btnUndo = $('#btn-undo');
  const btnRedo = $('#btn-redo');
  btnUndo?.addEventListener('click', () => {
    const desc = store.undo();
    if (desc) toast.info('Undone', desc);
  });
  btnRedo?.addEventListener('click', () => {
    const desc = store.redo();
    if (desc) toast.info('Redone', desc);
  });

  store.subscribe((event, s, payload) => {
    if (event === 'history:changed') {
      if (btnUndo) btnUndo.disabled = !payload.canUndo;
      if (btnRedo) btnRedo.disabled = !payload.canRedo;
    } else if (event === 'status:save') {
      updateSaveIndicator(payload);
    } else if (event === 'scene:mutated') {
      debouncedSave();
      updateStatusbarStats();
      renderSceneTabs();
    } else if (event === 'scene:loaded') {
      updateStatusbarStats();
      renderSceneTabs();
    }
  });

  // Initialize Keyboard Shortcuts
  initKeyboardShortcuts({
    save: () => saveCurrentScene(),
    duplicateLayer: () => layersPanel.duplicateLayer(),
    deleteLayer: (id) => layersPanel.deleteLayer(id),
    closeTab: () => closeSceneTab(state.sceneId),
    toggleFullscreen: () => previewPanel.toggleFullscreen(),
  });

  // Connect to Core Engine
  const statusChip = $('#engine-status');
  try {
    const caps = await api.capabilities();
    state.capabilities = caps;
    state.engine.online = true;
    store.notify('capabilities:loaded', caps);

    if (statusChip) {
      statusChip.className = 'status-chip online';
      statusChip.querySelector('.status-text').textContent = 'Engine online';
    }
    setStatus('Ready', 'online');
  } catch (err) {
    if (statusChip) {
      statusChip.className = 'status-chip offline';
      statusChip.querySelector('.status-text').textContent = 'Engine offline';
    }
    setStatus('Engine offline', 'offline');
    toast.error('Engine Offline', 'Could not reach core-engine at :4000');
  }

  // Load last saved scene or demo
  const lastSceneId = localStorage.getItem('motionforge_last_scene');
  if (lastSceneId) {
    loadScene(lastSceneId);
  } else {
    // If first time visit, start onboarding walkthrough
    onboarding.startIfFirstRun();
  }
}

// Start application
boot();