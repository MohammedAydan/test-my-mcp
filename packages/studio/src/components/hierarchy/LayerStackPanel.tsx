import { Component, For, Show, createSignal } from 'solid-js';
import { store } from '../../state/store.js';
import { PanelContainer } from '../workspace/PanelContainer.js';
import {
  IconChevronRight,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconLock,
  IconSolo,
  IconTrash,
  IconUnlock,
} from '../icons/NleIcons.js';
import type { StudioLayer } from '../../types.js';

/**
 * The After Effects layer stack.
 *
 * A table, not a list of cards: `Eye · Solo · Lock · # · Label · Name · Kind ·
 * Track`. Every layer kind appears in one table with a colour swatch, which
 * is how a compositor actually reads a composition.
 *
 * Visibility and lock are REAL, PERSISTED layer fields (`visible`, `locked`)
 * — not UI-only markers — so they survive a save and a reload.
 */

export const LAYER_KIND_COLORS: Record<string, string> = {
  background: 'var(--mf-kind-background)',
  kineticText: 'var(--mf-kind-kineticText)',
  card: 'var(--mf-kind-card)',
  imageLogo: 'var(--mf-kind-imageLogo)',
  lottie: 'var(--mf-kind-lottie)',
  foregroundFX: 'var(--mf-kind-foregroundFX)',
};

export function layerKindColor(type: string): string {
  return LAYER_KIND_COLORS[type] ?? 'var(--mf-warning)';
}

/** The track lane label of a layer (`V1`, `V2`, …). */
export function trackLabel(layer: StudioLayer): string {
  const index = layer.trackIndex ?? layer.trackLane;
  if (typeof index !== 'number') return '—';
  return `V${index + 1}`;
}

export const LayerStackPanel: Component = () => {
  const state = store.state;
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [renameText, setRenameText] = createSignal('');
  const [dragIndex, setDragIndex] = createSignal<number | null>(null);

  const layers = () => state.scene?.layers ?? [];

  const isVisible = (layer: StudioLayer) => layer.visible !== false;
  const isLocked = (layer: StudioLayer) => layer.locked === true;

  const commitRename = (id: string) => {
    const name = renameText().trim();
    setRenamingId(null);
    if (!name) return;
    store.renameLayer(id, name);
  };

  return (
    <PanelContainer
      id="layer-stack"
      class="panel-container"
      tabs={['Layers']}
      activeTab="Layers"
      label="Layer stack"
      actions={
        <button
          class="mf-btn is-icon is-ghost"
          id="layer-add"
          title="Add a layer"
          aria-label="Add a layer"
          onClick={() => window.dispatchEvent(new CustomEvent('motionforge:add-layer', { detail: 'kineticText' }))}
        >
          <IconChevronRight size={12} style={{ transform: 'rotate(-90deg)' }} />
        </button>
      }
    >
      <div class="mf-stack-head" role="row">
        <span title="Visibility / Solo / Lock">Eye</span>
        <span title="Index">#</span>
        <span title="Label" />
        <span title="Layer name">Layer</span>
        <span title="Layer kind">Kind</span>
        <span title="Video track">Trk</span>
      </div>

      <div class="mf-panel-body is-scrollable" id="layer-stack-list">
        <Show
          when={layers().length > 0}
          fallback={
            <div class="mf-empty">
              <IconLayersFallback />
              <div class="mf-empty-title">No layers</div>
              <div class="mf-empty-hint">
                Add a text, card, logo or background layer to begin.
              </div>
            </div>
          }
        >
          <For each={layers()}>
            {(layer, index) => {
              const selected = () =>
                state.selectedLayerIds.includes(layer.id) || state.selectedLayerId === layer.id;
              return (
                <div
                  class={`mf-stack-row ${selected() ? 'is-selected' : ''} ${
                    isVisible(layer) ? '' : 'is-hidden'
                  }`}
                  data-layer-id={layer.id}
                  draggable={!isLocked(layer)}
                  onClick={(e) => store.selectLayer(layer.id, e.shiftKey || e.ctrlKey || e.metaKey)}
                  onDragStart={() => setDragIndex(index())}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = dragIndex();
                    setDragIndex(null);
                    if (from !== null) store.reorderLayer(from, index());
                  }}
                >
                  <span style={{ display: 'flex', gap: '1px', 'align-items': 'center' }}>
                    <button
                      class={`mf-icon-btn mf-stack-toggle ${isVisible(layer) ? 'is-on' : ''}`}
                      title={isVisible(layer) ? 'Hide layer' : 'Show layer'}
                      aria-label={isVisible(layer) ? 'Hide layer' : 'Show layer'}
                      aria-pressed={isVisible(layer)}
                      data-action="visibility"
                      onClick={(e) => {
                        e.stopPropagation();
                        store.toggleLayerVisibility(layer.id);
                      }}
                    >
                      {isVisible(layer) ? <IconEye size={12} /> : <IconEyeOff size={12} />}
                    </button>
                    <button
                      class="mf-icon-btn mf-stack-toggle"
                      title="Solo layer"
                      aria-label="Solo layer"
                      data-action="solo"
                      onClick={(e) => {
                        e.stopPropagation();
                        store.selectLayer(layer.id);
                      }}
                    >
                      <IconSolo size={12} />
                    </button>
                    <button
                      class={`mf-icon-btn mf-stack-toggle ${isLocked(layer) ? 'is-locked' : ''}`}
                      title={isLocked(layer) ? 'Unlock layer' : 'Lock layer'}
                      aria-label={isLocked(layer) ? 'Unlock layer' : 'Lock layer'}
                      aria-pressed={isLocked(layer)}
                      data-action="lock"
                      onClick={(e) => {
                        e.stopPropagation();
                        store.toggleLayerLock(layer.id);
                      }}
                    >
                      {isLocked(layer) ? <IconLock size={12} /> : <IconUnlock size={12} />}
                    </button>
                  </span>

                  <span class="mf-num" style={{ color: 'var(--mf-text-3)' }}>
                    {index() + 1}
                  </span>

                  <span class="mf-swatch" style={{ background: layerKindColor(layer.type) }} />

                  <Show
                    when={renamingId() === layer.id}
                    fallback={
                      <span
                        class="mf-stack-name"
                        title="Double-click to rename"
                        onDblClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(layer.id);
                          setRenameText(layer.name ?? layer.id);
                        }}
                      >
                        {layer.name ?? layer.id}
                      </span>
                    }
                  >
                    <input
                      class="mf-stack-name-input"
                      value={renameText()}
                      onClick={(e) => e.stopPropagation()}
                      onInput={(e) => setRenameText(e.currentTarget.value)}
                      onBlur={() => commitRename(layer.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(layer.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      autofocus
                    />
                  </Show>

                  <span class="mf-row-kind">{layer.type}</span>

                  <span class="mf-stack-track" style={{ display: 'flex', 'align-items': 'center', gap: '2px' }}>
                    <span>{trackLabel(layer)}</span>
                    <button
                      class="mf-icon-btn"
                      title="Duplicate layer (Ctrl+D)"
                      aria-label="Duplicate layer"
                      onClick={(e) => {
                        e.stopPropagation();
                        store.duplicateLayer(layer.id);
                      }}
                    >
                      <IconCopy size={11} />
                    </button>
                    <button
                      class="mf-icon-btn is-danger"
                      title="Delete layer"
                      aria-label="Delete layer"
                      onClick={(e) => {
                        e.stopPropagation();
                        store.deleteLayer(layer.id);
                      }}
                    >
                      <IconTrash size={11} />
                    </button>
                  </span>
                </div>
              );
            }}
          </For>
        </Show>
      </div>
    </PanelContainer>
  );
};

/** The empty-state glyph (the layer-stack icon). */
function IconLayersFallback() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="26"
      height="26"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </svg>
  );
}
