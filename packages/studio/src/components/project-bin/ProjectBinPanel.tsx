import { Component, For, Show, createSignal, createEffect, createMemo } from 'solid-js';
import { store } from '../../state/store.js';
import { api } from '../../api.js';
import { listAssets, SFX_BANK, type VaultAsset } from '../../services/asset-service.js';
import { createDefaultScene } from '../../services/commands.js';
import { writeAssetPayload } from '../../services/drag-payload.js';
import {
  IconChevronRight,
  IconComposition,
  IconCopy,
  IconFilePlus,
  IconGrid,
  IconImage,
  IconImport,
  IconList,
  IconPlus,
  IconSearch,
  IconTrash,
  IconWaveform,
} from '../icons/NleIcons.js';
import { PanelContainer } from '../workspace/PanelContainer.js';

/**
 * The Project Bin — scenes, media and the SFX bank.
 *
 * Everything here can be dragged onto the Program Monitor (to place it) or
 * onto the Timeline (to time it). The drag payload is a small JSON envelope
 * both drop targets understand.
 */

export const ProjectBinPanel: Component = () => {
  const state = store.state;
  const [tab, setTab] = createSignal<'compositions' | 'media' | 'sfx'>('compositions');
  const [search, setSearch] = createSignal('');
  const [view, setView] = createSignal<'grid' | 'list'>('list');
  const [scenes, setScenes] = createSceneList();
  const [assets, setAssets] = createAssetList();
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [renameText, setRenameText] = createSignal('');
  let fileInputRef: HTMLInputElement | undefined;

  /* ── scene list ─────────────────────────────────────────────────────── */

  const refreshScenes = async () => {
    try {
      setScenes(await api.listScenes());
    } catch {
      setScenes([]);
    }
  };

  const refreshAssets = async () => {
    try {
      setAssets(await listAssets());
    } catch {
      setAssets([]);
    }
  };

  createEffect(() => {
    void refreshScenes();
    void refreshAssets();
  });

  const createComposition = async () => {
    const scene = createDefaultScene();
    try {
      const res = await api.createScene(scene);
      store.setScene({ ...scene, id: res.id }, res.id);
      store.addToast(`Created composition ${res.id}`, 'success');
      await refreshScenes();
    } catch (err) {
      store.addToast(`Could not create composition: ${(err as Error).message}`, 'error');
    }
  };

  const duplicateComposition = async (id: string) => {
    const source = scenes().find((s) => s.id === id);
    if (!source) return;
    const current = state.sceneId === id ? state.scene : null;
    if (!current) {
      store.addToast('Load the composition before duplicating it', 'warning');
      return;
    }
    const copy = JSON.parse(JSON.stringify(current)) as typeof current;
    copy.id = `${id}-copy-${Date.now().toString(36).slice(-4)}`;
    copy.name = `${source.name} copy`;
    try {
      const res = await api.createScene(copy);
      store.addToast(`Duplicated composition ${res.id}`, 'success');
      await refreshScenes();
    } catch (err) {
      store.addToast(`Could not duplicate composition: ${(err as Error).message}`, 'error');
    }
  };

  const renameComposition = async (id: string) => {
    const current = state.sceneId === id ? state.scene : null;
    const name = renameText().trim();
    setRenaming(null);
    if (!current || !name) return;
    store.mutateScene((scene) => {
      scene.name = name;
    }, 'Rename composition');
    try {
      await store.executeSave();
      await refreshScenes();
    } catch {
      /* reported by the store */
    }
  };

  const deleteComposition = async (id: string) => {
    if (!window.confirm(`Delete composition "${id}"? This removes it from the engine and disk.`)) return;
    try {
      await api.deleteScene(id);
      if (state.sceneId === id) store.setScene(null);
      store.addToast(`Deleted composition ${id}`, 'info');
      await refreshScenes();
    } catch (err) {
      store.addToast(`Could not delete composition: ${(err as Error).message}`, 'error');
    }
  };

  const openComposition = async (id: string) => {
    try {
      const scene = await api.getScene(id);
      store.setScene(scene, id);
      store.addToast(`Loaded ${id}`, 'success');
    } catch (err) {
      store.addToast(`Could not load ${id}: ${(err as Error).message}`, 'error');
    }
  };

  /* ── assets ─────────────────────────────────────────────────────────── */

  const filteredAssets = createMemo(() => {
    const q = search().toLowerCase().trim();
    if (!q) return assets();
    return assets().filter((a) => a.name.toLowerCase().includes(q) || a.kind.toLowerCase().includes(q));
  });

  const handleFileUpload = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const asset = await api.uploadAsset(file.name, buffer);
      store.addAsset({
        id: asset.id,
        kind: (asset.kind === 'unknown' ? 'image' : asset.kind) as 'image' | 'video' | 'audio' | 'lottie',
        src: asset.src,
        name: asset.name,
      });
      store.addToast(`Imported ${asset.name}`, 'success');
      await refreshAssets();
    } catch (err) {
      store.addToast(`Import failed: ${(err as Error).message}`, 'error');
    }
  };

  const startAssetDrag = (
    event: DragEvent,
    asset: { id: string; kind: string; src?: string; name?: string }
  ) => writeAssetPayload(event, asset);

  const addAssetToScene = (asset: VaultAsset) => {
    store.addAsset({
      id: asset.id,
      kind: (asset.kind === 'unknown' ? 'image' : asset.kind) as 'image' | 'video' | 'audio' | 'lottie',
      src: asset.src,
      name: asset.name,
    });
    store.addToast(`Added ${asset.name} to the composition`, 'success');
  };

  return (
    <PanelContainer
      id="project-bin"
      tabs={['Compositions', 'Media', 'SFX']}
      activeTab={tab() === 'compositions' ? 'Compositions' : tab() === 'media' ? 'Media' : 'SFX'}
      onTabChange={(next) =>
        setTab(next === 'Compositions' ? 'compositions' : next === 'Media' ? 'media' : 'sfx')
      }
      label="Project bin"
      actions={
        <>
          <button
            class="mf-btn is-icon is-ghost"
            id="bin-view-list"
            title="List view"
            aria-label="List view"
            onClick={() => setView('list')}
          >
            <IconList size={13} />
          </button>
          <button
            class="mf-btn is-icon is-ghost"
            id="bin-view-grid"
            title="Grid view"
            aria-label="Grid view"
            onClick={() => setView('grid')}
          >
            <IconGrid size={13} />
          </button>
        </>
      }
    >
      {/* ── Compositions ─────────────────────────────────────────────── */}
      <Show when={tab() === 'compositions'}>
        <div class="mf-panel-body is-scrollable" id="bin-compositions">
          <div style={{ padding: '6px 8px', display: 'flex', gap: '4px' }}>
            <button class="mf-btn is-primary" id="bin-new-composition" onClick={createComposition}>
              <IconFilePlus size={12} />
              <span>New</span>
            </button>
            <button
              class="mf-btn"
              id="bin-duplicate-composition"
              disabled={!state.sceneId}
              onClick={() => state.sceneId && duplicateComposition(state.sceneId)}
            >
              <IconCopy size={12} />
              <span>Duplicate</span>
            </button>
          </div>

          <div class="mf-bin-list">
            <For each={scenes()} fallback={
              <div class="mf-empty">
                <IconComposition size={26} />
                <div class="mf-empty-title">No compositions</div>
                <div class="mf-empty-hint">Create one to start authoring.</div>
              </div>
            }>
              {(scene) => (
                <div
                  class={`mf-bin-item ${scene.id === state.sceneId ? 'is-active' : ''}`}
                  data-scene-id={scene.id}
                  onClick={() => openComposition(scene.id)}
                >
                  <div class="mf-bin-thumb">
                    <IconComposition size={13} />
                  </div>
                  <div class="mf-bin-meta">
                    <Show
                      when={renaming() === scene.id}
                      fallback={<div class="mf-bin-name">{scene.name}</div>}
                    >
                      <input
                        class="mf-stack-name-input"
                        value={renameText()}
                        onInput={(e) => setRenameText(e.currentTarget.value)}
                        onBlur={() => renameComposition(scene.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') renameComposition(scene.id);
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        autofocus
                      />
                    </Show>
                    <div class="mf-bin-sub">
                      {scene.layerCount}L · {(scene.durationMs / 1000).toFixed(1)}s · rev {scene.revision}
                    </div>
                  </div>
                  <button
                    class="mf-icon-btn"
                    title="Rename composition"
                    aria-label="Rename composition"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenaming(scene.id);
                      setRenameText(scene.name);
                    }}
                  >
                    <IconChevronRight size={12} />
                  </button>
                  <button
                    class="mf-icon-btn"
                    title="Duplicate composition"
                    aria-label="Duplicate composition"
                    onClick={(e) => {
                      e.stopPropagation();
                      duplicateComposition(scene.id);
                    }}
                  >
                    <IconCopy size={12} />
                  </button>
                  <button
                    class="mf-icon-btn is-danger"
                    title="Delete composition"
                    aria-label="Delete composition"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteComposition(scene.id);
                    }}
                  >
                    <IconTrash size={12} />
                  </button>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* ── Media ────────────────────────────────────────────────────── */}
      <Show when={tab() === 'media'}>
        <div class="mf-panel-body is-scrollable" id="bin-media">
          <div style={{ padding: '6px 8px', display: 'flex', gap: '4px', 'align-items': 'center' }}>
            <div style={{ position: 'relative', flex: '1' }}>
              <IconSearch
                size={12}
                style={{ position: 'absolute', left: '6px', top: '5px', color: 'var(--mf-text-3)' }}
              />
              <input
                class="mf-input"
                style={{ 'padding-left': '22px' }}
                placeholder="Search media"
                value={search()}
                onInput={(e) => setSearch(e.currentTarget.value)}
              />
            </div>
            <button class="mf-btn" id="bin-import-media" onClick={() => fileInputRef?.click()}>
              <IconImport size={12} />
              <span>Import</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              class="mf-hidden"
              accept="image/*,audio/*,video/*,.json"
              onChange={handleFileUpload}
            />
          </div>

          <Show when={assets().length === 0}>
            <div class="mf-empty">
              <IconImage size={26} />
              <div class="mf-empty-title">The vault is empty</div>
              <div class="mf-empty-hint">Import artwork, audio or Lottie JSON. Drag any item onto the canvas or the timeline.</div>
            </div>
          </Show>

          <div
            class="mf-bin-list"
            style={
              view() === 'grid'
                ? { display: 'grid', 'grid-template-columns': '1fr 1fr' }
                : undefined
            }
          >
            <For each={filteredAssets()}>
              {(asset) => (
                <div
                  class="mf-bin-item"
                  draggable={true}
                  data-asset-id={asset.id}
                  data-asset-kind={asset.kind}
                  title="Drag onto the canvas or the timeline"
                  onDragStart={(e) => startAssetDrag(e, asset)}
                >
                  <div class="mf-bin-thumb">
                    <Show
                      when={asset.kind === 'image' && asset.src?.startsWith('data:')}
                      fallback={<IconImage size={13} />}
                    >
                      <img src={asset.src} alt={asset.name} />
                    </Show>
                  </div>
                  <div class="mf-bin-meta">
                    <div class="mf-bin-name">{asset.name}</div>
                    <div class="mf-bin-sub">{asset.kind}</div>
                  </div>
                  <button
                    class="mf-icon-btn"
                    title="Add to composition"
                    aria-label={`Add ${asset.name} to the composition`}
                    onClick={() => addAssetToScene(asset)}
                  >
                    <IconPlus size={12} />
                  </button>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* ── SFX ──────────────────────────────────────────────────────── */}
      <Show when={tab() === 'sfx'}>
        <div class="mf-panel-body is-scrollable" id="bin-sfx">
          <div style={{ padding: '6px 8px' }}>
            <div class="mf-label" style={{ 'margin-bottom': '4px' }}>
              <span>Built-in SFX Bank</span>
              <span>{SFX_BANK.length} cues</span>
            </div>
          </div>
          <div class="mf-bin-list">
            <For each={SFX_BANK}>
              {(sfx) => (
                <div
                  class="mf-bin-item"
                  draggable={true}
                  data-asset-id={sfx}
                  data-asset-kind="audio"
                  title="Drag onto the timeline to place an audio cue"
                  onDragStart={(e) =>
                    startAssetDrag(e, { id: sfx, kind: 'audio', name: `SFX: ${sfx}` })
                  }
                >
                  <div class="mf-bin-thumb" style={{ color: 'var(--mf-audio)' }}>
                    <IconWaveform size={13} />
                  </div>
                  <div class="mf-bin-meta">
                    <div class="mf-bin-name" style={{ color: 'var(--mf-audio)' }}>
                      {sfx}
                    </div>
                    <div class="mf-bin-sub">sfx cue</div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </PanelContainer>
  );
};

/* ── small helpers for the local signals ─────────────────────────────── */

function createSceneList() {
  const [value, setValue] = createSignal<
    Array<{ id: string; name: string; revision: number; durationMs: number; layerCount: number }>
  >([]);
  return [value, setValue] as const;
}

function createAssetList() {
  const [value, setValue] = createSignal<VaultAsset[]>([]);
  return [value, setValue] as const;
}
