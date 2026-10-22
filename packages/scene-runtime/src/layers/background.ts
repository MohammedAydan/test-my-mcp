import { gsap } from "gsap";
import type { BackgroundLayer } from "@motionforge/scene-spec";
import { clamp, num, safeColor, withAlpha } from "./guards.js";
import type { LayerContext } from "./context.js";

/** Seeded LCG — deterministic particle layout across preview and render. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * The soft falloff of a mesh-gradient blob.
 *
 * WHY THE GRADIENT AND NOT A BLUR (measured on a GPU-less host, 2 vCPU):
 *
 *   before: 254.5 ms/frame → 496.5 ms/frame  (+95 %) with `filter: blur(70px)`
 *   after:  the blob is painted already soft, so no filter pass at all.
 *
 * A live Gaussian blur is not a one-off cost: Chromium has to re-run the
 * convolution on every frame the element changes, and the blur is applied to
 * a layer that is LARGE (a blob is a big box) and that MOVES (the drift
 * tween), so nothing can be cached between frames. The mesh gradient is a
 * background layer, so it re-paints on every single frame of the render.
 *
 * A multi-stop radial gradient is the SAME visual idea — a soft colour field
 * that fades to nothing — computed ONCE by the compositor's gradient
 * rasteriser. No extra surface, no extra pass, no filter.
 */
function softBlobGradient(color: string): string {
  return [
    `radial-gradient(circle at 50% 50%, ${withAlpha(color, 1)} 0%`,
    `${withAlpha(color, 0.8)} 22%`,
    `${withAlpha(color, 0.4)} 42%`,
    `${withAlpha(color, 0.2)} 58%`,
    "transparent 78%)",
  ].join(", ");
}

export function renderBackground(layer: BackgroundLayer, ctx: LayerContext): { content: HTMLElement } {
  const v = layer.variant;

  // The background paints into its OWN full-bleed host instead of into the
  // motion wrapper.
  //
  // The wrapper (`.mf-exit`) is animated by the entrance/exit presets, and the
  // unified transform pipeline owns the transform of the layer's CONTENT
  // element — so the content element has to be a distinct element, not the
  // wrapper itself.
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;inset:0;";
  ctx.content.appendChild(host);
  const content = host;

  if (v.variant === "solid") {
    content.style.background = safeColor(v.color, "#05070d");
    return { content };
  }

  if (v.variant === "meshGradient") {
    content.style.background = safeColor(v.base, "#05070d");
    const durationSec = Math.max(0.001, num(ctx.scene.durationMs, 1000) / 1000);
    // A malformed scene must DEGRADE, never crash the preview. The
    // inspector used to write `{variant:"meshGradient", color:…}` (no
    // `blobs`), and `v.blobs.forEach` threw `Cannot read properties of
    // undefined (reading 'forEach')` — the preview died before the user
    // could see WHY the save was refused.
    const blobs = Array.isArray(v.blobs) ? v.blobs : [];
    blobs.forEach((b, i) => {
      // EVERY field is guarded: a blob with a string `radiusPct` used to
      // paint `width:NaN%`, which collapsed the blob to nothing (and, with
      // the old `filter: blur(70px)`, painted a giant smeared rectangle).
      const color = safeColor(b?.color, "#38bdf8");
      const xPct = num(b?.xPct, 50);
      const yPct = num(b?.yPct, 50);
      const radiusPct = clamp(num(b?.radiusPct, 40), 5, 200);
      const drift = clamp(num(b?.drift, 0.3), 0, 2);

      const blob = document.createElement("div");
      blob.style.position = "absolute";
      blob.style.left = `${xPct}%`;
      blob.style.top = `${yPct}%`;
      blob.style.width = `${radiusPct}%`;
      blob.style.aspectRatio = "1";
      blob.style.transform = "translate(-50%, -50%)";
      blob.style.borderRadius = "50%";
      blob.style.background = softBlobGradient(color);
      // The blob is the ONLY thing that moves in the mesh, so the compositor
      // can keep it on its own layer and re-composite it instead of
      // re-rasterising the gradient on every frame.
      blob.style.willChange = "transform";
      content.appendChild(blob);

      // wander out and back across the whole scene, phase-shifted per blob
      const driftPx = drift * 22;
      const sign = i % 2 === 0 ? 1 : -1;
      gsap.set(blob, { xPercent: -driftPx * sign, yPercent: -driftPx * 0.6 * sign });
      ctx.tl.to(
        blob,
        {
          xPercent: driftPx * sign,
          yPercent: driftPx * 0.6 * sign,
          duration: durationSec,
          ease: "sine.inOut",
          yoyo: true,
          repeat: 1,
        },
        0
      );
    });
    return { content };
  }

  if (v.variant === "particles") {
    const rng = makeRng(0xc0ffee);
    const durationSec = Math.max(0.001, num(ctx.scene.durationMs, 1000) / 1000);
    const W = ctx.width;
    const H = ctx.height;
    // the same degradation rule as `meshGradient` above
    const count = clamp(Math.round(num(v.count, 0)), 0, 600);
    const sizePx = clamp(num(v.sizePx, 2.5), 1, 12);
    const speed = clamp(num(v.speed, 1), 0.1, 3);
    const direction = v.direction === "down" || v.direction === "radial" || v.direction === "sideways" ? v.direction : "up";
    const color = safeColor(v.color, "#8ab4ff");
    for (let i = 0; i < count; i++) {
      const dot = document.createElement("div");
      const size = sizePx * (0.6 + rng() * 0.8);
      dot.style.position = "absolute";
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      dot.style.borderRadius = "50%";
      dot.style.background = color;
      dot.style.opacity = `${0.25 + rng() * 0.65}`;
      const x0 = rng() * W;
      const y0 = rng() * H;
      dot.style.left = "0";
      dot.style.top = "0";
      content.appendChild(dot);
      gsap.set(dot, { x: x0, y: y0 });

      let dx = 0;
      let dy = 0;
      switch (direction) {
        case "up":
          dy = -H * 1.2 * (0.5 + rng() * 0.5) * speed * 0.1;
          break;
        case "down":
          dy = H * 1.2 * (0.5 + rng() * 0.5) * speed * 0.1;
          break;
        case "sideways":
          dx = W * 1.2 * (rng() > 0.5 ? 1 : -1) * speed * 0.06;
          break;
        case "radial": {
          const cx = x0 - W / 2;
          const cy = y0 - H / 2;
          dx = cx * 0.9 * speed * 0.1;
          dy = cy * 0.9 * speed * 0.1;
          break;
        }
      }
      ctx.tl.to(dot, { x: `+=${dx}`, y: `+=${dy}`, duration: durationSec, ease: "none" }, 0);
    }
    return { content };
  }

  // media backdrop (image or video)
  //
  // `resolveAsset` THROWS for an asset that is not declared in the scene
  // (the engine validates the reference, but a scene can reach the runtime
  // without ever passing through that validation). An undeclared asset must
  // not take the whole preview down with it: the backdrop degrades to the
  // base colour.
  let asset: string;
  try {
    asset = ctx.resolveAsset(v.assetId);
  } catch {
    content.style.background = "#05070d";
    return { content };
  }
  if (typeof asset !== "string" || asset.length === 0) {
    content.style.background = "#05070d";
    return { content };
  }

  const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(asset) || ctx.assetKind(v.assetId) === "video";
  const media: HTMLElement = isVideo ? document.createElement("video") : document.createElement("img");
  if (isVideo) {
    const video = media as HTMLVideoElement;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    ctx.registerSeekable(async (tSec) => {
      if (Math.abs(video.currentTime - tSec) > 0.001) {
        video.currentTime = Math.min(tSec, Math.max(0, (video.duration || tSec) - 0.001));
        await new Promise<void>((resolve) => {
          const done = () => {
            video.removeEventListener("seeked", done);
            resolve();
          };
          video.addEventListener("seeked", done);
        });
      }
    });
  }
  (media as HTMLImageElement).src = asset;
  media.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;";
  const blurPx = clamp(num(v.blurPx, 0), 0, 60);
  if (blurPx > 0) {
    media.style.filter = `blur(${blurPx}px)`;
    // blur pulls in transparent edges — oversize the media slightly
    gsap.set(media, { scale: 1.06 + blurPx / 400 });
  }
  content.appendChild(media);

  const kb = v.kenBurns;
  if (kb) {
    const fromScale = clamp(num(kb.fromScale, 1), 1, 2);
    const toScale = clamp(num(kb.toScale, 1.2), 1, 2.5);
    const panFromX = num(kb.panFrom?.xPct, 50);
    const panFromY = num(kb.panFrom?.yPct, 50);
    const panToX = num(kb.panTo?.xPct, 50);
    const panToY = num(kb.panTo?.yPct, 50);
    ctx.tl.fromTo(
      media,
      {
        scale: fromScale,
        xPercent: (panFromX - 50) * 0.1,
        yPercent: (panFromY - 50) * 0.1,
      },
      {
        scale: toScale,
        xPercent: (panToX - 50) * 0.1,
        yPercent: (panToY - 50) * 0.1,
        duration: Math.max(0.001, num(ctx.scene.durationMs, 1000) / 1000),
        ease: "sine.inOut",
      },
      0
    );
  }

  const dimOpacity = clamp(num(v.dimOpacity, 0), 0, 1);
  if (dimOpacity > 0) {
    const dim = document.createElement("div");
    dim.style.cssText = "position:absolute;inset:0;background:#000;";
    dim.style.opacity = `${dimOpacity}`;
    content.appendChild(dim);
  }
  return { content };
}
