import { Component, For } from 'solid-js';
import { store } from '../../state/store.js';
import { IconClose } from '../icons/NleIcons.js';

/**
 * The toast stack.
 *
 * Bottom-right, above the status bar, one line each, dismissed automatically
 * after four seconds.
 */
export const Toasts: Component = () => {
  const state = store.state;

  return (
    <div class="mf-toasts" id="toast-container" role="region" aria-label="Notifications">
      <For each={state.toasts}>
        {(toast) => (
          <div class={`mf-toast is-${toast.type}`} role="alert">
            <span style={{ flex: '1' }}>{toast.message}</span>
            <button
              class="mf-icon-btn"
              aria-label="Dismiss notification"
              onClick={() => store.removeToast(toast.id)}
            >
              <IconClose size={11} />
            </button>
          </div>
        )}
      </For>
    </div>
  );
};
