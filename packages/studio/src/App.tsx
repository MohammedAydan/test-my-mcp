import { Component, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { store } from './state/store.js';
import { api } from './api.js';
import { onEngineEvent } from './services/engine-bridge.js';
import { ensureRenderQueueBridge } from './services/render-queue.js';
import { capturePointer, releasePointer } from './services/pointer-capture.js';
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
  let leftRailRef: HTMLDivElement | undefined;
  let binPaneRef: HTMLDivElement | undefined;
  let layersPaneRef: HTMLDivElement | undefined;
  let saveTimeout: number | null = null;
  const [engineError, setEngineError] = createSignal<string | null>(null);

  const preset = () => activePreset();
  const isMaximized = () => Boolean(state.maximizedPanelId);
  const showLeftRail = () =>
    !state.workspace.leftPanelCollapsed && (preset().showProjectBin || preset().showHierarchy);
  const showRightRail = () =>
    !state.workspace.rightPanelCollapsed && preset().showInspector;

  /* ── the left dock: Project Bin over Layer Stack ─────────────────────── */

  const showProjectBin = () => preset().showProjectBin;
  const showHierarchy = () => preset().showHierarchy;
  /** a maximised panel takes the whole rail — the sibling pane steps aside */
  const showBinPane = () => showProjectBin() && state.maximizedPanelId !== 'layer-stack';
  const showLayersPane = () => showHierarchy() && state.maximizedPanelId !== 'project-bin';
  /** the splitter only exists when BOTH panes are on screen */
  const showDockSplitter = () => showBinPane() && showLayersPane();
  const dockSplit = () => state.workspace.leftDockSplit;
  /** the bin takes the split's share of the rail, the stack takes the rest */
  const binFlex = () => (showDockSplitter() ? `${dockSplit()} 1 0` : '1 1 0');
  const layersFlex = () =>
    showDockSplitter() ? `${Number((1 - dockSplit()).toFixed(3))} 1 0` : '1 1 0';

  /**
   * The draggable band of the left dock: from the top of the bin pane to
   * the bottom of the layer stack. The split is a FRACTION of that band, so
   * it survives a rail resize and a restart.
   */
  const dockTrack = (): { top: number; height: number } | null => {
    const bin = binPaneRef;
    const layers = layersPaneRef;
    if (bin && layers) {
      const top = bin.getBoundingClientRect().top;
      const height = layers.getBoundingClientRect().bottom - top;
      if (height > 0) return { top, height };
    }
    const rail = leftRailRef;
    if (!rail) return null;
    const rect = rail.getBoundingClientRect();
    return rect.height > 0 ? { top: rect.top, height: rect.height } : null;
  };

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
    // The render queue lives in the GLOBAL store, so the bridge that feeds it
    // has to be alive for the whole session — a render that finishes while
    // the modal is closed still updates the status bar.
    ensureRenderQueueBridge();

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
          // `stopImmediatePropagation` — not just `stopPropagation`.
          //
          // `stopPropagation` only stops the event from WALKING further up the
          // tree; every OTHER listener on the SAME element still runs. The
          // timeline registers its own window-level keydown handler, so a
          // second listener on `window` would still see the chord and could
          // act on it — which is exactly how ONE keypress once opened the
          // palette AND split the layer. `stopImmediatePropagation` prevents
          // every remaining listener on this element from running.
          event.stopImmediatePropagation();
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
      // The STORE owns the layer factory: every kind gets its OWN
      // schema-valid payload (a chart gets `data`, a cta gets a `label`), and
      // a full-bleed layer gets an explicit integer `duration` equal to the
      // composition length.
      const id = store.addLayerOfKind(kind);
      if (!id) return;
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
          <div class="mf-rail mf-rail-left" id="left-rail" ref={leftRailRef}>
            <Show when={showBinPane()}>
              <div
                id="left-dock-bin"
                class="mf-dock-pane"
                ref={binPaneRef}
                style={{ flex: binFlex() }}
              >
                <ProjectBinPanel />
              </div>
            </Show>

            <Show when={showDockSplitter()}>
              <LeftDockSplitter
                fraction={dockSplit()}
                getTrack={dockTrack}
                onResize={(fraction) => store.setLeftDockSplit(fraction)}
              />
            </Show>

            <Show when={showLayersPane()}>
              <div
                id="left-dock-layers"
                class="mf-dock-pane"
                ref={layersPaneRef}
                style={{ flex: layersFlex() }}
              >
                <LayerStackPanel />
              </div>
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

/* ── the left-dock splitter ──────────────────────────────────────────────── */

interface LeftDockSplitterProps {
  /** the current split (0.15 … 0.85 of the track) */
  fraction: number;
  /** the draggable band, in client coordinates */
  getTrack: () => { top: number; height: number } | null;
  /** called with the new fraction */
  onResize: (fraction: number) => void;
}

/**
 * The separator between the Project Bin and the Layer Stack.
 *
 * Unlike the other splitters, this one stores a FRACTION of the track
 * instead of a pixel size, so the split survives a rail resize — and the
 * two panes keep their proportion on a 4K display as well as on a laptop.
 *
 * It behaves like the rest of the app: a pointer-capture drag, a hover
 * accent, a double-click reset and a keyboard nudge (ArrowUp / ArrowDown
 * move it by 16px).
 */
const LeftDockSplitter: Component<LeftDockSplitterProps> = (props) => {
  const [isDragging, setIsDragging] = createSignal(false);
  let elementRef: HTMLDivElement | undefined;

  const handlePointerDown = (event: PointerEvent) => {
    event.preventDefault();
    setIsDragging(true);
    capturePointer(elementRef, event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!isDragging()) return;
    const track = props.getTrack();
    if (!track || track.height <= 0) return;
    props.onResize((event.clientY - track.top) / track.height);
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (!isDragging()) return;
    setIsDragging(false);
    releasePointer(elementRef, event.pointerId);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const track = props.getTrack();
      if (!track || track.height <= 0) return;
      const delta = (event.key === 'ArrowUp' ? -16 : 16) / track.height;
      props.onResize(props.fraction + delta);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      props.onResize(0.15);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      props.onResize(0.85);
    }
  };

  return (
    <div
      ref={elementRef}
      id="splitter-left-dock"
      class={`mf-splitter is-horizontal mf-dock-splitter ${isDragging() ? 'is-active' : ''}`}
      data-orientation="horizontal"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the project bin and the layer stack"
      aria-valuemin={15}
      aria-valuemax={85}
      aria-valuenow={Math.round(props.fraction * 100)}
      tabindex="0"
      title="Drag to resize the bin and the layer stack, double-click to reset"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDblClick={() => props.onResize(0.5)}
      onKeyDown={handleKeyDown}
    />
  );
};
