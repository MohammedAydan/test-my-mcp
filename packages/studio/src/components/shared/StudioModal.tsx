import { Component, For, Show, createSignal } from 'solid-js';
import { store } from '../../state/store.js';
import { api } from '../../api.js';
import { createDefaultScene } from '../../services/commands.js';
import type { StudioLayer } from '../../types.js';
import { IconComposition, IconSearch } from '../icons/NleIcons.js';

/**
 * The Studio's auxiliary dialogs: open a composition, add a layer, and the
 * about box. They share one modal shell because they share one job — a
 * short, focused choice.
 */

const LAYER_TEMPLATES: Array<{ kind: string; label: string; description: string }> = [
  { kind: 'kineticText', label: 'Text', description: 'Kinetic typography with a staggered entrance' },
  { kind: 'card', label: 'Card', description: 'Glass / callout card with a title and body' },
  { kind: 'background', label: 'Background', description: 'Solid, mesh gradient or particle field' },
  { kind: 'imageLogo', label: 'Image / Logo', description: 'An image asset with a mask and shadow' },
  { kind: 'lottie', label: 'Lottie', description: 'A Lottie JSON animation scrubbed by the timeline' },
  { kind: 'foregroundFX', label: 'Effect Overlay', description: 'Vignette, film grain or colour grade' },
];

/** Build a layer of the requested kind at the playhead. */
export function buildLayer(kind: string, id: string): StudioLayer {
  const at = store.state.playhead;
  const duration = 3000;
  switch (kind) {
    case 'card':
      return {
        id,
        type: 'card',
        at,
        duration,
        position: { xPct: 50, yPct: 50 },
        variant: {
          variant: 'glassCard',
          title: 'Card Title',
          body: 'Description',
          widthPx: 800,
          paddingPx: 32,
          radiusPx: 16,
        },
      };
    case 'background':
      return {
        id,
        type: 'background',
        at: 0,
        variant: { variant: 'solid', color: '#101017' },
      };
    case 'imageLogo':
      return {
        id,
        type: 'imageLogo',
        at,
        duration,
        assetId: 'logo',
        widthPx: 240,
        position: { xPct: 50, yPct: 50 },
      };
    case 'lottie':
      return {
        id,
        type: 'lottie',
        at,
        duration,
        assetId: 'lottie',
        position: { xPct: 50, yPct: 50 },
      };
    case 'foregroundFX':
      return {
        id,
        type: 'foregroundFX',
        at: 0,
        effects: [{ kind: 'vignette', strength: 0.5, color: '#000000' }],
      };
    default:
      return {
        id,
        type: 'kineticText',
        at,
        duration,
        text: 'New Text',
        sizePx: 80,
        position: { xPct: 50, yPct: 50 },
        fill: '#ffffff',
        animateBy: 'word',
        entrance: { name: 'springPop' },
      };
  }
}

export const StudioModal: Component = () => {
  const state = store.state;
  const [scenes, setScenes] = createSignal<
    Array<{ id: string; name: string; revision: number; durationMs: number; layerCount: number }>
  >([]);
  const [search, setSearch] = createSignal('');

  const close = () => store.setActiveModal(null);

  const loadScenes = async () => {
    try {
      setScenes(await api.listScenes());
    } catch {
      setScenes([]);
    }
  };

  const openScene = async (id: string) => {
    try {
      const scene = await api.getScene(id);
      store.setScene(scene, id);
      store.addToast(`Loaded ${id}`, 'success');
      close();
    } catch (err) {
      store.addToast(`Could not load ${id}: ${(err as Error).message}`, 'error');
    }
  };

  const deleteScene = async (id: string) => {
    if (!window.confirm(`Delete composition "${id}"?`)) return;
    try {
      await api.deleteScene(id);
      await loadScenes();
      if (state.sceneId === id) store.setScene(null);
    } catch (err) {
      store.addToast(`Could not delete ${id}: ${(err as Error).message}`, 'error');
    }
  };

  const createComposition = async () => {
    const scene = createDefaultScene();
    try {
      const res = await api.createScene(scene);
      store.setScene({ ...scene, id: res.id }, res.id);
      store.addToast(`Created ${res.id}`, 'success');
      close();
    } catch (err) {
      store.addToast(`Could not create composition: ${(err as Error).message}`, 'error');
    }
  };

  const addLayer = (kind: string) => {
    if (!state.scene) {
      store.addToast('Load a composition before adding layers', 'warning');
      return;
    }
    const id = `${kind}-${Math.random().toString(36).slice(2, 7)}`;
    store.mutateScene((scene) => {
      scene.layers.push(buildLayer(kind, id));
    }, `Added ${kind} layer`);
    store.selectLayer(id);
    store.addToast(`Created ${kind} layer`, 'success');
    void store.executeSave().catch(() => undefined);
    close();
  };

  const filtered = () => {
    const q = search().toLowerCase().trim();
    if (!q) return scenes();
    return scenes().filter((s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
  };

  return (
    <Show when={state.activeModal === 'load' || state.activeModal === 'new' || state.activeModal === 'add-layer' || state.activeModal === 'about'}>
      <div
        class="mf-modal-backdrop"
        id="studio-modal-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div class="mf-modal" id="studio-modal" role="dialog" aria-modal="true">
          <Show when={state.activeModal === 'load'}>
            <div class="mf-modal-head">
              <span class="mf-modal-title">Open Composition</span>
              <button class="mf-btn" id="studio-modal-create" onClick={createComposition}>
                New Composition
              </button>
            </div>
            <div class="mf-modal-body">
              <div style={{ position: 'relative', 'margin-bottom': '10px' }}>
                <IconSearch
                  size={13}
                  style={{ position: 'absolute', left: '7px', top: '6px', color: 'var(--mf-text-3)' }}
                />
                <input
                  class="mf-input"
                  id="studio-modal-search"
                  style={{ 'padding-left': '26px' }}
                  placeholder="Search compositions"
                  value={search()}
                  onInput={(e) => setSearch(e.currentTarget.value)}
                  autofocus
                />
              </div>
              <Show
                when={scenes().length > 0}
                fallback={
                  <div class="mf-empty">
                    <IconComposition size={24} />
                    <div class="mf-empty-title">No compositions yet</div>
                    <div class="mf-empty-hint">Create one to start authoring.</div>
                  </div>
                }
              >
                <For each={filtered()}>
                  {(scene) => (
                    <div class="mf-bin-item" onClick={() => openScene(scene.id)}>
                      <div class="mf-bin-thumb">
                        <IconComposition size={13} />
                      </div>
                      <div class="mf-bin-meta">
                        <div class="mf-bin-name">{scene.name}</div>
                        <div class="mf-bin-sub">
                          {scene.id} · {scene.layerCount}L · rev {scene.revision}
                        </div>
                      </div>
                      <button
                        class="mf-icon-btn is-danger"
                        aria-label={`Delete ${scene.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteScene(scene.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </Show>

          <Show when={state.activeModal === 'new'}>
            <div class="mf-modal-head">
              <span class="mf-modal-title">New Composition</span>
            </div>
            <div class="mf-modal-body">
              <div class="mf-stat-grid">
                <div class="mf-stat">
                  <div class="mf-stat-k">Canvas</div>
                  <div class="mf-stat-v">16:9 @ 1080p</div>
                </div>
                <div class="mf-stat">
                  <div class="mf-stat-k">Duration</div>
                  <div class="mf-stat-v">8.000s</div>
                </div>
              </div>
              <button
                class="mf-btn is-primary"
                id="studio-modal-new-create"
                style={{ 'margin-top': '12px' }}
                onClick={createComposition}
              >
                Create Composition
              </button>
            </div>
          </Show>

          <Show when={state.activeModal === 'add-layer'}>
            <div class="mf-modal-head">
              <span class="mf-modal-title">Add Layer</span>
            </div>
            <div class="mf-modal-body">
              <div style={{ display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '6px' }}>
                <For each={LAYER_TEMPLATES}>
                  {(template) => (
                    <button
                      class="mf-btn"
                      data-layer-template={template.kind}
                      style={{ 'flex-direction': 'column', height: 'auto', padding: '10px', gap: '2px' }}
                      onClick={() => addLayer(template.kind)}
                    >
                      <span style={{ 'font-weight': '600' }}>{template.label}</span>
                      <span style={{ 'font-size': 'var(--mf-text-xs)', color: 'var(--mf-text-3)' }}>
                        {template.description}
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={state.activeModal === 'about'}>
            <div class="mf-modal-head">
              <span class="mf-modal-title">About MotionForge</span>
            </div>
            <div class="mf-modal-body">
              <div class="mf-stat-grid">
                <div class="mf-stat">
                  <div class="mf-stat-k">Engine</div>
                  <div class="mf-stat-v">In-Process</div>
                </div>
                <div class="mf-stat">
                  <div class="mf-stat-k">Schema</div>
                  <div class="mf-stat-v">SceneSpec v1</div>
                </div>
              </div>
            </div>
          </Show>

          <div class="mf-modal-foot">
            <button class="mf-btn" id="studio-modal-close" onClick={close}>
              Close
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
