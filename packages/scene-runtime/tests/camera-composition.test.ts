// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { gsap } from "gsap";
import { parseScene, type SceneSpecInput } from "@motionforge/scene-spec";

import {
  applyCamera,
  blendDominant,
  composeCameraAt,
  emptyCameraContext,
  planCameraMoveWindow,
  type CameraContext,
  type LayerAnchor,
} from "../src/camera.js";

/**
 * THE COMPOSED CAMERA CURVE — the regression test for the "double-pump" zoom.
 *
 * Field audit of `scene-01` at 2 fps:
 *
 *      2.0 s   scale 1.00    balanced
 *      2.5 s   scale 1.47    focusTarget inflates, headline clips off the bottom
 *      3.0 s   scale 1.00    ← SNAP BACK OUT
 *      3.5 s   scale 1.47    ← ZOOMS BACK IN, clipping the headline again
 *
 * The cause was structural, not a bad number: the keyframe tween spans the
 * whole scene and re-writes `scale: 1` every frame, while the move's ramp-in /
 * ramp-out tweens are only rendered while the playhead is inside their windows.
 * The instant the ramp-in ended, the permanent tween won. GSAP's write order is
 * not ours, so no tween arrangement could fix it.
 *
 * These tests sample `scale` every 50 ms and assert the curve is continuous and
 * free of the `up → down → up` double tooth that defines the defect.
 */

function sceneOf(input: SceneSpecInput) {
  return parseScene(input);
}

const SAMPLE_MS = 50;

/** A logo high on the canvas and a headline low on it — the scene-01 layout. */
const ANCHORS = new Map<string, LayerAnchor>([
  ["logo", { xPct: 50, yPct: 34 }],
  ["headline", { xPct: 50, yPct: 69 }],
]);

function ctx(): CameraContext {
  return { ...emptyCameraContext(), layerAnchors: ANCHORS, widthPx: 1920, heightPx: 1080 };
}

/** keyframes + a focusTarget + a slowPushIn, the combination the brief names. */
function mixedActScene(): ReturnType<typeof sceneOf> {
  return sceneOf({
    schemaVersion: 1,
    name: "mixed act",
    canvas: { shape: "16:9", scale: 1080 },
    durationMs: 8000,
    layers: [
      { id: "bg", type: "background", variant: { variant: "solid", color: "#000" } },
      { id: "logo", type: "card", at: 0, position: { xPct: 50, yPct: 34 }, variant: { variant: "glassCard", title: "L" } },
    ],
    camera: {
      keyframes: [
        { at: 0, scale: 1 },
        { at: 2000, scale: 1.15 },
        { at: 4000, scale: 1.3 },
        { at: 8000, scale: 1.3 },
      ],
      moves: [
        { move: "focusTarget", at: 2400, durationMs: 1600, targetLayerId: "logo", strength: 1 },
        { move: "slowPushIn", at: 3200, durationMs: 800, strength: 1 },
      ],
    },
  } as SceneSpecInput);
}

/** Sample the composed `scale` across `[fromMs, toMs]` every `SAMPLE_MS`. */
function sampleScale(scene: ReturnType<typeof sceneOf>, fromMs: number, toMs: number): number[] {
  const out: number[] = [];
  for (let t = fromMs; t <= toMs; t += SAMPLE_MS) {
    out.push(composeCameraAt(scene, t / 1000, ctx()).scale);
  }
  return out;
}

/** First derivative, per sample. */
function deltas(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) out.push(series[i]! - series[i - 1]!);
  return out;
}

/** Sign of a derivative sample, with a dead-band so noise is not a direction. */
function signs(series: number[], eps: number): Array<1 | -1 | 0> {
  return deltas(series).map((d) => (d > eps ? 1 : d < -eps ? -1 : 0));
}

/** Collapse a sign run so `+ 0 0 +` reads as a single `+`. */
function collapse(run: Array<1 | -1 | 0>): Array<1 | -1> {
  const out: Array<1 | -1> = [];
  for (const s of run) {
    if (s === 0) continue;
    if (out.length === 0 || out[out.length - 1] !== s) out.push(s);
  }
  return out;
}

/**
 * Does the curve reverse direction and then reverse BACK?
 *
 * That is the double tooth: an excursion that leaves the trend and returns to
 * it (`+ − +` or `− + −`). A single reversal (`+ −`) is a legitimate envelope —
 * a push-in that releases — but two reversals in a row mean the camera zoomed
 * in, backed out, and zoomed in again, which is precisely the audited defect.
 */
function hasDoubleTooth(run: Array<1 | -1>): boolean {
  for (let i = 0; i + 2 < run.length; i++) {
    if (run[i] !== run[i + 1] && run[i + 1] !== run[i + 2]) return true;
  }
  return false;
}

describe("camera composition is a single smooth curve", () => {
  it("has no double-tooth peak/dip across a keyframed act with two moves", () => {
    const scale = sampleScale(mixedActScene(), 0, 4000);
    const run = collapse(signs(scale, 0.002));
    expect(hasDoubleTooth(run), `sign run ${run.join("")}`).toBe(false);
  });

  it("is continuous: no sample-to-sample jump larger than a ramp can explain", () => {
    const scale = sampleScale(mixedActScene(), 0, 4000);
    for (let i = 1; i < scale.length; i++) {
      // 0.3 per 50 ms is a violent jump; the steepest authored ramp is ~0.02
      expect(Math.abs(scale[i]! - scale[i - 1]!), `jump at sample ${i}`).toBeLessThan(0.3);
    }
  });

  it("rises monotonically to the act's keyframed scale without pumping back", () => {
    const scene = mixedActScene();
    const scale = sampleScale(scene, 0, 4000);
    // keyframes alone are a straight 1.00 → 1.30 ramp; the moves only add to it
    const baseline = sampleScale(
      sceneOf({
        schemaVersion: 1,
        name: "no moves",
        canvas: { shape: "16:9", scale: 1080 },
        durationMs: 8000,
        layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
        camera: {
          keyframes: [
            { at: 0, scale: 1 },
            { at: 2000, scale: 1.15 },
            { at: 4000, scale: 1.3 },
          ],
        },
      } as SceneSpecInput),
      0,
      4000
    );
    for (let i = 0; i < scale.length; i++) {
      expect(scale[i]!, `sample ${i} dipped below the keyframe ramp`).toBeGreaterThanOrEqual(baseline[i]! - 1e-6);
    }
    // …and it never exceeds the keyframe ramp plus both moves' full budgets
    expect(scale[80]).toBeLessThanOrEqual(1.3 + 0.14 + 0.12 + 1e-6);
  });

  it("reproduces the scene-01 defect shape only if the pipeline is bypassed", () => {
    // Guard against the test going vacuous: the OLD implementation's exact
    // numbers — hold at the peak, snap to 1.0, back to the peak — must be
    // detected by the same assertion that the new one passes.
    const pumped = [1, 1.2, 1.47, 1.47, 1.0, 1.0, 1.47, 1.3];
    expect(hasDoubleTooth(collapse(signs(pumped, 0.02)))).toBe(true);
  });
});

describe("camera moves never stack", () => {
  it("blends overlapping moves instead of summing their peaks", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "overlap",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 8000,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
      camera: {
        keyframes: [{ at: 0, scale: 1 }],
        moves: [
          { move: "slowPushIn", at: 1000, durationMs: 2000, strength: 1 },
          { move: "slowPushIn", at: 1400, durationMs: 2000, strength: 1 },
        ],
      },
    } as SceneSpecInput);
    // both moves peak at +0.12 while fully overlapped; summed that would be 0.24
    const peak = composeCameraAt(scene, 2.0, ctx()).scale;
    expect(peak).toBeLessThanOrEqual(1 + 0.12 + 1e-6);
    // and it still does something
    expect(peak).toBeGreaterThan(1 + 0.06);
  });

  it("never LOWERS an existing move when a weaker one joins it", () => {
    // THE REGRESSION: a weighted average of the contributions sits BELOW the
    // stronger move alone, so adding a move made the camera back off — a dip
    // of exactly the joining move's share, and therefore a double tooth
    // (`1.3800 → 1.3755 → 1.3780` in consecutive 50 ms samples). The blend
    // must keep the strongest move's full framing while the weaker one is live.
    const scene = sceneOf({
      schemaVersion: 1,
      name: "join",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 8000,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
      camera: {
        keyframes: [{ at: 0, scale: 1 }],
        moves: [
          { move: "focusTarget", at: 1000, durationMs: 2400, targetLayerId: "logo", strength: 1 },
          { move: "slowPushIn", at: 1600, durationMs: 800, strength: 1 },
        ],
      },
    } as SceneSpecInput);
    const scale: number[] = [];
    for (let t = 1000; t <= 4200; t += 50) scale.push(composeCameraAt(scene, t / 1000, ctx()).scale);
    expect(hasDoubleTooth(collapse(signs(scale, 0.001)))).toBe(false);
    // the stronger move's full framing really is held while the weaker joins
    expect(Math.max(...scale)).toBeGreaterThan(1.13);
  });

  it("keeps a move at full strength when nothing overlaps it", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "single",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 8000,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
      camera: {
        keyframes: [{ at: 0, scale: 1 }],
        moves: [{ move: "slowPushIn", at: 1000, durationMs: 1000, strength: 1 }],
      },
    } as SceneSpecInput);
    expect(composeCameraAt(scene, 1.5, ctx()).scale).toBeCloseTo(1.12, 6);
  });

  it("blendDominant takes the largest magnitude and keeps its sign", () => {
    expect(blendDominant([])).toBe(0);
    expect(blendDominant([0.14])).toBe(0.14);
    expect(blendDominant([0.14, 0.09])).toBe(0.14);
    expect(blendDominant([-0.26, 0.09])).toBe(-0.26);
    expect(blendDominant([0.09, -0.26])).toBe(-0.26);
  });
});

describe("a move holds its framing into the act cut", () => {
  const cutScene = () =>
    sceneOf({
      schemaVersion: 1,
      name: "cut",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 8000,
      layers: [
        { id: "bg", type: "background", variant: { variant: "solid", color: "#000" } },
        { id: "logo", type: "card", at: 0, position: { xPct: 50, yPct: 34 }, variant: { variant: "glassCard", title: "L" } },
      ],
      camera: {
        keyframes: [{ at: 0, scale: 1 }],
        moves: [{ move: "focusTarget", at: 2400, durationMs: 1600, targetLayerId: "logo", strength: 1 }],
      },
      transitions: [{ kind: "whipPan", at: 4000, durationMs: 500, direction: "left" }],
    } as SceneSpecInput);

  it("defers the ramp-out to the transition midpoint", () => {
    const scene = cutScene();
    const move = scene.camera.moves[0]!;
    const window = planCameraMoveWindow(move, scene);
    expect(window.authoredEndSec).toBeCloseTo(4.0, 6); // authored end
    expect(window.seamMidSec).toBeCloseTo(4.25, 6); // whipPan midpoint
    // the final pose is HELD until the cut, and only then released
    expect(window.holdToSec).toBeCloseTo(4.25, 6);
    expect(window.endSec).toBeGreaterThan(window.holdToSec);
  });

  it("is already at full framing when the act is cut", () => {
    const scene = cutScene();
    // 3.0 s is inside the old ramp-out, which is where the audited frame read
    // scale 1.00; 3.5 s is where it read 1.47 again. Both must now read 1.14.
    expect(composeCameraAt(scene, 3.0, ctx()).scale).toBeCloseTo(1.14, 3);
    expect(composeCameraAt(scene, 3.5, ctx()).scale).toBeCloseTo(1.14, 3);
    expect(composeCameraAt(scene, 3.9, ctx()).scale).toBeCloseTo(1.14, 3);
  });

  it("leaves no deficit when the window ends without a cut to hold for", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "no cut",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 8000,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
      camera: {
        keyframes: [{ at: 0, scale: 1 }],
        moves: [{ move: "slowPushIn", at: 1000, durationMs: 1000 }],
      },
    } as SceneSpecInput);
    expect(planCameraMoveWindow(scene.camera.moves[0]!, scene).seamMidSec).toBeNull();
    expect(composeCameraAt(scene, 1.5, ctx()).scale).toBeCloseTo(1.12, 6);
    expect(composeCameraAt(scene, 2.5, ctx()).scale).toBeCloseTo(1, 6);
  });
});

describe("the rendered rig matches the composed pose, on any seek", () => {
  const rigFor = (): HTMLElement => {
    const rig = document.createElement("div");
    document.body.appendChild(rig);
    return rig;
  };

  it("writes the composition synchronously, forwards and backwards", () => {
    const scene = mixedActScene();
    const rig = rigFor();
    const tl = gsap.timeline({ paused: true });
    tl.to({}, { duration: scene.durationMs / 1000 }, 0);
    applyCamera(tl, scene, rig, ctx());

    for (const t of [0, 1, 2.4, 2.5, 3, 3.5, 4, 6, 0.5, 2.5]) {
      tl.seek(t, false);
      const expected = composeCameraAt(scene, t, ctx());
      const scale = Number(gsap.getProperty(rig, "scale"));
      expect(scale, `scale at t=${t}s`).toBeCloseTo(expected.scale, 6);
      // …and the look-at the frame actually shows
      const x = Number(gsap.getProperty(rig, "xPercent"));
      expect(lookAtSafe(scale, x), `look-at at t=${t}s`).toBeCloseTo(expected.xPct, 6);
    }
  });

  it("gives the same answer for a seek that lands past the move and back", () => {
    const scene = mixedActScene();
    const rig = rigFor();
    const tl = gsap.timeline({ paused: true });
    tl.to({}, { duration: scene.durationMs / 1000 }, 0);
    applyCamera(tl, scene, rig, ctx());

    tl.seek(2.9, false);
    const at29 = Number(gsap.getProperty(rig, "scale"));
    tl.seek(7.9, false);
    tl.seek(2.9, false);
    expect(Number(gsap.getProperty(rig, "scale"))).toBeCloseTo(at29, 9);
  });
});

/** The canvas point at the viewport centre, from the live rig. */
function lookAtSafe(scale: number, xPercent: number): number {
  return 50 - xPercent / Math.max(1e-6, scale);
}
