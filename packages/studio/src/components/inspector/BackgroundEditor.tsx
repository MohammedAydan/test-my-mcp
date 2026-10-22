import { Component, For, Show, createMemo } from 'solid-js';
import { store } from '../../state/store.js';
import {
  MAX_MESH_BLOBS,
  MIN_MESH_BLOBS,
  addMeshBlob,
  buildBackgroundVariant,
  readBlobs,
  removeMeshBlob,
  updateBackgroundVariant,
  updateMeshBlob,
} from '../../services/background-variant.js';
import { ScrubInput } from './ScrubInput.js';
import { IconMinus, IconPlus } from '../icons/NleIcons.js';

/**
 * The BACKGROUND editor.
 *
 * The background's `variant` is a discriminated union of STRICT objects, so
 * every write REBUILDS the payload (see `services/background-variant.ts`) —
 * a variant key from another variant is a validation error, not a style
 * choice.
 *
 * The editors are REAL: a mesh gradient has one row per blob (colour, x, y,
 * radius) with an add and a remove button, and a `media` background can only
 * reference an asset the composition actually DECLARES.
 */
export const BackgroundEditor: Component = () => {
  const state = store.state;

  /** the selected layer — the ONLY slice this editor reads. */
  const layer = createMemo(() => {
    if (!state.scene || !state.selectedLayerId) return null;
    return state.scene.layers.find((l) => l.id === state.selectedLayerId) ?? null;
  });

  /** the CURRENT variant payload. */
  const variant = createMemo<Record<string, unknown>>(
    () => (layer()?.variant ?? {}) as Record<string, unknown>
  );

  /** the variant's discriminator. */
  const kind = createMemo(() => String(variant().variant ?? 'solid'));

  /** the blobs of a mesh gradient, normalised. */
  const blobs = createMemo(() => readBlobs(variant()));

  /** the assets the composition DECLARES — a media background may only use one. */
  const declaredMedia = createMemo(() => {
    const assets = state.scene?.assets ?? [];
    return assets
      .filter((asset) => asset.kind === 'image' || asset.kind === 'video')
      .map((asset) => ({ id: asset.id, kind: asset.kind, name: asset.name ?? asset.id }));
  });

  /** write the variant back onto the layer. */
  const write = (next: Record<string, unknown>, description: string) => {
    const id = state.selectedLayerId;
    if (!id) return;
    store.updateLayer(id, { variant: next } as never, description);
  };

  /** change the variant — the payload is REBUILT, never spread. */
  const changeKind = (nextKind: string) => {
    write(
      buildBackgroundVariant(nextKind, variant(), declaredMedia().map((a) => a.id)),
      `Set background style of ${state.selectedLayerId}`
    );
  };

  /** patch one key of the CURRENT variant. */
  const patch = (key: string, value: unknown, description: string) => {
    write(
      updateBackgroundVariant(variant(), { [key]: value }, declaredMedia().map((a) => a.id)),
      description
    );
  };

  return (
    <div class="mf-background-editor" id="inspector-background">
      <div class="mf-field">
        <label class="mf-label">Background Style</label>
        <select
          class="mf-select"
          id="inspector-background-variant"
          value={kind()}
          disabled={layer()?.locked}
          onChange={(e) => changeKind(e.currentTarget.value)}
        >
          <option value="solid">Solid</option>
          <option value="meshGradient">Mesh Gradient</option>
          <option value="particles">Particles</option>
          {/* a media background may only reference a DECLARED asset — the
              option is disabled while the composition declares none */}
          <option value="media" disabled={declaredMedia().length === 0}>
            Media
          </option>
        </select>
      </div>

      {/* ── solid ── */}
      <Show when={kind() === 'solid'}>
        <div class="mf-field">
          <label class="mf-label">Color</label>
          <input
            type="color"
            class="mf-color-input"
            id="inspector-background-color"
            value={String(variant().color ?? '#05070d')}
            disabled={layer()?.locked}
            onChange={(e) =>
              patch('color', e.currentTarget.value, `Set background color of ${state.selectedLayerId}`)
            }
          />
        </div>
      </Show>

      {/* ── mesh gradient ── */}
      <Show when={kind() === 'meshGradient'}>
        <div class="mf-field">
          <label class="mf-label">Base Color</label>
          <input
            type="color"
            class="mf-color-input"
            id="inspector-background-base"
            value={String(variant().base ?? '#05070d')}
            disabled={layer()?.locked}
            onChange={(e) =>
              patch('base', e.currentTarget.value, `Set background base of ${state.selectedLayerId}`)
            }
          />
        </div>

        <div class="mf-field">
          <div class="mf-field-head">
            <span class="mf-label">Blobs</span>
            <span class="mf-field-note">
              {blobs().length}/{MAX_MESH_BLOBS}
            </span>
          </div>
          <For each={blobs()}>
            {(blob, index) => (
              <div class="mf-blob-row" data-blob-index={index()}>
                <input
                  type="color"
                  class="mf-color-input"
                  title={`Blob ${index() + 1} color`}
                  value={blob.color}
                  disabled={layer()?.locked}
                  onChange={(e) =>
                    write(
                      updateMeshBlob(variant(), index(), { color: e.currentTarget.value }),
                      `Set blob ${index() + 1} of ${state.selectedLayerId}`
                    )
                  }
                />
                <ScrubInput
                  label="X"
                  unit="%"
                  value={blob.xPct}
                  min={-100}
                  max={200}
                  step={1}
                  disabled={layer()?.locked}
                  onScrubStart={() => store.pushHistory(`Scrub blob ${index() + 1} x`)}
                  onChange={(val) =>
                    write(
                      updateMeshBlob(variant(), index(), { xPct: Math.round(val) }),
                      `Set blob ${index() + 1} of ${state.selectedLayerId}`
                    )
                  }
                  onCommit={() => void store.executeSave().catch(() => undefined)}
                />
                <ScrubInput
                  label="Y"
                  unit="%"
                  value={blob.yPct}
                  min={-100}
                  max={200}
                  step={1}
                  disabled={layer()?.locked}
                  onScrubStart={() => store.pushHistory(`Scrub blob ${index() + 1} y`)}
                  onChange={(val) =>
                    write(
                      updateMeshBlob(variant(), index(), { yPct: Math.round(val) }),
                      `Set blob ${index() + 1} of ${state.selectedLayerId}`
                    )
                  }
                  onCommit={() => void store.executeSave().catch(() => undefined)}
                />
                <ScrubInput
                  label="R"
                  unit="%"
                  value={blob.radiusPct}
                  min={5}
                  max={200}
                  step={1}
                  disabled={layer()?.locked}
                  onScrubStart={() => store.pushHistory(`Scrub blob ${index() + 1} radius`)}
                  onChange={(val) =>
                    write(
                      updateMeshBlob(variant(), index(), { radiusPct: Math.round(val) }),
                      `Set blob ${index() + 1} of ${state.selectedLayerId}`
                    )
                  }
                  onCommit={() => void store.executeSave().catch(() => undefined)}
                />
                <button
                  type="button"
                  class="mf-icon-btn is-danger"
                  title={
                    blobs().length <= MIN_MESH_BLOBS
                      ? `A mesh gradient needs at least ${MIN_MESH_BLOBS} blobs`
                      : `Remove blob ${index() + 1}`
                  }
                  aria-label={`Remove blob ${index() + 1}`}
                  disabled={blobs().length <= MIN_MESH_BLOBS || layer()?.locked}
                  onClick={() =>
                    write(
                      removeMeshBlob(variant(), index()),
                      `Remove blob ${index() + 1} of ${state.selectedLayerId}`
                    )
                  }
                >
                  <IconMinus size={11} />
                </button>
              </div>
            )}
          </For>
          <button
            type="button"
            class="mf-btn"
            id="inspector-background-add-blob"
            disabled={blobs().length >= MAX_MESH_BLOBS || layer()?.locked}
            onClick={() =>
              write(addMeshBlob(variant()), `Add blob to ${state.selectedLayerId}`)
            }
          >
            <IconPlus size={11} />
            <span>Add blob</span>
          </button>
        </div>
      </Show>

      {/* ── particles ── */}
      <Show when={kind() === 'particles'}>
        <div class="mf-grid-2">
          <div class="mf-field">
            <label class="mf-label">Count</label>
            <ScrubInput
              label="N"
              value={Number(variant().count ?? 40)}
              min={40}
              max={600}
              step={1}
              disabled={layer()?.locked}
              onScrubStart={() => store.pushHistory('Scrub particle count')}
              onChange={(val) =>
                patch('count', Math.round(val), `Set particle count of ${state.selectedLayerId}`)
              }
              onCommit={() => void store.executeSave().catch(() => undefined)}
            />
          </div>
          <div class="mf-field">
            <label class="mf-label">Color</label>
            <input
              type="color"
              class="mf-color-input"
              id="inspector-background-particle-color"
              value={String(variant().color ?? '#38bdf8')}
              disabled={layer()?.locked}
              onChange={(e) =>
                patch('color', e.currentTarget.value, `Set particle color of ${state.selectedLayerId}`)
              }
            />
          </div>
          <div class="mf-field">
            <label class="mf-label">Size</label>
            <ScrubInput
              label="S"
              unit="px"
              value={Number(variant().sizePx ?? 2.5)}
              min={1}
              max={12}
              step={0.5}
              disabled={layer()?.locked}
              onScrubStart={() => store.pushHistory('Scrub particle size')}
              onChange={(val) =>
                patch('sizePx', val, `Set particle size of ${state.selectedLayerId}`)
              }
              onCommit={() => void store.executeSave().catch(() => undefined)}
            />
          </div>
          <div class="mf-field">
            <label class="mf-label">Speed</label>
            <ScrubInput
              label="V"
              value={Number(variant().speed ?? 1)}
              min={0.1}
              max={3}
              step={0.1}
              disabled={layer()?.locked}
              onScrubStart={() => store.pushHistory('Scrub particle speed')}
              onChange={(val) => patch('speed', val, `Set particle speed of ${state.selectedLayerId}`)}
              onCommit={() => void store.executeSave().catch(() => undefined)}
            />
          </div>
        </div>
        <div class="mf-field">
          <label class="mf-label">Direction</label>
          <select
            class="mf-select"
            id="inspector-background-particle-direction"
            value={String(variant().direction ?? 'up')}
            disabled={layer()?.locked}
            onChange={(e) =>
              patch('direction', e.currentTarget.value, `Set particle direction of ${state.selectedLayerId}`)
            }
          >
            <option value="up">Up</option>
            <option value="down">Down</option>
            <option value="radial">Radial</option>
            <option value="sideways">Sideways</option>
          </select>
        </div>
      </Show>

      {/* ── media ── */}
      <Show when={kind() === 'media'}>
        <div class="mf-field">
          <label class="mf-label">Asset</label>
          <Show
            when={declaredMedia().length > 0}
            fallback={
              <div class="mf-empty-hint">
                This composition declares no image or video asset. Import one in the Project Bin
                first — a media background may only reference a DECLARED asset.
              </div>
            }
          >
            <select
              class="mf-select"
              id="inspector-background-asset"
              value={String(variant().assetId ?? '')}
              disabled={layer()?.locked}
              onChange={(e) =>
                patch('assetId', e.currentTarget.value, `Set background asset of ${state.selectedLayerId}`)
              }
            >
              <For each={declaredMedia()}>
                {(asset) => (
                  <option value={asset.id}>
                    {asset.name} ({asset.kind})
                  </option>
                )}
              </For>
            </select>
          </Show>
        </div>
        <div class="mf-grid-2">
          <div class="mf-field">
            <label class="mf-label">Blur</label>
            <ScrubInput
              label="B"
              unit="px"
              value={Number(variant().blurPx ?? 0)}
              min={0}
              max={60}
              step={1}
              disabled={layer()?.locked}
              onScrubStart={() => store.pushHistory('Scrub background blur')}
              onChange={(val) => patch('blurPx', val, `Set background blur of ${state.selectedLayerId}`)}
              onCommit={() => void store.executeSave().catch(() => undefined)}
            />
          </div>
          <div class="mf-field">
            <label class="mf-label">Dim</label>
            <ScrubInput
              label="D"
              unit="%"
              value={Math.round(Number(variant().dimOpacity ?? 0) * 100)}
              min={0}
              max={100}
              step={1}
              disabled={layer()?.locked}
              onScrubStart={() => store.pushHistory('Scrub background dim')}
              onChange={(val) =>
                patch('dimOpacity', val / 100, `Set background dim of ${state.selectedLayerId}`)
              }
              onCommit={() => void store.executeSave().catch(() => undefined)}
            />
          </div>
        </div>
      </Show>
    </div>
  );
};
