// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { gsap } from "gsap";
import {
  CANVAS_SHAPES,
  CANVAS_SCALES,
  parseScene,
  type BackgroundLayer,
  type CardLayer,
  type ImageLogoLayer,
  type KineticTextLayer,
  type LogoMask,
  type SceneSpecInput,
} from "@motionforge/scene-spec";

import {
  clampFrame,
  createFrameSettler,
  CRISP_TEXT_CSS,
  decodeImages,
  flushLayout,
  nextPaintFrame,
  SETTLE_STEPS,
  type SettleDeps,
} from "../src/determinism.js";
import { createMotionWrappers, LayerLifecycle, planMotionSlots } from "../src/motion-slots.js";
import { createStage, resetStage } from "../src/stage.js";
import { renderCard } from "../src/layers/card.js";
import { renderImageLogo } from "../src/layers/image-logo.js";
import {
  containsArabicScript,
  renderKineticText,
  resolveGranularity,
} from "../src/layers/kinetic-text.js";
import type { LayerContext } from "../src/layers/context.js";
import type { FontRole } from "@motionforge/scene-spec";

/**
 * Regression locks for the visual defects found in real renders:
 * frame-to-frame instability, blurred/distorted text, Arabic shaping breakage
 * and transition artifacts. These are the guarantees `window.seekToFrame`
 * makes to core-engine before it screenshots a frame.
 */

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function minimalScene(layers: SceneSpecInput["layers"], durationMs = 6000): ReturnType<typeof parseScene> {
  return parseScene({
    schemaVersion: 1,
    name: "Stability Fixture",
    canvas: { shape: CANVAS_SHAPES[0], scale: CANVAS_SCALES[1] },
    durationMs,
    layers,
  } as SceneSpecInput);
}

function textLayer(input: Partial<KineticTextLayer> = {}): KineticTextLayer {
  return {
    id: "title",
    type: "kineticText",
    at: 0,
    text: "Hello MotionForge",
    sizePx: 96,
    direction: "ltr",
    role: "headline",
    fontWeight: 800,
    lineHeight: 1.15,
    letterSpacingPx: 0,
    position: { xPct: 50, yPct: 50 },
    fill: "#ffffff",
    animateBy: "char",
    ...input,
  } as KineticTextLayer;
}

/**
 * Layer fixtures must be materialized through the real schema (defaults
 * included). `assets` declares the image/lottie ids the fixture references —
 * the schema rejects undeclared ids, which is exactly the check we want here.
 */
function parsedLayer(
  layer: SceneSpecInput["layers"][number],
  assets: SceneSpecInput["assets"] = [{ id: "logo", kind: "image", src: "https://example.test/logo.png" }]
): never {
  return parseScene({
    schemaVersion: 1,
    name: "Fixture",
    canvas: { shape: CANVAS_SHAPES[0], scale: CANVAS_SCALES[1] },
    durationMs: 8000,
    assets,
    layers: [layer],
  }).layers[0] as never;
}

function makeCtx(overrides: Partial<LayerContext> = {}): LayerContext {
  return {
    tl: gsap.timeline({ paused: true }),
    scene: minimalScene([]),
    content: document.createElement("div"),
    stageContent: document.createElement("div"),
    rig: document.createElement("div"),
    width: 1920,
    height: 1080,
    layerAtSec: 0,
    fonts: new Map<FontRole, string>(),
    resolveAsset: () => "https://example.test/logo.png",
    assetKind: () => "image",
    lottieData: () => ({}),
    registerSeekable: () => undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. frame settlement: fonts, images, layout and two committed frames
// ---------------------------------------------------------------------------

describe("frame settlement (the seekToFrame contract)", () => {
  it("runs every step, in the documented order", async () => {
    const calls: string[] = [];
    const deps: SettleDeps = {
      seekTimeline: () => void calls.push("seekTimeline"),
      applyLifecycle: () => void calls.push("applyLifecycle"),
      runSeekables: async () => void calls.push("runSeekables"),
      fontsReady: async () => void calls.push("fontsReady"),
      decodeImages: async () => void calls.push("decodeImages"),
      flushLayout: () => void calls.push("flushLayout"),
      nextFrame: async () => void calls.push("nextFrame"),
    };

    await createFrameSettler(deps)(0);

    expect(calls).toEqual([...SETTLE_STEPS]);
  });

  it("awaits fonts, media and image decode BEFORE waiting for frames", async () => {
    let fontsSettled = false;
    let imagesDecoded = false;
    let framesAtFirstTick = -1;
    let tick = 0;

    await createFrameSettler({
      seekTimeline: () => undefined,
      applyLifecycle: () => undefined,
      runSeekables: async () => undefined,
      fontsReady: async () => {
        fontsSettled = true;
      },
      decodeImages: async () => {
        imagesDecoded = true;
      },
      flushLayout: () => undefined,
      nextFrame: async () => {
        tick += 1;
        if (tick === 1) framesAtFirstTick = (fontsSettled ? 1 : 0) + (imagesDecoded ? 1 : 0);
      },
    })(0);

    // both must already be true when the first animation frame is awaited
    expect(framesAtFirstTick).toBe(2);
  });

  it("commits two animation frames before resolving (one is not enough)", async () => {
    let ticks = 0;
    const settle = createFrameSettler({
      seekTimeline: () => undefined,
      applyLifecycle: () => undefined,
      runSeekables: async () => undefined,
      fontsReady: async () => undefined,
      decodeImages: async () => undefined,
      flushLayout: () => undefined,
      nextFrame: async () => {
        ticks += 1;
      },
    });
    await settle(0);
    expect(ticks).toBe(2);
  });

  it("re-runs the whole settlement on every seek (no state carried over)", async () => {
    let settles = 0;
    const settle = createFrameSettler({
      seekTimeline: () => void (settles += 1),
      applyLifecycle: () => undefined,
      runSeekables: async () => undefined,
      fontsReady: async () => undefined,
      decodeImages: async () => undefined,
      flushLayout: () => undefined,
      nextFrame: async () => undefined,
    });
    await settle(0);
    await settle(1);
    await settle(0.5);
    expect(settles).toBe(3);
  });

  it("clamps worker frame ranges onto real frames", () => {
    expect(clampFrame(-5, 100)).toBe(0);
    expect(clampFrame(1_000, 100)).toBe(99);
    expect(clampFrame(12.4, 100)).toBe(12);
    expect(clampFrame(12.6, 100)).toBe(13);
  });

  it("resolves for images that already loaded (preloaded by the engine)", async () => {
    const root = document.createElement("div");
    // jsdom has no decoder, so emulate the real-browser shape: complete and
    // sized. `decode()` rejecting must not fail the settle either.
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: 100 });
    Object.defineProperty(img, "decode", { value: () => Promise.reject(new Error("no decode in jsdom")) });
    root.appendChild(img);
    await expect(decodeImages(root)).resolves.toBeUndefined();
  });

  it("never rejects when an image errors instead of loading", async () => {
    const root = document.createElement("div");
    const img = document.createElement("img");
    img.src = "https://example.test/broken.png";
    root.appendChild(img);
    document.body.appendChild(root);
    const settled = decodeImages(root);
    img.dispatchEvent(new Event("error"));
    await expect(settled).resolves.toBeUndefined();
  });

  it("does not let a never-settling image stall a frame beyond the grace period", async () => {
    const root = document.createElement("div");
    root.innerHTML = `<img src="https://example.test/never-answers.png">`;
    const started = Date.now();
    await createFrameSettler({
      seekTimeline: () => undefined,
      applyLifecycle: () => undefined,
      runSeekables: async () => undefined,
      fontsReady: async () => undefined,
      decodeImages: () => decodeImages(root),
      flushLayout: () => undefined,
      nextFrame: async () => undefined,
      imageLoadGraceMs: 20,
    })(0);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("flushes layout synchronously", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(() => flushLayout(el)).not.toThrow();
  });

  it("resolves a paint frame", async () => {
    await expect(nextPaintFrame()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. RTL / Arabic: never split by character
// ---------------------------------------------------------------------------

describe("text splitting", () => {
  it("detects Arabic script", () => {
    expect(containsArabicScript("أهلاً بك")).toBe(true);
    expect(containsArabicScript("MotionForge")).toBe(false);
  });

  it("forbids character splitting for Arabic even when the author asked for it", () => {
    expect(resolveGranularity("أهلاً بك", "rtl", "char")).toBe("word");
  });

  it("forbids character splitting for RTL Latin text too (mixed AR/EN lines)", () => {
    expect(resolveGranularity("Motion موتور", "rtl", "char")).toBe("word");
  });

  it("keeps an explicit line reveal for RTL text", () => {
    expect(resolveGranularity("أهلاً\nبك", "rtl", "line")).toBe("line");
  });

  it("still honours character splitting for plain LTR text", () => {
    expect(resolveGranularity("Motion", "ltr", "char")).toBe("char");
  });

  it("treats other shaped scripts (Hebrew, Devanagari, Kana) like Arabic", () => {
    expect(resolveGranularity("שלום", "ltr", "char")).toBe("word");
    expect(resolveGranularity("नमस्ते", "ltr", "char")).toBe("word");
    expect(resolveGranularity("こんにちは", "ltr", "char")).toBe("word");
  });

  it("renders Arabic text as whole words, each isolated from bidi reordering", () => {
    const ctx = makeCtx();
    const built = renderKineticText(
      textLayer({ text: "موشن فورج", direction: "rtl", animateBy: "char" }),
      ctx
    );
    const units = built.units ?? [];
    expect(units.length).toBe(2); // two words, not 11 characters
    // no unit may be a single Arabic glyph: that would be a detached, unshaped letter
    for (const unit of units) {
      expect((unit.textContent ?? "").length).toBeGreaterThan(1);
      // every word sits in its own inline-block wrapper, bidi-isolated
      const wrap = unit.parentElement as HTMLElement;
      expect(wrap.tagName).toBe("SPAN");
      expect(wrap.style.display).toBe("inline-block");
      expect(wrap.style.whiteSpace).toBe("pre");
      expect(wrap.style.unicodeBidi).toBe("isolate");
    }
  });

  it("applies crisp typography and the clipping guard to text", () => {
    const ctx = makeCtx();
    const built = renderKineticText(
      parsedLayer({
        id: "title",
        type: "kineticText",
        text: "Masked reveal",
        sizePx: 96,
        animateBy: "word",
      } as SceneSpecInput["layers"][number]) as unknown as KineticTextLayer,
      ctx
    );
    const block = built.content as HTMLElement;
    // jsdom keeps the standard declarations; `-moz-osx-font-smoothing` is
    // asserted on the shared constant below (jsdom drops vendor properties)
    expect(block.style.cssText).toMatch(/-webkit-font-smoothing:\s*antialiased/);
    expect(block.style.textRendering).toBe("geometricPrecision");
    expect(block.style.fontKerning).toBe("normal");
    expect(CRISP_TEXT_CSS).toContain("-moz-osx-font-smoothing:grayscale");
    expect(CRISP_TEXT_CSS).toContain("-webkit-font-smoothing:antialiased");
    expect(CRISP_TEXT_CSS).toContain("text-rendering:geometricPrecision");
    expect(CRISP_TEXT_CSS).toContain("font-kerning:normal");

    const unit = (built.units ?? [])[0] as HTMLElement;
    // padding grows the painted box, negative margins keep the layout box equal
    expect(unit.style.paddingTop).toBe("0.15em");
    expect(unit.style.paddingBottom).toBe("0.2em");
    expect(unit.style.marginTop).toBe("-0.15em");
    expect(unit.style.marginBottom).toBe("-0.2em");
    expect(unit.style.lineHeight).toBe("1.35");
  });
});

// ---------------------------------------------------------------------------
// 3. motion phases: nested wrappers, non-overlapping windows
// ---------------------------------------------------------------------------

describe("motion slots", () => {
  const bg: BackgroundLayer = {
    id: "bg",
    type: "background",
    at: 0,
    variant: { variant: "solid", color: "#000000" },
  };

  it("nests entrance → emphasis → exit inside the layer root", () => {
    const root = document.createElement("div");
    root.className = "mf-layer";
    const w = createMotionWrappers(root);

    expect(w.root).toBe(root);
    expect(w.entrance.parentElement).toBe(root);
    expect(w.emphasis.parentElement).toBe(w.entrance);
    expect(w.exit.parentElement).toBe(w.emphasis);
    expect(w.content).toBe(w.exit);
  });

  it("gives the three phases three distinct elements (no transform collisions)", () => {
    const root = document.createElement("div");
    const w = createMotionWrappers(root);
    expect(new Set([w.entrance, w.emphasis, w.exit]).size).toBe(3);
    // the lifecycle root is never a preset target
    expect([w.entrance, w.emphasis, w.exit]).not.toContain(w.root);
  });

  it("plans non-overlapping entrance/emphasis/exit windows", () => {
    const plan = planMotionSlots(
      {
        ...bg,
        id: "text",
        at: 1000,
        duration: 6000,
        entrance: { name: "springPop", durationMs: 900 },
        emphasis: { name: "floatIdle", durationMs: 2400 },
        exit: { name: "scaleDownFade", durationMs: 500 },
      } as never,
      12_000
    );

    expect(plan.entrance).not.toBeNull();
    expect(plan.emphasis).not.toBeNull();
    expect(plan.exit).not.toBeNull();
    expect(plan.entrance!.endMs).toBeLessThanOrEqual(plan.emphasis!.startMs);
    expect(plan.emphasis!.endMs).toBeLessThanOrEqual(plan.exit!.startMs);
    expect(plan.visibleStartMs).toBe(1000);
    expect(plan.visibleEndMs).toBe(7000);
  });

  it("drops emphasis when the layer has no room for it", () => {
    const plan = planMotionSlots(
      { ...bg, entrance: { name: "springPop", durationMs: 900 }, exit: { name: "scaleDownFade", durationMs: 500 } } as never,
      1200
    );
    expect(plan.entrance).not.toBeNull();
    expect(plan.emphasis).toBeNull();
    expect(plan.exit).not.toBeNull();
  });

  it("keeps a delayed exit visible until it finishes", () => {
    const plan = planMotionSlots(
      { ...bg, at: 0, duration: 2000, exit: { name: "scaleDownFade", durationMs: 500, delayMs: 200 } } as never,
      5000
    );
    expect(plan.visibleEndMs).toBe(2200);
  });
});

// ---------------------------------------------------------------------------
// 4. layer lifecycle: deterministic visibility under non-linear seeking
// ---------------------------------------------------------------------------

describe("layer lifecycle", () => {
  let lifecycle: LayerLifecycle;
  let early: HTMLElement;
  let late: HTMLElement;

  beforeEach(() => {
    lifecycle = new LayerLifecycle();
    early = document.createElement("div");
    late = document.createElement("div");
    document.body.append(early, late);
    lifecycle.register({ id: "early", root: early, startMs: 1000, endMs: 3000 });
    lifecycle.register({ id: "late", root: late, startMs: 5000, endMs: 7000 });
  });

  const state = (el: HTMLElement) => `${el.style.visibility}/${el.style.opacity}/${el.style.pointerEvents}`;

  it("hides layers outside their window", () => {
    lifecycle.apply(0);
    expect(state(early)).toBe("hidden/0/none");
    expect(state(late)).toBe("hidden/0/none");
  });

  it("shows a layer inside its window", () => {
    lifecycle.apply(2000);
    expect(state(early)).toBe("visible/1/none");
    expect(state(late)).toBe("hidden/0/none");
  });

  it("is independent of seek order (no ghosting after jumping backwards)", () => {
    lifecycle.apply(6000);
    expect(state(late)).toBe("visible/1/none");
    lifecycle.apply(1500); // worker jumps back to an earlier frame
    expect(state(late)).toBe("hidden/0/none");
    expect(state(early)).toBe("visible/1/none");
  });

  it("treats the window end as exclusive", () => {
    lifecycle.apply(3000);
    expect(state(early)).toBe("hidden/0/none");
  });

  it("applies an initial state without a seek", () => {
    lifecycle.applyInitial();
    expect(state(early)).toBe("hidden/0/none");
  });
});

// ---------------------------------------------------------------------------
// 5. asset aspect ratio
// ---------------------------------------------------------------------------

describe("logo frosted plate geometry", () => {
  /** Renders a logo layer with the given mask/glass and returns its plate. */
  function renderLogoPlate(input: { mask: LogoMask; cornerRadiusPx?: number; widthPx?: number }) {
    const ctx = makeCtx();
    const layer = parsedLayer({
      id: "logo",
      type: "imageLogo",
      assetId: "logo",
      widthPx: input.widthPx ?? 200,
      position: { xPct: 50, yPct: 30 },
      mask: input.mask,
      cornerRadiusPx: input.cornerRadiusPx,
      glass: { blurPx: 22, tintColor: "#ffffff", tintOpacity: 0.08 },
    } as SceneSpecInput["layers"][number]) as unknown as ImageLogoLayer;

    renderImageLogo(layer, ctx);
    const host = ctx.content.firstElementChild as HTMLElement;
    return {
      host,
      plate: host.querySelector(".mf-logo-plate") as HTMLElement,
      frame: host.querySelector("div:not(.mf-logo-plate)") as HTMLElement,
    };
  }

  it("curves the plate to match a squircle logo instead of framing it in a square", () => {
    const { plate, frame } = renderLogoPlate({ mask: "squircle", cornerRadiusPx: 52, widthPx: 200 });
    // frame radius 52 → 46.8px; the plate is 12% wider per side (24px), so its
    // radius is the frame radius plus exactly that offset
    expect(frame.style.borderRadius).toMatch(/^46\.8\d*px$/);
    expect(plate.style.borderRadius).toBe("calc(46.800000000000004px + 24px)");
    expect(plate.style.borderRadius).not.toBe("");
    expect(plate.style.borderRadius).not.toBe("0px");
  });

  it("keeps percentage geometry as-is (it scales with the box)", () => {
    const circle = renderLogoPlate({ mask: "circle" });
    expect(circle.plate.style.borderRadius).toBe("50%");

    const blob = renderLogoPlate({ mask: "blob" });
    expect(blob.plate.style.borderRadius).toBe(blob.frame.style.borderRadius);
  });

  it("reuses a percentage clip-path so the plate keeps the mask's shape", () => {
    const { plate, frame } = renderLogoPlate({ mask: "hexagon" });
    expect(frame.style.clipPath).toMatch(/^polygon\(/);
    expect(plate.style.clipPath).toBe(frame.style.clipPath);
  });

  it("offsets a rect plate by the same inset", () => {
    const { plate } = renderLogoPlate({ mask: "rect", cornerRadiusPx: 16, widthPx: 200 });
    expect(plate.style.borderRadius).toBe("calc(16px + 24px)");
  });

  it("draws the plate behind the logo and grows it symmetrically", () => {
    const { host, plate } = renderLogoPlate({ mask: "squircle", cornerRadiusPx: 52 });
    expect(host.firstElementChild).toBe(plate);
    expect(plate.style.inset).toBe("-12%");
    expect(plate.style.border).toMatch(/^1px solid rgba\(255,\s*255,\s*255,\s*0\.14\)$/);
    expect(plate.style.boxShadow).toContain("rgba(0,0,0,0.35)");
  });

  it("never inherits a radius from the positioning host", () => {
    const { host, plate } = renderLogoPlate({ mask: "squircle" });
    expect(plate.style.cssText).not.toContain("inherit");
    // the host itself stays a plain positioning box
    expect((host as HTMLElement).style.borderRadius).toBe("");
  });

  it("renders no plate when the scene asks for no glass", () => {
    const ctx = makeCtx();
    const layer = parsedLayer({
      id: "logo",
      type: "imageLogo",
      assetId: "logo",
      widthPx: 200,
      position: { xPct: 50, yPct: 30 },
      mask: "squircle",
    } as SceneSpecInput["layers"][number]) as unknown as ImageLogoLayer;
    renderImageLogo(layer, ctx);
    expect(ctx.content.querySelector(".mf-logo-plate")).toBeNull();
  });
});

describe("asset sizing", () => {
  it("never stretches a logo to its box", () => {
    const ctx = makeCtx();
    const built = renderImageLogo(
      {
        id: "logo",
        type: "imageLogo",
        at: 0,
        assetId: "logo",
        widthPx: 200,
        position: { xPct: 50, yPct: 30 },
        mask: "rect",
      } as ImageLogoLayer,
      ctx
    );
    const img = built.content.querySelector("img") as HTMLImageElement;
    expect(img.style.objectFit).toBe("contain");
    expect(img.style.maxWidth).toBe("100%");
    expect(img.style.maxHeight).toBe("100%");
    expect(img.style.flexShrink).toBe("0");
  });

  it("keeps a card icon from being stretched", () => {
    const ctx = makeCtx();
    const layer = parsedLayer({
      id: "card",
      type: "card",
      at: 0,
      position: { xPct: 50, yPct: 40 },
      variant: { variant: "glassCard", iconAssetId: "logo", title: "T" },
    } as SceneSpecInput["layers"][number]) as unknown as CardLayer;
    renderCard(layer, ctx);
    const img = ctx.content.querySelector("img") as HTMLImageElement;
    expect(img.style.objectFit).toBe("contain");
    expect(img.style.flexShrink).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// 6. clean reset before a rebuild
// ---------------------------------------------------------------------------

describe("stage reset", () => {
  it("removes stale layers and transition overlays, and clears rig transforms", () => {
    document.body.innerHTML = `<div id="viewport"></div>`;
    const stage = createStage(1920, 1080);

    stage.content.innerHTML = `<div class="mf-layer"><div class="mf-slot"></div></div>`;
    const overlay = document.createElement("div");
    overlay.id = "wipe-cover";
    stage.rig.appendChild(overlay);
    gsap.set(stage.rig, { x: 120, scale: 1.4, rotate: 3 });

    resetStage(stage);

    expect(stage.content.children).toHaveLength(0);
    expect(stage.rig.querySelector("#wipe-cover")).toBeNull();
    expect(stage.rig.style.transform).toBe("");
    // the content wrapper itself must survive — it is rebuilt into, not recreated
    expect(stage.rig.contains(stage.content)).toBe(true);
  });

  it("resizes the canvas in place (preview rebuild with a different shape)", () => {
    document.body.innerHTML = `<div id="viewport"></div>`;
    const stage = createStage(1920, 1080);
    stage.setSize(1080, 1920);
    expect(stage.stage.style.width).toBe("1080px");
    expect(stage.stage.style.height).toBe("1920px");
    expect(stage.width).toBe(1080);
  });
});
