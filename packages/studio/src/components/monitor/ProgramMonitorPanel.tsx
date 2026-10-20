import { Component, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { store } from '../../state/store.js';
import { api, unwrapPayload } from '../../api.js';
import { CanvasOverlay } from './CanvasOverlay.js';
import { TransportBar } from './TransportBar.js';
import {
  IconCrosshair,
  IconFit,
  IconGridOverlay,
  IconGuides,
  IconZoomIn,
  IconZoomOut,
} from '../icons/NleIcons.js';

/**
 * The Program Monitor.
 *
 * The composition bar (zoom, safe guides, checkerboard) sits on top, the
 * `mf-runtime://` iframe in the middle, and the SMPTE transport at the bottom.
 *
 * The preview is driven entirely over `postMessage` — the runtime is a
 * deterministic, seekable canvas, so the monitor never asks it to "play on
 * its own"; it asks it to seek to a frame.
 */

type GuideMode = 'none' | 'action' | 'title' | 'crosshair';

export const ProgramMonitorPanel: Component = () => {
  const state = store.state;
  const [zoom, setZoom] = createSignal('fit');
  const [guide, setGuide] = createSignal<GuideMode>('none');
  const [checkerboard, setCheckerboard] = createSignal(false);

  let iframeRef: HTMLIFrameElement | undefined;
  let stageRef: HTMLDivElement | undefined;
  let pendingSeek: number | null = null;
  let rafId: number | null = null;

  const postSeek = (atMs: number) => {
    pendingSeek = atMs;
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (pendingSeek !== null && iframeRef?.contentWindow) {
        iframeRef.contentWindow.postMessage({ type: 'motionforge:seek', atMs: pendingSeek }, '*');
      }
    });
  };

  createEffect(() => {
    postSeek(state.playhead);
  });

  createEffect(() => {
    const playing = state.playing;
    if (!iframeRef?.contentWindow) return;
    iframeRef.contentWindow.postMessage({ type: playing ? 'motionforge:play' : 'motionforge:pause' }, '*');
  });

  createEffect(() => {
    const scene = state.scene;
    if (!scene || !iframeRef?.contentWindow) return;
    iframeRef.contentWindow.postMessage(
      { type: 'motionforge:updateScene', scene: unwrapPayload(scene), atMs: state.playhead },
      '*'
    );
  });

  onMount(() => {
    let lastTick = performance.now();
    let animId = 0;

    const tick = (now: number) => {
      if (state.playing && state.scene) {
        const delta = now - lastTick;
        const dur = state.scene.durationMs || 10000;
        const next = state.playhead + delta * Math.abs(state.playbackRate || 1);
        if (next >= dur) {
          store.setPlayhead(0);
          store.setPlaying(false);
        } else {
          store.setPlayhead(next);
        }
      }
      lastTick = now;
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'motionforge:ready' || data.type === 'motionforge:requestScene') {
        if (state.scene && iframeRef?.contentWindow) {
          iframeRef.contentWindow.postMessage(
            { type: 'motionforge:initScene', scene: unwrapPayload(state.scene), atMs: state.playhead },
            '*'
          );
        }
        iframeRef?.contentWindow?.postMessage({ type: 'getLayerBounds', frame: 0 }, '*');
      } else if (data.type === 'motionforge:frame') {
        if (state.playing && typeof data.atMs === 'number') store.setPlayhead(data.atMs);
      } else if ((data.type === 'layerBounds' || data.type === 'layerBoundsReport') && data.bounds) {
        store.setLayerBounds(data.bounds);
      }
    };

    window.addEventListener('message', onMessage);
    onCleanup(() => {
      cancelAnimationFrame(animId);
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('message', onMessage);
    });
  });

  const previewSrc = () => (state.sceneId ? api.previewUrl(state.sceneId) : '');

  const applyZoom = (value: string) => {
    setZoom(value);
    switch (value) {
      case 'fit':
        store.setViewportZoom(1);
        store.setViewportPan({ x: 0, y: 0 });
        break;
      case '0.5':
        store.setViewportZoom(0.5);
        break;
      case '1':
        store.setViewportZoom(1);
        break;
      case '1.5':
        store.setViewportZoom(1.5);
        break;
      case '2':
        store.setViewportZoom(2);
        break;
      default:
        break;
    }
  };

  const guideBox = () => {
    const mode = guide();
    if (mode === 'action') return { inset: '5%' };
    if (mode === 'title') return { inset: '10%' };
    return null;
  };

  return (
    <section class="mf-panel" data-panel="program-monitor" aria-label="Program monitor">
      <div class="mf-monitor-bar">
        <span class="mf-chip is-accent" id="monitor-scene-tab">
          {state.sceneId || 'No composition'}
        </span>

        <div style={{ flex: '1' }} />

        <select
          class="mf-select"
          id="monitor-zoom"
          style={{ width: '92px' }}
          aria-label="Monitor zoom"
          value={zoom()}
          onChange={(e) => applyZoom(e.currentTarget.value)}
        >
          <option value="fit">Fit</option>
          <option value="0.5">50%</option>
          <option value="1">100%</option>
          <option value="1.5">150%</option>
          <option value="2">200%</option>
        </select>

        <button
          class={`mf-btn is-icon ${guide() !== 'none' ? 'is-active' : ''}`}
          id="monitor-guides"
          title="Safe guides"
          aria-label="Safe guides"
          aria-pressed={guide() !== 'none'}
          onClick={() => setGuide(guide() === 'none' ? 'action' : guide() === 'action' ? 'title' : 'none')}
        >
          <IconGuides size={13} />
        </button>
        <button
          class={`mf-btn is-icon ${guide() === 'crosshair' ? 'is-active' : ''}`}
          id="monitor-crosshair"
          title="Center crosshair"
          aria-label="Center crosshair"
          aria-pressed={guide() === 'crosshair'}
          onClick={() => setGuide(guide() === 'crosshair' ? 'none' : 'crosshair')}
        >
          <IconCrosshair size={13} />
        </button>
        <button
          class={`mf-btn is-icon ${checkerboard() ? 'is-active' : ''}`}
          id="monitor-checkerboard"
          title="Checkerboard grid"
          aria-label="Checkerboard grid"
          aria-pressed={checkerboard()}
          onClick={() => setCheckerboard(!checkerboard())}
        >
          <IconGridOverlay size={13} />
        </button>
        <button
          class="mf-btn is-icon"
          id="monitor-zoom-out"
          title="Zoom out (Ctrl+Wheel)"
          aria-label="Zoom out"
          onClick={() => store.setViewportZoom(state.viewportZoom - 0.1)}
        >
          <IconZoomOut size={13} />
        </button>
        <button
          class="mf-btn is-icon"
          id="monitor-zoom-in"
          title="Zoom in (Ctrl+Wheel)"
          aria-label="Zoom in"
          onClick={() => store.setViewportZoom(state.viewportZoom + 0.1)}
        >
          <IconZoomIn size={13} />
        </button>
        <button
          class="mf-btn is-icon"
          id="monitor-fit"
          title="Fit to window (Ctrl+0)"
          aria-label="Fit to window"
          onClick={() => {
            store.setViewportZoom(1);
            store.setViewportPan({ x: 0, y: 0 });
          }}
        >
          <IconFit size={13} />
        </button>
      </div>

      <div
        ref={stageRef}
        class="mf-monitor-stage"
        id="preview-stage"
        tabindex="0"
        style={
          checkerboard()
            ? {
                'background-image':
                  'linear-gradient(45deg, #1a1d23 25%, transparent 25%), linear-gradient(-45deg, #1a1d23 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1d23 75%), linear-gradient(-45deg, transparent 75%, #1a1d23 75%)',
                'background-size': '16px 16px',
                'background-position': '0 0, 0 8px, 8px -8px, -8px 0',
              }
            : undefined
        }
      >
        <Show
          when={Boolean(state.scene && state.sceneId)}
          fallback={
            <div class="mf-empty" id="preview-empty">
              <IconCompositionFallback />
              <div class="mf-empty-title">No composition loaded</div>
              <div class="mf-empty-hint">
                Create a composition in the Project Bin to start authoring.
              </div>
            </div>
          }
        >
          <div class="mf-monitor-frame">
            <iframe
              ref={iframeRef}
              id="preview-iframe"
              class="mf-monitor-iframe"
              title="Scene preview runtime"
              sandbox="allow-scripts allow-same-origin"
              src={previewSrc()}
              onLoad={() => {
                if (state.scene && iframeRef?.contentWindow) {
                  iframeRef.contentWindow.postMessage(
                    { type: 'motionforge:initScene', scene: unwrapPayload(state.scene), atMs: state.playhead },
                    '*'
                  );
                }
              }}
              style={{
                transform: `translate(${state.viewportPan.x}px, ${state.viewportPan.y}px) scale(${state.viewportZoom})`,
                'transform-origin': 'center center',
              }}
            />
            <CanvasOverlay containerRef={() => stageRef} iframeRef={() => iframeRef} />

            <Show when={guideBox()}>
              {(box) => (
                <div
                  class={`mf-safe-guide ${guide() === 'title' ? 'is-title' : ''}`}
                  style={{ inset: box().inset }}
                />
              )}
            </Show>
            <Show when={guide() === 'crosshair'}>
              <div class="mf-crosshair" style={{ left: '50%', top: 0, width: '1px', height: '100%' }} />
              <div class="mf-crosshair" style={{ top: '50%', left: 0, height: '1px', width: '100%' }} />
            </Show>
          </div>
        </Show>
      </div>

      <TransportBar />
    </section>
  );
};

/** The empty-state glyph (a composition frame). */
function IconCompositionFallback() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="26"
      height="26"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
      <path d="M3 9h18" />
      <path d="M9 4.5v15" />
    </svg>
  );
}
