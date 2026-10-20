import { Component, For, createMemo } from 'solid-js';
import { store } from '../../state/store.js';

/**
 * The stereo VU meter.
 *
 * A projection, not a WebAudio graph: the deterministic-rendering rule
 * forbids a `performance.now()`-driven animation path, and the meter is a UI
 * affordance. The level is derived from the audio cues that are live under
 * the playhead, so it is deterministic for a given playhead position.
 *
 * Scale: -60 dB … 0 dB, 20 segments per channel.
 */

const SEGMENTS = 20;
const DB_FLOOR = -60;

/** The rendered length of every built-in SFX cue, in milliseconds. */
const SFX_DURATIONS: Record<string, number> = {
  whoosh: 1200,
  riser: 3000,
  shimmer: 2200,
  pop: 500,
  subImpact: 1800,
  click: 300,
};

interface Cue {
  at: number;
  duration: number;
  gain: number;
}

/** The cues that are audible at a given playhead position. */
function activeCues(cues: Cue[], atMs: number): Cue[] {
  return cues.filter((cue) => atMs >= cue.at && atMs < cue.at + cue.duration);
}

/**
 * Convert a cue's gain into a dB level.
 *
 * A linear gain of 1.0 is 0 dB; 0.5 is about -6 dB. The envelope decays over
 * the cue so a trigger does not hold the meter open for its whole length.
 */
function cueLevelDb(cue: Cue, atMs: number): number {
  const elapsed = atMs - cue.at;
  const progress = Math.min(1, elapsed / Math.max(1, cue.duration));
  const envelope = 1 - progress * 0.7;
  const linear = Math.max(0.0001, (cue.gain ?? 1) * envelope);
  const db = 20 * Math.log10(linear);
  return Math.max(DB_FLOOR, Math.min(0, db));
}

export const AudioVuMeter: Component = () => {
  const state = store.state;

  const cues = createMemo<Cue[]>(() => {
    const list = state.scene?.audio?.cues ?? [];
    return list.map((cue) => ({
      at: cue.at,
      duration: SFX_DURATIONS[cue.sfx] ?? 1200,
      gain: cue.gain ?? 1,
    }));
  });

  const level = createMemo(() => {
    const live = activeCues(cues(), state.playhead);
    if (live.length === 0) return { left: DB_FLOOR, right: DB_FLOOR };
    const db = Math.max(...live.map((cue) => cueLevelDb(cue, state.playhead)));
    // the two channels are the same programme material; the right channel is
    // nudged so the stereo image reads as two independent meters
    return { left: db, right: Math.max(DB_FLOOR, db - 0.5) };
  });

  const litSegments = (db: number) => {
    const normalized = (db - DB_FLOOR) / (0 - DB_FLOOR);
    return Math.max(0, Math.min(SEGMENTS, Math.round(normalized * SEGMENTS)));
  };

  const segmentClass = (index: number, lit: number) => {
    if (index >= lit) return 'mf-vu-segment';
    // the top three segments are the "hot" range
    if (index >= SEGMENTS - 3) return 'mf-vu-segment is-lit is-clip';
    if (index >= SEGMENTS - 6) return 'mf-vu-segment is-lit is-hot';
    return 'mf-vu-segment is-lit';
  };

  const leftLit = () => litSegments(level().left);
  const rightLit = () => litSegments(level().right);

  return (
    <div class="mf-vu" id="audio-vu-meter" aria-label="Audio level meter">
      <span class="mf-vu-label">VU</span>
      <div class="mf-vu-bars">
        <div class="mf-vu-channel" title={`Left channel: ${level().left.toFixed(1)} dB`}>
          <For each={Array.from({ length: SEGMENTS }, (_, i) => i)}>
            {(i) => (
              <span
                class={segmentClass(SEGMENTS - 1 - i, leftLit())}
                style={{ height: '3px' }}
                data-lit={SEGMENTS - 1 - i < leftLit() ? '1' : '0'}
              />
            )}
          </For>
        </div>
        <div class="mf-vu-channel" title={`Right channel: ${level().right.toFixed(1)} dB`}>
          <For each={Array.from({ length: SEGMENTS }, (_, i) => i)}>
            {(i) => (
              <span
                class={segmentClass(SEGMENTS - 1 - i, rightLit())}
                style={{ height: '3px' }}
                data-lit={SEGMENTS - 1 - i < rightLit() ? '1' : '0'}
              />
            )}
          </For>
        </div>
      </div>
      <div class="mf-vu-scale">
        <span>0</span>
        <span>-6</span>
        <span>-18</span>
        <span>-60</span>
      </div>
    </div>
  );
};
