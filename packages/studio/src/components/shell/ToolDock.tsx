import { Component, For, Show } from 'solid-js';
import { store, type ActiveTool } from '../../state/store.js';
import {
  IconChart,
  IconCode,
  IconCursor,
  IconDevice,
  IconHand,
  IconMagnet,
  IconRazor,
  IconRedo,
  IconShape,
  IconType,
  IconUndo,
} from '../icons/NleIcons.js';

/**
 * The vertical tool dock.
 *
 * A Premiere-style tool rail: one button per tool, the active one tinted
 * blue with a left edge marker, and the keyboard shortcut printed in the
 * corner so the mapping is always visible.
 */

interface ToolDef {
  id: ActiveTool;
  label: string;
  shortcut: string;
  icon: typeof IconCursor;
}

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Selection Tool', shortcut: 'V', icon: IconCursor },
  { id: 'hand', label: 'Hand / Pan Tool', shortcut: 'H', icon: IconHand },
  { id: 'razor', label: 'Razor / Split Tool', shortcut: 'C', icon: IconRazor },
  { id: 'text', label: 'Add Text Layer', shortcut: 'T', icon: IconType },
  { id: 'shape', label: 'Add Card Layer', shortcut: 'R', icon: IconShape },
];

/**
 * The preset tools (chart / code / device) share one dropdown: they all
 * create a layer, they only differ in the kind.
 */
const PRESET_TOOLS = [
  { label: 'Chart Layer', icon: IconChart },
  { label: 'Code Block Layer', icon: IconCode },
  { label: 'Device Mockup Layer', icon: IconDevice },
];

export const ToolDock: Component = () => {
  const state = store.state;

  const addLayer = (kind: string) => {
    window.dispatchEvent(new CustomEvent('motionforge:add-layer', { detail: kind }));
  };

  return (
    <nav class="mf-tool-dock" id="tool-dock" aria-label="Tools">
      <For each={TOOLS}>
        {(tool) => (
          <button
            class={`mf-tool-btn ${state.activeTool === tool.id ? 'is-active' : ''}`}
            id={`tool-${tool.id}`}
            data-tool={tool.id}
            title={`${tool.label} (${tool.shortcut})`}
            aria-label={tool.label}
            aria-pressed={state.activeTool === tool.id}
            onClick={() => store.setActiveTool(tool.id)}
          >
            <tool.icon size={15} />
            <span class="mf-tool-key">{tool.shortcut}</span>
          </button>
        )}
      </For>

      <div class="mf-tool-sep" />

      <For each={PRESET_TOOLS}>
        {(preset, index) => (
          <button
            class="mf-tool-btn"
            id={`tool-preset-${index()}`}
            title={preset.label}
            aria-label={preset.label}
            onClick={() => addLayer(index() === 0 ? 'chart' : index() === 1 ? 'codeBlock' : 'deviceMockup')}
          >
            <preset.icon size={15} />
          </button>
        )}
      </For>

      <div class="mf-tool-sep" />

      <button
        class={`mf-tool-btn ${state.snapEnabled ? 'is-active' : ''}`}
        id="tool-snap"
        title="Magnetic Snapping (S)"
        aria-label="Magnetic snapping"
        aria-pressed={state.snapEnabled}
        onClick={() => store.setSnapEnabled(!state.snapEnabled)}
      >
        <IconMagnet size={15} />
        <span class="mf-tool-key">S</span>
      </button>

      <div class="mf-tool-sep" />

      <button
        class="mf-tool-btn"
        id="tool-undo"
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        disabled={!store.canUndo()}
        onClick={() => store.undo()}
      >
        <IconUndo size={15} />
      </button>
      <button
        class="mf-tool-btn"
        id="tool-redo"
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
        disabled={!store.canRedo()}
        onClick={() => store.redo()}
      >
        <IconRedo size={15} />
      </button>

      <Show when={store.historyCount().undo > 0}>
        <span
          class="mf-tool-key"
          style={{ position: 'static', 'text-align': 'center', 'margin-top': '2px' }}
          title="Undo steps available"
        >
          {store.historyCount().undo}
        </span>
      </Show>
    </nav>
  );
};
