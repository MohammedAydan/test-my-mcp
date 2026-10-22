import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { store } from '../../state/store.js';
import { CATEGORY_ORDER, commands, runCommand } from '../../services/commands.js';
import { summarizeRenderQueue } from '../../services/render-queue.js';
import { IconSearch } from '../icons/NleIcons.js';

/**
 * The command palette.
 *
 * A fuzzy-ish search over the SAME command registry the menu bar uses, so
 * every command is reachable by keyboard.
 *
 * The header strip reads the GLOBAL render queue, so the palette can report
 * that a render is running (or that one failed) without the Render Modal
 * ever being open.
 */
export const CommandPalette: Component = () => {
  const [query, setQuery] = createSignal('');
  const [index, setIndex] = createSignal(0);

  /** the live render queue, projected out of the store */
  const renderSummary = createMemo(() => summarizeRenderQueue(store.state.renderQueue));

  const results = createMemo(() => {
    const q = query().toLowerCase().trim();
    const list = commands.filter((command) => {
      if (!q) return true;
      return (
        command.title.toLowerCase().includes(q) ||
        command.category.toLowerCase().includes(q) ||
        (command.shortcut ?? '').toLowerCase().includes(q)
      );
    });
    return list.slice(0, 40);
  });

  const close = () => {
    store.setActiveModal(null);
    setQuery('');
    setIndex(0);
  };

  const execute = (id: string) => {
    close();
    runCommand(id);
  };

  return (
    <div
      class="mf-modal-backdrop"
      id="command-palette-backdrop"
      style={{ 'align-items': 'flex-start', 'padding-top': '12vh' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        class="mf-modal"
        id="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        style={{ width: '560px' }}
      >
        <div style={{ position: 'relative', 'border-bottom': '1px solid var(--mf-border)' }}>
          <IconSearch
            size={14}
            style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--mf-text-3)' }}
          />
          <input
            class="mf-input"
            id="command-palette-input"
            style={{ height: '34px', 'border': 'none', 'padding-left': '32px', 'font-size': '13px' }}
            placeholder="Type a command…"
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(results().length - 1, i + 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                const target = results()[index()];
                if (target) execute(target.id);
              }
            }}
            autofocus
          />
        </div>

        <div style={{ 'max-height': '380px', 'overflow-y': 'auto', padding: '4px' }}>
          {/* the LIVE render queue — the store is the single source of truth */}
          <Show when={renderSummary().total > 0}>
            <div
              class="mf-palette-render"
              id="command-palette-render"
              data-render-active={renderSummary().active}
              data-render-total={renderSummary().total}
              style={{
                padding: '6px 8px',
                'margin-bottom': '4px',
                border: '1px solid var(--mf-border)',
                'border-radius': 'var(--radius-sm)',
                'font-size': 'var(--mf-text-xs)',
                'font-family': 'var(--mf-font-mono)',
                color: 'var(--mf-accent-text)',
                background: 'var(--mf-bg-sunken)',
              }}
            >
              <span>
                Render queue — {renderSummary().active} active · {renderSummary().completed} done
                {renderSummary().failed > 0 ? ` · ${renderSummary().failed} failed` : ''}
              </span>
              <Show when={renderSummary().active > 0}>
                <span style={{ float: 'right' }}>{Math.round(renderSummary().progressPct)}%</span>
              </Show>
            </div>
          </Show>
          <Show
            when={results().length > 0}
            fallback={
              <div class="mf-empty" style={{ padding: '24px' }}>
                <div class="mf-empty-title">No command matches</div>
              </div>
            }
          >
            <For each={CATEGORY_ORDER}>
              {(category) => {
                const rows = () => results().filter((command) => command.category === category);
                return (
                  <Show when={rows().length > 0}>
                    <div class="mf-shortcut-group-title" style={{ padding: '6px 8px 2px' }}>
                      {category}
                    </div>
                    <For each={rows()}>
                      {(command) => (
                        <button
                          class="mf-menu-row"
                          data-command={command.id}
                          style={
                            results().indexOf(command) === index()
                              ? { background: 'var(--mf-accent-dim)' }
                              : undefined
                          }
                          onMouseEnter={() => setIndex(results().indexOf(command))}
                          onClick={() => execute(command.id)}
                        >
                          <span>{command.title}</span>
                          <Show when={command.shortcut}>
                            <span class="mf-menu-shortcut">{command.shortcut}</span>
                          </Show>
                        </button>
                      )}
                    </For>
                  </Show>
                );
              }}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
};
