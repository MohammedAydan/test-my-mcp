import { gsap } from "gsap";
import type { BackgroundLayer } from "@motionforge/scene-spec";
import type { LayerContext } from "./context.js";

/** Seeded LCG — deterministic particle layout across preview and render. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
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
    content.style.background = v.color;
    return { content };
  }

  if (v.variant === "meshGradient") {
    content.style.background = v.base;
    const durationSec = ctx.scene.durationMs / 1000;
    // A malformed scene must DEGRADE, never crash the preview. The
    // inspector used to write `{variant:"meshGradient", color:…}` (no
    // `blobs`), and `v.blobs.forEach` threw `Cannot read properties of
    // undefined (reading 'forEach')` — the preview died before the user
    // could see WHY the save was refused.
    (Array.isArray(v.blobs) ? v.blobs : []).forEach((b, i) => {
      const blob = document.createElement("div");
      blob.style.position = "absolute";
      blob.style.left = `${b.xPct}%`;
      blob.style.top = `${b.yPct}%`;
      blob.style.width = `${b.radiusPct}%`;
      blob.style.aspectRatio = "1";
      blob.style.transform = "translate(-50%, -50%)";
      blob.style.borderRadius = "50%";
      blob.style.background = `radial-gradient(circle, ${b.color} 0%, transparent 70%)`;
      blob.style.filter = "blur(70px)";
      content.appendChild(blob);

      // wander out and back across the whole scene, phase-shifted per blob
      const drift = b.drift * 22;
      const sign = i % 2 === 0 ? 1 : -1;
      gsap.set(blob, { xPercent: -drift * sign, yPercent: -drift * 0.6 * sign });
      ctx.tl.to(blob, {
        xPercent: drift * sign,
        yPercent: drift * 0.6 * sign,
        duration: durationSec,
        ease: "sine.inOut",
        yoyo: true,
        repeat: 1,
      }, 0);
    });
    return { content };
  }

  if (v.variant === "particles") {
    const rng = makeRng(0xc0ffee);
    const durationSec = ctx.scene.durationMs / 1000;
    const W = ctx.width;
    const H = ctx.height;
    // the same degradation rule as `meshGradient` above
    const count = typeof v.count === 'number' && Number.isFinite(v.count) ? v.count : 0;
    for (let i = 0; i < count; i++) {
      const dot = document.createElement("div");
      const size = v.sizePx * (0.6 + rng() * 0.8);
      dot.style.position = "absolute";
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      dot.style.borderRadius = "50%";
      dot.style.background = v.color;
      dot.style.opacity = `${0.25 + rng() * 0.65}`;
      const x0 = rng() * W;
      const y0 = rng() * H;
      dot.style.left = "0";
      dot.style.top = "0";
      content.appendChild(dot);
      gsap.set(dot, { x: x0, y: y0 });

      const speed = v.speed;
      let dx = 0;
      let dy = 0;
      switch (v.direction) {
        case "up": dy = -H * 1.2 * (0.5 + rng() * 0.5) * speed * 0.1; break;
        case "down": dy = H * 1.2 * (0.5 + rng() * 0.5) * speed * 0.1; break;
        case "sideways": dx = W * 1.2 * (rng() > 0.5 ? 1 : -1) * speed * 0.06; break;
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
  const asset = ctx.resolveAsset(v.assetId);
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
  if (v.blurPx > 0) {
    media.style.filter = `blur(${v.blurPx}px)`;
    // blur pulls in transparent edges — oversize the media slightly
    gsap.set(media, { scale: 1.06 + v.blurPx / 400 });
  }
  content.appendChild(media);

  if (v.kenBurns) {
    const kb = v.kenBurns;
    ctx.tl.fromTo(
      media,
      {
        scale: kb.fromScale,
        xPercent: kb.panFrom ? (kb.panFrom.xPct - 50) * 0.1 : 0,
        yPercent: kb.panFrom ? (kb.panFrom.yPct - 50) * 0.1 : 0,
      },
      {
        scale: kb.toScale,
        xPercent: kb.panTo ? (kb.panTo.xPct - 50) * 0.1 : 0,
        yPercent: kb.panTo ? (kb.panTo.yPct - 50) * 0.1 : 0,
        duration: ctx.scene.durationMs / 1000,
        ease: "sine.inOut",
      },
      0
    );
  }

  if (v.dimOpacity > 0) {
    const dim = document.createElement("div");
    dim.style.cssText = "position:absolute;inset:0;background:#000;";
    dim.style.opacity = `${v.dimOpacity}`;
    content.appendChild(dim);
  }
  return { content };
}
