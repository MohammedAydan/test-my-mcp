// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("lottie-web", () => ({
  default: {
    loadAnimation: () => ({
      totalFrames: 0,
      setSpeed: () => undefined,
      goToAndStop: () => undefined,
    }),
  },
}));

import { parseScene, type SceneSpecInput } from "@motionforge/scene-spec";
import { createStage } from "../src/stage.js";
import { buildScene } from "../src/scene-builder.js";
import { evaluateCursorPosition } from "../src/layers/cursor-flow.js";

function mountTestScene(layers: SceneSpecInput["layers"], durationMs = 5000) {
  document.body.innerHTML = `<div id="viewport"></div>`;
  const stage = createStage(1920, 1080);
  const scene = parseScene({
    schemaVersion: 1,
    name: "Device and Cursor Test",
    canvas: { shape: "16:9", scale: 1080 },
    durationMs,
    layers,
  } as SceneSpecInput);

  const built = buildScene(scene, stage, {
    fonts: new Map(),
    resolveAsset: () => "",
    assetKind: () => "image",
    lottieData: () => ({}),
    registerSeekable: () => undefined,
    assetIntrinsicSize: () => undefined,
  });

  return { stage, scene, built };
}

describe("deviceMockup & cursorFlow runtime renderers", () => {
  it("1. deviceMockup renders authentic chrome across types", () => {
    // Browser: traffic lights + URL text present
    const { stage: browserStage } = mountTestScene([
      {
        id: "mockup-browser",
        type: "deviceMockup",
        deviceType: "browser",
        titleOrUrl: "dashboard.motionforge.ai",
      },
    ]);
    const trafficLights = browserStage.content.querySelector(".mf-traffic-lights");
    expect(trafficLights).not.toBeNull();
    const dots = browserStage.content.querySelectorAll(".mf-traffic-light");
    expect(dots.length).toBe(3);
    const urlPill = browserStage.content.querySelector(".mf-url-pill");
    expect(urlPill?.textContent).toContain("dashboard.motionforge.ai");

    // Terminal: prompt marker present
    const { stage: termStage } = mountTestScene([
      {
        id: "mockup-term",
        type: "deviceMockup",
        deviceType: "terminal",
        titleOrUrl: "cli.motionforge.ai",
      },
    ]);
    const prompt = termStage.content.querySelector(".mf-prompt");
    expect(prompt).not.toBeNull();
    expect(prompt?.textContent).toContain("$");

    // iPhone: notch / dynamic island element present
    const { stage: iphoneStage } = mountTestScene([
      {
        id: "mockup-iphone",
        type: "deviceMockup",
        deviceType: "iphone",
      },
    ]);
    const notch = iphoneStage.content.querySelector(".mf-notch");
    expect(notch).not.toBeNull();
  });

  it("2. Determinism: identical scene and seek yields identical innerHTML", () => {
    const sceneDef: SceneSpecInput["layers"] = [
      {
        id: "bg",
        type: "background",
        variant: { variant: "solid", color: "#000000" },
      },
      {
        id: "device",
        type: "deviceMockup",
        deviceType: "browser",
        contentVariant: "dashboard",
        titleOrUrl: "preview.motionforge.ai",
        headline: "Realtime View",
      },
      {
        id: "cursor",
        type: "cursorFlow",
        waypoints: [
          { atMs: 0, xPct: 20, yPct: 30, action: "move" },
          { atMs: 1000, xPct: 50, yPct: 50, action: "click", label: "Save" },
          { atMs: 2000, xPct: 80, yPct: 70, action: "hover" },
        ],
      },
    ];

    const run1 = mountTestScene(sceneDef, 4000);
    const run2 = mountTestScene(sceneDef, 4000);

    run1.built.tl.seek(1.2, false);
    run2.built.tl.seek(1.2, false);

    expect(run1.stage.content.innerHTML).toBe(run2.stage.content.innerHTML);
  });

  it("3. cursorFlow: holds at boundaries and matches cubic ease within 0.5% at midpoint", () => {
    const waypoints = [
      { atMs: 1000, xPct: 20, yPct: 30, action: "move" as const },
      { atMs: 2000, xPct: 60, yPct: 70, action: "move" as const },
      { atMs: 3000, xPct: 90, yPct: 95, action: "move" as const },
    ];

    const { stage, built } = mountTestScene(
      [
        {
          id: "cursor",
          type: "cursorFlow",
          waypoints,
        },
      ],
      4000
    );

    const cursor = stage.content.querySelector(".mf-cursor") as HTMLElement;
    expect(cursor).not.toBeNull();

    // At t=0 (before first waypoint): holds first waypoint position
    built.tl.seek(0, false);
    expect(Number(cursor.dataset.xPct)).toBeCloseTo(20, 2);
    expect(Number(cursor.dataset.yPct)).toBeCloseTo(30, 2);
    expect(parseFloat(cursor.style.left)).toBeCloseTo(20, 2);
    expect(parseFloat(cursor.style.top)).toBeCloseTo(30, 2);

    // At midpoint between W0 (1000ms) and W1 (2000ms): t=1500ms (1.5s)
    // Cubic ease at 0.5 is exactly 0.5.
    // x = 20 + (60 - 20) * 0.5 = 40
    // y = 30 + (70 - 30) * 0.5 = 50
    built.tl.seek(1.5, false);
    const midX = Number(cursor.dataset.xPct);
    const midY = Number(cursor.dataset.yPct);
    expect(midX).toBeCloseTo(40, 1);
    expect(midY).toBeCloseTo(50, 1);
    expect(Math.abs(midX - 40)).toBeLessThan(0.5);
    expect(Math.abs(midY - 50)).toBeLessThan(0.5);

    // Also assert directly against evaluateCursorPosition helper
    const evaluatedMid = evaluateCursorPosition(waypoints, 1500);
    expect(evaluatedMid.xPct).toBeCloseTo(40, 2);
    expect(evaluatedMid.yPct).toBeCloseTo(50, 2);

    // Quarter point: t=1250ms (norm = 0.25). Cubic ease at 0.25 is 4 * 0.25^3 = 0.0625.
    // x = 20 + 40 * 0.0625 = 22.5
    // y = 30 + 40 * 0.0625 = 32.5
    built.tl.seek(1.25, false);
    expect(Number(cursor.dataset.xPct)).toBeCloseTo(22.5, 1);
    expect(Number(cursor.dataset.yPct)).toBeCloseTo(32.5, 1);

    // After the last waypoint (e.g. t=3.5s): holds the last waypoint position
    built.tl.seek(3.5, false);
    expect(Number(cursor.dataset.xPct)).toBeCloseTo(90, 2);
    expect(Number(cursor.dataset.yPct)).toBeCloseTo(95, 2);
    expect(parseFloat(cursor.style.left)).toBeCloseTo(90, 2);
    expect(parseFloat(cursor.style.top)).toBeCloseTo(95, 2);
  });

  it("4. Click: ripple opacity > 0 at click.atMs + 200 and 0 at click.atMs + 500", () => {
    const { stage, built } = mountTestScene(
      [
        {
          id: "cursor",
          type: "cursorFlow",
          waypoints: [
            { atMs: 1000, xPct: 40, yPct: 40, action: "click" },
            { atMs: 3000, xPct: 70, yPct: 70, action: "move" },
          ],
        },
      ],
      4000
    );

    const ripples = stage.content.querySelectorAll(".mf-cursor-ripple");
    expect(ripples.length).toBeGreaterThan(0);
    const ripple = ripples[0] as HTMLElement;

    // At click.atMs + 200 (t = 1200ms -> 1.2s): ripple opacity must be > 0
    built.tl.seek(1.2, false);
    const opacityMid = Number(ripple.style.opacity);
    expect(opacityMid).toBeGreaterThan(0);

    // At click.atMs + 500 (t = 1500ms -> 1.5s): ripple opacity must be 0
    built.tl.seek(1.5, false);
    const opacityEnd = Number(ripple.style.opacity);
    expect(opacityEnd).toBe(0);
  });

  it("5. No Date.now or Math.random in the two renderer files", () => {
    const mockupPath = path.resolve(__dirname, "../src/layers/device-mockup.ts");
    const cursorPath = path.resolve(__dirname, "../src/layers/cursor-flow.ts");

    const mockupSource = fs.readFileSync(mockupPath, "utf-8");
    const cursorSource = fs.readFileSync(cursorPath, "utf-8");

    expect(mockupSource.includes("Date.now")).toBe(false);
    expect(mockupSource.includes("Math.random")).toBe(false);
    expect(cursorSource.includes("Date.now")).toBe(false);
    expect(cursorSource.includes("Math.random")).toBe(false);
  });
});
