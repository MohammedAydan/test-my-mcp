import { Component, Show, createSignal, onMount } from 'solid-js';

export const OnboardingTour: Component = () => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [currentStep, setCurrentStep] = createSignal(0);

  const steps = [
    {
      title: 'Welcome to MotionForge Studio',
      text: 'Click "Load Demo Scene" to load a full showcase scene or load your own scene by ID.',
    },
    {
      title: 'Layer Hierarchy',
      text: 'View and reorder kinetic text, cards, backgrounds, and assets. Drag to reorder or click to select.',
    },
    {
      title: 'Interactive Inspector',
      text: 'Fine-tune layer position, timings, colors, text, and motion presets with immediate validation.',
    },
    {
      title: 'Precision Timeline',
      text: 'Scrub the playhead, zoom with Ctrl+wheel, pan with middle mouse or Space+drag, and adjust layer duration.',
    },
    {
      title: 'Export & Render',
      text: 'Generate high-fidelity draft or production MP4 videos encoded directly via the MotionForge pipeline.',
    },
  ];

  const finish = () => {
    setIsOpen(false);
    localStorage.setItem('motionforge_seen_tour', 'true');
  };

  onMount(() => {
    if (localStorage.getItem('motionforge_seen_tour') !== 'true') {
      setTimeout(() => setIsOpen(true), 300);
    }
  });

  return (
    <Show when={isOpen()}>
      <div class="mf-tour-overlay" style="position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 9990; display: flex; justify-content: center; align-items: center;">
        <div class="mf-tour-box" role="dialog" aria-modal="true" style="background: var(--bg-1); border: 1px solid var(--primary); border-radius: var(--radius-lg); padding: 24px; width: 440px; max-width: 90vw; box-shadow: var(--shadow-lg);">
          <div class="mf-tour-step" style="font-size: 11px; color: var(--primary); font-weight: 600; text-transform: uppercase; margin-bottom: 8px;">
            Step {currentStep() + 1} of {steps.length}
          </div>
          <div class="mf-tour-title" style="font-size: 16px; font-weight: 700; color: var(--text-1); margin-bottom: 8px;">
            {steps[currentStep()].title}
          </div>
          <div class="mf-tour-text" style="font-size: 13px; color: var(--text-2); line-height: 1.5; margin-bottom: 20px;">
            {steps[currentStep()].text}
          </div>
          <div class="mf-tour-actions" style="display: flex; justify-content: space-between; align-items: center;">
            <button class="text-btn" onClick={finish}>
              Skip Tour
            </button>
            <button
              class="primary-btn"
              onClick={() => {
                if (currentStep() < steps.length - 1) {
                  setCurrentStep(currentStep() + 1);
                } else {
                  finish();
                }
              }}
            >
              {currentStep() === steps.length - 1 ? 'Finish' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
