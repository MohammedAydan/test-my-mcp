import type { BentoCell, BentoGridLayer } from "@motionforge/scene-spec";
import { CRISP_TEXT_CSS } from "../determinism.js";
import { fontFamilyFor } from "../fonts.js";
import { clamp, num, safeColor, text } from "./guards.js";
import type { LayerContext } from "./context.js";

export function renderBentoGrid(
  layer: BentoGridLayer,
  ctx: LayerContext
): { content: HTMLElement } {
  const columns = layer.columns === 2 ? 2 : 3;
  const cells: BentoCell[] = Array.isArray(layer.cells) ? layer.cells : [];
  const staggerMs = typeof layer.staggerMs === "number" ? clamp(layer.staggerMs, 0, 600) : 110;

  const host = document.createElement("div");
  host.className = "mf-layer-bento-grid";
  host.style.cssText = [
    "position:absolute",
    `left:${clamp(num(layer.position?.xPct, 50), -300, 300)}%`,
    `top:${clamp(num(layer.position?.yPct, 50), -300, 300)}%`,
    "width:1280px",
    "box-sizing:border-box",
  ].join(";");

  const grid = document.createElement("div");
  grid.className = "mf-bento-grid";
  grid.style.cssText = [
    "display:grid",
    `grid-template-columns:repeat(${columns}, 1fr)`,
    "gap:20px",
    "width:100%",
    "box-sizing:border-box",
  ].join(";");

  const headlineFont = fontFamilyFor(ctx.fonts, "headline");
  const bodyFont = fontFamilyFor(ctx.fonts, "body");

  cells.forEach((cell, i) => {
    const cellEl = document.createElement("div");
    cellEl.className = "mf-bento-card mf-bento-cell";
    cellEl.dataset.cellIndex = String(i);

    const spanCols = typeof cell.spanCols === "number" ? clamp(cell.spanCols, 1, columns) : 1;
    const accent = safeColor(cell.accentColor, "#38bdf8");

    // Glassmorphic styling with 1px gradient border (accent tint)
    cellEl.style.cssText = [
      `grid-column:span ${spanCols}`,
      "position:relative",
      "display:flex",
      "flex-direction:column",
      "justify-content:space-between",
      "padding:28px",
      "border-radius:18px",
      "box-sizing:border-box",
      "min-height:180px",
      "background:linear-gradient(135deg, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0.02) 100%), rgba(15, 23, 42, 0.72)",
      `border:1px solid color-mix(in srgb, ${accent} 45%, rgba(255, 255, 255, 0.12))`,
      "box-shadow:0 20px 45px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
      "backdrop-filter:blur(16px)",
      "-webkit-backdrop-filter:blur(16px)",
      "overflow:hidden",
      CRISP_TEXT_CSS,
    ].join(";");

    // Header section: title and optional badge pill
    const topRow = document.createElement("div");
    topRow.style.cssText =
      "display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px;";

    const titleEl = document.createElement("h3");
    titleEl.className = "mf-bento-title";
    titleEl.textContent = text(cell.title, "");
    titleEl.style.cssText = [
      `font-family:${headlineFont}`,
      "font-size:22px",
      "font-weight:700",
      "color:#f8fafc",
      "margin:0",
      "line-height:1.25",
    ].join(";");
    topRow.appendChild(titleEl);

    if (cell.badge) {
      const badgeEl = document.createElement("span");
      badgeEl.className = "mf-bento-badge";
      badgeEl.textContent = cell.badge;
      badgeEl.style.cssText = [
        "display:inline-flex",
        "align-items:center",
        "padding:3px 10px",
        "border-radius:9999px",
        "font-size:11px",
        "font-weight:600",
        `font-family:${bodyFont}`,
        `color:${accent}`,
        `background:color-mix(in srgb, ${accent} 15%, transparent)`,
        `border:1px solid color-mix(in srgb, ${accent} 35%, transparent)`,
        "white-space:nowrap",
        "flex-shrink:0",
      ].join(";");
      topRow.appendChild(badgeEl);
    }
    cellEl.appendChild(topRow);

    // Metric value (if present)
    if (cell.metricValue) {
      const metricEl = document.createElement("div");
      metricEl.className = "mf-bento-metric";
      metricEl.textContent = cell.metricValue;
      metricEl.style.cssText = [
        `font-family:${headlineFont}`,
        "font-size:48px",
        "font-weight:800",
        "line-height:1.1",
        "letter-spacing:-0.02em",
        `color:${accent}`,
        "margin:8px 0 12px 0",
      ].join(";");
      cellEl.appendChild(metricEl);
    }

    // Subtitle (if present)
    if (cell.subtitle) {
      const subEl = document.createElement("p");
      subEl.className = "mf-bento-subtitle";
      subEl.textContent = cell.subtitle;
      subEl.style.cssText = [
        `font-family:${bodyFont}`,
        "font-size:14px",
        "font-weight:400",
        "line-height:1.45",
        "color:#94a3b8",
        "margin:0",
      ].join(";");
      cellEl.appendChild(subEl);
    }

    grid.appendChild(cellEl);

    // Staggered entrance animation:
    // cell i starts at ctx.layerAtSec + i * staggerMs / 1000
    // opacity 0 -> 1 and translateY(18px) -> 0
    // GSAP tween on the CELL, not the layer root
    // duration 0.45 s, power2.out
    const cellStartSec = ctx.layerAtSec + (i * staggerMs) / 1000;
    cellEl.style.opacity = "0";
    cellEl.style.transform = "translateY(18px)";

    ctx.tl.fromTo(
      cellEl,
      { opacity: 0, y: 18 },
      {
        opacity: 1,
        y: 0,
        duration: 0.45,
        ease: "power2.out",
        immediateRender: false,
      },
      cellStartSec
    );
  });

  host.appendChild(grid);
  ctx.content.appendChild(host);

  return { content: host };
}
