/**
 * Act seams: the contract that keeps a cut from ever showing an empty stage.
 *
 * THE DEFECT THIS FIXES: layer windows were authored independently of the
 * transitions that cut between them. An outgoing act finished its 220 ms
 * auto-exit at 7800 ms, a transition did not begin covering the frame until
 * 8000 ms, and the incoming act did not appear until 8700 ms — so 500 ms+
 * rendered as a blank dark screen. Nothing warned about it, because every
 * individual number was legal.
 *
 * The rule is a single sentence: **a seam is covered from both sides.**
 *
 *   - an outgoing act is HELD until the transition's midpoint, so the frame is
 *     never empty on the way out (its own exit is suppressed — the transition
 *     is doing the hiding now);
 *   - an incoming act STARTS at the transition's midpoint, so the frame is
 *     never empty on the way in and the new act is already animating under the
 *     cover as it retracts.
 *
 * Both sides meet at `T.at + T.duration / 2`, which is the one instant a
 * transition is guaranteed to be at full extent. Everything here is pure
 * arithmetic over the SceneSpec so the runtime, the validator and the tests all
 * agree by construction.
 *
 * Lives in `scene-spec` rather than the runtime because it is a CONTRACT, not a
 * rendering detail: `core-engine` warns on it, `scene-runtime` bridges with it,
 * and neither may depend on the other.
 */
import type { SceneSpec, Transition, TransitionKind } from "./scene.js";

/** How far BEFORE a transition an outgoing act may end and still be bridged. */
export const SEAM_LOOKBEHIND_MS = 300;

/** How far AFTER a transition ends an incoming act may start and still be bridged. */
export const SEAM_LOOKAHEAD_MS = 300;

/**
 * How far into a transition's window an incoming act is pulled back to.
 *
 * THE DEFECT THIS FIXES (field audit of `scene-01`, 00:08.250): the incoming act
 * started at the transition's midpoint, i.e. exactly when the curtain began to
 * retract — so for a frame the stage was empty and the new act was still at
 * opacity 0. Pulling it back to 42% puts its entrance *under the cover*, so as
 * the curtain uncovers the stage during `50% → 100%` the act is already there,
 * being revealed rather than appearing.
 *
 * 42% is not arbitrary: for a 600 ms transition the cover is at full extent from
 * `inEnd` (≈0.417) to `outStart` (≈0.583), so 42% lands the start just inside
 * the fully-covered plateau. `earliestCoveredStartMs` clamps to `inEnd` so a
 * longer transition — whose plateau starts later — is never exposed early.
 */
export const SEAM_INCOMING_FRACTION = 0.42;

/**
 * The longest run of screen time allowed with no visible foreground content.
 *
 * A production cut may hide the stage for at most the transition's own peak
 * cover (`PEAK_COVER_MAX_MS`); anything longer reads as a dead frame rather
 * than as a transition.
 */
export const MAX_DEAD_GAP_MS = 200;

/**
 * How close to the scene end a layer must finish to count as the closing frame.
 *
 * THE DEFECT THIS FIXES: a closing headline ending at 11750 ms in a 12000 ms
 * scene was force-hidden by the lifecycle at 11750 ms — and the auto-exit fade
 * started even earlier — so the last 250 ms of the MP4 was blank. A layer that
 * ends within this band of the scene end, and declares no exit of its own, is
 * held to the final frame instead: the closing brand frame stays rock-solid.
 */
export const FINAL_ACT_HOLD_MS = 500;

/**
 * True when a layer's own window ends close enough to the scene end that it IS
 * the closing frame.
 *
 * Such a layer is extended to `sceneDurationMs` by `layerWindow`, and its
 * auto-exit is suppressed by the runtime — see `needsAutoExit`.
 */
export function isFinalActHold(
  layer: { at: number; duration?: number; exit?: unknown },
  sceneDurationMs: number
): boolean {
  if (layer.exit) return false;
  if (layer.duration === undefined) return false;
  const endMs = layer.at + layer.duration;
  return endMs >= sceneDurationMs - FINAL_ACT_HOLD_MS && endMs < sceneDurationMs;
}

/**
 * The zoom budget a `focusTarget` is allowed to spend.
 *
 * MUST stay in step with `scene-runtime`'s `FOCUS_SCALE_DELTA`: a focus is a
 * bounded nudge (max +0.14× on the current zoom), never the zoom the target
 * mathematically needs. Solving for the latter centred a logo 16% above the
 * canvas middle at 1.47× and threw the headline 35% below it off the bottom of
 * the frame.
 */
export const FOCUS_SCALE_DELTA = 0.14;

/**
 * The fraction of the safe pan headroom a `focusTarget` may spend. Full headroom
 * centres the target but leaves nothing on either side; 80% keeps the layer's
 * neighbours comfortably inside the frame, which is the point of a focus.
 */
export const FOCUS_PAN_HEADROOM_FRACTION = 0.8;

/** The highest zoom a `focusTarget` may reach on its own. */
export const FOCUS_MAX_SCALE = 3;

/**
 * The zoom a `focusTarget` would need to centre a point `d` percent from the
 * canvas centre: `|d| ≤ 50(1 − 1/S)` ⟹  `S ≥ 1 / (1 − |d|/50)`.
 *
 * A runtime `focusTarget` deliberately does NOT use it (see the runtime's
 * `FOCUS_SCALE_DELTA`) — this exists for the diagnostic that wants to quote
 * "the zoom this target would have needed", and for the engine's warnings.
 */
export function requiredFocusScale(offsetPct: number): number {
  const d = Math.min(49.999, Math.abs(offsetPct));
  return Math.min(FOCUS_MAX_SCALE, 1 / (1 - d / 50));
}

/** The ceiling on a transition's fully-opaque cover around its midpoint. */
export const PEAK_COVER_MAX_MS = 120;

/** The target cover width — short enough to read as a flash, not a hold. */
export const PEAK_COVER_TARGET_MS = 100;

/** The peak actually held, in ms — the target, but never past the ceiling. */
export const PEAK_HOLD_MS = Math.min(PEAK_COVER_TARGET_MS, PEAK_COVER_MAX_MS);

/**
 * Layer types that count as "content on screen".
 *
 * A `background` is always painted and a `foregroundFX` is a grade over
 * whatever is beneath it, so neither can fill a frame on its own — neither
 * closes a coverage gap. A `particleField` is decorative in the same way: a
 * field of dots is not an act.
 *
 * `chart`, `codeBlock` and `cta` ARE content: they carry the message of an
 * act, exactly like a `card` does.
 */
export const FOREGROUND_LAYER_TYPES = [
  "kineticText",
  "imageLogo",
  "card",
  "lottie",
  "chart",
  "codeBlock",
  "cta",
  "deviceMockup",
] as const;
export type ForegroundLayerType = (typeof FOREGROUND_LAYER_TYPES)[number];

export function isForegroundContent(layer: SceneSpec["layers"][number]): boolean {
  return (FOREGROUND_LAYER_TYPES as readonly string[]).includes(layer.type);
}

export interface ActWindow {
  startMs: number;
  /** exclusive */
  endMs: number;
}

/**
 * A layer's own on-screen window, before any seam bridging.
 *
 * A layer with no `duration` runs to the end of the scene; one with a duration
 * is bounded, and therefore a candidate for bridging at both ends.
 */
export function layerWindow(layer: SceneSpec["layers"][number], sceneDurationMs: number): ActWindow {
  const rawEnd = layer.duration === undefined ? sceneDurationMs : layer.at + layer.duration;
  // a closing layer is held to the final frame, never faded out mid-credits
  const endMs = isFinalActHold(layer, sceneDurationMs) ? sceneDurationMs : rawEnd;
  return { startMs: layer.at, endMs: Math.min(Math.max(endMs, layer.at), sceneDurationMs) };
}

/** Whether a layer's AUTHORED window is bounded (i.e. it can leave the screen at all).
 *
 * Uses the authored end, not the bridged/extended end — a closing layer that is
 * held to the scene end still has an authored end and MUST be bridged on its
 * start side so it appears under the cover.
 */
export function isBoundedLayer(layer: SceneSpec["layers"][number], sceneDurationMs: number): boolean {
  const rawEnd = layer.duration === undefined ? sceneDurationMs : layer.at + layer.duration;
  return rawEnd < sceneDurationMs;
}

export interface Seam {
  index: number;
  kind: Transition["kind"];
  at: number;
  durationMs: number;
  /** the one instant the cover is at full extent: `T.at + T.duration / 2` */
  midMs: number;
}

export function sceneSeams(scene: SceneSpec): Seam[] {
  return (scene.transitions ?? []).map((t, index) => ({
    index,
    kind: t.kind,
    at: t.at,
    durationMs: t.durationMs,
    midMs: t.at + t.durationMs / 2,
  }));
}

/**
 * The earliest instant a transition is at FULL extent, in ms from the scene
 * start — the first safe moment to reveal an incoming act underneath it.
 *
 * `transitionPeakWindow` reports the fully-covered plateau in normalized
 * progress; scaling by the window length gives the wall-clock instant. The
 * result is clamped up to {@link SEAM_INCOMING_FRACTION}: a transition whose
 * plateau starts later (a long one) must not expose the incoming act early, and
 * a short one should still pull it in on the authored schedule.
 */
export function earliestCoveredStartMs(seam: Seam): number {
  const { inEnd } = transitionPeakWindow(seam.kind, seam.durationMs);
  return seam.at + Math.max(SEAM_INCOMING_FRACTION, inEnd) * seam.durationMs;
}

export type SeamBridgeMode = "holdOutgoing" | "startIncoming";

export interface SeamBridge {
  layerId: string;
  /** the window the runtime must use instead of the authored one */
  startMs: number;
  endMs: number;
  seamMidMs: number;
  seamIndex: number;
  mode: SeamBridgeMode;
}

/**
 * Pin every bounded layer to the transition it belongs to.
 *
 * An outgoing layer ending inside `[T.at − 300, T_mid]` is held to `T_mid`; an
 * incoming layer starting inside `[T.at, T.at + T.duration + 300]` is pulled
 * back to `T_mid`. Both windows are only ever *widened* — a layer is never
 * hidden earlier or shown later than the author asked for — so bridging can
 * add airtime but can never drop content.
 *
 * A layer is usually on ONE side of ONE seam, but an act can straddle two of
 * them: pulled in early for the cut it follows and held past its end for the
 * cut it precedes. Both are then bridged, onto whichever seam governs each end.
 */
export function planSeamBridges(scene: SceneSpec): SeamBridge[] {
  const bridges = new Map<string, SeamBridge>();

  for (const seam of sceneSeams(scene)) {
    for (const layer of scene.layers) {
      if (!isBoundedLayer(layer, scene.durationMs)) continue;
      const w = layerWindow(layer, scene.durationMs);

      // outgoing: this act ends near the cut → hold it to the midpoint
      const holdEnd = w.endMs >= seam.at - SEAM_LOOKBEHIND_MS && w.endMs <= seam.midMs;
      // incoming: this act begins near the cut → start it UNDER THE COVER, at
      // 42% of the transition window (see SEAM_INCOMING_FRACTION). The END is
      // preserved: the author chose how long the act lives, and an outro must
      // still be on screen when the scene ends.
      const startEarly =
        w.startMs >= seam.at && w.startMs <= seam.at + seam.durationMs + SEAM_LOOKAHEAD_MS;
      if (!holdEnd && !startEarly) continue;

      const existing = bridges.get(layer.id);
      const startMs = startEarly
        ? Math.min(existing?.startMs ?? w.startMs, earliestCoveredStartMs(seam))
        : existing?.startMs ?? w.startMs;
      const endMs = holdEnd ? Math.max(existing?.endMs ?? w.endMs, seam.midMs) : existing?.endMs ?? w.endMs;
      bridges.set(layer.id, {
        layerId: layer.id,
        startMs,
        endMs,
        seamMidMs: seam.midMs,
        seamIndex: seam.index,
        mode: holdEnd ? "holdOutgoing" : "startIncoming",
      });
    }
  }

  return [...bridges.values()].sort((a, b) => a.startMs - b.startMs);
}

/** The bridged window for a layer, or its authored window when it is not bridged. */
export function bridgedWindow(
  scene: SceneSpec,
  layer: SceneSpec["layers"][number],
  bridge?: SeamBridge
): ActWindow {
  const authored = layerWindow(layer, scene.durationMs);
  if (!bridge) return authored;
  const startMs = Math.max(0, Math.min(bridge.startMs, scene.durationMs));
  const endMs = Math.max(startMs + 1, Math.min(bridge.endMs, scene.durationMs));
  return { startMs, endMs };
}

export interface DeadGap {
  fromMs: number;
  toMs: number;
  durationMs: number;
}

/**
 * Every interior run of screen time with no foreground content at all.
 *
 * Only INTERIOR gaps are reported: the head of a scene (before its first layer
 * has entered) and the tail (after the last one has left) are deliberate
 * bookends, not dead frames. Gaps are computed AFTER bridging, so a seam that
 * bridges correctly simply does not appear here.
 */
export function foregroundDeadGaps(scene: SceneSpec): DeadGap[] {
  const bridges = new Map(planSeamBridges(scene).map((b) => [b.layerId, b]));
  const windows = scene.layers
    .filter(isForegroundContent)
    .map((layer) => bridgedWindow(scene, layer, bridges.get(layer.id)))
    .filter((w) => w.endMs > w.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const gaps: DeadGap[] = [];
  let cursor = 0;
  for (const w of windows) {
    if (w.startMs - cursor > 0 && cursor > 0 && w.startMs < scene.durationMs) {
      gaps.push({ fromMs: cursor, toMs: w.startMs, durationMs: w.startMs - cursor });
    }
    cursor = Math.max(cursor, w.endMs);
  }
  return gaps.filter((g) => g.durationMs > 0);
}

export interface TransitionOverlap {
  first: number;
  second: number;
}

/** Normalized progress bounds of a transition's fully-covered peak. */
export function transitionPeakWindow(kind: TransitionKind, durationMs = 0): { inEnd: number; outStart: number } {
  const hold = durationMs > 0 ? Math.min(PEAK_HOLD_MS, durationMs * 0.24) / durationMs : 0;
  return { inEnd: Math.max(0, 0.5 - hold / 2), outStart: Math.min(1, 0.5 + hold / 2) };
}

/** The wall-clock width of the fully-covered peak, in ms. */
export function transitionPeakHoldMs(kind: TransitionKind, durationMs: number): number {
  const { inEnd, outStart } = transitionPeakWindow(kind, durationMs);
  return Math.max(0, outStart - inEnd) * durationMs;
}

export type TransitionPhase = "in" | "peak" | "out";

/** Normalized progress bounds of a transition's fully-covered peak. */
export function peakWindow(kind: TransitionKind, durationMs = 0): { inEnd: number; outStart: number } {
  return transitionPeakWindow(kind, durationMs);
}

/** The wall-clock width of the fully-covered peak, in ms. */
export function peakHoldMs(kind: TransitionKind, durationMs: number): number {
  return transitionPeakHoldMs(kind, durationMs);
}

/** Which third of the bell a normalized progress falls in. */
export function bellPhaseAt(kind: TransitionKind, p: number, durationMs = 0): TransitionPhase {
  const { inEnd, outStart } = peakWindow(kind, durationMs);
  const clamped = Math.min(1, Math.max(0, p));
  if (clamped < inEnd) return "in";
  if (clamped > outStart) return "out";
  return "peak";
}

/**
 * Normalized bell value: `0` at both ends, `1` at the midpoint. `power2.inOut`
 * per leg, so each phase accelerates into the cover and decelerates out of it.
 */
export function bellAmountAt(kind: TransitionKind, p: number, durationMs = 0): number {
  const { inEnd, outStart } = peakWindow(kind, durationMs);
  const clamped = Math.min(1, Math.max(0, p));
  const leg = (from: number, to: number): number => {
    const x = Math.min(1, Math.max(0, (clamped - from) / Math.max(1e-6, to - from)));
    // power2.inOut: 2x² rising, 1 − (−2x+2)²/2 falling
    return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  };
  if (clamped <= inEnd) return leg(0, inEnd);
  if (clamped >= outStart) return 1 - leg(outStart, 1);
  return 1;
}

/** Normalized position inside the current leg — what the tween eases run on. */
export function legProgressAt(kind: TransitionKind, p: number, durationMs = 0): number {
  const { inEnd, outStart } = peakWindow(kind, durationMs);
  const clamped = Math.min(1, Math.max(0, p));
  if (clamped < inEnd) return inEnd > 0 ? clamped / inEnd : 1;
  if (clamped > outStart) return outStart < 1 ? (clamped - outStart) / (1 - outStart) : 1;
  return 1;
}

/**
 * How much longer than the cover allowance a transition's peak would run.
 *
 * A cut may hide the stage only while its cover is at full extent; past
 * ~120 ms the audience stops reading it as a transition and starts reading it as
 * a hold on an empty screen. The runtime clamps the hold regardless — this
 * reports the authored window that asked for more.
 */
export function transitionPeakOverflowMs(kind: TransitionKind, durationMs: number): number {
  return Math.max(0, transitionPeakHoldMs(kind, durationMs) - PEAK_COVER_MAX_MS);
}

/**
 * Pairs of transitions whose windows overlap in time.
 *
 * Two live transitions at one timestamp stack their overlays and their camera
 * offsets, which reads as "two broken transitions happening at once". The
 * scene validator rejects these outright.
 */
export function findTransitionOverlaps(scene: SceneSpec): TransitionOverlap[] {
  const out: TransitionOverlap[] = [];
  const sorted = (scene.transitions ?? [])
    .map((t, index) => ({ index, at: t.at, end: t.at + t.durationMs }))
    .sort((a, b) => a.at - b.at);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (prev && curr && curr.at < prev.end) out.push({ first: prev.index, second: curr.index });
  }
  return out;
}
