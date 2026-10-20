import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { store } from '../../state/store.js';
import type { StudioLayer } from '../../types.js';
import { ScrubInput } from './ScrubInput.js';
import { PanelContainer } from '../workspace/PanelContainer.js';
import { layerKindColor } from '../hierarchy/LayerStackPanel.js';
import {
  IconChevronRight,
  IconComposition,
  IconLock,
  IconReset,
} from '../icons/NleIcons.js';

/**
 * Effect Controls — the property inspector.
 *
 * Two modes:
 *  - a LAYER is selected → the transform / timing / content accordions for
 *    that layer, with the content section switching on the layer kind,
 *  - nothing is selected → the COMPOSITION settings.
 *
 * Every numeric field is a `<ScrubInput />`: one undo snapshot per gesture,
 * one atomic save per gesture.
 */

interface AccordionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: unknown;
}

const Accordion: Component<AccordionProps> = (props) => (
  <div class={`mf-accordion ${props.open ? 'is-open' : ''}`}>
    <button class="mf-accordion-head" onClick={props.onToggle} aria-expanded={props.open}>
      <IconChevronRight size={11} class="mf-accordion-chevron" />
      <span>{props.title}</span>
    </button>
    <Show when={props.open}>
      <div class="mf-accordion-body">{props.children as never}</div>
    </Show>
  </div>
);

export const EffectControlsPanel: Component = () => {
  const state = store.state;
  const [openSections, setOpenSections] = createSignal({
    transform: true,
    timing: true,
    content: true,
    composition: true,
  });

  const selectedLayer = createMemo<StudioLayer | null>(() => {
    if (!state.scene || !state.selectedLayerId) return null;
    return state.scene.layers.find((l) => l.id === state.selectedLayerId) ?? null;
  });

  const toggle = (key: keyof ReturnType<typeof openSections>) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  /* ── layer field helpers ─────────────────────────────────────────────── */

  const patch = (field: Partial<StudioLayer>, description: string, recordHistory = true) => {
    const id = state.selectedLayerId;
    if (!id) return;
    store.updateLayer(id, field, description, recordHistory);
  };

  /**
   * Bind a scrub field to a dotted path on the selected layer.
   *
   * `onScrubStart` pushes ONE undo snapshot; `onCommit` issues ONE atomic
   * save. The live value is written WITHOUT history so a drag does not flood
   * the undo stack.
   */
  const bindScrub = (path: string, label: string) => ({
    onScrubStart: () => {
      const id = state.selectedLayerId;
      if (!id) return;
      store.pushHistory(`Scrub ${label}`);
    },
    onChange: (val: number) => {
      const id = state.selectedLayerId;
      if (!id) return;
      const layer = state.scene?.layers.find((l) => l.id === id);
      if (!layer) return;
      const parts = path.split('.');
      const next: Record<string, unknown> = { ...(layer as unknown as Record<string, unknown>) };
      let cursor: Record<string, unknown> = next;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (!key) continue;
        const child = cursor[key];
        cursor[key] = typeof child === 'object' && child !== null ? { ...(child as object) } : {};
        cursor = cursor[key] as Record<string, unknown>;
      }
      const last = parts[parts.length - 1];
      if (last) cursor[last] = val;
      store.patchLayer(id, next);
    },
    onCommit: () => {
      void store.executeSave();
    },
  });

  const setText = (path: string, value: string, label: string) => {
    const id = state.selectedLayerId;
    if (!id) return;
    store.updateLayer(
      id,
      { [path]: value } as Partial<StudioLayer>,
      `Set ${label} of ${id}`
    );
  };

  const presetList = (kind: 'entrance' | 'emphasis' | 'exit'): string[] => {
    const presets = state.capabilities?.presets?.[kind];
    if (presets && presets.length > 0) return presets;
    if (kind === 'entrance') return ['fadeUp', 'pop', 'springPop', 'maskRevealWipe', 'blurIn', 'typewriter'];
    if (kind === 'emphasis') return ['none', 'pulse', 'shimmer', 'float', 'shake'];
    return ['none', 'fadeOut', 'popOut', 'collapseMask', 'blurOut'];
  };

  const presetName = (kind: 'entrance' | 'emphasis' | 'exit'): string => {
    const layer = selectedLayer();
    const ref = layer?.[kind] as { name?: string } | undefined;
    return ref?.name ?? (kind === 'emphasis' ? 'none' : '');
  };

  const setPreset = (kind: 'entrance' | 'emphasis' | 'exit', name: string) => {
    const id = state.selectedLayerId;
    if (!id) return;
    store.updateLayer(
      id,
      { [kind]: { name } } as Partial<StudioLayer>,
      `Set ${kind} of ${id}`
    );
  };

  /* ── composition settings ────────────────────────────────────────────── */

  const compositionPatch = (field: Record<string, unknown>, description: string) => {
    store.mutateScene((scene) => {
      Object.assign(scene, field);
    }, description);
  };

  return (
    <PanelContainer
      id="effect-controls"
      tabs={['Effect Controls']}
      activeTab="Effect Controls"
      label="Effect controls"
    >
      <Show
        when={selectedLayer()}
        fallback={
          <div class="mf-panel-body is-scrollable" id="composition-settings">
            <Accordion
              title="Composition"
              open={openSections().composition}
              onToggle={() => toggle('composition')}
            >
              <div class="mf-field">
                <label class="mf-label">Name</label>
                <input
                  class="mf-input"
                  value={state.scene?.name ?? ''}
                  onChange={(e) =>
                    compositionPatch({ name: e.currentTarget.value }, 'Rename composition')
                  }
                />
              </div>

              <div class="mf-grid-2">
                <div class="mf-field">
                  <label class="mf-label">Shape</label>
                  <select
                    class="mf-select"
                    value={state.scene?.canvas?.shape ?? '16:9'}
                    onChange={(e) =>
                      compositionPatch(
                        { canvas: { ...(state.scene?.canvas ?? { shape: '16:9', scale: 1080 }), shape: e.currentTarget.value } },
                        'Change canvas shape'
                      )
                    }
                  >
                    <option value="16:9">16:9 Landscape</option>
                    <option value="9:16">9:16 Vertical</option>
                    <option value="1:1">1:1 Square</option>
                    <option value="4:5">4:5 Portrait</option>
                  </select>
                </div>
                <div class="mf-field">
                  <label class="mf-label">Scale</label>
                  <select
                    class="mf-select"
                    value={String(state.scene?.canvas?.scale ?? 1080)}
                    onChange={(e) =>
                      compositionPatch(
                        { canvas: { ...(state.scene?.canvas ?? { shape: '16:9', scale: 1080 }), scale: Number(e.currentTarget.value) } },
                        'Change canvas scale'
                      )
                    }
                  >
                    <option value="720">720p</option>
                    <option value="1080">1080p</option>
                    <option value="1440">1440p</option>
                    <option value="2160">2160p</option>
                  </select>
                </div>
              </div>

              <div class="mf-grid-2">
                <div class="mf-field">
                  <label class="mf-label">Duration</label>
                  <ScrubInput
                    label="Dur"
                    unit="ms"
                    value={state.scene?.durationMs ?? 8000}
                    min={300}
                    max={600000}
                    step={100}
                    onScrubStart={() => store.pushHistory('Scrub composition duration')}
                    onChange={(val) =>
                      store.mutateScene((scene) => {
                        scene.durationMs = Math.round(val);
                      }, 'Scrub composition duration')
                    }
                    onCommit={() => void store.executeSave()}
                  />
                </div>
                <div class="mf-field">
                  <label class="mf-label">Frame Rate</label>
                  <select class="mf-select" value="30" disabled>
                    <option value="24">24 fps</option>
                    <option value="30">30 fps</option>
                    <option value="60">60 fps</option>
                  </select>
                </div>
              </div>

              <div class="mf-field">
                <label class="mf-label">Camera Motion</label>
                <select
                  class="mf-select"
                  value={state.scene?.camera?.moves?.[0]?.move ?? 'static'}
                  onChange={(e) =>
                    compositionPatch(
                      {
                        camera: {
                          perspective: state.scene?.camera?.perspective ?? 1200,
                          keyframes: state.scene?.camera?.keyframes ?? [],
                          moves:
                            e.currentTarget.value === 'static'
                              ? []
                              : [
                                  {
                                    move: e.currentTarget.value as never,
                                    at: 0,
                                    durationMs: state.scene?.durationMs ?? 8000,
                                  },
                                ],
                        },
                      },
                      'Change camera motion'
                    )
                  }
                >
                  <option value="static">Static</option>
                  <option value="slowPushIn">Slow Push In</option>
                  <option value="whipPanRight">Whip Pan Right</option>
                  <option value="whipPanLeft">Whip Pan Left</option>
                  <option value="shakeImpact">Shake Impact</option>
                  <option value="focusTarget">Focus Target</option>
                </select>
              </div>
            </Accordion>

            <Accordion title="Seam Transitions" open={false} onToggle={() => toggle('composition')}>
              <div class="mf-empty-hint" style={{ padding: '4px 0' }}>
                Transitions are authored on the scene timeline. Use the timeline toolbar to
                add a wipe, glitch, whip pan or morph at the playhead.
              </div>
            </Accordion>
          </div>
        }
      >
        {(layer) => (
          <div class="mf-panel-body is-scrollable" id="layer-properties">
            {/* layer header */}
            <div
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '6px',
                padding: '6px 8px',
                'border-bottom': '1px solid var(--mf-border)',
                background: 'var(--mf-bg-header)',
              }}
            >
              <span class="mf-swatch" style={{ background: layerKindColor(layer().type) }} />
              <input
                class="mf-input"
                style={{ height: '20px' }}
                value={layer().name ?? layer().id}
                aria-label="Layer name"
                onChange={(e) => setText('name', e.currentTarget.value, 'name')}
              />
              <span class="mf-chip">{layer().type}</span>
              <Show when={layer().locked}>
                <span class="mf-chip is-warning" title="Layer is locked">
                  <IconLock size={10} />
                </span>
              </Show>
            </div>

            {/* transform */}
            <Accordion title="Transform" open={openSections().transform} onToggle={() => toggle('transform')}>
              <div class="mf-grid-2">
                <div class="mf-field">
                  <label class="mf-label">Position X</label>
                  <ScrubInput
                    label="X"
                    unit="%"
                    value={layer().position?.xPct ?? 50}
                    min={-200}
                    max={200}
                    step={0.5}
                    disabled={layer().locked}
                    {...bindScrub('position.xPct', `xPct of ${layer().id}`)}
                  />
                </div>
                <div class="mf-field">
                  <label class="mf-label">Position Y</label>
                  <ScrubInput
                    label="Y"
                    unit="%"
                    value={layer().position?.yPct ?? 50}
                    min={-200}
                    max={200}
                    step={0.5}
                    disabled={layer().locked}
                    {...bindScrub('position.yPct', `yPct of ${layer().id}`)}
                  />
                </div>
              </div>

              <div class="mf-grid-3">
                <div class="mf-field">
                  <label class="mf-label">Scale</label>
                  <ScrubInput
                    label="S"
                    unit="%"
                    value={Math.round((layer().scale ?? 1) * 100)}
                    min={5}
                    max={1000}
                    step={1}
                    disabled={layer().locked}
                    {...bindScrub('scale', `scale of ${layer().id}`)}
                  />
                </div>
                <div class="mf-field">
                  <label class="mf-label">Rotation</label>
                  <ScrubInput
                    label="R"
                    unit="°"
                    value={layer().rotation ?? 0}
                    min={-3600}
                    max={3600}
                    step={1}
                    disabled={layer().locked}
                    {...bindScrub('rotation', `rotation of ${layer().id}`)}
                  />
                </div>
                <div class="mf-field">
                  <label class="mf-label">Opacity</label>
                  <ScrubInput
                    label="O"
                    unit="%"
                    value={Math.round((layer().opacity ?? 1) * 100)}
                    min={0}
                    max={100}
                    step={1}
                    disabled={layer().locked}
                    {...bindScrub('opacity', `opacity of ${layer().id}`)}
                  />
                </div>
              </div>

              <div class="mf-field">
                <label class="mf-label">Quick Align</label>
                <div style={{ display: 'flex', gap: '3px' }}>
                  <For
                    each={[
                      { label: 'L', x: 10 },
                      { label: 'C', x: 50 },
                      { label: 'R', x: 90 },
                    ]}
                  >
                    {(align) => (
                      <button
                        class="mf-btn"
                        style={{ flex: '1' }}
                        title={`Align horizontal ${align.label}`}
                        onClick={() =>
                          patch(
                            { position: { xPct: align.x, yPct: layer().position?.yPct ?? 50 } },
                            `Align ${align.label} of ${layer().id}`
                          )
                        }
                      >
                        {align.label}
                      </button>
                    )}
                  </For>
                  <For
                    each={[
                      { label: 'T', y: 12 },
                      { label: 'M', y: 50 },
                      { label: 'B', y: 88 },
                    ]}
                  >
                    {(align) => (
                      <button
                        class="mf-btn"
                        style={{ flex: '1' }}
                        title={`Align vertical ${align.label}`}
                        onClick={() =>
                          patch(
                            { position: { xPct: layer().position?.xPct ?? 50, yPct: align.y } },
                            `Align ${align.label} of ${layer().id}`
                          )
                        }
                      >
                        {align.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>

              <button
                class="mf-btn"
                id="inspector-reset-transform"
                onClick={() =>
                  patch(
                    {
                      position: { xPct: 50, yPct: 50 },
                      rotation: 0,
                      scale: 1,
                      opacity: 1,
                    },
                    `Reset transform of ${layer().id}`
                  )
                }
              >
                <IconReset size={12} />
                <span>Reset Transform</span>
              </button>
            </Accordion>

            {/* timing */}
            <Accordion title="Timing" open={openSections().timing} onToggle={() => toggle('timing')}>
              <div class="mf-grid-2">
                <div class="mf-field">
                  <label class="mf-label">Start</label>
                  <ScrubInput
                    label="At"
                    unit="ms"
                    value={layer().at ?? 0}
                    min={0}
                    step={100}
                    disabled={layer().locked}
                    {...bindScrub('at', `at of ${layer().id}`)}
                  />
                </div>
                <div class="mf-field">
                  <label class="mf-label">Duration</label>
                  <ScrubInput
                    label="Dur"
                    unit="ms"
                    value={layer().duration ?? 3000}
                    min={100}
                    step={100}
                    disabled={layer().locked}
                    {...bindScrub('duration', `duration of ${layer().id}`)}
                  />
                </div>
              </div>

              <div class="mf-field">
                <label class="mf-label">Out point</label>
                <ScrubInput
                  label="Out"
                  unit="ms"
                  value={(layer().at ?? 0) + (layer().duration ?? 3000)}
                  min={0}
                  step={100}
                  disabled={layer().locked}
                  onScrubStart={() => store.pushHistory(`Scrub out of ${layer().id}`)}
                  onChange={(val) =>
                    store.patchLayer(layer().id, { duration: Math.max(100, val - (layer().at ?? 0)) })
                  }
                  onCommit={() => void store.executeSave()}
                />
              </div>

              <div class="mf-field">
                <label class="mf-label">Entrance</label>
                <select
                  class="mf-select"
                  value={presetName('entrance')}
                  disabled={layer().locked}
                  onChange={(e) => setPreset('entrance', e.currentTarget.value)}
                >
                  <option value="">None</option>
                  <For each={presetList('entrance')}>{(p) => <option value={p}>{p}</option>}</For>
                </select>
              </div>
              <div class="mf-field">
                <label class="mf-label">Emphasis</label>
                <select
                  class="mf-select"
                  value={presetName('emphasis')}
                  disabled={layer().locked}
                  onChange={(e) => setPreset('emphasis', e.currentTarget.value)}
                >
                  <For each={presetList('emphasis')}>{(p) => <option value={p}>{p}</option>}</For>
                </select>
              </div>
              <div class="mf-field">
                <label class="mf-label">Exit</label>
                <select
                  class="mf-select"
                  value={presetName('exit')}
                  disabled={layer().locked}
                  onChange={(e) => setPreset('exit', e.currentTarget.value)}
                >
                  <option value="">None</option>
                  <For each={presetList('exit')}>{(p) => <option value={p}>{p}</option>}</For>
                </select>
              </div>
            </Accordion>

            {/* content */}
            <Accordion title="Content & Style" open={openSections().content} onToggle={() => toggle('content')}>
              <Show when={layer().type === 'kineticText'}>
                <div class="mf-field">
                  <label class="mf-label">Text</label>
                  <textarea
                    class="mf-textarea"
                    rows={2}
                    value={layer().text ?? ''}
                    disabled={layer().locked}
                    onChange={(e) => setText('text', e.currentTarget.value, 'text')}
                  />
                </div>
                <div class="mf-grid-3">
                  <div class="mf-field">
                    <label class="mf-label">Size</label>
                    <ScrubInput
                      label="Px"
                      unit="px"
                      value={layer().sizePx ?? 80}
                      min={8}
                      max={600}
                      step={2}
                      disabled={layer().locked}
                      {...bindScrub('sizePx', `sizePx of ${layer().id}`)}
                    />
                  </div>
                  <div class="mf-field">
                    <label class="mf-label">Weight</label>
                    <select
                      class="mf-select"
                      value={String(layer().fontWeight ?? 800)}
                      disabled={layer().locked}
                      onChange={(e) => setText('fontWeight', e.currentTarget.value, 'fontWeight')}
                    >
                      <For each={[300, 400, 500, 600, 700, 800, 900]}>
                        {(w) => <option value={String(w)}>{w}</option>}
                      </For>
                    </select>
                  </div>
                  <div class="mf-field">
                    <label class="mf-label">Color</label>
                    <input
                      type="color"
                      class="mf-color-input"
                      value={
                        (typeof layer().fill === 'string' ? layer().fill : '#ffffff') as string
                      }
                      disabled={layer().locked}
                      onChange={(e) => setText('fill', e.currentTarget.value, 'fill')}
                    />
                  </div>
                </div>
                <div class="mf-field">
                  <label class="mf-label">Animation Style</label>
                  <select
                    class="mf-select"
                    value={layer().animateBy ?? 'word'}
                    disabled={layer().locked}
                    onChange={(e) => setText('animateBy', e.currentTarget.value, 'animateBy')}
                  >
                    <option value="word">Word Stagger</option>
                    <option value="char">Char Wave</option>
                    <option value="line">Line Reveal</option>
                  </select>
                </div>
              </Show>

              <Show when={layer().type === 'card'}>
                <div class="mf-field">
                  <label class="mf-label">Title</label>
                  <input
                    class="mf-input"
                    value={String(layer().variant?.title ?? '')}
                    disabled={layer().locked}
                    onChange={(e) =>
                      patch(
                        { variant: { ...(layer().variant ?? {}), title: e.currentTarget.value } },
                        `Set card title of ${layer().id}`
                      )
                    }
                  />
                </div>
                <div class="mf-field">
                  <label class="mf-label">Body</label>
                  <textarea
                    class="mf-textarea"
                    rows={2}
                    value={String(layer().variant?.body ?? '')}
                    disabled={layer().locked}
                    onChange={(e) =>
                      patch(
                        { variant: { ...(layer().variant ?? {}), body: e.currentTarget.value } },
                        `Set card body of ${layer().id}`
                      )
                    }
                  />
                </div>
                <div class="mf-grid-2">
                  <div class="mf-field">
                    <label class="mf-label">Width</label>
                    <ScrubInput
                      label="W"
                      unit="px"
                      value={(layer().variant?.widthPx as number) ?? 800}
                      min={80}
                      max={2000}
                      step={10}
                      disabled={layer().locked}
                      {...bindScrub('variant.widthPx', `width of ${layer().id}`)}
                    />
                  </div>
                  <div class="mf-field">
                    <label class="mf-label">Padding</label>
                    <ScrubInput
                      label="P"
                      unit="px"
                      value={(layer().variant?.paddingPx as number) ?? 32}
                      min={8}
                      max={200}
                      step={1}
                      disabled={layer().locked}
                      {...bindScrub('variant.paddingPx', `padding of ${layer().id}`)}
                    />
                  </div>
                </div>
                <div class="mf-field">
                  <label class="mf-label">Accent</label>
                  <input
                    type="color"
                    class="mf-color-input"
                    value={String(layer().variant?.accentColor ?? '#2d8ceb')}
                    disabled={layer().locked}
                    onChange={(e) =>
                      patch(
                        { variant: { ...(layer().variant ?? {}), 'accent-color': e.currentTarget.value } },
                        `Set card accent of ${layer().id}`
                      )
                    }
                  />
                </div>
              </Show>

              <Show when={layer().type === 'imageLogo' || layer().type === 'lottie'}>
                <div class="mf-grid-2">
                  <div class="mf-field">
                    <label class="mf-label">Width</label>
                    <ScrubInput
                      label="W"
                      unit="px"
                      value={layer().widthPx ?? 240}
                      min={16}
                      max={4000}
                      step={10}
                      disabled={layer().locked}
                      {...bindScrub('widthPx', `width of ${layer().id}`)}
                    />
                  </div>
                  <div class="mf-field">
                    <label class="mf-label">Height</label>
                    <ScrubInput
                      label="H"
                      unit="px"
                      value={layer().heightPx ?? layer().widthPx ?? 240}
                      min={16}
                      max={4000}
                      step={10}
                      disabled={layer().locked}
                      {...bindScrub('heightPx', `height of ${layer().id}`)}
                    />
                  </div>
                </div>
              </Show>

              <Show when={layer().type === 'background'}>
                <div class="mf-field">
                  <label class="mf-label">Background Style</label>
                  <select
                    class="mf-select"
                    value={String(layer().variant?.variant ?? 'solid')}
                    disabled={layer().locked}
                    onChange={(e) =>
                      patch(
                        {
                          variant: {
                            ...(layer().variant ?? {}),
                            variant: e.currentTarget.value,
                            color: (layer().variant?.color as string) ?? '#05070d',
                          },
                        },
                        `Set background style of ${layer().id}`
                      )
                    }
                  >
                    <option value="solid">Solid</option>
                    <option value="meshGradient">Mesh Gradient</option>
                    <option value="particles">Particles</option>
                  </select>
                </div>
                <div class="mf-field">
                  <label class="mf-label">Color</label>
                  <input
                    type="color"
                    class="mf-color-input"
                    value={String(layer().variant?.color ?? '#05070d')}
                    disabled={layer().locked}
                    onChange={(e) =>
                      patch(
                        { variant: { ...(layer().variant ?? {}), color: e.currentTarget.value } },
                        `Set background color of ${layer().id}`
                      )
                    }
                  />
                </div>
              </Show>

              <Show when={layer().type === 'foregroundFX'}>
                <div class="mf-field">
                  <label class="mf-label">Effect</label>
                  <select
                    class="mf-select"
                    value={String((layer().effects?.[0] as { kind?: string })?.kind ?? 'vignette')}
                    disabled={layer().locked}
                    onChange={(e) =>
                      patch(
                        { effects: [{ kind: e.currentTarget.value }] },
                        `Set effect of ${layer().id}`
                      )
                    }
                  >
                    <option value="vignette">Vignette</option>
                    <option value="filmGrain">Film Grain</option>
                    <option value="colorGrade">Color Grade</option>
                  </select>
                </div>
              </Show>
            </Accordion>

            {/* track lane */}
            <Accordion title="Track Assignment" open={false} onToggle={() => toggle('timing')}>
              <div class="mf-field">
                <label class="mf-label">Video Track</label>
                <select
                  class="mf-select"
                  value={String(layer().trackIndex ?? 0)}
                  disabled={layer().locked}
                  onChange={(e) =>
                    patch({ trackIndex: Number(e.currentTarget.value) }, `Set track of ${layer().id}`)
                  }
                >
                  <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>
                    {(index) => <option value={String(index)}>V{index + 1}</option>}
                  </For>
                </select>
              </div>
            </Accordion>
          </div>
        )}
      </Show>
    </PanelContainer>
  );
};
