import { Component, Show, For, createSignal } from 'solid-js';
import { store } from '../store.js';
import { api } from '../api.js';

interface ModalProps {
  onLoadScene: (id: string) => Promise<void>;
  onExecuteRender: (sceneId: string, quality: 'draft' | 'production') => Promise<void>;
  onAddLayer: (type: string) => void;
}

export const Modal: Component<ModalProps> = (props) => {
  const state = store.state;
  const [loadInput, setLoadInput] = createSignal('');
  const [renderQuality, setRenderQuality] = createSignal<'draft' | 'production'>('draft');
  const [inspectFrames, setInspectFrames] = createSignal<Array<{ atMs: number; preview: string }>>([]);

  const close = () => {
    store.setActiveModal(null);
  };

  const submitLoad = () => {
    const id = loadInput().trim();
    if (id) {
      close();
      props.onLoadScene(id);
    }
  };

  const submitRender = () => {
    if (state.sceneId) {
      close();
      props.onExecuteRender(state.sceneId, renderQuality());
    }
  };

  const LAYER_TYPES = [
    { type: 'kineticText', name: 'Kinetic Text', desc: 'Animated text with word, character, or line stagger masks.' },
    { type: 'card', name: 'Card Container', desc: 'Glassmorphic card, callout pill, progress bar, or counter.' },
    { type: 'imageLogo', name: 'Image / Logo', desc: 'Bitmap asset with mask reveal, spring entrance, and sizing.' },
    { type: 'background', name: 'Background', desc: 'Solid color, mesh gradient, or particles behind stage.' },
    { type: 'lottie', name: 'Lottie Vector', desc: 'Vector animation scrubbed synchronously with timeline.' },
    { type: 'foregroundFX', name: 'Foreground FX', desc: 'Color grading, film grain, or vignette overlay.' },
  ];

  return (
    <div class={`modal-container ${state.activeModal ? '' : 'hidden'}`} id="modal-container">
      <div class="modal-backdrop" id="modal-backdrop" onClick={close}></div>
      <div class="modal" id="modal-content" role="dialog" aria-modal="true">
        {/* LOAD SCENE MODAL */}
        <Show when={state.activeModal === 'load'}>
          <div class="modal-header">
            <h2 id="modal-header-title" class="modal-title">
              Load Scene
            </h2>
            <p class="modal-subtitle">Open an existing scene from the engine or select from recents</p>
          </div>
          <div class="modal-body">
            <div style="margin-bottom: 16px;">
              <label class="insp-label" style="margin-bottom: 6px; display: block;">
                Scene ID or Name:
              </label>
              <input
                type="text"
                class="insp-input"
                id="modal-scene-id-input"
                placeholder="e.g. demo-scene or client-reel"
                value={loadInput()}
                onInput={(e) => setLoadInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitLoad();
                  if (e.key === 'Escape') close();
                }}
              />
            </div>
            <Show when={state.recentScenes.length > 0}>
              <div class="modal-subtitle" style="margin-bottom: 8px;">
                Recent Scenes:
              </div>
              <div style="max-height: 160px; overflow-y: auto;">
                <For each={state.recentScenes}>
                  {(rec) => (
                    <div
                      class="mf-context-item"
                      style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; margin-bottom: 4px; background: var(--bg-2); border-radius: var(--radius); cursor: pointer;"
                      onClick={() => {
                        close();
                        props.onLoadScene(rec.id);
                      }}
                    >
                      <span style="font-weight: 500;">{rec.name || rec.id}</span>
                      <span style="font-size: 11px; color: var(--text-3); font-family: monospace;">{rec.id}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
          <div class="modal-actions">
            <button class="modal-btn secondary" onClick={close}>
              Cancel
            </button>
            <button class="modal-btn primary-btn" onClick={submitLoad}>
              Load Scene
            </button>
          </div>
        </Show>

        {/* ADD LAYER MODAL */}
        <Show when={state.activeModal === 'add-layer'}>
          <div class="modal-header">
            <h2 class="modal-title">Add Layer</h2>
            <p class="modal-subtitle">Select the element type to place at the current playhead</p>
          </div>
          <div class="modal-body">
            <div class="layer-type-grid">
              <For each={LAYER_TYPES}>
                {(t) => (
                  <div
                    class="layer-type-card"
                    onClick={() => {
                      close();
                      props.onAddLayer(t.type);
                    }}
                  >
                    <div class="name">{t.name}</div>
                    <div class="desc">{t.desc}</div>
                  </div>
                )}
              </For>
            </div>
          </div>
          <div class="modal-actions">
            <button class="modal-btn secondary" onClick={close}>
              Cancel
            </button>
          </div>
        </Show>

        {/* RENDER MODAL */}
        <Show when={state.activeModal === 'render'}>
          <div class="modal-header">
            <h2 class="modal-title">Render Video</h2>
            <p class="modal-subtitle">Compile scene into an MP4 video using headless Chromium and FFmpeg</p>
          </div>
          <div class="modal-body">
            <div class="insp-field" style="margin-bottom: 16px;">
              <label class="insp-label">Render Quality Profile:</label>
              <select
                class="insp-input"
                id="render-quality-select"
                value={renderQuality()}
                onChange={(e) => setRenderQuality(e.currentTarget.value as 'draft' | 'production')}
              >
                <option value="draft">Draft (30fps, 540p, fast preview encoding)</option>
                <option value="production">Production (60fps, 1080p Full HD master)</option>
              </select>
            </div>
          </div>
          <div class="modal-actions">
            <button class="modal-btn secondary" onClick={close}>
              Cancel
            </button>
            <button class="modal-btn primary-btn" onClick={submitRender}>
              Start Render
            </button>
          </div>
        </Show>

        {/* SHORTCUTS MODAL */}
        <Show when={state.activeModal === 'shortcuts'}>
          <div class="modal-header">
            <h2 class="modal-title">Keyboard Shortcuts</h2>
            <p class="modal-subtitle">Quick reference for all navigation, transport, and editing hotkeys</p>
          </div>
          <div class="modal-body">
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
              <tbody>
                <tr style="border-bottom: 1px solid var(--border);">
                  <td style="padding: 6px 0; font-weight: 600;">Space</td>
                  <td style="padding: 6px 0; color: var(--text-2);">Play / Pause playback</td>
                </tr>
                <tr style="border-bottom: 1px solid var(--border);">
                  <td style="padding: 6px 0; font-weight: 600;">← / →</td>
                  <td style="padding: 6px 0; color: var(--text-2);">Step frame backward / forward (100ms)</td>
                </tr>
                <tr style="border-bottom: 1px solid var(--border);">
                  <td style="padding: 6px 0; font-weight: 600;">Ctrl+Z / Ctrl+Shift+Z</td>
                  <td style="padding: 6px 0; color: var(--text-2);">Undo / Redo up to 50 operations</td>
                </tr>
                <tr style="border-bottom: 1px solid var(--border);">
                  <td style="padding: 6px 0; font-weight: 600;">Ctrl+D</td>
                  <td style="padding: 6px 0; color: var(--text-2);">Duplicate selected layer</td>
                </tr>
                <tr style="border-bottom: 1px solid var(--border);">
                  <td style="padding: 6px 0; font-weight: 600;">Delete / Backspace</td>
                  <td style="padding: 6px 0; color: var(--text-2);">Delete selected layer</td>
                </tr>
                <tr style="border-bottom: 1px solid var(--border);">
                  <td style="padding: 6px 0; font-weight: 600;">Ctrl+K</td>
                  <td style="padding: 6px 0; color: var(--text-2);">Open Command Palette</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-weight: 600;">F</td>
                  <td style="padding: 6px 0; color: var(--text-2);">Toggle Fullscreen Preview</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="modal-actions">
            <button class="modal-btn primary-btn" onClick={close}>
              Close
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
};
