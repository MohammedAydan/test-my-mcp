import { gsap } from "gsap";
import type { ImageLogoLayer, LogoMask } from "@motionforge/scene-spec";
import { applySweepOverlay } from "../presets.js";
import type { LayerContext } from "./context.js";

const CLIP_PATHS: Record<Exclude<LogoMask, "rect" | "circle" | "squircle">, string> = {
  hexagon:
    "polygon(25% 6.7%, 75% 6.7%, 100% 50%, 75% 93.3%, 25% 93.3%, 0% 50%)",
  blob: "border-radius: 62% 38% 46% 54% / 56% 44% 56% 44%",
};

interface MaskGeometry {
  borderRadius?: string;
  clipPath?: string;
  overflow?: string;
}

/**
 * Frame geometry for a mask. Percentage geometry (`50%`, `62% 38% …`) and
 * `clip-path: polygon(…)` are *relative to the box*, so they scale perfectly
 * when the box is enlarged — which is exactly what the frosted plate needs.
 */
function geometryFor(mask: LogoMask, radiusPx?: number): MaskGeometry {
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

/**
 * Geometry for the frosted plate that sits *behind* the logo.
 *
 * THE BUG THIS FIXES: the plate used `border-radius: inherit`, but its parent is
 * the positioning host, which has no radius of its own — so a squircle logo
 * ended up framed by a hard square. The plate must carry the same curve as the
 * mask, expanded by exactly the amount the box grows:
 *
 * - a pixel radius grows by the inset (offsetting a rounded rect outward by `d`
 *   on all sides gives radius `r + d` — exact for these curves);
 * - percentage radii and percentage `clip-path` polygons need no adjustment,
 *   because they are relative to the box they are painted on.
 */
function chipGeometry(mask: LogoMask, radiusPx: number | undefined, insetPx: number): MaskGeometry {
  const geometry = geometryFor(mask, radiusPx);
  const pxRadius = geometry.borderRadius?.match(/^(-?[\d.]+)px$/);
  return {
    borderRadius: pxRadius ? `calc(${pxRadius[1]}px + ${insetPx}px)` : geometry.borderRadius,
    clipPath: geometry.clipPath,
  };
}

/** How far the frosted plate extends beyond the logo box, as a percent. */
const CHIP_INSET_PCT = 12;

/**
 * Aspect-ratio safety for bitmaps and SVG marks.
 *
 * Without `object-fit: contain` + max dimensions, a logo whose intrinsic
 * aspect ratio differs from the requested box is stretched to fill it — the
 * classic "warped logo" defect. `max-width/max-height: 100%` also keeps the
 * mark inside its layer box, and `flex-shrink: 0` stops it collapsing when the
 * frame is a flex container.
 */
export const SAFE_IMG_CSS = [
  "width:100%",
  "height:100%",
  "object-fit:contain",
  "max-width:100%",
  "max-height:100%",
  "flex-shrink:0",
  "display:block",
].join(";");

export function renderImageLogo(layer: ImageLogoLayer, ctx: LayerContext): { content: HTMLElement } {
  const host = document.createElement("div");
  // A logo with no explicit `heightPx` must still have a box: without one the
  // host collapses to zero height, the absolutely-positioned frame inside it
  // has nothing to fill, and the mark is completely invisible. The height is
  // derived from the image's own aspect ratio, which the runtime measured while
  // preloading — so the result is deterministic, never a "wait for onload" race.
  const intrinsic = ctx.assetIntrinsicSize(layer.assetId);
  const resolvedHeightPx =
    layer.heightPx ??
    (intrinsic && intrinsic.width > 0
      ? Math.round((layer.widthPx * intrinsic.height) / intrinsic.width)
      : layer.widthPx);
  host.style.cssText = [
    "position:absolute",
    `left:${layer.position.xPct}%`,
    `top:${layer.position.yPct}%`,
    `transform:translate(-50%,-50%)${layer.rotation ? ` rotate(${layer.rotation}deg)` : ""}`,
    `width:${layer.widthPx}px`,
    `height:${resolvedHeightPx}px`,
    "max-width:100%",
    "max-height:100%",
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

  // frosted plate behind the logo: same curve as the mask, grown by the inset
  if (layer.glass) {
    const plate = document.createElement("div");
    plate.className = "mf-logo-plate";
    const insetPx = (layer.widthPx * CHIP_INSET_PCT) / 100;
    const geometry = chipGeometry(layer.mask, layer.cornerRadiusPx, insetPx);
    plate.style.cssText = [
      "position:absolute",
      `inset:-${CHIP_INSET_PCT}%`,
      geometry.borderRadius ? `border-radius:${geometry.borderRadius}` : "",
      geometry.clipPath ? `clip-path:${geometry.clipPath}` : "",
      `backdrop-filter:blur(${layer.glass.blurPx}px)`,
      `-webkit-backdrop-filter:blur(${layer.glass.blurPx}px)`,
      `background:${hexToRgba(layer.glass.tintColor, layer.glass.tintOpacity)}`,
      "border:1px solid rgba(255,255,255,0.14)",
      `box-shadow:0 ${Math.round(insetPx * 0.6)}px ${Math.round(insetPx * 1.6)}px rgba(0,0,0,0.35)`,
    ]
      .filter(Boolean)
      .join(";");
    host.appendChild(plate);
  }

  const frame = document.createElement("div");
  frame.style.cssText = "position:absolute;inset:0;";
  Object.assign(frame.style, geometryFor(layer.mask, layer.cornerRadiusPx));
  host.appendChild(frame);

  const img = document.createElement("img");
  img.src = ctx.resolveAsset(layer.assetId);
  img.alt = layer.name ?? "logo";
  img.style.cssText = SAFE_IMG_CSS;
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
