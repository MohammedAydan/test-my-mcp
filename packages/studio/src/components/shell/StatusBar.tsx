import { Component, Show } from 'solid-js';
import { store } from '../../state/store.js';
import { formatTimecode } from '../../state/timecode.js';

/**
 * The 22px status bar.
 *
 * A pure projection of state: the active tool's hint, the engine status, the
 * composition format, the layer count and the auto-save state. It owns
 * nothing.
 */

const TOOL_HINTS: Record<string, string> = {
  select: 'Selection Tool — drag to move, handles to resize, stem to rotate',
  hand: 'Hand Tool — drag to pan the viewport',
  razor: 'Razor Tool — click a clip in the timeline to split it',
  text: 'Text Tool — click the canvas to add a text layer',
  shape: 'Shape Tool — click the canvas to add a card layer',
  zoom: 'Zoom Tool — drag to zoom the viewport',
};

export const StatusBar: Component = () => {
  const state = store.state;

  const resolution = () => {
    const shape = state.scene?.canvas?.shape ?? '16:9';
    const scale = state.scene?.canvas?.scale ?? 1080;
    const table: Record<string, [number, number]> = {
      '16:9': [Math.round((scale * 16) / 9), scale],
      '9:16': [scale, Math.round((scale * 16) / 9)],
      '1:1': [scale, scale],
      '4:5': [Math.round((scale * 4) / 5), scale],
    };
    const [w, h] = table[shape] ?? [1920, 1080];
    return `${w}x${h}`;
  };

  const saveLabel = () => {
    if (state.saveStatus === 'saved') return 'Saved';
    if (state.saveStatus === 'saving') return 'Saving';
    if (state.saveStatus === 'failed') return 'Save failed';
    return 'Unsaved';
  };

  return (
    <footer class="mf-statusbar" id="status-bar" role="contentinfo">
      <div class="mf-status-item" id="status-tool">
        <Show when={TOOL_HINTS[state.activeTool]} fallback={<span>Ready</span>}>
          {(hint) => <span>{hint()}</span>}
        </Show>
      </div>

      <div class="mf-status-spacer" />

      <div class="mf-status-item" id="status-resolution">
        {resolution()}
      </div>
      <div class="mf-status-item" id="status-timecode">
        {formatTimecode(state.playhead)}
      </div>
      <div class="mf-status-item" id="status-layers">
        {state.scene?.layers?.length ?? 0} layers
      </div>
      <div class="mf-status-item" id="status-engine">
        <span
          class={`mf-status-dot ${state.engine.online ? 'is-online' : 'is-offline'}`}
          id="status-dot"
        />
        <span>{state.engine.online ? 'In-Process Ready' : 'Engine Offline'}</span>
      </div>
      <div class="mf-status-item" id="status-save">
        <span
          class={`mf-status-dot ${
            state.saveStatus === 'saved'
              ? 'is-online'
              : state.saveStatus === 'failed'
              ? 'is-offline'
              : 'is-busy'
          }`}
        />
        <span>{saveLabel()}</span>
      </div>
    </footer>
  );
};
