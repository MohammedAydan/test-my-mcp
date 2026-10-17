import { gsap } from "gsap";
import type { ImageLogoLayer, LogoMask } from "@motionforge/scene-spec";
import { applySweepOverlay } from "../presets.js";
import type { LayerContext } from "./context.js";

const CLIP_PATHS: Record<Exclude<LogoMask, "rect" | "circle" | "squircle">, string> = {
  hexagon:
    "polygon(25% 6.7%, 75% 6.7%, 100% 50%, 75% 93.3%, 25% 93.3%, 0% 50%)",
  blob: "border-radius: 62% 38% 46% 54% / 56% 44% 56% 44%",
};

function maskStyle(mask: LogoMask, radiusPx?: number): Partial<CSSStyleDeclaration> {
  switch (mask) {
    case "circle":
      return { borderRadius: "50%", overflow: "hidden" };
    case "squircle":
      return { borderRadius: `${Math.max(radiusPx ?? 48, 48) * 0.9}px`, overflow: "hidden" };
    case "hexagon":
      return { clipPath: CLIP_PATHS.hexagon, overflow: "hidden" };
    case "blob":
      return { borderRadius: "62% 38% 46% 54% / 56% 44% 56% 44%", overflow: "hidden" };
    default:
      return { borderRadius: `${radiusPx ?? 0}px`, overflow: "hidden" };
  }
}

export function renderImageLogo(layer: ImageLogoLayer, ctx: LayerContext): { content: HTMLElement } {
  const host = document.createElement("div");
  host.style.cssText = [
    "position:absolute",
    `left:${layer.position.xPct}%`,
    `top:${layer.position.yPct}%`,
    "transform:translate(-50%,-50%)",
    `width:${layer.widthPx}px`,
    layer.heightPx ? `height:${layer.heightPx}px` : "",
  ].join(";");

  const filters: string[] = [];
  if (layer.shadow) {
    filters.push(
      `drop-shadow(0 ${layer.shadow.offsetYpx}px ${layer.shadow.blurPx}px ${hexToRgba(layer.shadow.color, layer.shadow.opacity)})`
    );
  }
  if (layer.glow) {
    filters.push(`drop-shadow(0 0 ${12 * layer.glow.strength}px ${layer.glow.color})`);
    filters.push(`drop-shadow(0 0 ${36 * layer.glow.strength}px ${layer.glow.color})`);
  }
  if (filters.length > 0) host.style.filter = filters.join(" ");

  // frosted chip behind the logo
  if (layer.glass) {
    const chip = document.createElement("div");
    chip.style.cssText = [
      "position:absolute",
      "inset:-14%",
      `border-radius:inherit`,
      `backdrop-filter:blur(${layer.glass.blurPx}px)`,
      `-webkit-backdrop-filter:blur(${layer.glass.blurPx}px)`,
      `background:${hexToRgba(layer.glass.tintColor, layer.glass.tintOpacity)}`,
      "border:1px solid rgba(255,255,255,0.12)",
    ].join(";");
    host.appendChild(chip);
  }

  const frame = document.createElement("div");
  frame.style.cssText = "position:absolute;inset:0;";
  Object.assign(frame.style, maskStyle(layer.mask, layer.cornerRadiusPx));
  host.appendChild(frame);

  const img = document.createElement("img");
  img.src = ctx.resolveAsset(layer.assetId);
  img.alt = layer.name ?? "logo";
  img.style.cssText = "width:100%;height:100%;object-fit:contain;display:block;";
  frame.appendChild(img);

  if (layer.ring) {
    const ring = document.createElement("div");
    ring.style.cssText = [
      "position:absolute",
      "inset:0",
      `border:${layer.ring.widthPx}px solid ${layer.ring.color}`,
      `border-radius:inherit`,
      layer.ring.opacity !== undefined ? `opacity:${layer.ring.opacity}` : "",
    ].join(";");
    frame.appendChild(ring);
  }

  ctx.content.appendChild(host);

  if (layer.lightSweep) {
    const sweepHost = document.createElement("div");
    sweepHost.style.cssText = "position:absolute;inset:0;overflow:hidden;border-radius:inherit;";
    frame.appendChild(sweepHost);
    // sweep runs inside a full-bleed proxy positioned over the frame
    const proxy = document.createElement("div");
    proxy.style.cssText = "position:absolute;inset:0;overflow:visible;pointer-events:none;";
    sweepHost.appendChild(proxy);
    applySweepOverlay(proxy, ctx.tl, layer.lightSweep);
    const sweep = proxy.querySelector<HTMLElement>(".mf-sweep");
    if (sweep) {
      // confine the band to the logo box
      gsap.set(sweep, { top: "0%", bottom: "0%", height: "100%" });
    }
  }

  return { content: host };
}

function hexToRgba(hex: string, opacity: number): string {
  if (!hex.startsWith("#")) return hex;
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) {
    h = [...h].map((c) => c + c).join("");
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return `rgba(${r}, ${g}, ${b}, ${(opacity * a).toFixed(3)})`;
}
