// ============================================================
// MotionForge Studio — First-run 5-Step Guided Walkthrough
// ============================================================

import { $, h } from '../util/dom.js';

class OnboardingTour {
  constructor() {
    this.steps = [
      {
        target: '#btn-demo',
        title: 'Welcome to MotionForge Studio',
        text: 'Click "Load Demo Scene" to load a full showcase scene or load your own scene by ID.',
      },
      {
        target: '#layer-list',
        title: 'Layer Hierarchy',
        text: 'View and reorder kinetic text, cards, backgrounds, and assets. Drag to reorder or click to select.',
      },
      {
        target: '#inspector',
        title: 'Interactive Inspector',
        text: 'Fine-tune layer position, timings, colors, text, and motion presets with immediate validation.',
      },
      {
        target: '.timeline-area',
        title: 'Precision Timeline',
        text: 'Scrub the playhead, zoom with Ctrl+wheel, pan with middle mouse or Space+drag, and adjust layer duration.',
      },
      {
        target: '#btn-render',
        title: 'Export & Render',
        text: 'Generate high-fidelity draft or production MP4 videos encoded directly via the MotionForge pipeline.',
      },
    ];

    this.currentStep = 0;
    this.overlay = null;
    this.box = null;
  }

  startIfFirstRun() {
    if (localStorage.getItem('motionforge_seen_tour') === 'true') {
      return;
    }
    // Small delay to allow initial DOM paint
    setTimeout(() => this.start(), 600);
  }

  start() {
    this.currentStep = 0;
    this.createDom();
    this.showStep(0);
  }

  createDom() {
    if (this.overlay) this.overlay.remove();

    this.overlay = h('div', { class: 'mf-tour-overlay' });
    this.box = h('div', { class: 'mf-tour-box', role: 'dialog', 'aria-modal': 'true' });
    this.overlay.appendChild(this.box);
    document.body.appendChild(this.overlay);
  }

  showStep(idx) {
    if (idx >= this.steps.length) {
      this.finish();
      return;
    }
    this.currentStep = idx;
    const step = this.steps[idx];
    const targetEl = $(step.target);

    this.box.innerHTML = '';

    const stepIndicator = h('div', { class: 'mf-tour-step' }, `Step ${idx + 1} of ${this.steps.length}`);
    const title = h('div', { class: 'mf-tour-title' }, step.title);
    const text = h('div', { class: 'mf-tour-text' }, step.text);

    const actions = h(
      'div',
      { class: 'mf-tour-actions' },
      h('button', { class: 'text-btn', onClick: () => this.finish() }, 'Skip Tour'),
      h(
        'button',
        {
          class: 'primary-btn',
          onClick: () => this.showStep(idx + 1),
        },
        idx === this.steps.length - 1 ? 'Finish' : 'Next →'
      )
    );

    this.box.appendChild(stepIndicator);
    this.box.appendChild(title);
    this.box.appendChild(text);
    this.box.appendChild(actions);

    if (targetEl) {
      const rect = targetEl.getBoundingClientRect();
      const boxWidth = 320;
      let left = rect.left + rect.width / 2 - boxWidth / 2;
      let top = rect.bottom + 12;

      if (left < 20) left = 20;
      if (left + boxWidth > window.innerWidth - 20) left = window.innerWidth - boxWidth - 20;
      if (top + 180 > window.innerHeight - 20) {
        top = Math.max(20, rect.top - 180);
      }

      this.box.style.left = `${Math.round(left)}px`;
      this.box.style.top = `${Math.round(top)}px`;
    } else {
      this.box.style.left = '50%';
      this.box.style.top = '50%';
      this.box.style.transform = 'translate(-50%, -50%)';
    }
  }

  finish() {
    localStorage.setItem('motionforge_seen_tour', 'true');
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  reset() {
    localStorage.removeItem('motionforge_seen_tour');
    this.start();
  }
}

export const onboarding = new OnboardingTour();
