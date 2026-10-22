import type { ChartLayer } from "@motionforge/scene-spec";
import { CRISP_TEXT_CSS } from "../determinism.js";
import { fontFamilyFor } from "../fonts.js";
import { clamp, num, safeColor } from "./guards.js";
import type { LayerContext } from "./context.js";

/**
 * The `chart` layer — a data visualisation drawn in PURE SVG.
 *
 * WHY SVG: a chart is geometry, and geometry has to stay crisp at every
 * rasterisation density (the engine renders 1080p AND 2160p from the same
 * scene), stay deterministic (no layout measurement, no wall clock) and cost
 * nothing at render time (no charting dependency, no canvas, no reflow).
 *
 * DEGRADE, NEVER THROW: `data` may be missing, empty or full of holes. The
 * renderer drops the unusable points, draws what is left, and never lets a
 * malformed payload escape as a `TypeError` — that would kill the preview for
 * every other layer in the scene.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** A datum that survived the validity check. */
interface Datum {
  label: string;
  value: number;
  color: string;
}

/** `8.9` → `"8.9"`, `8` → `"8"`, `8.905` → `"8.91"`. */
function formatValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const fixed = value.toFixed(2);
  return fixed.replace(/\.?0+$/, "");
}

export function renderChart(layer: ChartLayer, ctx: LayerContext): { content: HTMLElement } {
  const widthPx = clamp(num(layer.widthPx, 760), 120, 2000);
  const heightPx = clamp(num(layer.heightPx, 420), 80, 1200);
  const labelSize = clamp(num(layer.labelSizePx, 18), 8, 72);
  const accent = safeColor(layer.accentColor, "#38bdf8");
  const labelColor = safeColor(layer.labelColor, "#cbd5e1");
  const gridOpacity = clamp(num(layer.gridOpacity, 0.16), 0, 1);
  const showValues = layer.showValues === true;
  const title = typeof layer.title === "string" ? layer.title : "";

  // ---- the data -----------------------------------------------------------
  // A datum is usable only when it carries a finite value. A `NaN` value
  // would poison the scale of the whole chart, so it is dropped instead.
  const raw = Array.isArray(layer.data) ? layer.data : [];
  const data: Datum[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const value = (entry as { value?: unknown }).value;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const label = (entry as { label?: unknown }).label;
    data.push({
      label: typeof label === "string" ? label : "",
      value,
      color: safeColor((entry as { color?: unknown }).color, accent),
    });
  }

  // ---- the host ------------------------------------------------------------
  const host = document.createElement("div");
  host.style.cssText = [
    "position:absolute",
    `left:${clamp(num(layer.position?.xPct, 50), -300, 300)}%`,
    `top:${clamp(num(layer.position?.yPct, 50), -300, 300)}%`,
    `width:${widthPx}px`,
    `height:${heightPx}px`,
    "max-width:100%",
    CRISP_TEXT_CSS,
  ].join(";");

  const svg = svgEl("svg", {
    viewBox: `0 0 ${widthPx} ${heightPx}`,
    width: "100%",
    height: "100%",
    "font-family": fontFamilyFor(ctx.fonts, "body"),
    "shape-rendering": "geometricPrecision",
  });
  host.appendChild(svg);

  // ---- the layout ---------------------------------------------------------
  const titleH = title.length > 0 ? labelSize * 1.9 : 0;
  const padX = labelSize * 0.9;
  const padTop = clamp(titleH + labelSize * 0.5, 0, heightPx * 0.4);
  const padBottom = clamp(labelSize * 2.0, 0, heightPx * 0.3);
  const plotX = padX;
  const plotY = padTop;
  const plotW = Math.max(10, widthPx - padX * 2);
  const plotH = Math.max(10, heightPx - padTop - padBottom);

  if (title.length > 0) {
    const heading = svgEl("text", {
      x: widthPx / 2,
      y: labelSize * 1.25,
      "text-anchor": "middle",
      "font-size": labelSize * 1.3,
      "font-weight": 700,
      fill: labelColor,
    });
    heading.textContent = title;
    svg.appendChild(heading);
  }

  // The value scale. A chart whose values are all identical still needs a
  // non-zero span, or every division below would be a division by zero.
  let maxValue = 0;
  let minValue = 0;
  for (const d of data) {
    if (d.value > maxValue) maxValue = d.value;
    if (d.value < minValue) minValue = d.value;
  }
  const span = maxValue - minValue;
  const safeSpan = span === 0 ? 1 : span;
  const mapY = (value: number): number => plotY + plotH * (1 - (value - minValue) / safeSpan);
  const zeroY = mapY(0);

  // ---- the grid ------------------------------------------------------------
  if (gridOpacity > 0) {
    const grid = svgEl("g", { stroke: labelColor, "stroke-opacity": gridOpacity, "stroke-width": 1 });
    for (let i = 0; i <= 4; i++) {
      const y = plotY + (plotH * i) / 4;
      grid.appendChild(
        svgEl("line", { x1: plotX, y1: y, x2: plotX + plotW, y2: y, "shape-rendering": "crispEdges" })
      );
    }
    svg.appendChild(grid);
  }

  // ---- the plot ------------------------------------------------------------
  const chartType = layer.chartType === "line" || layer.chartType === "donut" ? layer.chartType : "bar";

  // The geometry the reveal animation drives.
  const bars: Array<{ node: SVGElement; fullHeight: number; baseY: number; endY: number }> = [];
  const dots: Array<{ node: SVGElement; fullRadius: number }> = [];
  const valueLabels: Array<{ node: SVGElement; startY: number; endY: number }> = [];
  const arcs: Array<{ node: SVGElement; fullLength: number; circumference: number }> = [];
  let linePath: SVGElement | null = null;
  let areaPath: SVGElement | null = null;
  let lineLength = 0;

  // The progress of the reveal animation (0..1). It is driven by the master
  // timeline, so a seek reproduces it exactly.
  const progress = { p: 0 };
  const applyProgress = (): void => {
    const p = clamp(progress.p, 0, 1);
    if (chartType === "bar") {
      for (const bar of bars) {
        const h = bar.fullHeight * p;
        bar.node.setAttribute("height", String(Math.max(0, h)));
        bar.node.setAttribute("y", String(bar.baseY + (bar.endY - bar.baseY) * p));
      }
      for (const label of valueLabels) {
        label.node.setAttribute("opacity", String(p));
        label.node.setAttribute("y", String(label.endY - (label.endY - label.startY) * p));
      }
    } else if (chartType === "line") {
      if (linePath) linePath.setAttribute("stroke-dashoffset", String(lineLength * (1 - p)));
      if (areaPath) areaPath.setAttribute("opacity", String(0.14 * p));
      for (const dot of dots) {
        dot.node.setAttribute("opacity", String(p));
        dot.node.setAttribute("r", String(dot.fullRadius * p));
      }
      for (const label of valueLabels) {
        label.node.setAttribute("opacity", String(p));
        label.node.setAttribute("y", String(label.endY - (label.endY - label.startY) * p));
      }
    } else {
      for (const arc of arcs) {
        arc.node.setAttribute("stroke-dasharray", `${arc.fullLength * p} ${arc.circumference}`);
      }
    }
  };

  if (data.length === 0) {
    // NOTHING TO PLOT: the frame stays empty (the title still reads), and the
    // scene keeps rendering. This is the documented degradation.
    ctx.content.appendChild(host);
    return { content: host };
  }

  const count = data.length;

  if (chartType === "bar") {
    const band = plotW / count;
    const barW = Math.max(2, band * 0.56);
    const group = svgEl("g");
    for (let i = 0; i < count; i++) {
      const d = data[i]!;
      const x = plotX + band * i + (band - barW) / 2;
      const endY = mapY(d.value);
      const baseY = zeroY;
      const fullHeight = Math.abs(endY - baseY);
      const rect = svgEl("rect", {
        x,
        y: baseY,
        width: barW,
        height: 0,
        rx: Math.min(6, barW / 3),
        fill: d.color,
      });
      group.appendChild(rect);
      bars.push({ node: rect, fullHeight, baseY, endY });

      if (showValues) {
        const labelY = d.value >= 0 ? endY - labelSize * 0.4 : endY + labelSize * 1.1;
        const label = svgEl("text", {
          x: x + barW / 2,
          y: labelY,
          "text-anchor": "middle",
          "font-size": labelSize,
          "font-weight": 600,
          fill: labelColor,
          opacity: 0,
        });
        label.textContent = formatValue(d.value);
        group.appendChild(label);
        valueLabels.push({ node: label, startY: labelY + labelSize * 1.5, endY: labelY });
      }

      if (d.label.length > 0) {
        const cat = svgEl("text", {
          x: x + barW / 2,
          y: plotY + plotH + labelSize * 1.3,
          "text-anchor": "middle",
          "font-size": labelSize * 0.92,
          fill: labelColor,
          "fill-opacity": 0.82,
        });
        cat.textContent = d.label;
        group.appendChild(cat);
      }
    }
    svg.appendChild(group);
  } else if (chartType === "line") {
    const band = plotW / count;
    const points = data.map((d, i) => ({
      x: plotX + band * i + band / 2,
      y: mapY(d.value),
      datum: d,
    }));

    if (points.length > 1) {
      const areaD = [
        `M ${points[0]!.x} ${zeroY}`,
        ...points.map((p) => `L ${p.x} ${p.y}`),
        `L ${points[points.length - 1]!.x} ${zeroY}`,
        "Z",
      ].join(" ");
      areaPath = svgEl("path", { d: areaD, fill: accent, opacity: 0 });
      svg.appendChild(areaPath);
    }

    const lineD = points.map((p) => `${p.x} ${p.y}`).join(" L ");
    lineLength = points.reduce((sum, p, i) => {
      if (i === 0) return 0;
      const prev = points[i - 1]!;
      return sum + Math.hypot(p.x - prev.x, p.y - prev.y);
    }, 0);
    linePath = svgEl("path", {
      d: `M ${lineD}`,
      fill: "none",
      stroke: accent,
      "stroke-width": Math.max(2, labelSize * 0.16),
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "stroke-dasharray": lineLength,
      "stroke-dashoffset": lineLength,
    });
    svg.appendChild(linePath);

    for (const p of points) {
      const dot = svgEl("circle", {
        cx: p.x,
        cy: p.y,
        r: labelSize * 0.24,
        fill: accent,
        stroke: "#0b1020",
        "stroke-width": Math.max(1, labelSize * 0.06),
        opacity: 0,
      });
      svg.appendChild(dot);
      dots.push({ node: dot, fullRadius: labelSize * 0.24 });

      if (showValues) {
        const label = svgEl("text", {
          x: p.x,
          y: p.y - labelSize * 0.7,
          "text-anchor": "middle",
          "font-size": labelSize,
          "font-weight": 600,
          fill: labelColor,
          opacity: 0,
        });
        label.textContent = formatValue(p.datum.value);
        svg.appendChild(label);
        valueLabels.push({ node: label, startY: p.y + labelSize * 0.7, endY: p.y - labelSize * 0.7 });
      }

      if (p.datum.label.length > 0) {
        const cat = svgEl("text", {
          x: p.x,
          y: plotY + plotH + labelSize * 1.3,
          "text-anchor": "middle",
          "font-size": labelSize * 0.92,
          fill: labelColor,
          "fill-opacity": 0.82,
        });
        cat.textContent = p.datum.label;
        svg.appendChild(cat);
      }
    }
  } else {
    // ---- donut -------------------------------------------------------------
    const legendRoom = Math.min(plotW * 0.44, 260);
    const outer = Math.max(24, Math.min(plotH, plotW - legendRoom));
    const ringWidth = Math.max(8, outer * 0.2);
    const radius = Math.max(8, outer / 2 - ringWidth / 2);
    const cx = plotX + outer / 2;
    const cy = plotY + plotH / 2;
    const circumference = 2 * Math.PI * radius;

    // A donut shares a WHOLE, so negative shares are folded to zero and a
    // total of zero draws nothing rather than dividing by zero.
    const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0);
    if (total > 0) {
      const group = svgEl("g", { fill: "none", "stroke-width": ringWidth });
      let offset = 0;
      for (const d of data) {
        const share = Math.max(0, d.value) / total;
        const length = circumference * share;
        if (length <= 0) continue;
        const arc = svgEl("circle", {
          cx,
          cy,
          r: radius,
          stroke: d.color,
          "stroke-dasharray": `0 ${circumference}`,
          "stroke-dashoffset": -offset,
          transform: `rotate(-90 ${cx} ${cy})`,
        });
        group.appendChild(arc);
        arcs.push({ node: arc, fullLength: length, circumference });
        offset += length;
      }
      svg.appendChild(group);
    }

    // ---- the legend --------------------------------------------------------
    const legendX = plotX + outer + labelSize * 1.1;
    const step = labelSize * 1.75;
    let legendY = plotY + labelSize * 0.9;
    for (const d of data) {
      const swatch = svgEl("rect", {
        x: legendX,
        y: legendY - labelSize * 0.72,
        width: labelSize * 0.72,
        height: labelSize * 0.72,
        rx: labelSize * 0.18,
        fill: d.color,
      });
      svg.appendChild(swatch);
      const text = svgEl("text", {
        x: legendX + labelSize * 1.1,
        y: legendY,
        "font-size": labelSize * 0.95,
        fill: labelColor,
      });
      text.textContent = d.label.length > 0 ? d.label : formatValue(d.value);
      svg.appendChild(text);
      legendY += step;
    }
  }

  // ---- the reveal ----------------------------------------------------------
  // The chart animates in ONCE, relative to the layer's own start — so a
  // chart that enters at 8.6 s draws itself at 8.6 s, not at 0 s.
  const durationSec = 0.9;
  ctx.tl.to(
    progress,
    { p: 1, duration: durationSec, ease: "power2.out", onUpdate: applyProgress },
    Math.max(0, ctx.layerAtSec)
  );
  applyProgress();

  ctx.content.appendChild(host);
  return { content: host };
}
