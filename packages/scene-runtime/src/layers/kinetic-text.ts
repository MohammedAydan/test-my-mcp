import type { KineticTextLayer, Paint } from "@motionforge/scene-spec";
import { CRISP_TEXT_CSS, TEXT_UNIT_GUARD_CSS } from "../determinism.js";
import { fontFamilyFor } from "../fonts.js";
import { clamp, num, safeColor } from "./guards.js";
import type { LayerContext } from "./context.js";

/** Arabic, Arabic Supplement/Extended-A/B and Arabic Presentation Forms-A. */
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF]/;

/**
 * Other scripts that are also shaped contextually (Hebrew, Kana, Devanagari,
 * Thai, Hangul). Splitting these per glyph detaches marks and clusters just as
 * Arabic does, so they share the same guard.
 */
const CURSIVE_RE = /[\u0590-\u05FF\u3040-\u309F\u30A0-\u30FF\u0900-\u097F\u0E00-\u0E7F\uAC00-\uD7AF]/;

export type TextGranularity = "char" | "word" | "line";

export function containsArabicScript(text: string): boolean {
  return ARABIC_RE.test(text);
}

/**
 * Decide the split granularity for a text layer.
 *
 * Per-character spans break contextual shaping: Arabic cursive joining loses
 * its ligatures and each isolated glyph is drawn in its isolated form, which
 * looks like deformed, disconnected letters. So character splitting is
 * **forbidden** whenever the text contains Arabic *or* the layer declares RTL
 * direction (mixed AR/EN lines are exactly the case that looks fine in a text
 * editor and breaks in the renderer). Those layers degrade to word splitting,
 * which preserves shaping inside each word.
 */
export function resolveGranularity(
  text: string,
  direction: "ltr" | "rtl",
  animateBy: TextGranularity
): TextGranularity {
  if (animateBy === "line") return "line";
  if (direction === "rtl" || ARABIC_RE.test(text) || CURSIVE_RE.test(text)) return "word";
  return animateBy;
}

export interface KineticTextBuild {
  content: HTMLElement;
  units?: HTMLElement[];
  /**
   * The line containers, one per authored line.
   *
   * `maskRevealWipe` / `collapseMask` drive these instead of the per-word
   * units: a per-word horizontal clip slices an Arabic sentence open along
   * every word boundary at once, so for most of the wipe the headline reads as
   * scattered fragments (`"مو   ن"`). One continuous line-level clip reveals
   * the phrase as a phrase, in the reading direction, without ever cutting a word.
   */
  lines?: HTMLElement[];
}

export function renderKineticText(layer: KineticTextLayer, ctx: LayerContext): KineticTextBuild {
  const family = fontFamilyFor(ctx.fonts, layer.role, layer.googleFamily);

  const source = typeof layer.text === "string" ? layer.text : "";
  const direction: "ltr" | "rtl" = layer.direction === "rtl" ? "rtl" : "ltr";
  const align = layer.align === "left" || layer.align === "right" ? layer.align : "center";
  const animateBy: TextGranularity =
    layer.animateBy === "char" || layer.animateBy === "line" ? layer.animateBy : "word";

  const block = document.createElement("div");
  // The anchor (`left` / `top`) is authored here; the TRANSFORM is owned by
  // the unified pipeline (`../transform.js`), which writes it on this very
  // element. Writing a second, differently-formatted transform here is what
  // used to desync the preview from the scene.
  block.style.cssText = [
    "position:absolute",
    `left:${clamp(num(layer.position?.xPct, 50), -300, 300)}%`,
    `top:${clamp(num(layer.position?.yPct, 50), -300, 300)}%`,
    `text-align:${align}`,
    `direction:${direction}`,
    `font-family:${family}`,
    `font-weight:${clamp(Math.round(num(layer.fontWeight, 800)), 100, 900)}`,
    `font-size:${clamp(num(layer.sizePx, 48), 4, 900)}px`,
    `line-height:${clamp(num(layer.lineHeight, 1.15), 0.5, 4)}`,
    `letter-spacing:${num(layer.letterSpacingPx, 0)}px`,
    "unicode-bidi:plaintext",
    CRISP_TEXT_CSS,
  ].join(";");

  const box = layer.box;
  if (box && typeof box === "object") {
    const maxWidthPct = clamp(num(box.maxWidthPct, 70), 1, 400);
    block.style.width = `${maxWidthPct}%`;
    block.style.maxWidth = `${maxWidthPct}%`;
    const paddingPx = clamp(num(box.paddingPx, 0), 0, 400);
    if (paddingPx > 0) block.style.padding = `${paddingPx}px`;
    const chip = box.chip;
    if (chip && typeof chip === "object") {
      block.style.borderRadius = `${clamp(num(chip.radiusPx, 18), 0, 400)}px`;
      const chipLayer = document.createElement("div");
      chipLayer.style.cssText = [
        "position:absolute",
        "inset:0",
        `border-radius:inherit`,
        `background:${safeColor(chip.color, "#ffffff")}`,
        `opacity:${clamp(num(chip.opacity, 0.14), 0, 1)}`,
      ].join(";");
      block.prepend(chipLayer);
    }
  }

  const shadow = layer.shadow;
  if (shadow && typeof shadow === "object") {
    block.style.textShadow =
      `0 ${num(shadow.offsetYpx, 10)}px ${clamp(num(shadow.blurPx, 24), 0, 400)}px ` +
      `rgba(0,0,0,${clamp(num(shadow.opacity, 0.45), 0, 1)})`;
  }

  const granularity = resolveGranularity(source, direction, animateBy);

  const lines = source.split("\n");
  const units: HTMLElement[] = [];
  const lineEls: HTMLElement[] = [];

  for (const line of lines) {
    const lineEl = document.createElement("div");
    lineEl.className = "mf-line";
    // The line is the pill's positioning context AND its stacking context, so
    // the highlight resolves against the line box and never escapes into the
    // (3D-preserving) wrapper chain.
    lineEl.style.cssText = ["position:relative", "isolation:isolate"].join(";");

    // THE HIGHLIGHT IS ONE PILL PER LINE, NOT ONE PER WORD.
    //
    // Per-word pills put a separate bordered box around each word of a
    // sentence; four boxes of differing heights with gaps between them read as
    // four separate compartments rather than as one highlighted phrase. A
    // single pill spanning the whole line is what makes an Arabic sentence look
    // like a sentence.
    if (layer.highlight) lineEl.appendChild(buildHighlight(layer.highlight));

    if (granularity === "line") {
      // a non-breaking space keeps empty lines at full line height
      lineEl.textContent = line || "\u00a0";
      lineEl.classList.add("mf-unit");
      lineEl.style.cssText = [lineEl.style.cssText, TEXT_UNIT_GUARD_CSS].join(";");
      applyTextPaint(lineEl, layer.fill, layer.stroke);
      units.push(lineEl);
    } else {
      // whitespace tokens stay as plain text nodes so words keep natural spacing
      const tokens = granularity === "word" ? line.split(/(\s+)/) : [...line];
      for (const token of tokens) {
        if (/^\s+$/.test(token)) {
          lineEl.appendChild(document.createTextNode(token));
          continue;
        }
        // isolate each word: `unicode-bidi: isolate` keeps mixed AR/EN runs and
        // numerals from reordering across span boundaries
        const wrap = document.createElement("span");
        wrap.style.cssText = [
          "position:relative",
          "display:inline-block",
          "white-space:pre",
          "unicode-bidi:isolate",
        ].join(";");
        const span = document.createElement("span");
        span.className = "mf-unit";
        // `position:relative` + `isolation:isolate` makes the unit its own
        // stacking context, so it stacks ABOVE the line-level pill (z-index 2)
        // instead of being painted over by it.
        span.style.cssText = ["position:relative", "isolation:isolate", "z-index:2", TEXT_UNIT_GUARD_CSS].join(";");
        // The glyphs live in their own span so they can sit ABOVE the pill.
        const glyphs = document.createElement("span");
        glyphs.className = "mf-unit-glyphs";
        glyphs.style.cssText = ["position:relative", "z-index:2", "display:inline"].join(";");
        glyphs.textContent = token;
        applyTextPaint(glyphs, layer.fill, layer.stroke);
        span.appendChild(glyphs);
        wrap.appendChild(span);
        lineEl.appendChild(wrap);
        units.push(span);
      }
    }
    block.appendChild(lineEl);
    lineEls.push(lineEl);
  }

  ctx.content.appendChild(block);
  return {
    content: block,
    units: units.length > 1 ? units : undefined,
    lines: lineEls,
  };
}

/**
 * The soft, borderless highlight pill.
 *
 * A `1px solid` edge is what made adjacent word boxes read as hard-edged
 * compartments; the fix is not a thinner border but no border at all, plus a
 * generous radius relative to the type size so the fill reads as one luminous
 * shape behind the phrase.
 */
function buildHighlight(highlight: NonNullable<KineticTextLayer["highlight"]>): HTMLElement {
  const pill = document.createElement("span");
  pill.className = "mf-highlight";
  pill.dataset.mfHighlight = "true";
  const paddingPx = clamp(num(highlight.paddingPx, 8), -200, 400);
  pill.style.cssText = [
    "position:absolute",
    // symmetric bleed: the fill sits behind the glyphs, never on them
    `top:${-paddingPx}px`,
    `bottom:${-paddingPx}px`,
    `left:${-paddingPx}px`,
    `right:${-paddingPx}px`,
    // longhand, because the `border` shorthand is not reliably parsed
    "border-style:none",
    "border-width:0px",
    "border-radius:0.28em",
    `background:${safeColor(highlight.color, "#ffffff")}`,
    "z-index:1",
    "pointer-events:none",
  ].join(";");
  return pill;
}

/** Solid color → color; gradient → background-clip:text gradient fill. */
function applyTextPaint(el: HTMLElement, fill?: Paint, stroke?: { color: string; widthPx: number }): void {
  if (typeof fill === "string") {
    if (fill === "#ffffff" || fill === "#fff") {
      el.style.color = "var(--mf-text-primary, #ffffff)";
    } else {
      el.style.color = fill;
    }
  } else if (fill && typeof fill === "object" && Array.isArray((fill as { stops?: unknown }).stops)) {
    const gradient = fill as { angleDeg?: number; stops: Array<{ color: string; at: number; opacity?: number }> };
    const stops = gradient.stops
      .filter((s) => s && typeof s.color === "string")
      .map((s) => `${rgbaOf(s.color, s.opacity ?? 1)} ${num(s.at, 0)}%`)
      .join(", ");
    if (stops.length > 0) {
      el.style.backgroundImage = `linear-gradient(${num(gradient.angleDeg, 0)}deg, ${stops})`;
      el.style.webkitBackgroundClip = "text";
      el.style.backgroundClip = "text";
      el.style.color = "transparent";
    } else {
      el.style.color = "var(--mf-text-primary, #ffffff)";
    }
  } else {
    el.style.color = "var(--mf-text-primary, #ffffff)";
  }
  if (stroke && typeof stroke.color === "string") {
    el.style.webkitTextStroke = `${clamp(num(stroke.widthPx, 1), 0, 40)}px ${stroke.color}`;
  }
}

function rgbaOf(color: string, opacity: number): string {
  if (!color.startsWith("#") || opacity >= 1) return color;
  let h = color.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return color;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
