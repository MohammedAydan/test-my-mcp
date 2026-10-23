import type { ConnectorDiagramLayer, DiagramNode } from "@motionforge/scene-spec";
import { CRISP_TEXT_CSS } from "../determinism.js";
import { fontFamilyFor } from "../fonts.js";
import { clamp, num, safeColor, text } from "./guards.js";
import type { LayerContext } from "./context.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function safeGetTotalLength(path: SVGPathElement): number {
  if (typeof path.getTotalLength !== "function") return 0;
  try {
    const len = path.getTotalLength();
    return typeof len === "number" && !Number.isNaN(len) && len > 0 ? len : 0;
  } catch {
    return 0;
  }
}

function safeGetPointAtLength(
  path: SVGPathElement,
  distance: number,
  fallback: { x: number; y: number }
): { x: number; y: number } {
  if (typeof path.getPointAtLength !== "function") return fallback;
  try {
    const pt = path.getPointAtLength(distance);
    if (
      pt &&
      typeof pt.x === "number" &&
      typeof pt.y === "number" &&
      !Number.isNaN(pt.x) &&
      !Number.isNaN(pt.y)
    ) {
      return { x: pt.x, y: pt.y };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

interface EdgeAnimator {
  path: SVGPathElement;
  circle: SVGCircleElement | null;
  length: number;
  edgeIndex: number;
  startX: number;
  startY: number;
  animatedPulse: boolean;
}

export function renderConnectorDiagram(
  layer: ConnectorDiagramLayer,
  ctx: LayerContext
): { content: HTMLElement } {
  const host = document.createElement("div");
  host.className = "mf-connector-diagram";
  host.style.cssText = [
    "position:absolute",
    "width:100%",
    "height:100%",
    `left:${clamp(num(layer.position?.xPct, 50), -300, 300)}%`,
    `top:${clamp(num(layer.position?.yPct, 50), -300, 300)}%`,
    "overflow:visible",
    "box-sizing:border-box",
  ].join(";");

  // SVG canvas sized to ctx.width × ctx.height with viewBox="0 0 100 100" and preserveAspectRatio="none"
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("width", String(ctx.width));
  svg.setAttribute("height", String(ctx.height));
  svg.style.cssText = [
    "position:absolute",
    "left:0",
    "top:0",
    "width:100%",
    "height:100%",
    "pointer-events:none",
    "overflow:visible",
  ].join(";");
  host.appendChild(svg);

  // HTML containers for labels and nodes
  const labelsContainer = document.createElement("div");
  labelsContainer.className = "mf-diagram-edge-labels";
  labelsContainer.style.cssText =
    "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible;";
  host.appendChild(labelsContainer);

  const nodesContainer = document.createElement("div");
  nodesContainer.className = "mf-diagram-nodes";
  nodesContainer.style.cssText =
    "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible;";
  host.appendChild(nodesContainer);

  const headlineFont = fontFamilyFor(ctx.fonts, "headline");
  const bodyFont = fontFamilyFor(ctx.fonts, "body");

  // Map nodes by id
  const rawNodes = Array.isArray(layer.nodes) ? layer.nodes : [];
  const nodeMap = new Map<string, DiagramNode>();
  for (const n of rawNodes) {
    nodeMap.set(n.id, n);
  }

  // Render HTML nodes: absolutely positioned at (xPct, yPct) with translate(-50%, -50%) on inner wrapper
  for (const node of rawNodes) {
    const nodeWrap = document.createElement("div");
    nodeWrap.className = "mf-diagram-node mf-node-card";
    nodeWrap.dataset.nodeId = node.id;
    nodeWrap.style.cssText = [
      "position:absolute",
      `left:${node.xPct}%`,
      `top:${node.yPct}%`,
      "pointer-events:auto",
    ].join(";");

    const nodeInner = document.createElement("div");
    nodeInner.className = "mf-node-inner";
    const accent = safeColor(node.accentColor, "#38bdf8");
    nodeInner.style.cssText = [
      "transform:translate(-50%, -50%)",
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "justify-content:center",
      "padding:12px 20px",
      "border-radius:14px",
      "background:rgba(15, 23, 42, 0.92)",
      `border:2px solid ${accent}`,
      `box-shadow:0 0 16px ${accent}44, 0 12px 24px rgba(0, 0, 0, 0.5)`,
      "backdrop-filter:blur(12px)",
      "-webkit-backdrop-filter:blur(12px)",
      "white-space:nowrap",
      "box-sizing:border-box",
      CRISP_TEXT_CSS,
    ].join(";");

    const labelEl = document.createElement("div");
    labelEl.className = "mf-node-label";
    labelEl.textContent = text(node.label, "");
    labelEl.style.cssText = [
      `font-family:${headlineFont}`,
      "font-size:14px",
      "font-weight:700",
      "color:#f8fafc",
      "line-height:1.2",
    ].join(";");
    nodeInner.appendChild(labelEl);

    if (node.sublabel) {
      const sublabelEl = document.createElement("div");
      sublabelEl.className = "mf-node-sublabel";
      sublabelEl.textContent = node.sublabel;
      sublabelEl.style.cssText = [
        `font-family:${bodyFont}`,
        "font-size:11px",
        "font-weight:400",
        "color:#94a3b8",
        "margin-top:3px",
        "line-height:1.2",
      ].join(";");
      nodeInner.appendChild(sublabelEl);
    }

    nodeWrap.appendChild(nodeInner);
    nodesContainer.appendChild(nodeWrap);
  }

  // Render edges
  const rawEdges = Array.isArray(layer.edges) ? layer.edges : [];
  const edgeAnimators: EdgeAnimator[] = [];

  rawEdges.forEach((edge, edgeIndex) => {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) return;

    const x1 = fromNode.xPct;
    const y1 = fromNode.yPct;
    const x2 = toNode.xPct;
    const y2 = toNode.yPct;

    const dx = x2 - x1;
    const dy = y2 - y1;

    let cx1: number;
    let cy1: number;
    let cx2: number;
    let cy2: number;

    if (Math.abs(dx) >= Math.abs(dy)) {
      // Horizontal bias (dx * 0.5) for left/right flow
      cx1 = x1 + dx * 0.5;
      cy1 = y1;
      cx2 = x2 - dx * 0.5;
      cy2 = y2;
    } else {
      // Vertical bias (dy * 0.5) for up/down flow
      cx1 = x1;
      cy1 = y1 + dy * 0.5;
      cx2 = x2;
      cy2 = y2 - dy * 0.5;
    }

    const d = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    const strokeColor = safeColor(toNode.accentColor ?? fromNode.accentColor, "#64748b");
    path.setAttribute("stroke", strokeColor);
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    path.className.baseVal = "mf-diagram-edge-path";
    svg.appendChild(path);

    // Edge labels at Bezier midpoint
    if (edge.label) {
      const midX = 0.5 * (x1 + x2);
      const midY = 0.5 * (y1 + y2);

      const labelPill = document.createElement("div");
      labelPill.className = "mf-diagram-edge-label";
      labelPill.textContent = edge.label;
      labelPill.style.cssText = [
        "position:absolute",
        `left:${midX}%`,
        `top:${midY}%`,
        "transform:translate(-50%, -50%)",
        "padding:2px 8px",
        "border-radius:9999px",
        "font-size:11px",
        "font-weight:600",
        `font-family:${bodyFont}`,
        "background:rgba(15, 23, 42, 0.88)",
        "color:#cbd5e1",
        "border:1px solid rgba(255, 255, 255, 0.15)",
        "box-shadow:0 4px 12px rgba(0, 0, 0, 0.4)",
        "white-space:nowrap",
        "pointer-events:none",
        CRISP_TEXT_CSS,
      ].join(";");
      labelsContainer.appendChild(labelPill);
    }

    // Animated pulse circle
    const animatedPulse = edge.animatedPulse !== false;
    let circle: SVGCircleElement | null = null;
    if (animatedPulse) {
      circle = document.createElementNS(SVG_NS, "circle");
      circle.className.baseVal = "mf-diagram-pulse-dot";
      circle.setAttribute("r", "1.2");
      circle.setAttribute("fill", strokeColor);
      circle.setAttribute("cx", String(x1));
      circle.setAttribute("cy", String(y1));
      svg.appendChild(circle);
    }

    const totalLength = safeGetTotalLength(path);

    if (totalLength > 0) {
      path.setAttribute("stroke-dasharray", String(totalLength));
    }

    edgeAnimators.push({
      path,
      circle,
      length: totalLength,
      edgeIndex,
      startX: x1,
      startY: y1,
      animatedPulse,
    });
  });

  // Animation seekable
  const updateEdgeAnimations = (tSec: number): void => {
    for (const anim of edgeAnimators) {
      const { path, circle, length, edgeIndex, startX, startY, animatedPulse } = anim;
      // drawProgress = clamp((tSec - ctx.layerAtSec - 0.15 * edgeIndex) / 0.6, 0, 1)
      const drawProgress = clamp((tSec - ctx.layerAtSec - 0.15 * edgeIndex) / 0.6, 0, 1);

      if (length > 0) {
        // stroke-dashoffset = length * (1 - drawProgress)
        const dashoffset = length * (1 - drawProgress);
        path.setAttribute("stroke-dashoffset", String(dashoffset));

        if (animatedPulse && circle) {
          const startSec = ctx.layerAtSec + edgeIndex * 0.2;
          const rawFraction = (tSec - startSec) / 1.8;
          const cycleFraction = rawFraction <= 0 ? 0 : ((rawFraction % 1) + 1) % 1;
          const distance = cycleFraction * length;
          const pt = safeGetPointAtLength(path, distance, { x: startX, y: startY });
          circle.setAttribute("cx", String(pt.x));
          circle.setAttribute("cy", String(pt.y));
        }
      } else {
        // SVG geometry not available (jsdom or 0 length):
        // set no dasharray (edge fully drawn) and park pulse at edge start
        path.removeAttribute("stroke-dasharray");
        path.removeAttribute("stroke-dashoffset");
        if (animatedPulse && circle) {
          circle.setAttribute("cx", String(startX));
          circle.setAttribute("cy", String(startY));
        }
      }
    }
  };

  // Register ONE seekable that drives all edges
  ctx.registerSeekable(async (tSec: number) => {
    updateEdgeAnimations(tSec);
  });

  // Also drive via master timeline onUpdate for scrubbing / tests
  const driver = { t: 0 };
  const sceneDurationMs = Math.max(1, ctx.scene.durationMs);
  ctx.tl.to(
    driver,
    {
      t: sceneDurationMs,
      duration: sceneDurationMs / 1000,
      ease: "none",
      onUpdate: () => {
        updateEdgeAnimations(ctx.tl.time());
      },
    },
    0
  );

  // Call once at build time with ctx.layerAtSec
  updateEdgeAnimations(ctx.layerAtSec);

  ctx.content.appendChild(host);

  return { content: host };
}
