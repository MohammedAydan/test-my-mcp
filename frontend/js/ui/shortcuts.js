// ============================================================
// MotionForge Studio — Keyboard Shortcuts Router & Cheat Sheet
// ============================================================

import { $, h } from '../util/dom.js';
import { modal } from './modal.js';
import { commandPalette } from './command-palette.js';
import { store, state } from '../state.js';
import { toast } from './toast.js';

export const SHORTCUTS_DATA = [
  {
    category: 'Playback',
    shortcuts: [
      { key: 'Space', desc: 'Play / Pause scene playback' },
      { key: '← / →', desc: 'Step playhead back / forward (100ms)' },
      { key: 'Shift + ← / →', desc: 'Step playhead back / forward (1000ms)' },
      { key: 'Home / End', desc: 'Jump to scene start / end' },
    ],
  },
  {
    category: 'Navigation & Tools',
    shortcuts: [
      { key: 'Ctrl + K  /  ⌘K', desc: 'Open Command Palette' },
      { key: '?', desc: 'Show Keyboard Shortcuts reference' },
      { key: 'F', desc: 'Toggle Fullscreen preview mode' },
      { key: 'Ctrl + W', desc: 'Close active scene tab' },
      { key: 'Ctrl + Shift + P', desc: 'Toggle Performance HUD' },
    ],
  },
  {
    category: 'Editing & History',
    shortcuts: [
      { key: 'Ctrl + Z  /  ⌘Z', desc: 'Undo last action' },
      { key: 'Ctrl + Shift + Z', desc: 'Redo previously undone action' },
      { key: 'Ctrl + S  /  ⌘S', desc: 'Force save scene to engine' },
      { key: 'Ctrl + D  /  ⌘D', desc: 'Duplicate selected layer' },
      { key: 'Ctrl + C  /  ⌘C', desc: 'Copy selected layer' },
      { key: 'Ctrl + V  /  ⌘V', desc: 'Paste copied layer at playhead' },
      { key: 'Delete / Backspace', desc: 'Delete selected layer' },
    ],
  },
  {
    category: 'Timeline',
    shortcuts: [
      { key: 'Ctrl + Wheel', desc: 'Zoom timeline horizontally' },
      { key: 'Space + Drag', desc: 'Pan timeline horizontally' },
      { key: 'Middle-Click Drag', desc: 'Pan timeline horizontally' },
      { key: 'Shift + Click', desc: 'Multi-select layers' },
    ],
  },
];

export function openShortcutsModal() {
  const container = h('div', { class: 'mf-shortcuts-wrap' });

  // Search input
  const searchInput = h('input', {
    type: 'text',
    class: 'insp-input',
    placeholder: 'Filter shortcuts...',
    style: 'margin-bottom: 16px;',
  });
  container.appendChild(searchInput);

  const listContainer = h('div', { class: 'mf-shortcuts-list' });
  container.appendChild(listContainer);

  const renderList = (filterText = '') => {
    listContainer.innerHTML = '';
    const q = filterText.toLowerCase().trim();

    SHORTCUTS_DATA.forEach((cat) => {
      const filtered = cat.shortcuts.filter(
        (s) => !q || s.key.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q)
      );

      if (filtered.length > 0) {
        const catTitle = h('div', { class: 'insp-section-title', style: 'margin-top: 12px;' }, cat.category);
        listContainer.appendChild(catTitle);

        filtered.forEach((s) => {
          const row = h(
            'div',
            { class: 'mf-shortcut-row' },
            h('span', { class: 'mf-shortcut-desc' }, s.desc),
            h('kbd', { class: 'mf-shortcut-key' }, s.key)
          );
          listContainer.appendChild(row);
        });
      }
    });
  };

  searchInput.addEventListener('input', () => renderList(searchInput.value));
  renderList();

  modal.open({
    title: 'Keyboard Shortcuts Reference',
    subtitle: 'High-efficiency hotkeys designed for fast desktop authoring',
    content: container,
    actions: [{ label: 'Got It', type: 'primary', close: true }],
  });

  setTimeout(() => searchInput.focus(), 50);
}

export function initKeyboardShortcuts(actions = {}) {
  window.addEventListener('keydown', (e) => {
    const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

    // Command palette: Ctrl+K / Cmd+K (allowed even if in input if not modifier clash)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      commandPalette.toggle();
      return;
    }

    // Save: Ctrl+S / Cmd+S
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (actions.save) actions.save();
      return;
    }

    // Undo: Ctrl+Z / Cmd+Z
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      if (isInput) return;
      e.preventDefault();
      const desc = store.undo();
      if (desc) toast.info('Undone', desc);
      return;
    }

    // Redo: Ctrl+Shift+Z / Cmd+Shift+Z
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
      if (isInput) return;
      e.preventDefault();
      const desc = store.redo();
      if (desc) toast.info('Redone', desc);
      return;
    }

    // Duplicate Layer: Ctrl+D / Cmd+D
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      if (isInput) return;
      e.preventDefault();
      if (actions.duplicateLayer) actions.duplicateLayer();
      return;
    }

    // Copy Layer: Ctrl+C / Cmd+C
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !isInput) {
      if (actions.copyLayer) {
        e.preventDefault();
        actions.copyLayer();
      }
      return;
    }

    // Paste Layer: Ctrl+V / Cmd+V
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !isInput) {
      if (actions.pasteLayer) {
        e.preventDefault();
        actions.pasteLayer();
      }
      return;
    }

    // Close tab: Ctrl+W
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w' && !isInput) {
      if (actions.closeTab) {
        e.preventDefault();
        actions.closeTab();
      }
      return;
    }

    // Toggle HUD: Ctrl+Shift+P
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      if (actions.toggleHud) actions.toggleHud();
      return;
    }

    // Modal / Palette open: Esc is handled in modal/palette
    if (modal.isOpen || commandPalette.isOpen) return;

    // Ignore remaining shortcuts if focused inside text inputs
    if (isInput) return;

    // Shortcuts modal: '?'
    if (e.key === '?') {
      e.preventDefault();
      openShortcutsModal();
      return;
    }

    // Fullscreen preview: 'f'
    if (e.key.toLowerCase() === 'f') {
      e.preventDefault();
      if (actions.toggleFullscreen) actions.toggleFullscreen();
      return;
    }

    // Playback Space
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      store.setPlaying(!state.playing);
      return;
    }

    // Left / Right step
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const step = e.shiftKey ? 1000 : 100;
      store.setPlayhead(state.playhead - step);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const step = e.shiftKey ? 1000 : 100;
      store.setPlayhead(state.playhead + step);
      return;
    }

    // Home / End
    if (e.key === 'Home') {
      e.preventDefault();
      store.setPlayhead(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      store.setPlayhead(state.scene?.durationMs || 10000);
      return;
    }

    // Delete selected layer
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedLayerId && actions.deleteLayer) {
        e.preventDefault();
        actions.deleteLayer(state.selectedLayerId);
      }
    }
  });
}
