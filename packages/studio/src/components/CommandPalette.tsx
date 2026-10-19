import { Component, Show, For, createSignal, onMount, onCleanup } from 'solid-js';
import { store } from '../store.js';

interface ActionItem {
  id: string;
  title: string;
  description: string;
  shortcut?: string;
  run: () => void;
}

interface CommandPaletteProps {
  onOpenRender: () => void;
  onOpenInspect: () => void;
  onOpenNew: () => void;
  onOpenLoad: () => void;
}

export const CommandPalette: Component<CommandPaletteProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  let inputRef: HTMLInputElement | undefined;

  const actions: ActionItem[] = [
    {
      id: 'render-prod',
      title: 'Render Production Video',
      description: 'Compile 60fps Full HD MP4 master',
      shortcut: 'Render',
      run: () => props.onOpenRender(),
    },
    {
      id: 'render-draft',
      title: 'Render Draft Video',
      description: 'Fast preview 30fps MP4',
      shortcut: '',
      run: () => props.onOpenRender(),
    },
    {
      id: 'inspect-stills',
      title: 'Inspect Keyframe Stills',
      description: 'Capture and review PNG previews at intervals',
      shortcut: '',
      run: () => props.onOpenInspect(),
    },
    {
      id: 'new-scene',
      title: 'New Scene from Template',
      description: 'Open template picker for blank or preset scenes',
      shortcut: 'Ctrl+N',
      run: () => props.onOpenNew(),
    },
    {
      id: 'load-scene',
      title: 'Load Scene by ID',
      description: 'Load an existing scene or open from recents',
      shortcut: 'Ctrl+O',
      run: () => props.onOpenLoad(),
    },
    {
      id: 'reset-workspace',
      title: 'View: Reset Default Workspace',
      description: 'Reset all panel splitters and timeline height to defaults',
      shortcut: '',
      run: () => store.resetWorkspaceLayout(),
    },
  ];

  const filteredActions = () => {
    const q = query().toLowerCase().trim();
    if (!q) return actions;
    return actions.filter(
      (a) => a.title.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
    );
  };

  const close = () => {
    setIsOpen(false);
    setQuery('');
  };

  const open = () => {
    setIsOpen(true);
    setQuery('');
    setTimeout(() => inputRef?.focus(), 50);
  };

  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen()) close();
        else open();
      } else if (e.key === 'Escape' && isOpen()) {
        e.preventDefault();
        close();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    (window as unknown as { openCommandPalette?: () => void }).openCommandPalette = open;

    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown);
    });
  });

  return (
    <Show when={isOpen()}>
      <div class="mf-cmd-palette-backdrop" onClick={close} style="position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 9999; display: flex; justify-content: center; align-items: flex-start; padding-top: 15vh;">
        <div
          class="mf-cmd-palette"
          onClick={(e) => e.stopPropagation()}
          style="background: var(--bg-1); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); width: 560px; max-width: 90vw; box-shadow: var(--shadow-lg); overflow: hidden;"
        >
          <div style="padding: 12px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px;">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M16 16l4 4" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              class="mf-cmd-input"
              placeholder="Type a command or search..."
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              style="flex: 1; background: transparent; border: none; outline: none; color: var(--text-1); font-size: 14px;"
            />
          </div>

          <div class="mf-cmd-results" style="max-height: 320px; overflow-y: auto; padding: 6px;">
            <For each={filteredActions()}>
              {(action) => (
                <div
                  class="mf-cmd-row"
                  onClick={() => {
                    close();
                    action.run();
                  }}
                  style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-radius: var(--radius); cursor: pointer;"
                >
                  <div>
                    <div style="font-weight: 500; font-size: 13px; color: var(--text-1);">{action.title}</div>
                    <div style="font-size: 11px; color: var(--text-2);">{action.description}</div>
                  </div>
                  <Show when={action.shortcut}>
                    <span style="font-size: 10px; font-family: monospace; background: var(--bg-3); padding: 2px 6px; border-radius: 4px; color: var(--text-2);">
                      {action.shortcut}
                    </span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
};
