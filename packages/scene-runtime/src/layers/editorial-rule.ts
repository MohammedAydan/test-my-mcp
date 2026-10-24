import type { EditorialRuleLayer } from "@motionforge/scene-spec";
import type { LayerContext } from "./context.js";
import type { BuiltLayer } from "./index.js";

export function renderEditorialRule(
  layer: EditorialRuleLayer,
  ctx: LayerContext
): BuiltLayer {
  const container = document.createElement("div");
  const isHoriz = layer.orientation !== "vertical";
  const length = layer.lengthPct ?? 60;
  const thickness = layer.thicknessPx ?? 2;
  const color = layer.color ?? "#d4af37";

  container.className = `mf-editorial-rule ${isHoriz ? "mf-rule-horizontal" : "mf-rule-vertical"}`;
  container.style.cssText = [
    "position:absolute",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "pointer-events:none",
    isHoriz ? `width:${length}%` : `width:${thickness * 10}px`,
    isHoriz ? `height:${thickness * 10}px` : `height:${length}%`,
  ].join(";");

  // Divider line element
  const line = document.createElement("div");
  line.className = "mf-rule-line";
  if (isHoriz) {
    line.style.cssText = [
      "width:100%",
      `height:${thickness}px`,
      layer.fadeEnds
        ? `background:linear-gradient(90deg, transparent 0%, ${color} 25%, ${color} 75%, transparent 100%)`
        : `background:${color}`,
    ].join(";");
  } else {
    line.style.cssText = [
      `width:${thickness}px`,
      "height:100%",
      layer.fadeEnds
        ? `background:linear-gradient(180deg, transparent 0%, ${color} 25%, ${color} 75%, transparent 100%)`
        : `background:${color}`,
    ].join(";");
  }
  container.appendChild(line);

  // Center ornament
  if (layer.centerOrnament && layer.centerOrnament !== "none") {
    const size = layer.ornamentSizePx ?? 8;
    const ornament = document.createElement("div");
    ornament.className = "mf-rule-ornament";

    if (layer.centerOrnament === "diamond") {
      ornament.style.cssText = [
        "position:absolute",
        `width:${size}px`,
        `height:${size}px`,
        `background:#0a0a0c`,
        `border:${Math.max(1, Math.round(thickness))}px solid ${color}`,
        "transform:rotate(45deg)",
      ].join(";");
    } else {
      // Dot
      ornament.style.cssText = [
        "position:absolute",
        `width:${size}px`,
        `height:${size}px`,
        `background:${color}`,
        "border-radius:50%",
      ].join(";");
    }
    container.appendChild(ornament);
  }

  ctx.content.appendChild(container);
  return { content: container };
}
