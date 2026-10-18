// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { gsap } from "gsap";
import { parseScene, type SceneSpecInput } from "@motionforge/scene-spec";

import {
  applyCamera,
  applyViewportClamp,
  cameraStateFromRig,
  clampCameraTranslation,
  FOCUS_MAX_SCALE,
  lookAtPct,
  requiredScaleForPan,
  safeLookAtRange,
  translationForLookAt,
  type LayerAnchor,
} from "../src/camera.js";
import { applyTransitions } from "../src/transitions.js";

/**
 * The viewport-safety contract.
 *
 *   "The rendered pixels must never show black void outside the canvas."
 *
 * The camera is the only system that can break it, so it gets three layers of
 * defence: exact centring maths, a smart scale/pan coupling for `focusTarget`,
 * and a FINAL composed clamp that runs on every frame — synchronously, because
 * a deferred write is a write the next tween overwrites.
 */

function sceneOf(input: SceneSpecInput) {
  return parseScene(input);
}

function rigFixture(): { rig: HTMLElement; anchors: Map<string, LayerAnchor> } {
  const rig = document.createElement("div");
  document.body.appendChild(rig);
  return { rig, anchors: new Map<string, LayerAnchor>() };
}

function buildCamera(
  scene: ReturnType<typeof sceneOf>,
  rig: HTMLElement,
  anchors: Map<string, LayerAnchor>
): gsap.core.Timeline {
  const tl = gsap.timeline({ paused: true });
  tl.to({}, { duration: scene.durationMs / 1000 }, 0);
  applyCamera(tl, scene, rig, anchors);
  applyViewportClamp(tl, rig, scene);
  return tl;
}

/** The pixel-space void check: |Δ| ≤ size·(S−1)/2, in percent of the canvas. */
function voidFree(scale: number, xPercent: number, yPercent: number): boolean {
  const limit = 50 * Math.max(0, scale - 1);
  return Math.abs(xPercent) <= limit + 1e-6 && Math.abs(yPercent) <= limit + 1e-6;
}

// ---------------------------------------------------------------------------
// 1. the maths
// ---------------------------------------------------------------------------

describe("camera viewport maths", () => {
  it("derives the exact centring translation (the scale is applied first)", () => {
    // centring canvas point 30 at scale 1.45 needs a translation of 20·1.45
    expect(translationForLookAt(1.45, 30)).toBeCloseTo(29, 6);
    // …and the inverse holds
    expect(lookAtPct(1.45, translationForLookAt(1.45, 30))).toBeCloseTo(30, 6);
    expect(lookAtPct(1, translationForLookAt(1, 30))).toBeCloseTo(30, 6);
  });

  it("computes the safe look-at band from the zoom", () => {
    const at108 = safeLookAtRange(1.08);
    expect(at108.half).toBeCloseTo(50 * (1 - 1 / 1.08), 6);
    expect(at108.min).toBeCloseTo(50 - at108.half, 6);
    expect(at108.max).toBeCloseTo(50 + at108.half, 6);
    // at scale 1 the canvas exactly fills the frame: no pan is safe at all
    expect(safeLookAtRange(1).half).toBe(0);
  });

  it("computes the zoom needed to reach a look-at point", () => {
    // |d| ≤ 50(1−1/S)  ⟹  S ≥ 1/(1−|d|/50)
    expect(requiredScaleForPan(0)).toBeCloseTo(1, 6);
    expect(requiredScaleForPan(20)).toBeCloseTo(1 / 0.6, 6);
    expect(requiredScaleForPan(50)).toBe(FOCUS_MAX_SCALE); // unreachable → capped
  });

  it("clamps the translation to the pixel-space limit", () => {
    // |ΔX| ≤ w·(S−1)/2  ⟺  |xPercent| ≤ 50·(S−1)
    const at145 = clampCameraTranslation(1.45, 29, 0);
    expect(at145.limit).toBeCloseTo(22.5, 6);
    expect(at145.xPercent).toBeCloseTo(22.5, 6);
    expect(at145.clamped).toBe(true);
    // a small pan is untouched
    const small = clampCameraTranslation(1.45, 5, -3);
    expect(small.xPercent).toBe(5);
    expect(small.clamped).toBe(false);
    // at scale 1 NOTHING may pan
    const at1 = clampCameraTranslation(1, 2, 0);
    expect(at1.xPercent).toBe(0);
    expect(at1.clamped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. the final composed clamp
// ---------------------------------------------------------------------------

describe("final composed viewport clamp", () => {
  it("keeps an out-of-bounds keyframe inside the canvas", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "void",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
      camera: { keyframes: [{ at: 0, scale: 1.4, xPct: 0 }] },
    } as SceneSpecInput);
    const { rig, anchors } = rigFixture();
    const tl = buildCamera(scene, rig, anchors);
    tl.seek(1, false);
    const scale = Number(gsap.getProperty(rig, "scale"));
    const x = Number(gsap.getProperty(rig, "xPercent"));
    expect(voidFree(scale, x, 0)).toBe(true);
    expect(rig.dataset.mfCameraClamped).toBe("1");
  });

  it("reports the authored (unclamped) pose next to the rendered one", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "void",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
      camera: { keyframes: [{ at: 0, scale: 1.4, xPct: 0 }] },
    } as SceneSpecInput);
    const { rig, anchors } = rigFixture();
    const tl = buildCamera(scene, rig, anchors);
    tl.seek(1, false);
    const state = cameraStateFromRig(rig);
    expect(state.clampedVoid).toBe(true);
    // the author asked for xPct 0; the renderer showed the safe edge instead
    expect(state.unclampedXPct).toBeCloseTo(0, 1);
    expect(state.xPct).toBeGreaterThan(35);
  });

  it("never exposes void for ANY keyframe of a scene that pans hard", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "pan hard",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 6000,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
      camera: {
        keyframes: [
          { at: 0, scale: 1 },
          { at: 2000, scale: 1.4, xPct: 0, yPct: 0 },
          { at: 4000, scale: 1.1, xPct: 100, yPct: 100 },
        ],
      },
    } as SceneSpecInput);
    const { rig, anchors } = rigFixture();
    const tl = buildCamera(scene, rig, anchors);
    for (let t = 0; t <= 6; t += 0.1) {
      tl.seek(t, false);
      const scale = Number(gsap.getProperty(rig, "scale"));
      const x = Number(gsap.getProperty(rig, "xPercent"));
      const y = Number(gsap.getProperty(rig, "yPercent"));
      expect(voidFree(scale, x, y), `void at t=${t}s (scale ${scale}, ${x}%, ${y}%)`).toBe(true);
    }
  });

  it("applies the clamp SYNCHRONOUSLY (a deferred write is overwritten)", () => {
    // The bug: the clamp was written with `gsap.set`, which lands on the
    // GLOBAL timeline — one tick later, by which time the next camera tween
    // had already put the unclamped value back. The rendered frame showed void
    // while the metadata claimed the camera was clamped.
    const scene = sceneOf({
      schemaVersion: 1,
      name: "sync",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 4000,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
      camera: { keyframes: [{ at: 0, scale: 1.4, xPct: 0 }] },
    } as SceneSpecInput);
    const { rig, anchors } = rigFixture();
    const tl = buildCamera(scene, rig, anchors);
    tl.seek(1, false);
    // NO extra tick, NO rAF: the rig is already clamped
    const scale = Number(gsap.getProperty(rig, "scale"));
    const x = Number(gsap.getProperty(rig, "xPercent"));
    expect(voidFree(scale, x, 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. focusTarget: smart scale / pan coupling
// ---------------------------------------------------------------------------

describe("focusTarget scale/pan coupling", () => {
  const focusScene = (strength: number) =>
    sceneOf({
      schemaVersion: 1,
      name: "focus",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 6000,
      layers: [
        { id: "bg", type: "background", variant: { variant: "solid", color: "#000" } },
        { id: "logo", type: "card", at: 0, position: { xPct: 50, yPct: 25 }, variant: { variant: "glassCard", title: "T" } },
      ],
      camera: {
        keyframes: [{ at: 0, scale: 1.08 }],
        moves: [{ move: "focusTarget", at: 1000, durationMs: 1200, targetLayerId: "logo", strength }],
      },
    } as SceneSpecInput);

  it("boosts the zoom until the target is reachable, so the frame stays covered", () => {
    const scene = focusScene(0.74);
    const { rig, anchors } = rigFixture();
    // the AUTHORED anchor — a measured box would be distorted by the layer's
    // own entrance tween
    anchors.set("logo", { xPct: 50, yPct: 25 });
    const tl = buildCamera(scene, rig, anchors);
    tl.seek(1.6, false);

    const scale = Number(gsap.getProperty(rig, "scale"));
    const x = Number(gsap.getProperty(rig, "xPercent"));
    const y = Number(gsap.getProperty(rig, "yPercent"));
    // zero void
    expect(voidFree(scale, x, y)).toBe(true);
    // …and the zoom really was boosted: 25% needs S ≥ 1/(1−0.25) = 1.333
    expect(scale).toBeGreaterThanOrEqual(1.333 - 1e-6);
    // the target is centred
    expect(lookAtPct(scale, y)).toBeCloseTo(25, 1);
  });

  it("keeps the frame covered even for a target that cannot be reached", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "focus edge",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 6000,
      layers: [
        { id: "bg", type: "background", variant: { variant: "solid", color: "#000" } },
        { id: "logo", type: "card", at: 0, position: { xPct: 50, yPct: 0 }, variant: { variant: "glassCard", title: "T" } },
      ],
      camera: {
        keyframes: [{ at: 0, scale: 1 }],
        moves: [{ move: "focusTarget", at: 1000, durationMs: 1200, targetLayerId: "logo", strength: 1 }],
      },
    } as SceneSpecInput);
    const { rig, anchors } = rigFixture();
    anchors.set("logo", { xPct: 50, yPct: 0 });
    const tl = buildCamera(scene, rig, anchors);
    tl.seek(1.6, false);
    const scale = Number(gsap.getProperty(rig, "scale"));
    const y = Number(gsap.getProperty(rig, "yPercent"));
    expect(voidFree(scale, 0, y)).toBe(true);
    // the zoom is capped, so the move does not run away
    expect(scale).toBeLessThanOrEqual(FOCUS_MAX_SCALE + 1e-6);
  });

  it("returns the camera to its pre-move pose when the move ends", () => {
    const scene = focusScene(1);
    const { rig, anchors } = rigFixture();
    anchors.set("logo", { xPct: 50, yPct: 25 });
    const tl = buildCamera(scene, rig, anchors);
    tl.seek(0.5, false);
    const before = Number(gsap.getProperty(rig, "scale"));
    tl.seek(4, false);
    expect(Number(gsap.getProperty(rig, "scale"))).toBeCloseTo(before, 3);
  });
});

// ---------------------------------------------------------------------------
// 4. transitions must not strand the rig
// ---------------------------------------------------------------------------

describe("whipPan transition", () => {
  const whipScene = (direction: "left" | "right") =>
    sceneOf({
      schemaVersion: 1,
      name: "whip",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 6000,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
      camera: { keyframes: [{ at: 0, scale: 1.12 }] },
      transitions: [{ kind: "whipPan", at: 1000, durationMs: 500, direction }],
    } as SceneSpecInput);

  it("returns the rig to its exact pre-transition pose", () => {
    for (const direction of ["left", "right"] as const) {
      const scene = whipScene(direction);
      const { rig, anchors } = rigFixture();
      const tl = gsap.timeline({ paused: true });
      tl.to({}, { duration: scene.durationMs / 1000 }, 0);
      applyCamera(tl, scene, rig, anchors);
      applyTransitions(tl, scene, rig);
      applyViewportClamp(tl, rig, scene);

      tl.seek(0.5, false);
      const before = {
        x: Number(gsap.getProperty(rig, "xPercent")),
        scale: Number(gsap.getProperty(rig, "scale")),
      };

      tl.seek(1.6, false); // midpoint of the whip
      tl.seek(4, false); // well after it ends
      const after = {
        x: Number(gsap.getProperty(rig, "xPercent")),
        scale: Number(gsap.getProperty(rig, "scale")),
      };
      expect(after.x, `${direction}: rig stranded on the x axis`).toBeCloseTo(before.x, 3);
      expect(after.scale, `${direction}: rig stranded on zoom`).toBeCloseTo(before.scale, 3);
    }
  });

  it("stays void-free across the whole whip", () => {
    const scene = whipScene("left");
    const { rig, anchors } = rigFixture();
    const tl = gsap.timeline({ paused: true });
    tl.to({}, { duration: scene.durationMs / 1000 }, 0);
    applyCamera(tl, scene, rig, anchors);
    applyTransitions(tl, scene, rig);
    applyViewportClamp(tl, rig, scene);

    for (let t = 1; t <= 1.5; t += 0.02) {
      tl.seek(t, false);
      const scale = Number(gsap.getProperty(rig, "scale"));
      const x = Number(gsap.getProperty(rig, "xPercent"));
      expect(voidFree(scale, x, 0), `void at t=${t.toFixed(2)}s (scale ${scale}, x ${x}%)`).toBe(true);
    }
  });
});
