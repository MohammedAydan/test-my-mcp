// ============================================================
// MotionForge Studio — Universal Tooltip System
// Native-feel 400ms delay, positioned above element
// ============================================================

import { h } from '../util/dom.js';

class TooltipManager {
  constructor() {
    this.el = null;
    this.timer = null;
    this.currentTarget = null;
    this.delay = 400; // 400ms delay per spec

    this.init();
  }

  init() {
    this.el = h('div', { class: 'mf-tooltip hidden', role: 'tooltip' });
    document.body.appendChild(this.el);

    document.addEventListener('mouseover', (e) => {
      const target = e.target.closest('[data-tooltip], [title]');
      if (!target) return;

      // Extract and convert native title to data-tooltip to prevent native browser tooltip clash
      if (target.hasAttribute('title')) {
        const text = target.getAttribute('title');
        if (text) {
          target.setAttribute('data-tooltip', text);
          target.removeAttribute('title');
        }
      }

      const text = target.getAttribute('data-tooltip');
      if (!text) return;

      this.currentTarget = target;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.show(target, text), this.delay);
    }, true);

    document.addEventListener('mouseout', (e) => {
      if (!this.currentTarget) return;
      if (e.target.closest('[data-tooltip]') === this.currentTarget) {
        this.hide();
      }
    }, true);

    window.addEventListener('scroll', () => this.hide(), true);
  }

  show(target, text) {
    if (!this.el) return;
    this.el.textContent = text;
    this.el.classList.remove('hidden');

    const rect = target.getBoundingClientRect();
    const tooltipRect = this.el.getBoundingClientRect();

    // Position above target, centered
    let top = rect.top - tooltipRect.height - 6;
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

    // Keep within viewport boundaries
    if (top < 6) {
      top = rect.bottom + 6; // flip below if off-screen top
    }
    if (left < 6) left = 6;
    if (left + tooltipRect.width > window.innerWidth - 6) {
      left = window.innerWidth - tooltipRect.width - 6;
    }

    this.el.style.top = `${Math.round(top)}px`;
    this.el.style.left = `${Math.round(left)}px`;
  }

  hide() {
    clearTimeout(this.timer);
    this.currentTarget = null;
    if (this.el) {
      this.el.classList.add('hidden');
    }
  }
}

export const tooltip = new TooltipManager();
