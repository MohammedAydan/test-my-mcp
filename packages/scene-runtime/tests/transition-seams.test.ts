// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseScene, type SceneSpecInput } from "@motionforge/scene-spec";

import {
  MAX_DEAD_GAP_MS,
  PEAK_COVER_MAX_MS,
  PEAK_COVER_TARGET_MS,
  bridgedWindow,
  findTransitionOverlaps,
  foregroundDeadGaps,
  layerWindow,
  planSeamBridges,
} from "@motionforge/scene-spec";
import { peakHoldMs, peakWindow } from "../src/transitions.js";

/**
 * THE SEAM BRIDGE — how a cut keeps the stage populated on both sides.
 *
 * THE DEFECT THIS FIXES (field audit of `scene-01`, 8.0–8.5 s): the two Act 2
 * layers ended at 7800 ms, the `morph` transition did not begin until 8000 ms and
 * covered nothing until its midpoint at 8350 ms, and the outro did not appear
 * until 8700 ms — so 500 ms+ rendered as a blank dark screen, with every
 * individual number in the SceneSpec perfectly legal.
 *
 * The rule: a seam is covered from both sides. The outgoing act is HELD to the
 * transition midpoint; the incoming act STARTS there.
 */

function sceneOf(input: SceneSpecInput) {
  return parseScene(input);
}

const bridgeScene = (transitions: SceneSpecInput["transitions"]) =>
  sceneOf({
    schemaVersion: 1,
    name: "seams",
    assets: [{ id: "a", kind: "image", src: "vault:a.svg", mime: "image/svg+xml" }],
    canvas: { shape: "16:9", scale: 1080 },
    durationMs: 12000,
    layers: [
      { id: "bg", type: "background", variant: { variant: "solid", color: "#05070d" } },
      { id: "logo", type: "imageLogo", at: 200, duration: 3800, assetId: "a", widthPx: 300, position: { xPct: 50, yPct: 34 } },
      { id: "hero", type: "kineticText", at: 700, duration: 3300, text: "x", sizePx: 84, position: { xPct: 50, yPct: 69 } },
      { id: "bar", type: "card", at: 4300, duration: 3500, position: { xPct: 50, yPct: 42 }, variant: { variant: "progressBar", label: "x", value: 50, fill: "#22d3ee", heightPx: 22, radiusPx: 11, widthPx: 200 } },
      { id: "note", type: "card", at: 4600, duration: 3200, position: { xPct: 50, yPct: 67 }, variant: { variant: "glassCard", title: "t", widthPx: 200, paddingPx: 20 } },
      { id: "outro", type: "kineticText", at: 8700, duration: 3100, text: "y", sizePx: 92, position: { xPct: 50, yPct: 48 } },
      { id: "fgx", type: "foregroundFX", at: 0, effects: [{ kind: "vignette", strength: 0.4 }] },
    ],
    transitions,
  } as SceneSpecInput);

describe("act seams", () => {
  it("holds an outgoing act to the transition midpoint", () => {
    const scene = bridgeScene([{ kind: "whipPan", at: 4000, durationMs: 500, direction: "left" }]);
    const logo = scene.layers[1]!;
    const hero = scene.layers[2]!;
    const bridges = new Map(planSeamBridges(scene).map((b) => [b.layerId, b]));
    expect(bridges.get("logo")?.mode).toBe("holdOutgoing");
    expect(bridges.get("hero")?.mode).toBe("holdOutgoing");
    // held to 4250, the whip midpoint — not to their authored end of 4000
    expect(bridgedWindow(scene, logo, bridges.get("logo")).endMs).toBe(4250);
    expect(bridgedWindow(scene, hero, bridges.get("hero")).endMs).toBe(4250);
  });

  it("starts an incoming act UNDER THE COVER (42% of the transition window)", () => {
    const scene = bridgeScene([{ kind: "whipPan", at: 4000, durationMs: 500, direction: "left" }]);
    const bar = scene.layers[3]!;
    const note = scene.layers[4]!;
    const bridges = new Map(planSeamBridges(scene).map((b) => [b.layerId, b]));
    // 42% of 500ms = 210ms → 4000 + 210 = 4210
    expect(bridgedWindow(scene, bar, bridges.get("bar")).startMs).toBe(4210);
    expect(bridgedWindow(scene, note, bridges.get("note")).startMs).toBe(4210);
    // the authored END is preserved: an act moved early still lives as long
    expect(bridgedWindow(scene, bar, bridges.get("bar")).endMs).toBe(7800);
  });

  it("bridges the second seam too, so no act leaves a gap anywhere", () => {
    const scene = bridgeScene([
      { kind: "whipPan", at: 4000, durationMs: 500, direction: "left" },
      { kind: "wipe", at: 8000, durationMs: 450, direction: "left", color: "#22d3ee" },
    ]);
    const bridges = planSeamBridges(scene);
    const outro = bridges.find((b) => b.layerId === "outro");
    expect(outro?.mode).toBe("startIncoming");
    expect(outro?.seamMidMs).toBe(8225);
    const bar = bridges.find((b) => b.layerId === "bar");
    expect(bar?.mode).toBe("holdOutgoing");
    expect(bar?.seamMidMs).toBe(8225);
  });

  it("never bridges a layer that is not actually bounded", () => {
    const scene = bridgeScene([{ kind: "whipPan", at: 4000, durationMs: 500, direction: "left" }]);
    // `bg` and `fgx` run to the scene end and have no authored end to move
    expect(layerWindow(scene.layers[0]!, scene.durationMs).endMs).toBe(12000);
    expect(planSeamBridges(scene).map((b) => b.layerId)).not.toContain("bg");
    expect(planSeamBridges(scene).map((b) => b.layerId)).not.toContain("fgx");
  });

  it("leaves the authored window alone when nothing is near a cut", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "calm",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 6000,
      layers: [
        { id: "bg", type: "background", variant: { variant: "solid", color: "#000" } },
        { id: "a", type: "card", at: 100, duration: 4000, position: { xPct: 50, yPct: 50 }, variant: { variant: "glassCard", title: "t", widthPx: 200, paddingPx: 20 } },
      ],
      transitions: [{ kind: "whipPan", at: 1000, durationMs: 500, direction: "left" }],
    } as SceneSpecInput);
    // the act ends at 4100, which is beyond the look-behind band
    expect(planSeamBridges(scene)).toHaveLength(0);
  });
});

describe("no dead frame", () => {
  it("reports a dead gap that no seam is near enough to bridge", () => {
    // the audited scene's shape: Act 2 ends, Act 3 starts 500 ms later, and the
    // transition sits after BOTH of them — so nothing covers the hole
    const unbridged = sceneOf({
      schemaVersion: 1,
      name: "dead",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 12000,
      layers: [
        { id: "bg", type: "background", variant: { variant: "solid", color: "#05070d" } },
        { id: "bar", type: "card", at: 4300, duration: 3500, position: { xPct: 50, yPct: 42 }, variant: { variant: "progressBar", label: "x", value: 50, fill: "#22d3ee", heightPx: 22, radiusPx: 11, widthPx: 200 } },
        { id: "outro", type: "kineticText", at: 8700, duration: 3100, text: "y", sizePx: 92, position: { xPct: 50, yPct: 48 } },
        { id: "fgx", type: "foregroundFX", at: 0, effects: [{ kind: "vignette", strength: 0.4 }] },
      ],
      transitions: [{ kind: "morph", at: 9600, durationMs: 700 }],
    } as SceneSpecInput);
    // foregroundFX is grade, not content, so it does not close the gap
    const gaps = foregroundDeadGaps(unbridged);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0]!.durationMs).toBeGreaterThan(MAX_DEAD_GAP_MS);
  });

  it("closes every gap once the seam is bridged", () => {
    const scene = bridgeScene([
      { kind: "whipPan", at: 4000, durationMs: 500, direction: "left" },
      { kind: "wipe", at: 8000, durationMs: 450, direction: "left", color: "#22d3ee" },
    ]);
    expect(foregroundDeadGaps(scene)).toEqual([]);
  });

  it("still reports a genuine hole between two acts", () => {
    const scene = sceneOf({
      schemaVersion: 1,
      name: "hole",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 12000,
      layers: [
        { id: "bg", type: "background", variant: { variant: "solid", color: "#000" } },
        { id: "a", type: "kineticText", at: 100, duration: 2000, text: "x", sizePx: 84, position: { xPct: 50, yPct: 50 } },
        { id: "b", type: "kineticText", at: 6000, duration: 2000, text: "y", sizePx: 84, position: { xPct: 50, yPct: 50 } },
        { id: "fgx", type: "foregroundFX", at: 0, effects: [{ kind: "vignette", strength: 0.4 }] },
      ],
      transitions: [{ kind: "whipPan", at: 4000, durationMs: 500, direction: "left" }],
    } as SceneSpecInput);
    // 2100 → 6000 is a 3.9 s hole no seam is near
    expect(foregroundDeadGaps(scene).length).toBeGreaterThan(0);
  });
});

describe("single active transition + short peak", () => {
  it("rejects overlapping transitions at validation", () => {
    // two live transitions stack their overlays AND their camera offsets, which
    // renders as two broken transitions happening at once
    expect(() =>
      parseScene({
        schemaVersion: 1,
        name: "overlap",
        canvas: { shape: "16:9", scale: 1080 },
        durationMs: 6000,
        layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
        transitions: [
          { kind: "wipe", at: 1000, durationMs: 700, color: "#fff" },
          { kind: "morph", at: 1400, durationMs: 700 },
        ],
      } as SceneSpecInput)
    ).toThrow(/at most one transition may be active at a time/);
  });

  it("accepts transitions that merely abut", () => {
    const scene = parseScene({
      schemaVersion: 1,
      name: "abut",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 6000,
      layers: [{ id: "bg", type: "background", variant: { variant: "solid", color: "#000" } }],
      transitions: [
        { kind: "wipe", at: 1000, durationMs: 700, color: "#fff" },
        { kind: "morph", at: 1700, durationMs: 700 },
      ],
    } as SceneSpecInput);
    expect(findTransitionOverlaps(scene)).toEqual([]);
  });

  it("holds the fully-covered peak for at most the permitted duration", () => {
    // a cover held longer than ~120 ms stops reading as a cut and starts
    // reading as a hold on an empty screen
    expect(PEAK_COVER_TARGET_MS).toBeLessThanOrEqual(PEAK_COVER_MAX_MS);
    expect(PEAK_COVER_TARGET_MS).toBeGreaterThan(0);
    for (const kind of ["wipe", "whipPan", "glitch", "morph"] as const) {
      for (const durationMs of [350, 450, 550, 700, 1200]) {
        expect(peakHoldMs(kind, durationMs), `${kind} @ ${durationMs}ms`).toBeLessThanOrEqual(PEAK_COVER_MAX_MS);
        expect(peakHoldMs(kind, durationMs)).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the effective cover tight and the bell symmetric", () => {
    for (const durationMs of [350, 450, 550]) {
      const { inEnd, outStart } = peakWindow("wipe", durationMs);
      expect(inEnd).toBeLessThan(0.5);
      expect(outStart).toBeGreaterThan(0.5);
      // the cover is reached BEFORE the midpoint and released AFTER it
      expect(inEnd).toBeGreaterThan(0);
    }
  });
});
