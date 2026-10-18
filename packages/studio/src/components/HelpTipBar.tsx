import { Component, createSignal, Show } from 'solid-js';

export const HelpTipBar: Component = () => {
  const [visible, setVisible] = createSignal(true);

  return (
    <Show when={visible()}>
      <div class="help-tip-bar" id="help-tip-bar" role="region" aria-label="Pro tips">
        <div class="help-tip-content">
          <span class="help-tip-icon">TIP</span>
          <span class="help-tip-text" id="help-tip-text">
            Press ⌘K or Ctrl+K to open the Command Palette and access any layer, action, or scene.
          </span>
        </div>
        <button class="help-tip-close" id="btn-close-tip" aria-label="Dismiss tip" onClick={() => setVisible(false)}>
          ×
        </button>
      </div>
    </Show>
  );
};
