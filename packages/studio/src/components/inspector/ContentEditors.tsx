import { Component, For, Show, createMemo } from 'solid-js';
import { store } from '../../state/store.js';
import type { StudioLayer } from '../../types.js';
import { layerVariant } from '../../types.js';
import {
  CARD_VARIANT_KINDS,
  buildCardVariant,
  cardVariantHasAccent,
  cardVariantHasText,
  updateCardVariant,
} from '../../services/card-variant.js';
import { ScrubInput } from './ScrubInput.js';
import { IconMinus, IconPlus } from '../icons/NleIcons.js';

/**
 * The CONTENT & STYLE editors of the four new layer kinds.
 *
 * `chart`, `codeBlock`, `particleField` and `cta` are first-class layers of
 * the scene schema, so they get REAL editors — the same controls, the same
 * CSS classes and the same store actions the older kinds use. A field that
 * cannot be edited is a field that will be wrong.
 *
 * Each editor reads ONE store slice (the selected layer) and writes through
 * `store.updateLayer` — the store stays the single writer of the scene.
 */

/** One datum of a chart. */
interface ChartDatum {
  label: string;
  value: number;
  color?: string;
}

/** The minimum number of data points a chart may carry. */
const MIN_CHART_DATA = 2;
/** The maximum number of data points a chart may carry. */
const MAX_CHART_DATA = 12;

/** The selected layer — the ONE slice these editors read. */
function useSelectedLayer(): () => StudioLayer | null {
  return createMemo(() => {
    const state = store.state;
    if (!state.scene || !state.selectedLayerId) return null;
    return state.scene.layers.find((l) => l.id === state.selectedLayerId) ?? null;
  });
}

/** Write one field of the selected layer. */
function writeField(field: string, value: unknown, description: string): void {
  const id = store.state.selectedLayerId;
  if (!id) return;
  store.updateLayer(id, { [field]: value } as Partial<StudioLayer>, description);
}

/* ── card ───────────────────────────────────────────────────────────────── */

/**
 * The CARD editor.
 *
 * A card's `variant` is a DISCRIMINATED union of STRICT objects, so the
 * payload is REBUILT for the treatment the author picked (see
 * `services/card-variant.ts`). The editor only shows the fields the CURRENT
 * treatment actually declares — a `counter` has no title, a `glassCard` has
 * no accent colour — so a field can never write a key the schema rejects.
 */
export const CardEditor: Component = () => {
  const layer = useSelectedLayer();

  const variant = createMemo(() => layerVariant(layer() ?? ({} as StudioLayer)));
  const kind = createMemo(() => String(variant().variant ?? 'glassCard'));
  const hasText = createMemo(() => cardVariantHasText(kind()));
  const hasAccent = createMemo(() => cardVariantHasAccent(kind()));

  const writeVariant = (next: Record<string, unknown>, description: string) => {
    const id = store.state.selectedLayerId;
    if (!id) return;
    store.updateLayer(id, { variant: next } as Partial<StudioLayer>, description);
  };

  return (
    <div class="mf-card-editor" id="inspector-card">
      <div class="mf-field">
        <label class="mf-label">Treatment</label>
        <select
          class="mf-select"
          id="inspector-card-variant"
          value={kind()}
          disabled={layer()?.locked}
          onChange={(e) =>
            writeVariant(
              buildCardVariant(e.currentTarget.value, variant()),
              `Set card treatment of ${store.state.selectedLayerId}`
            )
          }
        >
          <For each={CARD_VARIANT_KINDS}>
            {(option) => <option value={option}>{option}</option>}
          </For>
        </select>
      </div>

      <Show when={hasText()}>
        <div class="mf-field">
          <label class="mf-label">Title</label>
          <input
            class="mf-input"
            id="inspector-card-title"
            value={String(variant().title ?? '')}
            disabled={layer()?.locked}
            onChange={(e) =>
              writeVariant(
                updateCardVariant(variant(), { title: e.currentTarget.value }),
                `Set card title of ${store.state.selectedLayerId}`
              )
            }
          />
        </div>
        <div class="mf-field">
          <label class="mf-label">Body</label>
          <textarea
            class="mf-textarea"
            id="inspector-card-body"
            rows={2}
            value={String(variant().body ?? '')}
            disabled={layer()?.locked}
            onChange={(e) =>
              writeVariant(
                updateCardVariant(variant(), { body: e.currentTarget.value }),
                `Set card body of ${store.state.selectedLayerId}`
              )
            }
          />
        </div>
      </Show>

      <Show when={kind() === 'progressBar'}>
        <div class="mf-field">
          <label class="mf-label">Label</label>
          <input
            class="mf-input"
            id="inspector-card-label"
            value={String(variant().label ?? '')}
            disabled={layer()?.locked}
            onChange={(e) =>
              writeVariant(
                updateCardVariant(variant(), { label: e.currentTarget.value }),
                `Set card label of ${store.state.selectedLayerId}`
              )
            }
          />
        </div>
      </Show>

      <div class="mf-grid-2">
        <Show when={kind() !== 'counter'}>
          <div class="mf-field">
            <label class="mf-label">Width</label>
            <ScrubInput
              label="W"
              unit="px"
              value={Number(variant().widthPx ?? 800)}
              min={80}
              max={2000}
              step={10}
              disabled={layer()?.locked}
              onScrubStart={() => store.pushHistory('Scrub card width')}
              onChange={(val) =>
                writeVariant(
                  updateCardVariant(variant(), { widthPx: Math.round(val) }),
                  `Set card width of ${store.state.selectedLayerId}`
                )
              }
              onCommit={() => void store.executeSave().catch(() => undefined)}
            />
          </div>
        </Show>
        <Show when={kind() === 'glassCard' || kind() === 'callout'}>
          <div class="mf-field">
            <label class="mf-label">Padding</label>
            <ScrubInput
              label="P"
              unit="px"
              value={Number(variant().paddingPx ?? 36)}
              min={8}
              max={200}
              step={1}
              disabled={layer()?.locked}
              onScrubStart={() => store.pushHistory('Scrub card padding')}
              onChange={(val) =>
                writeVariant(
                  updateCardVariant(variant(), { paddingPx: Math.round(val) }),
                  `Set card padding of ${store.state.selectedLayerId}`
                )
              }
              onCommit={() => void store.executeSave().catch(() => undefined)}
            />
          </div>
        </Show>
      </div>

      <Show when={hasAccent()}>
        <div class="mf-field">
          <label class="mf-label">Accent</label>
          <input
            type="color"
            class="mf-color-input"
            id="inspector-card-accent"
            value={String(variant().accentColor ?? '#2d8ceb')}
            disabled={layer()?.locked}
            onChange={(e) =>
              writeVariant(
                updateCardVariant(variant(), { accentColor: e.currentTarget.value }),
                `Set card accent of ${store.state.selectedLayerId}`
              )
            }
          />
        </div>
      </Show>
    </div>
  );
};

/* ── chart ──────────────────────────────────────────────────────────────── */

/**
 * The CHART editor — type, title, the data table, accent and the value
 * labels.
 */
export const ChartEditor: Component = () => {
  const layer = useSelectedLayer();

  const data = createMemo<ChartDatum[]>(() => {
    const raw = layer()?.data;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      .map((entry) => ({
        label: typeof entry.label === 'string' ? entry.label : '',
        value: typeof entry.value === 'number' ? entry.value : 0,
        color: typeof entry.color === 'string' ? entry.color : undefined,
      }));
  });

  const writeData = (next: ChartDatum[]) => {
    writeField(
      'data',
      next.map((entry) =>
        entry.color
          ? { label: entry.label, value: entry.value, color: entry.color }
          : { label: entry.label, value: entry.value }
      ),
      `Set chart data of ${store.state.selectedLayerId}`
    );
  };

  const updateDatum = (index: number, patch: Partial<ChartDatum>) => {
    const next = data().map((entry, position) =>
      position === index ? { ...entry, ...patch } : entry
    );
    writeData(next);
  };

  const addDatum = () => {
    if (data().length >= MAX_CHART_DATA) return;
    const next = [...data(), { label: String.fromCharCode(65 + data().length), value: 50 }];
    writeData(next);
  };

  const removeDatum = (index: number) => {
    if (data().length <= MIN_CHART_DATA) return;
    writeData(data().filter((_, position) => position !== index));
  };

  return (
    <div class="mf-chart-editor" id="inspector-chart">
      <div class="mf-grid-2">
        <div class="mf-field">
          <label class="mf-label">Chart Type</label>
          <select
            class="mf-select"
            id="inspector-chart-type"
            value={String(layer()?.chartType ?? 'bar')}
            disabled={layer()?.locked}
            onChange={(e) => writeField('chartType', e.currentTarget.value, 'Set chart type')}
          >
            <option value="bar">Bar</option>
            <option value="line">Line</option>
            <option value="donut">Donut</option>
          </select>
        </div>
        <div class="mf-field">
          <label class="mf-label">Accent</label>
          <input
            type="color"
            class="mf-color-input"
            id="inspector-chart-accent"
            value={String(layer()?.accentColor ?? '#38bdf8')}
            disabled={layer()?.locked}
            onChange={(e) => writeField('accentColor', e.currentTarget.value, 'Set chart accent')}
          />
        </div>
      </div>

      <div class="mf-field">
        <label class="mf-label">Title</label>
        <input
          class="mf-input"
          id="inspector-chart-title"
          value={String(layer()?.title ?? '')}
          disabled={layer()?.locked}
          onChange={(e) => writeField('title', e.currentTarget.value, 'Set chart title')}
        />
      </div>

      <div class="mf-field">
        <div class="mf-field-head">
          <span class="mf-label">Data</span>
          <span class="mf-field-note">
            {data().length}/{MAX_CHART_DATA}
          </span>
        </div>
        <For each={data()}>
          {(datum, index) => (
            <div class="mf-chart-row" data-chart-index={index()}>
              <input
                class="mf-input"
                style={{ width: '84px' }}
                aria-label={`Label of data point ${index() + 1}`}
                value={datum.label}
                disabled={layer()?.locked}
                onChange={(e) => updateDatum(index(), { label: e.currentTarget.value })}
              />
              <ScrubInput
                label="V"
                value={datum.value}
                min={-1000}
                max={1000}
                step={1}
                disabled={layer()?.locked}
                onScrubStart={() => store.pushHistory(`Scrub chart point ${index() + 1}`)}
                onChange={(val) => updateDatum(index(), { value: val })}
                onCommit={() => void store.executeSave().catch(() => undefined)}
              />
              <input
                type="color"
                class="mf-color-input"
                title={`Color of data point ${index() + 1}`}
                aria-label={`Color of data point ${index() + 1}`}
                value={datum.color ?? String(layer()?.accentColor ?? '#38bdf8')}
                disabled={layer()?.locked}
                onChange={(e) => updateDatum(index(), { color: e.currentTarget.value })}
              />
              <button
                type="button"
                class="mf-icon-btn is-danger"
                title={
                  data().length <= MIN_CHART_DATA
                    ? `A chart needs at least ${MIN_CHART_DATA} data points`
                    : `Remove data point ${index() + 1}`
                }
                aria-label={`Remove data point ${index() + 1}`}
                disabled={data().length <= MIN_CHART_DATA || layer()?.locked}
                onClick={() => removeDatum(index())}
              >
                <IconMinus size={11} />
              </button>
            </div>
          )}
        </For>
        <button
          type="button"
          class="mf-btn"
          id="inspector-chart-add-point"
          disabled={data().length >= MAX_CHART_DATA || layer()?.locked}
          onClick={addDatum}
        >
          <IconPlus size={11} />
          <span>Add point</span>
        </button>
      </div>

      <div class="mf-field">
        <label class="mf-label">Show Values</label>
        <input
          type="checkbox"
          id="inspector-chart-show-values"
          checked={layer()?.showValues === true}
          disabled={layer()?.locked}
          onChange={(e) => writeField('showValues', e.currentTarget.checked, 'Toggle chart values')}
        />
      </div>
    </div>
  );
};

/* ── code block ─────────────────────────────────────────────────────────── */

/** The CHART / CODE / PARTICLE / CTA editors share the theme vocabulary. */
export const CodeBlockEditor: Component = () => {
  const layer = useSelectedLayer();

  /** the highlighted lines, as a comma separated list. */
  const highlightText = createMemo(() => {
    const raw = layer()?.highlightLines;
    if (!Array.isArray(raw)) return '';
    return raw.filter((entry) => typeof entry === 'number').join(', ');
  });

  return (
    <div class="mf-code-editor" id="inspector-code-block">
      <div class="mf-grid-2">
        <div class="mf-field">
          <label class="mf-label">Language</label>
          <input
            class="mf-input"
            id="inspector-code-language"
            value={String(layer()?.language ?? 'typescript')}
            disabled={layer()?.locked}
            onChange={(e) => writeField('language', e.currentTarget.value, 'Set code language')}
          />
        </div>
        <div class="mf-field">
          <label class="mf-label">Theme</label>
          <select
            class="mf-select"
            id="inspector-code-theme"
            value={String(layer()?.theme ?? 'dark')}
            disabled={layer()?.locked}
            onChange={(e) => writeField('theme', e.currentTarget.value, 'Set code theme')}
          >
            <option value="dark">Dark</option>
            <option value="midnight">Midnight</option>
            <option value="matrix">Matrix</option>
          </select>
        </div>
      </div>

      <div class="mf-field">
        <label class="mf-label">Title</label>
        <input
          class="mf-input"
          id="inspector-code-title"
          value={String(layer()?.title ?? '')}
          disabled={layer()?.locked}
          onChange={(e) => writeField('title', e.currentTarget.value, 'Set code title')}
        />
      </div>

      <div class="mf-field">
        <label class="mf-label">Code</label>
        <textarea
          class="mf-textarea is-mono"
          id="inspector-code-source"
          rows={6}
          spellcheck={false}
          value={String(layer()?.code ?? '')}
          disabled={layer()?.locked}
          onChange={(e) => writeField('code', e.currentTarget.value, 'Set code source')}
        />
      </div>

      <div class="mf-grid-2">
        <div class="mf-field">
          <label class="mf-label">Font Size</label>
          <ScrubInput
            label="F"
            unit="px"
            value={Number(layer()?.fontSize ?? 22)}
            min={8}
            max={96}
            step={1}
            disabled={layer()?.locked}
            onScrubStart={() => store.pushHistory('Scrub code font size')}
            onChange={(val) => writeField('fontSize', Math.round(val), 'Set code font size')}
            onCommit={() => void store.executeSave().catch(() => undefined)}
          />
        </div>
        <div class="mf-field">
          <label class="mf-label">Width</label>
          <ScrubInput
            label="W"
            unit="px"
            value={Number(layer()?.widthPx ?? 880)}
            min={160}
            max={2400}
            step={10}
            disabled={layer()?.locked}
            onScrubStart={() => store.pushHistory('Scrub code width')}
            onChange={(val) => writeField('widthPx', Math.round(val), 'Set code width')}
            onCommit={() => void store.executeSave().catch(() => undefined)}
          />
        </div>
      </div>

      <div class="mf-field">
        <label class="mf-label">Highlight Lines</label>
        <input
          class="mf-input"
          id="inspector-code-highlight"
          placeholder="e.g. 2, 5"
          value={highlightText()}
          disabled={layer()?.locked}
          onChange={(e) => {
            const lines = e.currentTarget.value
              .split(',')
              .map((entry) => Number.parseInt(entry.trim(), 10))
              .filter((entry) => Number.isFinite(entry) && entry >= 1 && entry <= 400)
              .slice(0, 80);
            writeField('highlightLines', lines, 'Set code highlight lines');
          }}
        />
      </div>

      <div class="mf-grid-2">
        <div class="mf-field">
          <label class="mf-label">Window Chrome</label>
          <input
            type="checkbox"
            id="inspector-code-chrome"
            checked={layer()?.showChrome !== false}
            disabled={layer()?.locked}
            onChange={(e) => writeField('showChrome', e.currentTarget.checked, 'Toggle code chrome')}
          />
        </div>
        <div class="mf-field">
          <label class="mf-label">Line Numbers</label>
          <input
            type="checkbox"
            id="inspector-code-line-numbers"
            checked={layer()?.showLineNumbers !== false}
            disabled={layer()?.locked}
            onChange={(e) =>
              writeField('showLineNumbers', e.currentTarget.checked, 'Toggle code line numbers')
            }
          />
        </div>
      </div>
    </div>
  );
};

/* ── particle field ─────────────────────────────────────────────────────── */

/**
 * The PARTICLE FIELD editor — pattern, count, colours, speed, size, seed.
 *
 * THE SIZE: a `particleField` SHADOWS the base schema's `size` — it is the
 * particle RADIUS, not the layout box. The sanitizer folds the documented
 * `sizePx` alias into the canonical `size`, so BOTH are written: the radius
 * survives the write and the authoring model keeps the canonical name.
 */
export const ParticleFieldEditor: Component = () => {
  const layer = useSelectedLayer();

  /** the authored radius, from either spelling. */
  const radius = createMemo(() => {
    const sizePx = Number(layer()?.sizePx ?? NaN);
    if (Number.isFinite(sizePx)) return sizePx;
    const size = layer()?.size;
    if (typeof size === 'number' && Number.isFinite(size)) return size;
    return 3;
  });

  /** write the radius in both spellings. */
  const writeRadius = (value: number) => {
    const id = store.state.selectedLayerId;
    if (!id) return;
    store.updateLayer(
      id,
      { size: value, sizePx: value } as Partial<StudioLayer>,
      `Set particle size of ${id}`
    );
  };

  return (
    <div class="mf-particle-editor" id="inspector-particle-field">
      <div class="mf-grid-2">
        <div class="mf-field">
          <label class="mf-label">Pattern</label>
          <select
            class="mf-select"
            id="inspector-particle-pattern"
            value={String(layer()?.pattern ?? 'float')}
            disabled={layer()?.locked}
            onChange={(e) => writeField('pattern', e.currentTarget.value, 'Set particle pattern')}
          >
            <option value="float">Float</option>
            <option value="grid">Grid</option>
            <option value="constellation">Constellation</option>
            <option value="sparkle">Sparkle</option>
          </select>
        </div>
        <div class="mf-field">
          <label class="mf-label">Count</label>
          <ScrubInput
            label="N"
            value={Number(layer()?.count ?? 80)}
            min={1}
            max={400}
            step={1}
            disabled={layer()?.locked}
            onScrubStart={() => store.pushHistory('Scrub particle count')}
            onChange={(val) => writeField('count', Math.round(val), 'Set particle count')}
            onCommit={() => void store.executeSave().catch(() => undefined)}
          />
        </div>
      </div>

      <div class="mf-grid-2">
        <div class="mf-field">
          <label class="mf-label">Color</label>
          <input
            type="color"
            class="mf-color-input"
            id="inspector-particle-color"
            value={String(layer()?.color ?? '#7dd3fc')}
            disabled={layer()?.locked}
            onChange={(e) => writeField('color', e.currentTarget.value, 'Set particle color')}
          />
        </div>
        <div class="mf-field">
          <label class="mf-label">Color 2</label>
          <input
            type="color"
            class="mf-color-input"
            id="inspector-particle-color2"
            value={String(layer()?.color2 ?? '#38bdf8')}
            disabled={layer()?.locked}
            onChange={(e) => writeField('color2', e.currentTarget.value, 'Set particle second color')}
          />
        </div>
      </div>

      <div class="mf-grid-3">
        <div class="mf-field">
          <label class="mf-label">Speed</label>
          <ScrubInput
            label="V"
            value={Number(layer()?.speed ?? 1)}
            min={0.1}
            max={4}
            step={0.1}
            disabled={layer()?.locked}
            onScrubStart={() => store.pushHistory('Scrub particle speed')}
            onChange={(val) => writeField('speed', val, 'Set particle speed')}
            onCommit={() => void store.executeSave().catch(() => undefined)}
          />
        </div>
        <div class="mf-field">
          <label class="mf-label">Size</label>
          <ScrubInput
            label="S"
            unit="px"
            value={radius()}
            min={0.5}
            max={40}
            step={0.5}
            disabled={layer()?.locked}
            onScrubStart={() => store.pushHistory('Scrub particle size')}
            onChange={(val) => writeRadius(val)}
            onCommit={() => void store.executeSave().catch(() => undefined)}
          />
        </div>
        <div class="mf-field">
          <label class="mf-label">Seed</label>
          <ScrubInput
            label="S"
            value={Number(layer()?.seed ?? 20260101)}
            min={0}
            max={2147483647}
            step={1}
            disabled={layer()?.locked}
            onScrubStart={() => store.pushHistory('Scrub particle seed')}
            onChange={(val) => writeField('seed', Math.round(val), 'Set particle seed')}
            onCommit={() => void store.executeSave().catch(() => undefined)}
          />
        </div>
      </div>

      <div class="mf-field">
        <label class="mf-label">Opacity</label>
        <ScrubInput
          label="O"
          unit="%"
          value={Math.round(Number(layer()?.opacity ?? 0.75) * 100)}
          min={0}
          max={100}
          step={1}
          disabled={layer()?.locked}
          onScrubStart={() => store.pushHistory('Scrub particle opacity')}
          onChange={(val) => writeField('opacity', val / 100, 'Set particle opacity')}
          onCommit={() => void store.executeSave().catch(() => undefined)}
        />
      </div>
    </div>
  );
};

/* ── cta ────────────────────────────────────────────────────────────────── */

/** The CTA editor — label, sublabel, variant, accent and the glyph. */
export const CtaEditor: Component = () => {
  const layer = useSelectedLayer();

  return (
    <div class="mf-cta-editor" id="inspector-cta">
      <div class="mf-field">
        <label class="mf-label">Label</label>
        <input
          class="mf-input"
          id="inspector-cta-label"
          value={String(layer()?.label ?? '')}
          disabled={layer()?.locked}
          onChange={(e) => writeField('label', e.currentTarget.value, 'Set CTA label')}
        />
      </div>

      <div class="mf-field">
        <label class="mf-label">Sublabel</label>
        <input
          class="mf-input"
          id="inspector-cta-sublabel"
          value={String(layer()?.sublabel ?? '')}
          disabled={layer()?.locked}
          onChange={(e) => writeField('sublabel', e.currentTarget.value, 'Set CTA sublabel')}
        />
      </div>

      <div class="mf-grid-2">
        <div class="mf-field">
          <label class="mf-label">Variant</label>
          <select
            class="mf-select"
            id="inspector-cta-variant"
            value={String(layer()?.variant ?? 'primary')}
            disabled={layer()?.locked}
            onChange={(e) => writeField('variant', e.currentTarget.value, 'Set CTA variant')}
          >
            <option value="primary">Primary</option>
            <option value="glass">Glass</option>
            <option value="outline">Outline</option>
            <option value="pill">Pill</option>
          </select>
        </div>
        <div class="mf-field">
          <label class="mf-label">Icon</label>
          <select
            class="mf-select"
            id="inspector-cta-icon"
            value={String(layer()?.icon ?? 'arrow')}
            disabled={layer()?.locked}
            onChange={(e) => writeField('icon', e.currentTarget.value, 'Set CTA icon')}
          >
            <option value="arrow">Arrow</option>
            <option value="sparkles">Sparkles</option>
            <option value="play">Play</option>
            <option value="none">None</option>
          </select>
        </div>
      </div>

      <div class="mf-grid-2">
        <div class="mf-field">
          <label class="mf-label">Accent</label>
          <input
            type="color"
            class="mf-color-input"
            id="inspector-cta-accent"
            value={String(layer()?.accentColor ?? '#38bdf8')}
            disabled={layer()?.locked}
            onChange={(e) => writeField('accentColor', e.currentTarget.value, 'Set CTA accent')}
          />
        </div>
        <div class="mf-field">
          <label class="mf-label">Text Color</label>
          <input
            type="color"
            class="mf-color-input"
            id="inspector-cta-text"
            value={String(layer()?.textColor ?? '#ffffff')}
            disabled={layer()?.locked}
            onChange={(e) => writeField('textColor', e.currentTarget.value, 'Set CTA text color')}
          />
        </div>
      </div>

      <div class="mf-grid-2">
        <div class="mf-field">
          <label class="mf-label">Width</label>
          <ScrubInput
            label="W"
            unit="px"
            value={Number(layer()?.widthPx ?? 320)}
            min={80}
            max={1200}
            step={10}
            disabled={layer()?.locked}
            onScrubStart={() => store.pushHistory('Scrub CTA width')}
            onChange={(val) => writeField('widthPx', Math.round(val), 'Set CTA width')}
            onCommit={() => void store.executeSave().catch(() => undefined)}
          />
        </div>
        <div class="mf-field">
          <label class="mf-label">Height</label>
          <ScrubInput
            label="H"
            unit="px"
            value={Number(layer()?.heightPx ?? 76)}
            min={32}
            max={400}
            step={1}
            disabled={layer()?.locked}
            onScrubStart={() => store.pushHistory('Scrub CTA height')}
            onChange={(val) => writeField('heightPx', Math.round(val), 'Set CTA height')}
            onCommit={() => void store.executeSave().catch(() => undefined)}
          />
        </div>
      </div>

      <div class="mf-grid-2">
        <div class="mf-field">
          <label class="mf-label">Radius</label>
          <ScrubInput
            label="R"
            unit="px"
            value={Number(layer()?.radiusPx ?? 38)}
            min={0}
            max={200}
            step={1}
            disabled={layer()?.locked}
            onScrubStart={() => store.pushHistory('Scrub CTA radius')}
            onChange={(val) => writeField('radiusPx', Math.round(val), 'Set CTA radius')}
            onCommit={() => void store.executeSave().catch(() => undefined)}
          />
        </div>
        <div class="mf-field">
          <label class="mf-label">Label Size</label>
          <ScrubInput
            label="F"
            unit="px"
            value={Number(layer()?.labelSizePx ?? 30)}
            min={10}
            max={96}
            step={1}
            disabled={layer()?.locked}
            onScrubStart={() => store.pushHistory('Scrub CTA label size')}
            onChange={(val) => writeField('labelSizePx', Math.round(val), 'Set CTA label size')}
            onCommit={() => void store.executeSave().catch(() => undefined)}
          />
        </div>
      </div>

      <Show when={layer()?.bgColor}>
        <div class="mf-field">
          <label class="mf-label">Background</label>
          <input
            type="color"
            class="mf-color-input"
            id="inspector-cta-bg"
            value={String(layer()?.bgColor ?? '#0b0f1a')}
            disabled={layer()?.locked}
            onChange={(e) => writeField('bgColor', e.currentTarget.value, 'Set CTA background')}
          />
        </div>
      </Show>
    </div>
  );
};
