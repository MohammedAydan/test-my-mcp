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
  let fileInputRef: HTMLInputElement | undefined;

  const handleAssetDragStart = (e: DragEvent, asset: { id: string; kind: string; src?: string; name?: string }) => {
    if (!e.dataTransfer) return;
    const payload = JSON.stringify({
      assetId: asset.id,
      kind: asset.kind,
      src: asset.src,
      name: asset.name || asset.id,
    });
    e.dataTransfer.setData('application/json', payload);
    e.dataTransfer.setData('text/plain', asset.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleFileUpload = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (loadEvt) => {
      const src = loadEvt.target?.result as string;
      const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
      const kind = file.type.startsWith('audio/')
        ? 'audio'
        : file.name.endsWith('.json')
        ? 'lottie'
        : file.type.startsWith('video/')
        ? 'video'
        : 'image';
      store.addAsset({
        id: `${cleanName}_${Math.random().toString(36).slice(2, 6)}`,
        kind: kind as any,
        src,
        name: file.name,
      });
      store.addToast(`Imported asset ${file.name}`, 'success');
    };
    reader.readAsDataURL(file);
    input.value = '';
  };

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
      <div class={`panel-content flex-1 overflow-y-auto ${state.activeLeftTab === 'assets' ? '' : 'hidden'}`} data-panel="assets" role="tabpanel">
        <div class="p-3 flex flex-col gap-3">
          <div class="flex items-center justify-between border-b border-[#242436] pb-2">
            <div>
              <div class="text-xs font-semibold text-[#e4e4e7]">Asset Vault</div>
              <div class="text-[11px] text-[#71717a]">{state.scene?.assets?.length || 0} project assets</div>
            </div>
            <button
              class="px-2 py-1 text-xs rounded bg-[#252538] hover:bg-[#34344d] text-[#e4e4e7] border border-[#3f3f58] flex items-center gap-1 font-medium"
              onClick={() => fileInputRef?.click()}
              title="Import local media file into Vault"
            >
              + Import
            </button>
            <input
              ref={fileInputRef}
              type="file"
              class="hidden"
              accept="image/*,audio/*,.json"
              onChange={handleFileUpload}
            />
          </div>

          {/* PROJECT ASSETS */}
          <div class="flex flex-col gap-1.5">
            <span class="text-[10px] uppercase font-bold tracking-wider text-[#a1a1aa]">Project Media</span>
            <Show
              when={(state.scene?.assets?.length || 0) > 0}
              fallback={
                <div class="p-3 rounded border border-dashed border-[#27273a] text-center text-[11px] text-[#71717a]">
                  No custom assets yet. Import images, logos, or Lottie JSON files.
                </div>
              }
            >
              <div class="grid grid-cols-1 gap-1.5">
                <For each={state.scene?.assets || []}>
                  {(asset) => (
                    <div
                      class="flex items-center gap-2 p-2 rounded bg-[#13131d] hover:bg-[#1c1c2b] border border-[#232334] cursor-grab active:cursor-grabbing transition-colors select-none group"
                      draggable={true}
                      data-asset-id={asset.id}
                      data-asset-kind={asset.kind}
                      onDragStart={(e) => handleAssetDragStart(e, asset)}
                    >
                      <div class="w-8 h-8 rounded bg-[#1f1f2e] border border-[#2e2e42] flex items-center justify-center flex-none overflow-hidden text-xs">
                        {asset.kind === 'image' && asset.src?.startsWith('data:') ? (
                          <img src={asset.src} alt={asset.name || asset.id} class="w-full h-full object-cover" />
                        ) : asset.kind === 'lottie' ? (
                          '✨'
                        ) : asset.kind === 'audio' ? (
                          '🔊'
                        ) : (
                          '🖼'
                        )}
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="text-xs text-[#e4e4e7] font-medium truncate group-hover:text-[#f59e0b]">
                          {asset.name || asset.id}
                        </div>
                        <div class="text-[10px] text-[#71717a] font-mono flex items-center gap-1">
                          <span class="px-1 py-0.2 bg-[#20202e] rounded text-[9px] uppercase">{asset.kind}</span>
                          <span class="truncate">{asset.id}</span>
                        </div>
                      </div>
                      <span class="text-[10px] text-[#52525b] group-hover:text-[#a1a1aa] flex-none">⠿</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* BUILT-IN SFX BANK */}
          <div class="flex flex-col gap-1.5 pt-2 border-t border-[#1e1e2d]">
            <span class="text-[10px] uppercase font-bold tracking-wider text-[#a1a1aa]">Built-in SFX Bank</span>
            <div class="grid grid-cols-2 gap-1.5">
              <For each={['whoosh', 'pop', 'click', 'subImpact', 'shimmer', 'riser']}>
                {(sfx) => (
                  <div
                    class="flex items-center gap-1.5 p-1.5 rounded bg-[#13131d] hover:bg-[#1c1c2b] border border-[#232334] cursor-grab active:cursor-grabbing text-xs text-[#d4d4d8] select-none group"
                    draggable={true}
                    data-asset-id={sfx}
                    data-asset-kind="audio"
                    onDragStart={(e) =>
                      handleAssetDragStart(e, {
                        id: sfx,
                        kind: 'audio',
                        name: `SFX: ${sfx}`,
                      })
                    }
                  >
                    <span class="text-[11px] text-[#10b981]">🔊</span>
                    <span class="truncate flex-1 font-mono text-[11px] group-hover:text-[#10b981]">{sfx}</span>
                    <span class="text-[9px] text-[#52525b]">⠿</span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
