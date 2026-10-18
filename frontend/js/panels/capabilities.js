// ============================================================
// MotionForge Studio — Capabilities Panel
// Authoring Contract Registries & Inline Documentation Pills
// ============================================================

import { $, h } from '../util/dom.js';
import { store, state } from '../state.js';

export class CapabilitiesPanel {
  constructor() {
    this.container = $('#capabilities');
    store.subscribe((event) => {
      if (event === 'capabilities:loaded') {
        this.render();
      }
    });
  }

  render() {
    if (!this.container) return;
    const caps = state.capabilities;

    if (!caps) {
      this.container.innerHTML = `
        <div class="empty-state">
          <div class="skeleton-shimmer" style="width: 140px; height: 16px; margin-bottom: 8px;"></div>
          <div class="skeleton-shimmer" style="width: 200px; height: 12px;"></div>
        </div>
      `;
      return;
    }

    this.container.innerHTML = '';

    const reg = caps.registries || {};
    const notes = caps.notes || {};

    const sections = [
      { title: 'Layer Types', items: reg.layerTypes || caps.layerTypes || [], desc: 'Available building blocks for scenes' },
      { title: 'Entrance Presets', items: reg.presets?.entrance || caps.presets?.entrance || [], desc: 'Animations for when elements appear' },
      { title: 'Emphasis Presets', items: reg.presets?.emphasis || caps.presets?.emphasis || [], desc: 'Continuous or impact effects that return to identity' },
      { title: 'Exit Presets', items: reg.presets?.exit || caps.presets?.exit || [], desc: 'Outro animations leading to disappearance' },
      { title: 'Background Variants', items: reg.backgroundVariants || caps.backgroundVariants || [], desc: 'Solid fills, mesh gradients, or particle fields' },
      { title: 'Card Variants', items: reg.cardVariants || caps.cardVariants || [], desc: 'Glassmorphic cards, callouts, and meters' },
      { title: 'SFX Bank', items: reg.sfxBank || [], desc: 'Synchronized procedural audio cues' },
      { title: 'Transitions', items: reg.transitions || [], desc: 'Full-stage wipe, glitch, morph, or whipPan transitions' },
      { title: 'Camera Moves', items: reg.cameraMoves || caps.cameraMoves || [], desc: 'Camera pan, zoom, push-in, and shake rigs' },
      { title: 'Canvas Aspect Ratios', items: reg.canvas?.shapes || ['16:9', '9:16', '1:1', '4:5'], desc: 'Supported canvas aspect ratios' },
      { title: 'Canvas Resolutions', items: (reg.canvas?.scales || [720, 1080, 1440, 2160]).map(s => `${s}p`), desc: 'Output render pixel scales' },
    ];

    sections.forEach((sec) => {
      const secEl = h('div', { class: 'cap-section' });
      secEl.appendChild(
        h('div', { class: 'cap-title' },
          `${sec.title} `,
          h('span', { style: 'color: var(--text-3); font-weight: 400;' }, `(${sec.items.length})`)
        )
      );

      const pills = h('div', { class: 'cap-pills' });
      sec.items.forEach((item) => {
        const pill = h(
          'span',
          {
            class: 'cap-pill',
            'data-tooltip': `${item} — ${sec.desc}`,
          },
          item
        );
        pills.appendChild(pill);
      });

      secEl.appendChild(pills);
      this.container.appendChild(secEl);
    });

    // Engine Info footer
    if (caps.engine) {
      const eng = caps.engine;
      const engEl = h(
        'div',
        { class: 'cap-section', style: 'margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 11px; color: var(--text-3);' },
        h('div', { style: 'font-weight: 600; color: var(--text-2); margin-bottom: 4px;' }, `Engine v${eng.version || '0.1.0'}`),
        h('div', {}, `Runtime Built: ${eng.runtimeBuilt ? 'Yes (dist ready)' : 'No'}`)
      );
      this.container.appendChild(engEl);
    }
  }
}

export const capabilitiesPanel = new CapabilitiesPanel();
