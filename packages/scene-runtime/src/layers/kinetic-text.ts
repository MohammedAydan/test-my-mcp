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

export function renderKineticText(
  layer: KineticTextLayer,
  ctx: LayerContext
): { content: HTMLElement; units?: HTMLElement[] } {
  const family = fontFamilyFor(ctx.fonts, layer.role, layer.googleFamily);

  const block = document.createElement("div");
  block.style.cssText = [
    "position:absolute",
    `left:${layer.position.xPct}%`,
    `top:${layer.position.yPct}%`,
    "transform:translate(-50%,-50%)",
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

  for (const line of lines) {
    const lineEl = document.createElement("div");
    if (granularity === "line") {
      lineEl.className = "mf-unit";
      lineEl.style.cssText = TEXT_UNIT_GUARD_CSS;
      applyTextPaint(lineEl, layer.fill, layer.stroke);
      // a non-breaking space keeps empty lines at full line height
      lineEl.textContent = line || "\u00a0";
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
        if (granularity === "word" && layer.highlight) {
          const hl = document.createElement("span");
          hl.style.cssText = [
            "position:absolute",
            `inset:${-layer.highlight.paddingPx}px`,
            `border-radius:${layer.highlight.radiusPx}px`,
            `background:${layer.highlight.color}`,
            "z-index:-1",
          ].join(";");
          wrap.appendChild(hl);
        }
        const span = document.createElement("span");
        span.className = "mf-unit";
        span.style.cssText = TEXT_UNIT_GUARD_CSS;
        applyTextPaint(span, layer.fill, layer.stroke);
        span.textContent = token;
        wrap.appendChild(span);
        lineEl.appendChild(wrap);
        units.push(span);
      }
    }
    block.appendChild(lineEl);
  }

  ctx.content.appendChild(block);
  return { content: block, units: units.length > 1 ? units : undefined };
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
