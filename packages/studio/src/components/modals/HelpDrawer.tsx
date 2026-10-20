import { Component, For } from 'solid-js';
import { store } from '../../state/store.js';
import { IconClose, IconHelp } from '../icons/NleIcons.js';

/**
 * The quickstart guide.
 *
 * A drawer, not a modal: the user can keep it open while they work. Every
 * step names the panel it lives in, so a new user can find the feature.
 */

interface Step {
  title: string;
  body: string;
  where: string;
}

const STEPS: Step[] = [
  {
    title: 'Create a composition',
    body: 'Open the Project Bin (left rail) and press "New". A composition is a SceneSpec: a canvas, a duration and a stack of layers.',
    where: 'Project Bin → Compositions',
  },
  {
    title: 'Add layers',
    body: 'Use the tool dock to pick a tool, then click the canvas. Text, card and preset layers are created at the playhead and selected immediately.',
    where: 'Tool Dock (left rail)',
  },
  {
    title: 'Place a layer',
    body: 'Drag a layer in the Program Monitor. The magenta/cyan guides snap to the canvas centre and to the edges of every other visible layer.',
    where: 'Program Monitor',
  },
  {
    title: 'Tune the properties',
    body: 'Every numeric field is scrubbable: drag the label to change the value (Shift = 10x, Alt = 0.1x) or click the value to type an exact one.',
    where: 'Effect Controls (right rail)',
  },
  {
    title: 'Cut on the timeline',
    body: 'Move clips, drag the white trim handles to re-time them, and switch to the Razor tool (C) to cut a clip exactly where you click.',
    where: 'Timeline',
  },
  {
    title: 'Export',
    body: 'The Render Queue exports an H.264/AAC MP4. Draft is 720p/30fps for iteration; Production is full resolution at 60fps.',
    where: 'Render (title bar) or Ctrl+Q',
  },
];

export const HelpDrawer: Component = () => {
  const close = () => store.setActiveModal(null);

  return (
    <div
      class="mf-modal-backdrop"
      id="help-drawer-backdrop"
      style={{ 'align-items': 'stretch', 'justify-content': 'flex-end' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <aside
        class="mf-modal"
        id="help-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Quickstart guide"
        style={{
          width: '420px',
          'max-width': '92vw',
          height: '100%',
          'max-height': '100%',
          'border-radius': '0',
          'border-right': 'none',
        }}
      >
        <div class="mf-modal-head">
          <span class="mf-modal-title">
            <IconHelp size={13} style={{ 'vertical-align': '-2px', 'margin-right': '6px' }} />
            Quickstart Guide
          </span>
          <button class="mf-btn is-icon is-ghost" id="help-drawer-close" aria-label="Close" onClick={close}>
            <IconClose size={13} />
          </button>
        </div>

        <div class="mf-modal-body">
          <For each={STEPS}>
            {(step, index) => (
              <div style={{ 'margin-bottom': '14px' }}>
                <div class="mf-shortcut-group-title" style={{ 'margin-bottom': '4px' }}>
                  {index() + 1}. {step.title}
                </div>
                <div style={{ 'font-size': 'var(--mf-text-sm)', color: 'var(--mf-text-2)', 'line-height': '1.5' }}>
                  {step.body}
                </div>
                <div class="mf-bin-sub" style={{ 'margin-top': '4px' }}>
                  {step.where}
                </div>
              </div>
            )}
          </For>
        </div>

        <div class="mf-modal-foot">
          <button class="mf-btn" id="help-drawer-shortcuts" onClick={() => store.setActiveModal('shortcuts')}>
            Keyboard Shortcuts
          </button>
          <button class="mf-btn is-primary" id="help-drawer-done" onClick={close}>
            Got it
          </button>
        </div>
      </aside>
    </div>
  );
};
