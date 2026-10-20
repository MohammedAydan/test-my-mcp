import { createSignal } from 'solid-js';

/**
 * The transport's playback flags.
 *
 * The transport owns the buttons; the playback clock owns the behaviour. The
 * two live in different components, so the ONE piece of state they share
 * lives here — a tiny module-level signal, not a store field (the store is
 * the scene's state, not the transport's).
 */

/** true → playback wraps at the out point instead of stopping */
export const [loopPlayback, setLoopPlayback] = createSignal(false);
