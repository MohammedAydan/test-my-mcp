import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import type { JSX } from 'solid-js';
import { interpolateKeyframeValue } from '@motionforge/scene-spec';
import type { KeyframeProperty, LayerFilterKey } from '@motionforge/scene-spec';
import { store } from '../../state/store.js';
import type { StudioLayer } from '../../types.js';
import { ScrubInput } from './ScrubInput.js';
import { PanelContainer } from '../workspace/PanelContainer.js';
import { layerKindColor } from '../hierarchy/LayerStackPanel.js';
import {
  IconChevronDown,
  IconChevronRight,
  IconDiamond,
  IconLock,
  IconReset,
  IconStopwatch,
} from '../icons/NleIcons.js';

/**
 * Effect Controls — the property inspector.
 *
 * Two modes:
 *  - a LAYER is selected → the content / transform / effects / timing
 *    accordions for that layer, with the content section switching on the
 *    layer kind,
 *  - nothing is selected → the COMPOSITION settings.
 *
 * The sections are collapsible disclosures: the head is a real button, it
 * answers Enter and Space, and the body carries the `hidden` attribute when
 * the section is folded away.
 *
 * Every numeric field is a `<ScrubInput />`: one undo snapshot per gesture,
 * one atomic save per gesture.
 */

/**
 * The collapsible sections of the inspector.
 *
 * Every section is a real disclosure: the head is a `<button>`, it owns the
 * `aria-expanded` / `aria-controls` pair, and the body carries the matching
 * `data-section` id so a collapsed section really hides its body.
 */
type SectionKey =
  | 'content'
  | 'transform'
  | 'effects'
  | 'timing'
  | 'track'
  | 'composition'
  | 'transitions';

interface AccordionProps {
  /** the kebab-case section id — `data-section` on the head AND the body */
  section: SectionKey;
  title: string;
  open: boolean;
  onToggle: () => void;
  /** right-aligned one-line summary of the section's key value */
  summary?: string;
  children: unknown;
}

const Accordion: Component<AccordionProps> = (props) => {
  const headId = () => `mf-accordion-head-${props.section}`;
  const bodyId = () => `mf-accordion-body-${props.section}`;

  return (
    <div class={`mf-accordion ${props.open ? 'is-open' : ''}`} data-section={props.section}>
      <div class="mf-accordion-head-row">
        <button
          type="button"
          id={headId()}
          class="mf-accordion-head"
          data-section={props.section}
          aria-expanded={props.open}
          aria-controls={bodyId()}
          onClick={props.onToggle}
          onKeyDown={(e) => {
            /* the native button already activates on Enter / Space — but the
               explicit handler keeps the toggle working for synthetic key
               events too, and `preventDefault` stops the double activation */
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
              e.preventDefault();
              props.onToggle();
            }
          }}
        >
          <IconChevronDown size={11} class="mf-accordion-chevron" />
          <span class="mf-accordion-title">{props.title}</span>
        </button>
        <Show when={props.summary}>
          <span class="mf-accordion-summary" aria-hidden="true">
            {props.summary}
          </span>
        </Show>
      </div>
      <div
        id={bodyId()}
        class="mf-accordion-body"
        data-section={props.section}
        hidden={!props.open}
      >
        {props.children as never}
      </div>
    </div>
  );
};

/**
 * The inspector's COLLAPSE ALL / EXPAND ALL toggle.
 *
 * `aria-pressed` and `data-state` carry the current mode (`collapsed` /
 * `expanded`); the title explains what the NEXT click will do.
 */
interface CollapseAllProps {
  mode: 'collapsed' | 'expanded';
  onToggle: () => void;
}

const CollapseAllButton: Component<CollapseAllProps> = (props) => (
  <button
    id="inspector-collapse-all"
    class="mf-icon-btn mf-collapse-all"
    type="button"
    data-action="collapse-all"
    data-state={props.mode}
    aria-pressed={props.mode as unknown as JSX.AriaAttributes['aria-pressed']}
    aria-label="Collapse all sections"
    title={props.mode === 'collapsed' ? 'Expand all sections' : 'Collapse all sections'}
    onClick={props.onToggle}
  >
    <IconChevronDown size={12} class="mf-collapse-all-icon" />
  </button>
);

/* ── keyframe controls ────────────────────────────────────────────────────── */

interface KeyframeControlsProps {
  /** the animatable property this cluster drives */
  property: KeyframeProperty;
  /**
   * The RAW property value — the number the keyframe stores.
   *
   * It is NOT the number the field displays: `scale` is shown as a percent
   * but stored as a multiplier (1 = 100%), and `opacity` is shown as a
   * percent but stored as a fraction (1 = 100%).
   */
  value: number;
  disabled?: boolean;
}

/**
 * The stopwatch cluster of one animatable property.
 *
 *      [<]  [stopwatch | diamond]  [>]
 *
 * The middle button TOGGLES a keyframe at the playhead; the arrows JUMP the
 * playhead to the previous / next keyframe of the SAME property.
 */
const KeyframeControls: Component<KeyframeControlsProps> = (props) => {
  const layerId = () => store.state.selectedLayerId;

  const keyframe = () => {
    const id = layerId();
    if (!id) return null;
    return store.findLayerKeyframe(id, props.property, store.state.playhead);
  };

  const hasPrev = () => {
    const id = layerId();
    if (!id) return false;
    return store.prevLayerKeyframe(id, props.property, store.state.playhead) !== null;
  };

  const hasNext = () => {
    const id = layerId();
    if (!id) return false;
    return store.nextLayerKeyframe(id, props.property, store.state.playhead) !== null;
  };

  const toggle = () => {
    const id = layerId();
    if (!id) return;
    const existing = keyframe();
    if (existing) {
      store.removeLayerKeyframe(id, existing.id);
      store.addToast(`Removed the ${props.property} keyframe`, 'info');
      return;
    }
    store.setLayerKeyframe(id, props.property, store.state.playhead, props.value);
    store.addToast(
      `Keyframed ${props.property} at ${Math.round(store.state.playhead)}ms`,
      'success'
    );
  };

  const jump = (direction: 'prev' | 'next') => {
    const id = layerId();
    if (!id) return;
    const target =
      direction === 'next'
        ? store.nextLayerKeyframe(id, props.property, store.state.playhead)
        : store.prevLayerKeyframe(id, props.property, store.state.playhead);
    if (!target) return;
    store.setPlayhead(target.timeMs);
  };

  return (
    <span class="mf-kf-controls" data-keyframe-property={props.property}>
      <button
        class="mf-kf-btn"
        title="Previous keyframe"
        aria-label={`Previous ${props.property} keyframe`}
        data-action="keyframe-prev"
        disabled={props.disabled || !hasPrev()}
        onClick={() => jump('prev')}
      >
        <IconChevronRight size={11} style={{ transform: 'rotate(180deg)' }} />
      </button>

      <button
        class={`mf-kf-btn ${keyframe() ? 'is-keyed' : ''}`}
        title={keyframe() ? 'Remove the keyframe' : 'Add a keyframe at the playhead'}
        aria-label={`${props.property} keyframe`}
        aria-pressed={keyframe() !== null}
        data-action="keyframe-toggle"
        disabled={props.disabled}
        onClick={toggle}
      >
        <Show when={keyframe()} fallback={<IconStopwatch size={11} />}>
          <IconDiamond size={11} filled />
        </Show>
      </button>

      <button
        class="mf-kf-btn"
        title="Next keyframe"
        aria-label={`Next ${props.property} keyframe`}
        data-action="keyframe-next"
        disabled={props.disabled || !hasNext()}
        onClick={() => jump('next')}
      >
        <IconChevronRight size={11} />
      </button>
    </span>
  );
};

/* ── the inspector ────────────────────────────────────────────────────────── */

export const EffectControlsPanel: Component = () => {
  const state = store.state;

  /**
   * The open/closed state of EVERY section.
   *
   * Each section owns its own key — a collapsed section really hides its body
   * (the body carries the `hidden` attribute), so nothing is only "visually"
   * folded away.
   */
  const [openSections, setOpenSections] = createSignal<Record<SectionKey, boolean>>({
    content: true,
    transform: true,
    effects: true,
    timing: true,
    track: false,
    composition: true,
    transitions: false,
  });

  const selectedLayer = createMemo<StudioLayer | null>(() => {
    if (!state.scene || !state.selectedLayerId) return null;
    return state.scene.layers.find((l) => l.id === state.selectedLayerId) ?? null;
  });

  const toggle = (key: SectionKey) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  /** The sections the current inspector mode owns. */
  const activeSections = (): SectionKey[] =>
    selectedLayer()
      ? ['content', 'transform', 'effects', 'timing', 'track']
      : ['composition', 'transitions'];

  /** True when EVERY active section is folded away. */
  const allCollapsed = createMemo(() =>
    activeSections().every((key) => !openSections()[key])
  );

  /** The mode the collapse-all button reflects. */
  const collapseMode = createMemo<'collapsed' | 'expanded'>(() =>
    allCollapsed() ? 'collapsed' : 'expanded'
  );

  /** Collapse everything, or expand everything when it is already collapsed. */
  const toggleAllSections = () => {
    const keys = activeSections();
    const collapse = !allCollapsed();
    setOpenSections((prev) => {
      const next = { ...prev };
      for (const key of keys) next[key] = !collapse;
      return next;
    });
  };

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
  /**
   * The value a keyframable property SHOWS at the playhead.
   *
   * A keyframed property is not the authored value — it is the INTERPOLATED
   * value at the current time. Showing the authored number would make the
   * inspector disagree with the preview (the exact defect the v4 verification
   * caught). The interpolation is the SAME function the runtime renders with
   * (`@motionforge/scene-spec`).
   */
  const keyframedValue = (property: KeyframeProperty): number | undefined => {
    const layer = selectedLayer();
    if (!layer) return undefined;
    return interpolateKeyframeValue(
      layer.keyframes as never,
      layer.tracks as never,
      property,
      state.playhead
    );
  };

  /** The value a keyframable scrub field displays. */
  const displayValue = (
    property: KeyframeProperty,
    authored: number,
    scale = 1
  ): number => {
    const keyed = keyframedValue(property);
    if (keyed === undefined) return authored;
    return scale === 1 ? keyed : keyed / scale;
  };

  /** True when the property has ANY keyframe (so an edit should auto-key). */
  const isKeyframed = (property: KeyframeProperty): boolean =>
    store.layerKeyframes(state.selectedLayerId ?? '', property).length > 0;

  /**
   * Bind a scrub field to a dotted path on the selected layer.
   *
   * `valueScale` converts the DISPLAYED value into the AUTHORED one: the
   * Scale and Opacity fields are shown as percentages but stored as
   * multipliers, so a scrub of "120 %" must write `1.2`, not `120`.
   *
   * When the property is KEYFRAMED, an edit auto-keys: the new value is
   * written into the keyframe at the playhead (After Effects semantics) — the
   * preview follows the scrub, and the keyframe curve follows the value.
   */
  const bindScrub = (path: string, label: string, property?: KeyframeProperty, valueScale = 1) => ({
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
      const authored = valueScale === 1 ? val : val / valueScale;
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
      if (last) cursor[last] = authored;
      store.patchLayer(id, next);
    },
    onCommit: (val: number) => {
      const id = state.selectedLayerId;
      if (id && property && isKeyframed(property)) {
        // auto-key: a keyframed property writes its value into the keyframe
        // at the playhead instead of only changing the authored value
        const authored = valueScale === 1 ? val : val / valueScale;
        store.setLayerKeyframe(id, property, state.playhead, authored);
      }
      void store.executeSave();
    },
  });

  /* ── visual filters ──────────────────────────────────────────────────── */

  /** The current value of one filter, or `fallback` when it is absent. */
  const filterValue = (key: LayerFilterKey, fallback: number): number => {
    const layer = selectedLayer();
    const value = layer?.filters?.[key];
    return typeof value === 'number' ? value : fallback;
  };

  /** The filter bag of the selected layer with one entry set (or cleared). */
  const filterBag = (
    layerId: string,
    key: LayerFilterKey,
    value: number,
    neutral: number
  ): Record<string, number | string> => {
    const layer = state.scene?.layers.find((l) => l.id === layerId);
    const bag: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(layer?.filters ?? {})) {
      if (v === undefined) continue;
      bag[k] = v as number | string;
    }
    if (value === neutral) delete bag[key];
    else bag[key] = value;
    return bag;
  };

  /**
   * Bind a numeric filter to the selected layer.
   *
   * The gesture pushes ONE undo snapshot at its start, the live value is
   * written WITHOUT history (so a drag does not flood the undo stack) and
   * the commit goes through `store.setLayerFilter` — the one canonical write
   * path for the filter bag.
   */
  const bindFilter = (key: LayerFilterKey, neutral: number, label: string) => {
    let before: number | undefined;
    return {
      onScrubStart: () => {
        const id = state.selectedLayerId;
        if (!id) return;
        const current = state.scene?.layers.find((l) => l.id === id)?.filters?.[key];
        before = typeof current === 'number' ? current : undefined;
        store.pushHistory(`Scrub ${label} of ${id}`);
      },
      onChange: (val: number) => {
        const id = state.selectedLayerId;
        if (!id) return;
        store.patchLayer(id, { filters: filterBag(id, key, val, neutral) });
      },
      onCommit: (val: number) => {
        const id = state.selectedLayerId;
        if (!id) return;
        // put the pre-gesture value back so `setLayerFilter` snapshots it as
        // the undo target, then write the final value through the store action
        store.patchLayer(id, { filters: filterBag(id, key, before ?? neutral, neutral) });
        store.setLayerFilter(id, key, val === neutral ? undefined : val);
        void store.executeSave();
      },
    };
  };

  /* ── section summaries ───────────────────────────────────────────────── */

  /** A compact number for the accordion heads: no trailing `.0`. */
  const compact = (value: number): string => String(Math.round(value * 10) / 10);

  /** A duration for the accordion heads: `850ms` or `3.0s`. */
  const compactMs = (value: number): string =>
    value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;

  /** `TRANSFORM` — where the layer sits and how big it is. */
  const transformSummary = createMemo(() => {
    const layer = selectedLayer();
    if (!layer) return '';
    const x = displayValue('xPct', layer.position?.xPct ?? 50);
    const y = displayValue('yPct', layer.position?.yPct ?? 50);
    return `X ${compact(x)}% · Y ${compact(y)}%`;
  });

  /** `VISUAL EFFECTS` — the filter that is actually doing something. */
  const effectsSummary = createMemo(() => {
    const layer = selectedLayer();
    const filters = layer?.filters ?? {};
    const bits: string[] = [`Blur ${compact(filterValue('blur', 0))}`];
    if (typeof filters.saturate === 'number' && filters.saturate !== 100) {
      bits.push(`Sat ${compact(filters.saturate)}`);
    }
    if (typeof filters.brightness === 'number' && filters.brightness !== 100) {
      bits.push(`Brt ${compact(filters.brightness)}`);
    }
    return bits.join(' · ');
  });

  /** `TIMING` — the layer's window on the timeline. */
  const timingSummary = createMemo(() => {
    const layer = selectedLayer();
    if (!layer) return '';
    const at = layer.at ?? 0;
    const duration = layer.duration ?? 3000;
    return `Start ${compactMs(at)} · ${compactMs(duration)}`;
  });

  /** `CONTENT & STYLE` — the one value that identifies the layer's content. */
  const contentSummary = createMemo(() => {
    const layer = selectedLayer();
    if (!layer) return '';
    switch (layer.type) {
      case 'kineticText':
        return `Size ${compact(layer.sizePx ?? 80)}px`;
      case 'card': {
        const title = String(layer.variant?.title ?? '').trim();
        if (!title) return `${compact((layer.variant?.widthPx as number) ?? 800)}px wide`;
        return title.length > 22 ? `${title.slice(0, 21)}…` : title;
      }
      case 'imageLogo':
      case 'lottie':
        return `${compact(layer.widthPx ?? 240)}×${compact(layer.heightPx ?? layer.widthPx ?? 240)}`;
      case 'background':
        return String(layer.variant?.variant ?? 'solid');
      case 'foregroundFX':
        return String((layer.effects?.[0] as { kind?: string })?.kind ?? 'vignette');
      default:
        return '';
    }
  });

  /** `TRACK ASSIGNMENT` — the video lane the layer lives on. */
  const trackSummary = createMemo(() => {
    const layer = selectedLayer();
    if (!layer) return '';
    return `V${(layer.trackIndex ?? 0) + 1}`;
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
      class="panel-container"
      tabs={['Effect Controls']}
      activeTab="Effect Controls"
      label="Effect controls"
    >
      <Show
        when={selectedLayer()}
        fallback={
          <div class="mf-panel-body is-scrollable mf-inspector-scroll" id="composition-settings">
            <div class="mf-layer-head">
              <span class="mf-swatch" style={{ background: 'var(--mf-kind-background)' }} />
              <span class="mf-layer-head-title">{state.scene?.name ?? 'Composition'}</span>
              <span class="mf-chip">composition</span>
              <CollapseAllButton mode={collapseMode()} onToggle={toggleAllSections} />
            </div>

            <Accordion
              section="composition"
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

            <Accordion
              section="transitions"
              title="Seam Transitions"
              open={openSections().transitions}
              onToggle={() => toggle('transitions')}
            >
              <div class="mf-empty-hint" style={{ padding: '4px 0' }}>
                Transitions are authored on the scene timeline. Use the timeline toolbar to
                add a wipe, glitch, whip pan or morph at the playhead.
              </div>
            </Accordion>
          </div>
        }
      >
        {(layer) => (
          <div class="mf-panel-body is-scrollable mf-inspector-scroll" id="layer-properties">
            {/* layer header */}
            <div class="mf-layer-head">
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
              <CollapseAllButton mode={collapseMode()} onToggle={toggleAllSections} />
            </div>

            {/* content */}
            <Accordion
              section="content"
              title="Content & Style"
              open={openSections().content}
              onToggle={() => toggle('content')}
              summary={contentSummary()}
            >
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
                      id="inspector-scrub-sizePx"
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
                      {...bindScrub('widthPx', `widthPx of ${layer().id}`)}
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
                      {...bindScrub('heightPx', `heightPx of ${layer().id}`)}
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


            {/* transform */}
            <Accordion
              section="transform"
              title="Transform"
              open={openSections().transform}
              onToggle={() => toggle('transform')}
              summary={transformSummary()}
            >
              <div class="mf-prop-grid">
                <div class="mf-prop-row">
                  <label class="mf-label">Position X</label>
                  <KeyframeControls
                    property="xPct"
                    value={displayValue('xPct', layer().position?.xPct ?? 50)}
                    disabled={layer().locked}
                  />
                  <ScrubInput
                    id="inspector-scrub-xPct"
                    label="X"
                    unit="%"
                    value={displayValue('xPct', layer().position?.xPct ?? 50)}
                    min={-200}
                    max={200}
                    step={0.5}
                    disabled={layer().locked}
                    {...bindScrub('position.xPct', `xPct of ${layer().id}`, 'xPct')}
                  />
                </div>

                <div class="mf-prop-row">
                  <label class="mf-label">Position Y</label>
                  <KeyframeControls
                    property="yPct"
                    value={displayValue('yPct', layer().position?.yPct ?? 50)}
                    disabled={layer().locked}
                  />
                  <ScrubInput
                    id="inspector-scrub-yPct"
                    label="Y"
                    unit="%"
                    value={displayValue('yPct', layer().position?.yPct ?? 50)}
                    min={-200}
                    max={200}
                    step={0.5}
                    disabled={layer().locked}
                    {...bindScrub('position.yPct', `yPct of ${layer().id}`, 'yPct')}
                  />
                </div>

                <div class="mf-prop-row">
                  <label class="mf-label">Scale</label>
                  <KeyframeControls
                    property="scale"
                    value={displayValue('scale', layer().scale ?? 1)}
                    disabled={layer().locked}
                  />
                  <ScrubInput
                    id="inspector-scrub-scale"
                    label="S"
                    unit="%"
                    value={Math.round(displayValue('scale', layer().scale ?? 1) * 100)}
                    min={5}
                    max={1000}
                    step={1}
                    disabled={layer().locked}
                    {...bindScrub('scale', `scale of ${layer().id}`, 'scale', 100)}
                  />
                </div>

                <div class="mf-prop-row">
                  <label class="mf-label">Rotation</label>
                  <KeyframeControls
                    property="rotation"
                    value={displayValue('rotation', layer().rotation ?? 0)}
                    disabled={layer().locked}
                  />
                  <ScrubInput
                    id="inspector-scrub-rotation"
                    label="R"
                    unit="°"
                    value={displayValue('rotation', layer().rotation ?? 0)}
                    min={-3600}
                    max={3600}
                    step={1}
                    disabled={layer().locked}
                    {...bindScrub('rotation', `rotation of ${layer().id}`, 'rotation')}
                  />
                </div>

                <div class="mf-prop-row">
                  <label class="mf-label">Opacity</label>
                  <KeyframeControls
                    property="opacity"
                    value={displayValue('opacity', layer().opacity ?? 1)}
                    disabled={layer().locked}
                  />
                  <ScrubInput
                    id="inspector-scrub-opacity"
                    label="O"
                    unit="%"
                    value={Math.round(displayValue('opacity', layer().opacity ?? 1) * 100)}
                    min={0}
                    max={100}
                    step={1}
                    disabled={layer().locked}
                    {...bindScrub('opacity', `opacity of ${layer().id}`, 'opacity', 100)}
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

            {/* visual effects */}
            <Accordion
              section="effects"
              title="Visual Effects"
              open={openSections().effects}
              onToggle={() => toggle('effects')}
              summary={effectsSummary()}
            >
              <div class="mf-prop-grid">
                <div class="mf-field">
                  <label class="mf-label">Blur (px)</label>
                  <ScrubInput
                    label="Blur"
                    unit="px"
                    value={filterValue('blur', 0)}
                    min={0}
                    max={60}
                    step={1}
                    disabled={layer().locked}
                    {...bindFilter('blur', 0, 'blur')}
                  />
                </div>

                <div class="mf-field">
                  <label class="mf-label">Corner Radius (px)</label>
                  <ScrubInput
                    label="Rad"
                    unit="px"
                    value={filterValue('cornerRadius', 0)}
                    min={0}
                    max={120}
                    step={1}
                    disabled={layer().locked}
                    {...bindFilter('cornerRadius', 0, 'corner radius')}
                  />
                </div>

                <div class="mf-field">
                  <label class="mf-label">Brightness (%)</label>
                  <ScrubInput
                    label="Brt"
                    unit="%"
                    value={filterValue('brightness', 100)}
                    min={0}
                    max={200}
                    step={1}
                    disabled={layer().locked}
                    {...bindFilter('brightness', 100, 'brightness')}
                  />
                </div>

                <div class="mf-field">
                  <label class="mf-label">Contrast (%)</label>
                  <ScrubInput
                    label="Con"
                    unit="%"
                    value={filterValue('contrast', 100)}
                    min={0}
                    max={200}
                    step={1}
                    disabled={layer().locked}
                    {...bindFilter('contrast', 100, 'contrast')}
                  />
                </div>

                <div class="mf-field">
                  <label class="mf-label">Saturate (%)</label>
                  <ScrubInput
                    label="Sat"
                    unit="%"
                    value={filterValue('saturate', 100)}
                    min={0}
                    max={200}
                    step={1}
                    disabled={layer().locked}
                    {...bindFilter('saturate', 100, 'saturate')}
                  />
                </div>

                <div class="mf-field">
                  <label class="mf-label">Drop Shadow Blur (px)</label>
                  <ScrubInput
                    label="Shad"
                    unit="px"
                    value={filterValue('shadowBlur', 0)}
                    min={0}
                    max={80}
                    step={1}
                    disabled={layer().locked}
                    {...bindFilter('shadowBlur', 0, 'shadow blur')}
                  />
                </div>

                <div class="mf-field">
                  <label class="mf-label">Shadow Colour</label>
                  <input
                    type="color"
                    class="mf-color-input"
                    value={String(layer().filters?.shadowColor ?? '#000000')}
                    disabled={layer().locked}
                    onChange={(e) => {
                      const id = state.selectedLayerId;
                      if (!id) return;
                      store.setLayerFilter(id, 'shadowColor', e.currentTarget.value);
                      void store.executeSave();
                    }}
                  />
                </div>

                <div class="mf-field">
                  <label class="mf-label">Blend Mode</label>
                  <select
                    class="mf-select"
                    value={layer().blendMode ?? 'normal'}
                    disabled={layer().locked}
                    onChange={(e) =>
                      patch(
                        { blendMode: e.currentTarget.value },
                        `Set blend mode of ${layer().id}`
                      )
                    }
                  >
                    <option value="normal">Normal</option>
                    <option value="multiply">Multiply</option>
                    <option value="screen">Screen</option>
                    <option value="overlay">Overlay</option>
                    <option value="plus-lighter">Plus Lighter</option>
                  </select>
                </div>
              </div>
            </Accordion>

            {/* timing */}
            <Accordion
              section="timing"
              title="Timing"
              open={openSections().timing}
              onToggle={() => toggle('timing')}
              summary={timingSummary()}
            >
              <div class="mf-prop-grid">
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

            {/* track lane */}
            <Accordion
              section="track"
              title="Track Assignment"
              open={openSections().track}
              onToggle={() => toggle('track')}
              summary={trackSummary()}
            >
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
