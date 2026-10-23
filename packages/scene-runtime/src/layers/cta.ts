import type { CtaLayer } from "@motionforge/scene-spec";
import { CRISP_TEXT_CSS } from "../determinism.js";
import { fontFamilyFor } from "../fonts.js";
import { clamp, contrastInk, num, safeColor, withAlpha } from "./guards.js";
import type { LayerContext } from "./context.js";

/**
 * The `cta` layer — the call-to-action button.
 *
 * BEFORE THIS KIND, a button was a `card` whose title happened to say "Start
 * now": a rectangle of text with no affordance. This kind draws the actual
 * button — a filled, glassed, outlined or pill treatment with a label, an
 * optional sub-label and an optional glyph.
 *
 * THE GLYPHS ARE VECTOR PATHS. The repository forbids emoji anywhere (rule
 * 11, `npm run verify:no-emoji` is a gate), so an icon is a NAME in a closed
 * set and is drawn as an inline SVG path — never as a character.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** The vector glyphs, as 24×24 SVG paths. */
const ICON_PATHS: Record<"arrow" | "sparkles" | "play", { d: string; fill: boolean }[]> = {
  arrow: [
    { d: "M4 12h14", fill: false },
    { d: "M12.5 6.5 19 12l-6.5 5.5", fill: false },
  ],
  sparkles: [
    { d: "M12 3.5c.6 3.4 1.6 4.4 5 5-3.4.6-4.4 1.6-5 5-.6-3.4-1.6-4.4-5-5 3.4-.6 4.4-1.6 5-5Z", fill: true },
    { d: "M18.5 13.5c.35 1.9.9 2.45 2.8 2.8-1.9.35-2.45.9-2.8 2.8-.35-1.9-.9-2.45-2.8-2.8 1.9-.35 2.45-.9 2.8-2.8Z", fill: true },
  ],
  play: [{ d: "M8.5 5.4v13.2L19 12 8.5 5.4Z", fill: true }],
};

function buildIcon(icon: string, sizePx: number, color: string): SVGSVGElement | null {
  if (icon !== "arrow" && icon !== "sparkles" && icon !== "play") return null;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(sizePx));
  svg.setAttribute("height", String(sizePx));
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "display:block;flex:none;";
  for (const part of ICON_PATHS[icon]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", part.d);
    if (part.fill) {
      path.setAttribute("fill", color);
    } else {
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", "2.2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
    }
    svg.appendChild(path);
  }
  return svg;
}

export function renderCta(layer: CtaLayer, ctx: LayerContext): { content: HTMLElement } {
  const label = typeof layer.label === "string" ? layer.label : "";
  const sublabel = typeof layer.sublabel === "string" ? layer.sublabel : "";
  const accent = safeColor(layer.accentColor, "#38bdf8");
  const bgColor = typeof layer.bgColor === "string" && layer.bgColor.trim().length > 0 ? layer.bgColor : undefined;
  const textColor =
    typeof layer.textColor === "string" && layer.textColor.trim().length > 0 ? layer.textColor : undefined;
  const variant = layer.variant === "glass" || layer.variant === "outline" || layer.variant === "pill" ? layer.variant : "primary";
  const heightPx = clamp(num(layer.heightPx, 76), 16, 400);
  const radiusPx = clamp(num(layer.radiusPx, 38), 0, 200);
  const labelSizePx = clamp(num(layer.labelSizePx, 30), 8, 96);
  const widthPx = num(layer.widthPx, NaN);

  // ---- the paint -----------------------------------------------------------
  let background: string;
  let border: string;
  let borderWidth = "1px";
  let shadow: string;
  let ink: string;

  if (variant === "primary" || variant === "pill") {
    background = variant === "pill" ? (bgColor ?? accent) : accent;
    border = "1px solid " + withAlpha(background, 0.9);
    shadow = `0 16px 40px ${withAlpha(background, 0.34)}`;
    const defaultInk = contrastInk(background) === "#ffffff" ? "var(--mf-text-primary, #ffffff)" : "#0b1020";
    ink = textColor ?? defaultInk;
  } else if (variant === "glass") {
    const tint = bgColor ?? accent;
    background = `color-mix(in srgb, ${tint} 18%, transparent)`;
    border = "1px solid rgba(255,255,255,0.26)";
    shadow = "0 20px 46px rgba(0,0,0,0.34)";
    ink = textColor ?? "var(--mf-text-primary, #ffffff)";
  } else {
    // outline
    background = bgColor ?? "transparent";
    border = `2px solid ${accent}`;
    shadow = `0 14px 34px ${withAlpha(accent, 0.18)}`;
    ink = textColor ?? accent;
  }

  const radius = variant === "pill" ? Math.max(heightPx / 2, radiusPx) : radiusPx;

  // ---- the button ----------------------------------------------------------
  // The host is the layer's CONTENT element: the unified transform pipeline
  // owns its transform and the bounds report measures its first child — so
  // the button (not the icon inside it) is what gets measured.
  const host = document.createElement("div");
  host.style.cssText = [
    "position:absolute",
    `left:${clamp(num(layer.position?.xPct, 50), -300, 300)}%`,
    `top:${clamp(num(layer.position?.yPct, 50), -300, 300)}%`,
    "display:flex",
    "max-width:100%",
  ].join(";");

  const button = document.createElement("div");
  button.style.cssText = [
    "display:flex",
    "align-items:center",
    "justify-content:center",
    `gap:${Math.round(labelSizePx * 0.5)}px`,
    "box-sizing:border-box",
    `min-height:${heightPx}px`,
    Number.isFinite(widthPx) ? `width:${clamp(widthPx, 80, 1200)}px` : "width:max-content",
    `padding:0 ${Math.round(labelSizePx * 1.15)}px`,
    `border-radius:${Math.round(radius)}px`,
    `background:${background}`,
    `border:${border}`,
    `box-shadow:${shadow}`,
    `color:${ink}`,
    "max-width:100%",
    variant === "glass"
      ? "backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);"
      : "",
    `font-family:${fontFamilyFor(ctx.fonts, "headline")}`,
    CRISP_TEXT_CSS,
  ].join(";");

  const icon = buildIcon(
    typeof layer.icon === "string" ? layer.icon : "arrow",
    Math.round(labelSizePx * 0.92),
    ink
  );
  if (icon) button.appendChild(icon);

  const text = document.createElement("div");
  text.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "justify-content:center",
    "gap:2px",
    "min-width:0",
  ].join(";");

  const labelEl = document.createElement("div");
  labelEl.style.cssText = [
    `font-size:${labelSizePx}px`,
    "font-weight:800",
    "line-height:1.15",
    `color:${ink}`,
    "white-space:nowrap",
  ].join(";");
  labelEl.textContent = label;
  text.appendChild(labelEl);

  if (sublabel.length > 0) {
    const subEl = document.createElement("div");
    subEl.style.cssText = [
      `font-size:${Math.max(10, Math.round(labelSizePx * 0.5))}px`,
      "font-weight:500",
      "line-height:1.2",
      `color:${withAlpha(ink, 0.72)}`,
      "white-space:nowrap",
    ].join(";");
    subEl.textContent = sublabel;
    text.appendChild(subEl);
  }
  button.appendChild(text);
  host.appendChild(button);

  ctx.content.appendChild(host);
  return { content: host };
}
