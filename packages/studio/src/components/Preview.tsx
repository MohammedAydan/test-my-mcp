import { Component, Show, createEffect, onMount, onCleanup, createSignal } from 'solid-js';
import { store } from '../store.js';
import { api, unwrapPayload } from '../api.js';
import { CanvasOverlay } from './CanvasOverlay.js';

export function fmtTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const remMs = Math.floor(ms % 1000);
  return `00:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(remMs).padStart(3, '0')}`;
}

interface PreviewProps {
  onLoadDemo: () => void;
  onOpenLoad: () => void;
}

export const Preview: Component<PreviewProps> = (props) => {
  const state = store.state;
  let iframeRef: HTMLIFrameElement | undefined;
  let stageContainerRef: HTMLDivElement | undefined;
  const [isFullscreen, setIsFullscreen] = createSignal(false);
  let pendingSeek: number | null = null;
  let rafSeekId: number | null = null;

  // postMessage seek dispatcher
  const postSeek = (atMs: number) => {
    pendingSeek = atMs;
    if (rafSeekId) return;
    rafSeekId = requestAnimationFrame(() => {
      rafSeekId = null;
      if (pendingSeek !== null && iframeRef?.contentWindow) {
        iframeRef.contentWindow.postMessage({ type: 'motionforge:seek', atMs: pendingSeek }, '*');
      }
    });
  };

  createEffect(() => {
    const at = state.playhead;
    postSeek(at);
  });

  createEffect(() => {
    const isPlaying = state.playing;
    if (iframeRef?.contentWindow) {
      if (isPlaying) {
        iframeRef.contentWindow.postMessage({ type: 'motionforge:play' }, '*');
      } else {
        iframeRef.contentWindow.postMessage({ type: 'motionforge:pause' }, '*');
      }
    }
  });

  // Push full scene state updates to the runtime iframe over postMessage
  createEffect(() => {
    const sc = state.scene;
    if (sc && iframeRef?.contentWindow) {
      iframeRef.contentWindow.postMessage(
        {
          type: 'motionforge:updateScene',
          scene: unwrapPayload(sc),
          atMs: state.playhead,
        },
        '*'
      );
    }
  });

  // Playback loop
  onMount(() => {
    let lastTick = performance.now();
    let animId: number;

    const playTick = (now: number) => {
      if (state.playing && state.scene) {
        const delta = now - lastTick;
        const dur = state.scene.durationMs || 10000;
        const next = state.playhead + delta;
        if (next >= dur) {
          store.setPlayhead(0);
          store.setPlaying(false);
        } else {
          store.setPlayhead(next);
        }
      }
      lastTick = now;
      animId = requestAnimationFrame(playTick);
    };

    animId = requestAnimationFrame(playTick);

    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'motionforge:ready') {
        console.log('[Preview] Runtime ready:', data);
        if (state.scene && iframeRef?.contentWindow) {
          iframeRef.contentWindow.postMessage(
            {
              type: 'motionforge:initScene',
              scene: unwrapPayload(state.scene),
              atMs: state.playhead,
            },
            '*'
          );
        }
        iframeRef?.contentWindow?.postMessage({ type: 'getLayerBounds', frame: 0 }, '*');
      } else if (data.type === 'motionforge:requestScene') {
        if (state.scene && iframeRef?.contentWindow) {
          iframeRef.contentWindow.postMessage(
            {
              type: 'motionforge:initScene',
              scene: unwrapPayload(state.scene),
              atMs: state.playhead,
            },
            '*'
          );
        }
      } else if (data.type === 'motionforge:frame') {
        if (state.playing && typeof data.atMs === 'number') {
          store.setPlayhead(data.atMs);
        }
      } else if ((data.type === 'layerBounds' || data.type === 'layerBoundsReport') && data.bounds) {
        store.setLayerBounds(data.bounds);
      }
    };

    window.addEventListener('message', onMessage);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen()) {
        setIsFullscreen(false);
      } else if (e.key.toLowerCase() === 'f' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        setIsFullscreen(!isFullscreen());
      }
    };
    window.addEventListener('keydown', onKeyDown);

    onCleanup(() => {
      cancelAnimationFrame(animId);
      if (rafSeekId) cancelAnimationFrame(rafSeekId);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKeyDown);
    });
  });

  const previewSrc = () => (state.sceneId ? api.previewUrl(state.sceneId) : '');

  const previewMeta = () => {
    if (!state.scene) return '—';
    return `${state.scene.canvas?.shape || '16:9'} (${state.scene.canvas?.scale || 1080}p) · ${state.scene.durationMs}ms · ${
      state.scene.layers?.length || 0
    }L`;
  };

  const durationLabel = () => {
    if (!state.scene) return '—';
    return `${state.scene.durationMs} ms total`;
  };

  return (
    <section class={`panel-center ${isFullscreen() ? 'fullscreen-mode' : ''}`} aria-label="Video Preview Canvas">
      <div class="preview-header">
        <div class="preview-header-left">
          <span class="preview-badge">PREVIEW</span>
          <span class="preview-meta" id="preview-meta">
            {previewMeta()}
          </span>
        </div>
        <button
          class="toolbar-btn"
          id="btn-fullscreen"
          data-tooltip="Fullscreen preview (F)"
          aria-label="Fullscreen preview"
          onClick={() => setIsFullscreen(!isFullscreen())}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
          </svg>
        </button>
      </div>

      <div
        ref={stageContainerRef}
        class={`preview-stage ${isFullscreen() ? 'preview-stage-fullscreen' : ''}`}
        id="preview-stage"
        tabindex="0"
      >
        <Show
          when={Boolean(state.scene && state.sceneId)}
          fallback={
            <div class="preview-empty" id="preview-empty">
              <svg viewBox="0 0 24 24" width="56" height="56">
                <path d="M4 4l16 0 0 16-16 0z M4 4l8 8 8-8 M12 12v8" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3" />
              </svg>
              <p>Load a scene to begin</p>
              <div class="preview-empty-actions">
                <button class="secondary-btn" id="btn-demo" onClick={props.onLoadDemo}>
                  Load Demo Scene
                </button>
                <button class="text-btn" id="btn-load-2" onClick={props.onOpenLoad}>
                  Or load by ID →
                </button>
              </div>
            </div>
          }
        >
          <div class="relative w-full h-full flex items-center justify-center overflow-hidden">
            <iframe
              ref={iframeRef}
              id="preview-iframe"
              class="preview-iframe"
              title="Scene preview runtime"
              sandbox="allow-scripts allow-same-origin"
              src={previewSrc()}
              onLoad={() => {
                if (state.scene && iframeRef?.contentWindow) {
                  iframeRef.contentWindow.postMessage(
                    {
                      type: 'motionforge:initScene',
                      scene: unwrapPayload(state.scene),
                      atMs: state.playhead,
                    },
                    '*'
                  );
                }
              }}
              style={{
                transform: `translate(${state.viewportPan.x}px, ${state.viewportPan.y}px) scale(${state.viewportZoom})`,
                'transform-origin': 'center center',
              }}
            />
            <CanvasOverlay
              containerRef={() => stageContainerRef}
              iframeRef={() => iframeRef}
            />
          </div>
        </Show>
      </div>

      {/* TRANSPORT BAR */}
      <div class="transport" role="toolbar" aria-label="Playback controls">
        <button
          class="transport-btn"
          id="btn-prev"
          data-tooltip="Previous frame (←)"
          aria-label="Step backwards"
          onClick={() => store.setPlayhead(state.playhead - 100)}
        >
          ⏮
        </button>
        <button
          class={`transport-btn play ${state.playing ? 'active' : ''}`}
          id="btn-play"
          data-tooltip="Play / Pause (Space)"
          aria-label="Play or pause"
          onClick={() => store.setPlaying(!state.playing)}
        >
          {state.playing ? '⏸' : '▶'}
        </button>
        <button
          class="transport-btn"
          id="btn-next"
          data-tooltip="Next frame (→)"
          aria-label="Step forward"
          onClick={() => store.setPlayhead(state.playhead + 100)}
        >
          ⏭
        </button>
        <div class="transport-sep"></div>
        <input
          type="number"
          class="frame-input"
          id="playhead-input"
          min="0"
          step="1"
          value={state.playhead}
          aria-label="Playhead millisecond"
          onInput={(e) => store.setPlayhead(Number(e.currentTarget.value))}
        />
        <span class="frame-unit">ms</span>
        <div class="transport-sep"></div>
        <span class="timecode" id="timecode" aria-label="Timecode">
          {fmtTime(state.playhead)}
        </span>
        <div class="transport-spacer"></div>
        <span class="duration-label" id="duration-label">
          {durationLabel()}
        </span>
      </div>
    </section>
  );
};
