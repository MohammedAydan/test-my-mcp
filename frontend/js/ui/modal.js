// ============================================================
// MotionForge Studio — Accessible Modal Dialog System
// ============================================================

import { $, h } from '../util/dom.js';

class ModalManager {
  constructor() {
    this.container = $('#modal-container');
    this.backdrop = $('#modal-backdrop');
    this.content = $('#modal-content');
    this.isOpen = false;
    this.onCloseCb = null;
    this.previousFocus = null;

    if (this.backdrop) {
      this.backdrop.addEventListener('click', () => this.close());
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  }

  open({ title, subtitle, content, actions = [], wide = false, onClose = null }) {
    this.previousFocus = document.activeElement;
    this.onCloseCb = onClose;

    this.content.className = `modal ${wide ? 'wide' : ''}`;
    this.content.setAttribute('role', 'dialog');
    this.content.setAttribute('aria-modal', 'true');
    this.content.setAttribute('aria-labelledby', 'modal-header-title');

    this.content.innerHTML = '';

    const header = h(
      'div',
      { class: 'modal-header' },
      h('h2', { id: 'modal-header-title', class: 'modal-title' }, title),
      subtitle ? h('p', { class: 'modal-subtitle' }, subtitle) : null
    );
    this.content.appendChild(header);

    const bodyWrap = h('div', { class: 'modal-body' });
    if (typeof content === 'string') {
      bodyWrap.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      bodyWrap.appendChild(content);
    }
    this.content.appendChild(bodyWrap);

    if (actions && actions.length > 0) {
      const actionsWrap = h('div', { class: 'modal-actions' });
      for (const act of actions) {
        const btn = h(
          'button',
          {
            class: `modal-btn ${act.type || 'secondary'}${act.type === 'primary' ? ' primary-btn' : ''}`,
            onClick: () => {
              if (act.onClick) act.onClick();
              if (act.close !== false) this.close();
            },
          },
          act.label
        );
        actionsWrap.appendChild(btn);
      }
      this.content.appendChild(actionsWrap);
    }

    this.container.classList.remove('hidden');
    this.isOpen = true;

    // Trap focus to first input or button in modal
    setTimeout(() => {
      const focusable = this.content.querySelector('button, input, select, textarea, [tabindex="0"]');
      if (focusable) focusable.focus();
    }, 50);
  }

  close() {
    if (!this.isOpen) return;
    this.container.classList.add('hidden');
    this.content.innerHTML = '';
    this.isOpen = false;
    if (this.onCloseCb) {
      this.onCloseCb();
      this.onCloseCb = null;
    }
    if (this.previousFocus && typeof this.previousFocus.focus === 'function') {
      this.previousFocus.focus();
    }
  }
}

export const modal = new ModalManager();
