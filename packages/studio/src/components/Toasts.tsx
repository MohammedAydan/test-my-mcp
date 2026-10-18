import { Component, For } from 'solid-js';
import { store } from '../store.js';

export const Toasts: Component = () => {
  const state = store.state;

  return (
    <div class="toast-container" id="toast-container" role="region" aria-label="Notifications">
      <For each={state.toasts}>
        {(t) => (
          <div class={`toast ${t.type}`} role="alert">
            <span class="toast-message">{t.message}</span>
            <button class="toast-close" aria-label="Dismiss toast" onClick={() => store.removeToast(t.id)}>
              ×
            </button>
          </div>
        )}
      </For>
    </div>
  );
};
