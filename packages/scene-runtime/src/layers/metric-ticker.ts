import type { MetricTickerLayer } from "@motionforge/scene-spec";
import { CRISP_TEXT_CSS } from "../determinism.js";
import { fontFamilyFor } from "../fonts.js";
import { clamp, num, safeColor, text } from "./guards.js";
import type { LayerContext } from "./context.js";

export function renderMetricTicker(
  layer: MetricTickerLayer,
  ctx: LayerContext
): { content: HTMLElement } {
  const fromValue = num(layer.fromValue, 0);
  const toValue = num(layer.toValue, 0);
  const prefix = text(layer.prefix, "");
  const suffix = text(layer.suffix, "");
  const decimals = clamp(Math.round(num(layer.decimals, 0)), 0, 4);
  const countDurationSec = clamp(num(layer.countDurationMs, 1600), 200, 10_000) / 1000;
  const accent = safeColor(layer.accentColor, "#10b981");

  const host = document.createElement("div");
  host.className = "mf-layer-metric-ticker";
  host.style.cssText = [
    "position:absolute",
    `left:${clamp(num(layer.position?.xPct, 50), -300, 300)}%`,
    `top:${clamp(num(layer.position?.yPct, 50), -300, 300)}%`,
    "box-sizing:border-box",
  ].join(";");

  const container = document.createElement("div");
  container.className = "mf-metric-ticker";
  container.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "align-items:flex-start",
    "gap:12px",
    "box-sizing:border-box",
    CRISP_TEXT_CSS,
  ].join(";");

  // Uppercase label above
  const labelEl = document.createElement("div");
  labelEl.className = "mf-metric-label";
  labelEl.textContent = text(layer.label, "").toUpperCase();
  labelEl.style.cssText = [
    `font-family:${fontFamilyFor(ctx.fonts, "headline")}`,
    "font-size:16px",
    "font-weight:700",
    "letter-spacing:0.12em",
    "text-transform:uppercase",
    "color:#94a3b8",
    "margin:0",
  ].join(";");
  container.appendChild(labelEl);

  // Row for giant number and optional delta pill
  const valueRow = document.createElement("div");
  valueRow.className = "mf-metric-row";
  valueRow.style.cssText = [
    "display:flex",
    "align-items:baseline",
    "gap:20px",
    "white-space:nowrap",
  ].join(";");

  const monoFont = `${fontFamilyFor(ctx.fonts, "metric")}, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;

  const valueEl = document.createElement("div");
  valueEl.className = "mf-metric-value";
  valueEl.style.cssText = [
    `font-family:${monoFont}`,
    "font-size:84px",
    "font-weight:800",
    "line-height:1",
    "letter-spacing:-0.03em",
    "font-variant-numeric:tabular-nums",
    `color:${layer.accentColor ? accent : "#f8fafc"}`,
    "margin:0",
  ].join(";");
  valueRow.appendChild(valueEl);

  // Optional delta pill
  if (layer.deltaBadge) {
    const pill = document.createElement("span");
    pill.className = "mf-metric-delta mf-metric-badge";
    pill.textContent = layer.deltaBadge;
    pill.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "padding:6px 14px",
      "border-radius:9999px",
      "font-size:16px",
      "font-weight:700",
      `font-family:${fontFamilyFor(ctx.fonts, "headline")}`,
      `color:${accent}`,
      `background:color-mix(in srgb, ${accent} 16%, transparent)`,
      `border:1px solid color-mix(in srgb, ${accent} 36%, transparent)`,
      "opacity:0",
      "flex-shrink:0",
    ].join(";");
    valueRow.appendChild(pill);

    // Subtle rise-in at layerAtSec + 0.25 s
    ctx.tl.fromTo(
      pill,
      { opacity: 0, y: 8 },
      {
        opacity: 1,
        y: 0,
        duration: 0.35,
        ease: "power2.out",
        immediateRender: false,
      },
      ctx.layerAtSec + 0.25
    );
  }

  container.appendChild(valueRow);
  host.appendChild(container);
  ctx.content.appendChild(host);

  // Number formatting
  const formatter = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  const updateValue = (tSec: number) => {
    const elapsed = tSec - ctx.layerAtSec;
    const p = clamp(elapsed / countDurationSec, 0, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = fromValue + (toValue - fromValue) * eased;
    valueEl.textContent = `${prefix}${formatter.format(val)}${suffix}`;
  };

  // Register seekable for deterministic playback & seekToFrame
  ctx.registerSeekable(async (tSec: number) => {
    updateValue(tSec);
  });

  // Timeline driver for scrubber, playback, and unit test seeks
  const driver = { t: 0 };
  const sceneDurationSec = Math.max(1, ctx.scene.durationMs) / 1000;
  ctx.tl.to(
    driver,
    {
      t: sceneDurationSec,
      duration: sceneDurationSec,
      ease: "none",
      onUpdate: () => {
        updateValue(ctx.tl.time());
      },
    },
    0
  );

  // Call once at build time with ctx.layerAtSec so first paint is right
  updateValue(ctx.layerAtSec);

  return { content: host };
}
