import { Component, For, Show, createSignal, onMount } from 'solid-js';
import { store } from '../../state/store.js';
import {
  IconCamera,
  IconClose,
  IconExportWorkspace,
  IconAudioWorkspace,
  IconEffects,
  IconMaximize,
  IconMinimize,
  IconMotion,
  IconRestore,
  MotionForgeMark,
} from '../icons/NleIcons.js';
import { AppMenuBar } from './AppMenuBar.js';

/**
 * The frameless window chrome.
 *
 * The native title bar is gone (`frame: false`), so this 32px strip IS the
 * window frame: the menu bar on the left, a draggable breadcrumb in the
 * middle, and the window controls on the right.
 *
 * `-webkit-app-region` splits the strip into three zones:
 *   left   → `no-drag` (the menu is interactive)
 *   centre → `drag`     (the window can be moved by the breadcrumb)
 *   right  → `no-drag` (the controls are interactive)
 */

interface WorkspacePill {
  id: 'editing' | 'motion' | 'audio' | 'effects' | 'export';
  label: string;
  icon: typeof IconMotion;
}

const WORKSPACE_PILLS: WorkspacePill[] = [
  { id: 'editing', label: 'Editing', icon: IconMotion },
  { id: 'motion', label: 'Motion', icon: IconCamera },
  { id: 'audio', label: 'Audio', icon: IconAudioWorkspace },
  { id: 'effects', label: 'Effects', icon: IconEffects },
  { id: 'export', label: 'Export', icon: IconExportWorkspace },
];

export const TitleBar: Component = () => {
  const state = store.state;
  const [isMaximized, setIsMaximized] = createSignal(false);

  onMount(() => {
    const mf = window.motionforge;
    if (!mf?.window) return;
    void mf.window.isMaximized().then((s) => setIsMaximized(s.isMaximized));
    const unsubscribe = mf.window.onMaximizedChanged((s) => setIsMaximized(s.isMaximized));
    return unsubscribe;
  });

  const projectName = () => state.scene?.name ?? 'Untitled Composition';
  const sceneId = () => state.sceneId ?? '';

  return (
    <header class="mf-titlebar" id="app-titlebar" role="banner">
      <div class="mf-titlebar-left">
        <div class="mf-brand">
          <MotionForgeMark size={16} class="mf-brand-mark" />
          <span class="mf-brand-name">MotionForge</span>
        </div>
        <AppMenuBar />
      </div>

      <div class="mf-titlebar-center">
        <div class="mf-breadcrumb" id="app-breadcrumb">
          <span class="mf-breadcrumb-project" id="project-name">
            {projectName()}
          </span>
          <Show when={sceneId()}>
            <span class="mf-breadcrumb-sep">/</span>
            <span class="mf-breadcrumb-scene" id="scene-breadcrumb">
              {sceneId()}
            </span>
          </Show>
          <Show when={state.dirty}>
            <span class="mf-dirty-dot" id="dirty-dot" title="Unsaved changes" />
          </Show>
        </div>

        <div class="mf-workspace-pills" role="tablist" aria-label="Workspace layout">
          <For each={WORKSPACE_PILLS}>
            {(pill) => (
              <button
                class={`mf-workspace-pill ${state.workspacePreset === pill.id ? 'is-active' : ''}`}
                role="tab"
                aria-selected={state.workspacePreset === pill.id}
                data-workspace={pill.id}
                onClick={() => store.setWorkspacePreset(pill.id)}
              >
                <pill.icon size={12} />
                <span>{pill.label}</span>
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="mf-titlebar-right">
        <span
          class={`mf-chip mf-engine-badge ${state.engine.online ? 'is-success' : 'is-danger'}`}
          id="engine-status"
        >
          {state.engine.online ? 'In-Process Ready' : 'Engine Offline'}
        </span>

        <button
          class="mf-btn is-primary"
          id="btn-quick-render"
          title="Open the render queue"
          onClick={() => store.setActiveModal('render')}
        >
          <IconExportWorkspace size={12} />
          <span>Render</span>
        </button>

        <div class="mf-window-controls" id="window-controls">
          <button
            class="mf-window-btn"
            id="btn-window-minimize"
            title="Minimize"
            aria-label="Minimize window"
            onClick={() => window.motionforge?.window?.minimize()}
          >
            <IconMinimize size={14} />
          </button>
          <button
            class="mf-window-btn"
            id="btn-window-maximize"
            title={isMaximized() ? 'Restore' : 'Maximize'}
            aria-label={isMaximized() ? 'Restore window' : 'Maximize window'}
            onClick={() => window.motionforge?.window?.toggleMaximize()}
          >
            <Show when={isMaximized()} fallback={<IconMaximize size={13} />}>
              <IconRestore size={13} />
            </Show>
          </button>
          <button
            class="mf-window-btn is-close"
            id="btn-window-close"
            title="Close"
            aria-label="Close window"
            onClick={() => window.motionforge?.window?.close()}
          >
            <IconClose size={14} />
          </button>
        </div>
      </div>
    </header>
  );
};
