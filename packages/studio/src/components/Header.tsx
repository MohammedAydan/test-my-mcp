import { Component, Show } from 'solid-js';
import { store } from '../store.js';

interface HeaderProps {
  onNew: () => void;
  onLoad: () => void;
  onPalette: () => void;
  onQueue: () => void;
  onInspect: () => void;
  onPreviewTab: () => void;
  onShortcuts: () => void;
  onRender: () => void;
  onSave: () => void;
}

export const Header: Component<HeaderProps> = (props) => {
  const state = store.state;

  return (
    <header class="titlebar" role="banner">
      <div class="titlebar-left">
        <div class="traffic-lights" aria-hidden="true">
          <span class="tl red"></span>
          <span class="tl yellow"></span>
          <span class="tl green"></span>
        </div>
        <div class="brand">
          <svg class="brand-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M4 4 L20 4 L20 20 L4 20 Z M4 4 L12 12 L20 4 M12 12 L12 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
          </svg>
          <span class="brand-name">MotionForge</span>
        </div>

        {/* Scene Tabs */}
        <nav class="scene-tabs" id="scene-tabs" aria-label="Open scenes">
          <For each={state.openScenes.length > 0 ? state.openScenes : [state.sceneId || 'No scene']}>
            {(sId) => {
              const isActive = () => sId === state.sceneId;
              return (
                <div class={`scene-tab ${isActive() ? 'active' : ''}`} id={isActive() ? 'tab-active-scene' : undefined}>
                  <Show when={isActive() && state.dirty}>
                    <span class="scene-tab-dirty" id="tab-dirty-indicator"></span>
                  </Show>
                  <span class="scene-tab-name" id={isActive() ? 'scene-title' : undefined}>
                    {sId}
                  </span>
                </div>
              );
            }}
          </For>
        </nav>
      </div>

      <div class="titlebar-center">
        {/* Undo / Redo */}
        <button
          class="toolbar-btn"
          id="btn-undo"
          data-tooltip="Undo (Ctrl+Z)"
          aria-label="Undo"
          disabled={!store.canUndo()}
          onClick={() => store.undo()}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
          </svg>
        </button>
        <button
          class="toolbar-btn"
          id="btn-redo"
          data-tooltip="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          disabled={!store.canRedo()}
          onClick={() => store.redo()}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 019-9 9 9 0 016 2.3L21 13" />
          </svg>
        </button>
        <div class="toolbar-sep"></div>

        <button class="toolbar-btn" id="btn-new" data-tooltip="New Scene (Templates)" aria-label="New scene" onClick={props.onNew}>
          <svg viewBox="0 0 24 24" width="14" height="14">
            <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          New
        </button>
        <button class="toolbar-btn" id="btn-load" data-tooltip="Load scene or recents" aria-label="Load scene" onClick={props.onLoad}>
          <svg viewBox="0 0 24 24" width="14" height="14">
            <path d="M3 7v13h18V9H12l-2-2H3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
          </svg>
          Load
        </button>
        <div class="toolbar-sep"></div>

        <button class="toolbar-btn" id="btn-palette" data-tooltip="Command Palette (Ctrl+K)" aria-label="Command palette" onClick={props.onPalette}>
          <svg viewBox="0 0 24 24" width="14" height="14">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
            <path d="M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          ⌘K
        </button>
        <button class="toolbar-btn" id="btn-queue" data-tooltip="Render Queue & History" aria-label="Render queue" onClick={props.onQueue}>
          <svg viewBox="0 0 24 24" width="14" height="14">
            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          Queue
        </button>
        <button class="toolbar-btn" id="btn-inspect" data-tooltip="Inspect keyframe stills" aria-label="Inspect keyframes" onClick={props.onInspect}>
          <svg viewBox="0 0 24 24" width="14" height="14">
            <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.5" />
            <circle cx="12" cy="12" r="3" fill="currentColor" />
          </svg>
          Inspect
        </button>
        <button class="toolbar-btn" id="btn-preview-tab" data-tooltip="Open live preview in tab" aria-label="Live preview" onClick={props.onPreviewTab}>
          <svg viewBox="0 0 24 24" width="14" height="14">
            <path d="M15 3h6v6M21 3l-9 9M9 5H5v14h14v-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          Live
        </button>
        <button class="toolbar-btn" id="btn-shortcuts" data-tooltip="Keyboard shortcuts (?)" aria-label="Shortcuts" onClick={props.onShortcuts}>
          <span style="font-weight: 700; font-family: monospace;">?</span>
        </button>
        <button class="toolbar-btn" id="btn-help" data-tooltip="Quickstart & Help" aria-label="Help" onClick={props.onShortcuts}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" stroke-width="2" />
          </svg>
        </button>
      </div>

      <div class="titlebar-right">
        {/* Auto-Save Indicator */}
        <div
          class={`save-indicator ${state.saveStatus}`}
          id="save-indicator"
          data-tooltip="Click to force save (Ctrl+S)"
          role="button"
          tabindex="0"
          onClick={props.onSave}
        >
          <span class="save-icon">
            {state.saveStatus === 'saved' ? '✓' : state.saveStatus === 'saving' ? '⟳' : '●'}
          </span>
          <span class="save-text">
            {state.saveStatus === 'saved' ? 'Saved' : state.saveStatus === 'saving' ? 'Saving…' : 'Unsaved'}
          </span>
        </div>

        {/* Engine Status */}
        <div class={`status-chip ${state.engine.online ? 'online' : 'offline'}`} id="engine-status">
          <span class="status-dot"></span>
          <span class="status-text">
            {state.engine.online ? `Connected (${state.engine.latencyMs}ms)` : 'Connecting…'}
          </span>
        </div>

        {/* Render Button */}
        <button class="primary-btn" id="btn-render" data-tooltip="Render scene to MP4" onClick={props.onRender}>
          <svg viewBox="0 0 24 24" width="12" height="12">
            <path d="M8 5l11 7-11 7z" fill="currentColor" />
          </svg>
          Render
        </button>
      </div>
    </header>
  );
};
