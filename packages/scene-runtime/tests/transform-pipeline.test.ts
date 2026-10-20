// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { gsap } from "gsap";
import { parseScene, type KeyframeTrack, type LayerKeyframe, type SceneSpecInput } from "@motionforge/scene-spec";

/**
 * `lottie-web` boots a canvas renderer at import time, which jsdom cannot
 * provide. The pipeline tests never render a Lottie layer, so the module is
 * stubbed with the tiny surface the runtime uses.
 */
vi.mock("lottie-web", () => ({
  default: {
    loadAnimation: () => ({
      totalFrames: 0,
      setSpeed: () => undefined,
      goToAndStop: () => undefined,
    }),
  },
}));

import { buildScene } from "../src/scene-builder.js";
import { createStage } from "../src/stage.js";
import {
  DEFAULT_TRANSFORM,
  filterCss,
  interpolateKeyframes,
  isFullBleedLayer,
  legacyEaseToKeyframeEasing,
  mergeOverride,
  radiusCss,
  resolveTransform,
  transformCss,
  applyLayerTransform,
  TransformPipeline,
  type SceneLayer,
} from "../src/transform.js";

/**
 * The unified 2D transform pipeline.
 *
 * THE BUG THIS FIXES: the renderers each wrote their own `transform` string
 * and the Studio's live-drag handler wrote a DIFFERENT one on the same
 * element, so the preview desynced from the scene. There is now exactly one
 * owner, and the math it uses is the math the Studio uses — which is what
 * makes "drag, save, push back" land on the same pixel.
 */

function textLayer(overrides: Partial<SceneLayer> = {}): SceneLayer {
  return {
    id: "title",
    type: "kineticText",
    text: "Hello",
    sizePx: 80,
    position: { xPct: 50, yPct: 40 },
    ...overrides,
  } as SceneLayer;
}

function keyframe(
  id: string,
  property: LayerKeyframe["property"],
  timeMs: number,
  value: number,
  easing: LayerKeyframe["easing"] = "easeInOut"
): LayerKeyframe {
  return { id, property, timeMs, value, easing };
}

describe("interpolateKeyframes", () => {
  const frames = [
    keyframe("a", "xPct", 1000, 0, "linear"),
    keyframe("b", "xPct", 2000, 100, "linear"),
  ];

  it("returns undefined when the property is not keyframed", () => {
    expect(interpolateKeyframes(frames, "opacity", 1500)).toBeUndefined();
  });

  it("holds the first value before the first keyframe", () => {
    expect(interpolateKeyframes(frames, "xPct", 0)).toBe(0);
    expect(interpolateKeyframes(frames, "xPct", 1000)).toBe(0);
  });

  it("holds the last value after the last keyframe", () => {
    expect(interpolateKeyframes(frames, "xPct", 5000)).toBe(100);
  });

  it("hits the keyframe value exactly", () => {
    expect(interpolateKeyframes(frames, "xPct", 2000)).toBe(100);
  });

  it("interpolates linearly between two keyframes", () => {
    expect(interpolateKeyframes(frames, "xPct", 1500)).toBe(50);
  });

  it("uses the LEFT keyframe's easing", () => {
    const eased = [
      keyframe("a", "xPct", 0, 0, "easeIn"),
      keyframe("b", "xPct", 1000, 100, "easeIn"),
    ];
    // easeIn is t² → at the midpoint the value is 25
    expect(interpolateKeyframes(eased, "xPct", 500)).toBe(25);
  });

  it("implements every documented easing", () => {
    const one = (easing: LayerKeyframe["easing"], t: number): number =>
      interpolateKeyframes(
        [keyframe("a", "xPct", 0, 0, easing), keyframe("b", "xPct", 1000, 100, easing)],
        "xPct",
        t * 1000
      )!;

    expect(one("linear", 0.5)).toBeCloseTo(50, 6);
    expect(one("easeIn", 0.5)).toBeCloseTo(25, 6);
    expect(one("easeOut", 0.5)).toBeCloseTo(75, 6);
    expect(one("easeInOut", 0.5)).toBeCloseTo(50, 6);
    expect(one("cubic", 0.5)).toBeCloseTo(12.5, 6);
  });

  it("sorts unordered keyframes by time", () => {
    const unordered = [
      keyframe("b", "xPct", 2000, 100, "linear"),
      keyframe("a", "xPct", 1000, 0, "linear"),
    ];
    expect(interpolateKeyframes(unordered, "xPct", 1500)).toBe(50);
  });
});

describe("legacy tracks", () => {
  const tracks: KeyframeTrack[] = [
    {
      property: "position.xPct",
      keyframes: [
        { at: 0, value: 0, ease: "none" },
        { at: 1000, value: 100, ease: "none" },
      ],
    },
  ];

  it("maps a GSAP ease onto one of the five easings", () => {
    expect(legacyEaseToKeyframeEasing("none")).toBe("linear");
    expect(legacyEaseToKeyframeEasing("linear")).toBe("linear");
    expect(legacyEaseToKeyframeEasing("power2.in")).toBe("easeIn");
    expect(legacyEaseToKeyframeEasing("power2.out")).toBe("easeOut");
    expect(legacyEaseToKeyframeEasing("power2.inOut")).toBe("easeInOut");
    expect(legacyEaseToKeyframeEasing("something-else")).toBe("easeInOut");
    expect(legacyEaseToKeyframeEasing(undefined)).toBe("easeInOut");
  });

  it("still drives position.xPct through the unified pipeline", () => {
    const layer = textLayer({ tracks } as Partial<SceneLayer>);
    const resolved = resolveTransform(layer, 500);
    expect(resolved.xPct).toBe(50);
  });

  it("the FLAT keyframes win when both systems keyframe the same property", () => {
    const layer = textLayer({
      tracks,
      keyframes: [keyframe("flat", "xPct", 0, 10, "linear"), keyframe("flat2", "xPct", 1000, 20, "linear")],
    } as Partial<SceneLayer>);
    const resolved = resolveTransform(layer, 500);
    expect(resolved.xPct).toBe(15);
  });
});

describe("resolveTransform", () => {
  it("falls back to the authored values", () => {
    const layer = textLayer({ scale: 2, rotation: 30, opacity: 0.5 } as Partial<SceneLayer>);
    expect(resolveTransform(layer, 0)).toMatchObject({
      xPct: 50,
      yPct: 40,
      scaleX: 2,
      scaleY: 2,
      rotation: 30,
      opacity: 0.5,
    });
  });

  it("uses the neutral transform when nothing is authored", () => {
    const layer = { id: "bg", type: "background", variant: { variant: "solid", color: "#000" } } as SceneLayer;
    expect(resolveTransform(layer, 0)).toEqual(DEFAULT_TRANSFORM);
  });

  it("lets a keyframe override the authored value", () => {
    const layer = textLayer({
      keyframes: [keyframe("k", "opacity", 0, 0.2, "linear"), keyframe("k2", "opacity", 1000, 1, "linear")],
    } as Partial<SceneLayer>);
    expect(resolveTransform(layer, 500).opacity).toBeCloseTo(0.6, 6);
  });

  it("derives scaleX/scaleY from the uniform scale", () => {
    const layer = textLayer({
      scale: 2,
      keyframes: [keyframe("k", "scale", 0, 3, "linear")],
    } as Partial<SceneLayer>);
    const resolved = resolveTransform(layer, 0);
    expect(resolved.scaleX).toBe(3);
    expect(resolved.scaleY).toBe(3);
  });

  it("an authored scaleX overrides the uniform scale on that axis only", () => {
    const layer = textLayer({ scale: 2, scaleX: 0.5 } as Partial<SceneLayer>);
    const resolved = resolveTransform(layer, 0);
    expect(resolved.scaleX).toBe(0.5);
    expect(resolved.scaleY).toBe(2);
  });

  it("carries the layout size when it is authored", () => {
    const layer = textLayer({ size: { widthPct: 40, heightPct: 25 } } as Partial<SceneLayer>);
    const resolved = resolveTransform(layer, 0);
    expect(resolved.widthPct).toBe(40);
    expect(resolved.heightPct).toBe(25);
  });

  it("clamps a hostile value into its legal range", () => {
    const layer = textLayer({ scale: 999, opacity: 42 } as Partial<SceneLayer>);
    const resolved = resolveTransform(layer, 0);
    expect(resolved.scaleX).toBe(10);
    expect(resolved.opacity).toBe(1);
  });
});

describe("the CSS writers", () => {
  it("writes one transform string", () => {
    expect(transformCss({ ...DEFAULT_TRANSFORM, scaleX: 2, scaleY: 3, rotation: 45 })).toBe(
      "translate(-50%,-50%) scale(2, 3) rotate(45deg)"
    );
  });

  it("writes the filter bag", () => {
    const layer = textLayer({ filters: { blur: 4, brightness: 120, cornerRadius: 8 } } as Partial<SceneLayer>);
    expect(filterCss(layer)).toBe("blur(4px) brightness(120%)");
    expect(radiusCss(layer)).toBe("8px");
  });

  it("writes nothing when there are no filters", () => {
    expect(filterCss(textLayer())).toBe("");
    expect(radiusCss(textLayer())).toBe("");
  });

  it("knows which layers are full-bleed", () => {
    expect(isFullBleedLayer(textLayer())).toBe(false);
    expect(
      isFullBleedLayer({ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } } as SceneLayer)
    ).toBe(true);
  });
});

describe("applyLayerTransform", () => {
  it("writes the anchor, the transform, the opacity and the filter", () => {
    const el = document.createElement("div");
    const layer = textLayer({ filters: { blur: 2 } } as Partial<SceneLayer>);
    applyLayerTransform(el, resolveTransform(layer, 0), layer);

    expect(el.style.left).toBe("50%");
    expect(el.style.top).toBe("40%");
    expect(el.style.transform).toBe("translate(-50%,-50%) scale(1, 1) rotate(0deg)");
    expect(el.style.opacity).toBe("1");
    expect(el.style.filter).toBe("blur(2px)");
  });

  it("never transforms a full-bleed layer", () => {
    const el = document.createElement("div");
    const layer = { id: "bg", type: "background", variant: { variant: "solid", color: "#000" } } as SceneLayer;
    applyLayerTransform(el, resolveTransform(layer, 0), layer);
    expect(el.style.transform).toBe("none");
    expect(el.style.left).toBe("");
  });

  it("composes the layer filter with the element's authored one", () => {
    const el = document.createElement("div");
    el.dataset.mfAuthoredFilter = "drop-shadow(0 0 4px #000)";
    const layer = textLayer({ filters: { blur: 2 } } as Partial<SceneLayer>);
    applyLayerTransform(el, resolveTransform(layer, 0), layer);
    expect(el.style.filter).toBe("drop-shadow(0 0 4px #000) blur(2px)");
  });
});

describe("mergeOverride", () => {
  it("overrides only the supplied fields", () => {
    const merged = mergeOverride({ ...DEFAULT_TRANSFORM, opacity: 0.4 }, { xPct: 12 });
    expect(merged.xPct).toBe(12);
    expect(merged.opacity).toBe(0.4);
  });

  it("a uniform scale override moves both axes", () => {
    const merged = mergeOverride(DEFAULT_TRANSFORM, { scale: 2 });
    expect(merged.scaleX).toBe(2);
    expect(merged.scaleY).toBe(2);
  });
});

describe("TransformPipeline", () => {
  it("owns the element it was given and applies the transform onto it", () => {
    const pipeline = new TransformPipeline();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const layer = textLayer({ position: { xPct: 30, yPct: 70 } } as Partial<SceneLayer>);

    pipeline.register(layer, el);
    pipeline.applyAt(0);

    expect(pipeline.elementFor("title")).toBe(el);
    expect(el.dataset.mfContent).toBe("1");
    expect(el.style.left).toBe("30%");
    expect(el.style.top).toBe("70%");
  });

  it("keeps a live override across an apply", () => {
    const pipeline = new TransformPipeline();
    const el = document.createElement("div");
    const layer = textLayer();
    pipeline.register(layer, el);

    pipeline.setOverride("title", { xPct: 12, yPct: 22 });
    pipeline.applyAt(0);

    expect(el.style.left).toBe("12%");
    expect(el.style.top).toBe("22%");
  });

  it("clearing the override restores the authored values", () => {
    const pipeline = new TransformPipeline();
    const el = document.createElement("div");
    const layer = textLayer();
    pipeline.register(layer, el);

    pipeline.setOverride("title", { xPct: 12 });
    pipeline.applyAt(0);
    pipeline.setOverride("title", {});
    pipeline.applyAt(0);

    expect(el.style.left).toBe("50%");
  });
});

// ---------------------------------------------------------------------------
// the timeline-driven pipeline (the whole scene, seeked)
// ---------------------------------------------------------------------------

describe("the pipeline on the master timeline", () => {
  function mountScene(input: SceneSpecInput["layers"]) {
    document.body.innerHTML = `<div id="viewport"></div>`;
    const stage = createStage(1920, 1080);
    const scene = parseScene({
      schemaVersion: 1,
      name: "Pipeline Fixture",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: input,
    } as SceneSpecInput);
    const built = buildScene(scene, stage, {
      fonts: new Map(),
      resolveAsset: () => "https://example.test/asset.png",
      assetKind: () => "image",
      lottieData: () => ({}),
      registerSeekable: () => undefined,
      assetIntrinsicSize: () => undefined,
    });
    return { scene, built, stage };
  }

  it("writes the transform onto the layer's content element — and only there", () => {
    const { built } = mountScene([
      {
        id: "title",
        type: "kineticText",
        text: "Pipeline",
        sizePx: 80,
        position: { xPct: 50, yPct: 45 },
        rotation: 20,
      },
    ]);

    const element = built.pipeline.elementFor("title")!;
    expect(element.style.transform).toBe("translate(-50%,-50%) scale(1, 1) rotate(20deg)");
    expect(element.style.left).toBe("50%");
    expect(element.style.top).toBe("45%");

    // the renderer no longer writes a transform of its own
    const layerRoot = element.closest(".mf-layer")!;
    expect(layerRoot.querySelectorAll("[style*='transform']").length).toBe(1);
  });

  it("follows a keyframed property when the timeline is seeked", () => {
    const { scene, built } = mountScene([
      {
        id: "title",
        type: "kineticText",
        text: "Pipeline",
        sizePx: 80,
        position: { xPct: 50, yPct: 45 },
        keyframes: [
          { id: "k1", timeMs: 0, property: "xPct", value: 0, easing: "linear" },
          { id: "k2", timeMs: 2000, property: "xPct", value: 100, easing: "linear" },
        ],
      },
    ]);

    const element = built.pipeline.elementFor("title")!;
    const layer = scene.layers[0]!;

    built.tl.seek(1, false);
    const expected = resolveTransform(layer, 1000);
    expect(element.style.left).toBe(`${expected.xPct}%`);
    expect(element.style.left).toBe("50%");

    // a NON-linear seek lands on exactly the same value
    built.tl.seek(0.25, false);
    expect(element.style.left).toBe(`${resolveTransform(layer, 250).xPct}%`);
    built.tl.seek(1, false);
    expect(element.style.left).toBe(`${resolveTransform(layer, 1000).xPct}%`);
  });

  it("a legacy track still drives the position through the same pipeline", () => {
    const { scene, built } = mountScene([
      {
        id: "title",
        type: "kineticText",
        text: "Pipeline",
        sizePx: 80,
        position: { xPct: 50, yPct: 45 },
        tracks: [
          {
            property: "position.xPct",
            keyframes: [
              { at: 0, value: 10, ease: "none" },
              { at: 2000, value: 90, ease: "none" },
            ],
          },
        ],
      },
    ]);

    const element = built.pipeline.elementFor("title")!;
    built.tl.seek(1, false);
    expect(element.style.left).toBe(`${resolveTransform(scene.layers[0]!, 1000).xPct}%`);
    expect(element.style.left).toBe("50%");
  });

  it("never transforms a full-bleed layer", () => {
    const { built } = mountScene([
      { id: "bg", type: "background", variant: { variant: "solid", color: "#05070d" } },
    ]);
    const element = built.pipeline.elementFor("bg")!;
    expect(element.style.transform).toBe("none");
  });

  it("a full-bleed layer keeps its authored opacity on the static slot", () => {
    const { built, stage } = mountScene([
      {
        id: "bg",
        type: "background",
        variant: { variant: "solid", color: "#05070d" },
        opacity: 0.5,
        scale: 2,
      },
    ]);
    const staticSlot = stage.content.querySelector<HTMLElement>(".mf-static")!;
    expect(staticSlot.style.opacity).toBe("0.5");
    expect(staticSlot.style.transform).toContain("scale(2)");
    expect(built.pipeline.elementFor("bg")!.style.transform).toBe("none");
  });

  it("a content layer does NOT get its opacity applied twice", () => {
    const { built, stage } = mountScene([
      {
        id: "title",
        type: "kineticText",
        text: "Pipeline",
        sizePx: 80,
        position: { xPct: 50, yPct: 45 },
        opacity: 0.5,
      },
    ]);
    const staticSlot = stage.content.querySelector<HTMLElement>(".mf-static")!;
    // the static slot does not carry the alpha …
    expect(staticSlot.style.opacity).toBe("");
    // … the content element does, exactly once
    expect(built.pipeline.elementFor("title")!.style.opacity).toBe("0.5");
  });

  it("the timeline is the only clock: the camera writer still works", () => {
    const { built } = mountScene([
      { id: "bg", type: "background", variant: { variant: "solid", color: "#05070d" } },
    ]);
    expect(built.tl.duration()).toBeGreaterThan(0);
    expect(gsap.getProperty(built.pipeline.elementFor("bg")!, "transform")).toBeDefined();
  });
});
