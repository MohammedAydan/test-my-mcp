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
import { CommandPalette } from './components/CommandPalette.js';
import { OnboardingTour } from './components/OnboardingTour.js';
import { SplitterVertical, SplitterHorizontal } from './components/Splitter.js';
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
  let mainRef: HTMLElement | undefined;
  let appRef: HTMLElement | undefined;

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

  (window as unknown as { loadDemoScene: () => Promise<void>; __mf_loadDemoScene: () => Promise<void> }).loadDemoScene = loadDemoScene;
  (window as unknown as { loadDemoScene: () => Promise<void>; __mf_loadDemoScene: () => Promise<void> }).__mf_loadDemoScene = loadDemoScene;

  const executeSave = async () => {
    await store.executeSave();
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

    // 2. Load last scene if present
    const lastSceneId = localStorage.getItem('motionforge_last_scene');
    if (lastSceneId) {
      await loadScene(lastSceneId);
    }

    // Bi-directional IPC domain event bus
    if (typeof window !== 'undefined' && window.motionforgeEngine?.onEvent) {
      const unsub = window.motionforgeEngine.onEvent(async (evt) => {
        if (evt.eventName === 'scene:updated') {
          const payload = evt.payload as { sceneId: string; source: string };
          if (payload.sceneId === state.sceneId && payload.source === 'external') {
            store.addToast(`Scene updated externally by MCP/AI`, 'info');
            await loadScene(payload.sceneId);
          }
        } else if (evt.eventName === 'scene:deleted') {
          const payload = evt.payload as { sceneId: string };
          if (payload.sceneId === state.sceneId) {
            store.addToast(`Scene "${payload.sceneId}" was deleted`, 'warning');
            store.setScene(null);
          }
        } else if (evt.eventName === 'render:progress') {
          const payload = evt.payload as { jobId: string; progressPct: number };
          store.addToast(`Render ${payload.jobId}: ${payload.progressPct}%`, 'info');
        } else if (evt.eventName === 'render:completed') {
          const payload = evt.payload as { jobId: string; outputPath: string };
          store.addToast(`Render finished: ${payload.outputPath}`, 'success');
        } else if (evt.eventName === 'render:failed') {
          const payload = evt.payload as { jobId: string; error: string };
          store.addToast(`Render failed: ${payload.error}`, 'error');
        }
      });
      onCleanup(() => unsub());
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
      } else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        store.splitSelectedAtPlayhead();
      } else if (e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        store.rippleDeleteSelected();
      } else if (e.key.toLowerCase() === 'j') {
        e.preventDefault();
        store.setPlayhead(Math.max(0, state.playhead - 200));
      } else if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        store.setPlaying(false);
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        store.setPlaying(true);
      } else if (e.key === ' ') {
        e.preventDefault();
        store.setPlaying(!state.playing);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        store.setPlayhead(state.playhead - 100);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        store.setPlayhead(state.playhead + 100);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const selId = state.selectedLayerId;
        if (selId && state.scene) {
          const l = state.scene.layers.find((x) => x.id === selId);
          if (l) {
            store.mutateScene((scene) => {
              const clone = JSON.parse(JSON.stringify(l));
              let newId = `${l.id}-copy`;
              let counter = 1;
              while (scene.layers.some((x) => x.id === newId)) {
                newId = `${l.id}-copy-${counter++}`;
              }
              clone.id = newId;
              clone.at = (l.at || 0) + 100;
              scene.layers.push(clone);
              store.selectLayer(newId);
            }, `Duplicated layer ${l.id}`);
            store.addToast(`Duplicated ${l.id}`, 'success');
          }
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const selId = state.selectedLayerId;
        if (selId && state.scene) {
          e.preventDefault();
          store.mutateScene((scene) => {
            scene.layers = scene.layers.filter((l) => l.id !== selId);
            store.selectLayer(scene.layers[0]?.id || null);
          }, `Deleted layer ${selId}`);
          store.addToast(`Deleted layer ${selId}`, 'info');
        }
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
    <div
      ref={appRef}
      class="app"
      style={{
        '--timeline-height': state.workspace.timelineCollapsed ? '0px' : `${state.workspace.timelineHeight}px`,
      }}
    >
      <a href="#preview-stage" class="skip-link">
        Skip to preview content
      </a>

      {/* TITLE BAR */}
      <Header
        onNew={() => store.setActiveModal('new')}
        onLoad={() => store.setActiveModal('load')}
        onPalette={() => (window as unknown as { openCommandPalette?: () => void }).openCommandPalette?.()}
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
      <main
        ref={mainRef}
        class="main"
        style={{
          '--left-panel-width': state.workspace.leftPanelCollapsed ? '0px' : `${state.workspace.leftPanelWidth}px`,
          '--right-panel-width': state.workspace.rightPanelCollapsed ? '0px' : `${state.workspace.rightPanelWidth}px`,
        }}
      >
        <div style={{ display: state.workspace.leftPanelCollapsed ? 'none' : 'contents' }}>
          <LayersPanel onAddLayer={() => store.setActiveModal('add-layer')} />
        </div>
        <SplitterVertical
          id="splitter-left"
          onResize={(clientX) => store.setLeftPanelWidth(mainRef ? clientX - mainRef.getBoundingClientRect().left : clientX)}
          onDoubleClick={() => store.toggleLeftPanelCollapsed()}
          title="Drag to resize, double-click to collapse left panel"
        />
        <Preview onLoadDemo={loadDemoScene} onOpenLoad={() => store.setActiveModal('load')} />
        <SplitterVertical
          id="splitter-right"
          onResize={(clientX) => store.setRightPanelWidth(mainRef ? mainRef.getBoundingClientRect().right - clientX : window.innerWidth - clientX)}
          onDoubleClick={() => store.toggleRightPanelCollapsed()}
          title="Drag to resize, double-click to collapse right panel"
        />
        <div style={{ display: state.workspace.rightPanelCollapsed ? 'none' : 'contents' }}>
          <Inspector />
        </div>
      </main>

      {/* HORIZONTAL TIMELINE SPLITTER */}
      <SplitterHorizontal
        id="splitter-timeline"
        onResize={(clientY) => store.setTimelineHeight(appRef ? appRef.getBoundingClientRect().bottom - clientY - 26 : window.innerHeight - clientY - 26)}
        onDoubleClick={() => store.toggleTimelineCollapsed()}
        title="Drag to resize, double-click to collapse timeline"
      />

      {/* TIMELINE */}
      <div style={{ display: state.workspace.timelineCollapsed ? 'none' : 'contents' }}>
        <Timeline />
      </div>

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

      {/* COMMAND PALETTE */}
      <CommandPalette
        onOpenRender={() => store.setActiveModal('render')}
        onOpenInspect={() => store.setActiveModal('inspect')}
        onOpenNew={() => store.setActiveModal('new')}
        onOpenLoad={() => store.setActiveModal('load')}
      />

      {/* ONBOARDING TOUR */}
      <OnboardingTour />
    </div>
  );
};
