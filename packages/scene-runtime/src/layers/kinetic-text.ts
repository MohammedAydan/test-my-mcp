import type { KineticTextLayer, Paint } from "@motionforge/scene-spec";
import { fontFamilyFor } from "../fonts.js";
import type { LayerContext } from "./context.js";

/**
 * RTL note: splitting Arabic text into per-character spans breaks contextual
 * letter joining (ligatures/shaping). When the text contains Arabic-script
 * characters, "char" granularity gracefully degrades to "word".
 */
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;

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

  const granularity =
    layer.animateBy === "char" && ARABIC_RE.test(layer.text) && layer.direction === "rtl"
      ? "word"
      : layer.animateBy;

  const lines = layer.text.split("\n");
  const units: HTMLElement[] = [];

  for (const line of lines) {
    const lineEl = document.createElement("div");
    if (granularity === "line") {
      lineEl.className = "mf-unit";
      applyTextPaint(lineEl, layer.fill, layer.stroke);
      lineEl.textContent = line || "\u00a0";
      units.push(lineEl);
    } else {
      const tokens = granularity === "word" ? line.split(/(\s+)/) : [...line];
      for (const token of tokens) {
        if (/^\s+$/.test(token)) {
          lineEl.appendChild(document.createTextNode(token));
          continue;
        }
        const wrap = document.createElement("span");
        wrap.style.cssText = "position:relative;display:inline-block;";
        if (granularity === "word") {
          if (layer.highlight) {
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
        }
        const span = document.createElement("span");
        span.className = "mf-unit";
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
