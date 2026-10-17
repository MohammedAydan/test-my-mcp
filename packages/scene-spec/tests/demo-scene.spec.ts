import { describe, expect, it } from "vitest";
import { resolveCanvasSize, validateScene, type SceneSpecInput } from "../src/index.js";

/** Assert the scene parses and return the parsed scene (with defaults applied). */
function expectValid(scene: SceneSpecInput) {
  const result = validateScene(scene);
  if (!result.ok) {
    throw new Error(`expected scene to validate, got:\n${result.issues.join("\n")}`);
  }
  return result.scene;
}

/** Assert the scene fails validation and return the flattened issues. */
function expectIssues(scene: unknown): string[] {
  const result = validateScene(scene);
  if (result.ok) {
    throw new Error("expected validation to fail, but it succeeded");
  }
  return result.issues;
}

/**
 * A scene exercising every layer type, camera rig, transitions, fonts (incl.
 * Arabic RTL), presets and audio — this fixture is the seed for the Step 6 demo.
 */
function makeDemoScene(): SceneSpecInput {
  return {
    schemaVersion: 1,
    id: "brand-intro-demo",
    name: "Brand Intro Demo",
    canvas: { shape: "16:9", scale: 1080 },
    durationMs: 12000,
    assets: [
      { id: "logo", kind: "image", src: "vault:logo.png" },
      { id: "sparkle", kind: "lottie", src: "vault:sparkle.json" },
      { id: "music", kind: "audio", src: "vault:theme.mp3" },
    ],
    fonts: [
      { role: "hero", family: "Cairo", provider: "google", weights: [400, 900] },
      { role: "headline", family: "Cairo", provider: "google", weights: [700, 800] },
      { role: "body", family: "Inter", provider: "google", weights: [400, 600] },
      { role: "metric", family: "Inter", provider: "google", weights: [800] },
    ],
    layers: [
      {
        id: "bg",
        type: "background",
        at: 0,
        variant: {
          variant: "meshGradient",
          base: "#05070d",
          blobs: [
            { color: "#1a2a6c", xPct: 20, yPct: 25, radiusPct: 60, drift: 0.4 },
            { color: "#b21f1f", xPct: 80, yPct: 70, radiusPct: 55, drift: 0.3 },
            { color: "#fdbb2d", xPct: 60, yPct: 15, radiusPct: 40, drift: 0.6 },
          ],
        },
        sfx: [{ sfx: "riser", offsetMs: 0, gain: 0.7, pan: 0 }],
      },
      {
        id: "logo",
        name: "Brand mark",
        type: "imageLogo",
        at: 300,
        duration: 5000,
        assetId: "logo",
        widthPx: 340,
        position: { xPct: 50, yPct: 38 },
        mask: "squircle",
        cornerRadiusPx: 36,
        shadow: { opacity: 0.5, blurPx: 40, offsetYpx: 18 },
        glow: { color: "#7dd3fc", strength: 1.1 },
        lightSweep: { at: 1500, durationMs: 900, angleDeg: 25 },
        entrance: { name: "springPop", durationMs: 900 },
        emphasis: { name: "floatIdle", strength: 0.8 },
        exit: { name: "scaleDownFade", durationMs: 500 },
        sfx: [{ sfx: "pop", offsetMs: 120 }],
      },
      {
        id: "headline-en",
        type: "kineticText",
        at: 1200,
        duration: 4800,
        text: "Motion, engineered.",
        direction: "ltr",
        role: "hero",
        googleFamily: "Inter",
        fontWeight: 900,
        sizePx: 96,
        align: "center",
        fill: {
          type: "linear",
          angleDeg: 120,
          stops: [
            { color: "#ffffff", at: 0 },
            { color: "#ffd166", at: 100 },
          ],
        },
        animateBy: "word",
        entrance: { name: "smoothSlideUp", durationMs: 800, staggerMs: 120 },
        exit: { name: "collapseMask", durationMs: 400 },
      },
      {
        id: "headline-ar",
        type: "kineticText",
        at: 1800,
        duration: 4200,
        text: "تصنع الحركة بإتقان",
        direction: "rtl",
        role: "headline",
        googleFamily: "Cairo",
        fontWeight: 800,
        sizePx: 84,
        animateBy: "char",
        entrance: { name: "maskRevealWipe", durationMs: 700, staggerMs: 60 },
        highlight: { color: "#b21f1f", radiusPx: 14, paddingPx: 10 },
      },
      {
        id: "stats-card",
        type: "card",
        at: 3400,
        duration: 5000,
        variant: {
          variant: "glassCard",
          title: "Render pipeline",
          body: "Frames stay in memory until the encoder flushes.",
          widthPx: 640,
          glass: { blurPx: 26, tintColor: "#0b0f1a", tintOpacity: 0.4 },
        },
        position: { xPct: 50, yPct: 72 },
        entrance: { name: "elasticScale" },
        exit: { name: "collapseMask", durationMs: 450 },
        sfx: [{ sfx: "click", offsetMs: 0, gain: 0.6 }],
      },
      {
        id: "progress",
        type: "card",
        at: 3600,
        duration: 4800,
        variant: {
          variant: "progressBar",
          label: "GPU encode",
          value: 92,
          fill: {
            type: "linear",
            angleDeg: 90,
            stops: [
              { color: "#38bdf8", at: 0 },
              { color: "#a78bfa", at: 100 },
            ],
          },
          showPercentage: true,
          widthPx: 640,
        },
        position: { xPct: 50, yPct: 84 },
      },
      {
        id: "fps-counter",
        type: "card",
        at: 3800,
        duration: 4600,
        variant: {
          variant: "counter",
          from: 0,
          to: 60,
          suffix: " fps",
          role: "metric",
          sizePx: 88,
        },
        position: { xPct: 50, yPct: 92 },
      },
      {
        id: "sparkle",
        type: "lottie",
        at: 1500,
        duration: 2500,
        assetId: "sparkle",
        widthPx: 220,
        position: { xPct: 62, yPct: 30 },
      },
      {
        id: "grade",
        type: "foregroundFX",
        at: 0,
        effects: [
          { kind: "vignette", strength: 0.55 },
          { kind: "filmGrain", opacity: 0.05 },
          { kind: "colorGrade", warmth: 0.15, contrast: 0.1, saturation: 0.05 },
        ],
      },
    ],
    camera: {
      perspective: 1200,
      drift: { amplitudePct: 0.35, periodMs: 8000, seed: 7 },
      keyframes: [
        { at: 0, scale: 1, xPct: 50, yPct: 50 },
        { at: 6000, scale: 1.35, xPct: 40, yPct: 45, ease: "power3.inOut" },
      ],
      moves: [
        { move: "slowPushIn", at: 0, durationMs: 6000, strength: 1 },
        { move: "focusTarget", at: 6000, durationMs: 1500, targetLayerId: "logo" },
        { move: "shakeImpact", at: 8200, strength: 0.9 },
      ],
    },
    transitions: [
      { kind: "morph", at: 5800, durationMs: 900 },
      { kind: "wipe", at: 10200, durationMs: 800, direction: "up", featherPx: 60, color: "#05070d" },
    ],
    audio: {
      music: { assetId: "music", gain: 0.5, fadeInMs: 400, fadeOutMs: 1200, normalize: true },
      cues: [
        { at: 250, sfx: "whoosh" },
        { at: 1500, sfx: "shimmer", gain: 0.8 },
        { at: 6000, sfx: "subImpact" },
      ],
    },
  };
}

describe("validateScene", () => {
  it("accepts the demo scene and applies defaults", () => {
    const scene = expectValid(makeDemoScene());

    expect(resolveCanvasSize(scene.canvas)).toEqual({ width: 1920, height: 1080 });

    // defaults applied on parse
    const bg = scene.layers[0]!;
    expect(bg.at).toBe(0);
    const arabic = scene.layers.find((l) => l.id === "headline-ar");
    expect(arabic && arabic.type === "kineticText" ? arabic.direction : undefined).toBe("rtl");
    expect(
      arabic && arabic.type === "kineticText" ? arabic.position : undefined
    ).toEqual({ xPct: 50, yPct: 50 });
    expect(scene.audio.cues[0]?.gain).toBe(1); // explicit cue inherits default gain

    const headline = scene.layers.find((l) => l.id === "headline-en");
    expect(headline && headline.type === "kineticText" ? headline.fill : undefined).toEqual({
      type: "linear",
      angleDeg: 120,
      stops: [
        { color: "#ffffff", at: 0 },
        { color: "#ffd166", at: 100 },
      ],
    });
  });

  it("rejects unknown preset names with a readable issue", () => {
    const scene = makeDemoScene();
    (scene.layers[1] as Record<string, unknown>).entrance = { name: "zoomInUltra" };
    const issues = expectIssues(scene);
    expect(issues.some((i) => i.startsWith("layers.1.entrance.name"))).toBe(true);
    expect(issues.join("\n")).toContain("Invalid enum value");
  });

  it("rejects unknown layer types (discriminator)", () => {
    const scene = makeDemoScene();
    (scene.layers as unknown[]).push({ id: "hologram", type: "hologram", at: 0 });
    expect(expectIssues(scene).length).toBeGreaterThan(0);
  });

  it("rejects unrecognized keys (strict schemas)", () => {
    const scene = makeDemoScene() as Record<string, unknown>;
    scene.magicalAutoAI = true;
    const issues = expectIssues(scene);
    expect(issues.join("\n")).toContain("Unrecognized key");
  });

  it("rejects invalid canvas shape/scale pairs", () => {
    const scene = makeDemoScene();
    scene.canvas = { shape: "1:1", scale: 720 };
    const issues = expectIssues(scene);
    expect(issues.join("\n")).toContain("not valid for shape");
  });

  it("rejects duplicate layer ids", () => {
    const scene = makeDemoScene();
    const logo = structuredClone(scene.layers[1]!);
    scene.layers.push(logo);
    const issues = expectIssues(scene);
    expect(issues.join("\n")).toContain('duplicate layer id "logo"');
  });

  it("rejects references to undeclared assets", () => {
    const scene = makeDemoScene();
    scene.assets = (scene.assets ?? []).filter((a) => a.id !== "logo");
    const issues = expectIssues(scene);
    expect(issues.join("\n")).toContain('references undeclared asset id "logo"');
  });

  it("rejects unsorted camera keyframes", () => {
    const scene = makeDemoScene();
    if (scene.camera) {
      scene.camera.keyframes = [...(scene.camera.keyframes ?? [])].reverse();
    }
    const issues = expectIssues(scene);
    expect(issues.join("\n")).toContain("sorted");
  });

  it("rejects cues at or after scene end", () => {
    const scene = makeDemoScene();
    scene.audio!.cues = [{ at: 999_999, sfx: "pop" }];
    const issues = expectIssues(scene);
    expect(issues.join("\n")).toContain("cue at or after scene end");
  });

  it("rejects asset kind mismatches (lottie layer given an image)", () => {
    const scene = makeDemoScene();
    const sparkleLayer = scene.layers.find((l) => l.id === "sparkle");
    if (sparkleLayer && sparkleLayer.type === "lottie") {
      sparkleLayer.assetId = "logo";
    }
    const issues = expectIssues(scene);
    expect(issues.join("\n")).toContain('is kind "image", expected lottie');
  });
});
