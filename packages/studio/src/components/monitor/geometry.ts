import { resolveCanvasSize, type Canvas } from '@motionforge/scene-spec';

/**
 * The Program Monitor's geometry contract.
 *
 * ONE place decides how big the composition is and how it maps onto the
 * panel, so the monitor panel and the canvas overlay can never disagree
 * about where a layer is on screen.
 *
 * The composition size comes from the SAME resolver the runtime uses
 * (`resolveCanvasSize`), so the iframe, the gizmo and the renderer all speak
 * the same design space.
 */

/** The margin (px) kept between the composition and the edge of the panel. */
/**
 * The breathing room around the composition inside the Program Monitor.
 *
 * Small on purpose: the panel is already framed by the app chrome, so a
 * generous margin only shrinks the composition and leaves a "tiny image in a
 * void" impression. 16px is enough to see the stage edge.
 */
export const STAGE_MARGIN = 16;

export interface CompositionSize {
  /** the composition width, in design pixels */
  width: number;
  /** the composition height, in design pixels */
  height: number;
}

export interface CanvasLike {
  shape?: string;
  scale?: number;
}

/**
 * The composition's pixel size.
 *
 * `resolveCanvasSize` is authoritative (it is the table the runtime uses), but
 * it THROWS on a canvas the schema would reject. The Studio is an authoring
 * surface, so an in-progress canvas can be momentarily invalid — the
 * proportional fallback keeps the monitor alive instead of white-screening.
 */
export function resolveCompositionSize(canvas?: CanvasLike | null): CompositionSize {
  const shape = canvas?.shape ?? '16:9';
  const scale = canvas?.scale ?? 1080;
  try {
    const size = resolveCanvasSize({ shape, scale } as Canvas);
    return { width: size.width, height: size.height };
  } catch {
    if (shape === '9:16') return { width: scale, height: Math.round((scale * 16) / 9) };
    if (shape === '1:1') return { width: scale, height: scale };
    if (shape === '4:5') return { width: Math.round((scale * 4) / 5), height: scale };
    return { width: Math.round((scale * 16) / 9), height: scale };
  }
}

/**
 * The scale that makes the composition fill the panel.
 *
 * The margin is subtracted from BOTH axes, so the composition keeps its
 * aspect ratio and is never cropped: the smaller axis decides.
 */
export function fitScaleFor(
  containerWidth: number,
  containerHeight: number,
  compositionWidth: number,
  compositionHeight: number,
  margin: number = STAGE_MARGIN
): number {
  if (!(compositionWidth > 0) || !(compositionHeight > 0)) return 1;
  const availableWidth = Math.max(1, containerWidth - margin);
  const availableHeight = Math.max(1, containerHeight - margin);
  return Math.min(availableWidth / compositionWidth, availableHeight / compositionHeight);
}

/** Clamp a zoom factor into the range the monitor allows. */
export function clampZoom(zoom: number, min = 0.05, max = 8): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(max, Math.max(min, zoom));
}

/** Round to two decimals — the precision the zoom selector shows. */
export function roundZoom(zoom: number): number {
  return Math.round(zoom * 100) / 100;
}
