import { Component, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { store } from './state/store.js';
import { api } from './api.js';
import { onEngineEvent } from './services/engine-bridge.js';
import { TitleBar } from './components/shell/TitleBar.js';
import { ToolDock } from './components/shell/ToolDock.js';
import { StatusBar } from './components/shell/StatusBar.js';
import { Splitter } from './components/workspace/Splitter.js';
import { ProjectBinPanel } from './components/project-bin/ProjectBinPanel.js';
import { LayerStackPanel } from './components/hierarchy/LayerStackPanel.js';
import { ProgramMonitorPanel } from './components/monitor/ProgramMonitorPanel.js';
import { EffectControlsPanel } from './components/inspector/EffectControlsPanel.js';
import { TimelinePanel } from './components/timeline/TimelinePanel.js';
import { RenderModal } from './components/export/RenderModal.js';
import { ShortcutsModal } from './components/modals/ShortcutsModal.js';
import { HelpDrawer } from './components/modals/HelpDrawer.js';
import { CommandPalette } from './components/shared/CommandPalette.js';
import { StudioModal } from './components/shared/StudioModal.js';
import { Toasts } from './components/shared/Toasts.js';
import { activePreset } from './components/workspace/WorkspaceLayout.js';

/**
 * The composition root.
 *
 * `App.tsx` owns exactly three things:
 *   1. the global keyboard-shortcut listener,
 *   2. the debounced auto-save,
 *   3. the engine event subscription.
 *
 * Everything else lives in a module. If this file grows past ~250 lines, the
 * logic belongs in a module.
 */
export const App: Component = () => {
  const state = store.state;
  let appRef: HTMLDivElement | undefined;
  let mainRef: HTMLDivElement | undefined;
  let saveTimeout: number | null = null;
  const [engineError, setEngineError] = createSignal<string | null>(null);

  const preset = () => activePreset();
  const isMaximized = () => Boolean(state.maximizedPanelId);
  const showLeftRail = () =>
    !state.workspace.leftPanelCollapsed && (preset().showProjectBin || preset().showHierarchy);
  const showRightRail = () =>
    !state.workspace.rightPanelCollapsed && preset().showInspector;

  /* ── auto-save ───────────────────────────────────────────────────────── */

  createEffect(() => {
    if (!state.dirty || !state.scene) return;
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = window.setTimeout(() => {
      void store.executeSave().catch(() => undefined);
    }, 700);
  });

  /* ── startup ─────────────────────────────────────────────────────────── */

  onMount(() => {
    void (async () => {
      const ping = await api.ping();
      store.setState('engine', { online: ping.ok, url: api.url, latencyMs: ping.latencyMs });
      if (!ping.ok) {
        setEngineError('The in-process engine did not answer.');
        return;
      }
      try {
        store.setState('capabilities', await api.capabilities());
      } catch (err) {
        console.warn('[studio] capabilities unavailable:', err);
      }

      const lastSceneId = localStorage.getItem('motionforge_last_scene');
      if (lastSceneId) {
        try {
          const scene = await api.getScene(lastSceneId);
          store.setScene(scene, lastSceneId);
        } catch {
          localStorage.removeItem('motionforge_last_scene');
        }
      }
    })();

    // engine domain events
    const unsubscribe = onEngineEvent((event) => {
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      if (event.eventName === 'scene:updated') {
        if (payload.sceneId === state.sceneId && payload.source === 'external') {
          store.addToast('Composition updated externally (AI / MCP)', 'info');
          void api.getScene(String(payload.sceneId)).then((scene) => {
            store.setScene(scene, String(payload.sceneId));
          });
        }
      } else if (event.eventName === 'scene:deleted') {
        if (payload.sceneId === state.sceneId) {
          store.setScene(null);
          store.addToast(`Composition "${payload.sceneId}" was deleted`, 'warning');
        }
      } else if (event.eventName === 'render:completed') {
        store.addToast(`Render finished: ${String(payload.outputPath ?? '')}`, 'success');
      } else if (event.eventName === 'render:failed') {
        store.addToast(`Render failed: ${String(payload.error ?? '')}`, 'error');
      }
    });

    /* ── global shortcuts ──────────────────────────────────────────────── */

    const onKeyDown = (event: KeyboardEvent) => {
      // The target is NOT always an element: a keydown dispatched on `window`
      // (or on `document`) has a target without `getAttribute`, which would
      // throw and silently kill every shortcut below.
      const target = event.target;
      const tag = target instanceof HTMLElement ? target.tagName : undefined;
      const isTextField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const isRange = target instanceof HTMLElement && target.getAttribute('type') === 'range';

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        // Ctrl+K is the command palette, unless a text field wants the key
        if (!isTextField) {
          event.preventDefault();
          store.setActiveModal(store.state.activeModal === 'palette' ? null : 'palette');
          return;
        }
      }

      if (isTextField && !isRange) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void store.executeSave().catch(() => undefined);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        store.setActiveModal('new');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        const id = state.selectedLayerId;
        if (id) store.duplicateLayer(id);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'q') {
        event.preventDefault();
        store.setActiveModal('render');
        return;
      }
      if (event.ctrlKey || event.metaKey) return;

      if (event.key === '`') {
        event.preventDefault();
        const active = state.activePanelId;
        if (active) store.toggleMaximizedPanel(active);
        return;
      }
      if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        event.preventDefault();
        store.setActiveModal('shortcuts');
        return;
      }
      if (event.key === 'F1') {
        event.preventDefault();
        store.setActiveModal('help');
        return;
      }
      if (event.key === 'Escape') {
        if (state.activeModal) store.setActiveModal(null);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        // a SELECTED KEYFRAME owns the Delete key — the timeline deletes the
        // keyframe, not the layer
        if (state.selectedKeyframe) return;
        const id = state.selectedLayerId;
        if (!id) return;
        event.preventDefault();
        if (event.shiftKey) store.rippleDeleteSelected();
        else store.deleteLayer(id);
      }
    };

    window.addEventListener('keydown', onKeyDown);

    // the tool dock asks for a layer through a custom event
    const onAddLayer = (event: Event) => {
      const kind = (event as CustomEvent<string>).detail ?? 'kineticText';
      if (!state.scene) {
        store.addToast('Load a composition before adding layers', 'warning');
        return;
      }
      const id = `${kind}-${Math.random().toString(36).slice(2, 7)}`;
      store.mutateScene((scene) => {
        scene.layers.push({
          id,
          type: 'kineticText' as never,
          text: 'New Text',
          sizePx: 80,
          position: { xPct: 50, yPct: 50 },
          fill: '#ffffff',
          at: state.playhead,
          duration: 3000,
        } as never);
      }, `Added ${kind} layer`);
      store.selectLayer(id);
      void store.executeSave().catch(() => undefined);
    };
    window.addEventListener('motionforge:add-layer', onAddLayer);

    onCleanup(() => {
      unsubscribe();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('motionforge:add-layer', onAddLayer);
      if (saveTimeout) clearTimeout(saveTimeout);
    });
  });

  return (
    <div
      ref={appRef}
      class="app"
      style={{
        '--timeline-height': state.workspace.timelineCollapsed
          ? '0px'
          : `${state.workspace.timelineHeight}px`,
      }}
    >
      <a href="#preview-stage" class="skip-link">
        Skip to preview content
      </a>

      <TitleBar />

      <main
        ref={mainRef}
        class="mf-workspace"
        style={{
          '--left-panel-width': state.workspace.leftPanelCollapsed
            ? '0px'
            : `${state.workspace.leftPanelWidth}px`,
          '--right-panel-width': state.workspace.rightPanelCollapsed
            ? '0px'
            : `${state.workspace.rightPanelWidth}px`,
        }}
      >
        <ToolDock />

        <Show when={showLeftRail()}>
          <div class="mf-rail mf-rail-left" id="left-rail">
            <Show when={preset().showProjectBin}>
              <ProjectBinPanel />
            </Show>
            <Show when={preset().showHierarchy}>
              <LayerStackPanel />
            </Show>
          </div>
        </Show>

        <Show when={showLeftRail()}>
          <Splitter
            id="splitter-left"
            orientation="vertical"
            size={state.workspace.leftPanelWidth}
            defaultSize={280}
            storageKey="motionforge_left_width"
            title="Drag to resize the left rail, double-click to reset"
            onResize={(clientX) =>
              store.setLeftPanelWidth(
                mainRef ? clientX - mainRef.getBoundingClientRect().left : clientX
              )
            }
          />
        </Show>

        <div class="mf-workspace-center">
          <ProgramMonitorPanel />
        </div>

        <Show when={showRightRail()}>
          <Splitter
            id="splitter-right"
            orientation="vertical"
            size={state.workspace.rightPanelWidth}
            defaultSize={340}
            storageKey="motionforge_right_width"
            title="Drag to resize the inspector, double-click to reset"
            onResize={(clientX) =>
              store.setRightPanelWidth(
                mainRef ? mainRef.getBoundingClientRect().right - clientX : window.innerWidth - clientX
              )
            }
          />
        </Show>

        <Show when={showRightRail()}>
          <div class="mf-rail mf-rail-right" id="right-rail">
            <Show when={preset().showInspector}>
              <EffectControlsPanel />
            </Show>
          </div>
        </Show>
      </main>

      <Splitter
        id="splitter-timeline"
        orientation="horizontal"
        size={state.workspace.timelineHeight}
        defaultSize={250}
        storageKey="motionforge_timeline_height"
        title="Drag to resize the timeline, double-click to reset"
        onResize={(clientY) =>
          store.setTimelineHeight(
            appRef ? appRef.getBoundingClientRect().bottom - clientY - 22 : window.innerHeight - clientY - 22
          )
        }
      />

      <Show when={preset().showTimeline}>
        <div class="mf-timeline-region" style={{ 'grid-row': '4' }}>
          <div class="mf-timeline-host">
            <TimelinePanel />
          </div>
        </div>
      </Show>

      <StatusBar />

      <Toasts />

      <Show when={state.activeModal === 'render'}>
        <RenderModal />
      </Show>
      <Show when={state.activeModal === 'shortcuts'}>
        <ShortcutsModal />
      </Show>
      <Show when={state.activeModal === 'help'}>
        <HelpDrawer />
      </Show>
      <Show when={state.activeModal === 'palette'}>
        <CommandPalette />
      </Show>
      <StudioModal />

      <Show when={engineError()}>
        <div class="mf-toasts" style={{ bottom: '60px' }}>
          <div class="mf-toast is-error" role="alert">
            {engineError()}
          </div>
        </div>
      </Show>
    </div>
  );
};
