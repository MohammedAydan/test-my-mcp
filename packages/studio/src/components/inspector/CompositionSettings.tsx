import { Component, Show, createMemo } from 'solid-js';
import { store } from '../../state/store.js';
import { layerLayoutSize } from '../../types.js';
import { resolveCompositionSize } from '../monitor/geometry.js';
import { IconFit, IconWarning } from '../icons/NleIcons.js';
import { ScrubInput } from './ScrubInput.js';

/**
 * The COMPOSITION settings.
 *
 * It carries the canvas (shape + scale), the duration, the camera move — and
 * the two things a compositor checks FIRST when something looks wrong:
 *
 *  - the ASPECT RATIO SYNC indicator, which says whether the selected
 *    layer's box matches the composition's shape (`16:9 · 1920×1080`), and
 *  - the "FIT CANVAS TO VIEWPORT" quick action, which asks the Program
 *    Monitor to scale the composition to its panel again.
 *
 * It is rendered in BOTH inspector modes (with and without a selected
 * layer), because the aspect indicator is only meaningful next to a
 * selection.
 */

/** The shape of a layer's box, as a ratio. */
const ratioLabel = (width: number, height: number): string => {
  if (!(width > 0) || !(height > 0)) return '—';
  const ratio = width / height;
  const known: Array<[string, number]> = [
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['1:1', 1],
    ['4:5', 4 / 5],
  ];
  for (const [label, value] of known) {
    if (Math.abs(ratio - value) <= 0.02 * value) return label;
  }
  return `${ratio.toFixed(2)}:1`;
};

export const CompositionSettings: Component = () => {
  const state = store.state;

  /** the composition's pixel size. */
  const canvasSize = createMemo(() => resolveCompositionSize(state.scene?.canvas));

  /** the canvas shape and scale, as one label. */
  const canvasLabel = createMemo(() => {
    const shape = state.scene?.canvas?.shape ?? '16:9';
    const size = canvasSize();
    return `${shape} · ${size.width}×${size.height}`;
  });

  /** the SELECTED layer's box, in composition pixels. */
  const layerBox = createMemo(() => {
    const id = state.selectedLayerId;
    if (!id || !state.scene) return null;
    const bounds = state.layerBounds[id];
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      return { width: bounds.width, height: bounds.height, label: 'reported' };
    }
    const layer = state.scene.layers.find((l) => l.id === id);
    if (!layer) return null;
    // fall back to the layer's own layout box
    const layout = layerLayoutSize(layer);
    const widthPct = layout?.widthPct;
    const heightPct = layout?.heightPct;
    const size = canvasSize();
    if (typeof widthPct === 'number' && typeof heightPct === 'number') {
      return {
        width: (widthPct / 100) * size.width,
        height: (heightPct / 100) * size.height,
        label: 'authored',
      };
    }
    return null;
  });

  /** whether the selected layer's box matches the composition's shape. */
  const aspectSync = createMemo<'match' | 'differs' | 'unknown'>(() => {
    const box = layerBox();
    if (!box) return 'unknown';
    const comp = canvasSize();
    if (!(comp.width > 0) || !(comp.height > 0)) return 'unknown';
    const layerRatio = box.width / box.height;
    const compRatio = comp.width / comp.height;
    return Math.abs(layerRatio - compRatio) <= 0.03 * compRatio ? 'match' : 'differs';
  });

  const compositionPatch = (field: Record<string, unknown>, description: string) => {
    store.mutateScene((scene) => {
      Object.assign(scene, field);
    }, description);
  };

  /** ask the Program Monitor to fit the composition into its panel. */
  const fitCanvasToViewport = () => {
    window.dispatchEvent(new CustomEvent('motionforge:fit-canvas'));
    store.setViewportPan({ x: 0, y: 0 });
    store.addToast('Canvas fitted to the viewport', 'info');
  };

  return (
    <div class="mf-composition-settings" id="composition-settings-body">
      <div class="mf-field">
        <label class="mf-label">Name</label>
        <input
          class="mf-input"
          value={state.scene?.name ?? ''}
          onChange={(e) => compositionPatch({ name: e.currentTarget.value }, 'Rename composition')}
        />
      </div>

      <div class="mf-grid-2">
        <div class="mf-field">
          <label class="mf-label">Shape</label>
          <select
            class="mf-select"
            value={state.scene?.canvas?.shape ?? '16:9'}
            onChange={(e) =>
              compositionPatch(
                {
                  canvas: {
                    ...(state.scene?.canvas ?? { shape: '16:9', scale: 1080 }),
                    shape: e.currentTarget.value,
                  },
                },
                'Change canvas shape'
              )
            }
          >
            <option value="16:9">16:9 Landscape</option>
            <option value="9:16">9:16 Vertical</option>
            <option value="1:1">1:1 Square</option>
            <option value="4:5">4:5 Portrait</option>
          </select>
        </div>
        <div class="mf-field">
          <label class="mf-label">Scale</label>
          <select
            class="mf-select"
            value={String(state.scene?.canvas?.scale ?? 1080)}
            onChange={(e) =>
              compositionPatch(
                {
                  canvas: {
                    ...(state.scene?.canvas ?? { shape: '16:9', scale: 1080 }),
                    scale: Number(e.currentTarget.value),
                  },
                },
                'Change canvas scale'
              )
            }
          >
            <option value="720">720p</option>
            <option value="1080">1080p</option>
            <option value="1440">1440p</option>
            <option value="2160">2160p</option>
          </select>
        </div>
      </div>

      {/* ── the aspect-ratio sync indicator ── */}
      <div class="mf-field">
        <label class="mf-label">Canvas</label>
        <div
          class="mf-aspect-sync"
          id="inspector-aspect-sync"
          data-aspect={aspectSync()}
          data-canvas={canvasLabel()}
        >
          <span class="mf-aspect-sync-value" id="inspector-aspect-label">
            {canvasLabel()}
          </span>
          <Show
            when={aspectSync() !== 'unknown'}
            fallback={<span class="mf-chip">No layer selected</span>}
          >
            <span
              class={`mf-chip ${aspectSync() === 'match' ? 'is-success' : 'is-warning'}`}
              id="inspector-aspect-state"
            >
              <Show when={aspectSync() === 'differs'}>
                <IconWarning size={10} style={{ 'vertical-align': '-1px' }} />
              </Show>
              {aspectSync() === 'match'
                ? 'Layer box matches'
                : `Layer box ${ratioLabel(layerBox()?.width ?? 0, layerBox()?.height ?? 0)}`}
            </span>
          </Show>
        </div>
      </div>

      <div class="mf-grid-2">
        <div class="mf-field">
          <label class="mf-label">Duration</label>
          <ScrubInput
            label="Dur"
            unit="ms"
            value={state.scene?.durationMs ?? 8000}
            min={300}
            max={600000}
            step={100}
            onScrubStart={() => store.pushHistory('Scrub composition duration')}
            onChange={(val) =>
              // the live value is written WITHOUT history, so a drag does not
              // flood the undo stack — ONE entry per gesture
              store.updateSceneWithoutHistory((scene) => {
                scene.durationMs = Math.round(val);
              })
            }
            onCommit={(val) => {
              store.mutateScene((scene) => {
                scene.durationMs = Math.round(val);
              }, 'Set composition duration');
              void store.executeSave().catch(() => undefined);
            }}
          />
        </div>
        <div class="mf-field">
          <label class="mf-label">Frame Rate</label>
          <select class="mf-select" value="30" disabled>
            <option value="24">24 fps</option>
            <option value="30">30 fps</option>
            <option value="60">60 fps</option>
          </select>
        </div>
      </div>

      <div class="mf-field">
        <label class="mf-label">Camera Motion</label>
        <select
          class="mf-select"
          value={state.scene?.camera?.moves?.[0]?.move ?? 'static'}
          onChange={(e) =>
            compositionPatch(
              {
                camera: {
                  perspective: state.scene?.camera?.perspective ?? 1200,
                  keyframes: state.scene?.camera?.keyframes ?? [],
                  moves:
                    e.currentTarget.value === 'static'
                      ? []
                      : [
                          {
                            move: e.currentTarget.value as never,
                            at: 0,
                            durationMs: state.scene?.durationMs ?? 8000,
                          },
                        ],
                },
              },
              'Change camera motion'
            )
          }
        >
          <option value="static">Static</option>
          <option value="slowPushIn">Slow Push In</option>
          <option value="whipPanRight">Whip Pan Right</option>
          <option value="whipPanLeft">Whip Pan Left</option>
          <option value="shakeImpact">Shake Impact</option>
          <option value="focusTarget">Focus Target</option>
        </select>
      </div>

      {/* ── the quick action ── */}
      <div class="mf-field">
        <label class="mf-label">Viewport</label>
        <button
          type="button"
          class="mf-btn"
          id="inspector-fit-canvas"
          title="Scale the composition to fill the Program Monitor (Ctrl+0)"
          onClick={fitCanvasToViewport}
        >
          <IconFit size={12} />
          <span>Fit Canvas to Viewport</span>
        </button>
      </div>
    </div>
  );
};
