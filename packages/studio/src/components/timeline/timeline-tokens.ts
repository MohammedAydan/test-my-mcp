/**
 * The design tokens the timeline canvas paints with.
 *
 * The timeline is a CANVAS: CSS cannot style a tick, a diamond, a trim cap
 * or a playhead needle. So the painter reads the SAME tokens the DOM chrome
 * uses — `--mf-accent`, `--mf-keyframe`, `--mf-track-h`, … — straight off
 * `:root` and paints with them.
 *
 * ONE source of truth, TWO renderers: the DOM track headers and the canvas
 * can therefore never disagree about a colour or a metric. No hex literals
 * are hard-coded here — a theme change repaints the timeline for free.
 */

/** The colours the painter uses. */
export interface TimelinePalette {
  /** the timeline surface */
  bg: string;
  /** the ruler band */
  bgHeader: string;
  /** the sunken well behind the track headers */
  bgSunken: string;
  /** the app backdrop — the scrim outside the work area */
  bgGutter: string;
  /** raised controls (tooltips, chips) */
  bgElevated: string;
  /** the panel surface */
  bgPanel: string;
  /** 1px structure */
  border: string;
  /** 1px structure, emphasised */
  borderStrong: string;
  /** primary text */
  text1: string;
  /** secondary text */
  text2: string;
  /** tertiary text */
  text3: string;
  /** the focus / selection blue */
  accent: string;
  /** the legible sibling of the accent */
  accentText: string;
  /** the gizmo blue — selection wireframes and handles */
  gizmo: string;
  /** keyframe diamonds + the work-area brackets */
  keyframe: string;
  /** the playhead + destructive */
  record: string;
  /** caution */
  warning: string;
  /** the audio lane */
  audio: string;
}

/** The pixel metrics the lane rows are built from. */
export interface TimelineMetrics {
  /** the height of a video lane row */
  trackH: number;
  /** the height of the audio lane row */
  audioTrackH: number;
  /** the height of the time ruler */
  rulerH: number;
  /** the gap between two lane rows */
  gap: number;
}

const FALLBACK_PALETTE: TimelinePalette = {
  bg: '#14161a',
  bgHeader: '#1a1d23',
  bgSunken: '#0f1114',
  bgGutter: '#090a0d',
  bgElevated: '#20242c',
  bgPanel: '#14161a',
  border: '#262a34',
  borderStrong: '#333a47',
  text1: '#e6e9ef',
  text2: '#9aa3b2',
  text3: '#6b7280',
  accent: '#2d8ceb',
  accentText: '#8cc2ff',
  gizmo: '#3b82f6',
  keyframe: '#38bdf8',
  record: '#ff4b4b',
  warning: '#f59e0b',
  audio: '#10b981',
};

const FALLBACK_METRICS: TimelineMetrics = {
  trackH: 28,
  audioTrackH: 26,
  rulerH: 28,
  gap: 3,
};

/** Read one custom property off `:root`. */
export function readToken(name: string): string {
  if (typeof document === 'undefined' || typeof window === 'undefined') return '';
  try {
    return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  } catch {
    return '';
  }
}

/** Read one numeric custom property off `:root`, with a fallback. */
export function readNumberToken(name: string, fallback: number): number {
  const raw = readToken(name);
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Read the whole palette off `:root`. */
export function readPalette(): TimelinePalette {
  return {
    bg: readToken('--mf-bg-panel') || FALLBACK_PALETTE.bg,
    bgHeader: readToken('--mf-bg-header') || FALLBACK_PALETTE.bgHeader,
    bgSunken: readToken('--mf-bg-sunken') || FALLBACK_PALETTE.bgSunken,
    bgGutter: readToken('--mf-bg-gutter') || FALLBACK_PALETTE.bgGutter,
    bgElevated: readToken('--mf-bg-elevated') || FALLBACK_PALETTE.bgElevated,
    bgPanel: readToken('--mf-bg-panel') || FALLBACK_PALETTE.bgPanel,
    border: readToken('--mf-border') || FALLBACK_PALETTE.border,
    borderStrong: readToken('--mf-border-strong') || FALLBACK_PALETTE.borderStrong,
    text1: readToken('--mf-text-1') || FALLBACK_PALETTE.text1,
    text2: readToken('--mf-text-2') || FALLBACK_PALETTE.text2,
    text3: readToken('--mf-text-3') || FALLBACK_PALETTE.text3,
    accent: readToken('--mf-accent') || FALLBACK_PALETTE.accent,
    accentText: readToken('--mf-accent-text') || FALLBACK_PALETTE.accentText,
    gizmo: readToken('--mf-gizmo') || FALLBACK_PALETTE.gizmo,
    keyframe: readToken('--mf-keyframe') || FALLBACK_PALETTE.keyframe,
    record: readToken('--mf-record') || FALLBACK_PALETTE.record,
    warning: readToken('--mf-warning') || FALLBACK_PALETTE.warning,
    audio: readToken('--mf-audio') || FALLBACK_PALETTE.audio,
  };
}

/** Read the lane metrics off `:root`. */
export function readMetrics(): TimelineMetrics {
  return {
    trackH: readNumberToken('--mf-track-h', FALLBACK_METRICS.trackH),
    audioTrackH: readNumberToken('--mf-audio-track-h', FALLBACK_METRICS.audioTrackH),
    rulerH: readNumberToken('--mf-ruler-h', FALLBACK_METRICS.rulerH),
    gap: readNumberToken('--mf-track-gap', FALLBACK_METRICS.gap),
  };
}

/**
 * Resolve a CSS colour that may be a `var(--token)` reference.
 *
 * `layerKindColor()` and the design tokens hand out `var(--mf-kind-…)`
 * strings; the canvas needs a real colour, so the token is read off `:root`.
 */
export function resolveCssColor(value: string, fallback = '#888888'): string {
  if (!value) return fallback;
  const match = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value.trim());
  if (!match) return value;
  const resolved = readToken(match[1] ?? '');
  if (resolved) return resolved;
  return match[2]?.trim() || fallback;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()` into channels. */
function parseColor(color: string): Rgb | null {
  const value = color.trim();
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const full =
      hex.length === 3 || hex.length === 4
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    if (full.length < 6) return null;
    const r = Number.parseInt(full.slice(0, 2), 16);
    const g = Number.parseInt(full.slice(2, 4), 16);
    const b = Number.parseInt(full.slice(4, 6), 16);
    if (![r, g, b].every((n) => Number.isFinite(n))) return null;
    return { r, g, b };
  }
  const match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(value);
  if (!match) return null;
  const r = Math.round(Number(match[1]));
  const g = Math.round(Number(match[2]));
  const b = Math.round(Number(match[3]));
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  return { r, g, b };
}

/**
 * Apply an alpha to a colour.
 *
 * The canvas cannot use `rgba(var(--mf-accent), 0.4)` — a custom property is
 * not a colour channel — so the token is resolved and re-emitted as an
 * explicit `rgba()`.
 */
export function withAlpha(color: string, alpha: number): string {
  const rgb = parseColor(color);
  if (!rgb) return color;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

/** Read a font stack token off `:root`. */
export function readFont(token: string, fallback: string): string {
  return readToken(token) || fallback;
}
