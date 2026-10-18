import type { KineticTextLayer, Paint } from "@motionforge/scene-spec";
import { CRISP_TEXT_CSS, TEXT_UNIT_GUARD_CSS } from "../determinism.js";
import { fontFamilyFor } from "../fonts.js";
import type { LayerContext } from "./context.js";

/** Arabic, Arabic Supplement/Extended-A/B and Arabic Presentation Forms-A. */
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF]/;

/**
 * Other scripts that are also shaped contextually (Hebrew, Kana, Devanagari,
 * Thai, Hangul). Splitting these per glyph detaches marks and clusters just as
 * Arabic does, so they share the same guard.
 */
const CURSIVE_RE = /[\u0590-\u05FF\u3040-\u30FF\u0900-\u097F\u0E00-\u0E7F\uAC00-\uD7AF]/;

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
   * scattered fragments (`"مو   ن"`). One continuous line-level clip reveals the
   * phrase as a phrase, in the reading direction, without ever cutting a word.
   */
  lines?: HTMLElement[];
}

export function renderKineticText(layer: KineticTextLayer, ctx: LayerContext): KineticTextBuild {
  const family = fontFamilyFor(ctx.fonts, layer.role, layer.googleFamily);

  const block = document.createElement("div");
  block.style.cssText = [
    "position:absolute",
    `left:${layer.position.xPct}%`,
    `top:${layer.position.yPct}%`,
    `transform:translate(-50%,-50%)${layer.rotation ? ` rotate(${layer.rotation}deg)` : ""}`,
    `text-align:${layer.align}`,
    `direction:${layer.direction}`,
    `font-family:${family}`,
    `font-weight:${layer.fontWeight}`,
    `font-size:${layer.sizePx}px`,
    `line-height:${layer.lineHeight}`,
    `letter-spacing:${layer.letterSpacingPx}px`,
    "unicode-bidi:plaintext",
    CRISP_TEXT_CSS,
  ].join(";");

  if (layer.box) {
    block.style.width = `${layer.box.maxWidthPct}%`;
    block.style.maxWidth = `${layer.box.maxWidthPct}%`;
    if (layer.box.paddingPx > 0) block.style.padding = `${layer.box.paddingPx}px`;
    if (layer.box.chip) {
      block.style.borderRadius = `${layer.box.chip.radiusPx}px`;
      const chipLayer = document.createElement("div");
      chipLayer.style.cssText = [
        "position:absolute",
        "inset:0",
        `border-radius:inherit`,
        `background:${layer.box.chip.color}`,
        `opacity:${layer.box.chip.opacity}`,
      ].join(";");
      block.prepend(chipLayer);
    }
  }

  if (layer.shadow) {
    block.style.textShadow =
      `0 ${layer.shadow.offsetYpx}px ${layer.shadow.blurPx}px ` +
      `rgba(0,0,0,${layer.shadow.opacity})`;
  }

  const granularity = resolveGranularity(layer.text, layer.direction, layer.animateBy);

  const lines = layer.text.split("\n");
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
  pill.style.cssText = [
    "position:absolute",
    // symmetric bleed: the fill sits behind the glyphs, never on them
    `top:${-highlight.paddingPx}px`,
    `bottom:${-highlight.paddingPx}px`,
    `left:${-highlight.paddingPx}px`,
    `right:${-highlight.paddingPx}px`,
    // longhand, because the `border` shorthand is not reliably parsed
    "border-style:none",
    "border-width:0px",
    "border-radius:0.28em",
    `background:${highlight.color}`,
    "z-index:1",
    "pointer-events:none",
  ].join(";");
  return pill;
}

/** Solid color → color; gradient → background-clip:text gradient fill. */
function applyTextPaint(el: HTMLElement, fill: Paint, stroke?: { color: string; widthPx: number }): void {
  if (typeof fill === "string") {
    el.style.color = fill;
  } else {
    const stops = fill.stops
      .map((s) => `${rgbaOf(s.color, s.opacity ?? 1)} ${s.at}%`)
      .join(", ");
    el.style.backgroundImage = `linear-gradient(${fill.angleDeg}deg, ${stops})`;
    el.style.webkitBackgroundClip = "text";
    el.style.backgroundClip = "text";
    el.style.color = "transparent";
  }
  if (stroke) {
    el.style.webkitTextStroke = `${stroke.widthPx}px ${stroke.color}`;
  }
}

function rgbaOf(color: string, opacity: number): string {
  if (!color.startsWith("#") || opacity >= 1) return color;
  let h = color.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
