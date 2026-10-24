import { gsap } from "gsap";
import type { CartographicRouteLayer } from "@motionforge/scene-spec";
import type { LayerContext } from "./context.js";
import type { BuiltLayer } from "./index.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export function renderCartographicRoute(
  layer: CartographicRouteLayer,
  ctx: LayerContext
): BuiltLayer {
  const width = Number.isFinite(ctx.width) && ctx.width > 0 ? ctx.width : 1920;
  const height = Number.isFinite(ctx.height) && ctx.height > 0 ? ctx.height : 1080;

  const container = document.createElement("div");
  container.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:visible;";

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.style.cssText = "position:absolute;inset:0;overflow:visible;";
  container.appendChild(svg);

  const defs = document.createElementNS(SVG_NS, "defs");
  svg.appendChild(defs);

  // Filter for halo blur
  const filter = document.createElementNS(SVG_NS, "filter");
  filter.setAttribute("id", `halo-blur-${layer.id}`);
  filter.setAttribute("x", "-20%");
  filter.setAttribute("y", "-20%");
  filter.setAttribute("width", "140%");
  filter.setAttribute("height", "140%");
  const feBlur = document.createElementNS(SVG_NS, "feGaussianBlur");
  feBlur.setAttribute("stdDeviation", "3");
  filter.appendChild(feBlur);
  defs.appendChild(filter);

  // Map waypoint percentages to design space coordinates
  const points = layer.waypoints.map((wp) => ({
    x: (wp.xPct / 100) * width,
    y: (wp.yPct / 100) * height,
    label: wp.label,
  }));

  // Build SVG path
  let pathD = "";
  if (layer.curved && points.length > 2) {
    pathD = `M ${points[0]!.x} ${points[0]!.y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i === 0 ? 0 : i - 1]!;
      const p1 = points[i]!;
      const p2 = points[i + 1]!;
      const p3 = points[i + 2 < points.length ? i + 2 : i + 1]!;

      // Catmull-Rom to cubic Bezier conversion
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      pathD += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
  } else {
    pathD = points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  }

  // 1. Dark halo underlay path
  const halo = document.createElementNS(SVG_NS, "path");
  halo.setAttribute("d", pathD);
  halo.setAttribute("fill", "none");
  halo.setAttribute("stroke", layer.haloColor ?? "#0a0a0c");
  halo.setAttribute("stroke-width", String(layer.haloWidthPx ?? 8));
  halo.setAttribute("stroke-opacity", String(layer.haloOpacity ?? 0.75));
  halo.setAttribute("stroke-linecap", "round");
  halo.setAttribute("stroke-linejoin", "round");
  halo.setAttribute("filter", `url(#halo-blur-${layer.id})`);
  svg.appendChild(halo);

  // 2. Foreground animated stroke path
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pathD);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", layer.strokeColor ?? "#d4af37");
  path.setAttribute("stroke-width", String(layer.strokeWidthPx ?? 3.5));
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  if (layer.dashed) {
    path.setAttribute("stroke-dasharray", layer.dashArray ?? "8 6");
  }
  svg.appendChild(path);

  // 3. Start & End Pins
  const pinGroup = document.createElementNS(SVG_NS, "g");
  svg.appendChild(pinGroup);

  const createPin = (pt: { x: number; y: number; label?: string }, pinOpts?: typeof layer.startPin) => {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("transform", `translate(${pt.x}, ${pt.y})`);

    const color = pinOpts?.color ?? layer.strokeColor ?? "#d4af37";
    const r = pinOpts?.radiusPx ?? 8;

    // Outer pulse ring
    const outer = document.createElementNS(SVG_NS, "circle");
    outer.setAttribute("r", String(r * 1.8));
    outer.setAttribute("fill", color);
    outer.setAttribute("fill-opacity", "0.22");
    g.appendChild(outer);

    // Inner filled circle
    const inner = document.createElementNS(SVG_NS, "circle");
    inner.setAttribute("r", String(r));
    inner.setAttribute("fill", color);
    inner.setAttribute("stroke", "#ffffff");
    inner.setAttribute("stroke-width", "2");
    g.appendChild(inner);

    const pinLabel = pinOpts?.label ?? pt.label;
    if (pinLabel) {
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", "0");
      text.setAttribute("y", String(-r * 1.8));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("fill", "#ffffff");
      text.setAttribute("font-size", "14px");
      text.setAttribute("font-family", "system-ui, sans-serif");
      text.setAttribute("font-weight", "600");
      text.textContent = pinLabel;
      g.appendChild(text);
    }

    return g;
  };

  if (points.length > 0) {
    const startEl = createPin(points[0]!, layer.startPin);
    pinGroup.appendChild(startEl);

    const endEl = createPin(points[points.length - 1]!, layer.endPin);
    pinGroup.appendChild(endEl);
  }

  // Draw-in animation via stroke-dashoffset or clip
  const drawDuration = (layer.drawDurationMs ?? 1800) / 1000;
  gsap.fromTo(
    path,
    { opacity: 0.1 },
    { opacity: 1, duration: drawDuration, ease: "power2.out" }
  );

  ctx.content.appendChild(container);
  return { content: container };
}
