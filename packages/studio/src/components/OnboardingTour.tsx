import { Component, Show, createSignal, onMount } from 'solid-js';

export const OnboardingTour: Component = () => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [isMinimized, setIsMinimized] = createSignal(false);
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
      text: 'Fine-tune layer position, timings, colors, text, and motion presets with scrubbable inputs and immediate validation.',
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
    localStorage.setItem('motionforge_tour_seen', 'true');
  };

  onMount(() => {
    if (
      localStorage.getItem('motionforge_seen_tour') !== 'true' &&
      localStorage.getItem('motionforge_tour_seen') !== 'true'
    ) {
      setTimeout(() => setIsOpen(true), 300);
    }
  });

  return (
    <Show when={isOpen()}>
      <div
        class="mf-tour-overlay mf-tour-backdrop"
        style="position: fixed; bottom: 20px; right: 24px; z-index: 1000; pointer-events: none;"
      >
        <Show
          when={!isMinimized()}
          fallback={
            <button
              class="mf-tour-pill"
              style="pointer-events: auto; background: var(--bg-1); color: var(--primary); border: 1px solid var(--primary); border-radius: 20px; padding: 6px 14px; font-size: 12px; font-weight: 600; box-shadow: var(--shadow-lg); cursor: pointer; display: flex; items-center; gap: 6px;"
              onClick={() => setIsMinimized(false)}
            >
              <span>✨</span> Quickstart Guide ({currentStep() + 1}/{steps.length})
            </button>
          }
        >
          <div
            class="mf-tour-box"
            role="region"
            aria-label="Quickstart Guide"
            style="pointer-events: auto; background: var(--bg-1); border: 1px solid var(--primary); border-radius: var(--radius-lg); padding: 18px; width: 360px; max-width: calc(100vw - 48px); box-shadow: var(--shadow-lg);"
          >
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <div
                class="mf-tour-step"
                style="font-size: 11px; color: var(--primary); font-weight: 600; text-transform: uppercase;"
              >
                Guide · Step {currentStep() + 1} of {steps.length}
              </div>
              <div style="display: flex; gap: 4px;">
                <button
                  class="text-btn"
                  style="font-size: 11px; padding: 2px 6px; color: var(--text-3);"
                  onClick={() => setIsMinimized(true)}
                  title="Minimize guide drawer"
                >
                  —
                </button>
                <button
                  class="text-btn"
                  style="font-size: 11px; padding: 2px 6px; color: var(--text-3);"
                  onClick={finish}
                  title="Close guide"
                >
                  ✕
                </button>
              </div>
            </div>

            <div
              class="mf-tour-title"
              style="font-size: 14px; font-weight: 700; color: var(--text-1); margin-bottom: 6px;"
            >
              {steps[currentStep()].title}
            </div>
            <div
              class="mf-tour-text"
              style="font-size: 12px; color: var(--text-2); line-height: 1.5; margin-bottom: 16px;"
            >
              {steps[currentStep()].text}
            </div>

            <div
              class="mf-tour-actions"
              style="display: flex; justify-content: space-between; align-items: center;"
            >
              <button class="text-btn" style="font-size: 11px;" onClick={finish}>
                Dismiss
              </button>
              <div style="display: flex; gap: 6px;">
                <Show when={currentStep() > 0}>
                  <button
                    class="secondary-btn"
                    style="font-size: 11px; padding: 4px 10px;"
                    onClick={() => setCurrentStep(currentStep() - 1)}
                  >
                    ← Prev
                  </button>
                </Show>
                <button
                  class="primary-btn"
                  style="font-size: 11px; padding: 4px 12px;"
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
      </div>
    </Show>
  );
};
