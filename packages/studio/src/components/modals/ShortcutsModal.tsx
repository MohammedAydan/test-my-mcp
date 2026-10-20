import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { store } from '../../state/store.js';
import { CATEGORY_ORDER, commands } from '../../services/commands.js';
import { IconClose, IconSearch } from '../icons/NleIcons.js';

/**
 * The searchable keyboard-shortcuts map.
 *
 * The list is GENERATED from the command registry, so a documented shortcut
 * can never drift from the command it claims to run. Transport shortcuts that
 * are not commands (Space, the arrow keys) are listed as the raw transport
 * bindings.
 */

const TRANSPORT_BINDINGS: Array<{ category: string; key: string; desc: string }> = [
  { category: 'Transport', key: 'Space', desc: 'Play / pause' },
  { category: 'Transport', key: 'J / K / L', desc: 'Shuttle reverse / pause / shuttle forward' },
  { category: 'Transport', key: '← / →', desc: 'Step one frame (Shift = one second)' },
  { category: 'Transport', key: 'Home / End', desc: 'Jump to the start / end of the timeline' },
  { category: 'Tools', key: 'V', desc: 'Selection tool' },
  { category: 'Tools', key: 'H', desc: 'Hand / pan tool' },
  { category: 'Tools', key: 'C', desc: 'Razor / split tool' },
  { category: 'Tools', key: 'T', desc: 'Text tool' },
  { category: 'Tools', key: 'R', desc: 'Shape / card tool' },
  { category: 'Tools', key: 'Space + Drag', desc: 'Pan the viewport from any tool' },
  { category: 'Tools', key: 'Ctrl + Wheel', desc: 'Zoom the monitor or the timeline' },
  { category: 'Tools', key: 'Alt + Drag', desc: 'Disable snapping / 0.1x scrub precision' },
];

export const ShortcutsModal: Component = () => {
  const [query, setQuery] = createSignal('');

  const commandRows = createMemo(() => {
    const q = query().toLowerCase().trim();
    return commands
      .filter((command) => command.shortcut)
      .filter((command) =>
        q
          ? command.title.toLowerCase().includes(q) ||
            (command.shortcut ?? '').toLowerCase().includes(q) ||
            command.category.toLowerCase().includes(q)
          : true
      );
  });

  const transportRows = createMemo(() => {
    const q = query().toLowerCase().trim();
    return TRANSPORT_BINDINGS.filter((row) =>
      q ? row.key.toLowerCase().includes(q) || row.desc.toLowerCase().includes(q) : true
    );
  });

  const close = () => store.setActiveModal(null);

  return (
    <div
      class="mf-modal-backdrop"
      id="shortcuts-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div class="mf-modal" id="shortcuts-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div class="mf-modal-head">
          <span class="mf-modal-title">Keyboard Shortcuts</span>
          <button
            class="mf-btn is-icon is-ghost"
            id="shortcuts-modal-close"
            aria-label="Close"
            onClick={close}
          >
            <IconClose size={13} />
          </button>
        </div>

        <div class="mf-modal-body">
          <div style={{ position: 'relative', 'margin-bottom': '12px' }}>
            <IconSearch
              size={13}
              style={{ position: 'absolute', left: '7px', top: '6px', color: 'var(--mf-text-3)' }}
            />
            <input
              class="mf-input"
              id="shortcuts-search"
              style={{ 'padding-left': '26px' }}
              placeholder="Search shortcuts"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              autofocus
            />
          </div>

          <Show when={transportRows().length > 0}>
            <div class="mf-shortcut-group">
              <div class="mf-shortcut-group-title">Transport & Tools</div>
              <For each={transportRows()}>
                {(row) => (
                  <div class="mf-shortcut-row">
                    <span>{row.desc}</span>
                    <span class="mf-shortcut-key">{row.key}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <For each={CATEGORY_ORDER}>
            {(category) => {
              const rows = () => commandRows().filter((command) => command.category === category);
              return (
                <Show when={rows().length > 0}>
                  <div class="mf-shortcut-group">
                    <div class="mf-shortcut-group-title">{category}</div>
                    <For each={rows()}>
                      {(command) => (
                        <div class="mf-shortcut-row">
                          <span>{command.title}</span>
                          <span class="mf-shortcut-key">{command.shortcut}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              );
            }}
          </For>

          <Show when={commandRows().length === 0 && transportRows().length === 0}>
            <div class="mf-empty">
              <div class="mf-empty-title">No shortcut matches</div>
              <div class="mf-empty-hint">Try a different search term.</div>
            </div>
          </Show>
        </div>

        <div class="mf-modal-foot">
          <button class="mf-btn" id="shortcuts-modal-done" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
