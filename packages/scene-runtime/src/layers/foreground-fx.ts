import type { ForegroundFxLayer } from "@motionforge/scene-spec";
import { clamp, num, safeColor } from "./guards.js";
import type { LayerContext } from "./context.js";

/**
 * The pre-baked grain tile.
 *
 * WHY A BAKED TILE AND NOT `feTurbulence` (measured on a GPU-less host,
 * 2 vCPU, 254.5 ms/frame baseline):
 *
 *   before: 254.5 ms/frame → 390.5 ms/frame  (+53 %)
 *   after:  the noise is rasterised ONCE into a tile and then repeated.
 *
 * An SVG `feTurbulence` filter is re-evaluated by the compositor on EVERY
 * frame — the filter output is not cached, so the cost is paid 60 times a
 * second for a full-frame surface. On top of that the old overlay used
 * `mix-blend-mode: overlay`, which forces the whole frame through a second
 * blending pass.
 *
 * The replacement is a plain PNG of monochrome noise, tiled with
 * `background-repeat`. The compositor blends it once, as an ordinary image.
 *
 * DETERMINISM: the noise comes from a FIXED SEED, so two renders of the same
 * scene produce the same pixels — a random grain would differ on every run
 * and make a frame diff useless.
 */
const GRAIN_TILE_PX = 128;
const GRAIN_SEED = 0x6d2b79f5;

/**
 * The fallback tile, used only where a 2D canvas is not available (a jsdom
 * unit test, a locked-down browser profile). It is the old SVG turbulence —
 * slow, but correct, and never reached in a real render.
 *
 * It is BASE64 encoded (not `utf8,`-percent-encoded) so that it has exactly
 * the same URL shape as the baked PNG: a strict CSS `url()` parser accepts
 * `data:image/…;base64,…` everywhere, while the percent-encoded SVG form is
 * rejected by some of them — which silently produced a grain overlay with NO
 * image at all.
 */
const FALLBACK_GRAIN_SVG =
  `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>` +
  `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>` +
  `<feColorMatrix type='saturate' values='0'/></filter>` +
  `<rect width='160' height='160' filter='url(#n)'/>` +
  `</svg>`;

const FALLBACK_GRAIN_URI = `data:image/svg+xml;base64,${base64(FALLBACK_GRAIN_SVG)}`;

/** ASCII → base64, with a percent-encoded fallback for exotic hosts. */
function base64(value: string): string {
  try {
    if (typeof btoa === "function") return btoa(value);
  } catch {
    /* fall through to the percent-encoded form */
  }
  return encodeURIComponent(value);
}

/** mulberry32 — a tiny, fast, seeded PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The baked tiles, one per size, built once per page and cached. */
const grainTileCache = new Map<number, string>();

/**
 * True when this host can actually rasterise into a 2D canvas.
 *
 * The unit-test DOM (jsdom) has NO canvas implementation: calling
 * `getContext("2d")` there raises a "not implemented" error and returns
 * null. Detecting that up front keeps the test output clean and sends the
 * runtime down the (correct) fallback path instead of the error path.
 */
function canRasterise(): boolean {
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent ?? "")) return false;
  return true;
}

/**
 * The noise tile as a data URL.
 *
 * The pixels are SYMMETRIC around mid-grey: half of them are black with a
 * random alpha, half are white with a random alpha. That keeps the MEAN of
 * the tile neutral, so the grain darkens and brightens in equal measure
 * instead of washing the frame out — which is what a flat grey noise tile
 * (and, previously, the `overlay` blend mode) did.
 */
function buildGrainTile(tilePx: number): string {
  try {
    if (typeof document === "undefined" || !canRasterise()) return FALLBACK_GRAIN_URI;
    const canvas = document.createElement("canvas");
    canvas.width = tilePx;
    canvas.height = tilePx;
    const context = canvas.getContext("2d");
    if (!context) return FALLBACK_GRAIN_URI;
    const image = context.createImageData(tilePx, tilePx);
    const rng = mulberry32(GRAIN_SEED);
    for (let i = 0; i < image.data.length; i += 4) {
      const n = rng();
      const lum = n < 0.5 ? 0 : 255;
      const alpha = Math.round(Math.abs(n - 0.5) * 2 * 255);
      image.data[i] = lum;
      image.data[i + 1] = lum;
      image.data[i + 2] = lum;
      image.data[i + 3] = alpha;
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return FALLBACK_GRAIN_URI;
  }
}

/** The baked tile — built on first use, then cached for the page's life. */
function grainTile(tilePx: number): string {
  const cached = grainTileCache.get(tilePx);
  if (cached !== undefined) return cached;
  const url = buildGrainTile(tilePx);
  grainTileCache.set(tilePx, url);
  return url;
}

export function renderForegroundFx(layer: ForegroundFxLayer, ctx: LayerContext): { content: HTMLElement } {
  // The layer's own content element: a real, full-bleed box, so the unified
  // transform pipeline has an element to own and the bounds report has a box
  // to measure. It paints nothing — the overlays below do that.
  const content = document.createElement("div");
  content.style.cssText = "position:absolute;inset:0;pointer-events:none;";
  ctx.content.appendChild(content);

  const effects = Array.isArray(layer.effects) ? layer.effects : [];
  for (const effect of effects) {
    if (!effect || typeof effect !== "object") continue;

    if (effect.kind === "vignette") {
      const el = document.createElement("div");
      el.style.cssText = [
        "position:absolute",
        "inset:0",
        `background:radial-gradient(ellipse at center, transparent 55%, ${safeColor(effect.color, "#000000")} 130%)`,
        `opacity:${clamp(num(effect.strength, 0.5), 0, 1)}`,
      ].join(";");
      ctx.content.appendChild(el);
    } else if (effect.kind === "filmGrain") {
      const opacity = clamp(num(effect.opacity, 0.06), 0, 1);
      const sizePx = clamp(num(effect.sizePx, 2), 1, 6);
      // THE TILE IS DRAWN 1:1.
      //
      // THE BUG THIS FIXES: the tile was a 128 px source scaled to
      // `sizePx * 80` px (160 px at the default) — a NON-INTEGER scale. A
      // scaled image is RESAMPLED every time the element is painted, and a
      // full-frame tiled resample in software rasterisation measured
      // **+147 ms per frame** (the grain was still ×1.60 of a plain scene
      // after the `feTurbulence` filter and the `overlay` blend mode were
      // removed).
      //
      // The tile is now generated at the size it is drawn at, and the size
      // is an INTEGER, so the browser blits it without resampling.
      const tileSize = GRAIN_TILE_PX * Math.max(1, Math.round(sizePx));
      const el = document.createElement("div");
      el.className = "mf-grain";
      el.style.cssText = [
        "position:absolute",
        "inset:0",
        `background-image:url("${grainTile(tileSize)}")`,
        // NO `mix-blend-mode: overlay` — the blending pass over the whole
        // frame was half the cost of the effect.
        `opacity:${opacity}`,
        `background-size:${tileSize}px ${tileSize}px`,
        "background-repeat:repeat",
        // NEAREST-NEIGHBOUR SAMPLING. A bilinear sample of a repeating
        // texture over a full frame is the single most expensive thing a
        // software rasteriser can be asked to do here — and for a NOISE tile
        // the filtering is not even wanted: it blurs the grain into mush.
        "image-rendering:pixelated",
      ].join(";");
      // THE GRAIN IS STATIC.
      //
      // THE BUG THIS FIXES: the grain used to FLICKER — the tile's position
      // was tweened across the scene so the noise would move like film grain.
      // A position change on a TILED background re-rasterises the whole
      // tiled surface: measured on the reference host, the grain cost
      // **+163 ms per frame** (×1.60 against a plain scene) even after the
      // `feTurbulence` filter and the `overlay` blend mode were removed.
      //
      // A static tile is rasterised ONCE and composited for the rest of the
      // render, which is what the effect actually needs: a fine, even noise
      // over the frame. The trade-off is honest and visible in the report —
      // the grain no longer shimmers.
      ctx.content.appendChild(el);
    } else {
      // colorGrade: CSS filter on the whole content stack, tweened in at `at`
      const graded =
        `contrast(${(1 + num(effect.contrast, 0) * 0.3).toFixed(3)}) saturate(${(1 + num(effect.saturation, 0) * 0.5).toFixed(3)})`;
      ctx.tl.fromTo(
        ctx.stageContent,
        { filter: "contrast(1) saturate(1)" },
        { filter: graded, duration: 0.6, ease: "sine.out" },
        ctx.layerAtSec
      );

      const washOpacity = clamp(
        effect.tint?.opacity ?? (num(effect.warmth, 0) !== 0 ? Math.abs(num(effect.warmth, 0)) * 0.18 : 0),
        0,
        1
      );
      if (washOpacity > 0) {
        const wash = document.createElement("div");
        wash.style.cssText = [
          "position:absolute",
          "inset:0",
          `background:${safeColor(effect.tint?.color, num(effect.warmth, 0) >= 0 ? "#ff963c" : "#3c78ff")}`,
          "mix-blend-mode:soft-light",
        ].join(";");
        ctx.tl.fromTo(wash, { opacity: 0 }, { opacity: washOpacity, duration: 0.6 }, ctx.layerAtSec);
        ctx.content.appendChild(wash);
      }
    }
  }
  return { content };
}
