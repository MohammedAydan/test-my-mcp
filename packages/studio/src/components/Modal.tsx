import { Component, Show, For, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { store } from '../store.js';
import { api } from '../api.js';
import { fmtTime } from './Preview.js';
import type { StudioScene } from '../types.js';

interface ModalProps {
  onLoadScene: (id: string) => Promise<void>;
  onExecuteRender: (sceneId: string, quality: 'draft' | 'production') => Promise<void>;
  onAddLayer: (type: string) => void;
}

export const Modal: Component<ModalProps> = (props) => {
  const state = store.state;
  const [loadInput, setLoadInput] = createSignal('');
  const [renderQuality, setRenderQuality] = createSignal<'draft' | 'production'>('draft');

  // Render modal state
  const [renderJobId, setRenderJobId] = createSignal<string | null>(null);
  const [renderStatus, setRenderStatus] = createSignal<string | null>(null);
  const [renderProgress, setRenderProgress] = createSignal<number>(0);
  const [renderDownloadUrl, setRenderDownloadUrl] = createSignal<string | null>(null);
  let renderPollTimer: number | null = null;

  // Inspect modal state
  const [inspectFrames, setInspectFrames] = createSignal<Array<{ atMs: number; preview: string }>>([]);
  const [inspectLoading, setInspectLoading] = createSignal(false);

  const close = () => {
    store.setActiveModal(null);
    setRenderJobId(null);
    setRenderStatus(null);
    setRenderProgress(0);
    setRenderDownloadUrl(null);
    if (renderPollTimer) {
      clearInterval(renderPollTimer);
      renderPollTimer = null;
    }
  };

  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state.activeModal) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown);
      if (renderPollTimer) clearInterval(renderPollTimer);
    });
  });

  const submitLoad = () => {
    const id = loadInput().trim();
    if (id) {
      close();
      props.onLoadScene(id);
    }
  };

  const startRenderInModal = async () => {
    if (!state.sceneId) return;
    const q = renderQuality();
    setRenderStatus('Queuing render job…');
    setRenderProgress(5);
    try {
      const res = await api.startRender(state.sceneId, q);
      const jobId = (res as any).jobId || res.id;
      setRenderJobId(jobId);
      setRenderStatus('Rendering…');

      if (renderPollTimer) clearInterval(renderPollTimer);
      renderPollTimer = window.setInterval(async () => {
        try {
          const job = await api.getRender(jobId);
          setRenderStatus(`Status: ${job.status}`);
          setRenderProgress(Math.round(((job as any).progress || 0) * 100));

          if (job.status === 'succeeded' || job.status === 'completed') {
            if (renderPollTimer) {
              clearInterval(renderPollTimer);
              renderPollTimer = null;
            }
            const fileUrl = api.renderFileUrl(jobId);
            setRenderDownloadUrl(fileUrl);
            setRenderStatus('Render Succeeded');
          } else if (job.status === 'failed') {
            if (renderPollTimer) {
              clearInterval(renderPollTimer);
              renderPollTimer = null;
            }
            setRenderStatus('Render Failed: ' + (job.error || 'Unknown error'));
          }
        } catch (err: any) {
          console.error('[Render poll error]', err);
        }
      }, 1000);
    } catch (err: any) {
      setRenderStatus('Failed to start render: ' + err.message);
    }
  };

  // Inspect stills fetcher
  createEffect(async () => {
    if (state.activeModal === 'inspect' && state.scene && state.sceneId) {
      setInspectLoading(true);
      try {
        const dur = state.scene.durationMs || 8000;
        const timestamps = [
          0,
          Math.round(dur * 0.25),
          Math.round(dur * 0.5),
          Math.round(dur * 0.75),
          Math.round(dur * 0.95),
        ];
        const res = await api.inspect(state.sceneId, timestamps, false);
        const mapped = (res.frames || []).map((f: any) => ({
          atMs: f.at ?? f.atMs ?? 0,
          preview: f.preview || f.image,
        }));
        setInspectFrames(mapped);
      } catch (err) {
        console.error('Inspect error:', err);
      } finally {
        setInspectLoading(false);
      }
    }
  });

  const createBlankScene = async () => {
    const newSpec: StudioScene = {
      schemaVersion: 1,
      id: 'scene-' + Date.now().toString(36),
      name: 'Blank 16:9 Scene',
      canvas: { shape: '16:9', scale: 1080 },
      durationMs: 8000,
      assets: [],
      fonts: [],
      layers: [
        {
          id: 'bg',
          type: 'background',
          variant: { variant: 'solid', color: '#0a0a0f' },
        },
      ],
    };
    try {
      const res = await api.createScene(newSpec);
      close();
      store.setScene(newSpec, res.id);
      store.addToast('Created new 16:9 scene', 'success');
    } catch (err: any) {
      store.addToast('Failed to create scene: ' + err.message, 'error');
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
      <div class={`modal ${state.activeModal === 'inspect' ? 'wide' : ''}`} id="modal-content" role="dialog" aria-modal="true">
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
              <div style="display: flex; gap: 8px;">
                <input
                  type="text"
                  class="insp-input"
                  id="modal-scene-id-input"
                  placeholder="e.g. demo-scene or client-reel"
                  style="flex: 1;"
                  value={loadInput()}
                  onInput={(e) => setLoadInput(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitLoad();
                    if (e.key === 'Escape') close();
                  }}
                />
                <button class="primary-btn" onClick={submitLoad}>
                  Load
                </button>
              </div>
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
          </div>
        </Show>

        {/* NEW SCENE TEMPLATES MODAL */}
        <Show when={state.activeModal === 'new'}>
          <div class="modal-header">
            <h2 class="modal-title">Create New Scene</h2>
            <p class="modal-subtitle">Choose a canvas aspect ratio and starting motion template</p>
          </div>
          <div class="modal-body">
            <div class="layer-type-grid">
              <div class="layer-type-card" onClick={createBlankScene}>
                <div class="name">Blank 16:9</div>
                <div class="desc">Clean 1920×1080 canvas with dark neutral background.</div>
              </div>
              <div class="layer-type-card" onClick={createBlankScene}>
                <div class="name">Vertical 9:16 Reel</div>
                <div class="desc">1080×1920 mobile viewport for TikTok and Reels.</div>
              </div>
            </div>
          </div>
          <div class="modal-actions">
            <button class="modal-btn secondary" onClick={close}>
              Cancel
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

            {/* Progress / Status display */}
            <Show when={renderStatus()}>
              <div id="render-status-wrap" style="padding: 12px 0;">
                <div class="render-progress" style="background: var(--bg-3); height: 6px; border-radius: 3px; overflow: hidden; margin-bottom: 8px;">
                  <div
                    class="render-progress-bar"
                    id="render-bar"
                    style={`width: ${renderProgress()}%; background: var(--primary); height: 100%; transition: width 0.3s;`}
                  ></div>
                </div>
                <div id="render-msg" style="font-size: 11px; color: var(--text-2); text-align: center; margin-bottom: 12px;">
                  {renderStatus()}
                </div>
                <Show when={renderDownloadUrl()}>
                  <div style="text-align: center;">
                    <a
                      href={renderDownloadUrl()!}
                      download={`${state.sceneId || 'scene'}-${renderQuality()}.mp4`}
                      class="primary-btn"
                      style="display: inline-flex; text-decoration: none; padding: 8px 16px;"
                    >
                      Download MP4
                    </a>
                  </div>
                </Show>
              </div>
            </Show>
          </div>
          <div class="modal-actions">
            <button class="modal-btn secondary" onClick={close}>
              Cancel
            </button>
            <button class="modal-btn primary-btn" onClick={startRenderInModal}>
              Start Render
            </button>
          </div>
        </Show>

        {/* INSPECT KEYFRAMES MODAL */}
        <Show when={state.activeModal === 'inspect'}>
          <div class="modal-header">
            <h2 class="modal-title">Keyframes Inspection: {state.scene?.name || state.sceneId}</h2>
            <p class="modal-subtitle">Deterministically rendered frame stills from headless Playwright</p>
          </div>
          <div class="modal-body">
            <Show
              when={!inspectLoading()}
              fallback={<div class="empty-state">Rendering stills in Chromium worker…</div>}
            >
              <div class="kf-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;">
                <For each={inspectFrames()}>
                  {(f) => (
                    <div class="kf-item" style="background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden;">
                      <img class="kf-img" src={f.preview} alt={`Keyframe at ${f.atMs}ms`} style="width: 100%; aspect-ratio: 16/9; object-fit: contain; background: #000;" />
                      <div class="kf-label" style="padding: 6px 8px; font-size: 11px; font-family: monospace; color: var(--text-2);">
                        Time: {f.atMs} ms ({fmtTime(f.atMs)})
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
          <div class="modal-actions">
            <button class="modal-btn primary-btn" onClick={close}>
              Done
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
