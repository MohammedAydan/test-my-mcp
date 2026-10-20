import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js';
import { store } from '../../state/store.js';
import { api, unwrapPayload } from '../../api.js';
import { CanvasOverlay } from './CanvasOverlay.js';
import { TransportBar } from './TransportBar.js';
import { clampZoom, fitScaleFor, resolveCompositionSize, roundZoom } from './geometry.js';
import { loopPlayback } from './transport-state.js';
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
 * THE FIT: the composition is NOT a small rectangle in a black void. The
 * panel measures itself with a `ResizeObserver`, the composition is scaled
 * to fill it (preserving the aspect ratio) and the result is a REAL element —
 * `#monitor-stage` — that the runtime iframe fills exactly. The gizmo reads
 * that element's box, so the overlay and the preview can never drift apart.
 *
 * The preview is driven entirely over `postMessage` — the runtime is a
 * deterministic, seekable canvas, so the monitor never asks it to "play on
 * its own"; it asks it to seek to a frame.
 */

type GuideMode = 'none' | 'action' | 'title' | 'crosshair';

/** The explicit zoom levels of the selector (an ABSOLUTE scale). */
const ZOOM_PRESETS = ['0.5', '1', '1.5', '2'] as const;

const CHECKERBOARD =
  'linear-gradient(45deg, #1a1d23 25%, transparent 25%), linear-gradient(-45deg, #1a1d23 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1d23 75%), linear-gradient(-45deg, transparent 75%, #1a1d23 75%)';

export const ProgramMonitorPanel: Component = () => {
  const state = store.state;

  const [guide, setGuide] = createSignal<GuideMode>('none');
  const [checkerboard, setCheckerboard] = createSignal(false);
  /** true → the composition is scaled to fill the panel */
  const [fitMode, setFitMode] = createSignal(true);
  /** the explicit zoom level (an absolute scale: 1 = 100% of the design pixels) */
  const [absoluteZoom, setAbsoluteZoom] = createSignal(1);
  /** the measured size of the monitor viewport */
  const [viewportBox, setViewportBox] = createSignal({ width: 0, height: 0 });

  let viewportRef: HTMLDivElement | undefined;
  let stageRef: HTMLDivElement | undefined;
  let iframeRef: HTMLIFrameElement | undefined;
  let pendingSeek: number | null = null;
  let rafId: number | null = null;
  /** the last value this panel wrote into `store.viewportZoom` */
  let mirroredZoom = state.viewportZoom;

  const composition = createMemo(() => resolveCompositionSize(state.scene?.canvas));

  /** the scale that makes the composition fill the panel */
  const fitScale = createMemo(() => {
    const box = viewportBox();
    const comp = composition();
    return fitScaleFor(box.width, box.height, comp.width, comp.height);
  });

  /** the scale the composition is actually rendered at */
  const stageScale = createMemo(() => (fitMode() ? fitScale() : absoluteZoom()));

  /** the size of the stage wrapper, in screen px */
  const stageSize = createMemo(() => {
    const comp = composition();
    const scale = stageScale();
    return {
      width: Math.max(1, Math.round(comp.width * scale)),
      height: Math.max(1, Math.round(comp.height * scale)),
    };
  });

  /**
   * The composition wrapper's box, in viewport-local px.
   *
   * The wrapper is CENTRED in the panel and offset by the pan, so the overlay
   * can map the composition onto the screen without measuring the DOM.
   */
  const stageBox = createMemo(() => {
    const box = viewportBox();
    const size = stageSize();
    return {
      left: (box.width - size.width) / 2 + state.viewportPan.x,
      top: (box.height - size.height) / 2 + state.viewportPan.y,
      width: size.width,
      height: size.height,
    };
  });

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

  /**
   * Push the scene into the runtime.
   *
   * The body is UNTRACKED on purpose. The scene is a reactive proxy, so
   * reading it inside the effect would subscribe to every leaf — and the
   * in-place `patchLayer` of a 60fps drag would then re-push the whole scene
   * on every pointer move (a full runtime remount per frame).
   *
   * Tracking only `state.scene` means the push happens when the scene OBJECT
   * is replaced (a committed edit), not when a leaf is written.
   */
  createEffect(() => {
    const scene = state.scene;
    if (!scene) return;
    untrack(() => {
      const win = iframeRef?.contentWindow;
      if (!win) return;
      win.postMessage(
        { type: 'motionforge:updateScene', scene: unwrapPayload(scene), atMs: state.playhead },
        '*'
      );
    });
  });

  /**
   * Mirror the effective zoom into the store.
   *
   * `state.viewportZoom` is the ABSOLUTE scale (1 = the composition's design
   * pixels, one screen pixel each). An external write is adopted as an
   * explicit zoom level — EXCEPT when the monitor is already fitting, where
   * the value `1` simply means "keep fitting".
   *
   * The command registry asks for a fit with the `motionforge:fit-canvas`
   * event, because "fit" is a MODE, not a number.
   */
  createEffect(() => {
    const scale = stageScale();
    const mirrored = Math.max(0.25, Math.min(4, scale));
    const current = state.viewportZoom;

    if (Math.abs(current - mirroredZoom) > 0.0001) {
      // an EXTERNAL change — adopt it
      mirroredZoom = current;
      const keepFitting = fitMode() && Math.abs(current - 1) < 0.0001;
      if (!keepFitting) {
        setFitMode(false);
        setAbsoluteZoom(clampZoom(current, 0.25, 4));
      }
      return;
    }

    if (Math.abs(current - mirrored) > 0.0001) {
      mirroredZoom = mirrored;
      store.setViewportZoom(mirrored);
    }
  });

  onMount(() => {
    let lastTick = performance.now();
    let animId = 0;

    /**
     * "Fit" is a MODE, so the command registry asks for it with an event.
     * (The store's `viewportZoom` is a NUMBER — it cannot express "fit".)
     */
    const onFitCanvas = () => {
      setFitMode(true);
      store.setViewportPan({ x: 0, y: 0 });
    };
    window.addEventListener('motionforge:fit-canvas', onFitCanvas);
    onCleanup(() => window.removeEventListener('motionforge:fit-canvas', onFitCanvas));

    const tick = (now: number) => {
      if (state.playing && state.scene) {
        const delta = now - lastTick;
        const dur = state.scene.durationMs || 10000;
        const rate = state.playbackRate || 1;
        const next = state.playhead + delta * rate;
        const out = state.outPoint ?? dur;
        // the loop is armed by the transport; the clock owns the behaviour
        const finished = rate >= 0 ? next >= out : next <= 0;
        if (finished) {
          if (loopPlayback()) {
            store.setPlayhead(rate >= 0 ? (state.inPoint ?? 0) : out);
            store.setPlaying(true);
          } else {
            store.setPlayhead(rate >= 0 ? out : 0);
            store.setPlaying(false);
          }
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

  /**
   * The monitor's own measurement.
   *
   * The splitters drag, the panel is maximised, the window is resized — every
   * one of those changes the panel's size, and the composition has to follow.
   */
  onMount(() => {
    const element = viewportRef;
    if (!element) return;
    const measure = () => {
      setViewportBox({ width: element.clientWidth, height: element.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });

  const previewSrc = () => (state.sceneId ? api.previewUrl(state.sceneId) : '');

  const applyZoom = (value: string) => {
    if (value === 'fit') {
      setFitMode(true);
      store.setViewportPan({ x: 0, y: 0 });
      return;
    }
    const zoom = Number(value);
    if (!Number.isFinite(zoom) || zoom <= 0) return;
    setFitMode(false);
    setAbsoluteZoom(clampZoom(zoom, 0.25, 4));
  };

  const nudgeZoom = (delta: number) => {
    const current = fitMode() ? fitScale() : absoluteZoom();
    setFitMode(false);
    setAbsoluteZoom(clampZoom(current + delta, 0.25, 4));
  };

  const zoomToFit = () => {
    setFitMode(true);
    store.setViewportPan({ x: 0, y: 0 });
  };

  const handleOverlayZoom = (value: number | 'fit') => {
    if (value === 'fit') {
      zoomToFit();
      return;
    }
    setFitMode(false);
    setAbsoluteZoom(clampZoom(value, 0.25, 4));
  };

  const zoomOptions = createMemo(() => {
    const presets = ['fit', ...ZOOM_PRESETS];
    if (fitMode()) return presets;
    const current = String(roundZoom(absoluteZoom()));
    return presets.includes(current) ? presets : [...presets, current];
  });

  const zoomValue = () => (fitMode() ? 'fit' : String(roundZoom(absoluteZoom())));

  const zoomLabel = (option: string) =>
    option === 'fit' ? 'Fit' : `${Math.round(Number(option) * 100)}%`;

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
          value={zoomValue()}
          onChange={(e) => applyZoom(e.currentTarget.value)}
        >
          <For each={zoomOptions()}>
            {(option) => <option value={option}>{zoomLabel(option)}</option>}
          </For>
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
          onClick={() => nudgeZoom(-0.1)}
        >
          <IconZoomOut size={13} />
        </button>
        <button
          class="mf-btn is-icon"
          id="monitor-zoom-in"
          title="Zoom in (Ctrl+Wheel)"
          aria-label="Zoom in"
          onClick={() => nudgeZoom(0.1)}
        >
          <IconZoomIn size={13} />
        </button>
        <button
          class="mf-btn is-icon"
          id="monitor-fit"
          title="Fit to window (Ctrl+0)"
          aria-label="Fit to window"
          onClick={zoomToFit}
        >
          <IconFit size={13} />
        </button>
      </div>

      <div
        ref={viewportRef}
        class="mf-monitor-stage"
        id="monitor-viewport"
        tabindex="0"
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
          <div class="mf-monitor-frame" id="preview-stage">
            <div
              ref={stageRef}
              class="mf-monitor-canvas"
              id="monitor-stage"
              data-scale={stageScale()}
              data-zoom={zoomValue()}
              style={{
                position: 'relative',
                flex: 'none',
                width: `${stageSize().width}px`,
                height: `${stageSize().height}px`,
                transform: `translate(${state.viewportPan.x}px, ${state.viewportPan.y}px)`,
                'transform-origin': 'center center',
                overflow: 'hidden',
                background: checkerboard() ? undefined : '#000',
                ...(checkerboard()
                  ? {
                      'background-image': CHECKERBOARD,
                      'background-size': '16px 16px',
                      'background-position': '0 0, 0 8px, 8px -8px, -8px 0',
                    }
                  : {}),
              }}
            >
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
                  position: 'absolute',
                  inset: '0',
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  display: 'block',
                  background: 'transparent',
                }}
              />

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
          </div>

          <CanvasOverlay
            viewportRef={() => viewportRef}
            stageBox={stageBox}
            iframeRef={() => iframeRef}
            onZoom={handleOverlayZoom}
          />
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
