import { Component, Show, For, createMemo } from 'solid-js';
import { store } from '../store.js';
import type { StudioLayer } from '../types.js';
import { ScrubInput } from './ScrubInput.js';

export const Inspector: Component = () => {
  const state = store.state;

  const selectedLayer = createMemo((): StudioLayer | null => {
    if (!state.scene || !state.selectedLayerId) return null;
    return state.scene.layers.find((l) => l.id === state.selectedLayerId) || null;
  });

  const updateField = (path: string, value: unknown, desc?: string) => {
    store.mutateScene((scene) => {
      const layer = scene.layers.find((l) => l.id === state.selectedLayerId);
      if (!layer) return;

      const parts = path.split('.');
      let target: Record<string, unknown> = layer as unknown as Record<string, unknown>;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!target[parts[i]]) target[parts[i]] = {};
        target = target[parts[i]] as Record<string, unknown>;
      }
      target[parts[parts.length - 1]] = value;
    }, desc || `Edit ${path}`);
  };

  const getEntrancePresets = () => {
    return (
      state.capabilities?.presets?.entrance || [
        'fadeUp',
        'pop',
        'springPop',
        'maskRevealWipe',
        'blurIn',
        'typewriter',
      ]
    );
  };

  const getEmphasisPresets = () => {
    return (
      state.capabilities?.presets?.emphasis || [
        'none',
        'pulse',
        'shimmer',
        'float',
        'shake',
      ]
    );
  };

  const getExitPresets = () => {
    return (
      state.capabilities?.presets?.exit || [
        'none',
        'fadeOut',
        'popOut',
        'collapseMask',
        'blurOut',
      ]
    );
  };

  return (
    <aside class="panel panel-right" aria-label="Inspector and Capabilities">
      <div class="panel-tabs" role="tablist">
        <button
          class={`tab-btn ${state.activeRightTab === 'inspector' ? 'active' : ''}`}
          data-tab="inspector"
          role="tab"
          aria-selected={state.activeRightTab === 'inspector'}
          onClick={() => store.setActiveRightTab('inspector')}
        >
          Inspector
        </button>
        <button
          class={`tab-btn ${state.activeRightTab === 'caps' ? 'active' : ''}`}
          data-tab="caps"
          role="tab"
          aria-selected={state.activeRightTab === 'caps'}
          onClick={() => store.setActiveRightTab('caps')}
        >
          Capabilities
        </button>
      </div>

      {/* INSPECTOR PANEL */}
      <div
        class={`panel-content ${state.activeRightTab === 'inspector' ? '' : 'hidden'}`}
        data-panel="inspector"
        role="tabpanel"
      >
        <div class="inspector" id="inspector">
          <Show
            when={selectedLayer()}
            fallback={
              <div class="empty-state">
                <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <path d="M9 9h6M9 13h4" />
                </svg>
                <div class="empty-state-title">Select a layer</div>
                <div class="empty-state-hint">
                  Click any layer in the list or timeline to view and edit its parameters.
                </div>
              </div>
            }
          >
            {(layer) => {
              const isLocked = () => Boolean(layer()._locked);

              return (
                <div class="insp-scroll">
                  <div class="insp-layer-id">
                    <span>
                      {layer().type} : {layer().id}
                    </span>
                    <Show when={isLocked()}>
                      <span style="color: var(--warning); font-size: 11px;">🔒 Locked</span>
                    </Show>
                  </div>

                  {/* TIMING SECTION */}
                  <div class="insp-section">
                    <div class="insp-section-title">Timing & Lifecycle</div>
                    <div class="insp-input-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                      <div class="insp-field">
                        <label class="insp-label">Start Time</label>
                        <ScrubInput
                          label="At"
                          value={layer().at || 0}
                          unit="ms"
                          step={100}
                          min={0}
                          disabled={isLocked()}
                          onChange={(val) => updateField('at', val, `Set at of ${layer().id}`)}
                        />
                      </div>
                      <div class="insp-field">
                        <label class="insp-label">Duration</label>
                        <ScrubInput
                          label="Dur"
                          value={layer().duration || 3000}
                          unit="ms"
                          step={100}
                          min={100}
                          disabled={isLocked()}
                          onChange={(val) => updateField('duration', val, `Set duration of ${layer().id}`)}
                        />
                      </div>
                    </div>
                  </div>

                  {/* TRANSFORM SECTION */}
                  <Show when={layer().position}>
                    <div class="insp-section">
                      <div class="insp-section-title">Transform & Position</div>
                      <div class="insp-input-row" style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">
                        <div class="insp-field">
                          <label class="insp-label">X (%)</label>
                          <ScrubInput
                            label="X"
                            value={layer().position?.xPct ?? 50}
                            unit="%"
                            step={0.5}
                            disabled={isLocked()}
                            onChange={(val) => updateField('position.xPct', val, `Set xPct of ${layer().id}`)}
                          />
                        </div>
                        <div class="insp-field">
                          <label class="insp-label">Y (%)</label>
                          <ScrubInput
                            label="Y"
                            value={layer().position?.yPct ?? 50}
                            unit="%"
                            step={0.5}
                            disabled={isLocked()}
                            onChange={(val) => updateField('position.yPct', val, `Set yPct of ${layer().id}`)}
                          />
                        </div>
                        <div class="insp-field">
                          <label class="insp-label">Rot (°)</label>
                          <ScrubInput
                            label="R"
                            value={(layer() as any).rotation ?? 0}
                            unit="°"
                            step={1}
                            disabled={isLocked()}
                            onChange={(val) => updateField('rotation', val, `Set rotation of ${layer().id}`)}
                          />
                        </div>
                      </div>
                    </div>
                  </Show>

                  {/* KINETIC TEXT */}
                  <Show when={layer().type === 'kineticText'}>
                    <div class="insp-section">
                      <div class="insp-section-title">Typography & Appearance</div>
                      <div class="insp-field">
                        <label class="insp-label">Text Content</label>
                        <textarea
                          class="insp-input"
                          rows={2}
                          value={(layer() as unknown as { text?: string }).text || ''}
                          disabled={isLocked()}
                          onInput={(e) => updateField('text', e.currentTarget.value, `Set text of ${layer().id}`)}
                        />
                      </div>
                      <div class="insp-input-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                        <div class="insp-field">
                          <label class="insp-label">Font Size</label>
                          <ScrubInput
                            label="Size"
                            value={(layer() as unknown as { sizePx?: number }).sizePx || 80}
                            unit="px"
                            step={2}
                            min={10}
                            max={400}
                            disabled={isLocked()}
                            onChange={(val) => updateField('sizePx', val, `Set sizePx of ${layer().id}`)}
                          />
                        </div>
                        <div class="insp-field">
                          <label class="insp-label">Color</label>
                          <input
                            type="color"
                            class="insp-input"
                            style="padding: 2px; height: 32px;"
                            value={
                              typeof (layer() as unknown as { fill?: string }).fill === 'string'
                                ? (layer() as unknown as { fill?: string }).fill
                                : '#ffffff'
                            }
                            disabled={isLocked()}
                            onInput={(e) => updateField('fill', e.currentTarget.value, `Set fill of ${layer().id}`)}
                          />
                        </div>
                      </div>
                    </div>
                  </Show>

                  {/* CARD SIZING */}
                  <Show when={layer().type === 'card'}>
                    <div class="insp-section">
                      <div class="insp-section-title">Card Container</div>
                      <div class="insp-field">
                        <label class="insp-label">Width</label>
                        <ScrubInput
                          label="Width"
                          value={(layer() as any).variant?.widthPx || 800}
                          unit="px"
                          step={10}
                          min={100}
                          max={2000}
                          disabled={isLocked()}
                          onChange={(val) => updateField('variant.widthPx', val, `Set width of ${layer().id}`)}
                        />
                      </div>
                    </div>
                  </Show>

                  {/* MEDIA SIZING */}
                  <Show when={layer().type === 'imageLogo' || layer().type === 'lottie'}>
                    <div class="insp-section">
                      <div class="insp-section-title">Media Sizing</div>
                      <div class="insp-field">
                        <label class="insp-label">Width</label>
                        <ScrubInput
                          label="Width"
                          value={(layer() as any).widthPx || 240}
                          unit="px"
                          step={10}
                          min={20}
                          max={2000}
                          disabled={isLocked()}
                          onChange={(val) => updateField('widthPx', val, `Set width of ${layer().id}`)}
                        />
                      </div>
                    </div>
                  </Show>

                  {/* MOTION PRESETS */}
                  <div class="insp-section">
                    <div class="insp-section-title">Motion Presets</div>
                    <div class="insp-field">
                      <label class="insp-label">Entrance Preset</label>
                      <select
                        class="insp-input"
                        value={layer().entrance?.name || 'fadeUp'}
                        disabled={isLocked()}
                        onChange={(e) =>
                          updateField('entrance.name', e.currentTarget.value, `Set entrance of ${layer().id}`)
                        }
                      >
                        <For each={getEntrancePresets()}>{(p) => <option value={p}>{p}</option>}</For>
                      </select>
                    </div>
                    <div class="insp-field">
                      <label class="insp-label">Emphasis Preset</label>
                      <select
                        class="insp-input"
                        value={layer().emphasis?.name || 'none'}
                        disabled={isLocked()}
                        onChange={(e) =>
                          updateField('emphasis.name', e.currentTarget.value, `Set emphasis of ${layer().id}`)
                        }
                      >
                        <For each={getEmphasisPresets()}>{(p) => <option value={p}>{p}</option>}</For>
                      </select>
                    </div>
                    <div class="insp-field">
                      <label class="insp-label">Exit Preset</label>
                      <select
                        class="insp-input"
                        value={layer().exit?.name || 'none'}
                        disabled={isLocked()}
                        onChange={(e) =>
                          updateField('exit.name', e.currentTarget.value, `Set exit of ${layer().id}`)
                        }
                      >
                        <For each={getExitPresets()}>{(p) => <option value={p}>{p}</option>}</For>
                      </select>
                    </div>
                  </div>
                </div>
              );
            }}
          </Show>
        </div>
      </div>

      {/* CAPABILITIES PANEL */}
      <div class={`panel-content ${state.activeRightTab === 'caps' ? '' : 'hidden'}`} data-panel="caps" role="tabpanel">
        <div class="capabilities" id="capabilities">
          <Show
            when={state.capabilities}
            fallback={<div class="empty-state">Loading capabilities…</div>}
          >
            <div style="padding: 12px; display: flex; flex-direction: column; gap: 16px;">
              <div class="cap-section">
                <div class="cap-title">Motion Presets</div>
                <div class="cap-pills" style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px;">
                  <For each={state.capabilities?.presets?.entrance || ['fadeUp', 'pop', 'springPop']}>
                    {(p) => <span class="cap-pill" style="font-size: 11px; padding: 2px 6px; background: var(--bg-2); border-radius: 4px; color: var(--text-2);">{p}</span>}
                  </For>
                </div>
              </div>
              <div class="cap-section">
                <div class="cap-title">Easings</div>
                <div class="cap-pills" style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px;">
                  <For each={state.capabilities?.easings || ['power2.out', 'power3.out', 'back.out', 'elastic.out']}>
                    {(e) => <span class="cap-pill" style="font-size: 11px; padding: 2px 6px; background: var(--bg-2); border-radius: 4px; color: var(--text-2);">{e}</span>}
                  </For>
                </div>
              </div>
              <div class="cap-section">
                <div class="cap-title">SFX Bank</div>
                <div class="cap-pills" style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px;">
                  <For each={state.capabilities?.sfx || ['whoosh', 'pop', 'click', 'subImpact', 'shimmer', 'riser']}>
                    {(s) => <span class="cap-pill" style="font-size: 11px; padding: 2px 6px; background: var(--bg-2); border-radius: 4px; color: var(--text-2);">{s}</span>}
                  </For>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </aside>
  );
};
