/**
 * Per-layer motion composition: nested wrapper elements, non-overlapping motion
 * windows and deterministic layer lifecycle.
 *
 * THE BUG THIS FIXES: entrance, emphasis and exit presets all animated the
 * *same* element. A `scale`-based entrance and a `scale`-based exit therefore
 * fought over one inline `transform`, and `autoAlpha` was written by three
 * competing tweens — the visible result was warping, jumps and "ghosting" when
 * the renderer seeked non-linearly. Each phase now owns its own wrapper:
 *
 *   .mf-layer                ← lifecycle only (visibility/opacity/pointer-events)
 *     └ .mf-entrance         ← entrance tweens
 *         └ .mf-emphasis     ← emphasis tweens
 *             └ .mf-exit     ← exit tweens
 *                 └ <layer content>   ← renderer output (positioned, painted)
 *
 * Because the wrappers are nested, transforms compose instead of compete, and
 * no tween can ever clobber the lifecycle styles on `.mf-layer`.
 */
import type { SceneSpec } from "@motionforge/scene-spec";

import { PRESET_DEFAULTS } from "./presets.js";

export type SceneLayer = SceneSpec["layers"][number];

export interface MotionWindow {
  /** window start in ms (timeline-absolute) */
  startMs: number;
  /** window end in ms (exclusive for lifecycle purposes) */
  endMs: number;
}

export interface MotionSlotPlan {
  /** when the layer becomes visible */
  visibleStartMs: number;
  /**
   * when the layer is force-hidden. Equals the layer's own end unless an exit
   * runs past it (`exit.delayMs`), so an in-flight exit is never cut in half.
   */
  visibleEndMs: number;
  entrance: MotionWindow | null;
  emphasis: MotionWindow | null;
  exit: MotionWindow | null;
  /**
   * True when a transition seam is doing the hiding instead of this layer.
   *
   * A layer held past its own end to cover a cut must NOT also play its exit:
   * the exit finishes it 220 ms before the transition cover arrives, which is
   * precisely the "mass exit, then dead frame" defect the seam bridge exists to
   * remove. So the slot is suppressed wholesale — the content stays put and
   * fully opaque, and the transition's own cover is what removes it.
   */
  exitSuppressedBySeam: boolean;
}

function presetDurationMs(ref: { name: keyof typeof PRESET_DEFAULTS; durationMs?: number }): number {
  return ref.durationMs ?? PRESET_DEFAULTS[ref.name].durationMs;
}

/** The window a layer is planned over, honouring any seam bridge. */
export interface PlannedWindow {
  startMs: number;
  endMs: number;
  /** the exit slot is owned by a transition seam, not by this layer */
  suppressExit?: boolean;
}

/**
 * Split a layer's [at, end) window into three windows that can never overlap.
 * Emphasis only exists when the gap between entrance and exit is worth
 * animating (the same >200 ms rule the timeline builder used before).
 *
 * `window` overrides the authored `[at, at+duration)` when a transition seam
 * has bridged it — see `planSeamBridges` in `@motionforge/scene-spec`.
 */
export function planMotionSlots(
  layer: SceneLayer,
  sceneDurationMs: number,
  window?: PlannedWindow
): MotionSlotPlan {
  const startMs = window?.startMs ?? layer.at;
  const endMs = window?.endMs ?? (layer.duration !== undefined ? layer.at + layer.duration : sceneDurationMs);
  const suppressExit = window?.suppressExit === true;

  let cursor = startMs;

  const entrance: MotionWindow | null = layer.entrance
    ? (() => {
        const delay = layer.entrance?.delayMs ?? 0;
        const window: MotionWindow = { startMs: startMs + delay, endMs: startMs + delay + presetDurationMs(layer.entrance) };
        cursor = Math.max(cursor, window.endMs);
        return window;
      })()
    : null;

  const exit: MotionWindow | null = layer.exit && !suppressExit
    ? (() => {
        const delay = layer.exit?.delayMs ?? 0;
        const window: MotionWindow = {
          startMs: Math.max(cursor, endMs - presetDurationMs(layer.exit)),
          endMs: endMs + delay,
        };
        return window;
      })()
    : null;

  const emphasisWindowStart = entrance?.endMs ?? startMs;
  const emphasisWindowEnd = exit?.startMs ?? endMs;
  const emphasis: MotionWindow | null =
    layer.emphasis && emphasisWindowEnd - emphasisWindowStart > 200
      ? { startMs: emphasisWindowStart, endMs: emphasisWindowEnd }
      : null;

  return {
    visibleStartMs: startMs,
    visibleEndMs: exit?.endMs ?? endMs,
    entrance,
    emphasis,
    exit,
    exitSuppressedBySeam: suppressExit,
  };
}

export interface MotionWrappers {
  /** the `.mf-layer` root the wrappers were created in */
  root: HTMLElement;
  entrance: HTMLElement;
  emphasis: HTMLElement;
  exit: HTMLElement;
  /** the innermost element handed to layer renderers */
  content: HTMLElement;
}

/**
 * Build the nested wrapper chain inside a layer root. `preserve-3d` is kept on
 * every wrapper so 3D presets (`3dFlipIn`, the camera rig) still project
 * correctly instead of being flattened at each wrapper boundary.
 */
export function createMotionWrappers(root: HTMLElement): MotionWrappers {
  const make = (className: string, parent: HTMLElement): HTMLElement => {
    const el = document.createElement("div");
    el.className = `mf-slot ${className}`;
    parent.appendChild(el);
    return el;
  };

  // nested chain, so transforms compose instead of overwriting each other
  const entrance = make("mf-entrance", root);
  const emphasis = make("mf-emphasis", entrance);
  const exit = make("mf-exit", emphasis);
  return { root, entrance, emphasis, exit, content: exit };
}

export interface LayerLifecycleEntry {
  id: string;
  /** the `.mf-layer` root — the only element the registry writes to */
  root: HTMLElement;
  startMs: number;
  endMs: number;
}

/**
 * Deterministic layer visibility.
 *
 * Seeking is non-linear (a worker may jump from frame 900 straight to frame 30),
 * so visibility must never depend on "what happened to be applied last". Every
 * seek recomputes it from the layer's time window: outside the window a layer is
 * `visibility: hidden; opacity: 0; pointer-events: none`, inside it is visible.
 * Layers are always non-interactive, so `pointer-events` stays `none` either way.
 */
export class LayerLifecycle {
  private readonly entries: LayerLifecycleEntry[] = [];

  register(entry: LayerLifecycleEntry): void {
    this.entries.push(entry);
  }

  get layers(): readonly LayerLifecycleEntry[] {
    return this.entries;
  }

  apply(timeMs: number): void {
    for (const entry of this.entries) {
      const visible = timeMs >= entry.startMs && timeMs < entry.endMs;
      const style = entry.root.style;
      style.visibility = visible ? "visible" : "hidden";
      style.opacity = visible ? "1" : "0";
      style.pointerEvents = "none";
    }
  }

  /** Visibility at build time, so frame 0 is already correct before any seek. */
  applyInitial(): void {
    this.apply(0);
  }

  clear(): void {
    this.entries.length = 0;
  }
}
