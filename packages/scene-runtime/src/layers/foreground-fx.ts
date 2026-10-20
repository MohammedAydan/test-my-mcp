import type { ForegroundFxLayer } from "@motionforge/scene-spec";
import type { LayerContext } from "./context.js";

/** Deterministic grain tile (SVG feTurbulence data URI). */
const GRAIN_URI =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>` +
      `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>` +
      `<feColorMatrix type='saturate' values='0'/></filter>` +
      `<rect width='160' height='160' filter='url(#n)'/>` +
    `</svg>`
  );

export function renderForegroundFx(layer: ForegroundFxLayer, ctx: LayerContext): { content: HTMLElement } {
  // The layer's own content element: a real, full-bleed box, so the unified
  // transform pipeline has an element to own and the bounds report has a box
  // to measure. It paints nothing — the overlays below do that.
  const content = document.createElement("div");
  content.style.cssText = "position:absolute;inset:0;pointer-events:none;";
  ctx.content.appendChild(content);

  for (const effect of layer.effects) {
    if (effect.kind === "vignette") {
      const el = document.createElement("div");
      el.style.cssText = [
        "position:absolute",
        "inset:0",
        `background:radial-gradient(ellipse at center, transparent 55%, ${effect.color} 130%)`,
        `opacity:${effect.strength}`,
      ].join(";");
      ctx.content.appendChild(el);
    } else if (effect.kind === "filmGrain") {
      const el = document.createElement("div");
      el.className = "mf-grain";
      el.style.cssText = [
        "position:absolute",
        "inset:-40px",
        `background-image:url("${GRAIN_URI}")`,
        "mix-blend-mode:overlay",
        `opacity:${effect.opacity}`,
        `background-size:${effect.sizePx * 80}px`,
      ].join(";");
      // stepped position flicker — timeline-driven `steps()` easing, deterministic
      ctx.tl.fromTo(
        el,
        { backgroundPosition: "0px 0px" },
        { backgroundPosition: "160px 160px", duration: ctx.scene.durationMs / 1000, ease: "steps(12)" },
        0
      );
      ctx.content.appendChild(el);
    } else {
      // colorGrade: CSS filter on the whole content stack, tweened in at `at`
      const graded =
        `contrast(${(1 + effect.contrast * 0.3).toFixed(3)}) saturate(${(1 + effect.saturation * 0.5).toFixed(3)})`;
      ctx.tl.fromTo(
        ctx.stageContent,
        { filter: "contrast(1) saturate(1)" },
        { filter: graded, duration: 0.6, ease: "sine.out" },
        ctx.layerAtSec
      );

      const washOpacity =
        effect.tint?.opacity ?? (effect.warmth !== 0 ? Math.abs(effect.warmth) * 0.18 : 0);
      if (washOpacity > 0) {
        const wash = document.createElement("div");
        wash.style.cssText = [
          "position:absolute",
          "inset:0",
          `background:${effect.tint?.color ?? (effect.warmth >= 0 ? "#ff963c" : "#3c78ff")}`,
          "mix-blend-mode:soft-light",
        ].join(";");
        ctx.tl.fromTo(wash, { opacity: 0 }, { opacity: washOpacity, duration: 0.6 }, ctx.layerAtSec);
        ctx.content.appendChild(wash);
      }
    }
  }
  return { content };
}
