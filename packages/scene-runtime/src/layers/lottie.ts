import lottie, { type AnimationItem } from "lottie-web";
import type { LottieLayer } from "@motionforge/scene-spec";
import { clamp, num } from "./guards.js";
import type { LayerContext } from "./context.js";

/**
 * Lottie is scrubbed by timeline progress (autoplay/loop disabled), so preview
 * and headless rendering land on identical frames. Animation data is preloaded
 * by the boot phase (`ctx.lottieData`), making `totalFrames` available synchronously.
 */
export function renderLottie(layer: LottieLayer, ctx: LayerContext): { content: HTMLElement } {
  const host = document.createElement("div");
  // The anchor is authored here; the transform belongs to the unified
  // pipeline (`../transform.js`), which is the only writer of it.
  const widthPx = num(layer.widthPx, Number.NaN);
  host.style.cssText = [
    "position:absolute",
    `left:${clamp(num(layer.position?.xPct, 50), -300, 300)}%`,
    `top:${clamp(num(layer.position?.yPct, 50), -300, 300)}%`,
    Number.isFinite(widthPx) ? `width:${clamp(widthPx, 1, 8000)}px` : "width:25%",
    "max-width:100%",
  ].join(";");

  const box = document.createElement("div");
  box.style.cssText = "width:100%;";
  host.appendChild(box);

  // A LOTTIE LAYER WITHOUT ITS DATA must degrade, not explode.
  //
  // `lottieData` throws when the animation was not preloaded (an undeclared
  // asset, a vault file that failed to download) and `structuredClone` throws
  // on a payload that is not cloneable. Either one used to kill the preview
  // for every other layer in the scene; now the layer simply paints nothing.
  let anim: AnimationItem | null = null;
  let totalFrames = 0;
  try {
    const data = ctx.lottieData(layer.assetId);
    const cloned = structuredClone(data);
    anim = lottie.loadAnimation({
      container: box,
      renderer: "svg",
      loop: false,
      autoplay: false,
      animationData: cloned,
    });
    anim.setSpeed(0);
    totalFrames = num(anim.totalFrames, 0);
  } catch {
    anim = null;
  }

  if (anim) {
    const animation = anim;
    const frames = Math.max(1, totalFrames);
    const windowSec = clamp(
      num(layer.duration, num(ctx.scene.durationMs, 1000) - num(layer.at, 0)) / 1000,
      0.1,
      600
    );
    const proxy = { frame: 0 };
    ctx.tl.to(
      proxy,
      {
        frame: frames,
        duration: windowSec,
        ease: "none",
        onUpdate: () => {
          const target = clamp(proxy.frame, 0, Math.max(0, frames - 0.01));
          try {
            animation.goToAndStop(target, true);
          } catch {
            /* a broken animation must not take the frame down */
          }
        },
      },
      ctx.layerAtSec
    );
  }

  ctx.content.appendChild(host);
  return { content: host };
}
