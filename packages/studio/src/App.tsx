import { Component, onMount, onCleanup, createEffect } from 'solid-js';
import { store } from './store.js';
import { api } from './api.js';
import { Header } from './components/Header.js';
import { HelpTipBar } from './components/HelpTipBar.js';
import { LayersPanel } from './components/LayersPanel.js';
import { Preview } from './components/Preview.js';
import { Inspector } from './components/Inspector.js';
import { Timeline } from './components/Timeline.js';
import { StatusBar } from './components/StatusBar.js';
import { Toasts } from './components/Toasts.js';
import { Modal } from './components/Modal.js';
import type { StudioScene } from './types.js';

export const DEMO_SCENE: StudioScene = {
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

export const App: Component = () => {
  const state = store.state;
  let saveTimeout: number | null = null;

  const loadScene = async (id: string) => {
    try {
      const scene = await api.getScene(id);
      store.setScene(scene, id);
      store.addToast(`Loaded "${scene.id}"`, 'success');
    } catch (e: unknown) {
      store.addToast(`Failed to load ${id}: ${(e as Error).message}`, 'error');
    }
  };

  const loadDemoScene = async () => {
    try {
      const demoCopy = JSON.parse(JSON.stringify(DEMO_SCENE));
      demoCopy.id = 'demo-' + Date.now().toString(36);
      const res = await api.createScene(demoCopy);
      demoCopy.id = res.id;
      store.setScene(demoCopy, res.id);
      store.addToast('Demo scene loaded', 'success');
    } catch (e: unknown) {
      store.addToast(`Demo error: ${(e as Error).message}`, 'error');
    }
  };

  (window as unknown as { loadDemoScene: () => Promise<void> }).loadDemoScene = loadDemoScene;

  const executeSave = async () => {
    if (!state.scene) return;
    store.setSaveStatus('saving');
    try {
      const res = await api.createScene(state.scene);
      store.setSaveStatus('saved');
      store.addToast(`Saved scene ${res.id}`, 'success');
    } catch (e: unknown) {
      store.setSaveStatus('failed');
      store.addToast(`Save failed: ${(e as Error).message}`, 'error');
    }
  };

  // Debounced auto-save
  createEffect(() => {
    if (state.dirty && state.scene) {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = window.setTimeout(() => {
        executeSave();
      }, 700);
    }
  });

  const executeRender = async (sceneId: string, quality: 'draft' | 'production') => {
    store.addToast(`Queuing ${quality} render for ${sceneId}...`, 'info');
    try {
      const res = await api.startRender(sceneId, quality);
      store.addToast(`Render started (Job ${res.id})`, 'success');
    } catch (e: unknown) {
      store.addToast(`Render failed: ${(e as Error).message}`, 'error');
    }
  };

  const addLayer = (type: string) => {
    if (!state.scene) {
      store.addToast('Load or create a scene before adding layers', 'warning');
      return;
    }
    const id = `${type}-${Math.random().toString(36).slice(2, 7)}`;
    const base = { id, type, at: state.playhead, duration: 3000 };
    let newLayer: unknown;

    switch (type) {
      case 'kineticText':
        newLayer = {
          ...base,
          text: 'New Text',
          sizePx: 80,
          position: { xPct: 50, yPct: 50 },
          fill: '#ffffff',
          entrance: { name: 'springPop' },
        };
        break;
      case 'background':
        newLayer = { ...base, variant: { variant: 'solid', color: '#101017' } };
        break;
      case 'card':
        newLayer = {
          ...base,
          position: { xPct: 50, yPct: 50 },
          variant: { variant: 'glassCard', title: 'Card Title', body: 'Description', widthPx: 800, paddingPx: 32, radiusPx: 16 },
        };
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
      scene.layers.push(newLayer as any);
      store.selectLayer(id);
    }, `Added ${type} layer`);
    store.addToast(`Created ${id}`, 'success');
  };

  onMount(async () => {
    // 1. Check engine connectivity
    const ping = await api.ping();
    store.setState('engine', { online: ping.ok, url: api.url, latencyMs: ping.latencyMs });

    if (ping.ok) {
      try {
        const caps = await api.capabilities();
        store.setState('capabilities', caps);
      } catch (err) {
        console.warn('Capabilities error:', err);
      }
    }

    // 2. Load last scene or demo scene
    const lastSceneId = localStorage.getItem('motionforge_last_scene');
    if (lastSceneId) {
      await loadScene(lastSceneId);
    } else {
      await loadDemoScene();
    }

    // 3. Electron menu integration
    const mf = (window as unknown as { motionforge?: { onMenuAction?: (cb: (action: string) => void) => void } }).motionforge;
    if (mf?.onMenuAction) {
      mf.onMenuAction((action: string) => {
        if (action === 'new') store.setActiveModal('new');
        else if (action === 'open') store.setActiveModal('load');
        else if (action === 'save') executeSave();
        else if (action === 'undo') store.undo();
        else if (action === 'redo') store.redo();
        else if (action === 'render-draft') executeRender(state.sceneId || '', 'draft');
        else if (action === 'render-production') executeRender(state.sceneId || '', 'production');
        else if (action === 'render-queue') store.setActiveModal('queue');
        else if (action === 'shortcuts') store.setActiveModal('shortcuts');
      });
    }

    // 4. Keyboard shortcuts
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore when focused inside text input or textarea
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) && target.getAttribute('type') !== 'range') {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        executeSave();
      } else if (e.key === ' ') {
        e.preventDefault();
        store.setPlaying(!state.playing);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        store.setPlayhead(state.playhead - 100);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        store.setPlayhead(state.playhead + 100);
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        store.setActiveModal('shortcuts');
      }
    };

    window.addEventListener('keydown', onKeyDown);

    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown);
      if (saveTimeout) clearTimeout(saveTimeout);
    });
  });

  return (
    <div class="app">
      <a href="#preview-stage" class="skip-link">
        Skip to preview content
      </a>

      {/* TITLE BAR */}
      <Header
        onNew={() => store.setActiveModal('new')}
        onLoad={() => store.setActiveModal('load')}
        onPalette={() => store.addToast('Command Palette: Ctrl+K', 'info')}
        onQueue={() => store.setActiveModal('queue')}
        onInspect={() => store.setActiveModal('inspect')}
        onPreviewTab={() => window.open(api.previewUrl(state.sceneId || ''), '_blank')}
        onShortcuts={() => store.setActiveModal('shortcuts')}
        onRender={() => store.setActiveModal('render')}
        onSave={executeSave}
      />

      {/* HELP TIP BAR */}
      <HelpTipBar />

      {/* MAIN WORKSPACE */}
      <main class="main">
        <LayersPanel onAddLayer={() => store.setActiveModal('add-layer')} />
        <Preview onLoadDemo={loadDemoScene} onOpenLoad={() => store.setActiveModal('load')} />
        <Inspector />
      </main>

      {/* TIMELINE */}
      <Timeline />

      {/* STATUS BAR */}
      <StatusBar />

      {/* TOASTS */}
      <Toasts />

      {/* MODAL */}
      <Modal
        onLoadScene={loadScene}
        onExecuteRender={executeRender}
        onAddLayer={addLayer}
      />
    </div>
  );
};
