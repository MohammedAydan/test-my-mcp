import { gsap } from "gsap";
import type { TimelineStripLayer } from "@motionforge/scene-spec";
import type { LayerContext } from "./context.js";
import type { BuiltLayer } from "./index.js";

export function renderTimelineStrip(
  layer: TimelineStripLayer,
  ctx: LayerContext
): BuiltLayer {
  const container = document.createElement("div");
  container.className = "mf-timeline-strip";
  const widthPct = layer.widthPct ?? 85;

  container.style.cssText = [
    "position:absolute",
    `width:${widthPct}%`,
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "pointer-events:none",
    "box-sizing:border-box",
  ].join(";");

  const axisWrap = document.createElement("div");
  axisWrap.className = "mf-timeline-wrap";
  axisWrap.style.cssText = [
    "position:relative",
    "width:100%",
    "display:flex",
    "align-items:center",
    "justify-content:space-between",
    "padding:40px 0",
  ].join(";");
  container.appendChild(axisWrap);

  // Background central axis line
  const axisLine = document.createElement("div");
  axisLine.className = "mf-timeline-axis";
  axisLine.style.cssText = [
    "position:absolute",
    "left:0",
    "right:0",
    "height:2px",
    `background:linear-gradient(90deg, transparent 0%, ${layer.lineColor ?? "#d4af37"} 10%, ${layer.lineColor ?? "#d4af37"} 90%, transparent 100%)`,
    "z-index:1",
  ].join(";");
  axisWrap.appendChild(axisLine);

  const eventNodes: HTMLElement[] = [];
  const events = layer.events ?? [];

  events.forEach((ev, idx) => {
    const node = document.createElement("div");
    node.className = "mf-timeline-node";
    node.style.cssText = [
      "position:relative",
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "z-index:2",
      "max-width:200px",
      "text-align:center",
    ].join(";");

    // Top: Date tag
    const dateEl = document.createElement("div");
    dateEl.className = "mf-timeline-date";
    dateEl.style.cssText = [
      "font-family:system-ui, sans-serif",
      "font-size:13px",
      "font-weight:700",
      "letter-spacing:1px",
      "text-transform:uppercase",
      `color:${ev.active ? (layer.activeMarkerColor ?? "#d4af37") : (layer.textColor ?? "#ffffff")}`,
      "margin-bottom:12px",
      "white-space:nowrap",
    ].join(";");
    dateEl.textContent = ev.date;
    node.appendChild(dateEl);

    // Center: Marker dot
    const marker = document.createElement("div");
    marker.className = "mf-timeline-marker";
    const isAct = Boolean(ev.active);
    const mColor = isAct ? (layer.activeMarkerColor ?? "#d4af37") : (layer.markerColor ?? "#ffffff");
    marker.style.cssText = [
      "width:16px",
      "height:16px",
      "border-radius:50%",
      `background:${mColor}`,
      `border:3px solid #0a0a0c`,
      `box-shadow:0 0 ${isAct ? "12px" : "6px"} ${mColor}`,
      "margin-bottom:12px",
    ].join(";");
    node.appendChild(marker);

    // Bottom: Title & Description
    const titleEl = document.createElement("div");
    titleEl.className = "mf-timeline-title";
    titleEl.style.cssText = [
      "font-family:system-ui, sans-serif",
      "font-size:16px",
      "font-weight:600",
      `color:${layer.textColor ?? "#ffffff"}`,
      "line-height:1.2",
    ].join(";");
    titleEl.textContent = ev.title;
    node.appendChild(titleEl);

    if (layer.showDescriptions && ev.description) {
      const descEl = document.createElement("div");
      descEl.className = "mf-timeline-desc";
      descEl.style.cssText = [
        "font-family:system-ui, sans-serif",
        "font-size:12px",
        "font-weight:400",
        `color:rgba(255,255,255,0.7)`,
        "margin-top:6px",
        "line-height:1.3",
      ].join(";");
      descEl.textContent = ev.description;
      node.appendChild(descEl);
    }

    axisWrap.appendChild(node);
    eventNodes.push(node);
  });

  // Staggered entrance animation
  const staggerSec = (layer.staggerMs ?? 250) / 1000;
  gsap.fromTo(
    eventNodes,
    { opacity: 0, y: 12 },
    { opacity: 1, y: 0, duration: 0.6, stagger: staggerSec, ease: "power2.out" }
  );

  ctx.content.appendChild(container);
  return { content: container, units: eventNodes };
}
