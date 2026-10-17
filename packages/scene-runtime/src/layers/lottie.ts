import lottie, { type AnimationItem } from "lottie-web";
import type { LottieLayer } from "@motionforge/scene-spec";
import type { LayerContext } from "./context.js";

/**
 * Lottie is scrubbed by timeline progress (autoplay/loop disabled), so preview
 * and headless rendering land on identical frames. Animation data is preloaded
 * by the boot phase (`ctx.lottieData`), making `totalFrames` available synchronously.
 */
export function renderLottie(layer: LottieLayer, ctx: LayerContext): { content: HTMLElement } {
  const host = document.createElement("div");
  host.style.cssText = [
    "position:absolute",
    `left:${layer.position.xPct}%`,
    `top:${layer.position.yPct}%`,
    "transform:translate(-50%,-50%)",
    layer.widthPx ? `width:${layer.widthPx}px` : "width:25%",
    "max-width:100%",
  ].join(";");

  const box = document.createElement("div");
  box.style.cssText = "width:100%;";
  host.appendChild(box);

  const data = ctx.lottieData(layer.assetId);
  const anim: AnimationItem = lottie.loadAnimation({
    container: box,
    renderer: "svg",
    loop: false,
    autoplay: false,
    animationData: structuredClone(data),
  });
  anim.setSpeed(0);

  const windowSec = (layer.duration ?? (ctx.scene.durationMs - layer.at)) / 1000;
  const proxy = { frame: 0 };
  ctx.tl.to(proxy, {
    frame: anim.totalFrames,
    duration: Math.max(0.1, windowSec),
    ease: "none",
    onUpdate: () => anim.goToAndStop(Math.min(proxy.frame, anim.totalFrames - 0.01), true),
  }, ctx.layerAtSec);

  ctx.content.appendChild(host);
  return { content: host };
}
