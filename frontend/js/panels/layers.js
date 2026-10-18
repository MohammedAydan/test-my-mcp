// ============================================================
// MotionForge Studio — Layers Panel
// Reordering, Duplicate, Hide, Lock, Inline Rename, Filter
// ============================================================

import { $, $$, h } from '../util/dom.js';
import { store, state } from '../state.js';
import { toast } from '../ui/toast.js';

export const LAYER_COLORS = {
  background:   '#52525b',  // neutral
  imageLogo:    '#f59e0b',  // amber
  kineticText:  '#f43f5e',  // rose
  card:         '#14b8a6',  // teal
  lottie:       '#22c55e',  // green
  foregroundFX: '#3b82f6',  // blue
};

export const getLayerColor = (type) => LAYER_COLORS[type] || '#f59e0b';

export class LayersPanel {
  constructor() {
    this.container = $('#layer-list');
    this.filterInput = null;
    this.filterText = '';
    this.draggedIndex = null;

    this.initHeader();
    store.subscribe((event) => {
      if (['scene:loaded', 'scene:mutated', 'layer:selected'].includes(event)) {
        this.render();
      }
    });
  }

  initHeader() {
    const parentPanel = this.container.closest('.panel-content');
    if (!parentPanel) return;

    // Add filter input above layer list if not present
    let filterWrap = parentPanel.querySelector('.layer-filter-wrap');
    if (!filterWrap) {
      filterWrap = h('div', { class: 'layer-filter-wrap', style: 'padding: 8px 12px; border-bottom: 1px solid var(--border);' },
        (this.filterInput = h('input', {
          type: 'text',
          class: 'insp-input',
          placeholder: 'Filter layers...',
          style: 'padding: 4px 8px; font-size: 11px;',
          onInput: (e) => {
            this.filterText = e.target.value.toLowerCase().trim();
            this.render();
          },
        }))
      );
      parentPanel.insertBefore(filterWrap, this.container);
    }
  }

  render() {
    if (!this.container) return;
    const layers = state.scene?.layers || [];

    if (!layers.length) {
      this.container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3"/>
            <path d="M12 8v8M8 12h8"/>
          </svg>
          <div class="empty-state-title">No layers yet</div>
          <div class="empty-state-hint">Add text, cards, logos, or backgrounds to your scene.</div>
        </div>
      `;
      return;
    }

    this.container.innerHTML = '';

    layers.forEach((layer, idx) => {
      if (this.filterText && !layer.id.toLowerCase().includes(this.filterText) && !layer.type.toLowerCase().includes(this.filterText)) {
        return;
      }

      const isSelected = state.selectedLayerIds?.includes(layer.id) || state.selectedLayerId === layer.id;
      const isLocked = Boolean(layer._locked);
      const isHidden = Boolean(layer._hidden);

      const item = h(
        'div',
        {
          class: `layer-item ${isSelected ? 'selected' : ''} ${isHidden ? 'layer-hidden' : ''} ${isLocked ? 'layer-locked' : ''}`,
          draggable: !isLocked,
          'data-id': layer.id,
          'data-index': idx,
          style: isHidden ? 'opacity: 0.45;' : '',
          onClick: (e) => {
            const isMulti = e.shiftKey || e.ctrlKey || e.metaKey;
            store.selectLayer(layer.id, isMulti);
          },
        },
        h('span', { class: 'layer-color', style: `background: ${getLayerColor(layer.type)}` }),
        h('span', {
          class: 'layer-name',
          title: 'Double-click to rename',
          onDblclick: (e) => {
            e.stopPropagation();
            if (!isLocked) this.startInlineRename(layer, e.target);
          },
        }, layer.id || 'unnamed'),
        h('span', { class: 'layer-type' }, layer.type),
        h(
          'div',
          { class: 'layer-actions' },
          // Hide/Show Toggle (eye)
          h('button', {
            class: 'layer-action-btn',
            'aria-label': isHidden ? 'Show layer' : 'Hide layer',
            'data-tooltip': isHidden ? 'Show layer' : 'Hide layer',
            onClick: (e) => {
              e.stopPropagation();
              this.toggleHide(layer);
            },
          }, isHidden ? '👁️‍🗨️' : '👁'),
          // Lock/Unlock Toggle
          h('button', {
            class: 'layer-action-btn',
            'aria-label': isLocked ? 'Unlock layer' : 'Lock layer',
            'data-tooltip': isLocked ? 'Unlock layer' : 'Lock layer',
            onClick: (e) => {
              e.stopPropagation();
              this.toggleLock(layer);
            },
          }, isLocked ? '🔒' : '🔓'),
          // Duplicate Button
          h('button', {
            class: 'layer-action-btn',
            'aria-label': 'Duplicate layer',
            'data-tooltip': 'Duplicate (Ctrl+D)',
            onClick: (e) => {
              e.stopPropagation();
              this.duplicateLayer(layer);
            },
          }, '⎘'),
          // Delete Button
          h('button', {
            class: 'layer-action-btn delete',
            'aria-label': 'Delete layer',
            'data-tooltip': 'Delete layer',
            onClick: (e) => {
              e.stopPropagation();
              this.deleteLayer(layer.id);
            },
          }, '×')
        )
      );

      // Drag and drop event handlers
      item.addEventListener('dragstart', (e) => {
        this.draggedIndex = idx;
        e.dataTransfer.effectAllowed = 'move';
        item.style.opacity = '0.5';
      });

      item.addEventListener('dragend', () => {
        item.style.opacity = '1';
        $$('.layer-item', this.container).forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = item.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        item.classList.toggle('drag-over-top', e.clientY < mid);
        item.classList.toggle('drag-over-bottom', e.clientY >= mid);
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over-top', 'drag-over-bottom');
        if (this.draggedIndex == null || this.draggedIndex === idx) return;

        const targetIdx = idx;
        store.mutateScene((scene) => {
          const [moved] = scene.layers.splice(this.draggedIndex, 1);
          scene.layers.splice(targetIdx, 0, moved);
        }, `Reordered layer ${layer.id}`);
        this.draggedIndex = null;
      });

      this.container.appendChild(item);
    });
  }

  startInlineRename(layer, nameEl) {
    const currentName = layer.id;
    const input = h('input', {
      type: 'text',
      class: 'insp-input',
      value: currentName,
      style: 'padding: 2px 6px; font-size: 13px; height: 22px;',
    });

    const commit = () => {
      const newName = input.value.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      if (newName && newName !== currentName) {
        // Check uniqueness
        const exists = state.scene?.layers?.some(l => l.id === newName && l !== layer);
        if (exists) {
          toast.warn('Name in use', `Layer "${newName}" already exists.`);
          this.render();
          return;
        }
        store.mutateScene((scene) => {
          const l = scene.layers.find(x => x.id === currentName);
          if (l) l.id = newName;
          if (state.selectedLayerId === currentName) store.selectLayer(newName);
        }, `Renamed layer to ${newName}`);
      }
      this.render();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur();
      } else if (e.key === 'Escape') {
        this.render();
      }
    });

    nameEl.replaceWith(input);
    input.focus();
    input.select();
  }

  toggleHide(layer) {
    store.mutateScene((scene) => {
      const l = scene.layers.find(x => x.id === layer.id);
      if (l) l._hidden = !l._hidden;
    }, `${layer._hidden ? 'Show' : 'Hide'} layer ${layer.id}`);
  }

  toggleLock(layer) {
    store.mutateScene((scene) => {
      const l = scene.layers.find(x => x.id === layer.id);
      if (l) l._locked = !l._locked;
    }, `${layer._locked ? 'Unlock' : 'Lock'} layer ${layer.id}`);
  }

  duplicateLayer(targetLayer) {
    const l = targetLayer || state.scene?.layers?.find(x => x.id === state.selectedLayerId);
    if (!l) return;

    store.mutateScene((scene) => {
      const clone = structuredClone(l);
      let newId = `${l.id}-copy`;
      let counter = 1;
      while (scene.layers.some(x => x.id === newId)) {
        newId = `${l.id}-copy-${counter++}`;
      }
      clone.id = newId;
      clone.at = (l.at || 0) + 100; // Offset slightly
      scene.layers.push(clone);
      store.selectLayer(newId);
    }, `Duplicated layer ${l.id}`);
    toast.success('Layer Duplicated', `Created ${l.id}-copy`);
  }

  deleteLayer(layerId) {
    if (!layerId) return;
    store.mutateScene((scene) => {
      scene.layers = scene.layers.filter(l => l.id !== layerId);
      if (state.selectedLayerId === layerId) {
        store.selectLayer(scene.layers[0]?.id || null);
      }
    }, `Deleted layer ${layerId}`);
    toast.info('Layer Deleted', `${layerId} removed (Ctrl+Z to undo)`);
  }
}

export const layersPanel = new LayersPanel();
