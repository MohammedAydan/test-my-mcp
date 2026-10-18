// ============================================================
// MotionForge Studio — Inspector Panel
// Collapsible Grouped Sections, Inline Validation, Swatches, Presets
// ============================================================

import { $, h, debounce } from '../util/dom.js';
import { store, state } from '../state.js';
import { validateField } from '../util/validate.js';
import { previewPanel } from './preview.js';

export class InspectorPanel {
  constructor() {
    this.container = $('#inspector');
    this.collapsedSections = new Set(['Advanced']); // Advanced collapsed by default
    this.lastRenderedLayerId = null;

    store.subscribe((event, s, payload) => {
      if (event === 'layer:selected' || event === 'scene:loaded') {
        this.render();
      } else if (event === 'scene:mutated' && payload?.source !== 'field-input') {
        this.render();
      }
    });
  }

  getSwatches() {
    const swatches = new Set(['#ffffff', '#0a0a0f', '#f59e0b', '#fbbf24', '#14b8a6', '#f43f5e', '#3b82f6', '#22c55e']);
    if (state.scene?.layers) {
      for (const l of state.scene.layers) {
        if (typeof l.fill === 'string') swatches.add(l.fill);
        if (l.variant?.color) swatches.add(l.variant.color);
        if (l.variant?.accentColor) swatches.add(l.variant.accentColor);
      }
    }
    return Array.from(swatches).slice(0, 10);
  }

  updateLayerField(path, value, description) {
    store.mutateScene((scene) => {
      const layer = scene.layers.find(l => l.id === state.selectedLayerId);
      if (!layer) return;

      const parts = path.split('.');
      let target = layer;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!target[parts[i]]) target[parts[i]] = {};
        target = target[parts[i]];
      }
      target[parts[parts.length - 1]] = value;
    }, description || `Edit ${path}`);
  }

  render() {
    if (!this.container) return;

    const layer = state.scene?.layers?.find(l => l.id === state.selectedLayerId);

    if (!layer) {
      this.container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="4" y="4" width="16" height="16" rx="2"/>
            <path d="M9 9h6M9 13h4"/>
          </svg>
          <div class="empty-state-title">Select a layer</div>
          <div class="empty-state-hint">Click any layer in the list or timeline to view and edit its parameters.</div>
        </div>
      `;
      return;
    }

    this.container.innerHTML = '';
    const isLocked = Boolean(layer._locked);

    // Layer ID Header with Locked indicator
    const header = h(
      'div',
      { class: 'insp-layer-id' },
      h('span', {}, `${layer.type} : ${layer.id}`),
      isLocked ? h('span', { style: 'color: var(--warning); font-size: 11px;' }, '🔒 Locked') : null
    );
    this.container.appendChild(header);

    // 1. Identity & Timing Section
    this.renderSection('Timing & Lifecycle', [
      this.createInputField({
        label: 'Start Time (at)',
        helper: 'When the layer appears on canvas, in milliseconds',
        value: layer.at || 0,
        type: 'number',
        disabled: isLocked,
        context: { sceneDuration: state.scene?.durationMs },
        onChange: (v) => this.updateLayerField('at', Number(v), `Set start time of ${layer.id}`),
      }),
      this.createInputField({
        label: 'Duration',
        helper: 'How long the layer stays visible, in milliseconds',
        value: layer.duration || 3000,
        type: 'number',
        disabled: isLocked,
        context: { sceneDuration: state.scene?.durationMs },
        onChange: (v) => this.updateLayerField('duration', Number(v), `Set duration of ${layer.id}`),
      }),
    ]);

    // 2. Position Section (if applicable)
    if (layer.position) {
      this.renderSection('Transform & Position', [
        h('div', { class: 'insp-input-row' },
          this.createInputField({
            label: 'X Position (%)',
            helper: '0% = left edge, 50% = center, 100% = right edge',
            value: layer.position.xPct ?? 50,
            type: 'number',
            disabled: isLocked,
            onChange: (v) => this.updateLayerField('position.xPct', Number(v), `Set xPct of ${layer.id}`),
          }),
          this.createInputField({
            label: 'Y Position (%)',
            helper: '0% = top edge, 50% = center, 100% = bottom edge',
            value: layer.position.yPct ?? 50,
            type: 'number',
            disabled: isLocked,
            onChange: (v) => this.updateLayerField('position.yPct', Number(v), `Set yPct of ${layer.id}`),
          })
        ),
      ]);
    }

    // 3. Content & Typography (kineticText)
    if (layer.type === 'kineticText') {
      this.renderSection('Typography & Appearance', [
        this.createInputField({
          label: 'Text Content',
          helper: 'The copy rendered with kinetic typography masks',
          value: layer.text || '',
          type: 'text',
          disabled: isLocked,
          onChange: (v) => this.updateLayerField('text', v, `Set text of ${layer.id}`),
        }),
        h('div', { class: 'insp-input-row' },
          this.createInputField({
            label: 'Font Size (px)',
            helper: 'Design size between 8 and 600 px',
            value: layer.sizePx || 80,
            type: 'number',
            disabled: isLocked,
            onChange: (v) => this.updateLayerField('sizePx', Number(v), `Set sizePx of ${layer.id}`),
          }),
          this.createSelectField({
            label: 'Animate By',
            helper: 'Granularity of kinetic mask sequencing',
            value: layer.animateBy || 'word',
            options: ['word', 'char', 'line'],
            disabled: isLocked,
            onChange: (v) => this.updateLayerField('animateBy', v, `Set animateBy of ${layer.id}`),
          })
        ),
        this.createColorPickerField({
          label: 'Fill Color',
          helper: 'Primary text color',
          value: typeof layer.fill === 'string' ? layer.fill : '#ffffff',
          disabled: isLocked,
          onChange: (v) => this.updateLayerField('fill', v, `Set fill of ${layer.id}`),
        }),
      ]);
    }

    // 4. Card Layer Appearance
    if (layer.type === 'card' && layer.variant) {
      this.renderSection('Card Properties', [
        this.createSelectField({
          label: 'Card Variant',
          helper: 'Preset visual container layout',
          value: layer.variant.variant || 'glassCard',
          options: state.capabilities?.cardVariants || ['glassCard', 'callout', 'progressBar', 'counter'],
          disabled: isLocked,
          onChange: (v) => this.updateLayerField('variant.variant', v, `Set card variant of ${layer.id}`),
        }),
        this.createInputField({
          label: 'Card Title',
          value: layer.variant.title || '',
          disabled: isLocked,
          onChange: (v) => this.updateLayerField('variant.title', v, `Set card title of ${layer.id}`),
        }),
        this.createInputField({
          label: 'Card Body',
          value: layer.variant.body || '',
          disabled: isLocked,
          onChange: (v) => this.updateLayerField('variant.body', v, `Set card body of ${layer.id}`),
        }),
        this.createInputField({
          label: 'Width (px)',
          value: layer.variant.widthPx || 800,
          type: 'number',
          disabled: isLocked,
          onChange: (v) => this.updateLayerField('variant.widthPx', Number(v), `Set card width of ${layer.id}`),
        }),
      ]);
    }

    // 5. Background Layer Appearance
    if (layer.type === 'background') {
      this.renderSection('Background Style', [
        this.createSelectField({
          label: 'Variant',
          value: layer.variant?.variant || 'solid',
          options: state.capabilities?.backgroundVariants || ['solid', 'meshGradient', 'particles', 'media'],
          disabled: isLocked,
          onChange: (v) => this.updateLayerField('variant.variant', v, `Set bg variant of ${layer.id}`),
        }),
        this.createColorPickerField({
          label: 'Background Color',
          value: layer.variant?.color || '#0a0a0f',
          disabled: isLocked,
          onChange: (v) => this.updateLayerField('variant.color', v, `Set bg color of ${layer.id}`),
        }),
      ]);
    }

    // 6. Motion Presets Section
    this.renderSection('Motion Presets', [
      this.createPresetPicker({
        category: 'entrance',
        label: 'Entrance Preset',
        helper: 'Animation as layer enters stage',
        current: layer.entrance?.name || 'none',
        disabled: isLocked,
        onSelect: (name) => {
          if (name === 'none') {
            this.updateLayerField('entrance', null, `Remove entrance from ${layer.id}`);
          } else {
            this.updateLayerField('entrance', { name, durationMs: 800 }, `Set entrance ${name} on ${layer.id}`);
            previewPanel.triggerPresetPreview(name);
          }
        },
      }),
      this.createPresetPicker({
        category: 'emphasis',
        label: 'Emphasis Preset',
        helper: 'Temporary effect while active (starts and settles at identity)',
        current: layer.emphasis?.name || 'none',
        disabled: isLocked,
        onSelect: (name) => {
          if (name === 'none') {
            this.updateLayerField('emphasis', null, `Remove emphasis from ${layer.id}`);
          } else {
            this.updateLayerField('emphasis', { name, durationMs: 600 }, `Set emphasis ${name} on ${layer.id}`);
            previewPanel.triggerPresetPreview(name);
          }
        },
      }),
      this.createPresetPicker({
        category: 'exit',
        label: 'Exit Preset',
        helper: 'Animation leading up to layer disappearance',
        current: layer.exit?.name || 'none',
        disabled: isLocked,
        onSelect: (name) => {
          if (name === 'none') {
            this.updateLayerField('exit', null, `Remove exit from ${layer.id}`);
          } else {
            this.updateLayerField('exit', { name, durationMs: 600 }, `Set exit ${name} on ${layer.id}`);
            previewPanel.triggerPresetPreview(name);
          }
        },
      }),
    ]);

    // 7. Advanced Collapsible Section
    this.renderSection('Advanced', [
      this.createInputField({
        label: 'CSS Class Hook',
        helper: 'Optional custom class for scene styling',
        value: layer.className || '',
        disabled: isLocked,
        onChange: (v) => this.updateLayerField('className', v, `Set class on ${layer.id}`),
      }),
    ], true);
  }

  renderSection(title, children, isAdvanced = false) {
    const isCollapsed = this.collapsedSections.has(title);

    const sectionEl = h('div', { class: 'insp-section' });
    const titleEl = h(
      'div',
      {
        class: 'insp-section-title',
        style: 'cursor: pointer; user-select: none;',
        onClick: () => {
          if (this.collapsedSections.has(title)) {
            this.collapsedSections.delete(title);
          } else {
            this.collapsedSections.add(title);
          }
          this.render();
        },
      },
      h('span', {}, title),
      h('span', { style: 'font-size: 10px; color: var(--text-3);' }, isCollapsed ? '▶' : '▼')
    );

    sectionEl.appendChild(titleEl);

    if (!isCollapsed) {
      for (const kid of children) {
        if (kid) sectionEl.appendChild(kid);
      }
    }

    this.container.appendChild(sectionEl);
  }

  createInputField({ label, helper, value, type = 'text', disabled = false, context = {}, onChange }) {
    const fieldWrap = h('div', { class: 'insp-field' });
    const labelEl = h('label', { class: 'insp-label' }, label);
    const inputEl = h('input', {
      type,
      class: 'insp-input',
      value: value ?? '',
      disabled,
    });
    const errEl = h('div', { class: 'insp-field-error hidden', style: 'color: var(--danger); font-size: 11px; margin-top: 2px;' });
    const helperEl = helper ? h('div', { class: 'insp-field-helper', style: 'color: var(--text-3); font-size: 11px; margin-top: 2px;' }, helper) : null;

    const debouncedCommit = debounce((val) => {
      const err = validateField(label.toLowerCase(), val, context);
      if (err) {
        inputEl.style.borderColor = 'var(--danger)';
        errEl.textContent = err;
        errEl.classList.remove('hidden');
      } else {
        inputEl.style.borderColor = '';
        errEl.classList.add('hidden');
        onChange(val);
      }
    }, 400);

    inputEl.addEventListener('input', (e) => debouncedCommit(e.target.value));

    fieldWrap.appendChild(labelEl);
    fieldWrap.appendChild(inputEl);
    fieldWrap.appendChild(errEl);
    if (helperEl) fieldWrap.appendChild(helperEl);

    return fieldWrap;
  }

  createSelectField({ label, helper, value, options = [], disabled = false, onChange }) {
    const fieldWrap = h('div', { class: 'insp-field' });
    const labelEl = h('label', { class: 'insp-label' }, label);
    const selectEl = h('select', { class: 'insp-input', disabled });

    options.forEach((opt) => {
      const optEl = h('option', { value: opt }, opt);
      if (opt === value) optEl.selected = true;
      selectEl.appendChild(optEl);
    });

    selectEl.addEventListener('change', (e) => onChange(e.target.value));

    fieldWrap.appendChild(labelEl);
    fieldWrap.appendChild(selectEl);
    if (helper) {
      fieldWrap.appendChild(h('div', { style: 'color: var(--text-3); font-size: 11px; margin-top: 2px;' }, helper));
    }
    return fieldWrap;
  }

  createColorPickerField({ label, helper, value, disabled = false, onChange }) {
    const fieldWrap = h('div', { class: 'insp-field' });
    fieldWrap.appendChild(h('label', { class: 'insp-label' }, label));

    const colorRow = h('div', { class: 'insp-color-row' });
    const picker = h('input', { type: 'color', value: value || '#ffffff', disabled });
    const textInput = h('input', { type: 'text', class: 'insp-input mono', value: value || '#ffffff', disabled });

    picker.addEventListener('input', (e) => {
      textInput.value = e.target.value;
      onChange(e.target.value);
    });

    textInput.addEventListener('change', (e) => {
      if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
        picker.value = e.target.value;
      }
      onChange(e.target.value);
    });

    colorRow.appendChild(picker);
    colorRow.appendChild(textInput);
    fieldWrap.appendChild(colorRow);

    // Swatches row
    const swatches = this.getSwatches();
    const swatchesRow = h('div', { class: 'insp-swatches', style: 'display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap;' });
    swatches.forEach((sw) => {
      const swatchBtn = h('button', {
        style: `width: 18px; height: 18px; border-radius: 3px; background: ${sw}; border: 1px solid var(--border); cursor: pointer;`,
        'data-tooltip': sw,
        onClick: () => {
          if (disabled) return;
          picker.value = sw;
          textInput.value = sw;
          onChange(sw);
        },
      });
      swatchesRow.appendChild(swatchBtn);
    });
    fieldWrap.appendChild(swatchesRow);

    if (helper) {
      fieldWrap.appendChild(h('div', { style: 'color: var(--text-3); font-size: 11px; margin-top: 4px;' }, helper));
    }
    return fieldWrap;
  }

  createPresetPicker({ category, label, helper, current, disabled = false, onSelect }) {
    const fieldWrap = h('div', { class: 'insp-field' });
    fieldWrap.appendChild(h('label', { class: 'insp-label' }, label));

    const presetsList = state.capabilities?.registries?.presets?.[category] ||
      (category === 'entrance' ? ['springPop', 'smoothSlideUp', 'maskRevealWipe', 'elasticScale', 'blurFadeIn', '3dFlipIn'] :
       category === 'emphasis' ? ['pulseGlow', 'floatIdle', 'lightSweep', 'cameraShakeImpact'] :
       ['scaleDownFade', 'whipOutLeft', 'collapseMask']);

    const selectEl = h('select', { class: 'insp-input', disabled });
    selectEl.appendChild(h('option', { value: 'none' }, '— None —'));

    presetsList.forEach((p) => {
      const opt = h('option', { value: p }, p);
      if (p === current) opt.selected = true;
      selectEl.appendChild(opt);
    });

    selectEl.addEventListener('change', (e) => onSelect(e.target.value));

    fieldWrap.appendChild(selectEl);
    if (helper) {
      fieldWrap.appendChild(h('div', { style: 'color: var(--text-3); font-size: 11px; margin-top: 2px;' }, helper));
    }
    return fieldWrap;
  }
}

export const inspectorPanel = new InspectorPanel();
