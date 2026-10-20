import { Component, JSX, Show, createMemo } from 'solid-js';
import { store } from '../../state/store.js';

/**
 * The standardized NLE panel container.
 *
 * Every docked panel uses this wrapper, so the whole application shares one
 * tab-bar geometry, one focus treatment and one maximise behaviour.
 *
 *  - 26px tab bar on `--mf-bg-header`
 *  - the FOCUSED panel gets `1px solid #2d8ceb`
 *  - double-clicking the tab bar (or pressing `` ` ``) maximises the panel
 */

export interface PanelContainerProps {
  /** the panel id — used for focus tracking and maximisation */
  id: string;
  /** the tab labels */
  tabs: string[];
  /** the currently active tab */
  activeTab: string;
  /** called when a tab is clicked */
  onTabChange?: (tab: string) => void;
  /** optional header actions (right aligned) */
  actions?: JSX.Element;
  /** the panel body */
  children: JSX.Element;
  /** extra class on the panel root */
  class?: string;
  /** use the sunken surface (timeline gutters, code wells) */
  sunken?: boolean;
  /** aria label for the panel region */
  label?: string;
}

export const PanelContainer: Component<PanelContainerProps> = (props) => {
  const isFocused = createMemo(() => store.state.activePanelId === props.id);
  const isMaximized = createMemo(() => store.state.maximizedPanelId === props.id);

  return (
    <section
      class={`mf-panel panel-container ${isFocused() ? 'is-focused' : ''} ${
        props.sunken ? 'is-sunken' : ''
      } ${props.class ?? ''} ${isMaximized() ? 'mf-maximized-host' : ''}`}
      data-panel={props.id}
      aria-label={props.label ?? props.tabs[0]}
      onPointerDown={() => store.setActivePanel(props.id)}
    >
      <div
        class="mf-panel-header"
        onDblClick={() => store.toggleMaximizedPanel(props.id)}
        title="Double-click to maximize this panel"
      >
        <div class="mf-panel-tabs" role="tablist">
          <Show when={props.tabs.length > 1} fallback={
            <span class="mf-panel-tab is-active" role="tab" aria-selected="true">
              {props.tabs[0]}
            </span>
          }>
            {props.tabs.map((tab) => (
              <button
                class={`mf-panel-tab ${props.activeTab === tab ? 'is-active' : ''}`}
                role="tab"
                aria-selected={props.activeTab === tab}
                data-tab={tab}
                onClick={() => props.onTabChange?.(tab)}
              >
                {tab}
              </button>
            ))}
          </Show>
        </div>
        <Show when={props.actions}>
          <div class="mf-panel-header-actions">{props.actions}</div>
        </Show>
      </div>
      <div class="mf-panel-body">{props.children}</div>
    </section>
  );
};
