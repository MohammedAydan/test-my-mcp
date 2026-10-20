import { Component, For, Show, createSignal } from 'solid-js';
import { store } from '../../state/store.js';
import { formatFrameCount, formatTimecode } from '../../state/timecode.js';
import { loopPlayback, setLoopPlayback } from './transport-state.js';
import {
  IconGoToEnd,
  IconGoToStart,
  IconLoop,
  IconPause,
  IconPlay,
  IconShuttle,
  IconStepBack,
  IconStepForward,
} from '../icons/NleIcons.js';

/**
 * The SMPTE transport.
 *
 * The readout is the centre of gravity: a large, tabular-monospace timecode
 * plus a frame counter, exactly as a compositor expects to read it. Every
 * button is a real, wired transport action.
 */

export const TransportBar: Component = () => {
  const state = store.state;

  const fps = () => 30;
  const duration = () => state.scene?.durationMs ?? 0;

  const step = (frames: number) => {
    const frame = Math.round((1000 / fps()) * frames);
    store.setPlayhead(state.playhead + frame);
  };

  const goToStart = () => store.setPlayhead(0);
  const goToEnd = () => store.setPlayhead(duration());

  const shuttle = (direction: -1 | 1) => {
    if (direction === 1) {
      const rate = state.playing && state.playbackRate >= 1 ? (state.playbackRate === 1 ? 2 : state.playbackRate === 2 ? 4 : 1) : 1;
      store.setPlaybackRate(rate);
      store.setPlaying(true);
    } else {
      const rate = state.playing && state.playbackRate <= -1 ? (state.playbackRate === -1 ? -2 : state.playbackRate === -2 ? -4 : -1) : -1;
      store.setPlaybackRate(rate);
      store.setPlaying(true);
    }
  };

  /**
   * The loop is a REAL behaviour: the playback clock (the Program Monitor)
   * wraps at the out point when the loop is armed.
   */
  const looping = () => loopPlayback();

  return (
    <div class="mf-transport" role="toolbar" aria-label="Playback controls" id="transport-bar">
      <button
        class="mf-transport-btn"
        id="btn-go-start"
        title="Go to start (Home)"
        aria-label="Go to start"
        onClick={goToStart}
      >
        <IconGoToStart size={14} />
      </button>
      <button
        class="mf-transport-btn"
        id="btn-step-back"
        title="Step back one frame (←)"
        aria-label="Step back one frame"
        onClick={() => step(-1)}
      >
        <IconStepBack size={14} />
      </button>

      <button
        class={`mf-transport-btn is-play ${state.playing ? 'is-active' : ''}`}
        id="btn-play"
        title="Play / Pause (Space)"
        aria-label={state.playing ? 'Pause' : 'Play'}
        onClick={() => store.setPlaying(!state.playing)}
      >
        <Show when={state.playing} fallback={<IconPlay size={14} />}>
          <IconPause size={14} />
        </Show>
      </button>

      <button
        class="mf-transport-btn"
        id="btn-step-forward"
        title="Step forward one frame (→)"
        aria-label="Step forward one frame"
        onClick={() => step(1)}
      >
        <IconStepForward size={14} />
      </button>
      <button
        class="mf-transport-btn"
        id="btn-go-end"
        title="Go to end (End)"
        aria-label="Go to end"
        onClick={goToEnd}
      >
        <IconGoToEnd size={14} />
      </button>

      <div class="mf-transport-sep" />

      <button
        class={`mf-transport-btn ${looping() ? 'is-active' : ''}`}
        id="btn-loop"
        title="Loop playback"
        aria-label="Loop playback"
        aria-pressed={looping()}
        onClick={() => setLoopPlayback(!looping())}
      >
        <IconLoop size={14} />
      </button>
      <button
        class="mf-transport-btn"
        id="btn-shuttle-back"
        title="Shuttle reverse (J)"
        aria-label="Shuttle reverse"
        onClick={() => shuttle(-1)}
      >
        <IconShuttle size={14} style={{ transform: 'scaleX(-1)' }} />
      </button>
      <button
        class="mf-transport-btn"
        id="btn-shuttle-forward"
        title="Shuttle forward (L)"
        aria-label="Shuttle forward"
        onClick={() => shuttle(1)}
      >
        <IconShuttle size={14} />
      </button>

      <div class="mf-transport-spacer" style={{ flex: '1' }} />

      <Show when={state.inPoint !== null}>
        <span class="mf-frame-count" id="transport-in-point">
          IN {formatTimecode(state.inPoint ?? 0, fps())}
        </span>
      </Show>
      <Show when={state.outPoint !== null}>
        <span class="mf-frame-count" id="transport-out-point">
          OUT {formatTimecode(state.outPoint ?? 0, fps())}
        </span>
      </Show>

      <span class="mf-frame-count" id="transport-frame-count">
        {formatFrameCount(state.playhead, fps())}
      </span>
      <span class="mf-timecode is-lg" id="timecode" aria-label="Timecode">
        {formatTimecode(state.playhead, fps())}
      </span>
      <span class="mf-frame-count" id="transport-duration">
        / {formatTimecode(duration(), fps())}
      </span>

      <div class="mf-transport-sep" />

      <For each={[{ k: 'in', label: 'In' }, { k: 'out', label: 'Out' }]}>
        {(point) => (
          <button
            class="mf-transport-btn"
            id={`btn-mark-${point.k}`}
            title={point.k === 'in' ? 'Set In point (I)' : 'Set Out point (O)'}
            aria-label={point.k === 'in' ? 'Set In point' : 'Set Out point'}
            onClick={() =>
              point.k === 'in' ? store.setInPoint(state.playhead) : store.setOutPoint(state.playhead)
            }
          >
            <span class="mf-frame-count" style={{ 'font-size': '10px' }}>
              {point.label}
            </span>
          </button>
        )}
      </For>
    </div>
  );
};
