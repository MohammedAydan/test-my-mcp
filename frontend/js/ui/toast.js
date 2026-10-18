// ============================================================
// MotionForge Studio — Actionable Stacking Toast System
// ============================================================

import { $, h } from '../util/dom.js';

class ToastManager {
  constructor() {
    this.container = $('#toast-container');
    if (!this.container) {
      this.container = h('div', { id: 'toast-container', class: 'toast-container' });
      document.body.appendChild(this.container);
    }
    this.maxVisible = 3;
    this.toasts = [];
  }

  show({ type = 'info', title, message, duration = 4000, action = null }) {
    const toastEl = h(
      'div',
      { class: `toast ${type}`, role: 'status', 'aria-live': 'polite' },
      h(
        'div',
        { class: 'toast-content' },
        h('div', { class: 'toast-title' }, title),
        message ? h('div', { class: 'toast-message' }, message) : null
      )
    );

    if (action) {
      const actionBtn = h(
        'button',
        {
          class: 'primary-btn',
          style: 'padding: 4px 10px; font-size: 11px; margin-top: 6px;',
          onClick: () => {
            action.onClick();
            this.dismiss(toastEl);
          },
        },
        action.label
      );
      toastEl.querySelector('.toast-content').appendChild(actionBtn);
    }

    const closeBtn = h(
      'button',
      {
        class: 'toast-close',
        'aria-label': 'Close notification',
        onClick: () => this.dismiss(toastEl),
      },
      '×'
    );
    toastEl.appendChild(closeBtn);

    this.container.appendChild(toastEl);
    this.toasts.push(toastEl);

    // Enforce max visible
    while (this.toasts.length > this.maxVisible) {
      const oldest = this.toasts.shift();
      this.dismiss(oldest);
    }

    if (duration > 0) {
      setTimeout(() => this.dismiss(toastEl), duration);
    }

    return toastEl;
  }

  dismiss(toastEl) {
    if (!toastEl || !toastEl.parentNode) return;
    toastEl.style.opacity = '0';
    toastEl.style.transform = 'translateX(20px)';
    toastEl.style.transition = 'all 140ms ease-out';
    setTimeout(() => {
      if (toastEl.parentNode) toastEl.remove();
      this.toasts = this.toasts.filter(t => t !== toastEl);
    }, 140);
  }

  success(title, message, duration) {
    return this.show({ type: 'success', title, message, duration });
  }

  error(title, message, action, duration = 6000) {
    return this.show({ type: 'error', title, message, action, duration });
  }

  info(title, message, duration) {
    return this.show({ type: 'info', title, message, duration });
  }

  warn(title, message, duration) {
    return this.show({ type: 'warn', title, message, duration });
  }
}

export const toast = new ToastManager();
