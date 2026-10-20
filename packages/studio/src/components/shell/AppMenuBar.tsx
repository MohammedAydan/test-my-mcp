import { Component, For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { CATEGORY_ORDER, commandsByCategory, runCommand, type CommandCategory } from '../../services/commands.js';

/**
 * The application menu bar.
 *
 * The native Electron menu bar is removed (`autoHideMenuBar`), so this is the
 * only menu in the application. Every entry is a projection of the command
 * registry — there is no such thing as a dead menu item here.
 *
 * Behaviour:
 *  - click a title → it opens,
 *  - hover another title while one is open → the open menu switches,
 *  - `Escape`, a click outside or a second click on the title → it closes.
 */

interface MenuPosition {
  left: number;
  top: number;
}

export const AppMenuBar: Component = () => {
  const [openMenu, setOpenMenu] = createSignal<CommandCategory | null>(null);
  const [position, setPosition] = createSignal<MenuPosition>({ left: 0, top: 0 });
  let rootRef: HTMLDivElement | undefined;

  const toggle = (category: CommandCategory, anchor: HTMLElement) => {
    if (openMenu() === category) {
      setOpenMenu(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    setPosition({ left: rect.left, top: rect.bottom });
    setOpenMenu(category);
  };

  const onDocumentPointerDown = (event: PointerEvent) => {
    if (!openMenu()) return;
    const target = event.target as Node;
    if (rootRef?.contains(target)) return;
    if ((target as HTMLElement)?.closest?.('.mf-menu-pop')) return;
    setOpenMenu(null);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') setOpenMenu(null);
  };

  createEffect(() => {
    document.addEventListener('pointerdown', onDocumentPointerDown);
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    });
  });

  return (
    <>
      <div class="mf-menubar" ref={rootRef} role="menubar" aria-label="Application menu">
        <For each={CATEGORY_ORDER}>
          {(category) => (
            <button
              class={`mf-menubar-item ${openMenu() === category ? 'is-open' : ''}`}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={openMenu() === category}
              data-menu={category}
              onClick={(e) => toggle(category, e.currentTarget)}
              onMouseEnter={(e) => {
                if (openMenu()) toggle(category, e.currentTarget);
              }}
            >
              {category}
            </button>
          )}
        </For>
      </div>

      <Show when={openMenu()}>
        {(category) => (
          <div
            class="mf-menu-pop"
            role="menu"
            aria-label={category()}
            style={{ left: `${position().left}px`, top: `${position().top}px` }}
            data-menu-pop={category()}
          >
            <For each={commandsByCategory(category())}>
              {(command) => (
                <>
                  <button
                    class="mf-menu-row"
                    role="menuitem"
                    data-command={command.id}
                    onClick={() => {
                      setOpenMenu(null);
                      runCommand(command.id);
                    }}
                  >
                    <span>{command.title}</span>
                    <Show when={command.shortcut}>
                      <span class="mf-menu-shortcut">{command.shortcut}</span>
                    </Show>
                  </button>
                  <Show when={command.id.endsWith('.new') || command.id.endsWith('.open')}>
                    <div class="mf-menu-sep" />
                  </Show>
                </>
              )}
            </For>
          </div>
        )}
      </Show>
    </>
  );
};
