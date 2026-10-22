import type { StudioLayer } from '../types.js';

/**
 * The layer factory — ONE place that knows what a VALID new layer looks like.
 *
 * WHY A FACTORY: the Studio used to create a `kineticText` layer for EVERY
 * kind, so pressing "Add chart" produced a text layer with the word "New
 * Text" in it. The schema then rejected the scene (a `chart` needs `data`,
 * a `codeBlock` needs `code`, a `cta` needs `label`), and the user never saw
 * the chart they asked for.
 *
 * Every payload here is SCHEMA-VALID on its own: the discriminator and its
 * required keys are present, the numbers are inside their legal ranges and
 * the durations are EXPLICIT INTEGERS.
 *
 * THE DURATION RULE (F6/F7): a full-bleed layer (`background`,
 * `foregroundFX`) is written with `duration: <composition length>` — an
 * explicit INTEGER. Never `null`, never the schema's 1200 ms default: a
 * background that stops at 1200 ms leaves the rest of the composition on the
 * void, and `duration: null` is not a number at all.
 */

/** The kinds the Studio can create from the tool dock or the layer stack. */
export type NewLayerKind =
  | 'kineticText'
  | 'card'
  | 'chart'
  | 'codeBlock'
  | 'particleField'
  | 'cta'
  | 'background'
  | 'foregroundFX';

/** The kinds that paint the WHOLE canvas (no centre anchor). */
export const FULL_BLEED_NEW_KINDS: NewLayerKind[] = ['background', 'foregroundFX'];

export interface NewLayerOptions {
  /** the layer id (the caller owns the uniqueness) */
  id: string;
  /** where the layer starts, in milliseconds */
  at: number;
  /** the COMPOSITION length, in milliseconds */
  durationMs: number;
}

/** The default duration of a content layer (3 seconds). */
const CONTENT_DURATION_MS = 3000;

/** A random-enough id suffix, shared by every caller. */
export function newLayerId(kind: string): string {
  return `${kind}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Build a VALID layer payload for `kind`.
 *
 * The full-bleed kinds ignore `at` and span the whole composition; every
 * other kind starts at `at` and runs for three seconds (or to the end of the
 * composition, whichever is shorter).
 */
export function createLayerPayload(
  kind: NewLayerKind,
  options: NewLayerOptions
): StudioLayer {
  const { id, at, durationMs } = options;
  const compositionEnd = Math.max(0, Math.round(durationMs));
  const start = Math.max(0, Math.round(at));
  const contentEnd = Math.min(compositionEnd, start + CONTENT_DURATION_MS);

  switch (kind) {
    case 'background':
      return {
        id,
        type: 'background',
        variant: { variant: 'solid', color: '#05070d' },
        at: 0,
        duration: compositionEnd,
      };
    case 'foregroundFX':
      return {
        id,
        type: 'foregroundFX',
        effects: [{ kind: 'vignette' }],
        at: 0,
        duration: compositionEnd,
      };
    case 'chart':
      return {
        id,
        type: 'chart',
        position: { xPct: 50, yPct: 50 },
        chartType: 'bar',
        title: 'Chart',
        data: [
          { label: 'A', value: 40 },
          { label: 'B', value: 70 },
          { label: 'C', value: 55 },
        ],
        accentColor: '#38bdf8',
        at: start,
        duration: Math.max(1, contentEnd - start),
      };
    case 'codeBlock':
      return {
        id,
        type: 'codeBlock',
        position: { xPct: 50, yPct: 50 },
        language: 'typescript',
        title: 'snippet.ts',
        code: 'const answer = 42;',
        theme: 'dark',
        fontSize: 22,
        widthPx: 880,
        at: start,
        duration: Math.max(1, contentEnd - start),
      };
    case 'particleField':
      return {
        id,
        type: 'particleField',
        pattern: 'constellation',
        count: 90,
        color: '#7dd3fc',
        // `size` is the particle RADIUS on a particleField: it shadows the
        // base schema's layout-size bag, which a full-bleed layer has no use
        // for. The sanitizer keeps the numeric value intact.
        size: 2.5,
        seed: 42,
        at: start,
        duration: Math.max(1, contentEnd - start),
      };
    case 'cta':
      return {
        id,
        type: 'cta',
        position: { xPct: 50, yPct: 70 },
        label: 'Start',
        sublabel: 'Free trial',
        variant: 'primary',
        accentColor: '#38bdf8',
        icon: 'arrow',
        at: start,
        duration: Math.max(1, contentEnd - start),
      };
    case 'card':
      return {
        id,
        type: 'card',
        position: { xPct: 50, yPct: 50 },
        variant: {
          variant: 'glassCard',
          title: 'Card',
          body: 'Double-click the card on the canvas to edit it in place.',
        },
        at: start,
        duration: Math.max(1, contentEnd - start),
      };
    case 'kineticText':
    default:
      return {
        id,
        type: 'kineticText',
        text: 'New Text',
        sizePx: 80,
        position: { xPct: 50, yPct: 50 },
        fill: '#ffffff',
        at: start,
        duration: Math.max(1, contentEnd - start),
      };
  }
}

/** True when the kind is one the Studio knows how to create. */
export function isNewLayerKind(kind: string): kind is NewLayerKind {
  return (
    kind === 'kineticText' ||
    kind === 'card' ||
    kind === 'chart' ||
    kind === 'codeBlock' ||
    kind === 'particleField' ||
    kind === 'cta' ||
    kind === 'background' ||
    kind === 'foregroundFX'
  );
}
