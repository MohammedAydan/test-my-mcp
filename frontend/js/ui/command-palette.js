// ============================================================
// MotionForge Studio — Command Palette (Ctrl+K / ⌘K)
// Search across Layers, Scenes, and Studio Actions
// ============================================================

import { $, h } from '../util/dom.js';
import { store, state } from '../state.js';

class CommandPalette {
  constructor() {
    this.el = null;
    this.input = null;
    this.resultsList = null;
    this.isOpen = false;
    this.selectedIndex = 0;
    this.currentItems = [];
    this.actionRegistry = [];

    this.init();
  }

  init() {
    this.el = h(
      'div',
      { class: 'mf-cmd-palette-backdrop hidden', role: 'dialog', 'aria-modal': 'true' },
      h(
        'div',
        { class: 'mf-cmd-palette' },
        h(
          'div',
          { class: 'mf-cmd-header' },
          h('svg', { viewBox: '0 0 24 24', width: '16', height: '16', class: 'mf-cmd-search-icon' },
            h('circle', { cx: '11', cy: '11', r: '7', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }),
            h('path', { d: 'M16 16 L21 21', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round' })
          ),
          (this.input = h('input', {
            type: 'text',
            class: 'mf-cmd-input',
            placeholder: 'Type a command, layer name, or scene...',
            role: 'combobox',
            'aria-expanded': 'true',
            'aria-autocomplete': 'list',
          }))
        ),
        (this.resultsList = h('div', { class: 'mf-cmd-results', role: 'listbox' }))
      )
    );

    document.body.appendChild(this.el);

    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });

    this.input.addEventListener('input', () => {
      this.search(this.input.value);
    });

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.setSelectedIndex(this.selectedIndex + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.setSelectedIndex(this.selectedIndex - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.executeSelected();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
  }

  registerAction(action) {
    this.actionRegistry.push(action);
  }

  open() {
    this.isOpen = true;
    this.el.classList.remove('hidden');
    this.input.value = '';
    this.search('');
    setTimeout(() => this.input.focus(), 20);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add('hidden');
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  collectItems() {
    const items = [];

    // 1. Actions from registry
    for (const act of this.actionRegistry) {
      items.push({
        category: 'Action',
        title: act.title,
        description: act.description || '',
        shortcut: act.shortcut || '',
        run: act.run,
      });
    }

    // 2. Layers from current scene
    if (state.scene?.layers) {
      for (const layer of state.scene.layers) {
        items.push({
          category: 'Layer',
          title: layer.id || 'unnamed',
          description: `Type: ${layer.type} · at ${layer.at || 0}ms`,
          shortcut: '',
          run: () => {
            store.selectLayer(layer.id);
            store.setPlayhead(layer.at || 0);
          },
        });
      }
    }

    // 3. Recent Scenes
    if (state.recentScenes) {
      for (const rec of state.recentScenes) {
        items.push({
          category: 'Scene',
          title: `Load: ${rec.name || rec.id}`,
          description: `ID: ${rec.id}`,
          shortcut: '',
          run: () => {
            if (window.__mf_loadScene) window.__mf_loadScene(rec.id);
          },
        });
      }
    }

    return items;
  }

  search(query) {
    const q = query.trim().toLowerCase();
    const all = this.collectItems();

    if (!q) {
      this.currentItems = all.slice(0, 15);
    } else {
      this.currentItems = all
        .map(item => {
          const t = item.title.toLowerCase();
          const d = item.description.toLowerCase();
          let score = 0;
          if (t === q) score += 100;
          else if (t.startsWith(q)) score += 50;
          else if (t.includes(q)) score += 20;
          if (d.includes(q)) score += 5;
          return { item, score };
        })
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(entry => entry.item)
        .slice(0, 15);
    }

    this.selectedIndex = 0;
    this.renderResults();
  }

  setSelectedIndex(index) {
    if (!this.currentItems.length) return;
    if (index < 0) index = this.currentItems.length - 1;
    if (index >= this.currentItems.length) index = 0;
    this.selectedIndex = index;

    const rows = this.resultsList.querySelectorAll('.mf-cmd-row');
    rows.forEach((row, i) => {
      row.classList.toggle('selected', i === index);
      if (i === index) row.scrollIntoView({ block: 'nearest' });
    });
  }

  executeSelected() {
    const selected = this.currentItems[this.selectedIndex];
    if (selected && selected.run) {
      this.close();
      selected.run();
    }
  }

  renderResults() {
    this.resultsList.innerHTML = '';
    if (!this.currentItems.length) {
      const empty = h('div', { class: 'mf-cmd-empty' }, 'No matching commands or layers');
      this.resultsList.appendChild(empty);
      return;
    }

    this.currentItems.forEach((item, idx) => {
      const row = h(
        'div',
        {
          class: `mf-cmd-row ${idx === this.selectedIndex ? 'selected' : ''}`,
          role: 'option',
          onClick: () => {
            this.close();
            item.run();
          },
          onMouseenter: () => this.setSelectedIndex(idx),
        },
        h('span', { class: `mf-cmd-badge badge-${item.category.toLowerCase()}` }, item.category),
        h(
          'div',
          { class: 'mf-cmd-info' },
          h('div', { class: 'mf-cmd-title' }, item.title),
          item.description ? h('div', { class: 'mf-cmd-desc' }, item.description) : null
        ),
        item.shortcut ? h('span', { class: 'mf-cmd-shortcut' }, item.shortcut) : null
      );
      this.resultsList.appendChild(row);
    });
  }
}

export const commandPalette = new CommandPalette();
