/**
 * Runtime guards for malformed / partial layer payloads.
 *
 * WHY THIS EXISTS: the runtime is the LAST line of defence. A scene arrives
 * from an LLM, from the Studio or from a hand-edited JSON file, and it may be
 * structurally valid JSON but semantically broken (a `chart` with an empty
 * `data` array, a `background` whose `blob.radiusPct` is a string, a `cta`
 * with no `label`).
 *
 * The rule of the house is that a malformed payload DEGRADES — it draws what
 * it can — and it NEVER throws. A `TypeError` inside a renderer kills the
 * whole preview, and the author is left staring at a blank canvas with no
 * clue which of the forty layers broke it.
 *
 * Every helper here is total: it takes `unknown` and returns something safe.
 */

/** Coerce to a finite number, or fall back to the default. */
export function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Coerce to a finite number, or `undefined` when the value is not numeric. */
export function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A string (any string, including the empty one), or the fallback. */
export function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** A NON-EMPTY string, or the fallback. */
export function nonEmpty(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

/** Clamp a number into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * A usable CSS colour string, or the fallback.
 *
 * The schema already restricts colours to hex / rgb() / hsl() / transparent,
 * but the runtime must survive a scene that skipped validation, so the check
 * here is "is it a non-empty string" — the browser does the rest.
 */
export function safeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
  /** the colour's own alpha (0..1) */
  a: number;
}

function hexPair(hex: string, index: number): number {
  return Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
}

/**
 * Parse a CSS colour into its RGB channels.
 *
 * Supports the shapes the schema allows — hex (3/4/6/8 digits), `rgb()`,
 * `rgba()`, `hsl()`, `hsla()` — and returns `null` for anything else, so the
 * caller can fall back instead of painting `NaN`.
 */
export function parseColor(input: unknown): Rgb | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  if (value.length === 0) return null;
  if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    const expand = (c: string): number => Number.parseInt(c + c, 16);
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: expand(hex[0]!),
        g: expand(hex[1]!),
        b: expand(hex[2]!),
        a: hex.length === 4 ? expand(hex[3]!) / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: hexPair(hex, 0),
        g: hexPair(hex, 1),
        b: hexPair(hex, 2),
        a: hex.length === 8 ? hexPair(hex, 3) / 255 : 1,
      };
    }
    return null;
  }

  const fn = value.match(/^(rgba?|hsla?)\(([^)]*)\)$/);
  if (!fn) return null;
  const parts = fn[2]!
    .split(/[,/\s]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length < 3) return null;

  const channel = (raw: string, scale: number): number => {
    if (raw.endsWith("%")) return (Number.parseFloat(raw) / 100) * scale;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  };

  if (fn[1]!.startsWith("rgb")) {
    const a = parts.length > 3 ? clamp(channel(parts[3]!, 1), 0, 1) : 1;
    return {
      r: clamp(Math.round(channel(parts[0]!, 255)), 0, 255),
      g: clamp(Math.round(channel(parts[1]!, 255)), 0, 255),
      b: clamp(Math.round(channel(parts[2]!, 255)), 0, 255),
      a,
    };
  }

  // hsl / hsla
  const h = ((Number.parseFloat(parts[0]!) % 360) + 360) % 360;
  const s = clamp(Number.parseFloat(parts[1]!) / 100, 0, 1);
  const l = clamp(Number.parseFloat(parts[2]!) / 100, 0, 1);
  const a = parts.length > 3 ? clamp(channel(parts[3]!, 1), 0, 1) : 1;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(h / 60) % 6;
  const rgbTriple: [number, number, number] =
    seg === 0
      ? [c, x, 0]
      : seg === 1
        ? [x, c, 0]
        : seg === 2
          ? [0, c, x]
          : seg === 3
            ? [0, x, c]
            : seg === 4
              ? [x, 0, c]
              : [c, 0, x];
  return {
    r: clamp(Math.round((rgbTriple[0] + m) * 255), 0, 255),
    g: clamp(Math.round((rgbTriple[1] + m) * 255), 0, 255),
    b: clamp(Math.round((rgbTriple[2] + m) * 255), 0, 255),
    a,
  };
}

/** `rgba(...)` for a parsed colour at a given alpha. */
export function rgbaOf(color: Rgb, alpha: number): string {
  const a = clamp(alpha, 0, 1) * (Number.isFinite(color.a) ? color.a : 1);
  return `rgba(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)},${Math.round(a * 1000) / 1000})`;
}

/**
 * A colour at a given alpha.
 *
 * Hex colours become `rgba(...)`; anything else falls back to `color-mix()`,
 * which every Chromium that runs this runtime supports. The result is never
 * `NaN` — an unparseable colour degrades to the fallback.
 */
export function withAlpha(input: string, alpha: number): string {
  const parsed = parseColor(input);
  if (parsed) return rgbaOf(parsed, alpha);
  return `color-mix(in srgb, ${input} ${Math.round(clamp(alpha, 0, 1) * 100)}%, transparent)`;
}

/**
 * Blend two colours.
 *
 * Used by the particle field, which interpolates between `color` and `color2`
 * as a particle drifts. Unparseable colours degrade to a hard switch at the
 * midpoint — never to an exception.
 */
export function mixColors(from: string, to: string, t: number): string {
  const a = parseColor(from);
  const b = parseColor(to);
  const k = clamp(t, 0, 1);
  if (!a || !b) return k < 0.5 ? from : to;
  const mix = (x: number, y: number): number => Math.round(x + (y - x) * k);
  return `rgb(${mix(a.r, b.r)},${mix(a.g, b.g)},${mix(a.b, b.b)})`;
}

/**
 * The relative luminance of a colour (0..1).
 *
 * Used to pick a readable ink over an arbitrary accent colour: a yellow
 * button needs dark text, a blue one needs light text.
 */
export function luminance(input: string): number {
  const c = parseColor(input);
  if (!c) return 0;
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** Black or white — whichever reads on the given background. */
export function contrastInk(background: string): string {
  return luminance(background) > 0.5 ? "#0b1020" : "#ffffff";
}
