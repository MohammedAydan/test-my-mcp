import type { CursorFlowLayer, CursorWaypoint } from "@motionforge/scene-spec";
import { CRISP_TEXT_CSS } from "../determinism.js";
import { clamp, num, safeColor } from "./guards.js";
import type { LayerContext } from "./context.js";

const SANS_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const SVG_NS = "http://www.w3.org/2000/svg";

export function evaluateCubicEaseInOut(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

export function evaluateCursorPosition(
  waypoints: readonly CursorWaypoint[],
  timeMs: number
): { xPct: number; yPct: number } {
  if (waypoints.length === 0) return { xPct: 50, yPct: 50 };
  const first = waypoints[0]!;
  if (timeMs <= first.atMs || waypoints.length === 1) {
    return { xPct: first.xPct, yPct: first.yPct };
  }
  const last = waypoints[waypoints.length - 1]!;
  if (timeMs >= last.atMs) {
    return { xPct: last.xPct, yPct: last.yPct };
  }
  for (let i = 0; i < waypoints.length - 1; i++) {
    const w0 = waypoints[i]!;
    const w1 = waypoints[i + 1]!;
    if (timeMs >= w0.atMs && timeMs <= w1.atMs) {
      const dur = w1.atMs - w0.atMs;
      if (dur <= 0) return { xPct: w1.xPct, yPct: w1.yPct };
      const t = (timeMs - w0.atMs) / dur;
      const ease = evaluateCubicEaseInOut(t);
      return {
        xPct: w0.xPct + (w1.xPct - w0.xPct) * ease,
        yPct: w0.yPct + (w1.yPct - w0.yPct) * ease,
      };
    }
  }
  return { xPct: last.xPct, yPct: last.yPct };
}

function buildCursorSvg(style: string, accentColor: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("fill", "none");
  svg.style.cssText = "display:block;overflow:visible;";

  if (style === "pointer") {
    // Hand pointer silhouette
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute(
      "d",
      "M9 2a1.5 1.5 0 0 0-1.5 1.5v7.79l-1.68-.84a1.5 1.5 0 0 0-2.07.68l-.42.84a1.5 1.5 0 0 0 .32 1.77l5.22 5.22A5 5 0 0 0 12.4 20.5H16a5 5 0 0 0 5-5v-5a1.5 1.5 0 0 0-1.5-1.5h-.5a1.5 1.5 0 0 0-1.5-1.5h-.5a1.5 1.5 0 0 0-1.5-1.5H15V3.5A1.5 1.5 0 0 0 13.5 2h-4.5Z"
    );
    path.setAttribute("fill", "#000000");
    path.setAttribute("stroke", "#ffffff");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
  } else if (style === "collaborator") {
    // Collaborator ring silhouette
    const ring = document.createElementNS(SVG_NS, "circle");
    ring.setAttribute("cx", "12");
    ring.setAttribute("cy", "12");
    ring.setAttribute("r", "8");
    ring.setAttribute("stroke", accentColor);
    ring.setAttribute("stroke-width", "2.5");
    ring.setAttribute("fill", accentColor);
    ring.setAttribute("fill-opacity", "0.2");
    svg.appendChild(ring);

    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", "12");
    dot.setAttribute("cy", "12");
    dot.setAttribute("r", "3.5");
    dot.setAttribute("fill", accentColor);
    svg.appendChild(dot);
  } else {
    // macOS arrow silhouette
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M4 1.5l14 11.5-6.5.5 4 8-3 1.5-4-8-4.5 4.5V1.5z");
    path.setAttribute("fill", "#000000");
    path.setAttribute("stroke", "#ffffff");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
  }

  return svg;
}

export function renderCursorFlow(
  layer: CursorFlowLayer,
  ctx: LayerContext
): { content: HTMLElement } {
  const cursorStyle = layer.cursorStyle ?? "macos";
  const accentColor = safeColor(layer.accentColor, "#38bdf8");
  const baseScale = clamp(num(layer.cursorScale, 1.2), 0.5, 3);

  // Stable sorted waypoints by atMs
  const rawWaypoints = Array.isArray(layer.waypoints) ? layer.waypoints : [];
  const sortedWaypoints: CursorWaypoint[] = [...rawWaypoints].sort((a, b) => a.atMs - b.atMs);

  const host = document.createElement("div");
  host.className = "mf-cursor-flow";
  host.style.cssText = [
    "position:absolute",
    "width:100%",
    "height:100%",
    `left:${clamp(num(layer.position?.xPct, 50), -300, 300)}%`,
    `top:${clamp(num(layer.position?.yPct, 50), -300, 300)}%`,
    "pointer-events:none",
    "overflow:visible",
    CRISP_TEXT_CSS,
  ].join(";");

  // Ripple pairs for click waypoints
  const clickWaypoints = sortedWaypoints.filter((w) => w.action === "click");
  const rippleElements: Array<{
    w: CursorWaypoint;
    ring1: HTMLElement;
    ring2: HTMLElement;
  }> = [];

  for (const cw of clickWaypoints) {
    const ring1 = document.createElement("div");
    ring1.className = "mf-cursor-ripple mf-click-ring mf-click-ring-1";
    ring1.style.cssText = [
      "position:absolute",
      "border-radius:50%",
      `border:2px solid ${accentColor}`,
      "pointer-events:none",
      `left:${cw.xPct}%`,
      `top:${cw.yPct}%`,
      "transform:translate(-50%,-50%)",
      "opacity:0",
      "width:8px",
      "height:8px",
      "box-sizing:border-box",
    ].join(";");
    host.appendChild(ring1);

    const ring2 = document.createElement("div");
    ring2.className = "mf-cursor-ripple mf-click-ring mf-click-ring-2";
    ring2.style.cssText = [
      "position:absolute",
      "border-radius:50%",
      `border:1.5px solid ${accentColor}`,
      "pointer-events:none",
      `left:${cw.xPct}%`,
      `top:${cw.yPct}%`,
      "transform:translate(-50%,-50%)",
      "opacity:0",
      "width:8px",
      "height:8px",
      "box-sizing:border-box",
    ].join(";");
    host.appendChild(ring2);

    rippleElements.push({ w: cw, ring1, ring2 });
  }

  // Cursor Container
  const cursorWrap = document.createElement("div");
  cursorWrap.className = "mf-cursor";
  cursorWrap.dataset.cursor = "1";
  cursorWrap.style.cssText = [
    "position:absolute",
    "pointer-events:none",
    "transform-origin:0 0",
    "z-index:100",
  ].join(";");

  // Hover halo
  const halo = document.createElement("div");
  halo.className = "mf-cursor-halo";
  halo.style.cssText = [
    "width:48px",
    "height:48px",
    "border-radius:50%",
    "position:absolute",
    "left:-12px",
    "top:-12px",
    `background:radial-gradient(circle, ${accentColor} 0%, transparent 72%)`,
    "pointer-events:none",
    "opacity:0",
  ].join(";");
  cursorWrap.appendChild(halo);

  // Scalable graphic wrapper
  const graphicInner = document.createElement("div");
  graphicInner.className = "mf-cursor-graphic";
  graphicInner.style.cssText = [
    `transform:scale(${baseScale})`,
    "transform-origin:0 0",
    "display:block",
  ].join(";");
  graphicInner.appendChild(buildCursorSvg(cursorStyle, accentColor));
  cursorWrap.appendChild(graphicInner);

  // Floating label pill
  const labelPill = document.createElement("div");
  labelPill.className = "mf-cursor-label";
  labelPill.style.cssText = [
    "position:absolute",
    "left:22px",
    "top:16px",
    "border-radius:6px",
    "padding:3px 8px",
    "font-size:11px",
    "font-weight:600",
    `font-family:${SANS_STACK}`,
    "background:#0f172a",
    "color:#f8fafc",
    `border:1px solid ${accentColor}`,
    "white-space:nowrap",
    "pointer-events:none",
    "opacity:0",
    "display:none",
    "box-shadow:0 6px 14px rgba(0,0,0,0.35)",
  ].join(";");
  cursorWrap.appendChild(labelPill);

  host.appendChild(cursorWrap);
  ctx.content.appendChild(host);

  // Update function: deterministic pure function of layer-relative time in ms
  const update = (layerTimeMs: number): void => {
    const pos = evaluateCursorPosition(sortedWaypoints, layerTimeMs);
    cursorWrap.style.left = `${pos.xPct}%`;
    cursorWrap.style.top = `${pos.yPct}%`;
    cursorWrap.dataset.xPct = String(pos.xPct);
    cursorWrap.dataset.yPct = String(pos.yPct);

    // Click handling: dip scale to 0.82 and expand rings from radius 4 to 48px
    let minClickDip = 1;
    for (const item of rippleElements) {
      const dt = layerTimeMs - item.w.atMs;
      if (dt >= 0 && dt <= 450) {
        const p = dt / 450;
        // Radius expands 4 -> 48 px (diameter 8 -> 96 px)
        const d1 = (4 + 44 * p) * 2;
        item.ring1.style.width = `${d1}px`;
        item.ring1.style.height = `${d1}px`;
        item.ring1.style.opacity = String(1 - p);

        // Concentric ring 2 expands 4 -> 48 px with subtle trailing
        const d2 = (4 + 36 * p) * 2;
        item.ring2.style.width = `${d2}px`;
        item.ring2.style.height = `${d2}px`;
        item.ring2.style.opacity = String((1 - p) * 0.85);

        // Dip cursor scale to 0.82
        const dip = 1 - 0.18 * Math.sin(p * Math.PI);
        minClickDip = Math.min(minClickDip, dip);
      } else {
        item.ring1.style.opacity = "0";
        item.ring2.style.opacity = "0";
      }
    }

    graphicInner.style.transform = `scale(${baseScale * minClickDip})`;

    // Hover handling: soft accent halo for 400 ms
    let haloOpacity = 0;
    const hoverWaypoints = sortedWaypoints.filter((w) => w.action === "hover");
    for (const hw of hoverWaypoints) {
      const dt = layerTimeMs - hw.atMs;
      if (dt >= 0 && dt <= 400) {
        const p = dt / 400;
        haloOpacity = Math.max(haloOpacity, Math.sin(p * Math.PI) * 0.8);
      }
    }
    halo.style.opacity = String(haloOpacity);

    // Label handling: renders floating pill next to cursor while within 600 ms after its waypoint
    let activeLabel: string | null = null;
    let labelOpacity = 0;
    for (const w of sortedWaypoints) {
      if (typeof w.label === "string" && w.label.trim().length > 0) {
        const dt = layerTimeMs - w.atMs;
        if (dt >= 0 && dt <= 600) {
          activeLabel = w.label;
          labelOpacity = dt > 500 ? (600 - dt) / 100 : 1;
        }
      }
    }

    if (activeLabel !== null) {
      labelPill.textContent = activeLabel;
      labelPill.style.display = "block";
      labelPill.style.opacity = String(labelOpacity);
    } else {
      labelPill.style.display = "none";
      labelPill.style.opacity = "0";
    }
  };

  // Timeline Master Driver
  const driver = { t: 0 };
  const sceneDurationMs = Math.max(1, ctx.scene.durationMs);

  ctx.tl.to(
    driver,
    {
      t: sceneDurationMs,
      duration: sceneDurationMs / 1000,
      ease: "none",
      onUpdate: () => {
        const timeMs = ctx.tl.time() * 1000 - ctx.layerAtSec * 1000;
        update(timeMs);
      },
    },
    0
  );

  // Waypoint segment tweens on timeline
  for (let i = 0; i < sortedWaypoints.length - 1; i++) {
    const w0 = sortedWaypoints[i]!;
    const w1 = sortedWaypoints[i + 1]!;
    const segDurSec = Math.max(0.001, (w1.atMs - w0.atMs) / 1000);
    const segStartSec = ctx.layerAtSec + w0.atMs / 1000;
    const dummy = { p: 0 };
    ctx.tl.to(
      dummy,
      {
        p: 1,
        duration: segDurSec,
        ease: "none",
      },
      segStartSec
    );
  }

  // Initial update
  const initialTimeMs = ctx.tl.time() * 1000 - ctx.layerAtSec * 1000;
  update(initialTimeMs);

  return { content: host };
}
