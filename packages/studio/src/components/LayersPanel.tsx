import { Component, For, Show, createSignal } from 'solid-js';
import { store } from '../store.js';
import type { StudioLayer } from '../types.js';

export const LAYER_COLORS: Record<string, string> = {
  background: '#52525b',
  imageLogo: '#f59e0b',
  kineticText: '#f43f5e',
  card: '#14b8a6',
  lottie: '#22c55e',
  foregroundFX: '#3b82f6',
};

export const getLayerColor = (type: string) => LAYER_COLORS[type] || '#f59e0b';

interface LayersPanelProps {
  onAddLayer: () => void;
}

export const LayersPanel: Component<LayersPanelProps> = (props) => {
  const state = store.state;
  const [filterText, setFilterText] = createSignal('');
  let draggedIndex: number | null = null;

  const filteredLayers = () => {
    const list = state.scene?.layers || [];
    const q = filterText().toLowerCase().trim();
    if (!q) return list;
    return list.filter((l) => l.id.toLowerCase().includes(q) || l.type.toLowerCase().includes(q));
  };

  const toggleHide = (layer: StudioLayer) => {
    store.mutateScene((scene) => {
      const l = scene.layers.find((x) => x.id === layer.id);
      if (l) l._hidden = !l._hidden;
    }, `${layer._hidden ? 'Show' : 'Hide'} layer ${layer.id}`);
  };

  const toggleLock = (layer: StudioLayer) => {
    store.mutateScene((scene) => {
      const l = scene.layers.find((x) => x.id === layer.id);
      if (l) l._locked = !l._locked;
    }, `${layer._locked ? 'Unlock' : 'Lock'} layer ${layer.id}`);
  };

  const duplicateLayer = (layer: StudioLayer) => {
    store.mutateScene((scene) => {
      const clone = JSON.parse(JSON.stringify(layer));
      let newId = `${layer.id}-copy`;
      let counter = 1;
      while (scene.layers.some((x) => x.id === newId)) {
        newId = `${layer.id}-copy-${counter++}`;
      }
      clone.id = newId;
      clone.at = (layer.at || 0) + 100;
      scene.layers.push(clone);
      store.selectLayer(newId);
    }, `Duplicated layer ${layer.id}`);
    store.addToast(`Duplicated ${layer.id}`, 'success');
  };

  const deleteLayer = (layerId: string) => {
    store.mutateScene((scene) => {
      scene.layers = scene.layers.filter((l) => l.id !== layerId);
      if (state.selectedLayerId === layerId) {
        store.selectLayer(scene.layers[0]?.id || null);
      }
    }, `Deleted layer ${layerId}`);
    store.addToast(`Deleted layer ${layerId}`, 'info');
  };

  return (
    <aside class="panel panel-left" aria-label="Layers and Assets">
      <div class="panel-tabs" role="tablist">
        <button
          class={`tab-btn ${state.activeLeftTab === 'layers' ? 'active' : ''}`}
          data-tab="layers"
          role="tab"
          aria-selected={state.activeLeftTab === 'layers'}
          onClick={() => store.setActiveLeftTab('layers')}
        >
          Layers
        </button>
        <button
          class={`tab-btn ${state.activeLeftTab === 'scene' ? 'active' : ''}`}
          data-tab="scene"
          role="tab"
          aria-selected={state.activeLeftTab === 'scene'}
          onClick={() => store.setActiveLeftTab('scene')}
        >
          Scene
        </button>
        <button
          class={`tab-btn ${state.activeLeftTab === 'assets' ? 'active' : ''}`}
          data-tab="assets"
          role="tab"
          aria-selected={state.activeLeftTab === 'assets'}
          onClick={() => store.setActiveLeftTab('assets')}
        >
          Assets
        </button>
      </div>

      {/* LAYERS TAB */}
      <div class={`panel-content ${state.activeLeftTab === 'layers' ? '' : 'hidden'}`} data-panel="layers" role="tabpanel">
        <div class="layer-filter-wrap" style="padding: 8px 12px; border-bottom: 1px solid var(--border);">
          <input
            type="text"
            class="insp-input"
            placeholder="Filter layers..."
            style="padding: 4px 8px; font-size: 11px;"
            value={filterText()}
            onInput={(e) => setFilterText(e.currentTarget.value)}
          />
        </div>

        <div class="layer-list" id="layer-list">
          <Show
            when={filteredLayers().length > 0}
            fallback={
              <div class="empty-state">
                <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3" />
                  <path d="M12 8v8M8 12h8" />
                </svg>
                <div class="empty-state-title">{state.scene ? 'No layers match filter' : 'No scene loaded'}</div>
                <div class="empty-state-hint">Add text, cards, logos, or backgrounds to your scene.</div>
              </div>
            }
          >
            <For each={filteredLayers()}>
              {(layer, idx) => {
                const isSelected = () =>
                  state.selectedLayerIds.includes(layer.id) || state.selectedLayerId === layer.id;
                const isLocked = () => Boolean(layer._locked);
                const isHidden = () => Boolean(layer._hidden);

                return (
                  <div
                    class={`layer-item ${isSelected() ? 'selected' : ''} ${isHidden() ? 'layer-hidden' : ''} ${
                      isLocked() ? 'layer-locked' : ''
                    }`}
                    draggable={!isLocked()}
                    data-id={layer.id}
                    data-index={idx()}
                    style={isHidden() ? 'opacity: 0.45;' : ''}
                    onClick={(e) => {
                      const isMulti = e.shiftKey || e.ctrlKey || e.metaKey;
                      store.selectLayer(layer.id, isMulti);
                    }}
                    onDragStart={(e) => {
                      draggedIndex = idx();
                      e.dataTransfer!.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer!.dropEffect = 'move';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggedIndex === null || draggedIndex === idx()) return;
                      const from = draggedIndex;
                      const to = idx();
                      store.mutateScene((scene) => {
                        const [moved] = scene.layers.splice(from, 1);
                        scene.layers.splice(to, 0, moved);
                      }, `Reordered layer ${layer.id}`);
                      draggedIndex = null;
                    }}
                  >
                    <span class="layer-color" style={`background: ${getLayerColor(layer.type)}`}></span>
                    <span class="layer-name" title="Double-click to rename">
                      {layer.id || 'unnamed'}
                    </span>
                    <span class="layer-type">{layer.type}</span>
                    <div class="layer-actions">
                      <button
                        class="layer-action-btn"
                        aria-label={isHidden() ? 'Show layer' : 'Hide layer'}
                        data-tooltip={isHidden() ? 'Show layer' : 'Hide layer'}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleHide(layer);
                        }}
                      >
                        {isHidden() ? '👁️‍🗨️' : '👁'}
                      </button>
                      <button
                        class="layer-action-btn"
                        aria-label={isLocked() ? 'Unlock layer' : 'Lock layer'}
                        data-tooltip={isLocked() ? 'Unlock layer' : 'Lock layer'}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleLock(layer);
                        }}
                      >
                        {isLocked() ? '🔒' : '🔓'}
                      </button>
                      <button
                        class="layer-action-btn"
                        aria-label="Duplicate layer"
                        data-tooltip="Duplicate (Ctrl+D)"
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateLayer(layer);
                        }}
                      >
                        ⎘
                      </button>
                      <button
                        class="layer-action-btn delete"
                        aria-label="Delete layer"
                        data-tooltip="Delete layer"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteLayer(layer.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>

        <div class="panel-footer">
          <button class="add-btn" id="btn-add-layer" data-tooltip="Add a new layer at playhead" onClick={props.onAddLayer}>
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
            Add Layer
          </button>
        </div>
      </div>

      {/* SCENE TAB */}
      <div class={`panel-content ${state.activeLeftTab === 'scene' ? '' : 'hidden'}`} data-panel="scene" role="tabpanel">
        <div class="scene-info" id="scene-info">
          <Show
            when={state.scene}
            fallback={<div class="empty-state">No scene</div>}
          >
            <div style="padding: 12px; display: flex; flex-direction: column; gap: 12px;">
              <div class="insp-row">
                <span class="insp-label">Scene ID</span>
                <span class="insp-val font-mono">{state.scene!.id}</span>
              </div>
              <div class="insp-row">
                <span class="insp-label">Duration</span>
                <span class="insp-val">{((state.scene!.durationMs || 0) / 1000).toFixed(1)}s</span>
              </div>
              <div class="insp-row">
                <span class="insp-label">FPS</span>
                <span class="insp-val">{state.scene!.fps || 30}</span>
              </div>
              <div class="insp-row">
                <span class="insp-label">Canvas</span>
                <span class="insp-val">{state.scene!.canvas?.shape} ({state.scene!.canvas?.scale}p)</span>
              </div>
              <div class="insp-row">
                <span class="insp-label">Layers Count</span>
                <span class="insp-val">{state.scene!.layers?.length || 0}</span>
              </div>
            </div>
          </Show>
        </div>
      </div>

      {/* ASSETS TAB */}
      <div class={`panel-content ${state.activeLeftTab === 'assets' ? '' : 'hidden'}`} data-panel="assets" role="tabpanel">
        <div style="padding: 12px;">
          <div class="empty-state-title" style="margin-bottom: 8px;">Asset Vault</div>
          <div class="empty-state-hint">Manage project media, images, audio, and Lottie animations.</div>
        </div>
      </div>
    </aside>
  );
};
