import type { ComparisonSplitLayer } from "@motionforge/scene-spec";
import { CRISP_TEXT_CSS } from "../determinism.js";
import { fontFamilyFor } from "../fonts.js";
import { clamp, num, safeColor, text } from "./guards.js";
import type { LayerContext } from "./context.js";

function createCrossSvg(color: string): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "mf-comparison-indicator mf-indicator-cross");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.style.flexShrink = "0";

  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "10");
  circle.setAttribute("fill", `color-mix(in srgb, ${color} 18%, transparent)`);
  circle.setAttribute("stroke", color);
  circle.setAttribute("stroke-width", "1.8");
  svg.appendChild(circle);

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M8.5 8.5l7 7M15.5 8.5l-7 7");
  path.setAttribute("stroke", color);
  path.setAttribute("stroke-width", "2.2");
  path.setAttribute("stroke-linecap", "round");
  svg.appendChild(path);

  return svg;
}

function createCheckSvg(color: string): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "mf-comparison-indicator mf-indicator-check");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.style.flexShrink = "0";

  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "10");
  circle.setAttribute("fill", `color-mix(in srgb, ${color} 18%, transparent)`);
  circle.setAttribute("stroke", color);
  circle.setAttribute("stroke-width", "1.8");
  svg.appendChild(circle);

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M7.5 12l3 3 6-6.5");
  path.setAttribute("stroke", color);
  path.setAttribute("stroke-width", "2.2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("fill", "none");
  svg.appendChild(path);

  return svg;
}

export function renderComparisonSplit(
  layer: ComparisonSplitLayer,
  ctx: LayerContext
): { content: HTMLElement } {
  const leftAccent = safeColor(layer.leftAccent, "#ef4444");
  const rightAccent = safeColor(layer.rightAccent, "#10b981");
  const leftItems = Array.isArray(layer.leftItems) ? layer.leftItems : [];
  const rightItems = Array.isArray(layer.rightItems) ? layer.rightItems : [];

  const host = document.createElement("div");
  host.className = "mf-layer-comparison-split";
  host.style.cssText = [
    "position:absolute",
    `left:${clamp(num(layer.position?.xPct, 50), -300, 300)}%`,
    `top:${clamp(num(layer.position?.yPct, 50), -300, 300)}%`,
    "box-sizing:border-box",
  ].join(";");

  const headingFont = fontFamilyFor(ctx.fonts, "headline");
  const bodyFont = fontFamilyFor(ctx.fonts, "body");

  // Glass card container
  const card = document.createElement("div");
  card.className = "mf-comparison-card";
  card.style.cssText = [
    "position:relative",
    "display:flex",
    "width:min(1160px, 100%)",
    "margin:0 auto",
    "box-sizing:border-box",
    "border-radius:24px",
    "padding:40px 48px",
    "background:linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.02) 100%), rgba(15, 23, 42, 0.78)",
    "border:1px solid rgba(255, 255, 255, 0.12)",
    "box-shadow:0 24px 60px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
    "backdrop-filter:blur(20px)",
    "-webkit-backdrop-filter:blur(20px)",
    CRISP_TEXT_CSS,
  ].join(";");

  // Left Column
  const leftCol = document.createElement("div");
  leftCol.className = "mf-comparison-col mf-comparison-left";
  leftCol.style.cssText = [
    "flex:1",
    "display:flex",
    "flex-direction:column",
    "padding-right:44px",
    "border-right:1px solid rgba(255, 255, 255, 0.08)",
    "box-sizing:border-box",
  ].join(";");

  const leftTitleEl = document.createElement("h3");
  leftTitleEl.className = "mf-comparison-title mf-comparison-left-title";
  leftTitleEl.textContent = text(layer.leftTitle, "");
  leftTitleEl.style.cssText = [
    `font-family:${headingFont}`,
    "font-size:26px",
    "font-weight:700",
    `color:${leftAccent}`,
    "margin:0 0 24px 0",
    "line-height:1.2",
  ].join(";");
  leftCol.appendChild(leftTitleEl);

  const leftList = document.createElement("div");
  leftList.className = "mf-comparison-list";
  leftList.style.cssText = "display:flex;flex-direction:column;gap:18px;";
  leftCol.appendChild(leftList);

  // Right Column
  const rightCol = document.createElement("div");
  rightCol.className = "mf-comparison-col mf-comparison-right";
  rightCol.style.cssText = [
    "flex:1",
    "display:flex",
    "flex-direction:column",
    "padding-left:44px",
    "box-sizing:border-box",
  ].join(";");

  const rightTitleEl = document.createElement("h3");
  rightTitleEl.className = "mf-comparison-title mf-comparison-right-title";
  rightTitleEl.textContent = text(layer.rightTitle, "");
  rightTitleEl.style.cssText = [
    `font-family:${headingFont}`,
    "font-size:26px",
    "font-weight:700",
    `color:${rightAccent}`,
    "margin:0 0 24px 0",
    "line-height:1.2",
  ].join(";");
  rightCol.appendChild(rightTitleEl);

  const rightList = document.createElement("div");
  rightList.className = "mf-comparison-list";
  rightList.style.cssText = "display:flex;flex-direction:column;gap:18px;";
  rightCol.appendChild(rightList);

  // Populate left rows
  leftItems.forEach((itemText, rowIndex) => {
    const rowEl = document.createElement("div");
    rowEl.className = "mf-comparison-row mf-comparison-item";
    rowEl.dataset.rowIndex = String(rowIndex);
    rowEl.dataset.col = "left";
    rowEl.style.cssText = [
      "display:flex",
      "align-items:center",
      "gap:14px",
      "box-sizing:border-box",
      "opacity:0",
    ].join(";");

    const icon = createCrossSvg(leftAccent);
    rowEl.appendChild(icon);

    const span = document.createElement("span");
    span.className = "mf-comparison-text";
    span.textContent = text(itemText, "");
    span.style.cssText = [
      `font-family:${bodyFont}`,
      "font-size:17px",
      "font-weight:500",
      "color:#e2e8f0",
      "line-height:1.4",
    ].join(";");
    rowEl.appendChild(span);

    leftList.appendChild(rowEl);

    // Stagger animation on inner row element
    const startSec = ctx.layerAtSec + 0.08 * rowIndex;
    ctx.tl.fromTo(
      rowEl,
      { opacity: 0, x: -14 },
      {
        opacity: 1,
        x: 0,
        duration: 0.35,
        ease: "power2.out",
        immediateRender: false,
      },
      startSec
    );
  });

  // Populate right rows
  rightItems.forEach((itemText, rowIndex) => {
    const rowEl = document.createElement("div");
    rowEl.className = "mf-comparison-row mf-comparison-item";
    rowEl.dataset.rowIndex = String(rowIndex);
    rowEl.dataset.col = "right";
    rowEl.style.cssText = [
      "display:flex",
      "align-items:center",
      "gap:14px",
      "box-sizing:border-box",
      "opacity:0",
    ].join(";");

    const icon = createCheckSvg(rightAccent);
    rowEl.appendChild(icon);

    const span = document.createElement("span");
    span.className = "mf-comparison-text";
    span.textContent = text(itemText, "");
    span.style.cssText = [
      `font-family:${bodyFont}`,
      "font-size:17px",
      "font-weight:500",
      "color:#e2e8f0",
      "line-height:1.4",
    ].join(";");
    rowEl.appendChild(span);

    rightList.appendChild(rowEl);

    // Stagger animation on inner row element
    const startSec = ctx.layerAtSec + 0.08 * rowIndex;
    ctx.tl.fromTo(
      rowEl,
      { opacity: 0, x: 14 },
      {
        opacity: 1,
        x: 0,
        duration: 0.35,
        ease: "power2.out",
        immediateRender: false,
      },
      startSec
    );
  });

  card.appendChild(leftCol);
  card.appendChild(rightCol);

  // Central vsBadge pill absolutely centred between columns
  const vsWrapper = document.createElement("div");
  vsWrapper.className = "mf-comparison-vs-wrap";
  vsWrapper.style.cssText = [
    "position:absolute",
    "left:50%",
    "top:50%",
    "transform:translate(-50%, -50%)",
    "z-index:5",
    "pointer-events:none",
  ].join(";");

  const vsPill = document.createElement("div");
  vsPill.className = "mf-comparison-vs mf-comparison-vs-badge";
  vsPill.textContent = text(layer.vsBadge, "VS");
  vsPill.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "justify-content:center",
    "min-width:44px",
    "height:44px",
    "padding:0 12px",
    "border-radius:9999px",
    "font-size:14px",
    "font-weight:800",
    "letter-spacing:0.06em",
    `font-family:${headingFont}`,
    "color:#ffffff",
    "background:#1e293b",
    "border:1px solid rgba(255, 255, 255, 0.22)",
    "box-shadow:0 8px 24px rgba(0, 0, 0, 0.45)",
    "opacity:0",
  ].join(";");
  vsWrapper.appendChild(vsPill);
  card.appendChild(vsWrapper);

  // Subtle scale pop at layerAtSec + 0.15 s
  ctx.tl.fromTo(
    vsPill,
    { scale: 0, opacity: 0 },
    {
      scale: 1,
      opacity: 1,
      duration: 0.35,
      ease: "back.out(1.7)",
      immediateRender: false,
    },
    ctx.layerAtSec + 0.15
  );

  host.appendChild(card);
  ctx.content.appendChild(host);

  return { content: host };
}
