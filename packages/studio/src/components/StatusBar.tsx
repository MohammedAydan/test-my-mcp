import { Component } from 'solid-js';
import { store } from '../store.js';

export const StatusBar: Component = () => {
  const state = store.state;

  const sceneLabel = () => state.scene?.id || 'No scene';
  const layersLabel = () => `${state.scene?.layers?.length || 0} layers`;
  const engineUrlLabel = () => {
    try {
      const u = new URL(state.engine.url);
      return `:${u.port || '80'}`;
    } catch {
      return state.engine.url;
    }
  };

  return (
    <footer class="statusbar" role="contentinfo">
      <div class="status-item">
        <span class={`dot ${state.engine.online ? 'online' : 'offline'}`} id="status-dot"></span>
        <span id="status-message">{state.engine.online ? 'Ready' : 'Connecting…'}</span>
      </div>
      <div class="status-item" id="status-scene">
        {sceneLabel()}
      </div>
      <div class="status-item" id="status-layers">
        {layersLabel()}
      </div>
      <div class="status-spacer"></div>
      <div class="status-item" id="status-engine-url">
        {engineUrlLabel()}
      </div>
      <div class="status-item">v1.0.0</div>
    </footer>
  );
};
