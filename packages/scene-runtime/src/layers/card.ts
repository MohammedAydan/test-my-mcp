import type { CardLayer, Paint } from "@motionforge/scene-spec";
import { CRISP_TEXT_CSS } from "../determinism.js";
import { SAFE_IMG_CSS } from "./image-logo.js";
import { fontFamilyFor } from "../fonts.js";
import { clamp, num, safeColor } from "./guards.js";
import type { LayerContext } from "./context.js";

/** True when the string contains any Arabic script (U+0600–U+06FF). */
function hasArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

/** Returns "rtl" when the layer should be laid out right-to-left. */
function resolveDirection(layer: CardLayer): "ltr" | "rtl" {
  if (layer.direction === "rtl") return "rtl";
  const texts = [
    layer.variant.variant === "progressBar" ? layer.variant.label : undefined,
    layer.variant.variant === "glassCard" || layer.variant.variant === "callout"
      ? [layer.variant.title, layer.variant.body]
      : [],
    layer.variant.variant === "counter" ? [layer.variant.prefix, layer.variant.suffix] : [],
  ].flat();
  return texts.some((t): t is string => typeof t === "string" && hasArabic(t)) ? "rtl" : "ltr";
}

function glassCss(
  blurPx: number,
  tintColor: string,
  tintOpacity: number,
  borderOpacity: number,
  hasExplicitTintColor = false
): string {
  const defaultBg = `color-mix(in srgb, ${tintColor} ${Math.round(tintOpacity * 100)}%, transparent)`;
  const backgroundRule = hasExplicitTintColor
    ? `background:${tintColor};background:${defaultBg}`
    : `background:${tintColor};background:var(--mf-card-bg, ${defaultBg})`;
  const borderRule = `border:1px solid var(--mf-card-border, rgba(255,255,255,${borderOpacity}))`;
  return [
    `backdrop-filter:blur(${blurPx}px)`,
    `-webkit-backdrop-filter:blur(${blurPx}px)`,
    backgroundRule,
    borderRule,
    `box-shadow:0 24px 60px rgba(0,0,0,0.35)`,
  ].join(";");
}

export function renderCard(layer: CardLayer, ctx: LayerContext): { content: HTMLElement } {
  const v = layer.variant;
  const isRTL = resolveDirection(layer) === "rtl";
  const host = document.createElement("div");
  // The anchor is authored here; the transform belongs to the unified
  // pipeline (`../transform.js`), which is the only writer of it.
  host.style.cssText = [
    "position:absolute",
    `left:${clamp(num(layer.position?.xPct, 50), -300, 300)}%`,
    `top:${clamp(num(layer.position?.yPct, 50), -300, 300)}%`,
  ].join(";");

  if (v.variant === "glassCard" || v.variant === "callout") {
    const card = document.createElement("div");
    card.dir = isRTL ? "rtl" : "ltr";
    const glass = v.glass ?? { blurPx: 20, tintColor: "#000000", tintOpacity: 0.5 };
    const paddingPx = clamp(num(v.paddingPx, 24), 0, 400);
    const radiusPx = clamp(num(v.radiusPx, 16), 0, 400);
    const borderOpacity = clamp(
      num(v.variant === "glassCard" ? v.borderOpacity : 0.18, 0.18),
      0,
      1
    );
    const widthPx = num(v.widthPx, Number.NaN);
    const hasExplicitTintColor =
      Boolean((v as { glass?: { tintColor?: string } }).glass?.tintColor) &&
      (v as { glass?: { tintColor?: string } }).glass?.tintColor !== "#000000" &&
      (v as { glass?: { tintColor?: string } }).glass?.tintColor !== "#0b0f1a";
    card.style.cssText = [
      "position:relative",
      Number.isFinite(widthPx) ? `width:${clamp(widthPx, 0, 4000)}px` : "width:max-content",
      "max-width:100%",
      `padding:${paddingPx}px`,
      `border-radius:${radiusPx}px`,
      glassCss(
        clamp(num(glass.blurPx, 20), 0, 200),
        safeColor(glass.tintColor, "#000000"),
        clamp(num(glass.tintOpacity, 0.5), 0, 1),
        borderOpacity,
        hasExplicitTintColor
      ),
    ].join(";");
    host.appendChild(card);

    if (v.variant === "callout") {
      const bar = document.createElement("div");
      const accentColor = safeColor(v.accentColor, "#38bdf8");
      bar.style.cssText = [
        "position:absolute",
        `top:0;bottom:0`,
        isRTL ? (v.accentSide === "left" ? "right:0" : "left:0") : (v.accentSide === "left" ? "left:0" : "right:0"),
        "width:6px",
        `border-radius:999px`,
        `background:${accentColor}`,
      ].join(";");
      card.appendChild(bar);
      if ((v.accentSide === "left" && !isRTL) || (v.accentSide === "right" && isRTL)) {
        card.style.paddingLeft = `${paddingPx + 14}px`;
      } else {
        card.style.paddingRight = `${paddingPx + 14}px`;
      }
    }

    if (v.variant === "glassCard" && v.iconAssetId) {
      const icon = document.createElement("img");
      // an undeclared asset must not take the preview down
      let resolved = "";
      try {
        resolved = ctx.resolveAsset(v.iconAssetId);
      } catch {
        resolved = "";
      }
      if (resolved.length > 0) {
        icon.src = resolved;
        icon.style.cssText = `${SAFE_IMG_CSS};width:56px;height:56px;margin-bottom:12px;`;
        card.appendChild(icon);
      }
    }

    const textAlign = isRTL ? "right" : "left";
    if (typeof v.title === "string" && v.title.length > 0) {
      const title = document.createElement("div");
      title.textContent = v.title;
      title.style.cssText = `font-family:${fontFamilyFor(ctx.fonts, "headline")};font-weight:800;font-size:34px;color:var(--mf-text-primary, #fff);margin-bottom:10px;text-align:${textAlign};${CRISP_TEXT_CSS};`;
      card.appendChild(title);
    }
    if (typeof v.body === "string" && v.body.length > 0) {
      const body = document.createElement("div");
      body.textContent = v.body;
      body.style.cssText = `font-family:${fontFamilyFor(ctx.fonts, "body")};font-weight:400;font-size:22px;line-height:1.45;color:var(--mf-text-secondary, rgba(255,255,255,0.82));text-align:${textAlign};${CRISP_TEXT_CSS};`;
      card.appendChild(body);
    }
  } else if (v.variant === "progressBar") {
    const col = document.createElement("div");
    const widthPx = num(v.widthPx, Number.NaN);
    col.style.cssText = `width:${Number.isFinite(widthPx) ? `${clamp(widthPx, 0, 4000)}px` : "520px"};position:relative;`;
    host.appendChild(col);

    // Header row: the label and the live percentage share one flex line pinned
    // to the card width.
    const header = document.createElement("div");
    header.dir = isRTL ? "rtl" : "ltr";
    header.style.cssText = [
      "display:flex",
      "align-items:baseline",
      "justify-content:space-between",
      "gap:16px",
      "width:100%",
      "margin-bottom:12px",
      "overflow:hidden",
    ].join(";");
    col.appendChild(header);

    if (typeof v.label === "string" && v.label.length > 0) {
      const label = document.createElement("div");
      label.textContent = v.label;
      label.style.cssText = `font-family:${fontFamilyFor(ctx.fonts, "body")};font-weight:600;font-size:24px;color:var(--mf-text-primary, #fff);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${CRISP_TEXT_CSS};`;
      header.appendChild(label);
    }

    const heightPx = clamp(num(v.heightPx, 18), 1, 400);
    const radiusPx = clamp(num(v.radiusPx, 120), 0, 400);
    const track = document.createElement("div");
    track.style.cssText = `position:relative;height:${heightPx}px;border-radius:${Math.min(radiusPx, heightPx / 2)}px;background:${safeColor(v.trackColor, "rgba(255,255,255,0.12)")};overflow:hidden;`;
    col.appendChild(track);

    const fill = document.createElement("div");
    fill.style.cssText = "position:absolute;inset:0;width:0%;";
    if (isRTL) {
      fill.style.transformOrigin = "right center";
    }
    applyPaintBackground(fill, v.fill);
    track.appendChild(fill);

    // The value is a PERCENT: a malformed one (a string, a NaN, a value out
    // of range) would animate `width: NaN%` and collapse the fill.
    const value = clamp(num(v.value, 0), 0, 100);
    ctx.tl.to(fill, {
      width: `${value}%`,
      duration: 1.3,
      ease: "power3.out",
    }, ctx.layerAtSec + 0.15);

    if (v.showPercentage === true) {
      const pctText = document.createElement("div");
      pctText.style.cssText = [
        `font-family:${fontFamilyFor(ctx.fonts, "metric")}`,
        "font-weight:800",
        "font-size:26px",
        "color:var(--mf-text-primary, #fff)",
        "flex:none",
        "font-variant-numeric:tabular-nums",
        "direction:ltr",
        CRISP_TEXT_CSS,
      ].join(";");
      header.appendChild(pctText);
      const proxy = { n: 0 };
      ctx.tl.to(proxy, {
        n: value,
        duration: 1.3,
        ease: "power3.out",
        onUpdate: () => {
          pctText.textContent = `${Math.round(proxy.n)}%`;
        },
      }, ctx.layerAtSec + 0.15);
    }
  } else {
    // counter
    const v2 = v.variant === "counter" ? v : undefined;
    if (!v2) throw new Error("unreachable card variant");
    const num2 = document.createElement("div");
    num2.dir = isRTL ? "rtl" : "ltr";
    const sizePx = clamp(num(v2.sizePx, 120), 8, 800);
    num2.style.cssText = `font-family:${fontFamilyFor(ctx.fonts, v2.role)};font-weight:800;font-size:${sizePx}px;color:var(--mf-text-primary, #fff);font-variant-numeric:tabular-nums;${CRISP_TEXT_CSS};`;
    host.appendChild(num2);

    const decimals = clamp(Math.round(num(v2.decimals, 0)), 0, 20);
    const formatter = makeFormatter(v2.locale, decimals);
    const from = num(v2.from, 0);
    const to = num(v2.to, from);
    const prefix = typeof v2.prefix === "string" ? v2.prefix : "";
    const suffix = typeof v2.suffix === "string" ? v2.suffix : "";
    const proxy = { n: from };
    const render = () => {
      num2.textContent = `${prefix}${formatter.format(proxy.n)}${suffix}`;
    };
    render();
    ctx.tl.to(proxy, {
      n: to,
      duration: 1.6,
      ease: "power2.out",
      onUpdate: render,
    }, ctx.layerAtSec + 0.1);
  }

  ctx.content.appendChild(host);
  return { content: host };
}

/**
 * A number formatter that never throws.
 *
 * `Intl.NumberFormat` rejects an invalid locale with a `RangeError`, and a
 * malformed `decimals` (a float, a NaN) is out of range too — either one
 * would take the whole preview down for a cosmetic reason.
 */
function makeFormatter(locale: string | undefined, decimals: number): Intl.NumberFormat {
  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  };
  try {
    return new Intl.NumberFormat(typeof locale === "string" && locale.length > 0 ? locale : "en-US", options);
  } catch {
    try {
      return new Intl.NumberFormat("en-US", options);
    } catch {
      return {
        format: (value: number) => value.toFixed(decimals),
      } as Intl.NumberFormat;
    }
  }
}

function applyPaintBackground(el: HTMLElement, fill: Paint | undefined): void {
  const css = paintToCss(fill);
  if (css) el.style.background = css;
}

/**
 * A paint → a CSS background.
 *
 * A MALFORMED paint must not throw: the old implementation did
 * `fill.stops.map(...)` on whatever it was handed, so a card whose `fill`
 * was missing took the preview down with a `TypeError`.
 */
function paintToCss(fill: Paint | undefined): string {
  if (typeof fill === "string") return fill;
  if (fill && typeof fill === "object" && Array.isArray((fill as { stops?: unknown }).stops)) {
    const gradient = fill as { angleDeg?: number; stops: Array<{ color: string; at: number }> };
    const stops = gradient.stops
      .filter((s) => s && typeof s.color === "string")
      .map((s) => `${s.color} ${num(s.at, 0)}%`)
      .join(", ");
    if (stops.length === 0) return "";
    return `linear-gradient(${num(gradient.angleDeg, 90)}deg, ${stops})`;
  }
  return "";
}
