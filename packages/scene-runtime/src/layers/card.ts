import type { CardLayer } from "@motionforge/scene-spec";
import { CRISP_TEXT_CSS } from "../determinism.js";
import { SAFE_IMG_CSS } from "./image-logo.js";
import { fontFamilyFor } from "../fonts.js";
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

function glassCss(blurPx: number, tintColor: string, tintOpacity: number, borderOpacity: number): string {
  return [
    `backdrop-filter:blur(${blurPx}px)`,
    `-webkit-backdrop-filter:blur(${blurPx}px)`,
    `background:${tintColor}`,
    "background:" + `color-mix(in srgb, ${tintColor} ${Math.round(tintOpacity * 100)}%, transparent)`,
    `border:1px solid rgba(255,255,255,${borderOpacity})`,
    `box-shadow:0 24px 60px rgba(0,0,0,0.35)`,
  ].join(";");
}

export function renderCard(layer: CardLayer, ctx: LayerContext): { content: HTMLElement } {
  const v = layer.variant;
  const isRTL = resolveDirection(layer) === "rtl";
  const host = document.createElement("div");
  host.style.cssText = [
    "position:absolute",
    `left:${layer.position.xPct}%`,
    `top:${layer.position.yPct}%`,
    `transform:translate(-50%,-50%)${layer.rotation ? ` rotate(${layer.rotation}deg)` : ""}`,
  ].join(";");

  if (v.variant === "glassCard" || v.variant === "callout") {
    const card = document.createElement("div");
    card.dir = isRTL ? "rtl" : "ltr";
    const glass = v.glass ?? { blurPx: 20, tintColor: "#000000", tintOpacity: 0.5 };
    const paddingPx = v.paddingPx ?? 24;
    const radiusPx = v.radiusPx ?? 16;
    const borderOpacity = (v.variant === "glassCard" ? v.borderOpacity : 0.18) ?? 0.18;
    card.style.cssText = [
      "position:relative",
      `width:${v.widthPx ? `${v.widthPx}px` : "max-content"}`,
      "max-width:100%",
      `padding:${paddingPx}px`,
      `border-radius:${radiusPx}px`,
      glassCss(glass.blurPx ?? 20, glass.tintColor ?? "#000000", glass.tintOpacity ?? 0.5, borderOpacity),
    ].join(";");
    host.appendChild(card);

    if (v.variant === "callout") {
      const bar = document.createElement("div");
      bar.style.cssText = [
        "position:absolute",
        `top:0;bottom:0`,
        isRTL ? (v.accentSide === "left" ? "right:0" : "left:0") : (v.accentSide === "left" ? "left:0" : "right:0"),
        "width:6px",
        `border-radius:999px`,
        `background:${v.accentColor}`,
      ].join(";");
      card.appendChild(bar);
      if ((v.accentSide === "left" && !isRTL) || (v.accentSide === "right" && isRTL)) {
        card.style.paddingLeft = `${v.paddingPx + 14}px`;
      } else {
        card.style.paddingRight = `${v.paddingPx + 14}px`;
      }
    }

    if (v.variant === "glassCard" && v.iconAssetId) {
      const icon = document.createElement("img");
      icon.src = ctx.resolveAsset(v.iconAssetId);
      icon.style.cssText = `${SAFE_IMG_CSS};width:56px;height:56px;margin-bottom:12px;`;
      card.appendChild(icon);
    }

    const textAlign = isRTL ? "right" : "left";
    if (v.title) {
      const title = document.createElement("div");
      title.textContent = v.title;
      title.style.cssText = `font-family:${fontFamilyFor(ctx.fonts, "headline")};font-weight:800;font-size:34px;color:#fff;margin-bottom:10px;text-align:${textAlign};${CRISP_TEXT_CSS};`;
      card.appendChild(title);
    }
    if (v.body) {
      const body = document.createElement("div");
      body.textContent = v.body;
      body.style.cssText = `font-family:${fontFamilyFor(ctx.fonts, "body")};font-weight:400;font-size:22px;line-height:1.45;color:rgba(255,255,255,0.82);text-align:${textAlign};${CRISP_TEXT_CSS};`;
      card.appendChild(body);
    }
  } else if (v.variant === "progressBar") {
    const col = document.createElement("div");
    col.style.cssText = `width:${v.widthPx ? `${v.widthPx}px` : "520px"};position:relative;`;
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

    if (v.label) {
      const label = document.createElement("div");
      label.textContent = v.label;
      label.style.cssText = `font-family:${fontFamilyFor(ctx.fonts, "body")};font-weight:600;font-size:24px;color:#fff;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${CRISP_TEXT_CSS};`;
      header.appendChild(label);
    }

    const track = document.createElement("div");
    track.style.cssText = `position:relative;height:${v.heightPx}px;border-radius:${Math.min(v.radiusPx, v.heightPx / 2)}px;background:${v.trackColor};overflow:hidden;`;
    col.appendChild(track);

    const fill = document.createElement("div");
    fill.style.cssText = "position:absolute;inset:0;width:0%;";
    if (isRTL) {
      fill.style.transformOrigin = "right center";
    }
    applyPaintBackground(fill, v.fill);
    track.appendChild(fill);

    ctx.tl.to(fill, {
      width: `${v.value}%`,
      duration: 1.3,
      ease: "power3.out",
    }, ctx.layerAtSec + 0.15);

    if (v.showPercentage) {
      const pctText = document.createElement("div");
      pctText.style.cssText = [
        `font-family:${fontFamilyFor(ctx.fonts, "metric")}`,
        "font-weight:800",
        "font-size:26px",
        "color:#fff",
        "flex:none",
        "font-variant-numeric:tabular-nums",
        "direction:ltr",
        CRISP_TEXT_CSS,
      ].join(";");
      header.appendChild(pctText);
      const proxy = { n: 0 };
      ctx.tl.to(proxy, {
        n: v.value,
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
    const num = document.createElement("div");
    num.dir = isRTL ? "rtl" : "ltr";
    num.style.cssText = `font-family:${fontFamilyFor(ctx.fonts, v2.role)};font-weight:800;font-size:${v2.sizePx}px;color:#fff;font-variant-numeric:tabular-nums;${CRISP_TEXT_CSS};`;
    host.appendChild(num);

    const fmt = new Intl.NumberFormat(v2.locale ?? "en-US", {
      minimumFractionDigits: v2.decimals,
      maximumFractionDigits: v2.decimals,
    });
    const proxy = { n: v2.from };
    const render = () => {
      num.textContent = `${v2.prefix}${fmt.format(proxy.n)}${v2.suffix}`;
    };
    render();
    ctx.tl.to(proxy, {
      n: v2.to,
      duration: 1.6,
      ease: "power2.out",
      onUpdate: render,
    }, ctx.layerAtSec + 0.1);
  }

  ctx.content.appendChild(host);
  return { content: host };
}

function applyPaintBackground(el: HTMLElement, fill: Parameters<typeof paintToCss>[0]): void {
  el.style.background = paintToCss(fill);
}

function paintToCss(fill: string | { type: "linear"; angleDeg: number; stops: { color: string; at: number }[] }): string {
  if (typeof fill === "string") return fill;
  const stops = fill.stops.map((s) => `${s.color} ${s.at}%`).join(", ");
  return `linear-gradient(${fill.angleDeg}deg, ${stops})`;
}
