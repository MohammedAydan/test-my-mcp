import { describe, expect, it } from "vitest";
import {
  deviceMockupLayerSchema,
  cursorFlowLayerSchema,
  hexColorSchema,
  layerSchema,
  sanitizeSceneInput,
  sanitizeSceneInputWithReport,
  type DeviceMockupLayer,
  type CursorFlowLayer,
} from "../src/index.js";

describe("Deliverable 0 — hexColorSchema", () => {
  it("accepts valid 3-digit and 6-digit hex colors", () => {
    expect(hexColorSchema.safeParse("#fff").success).toBe(true);
    expect(hexColorSchema.safeParse("#38bdf8").success).toBe(true);
    expect(hexColorSchema.safeParse("#000").success).toBe(true);
    expect(hexColorSchema.safeParse("#123456").success).toBe(true);
    expect(hexColorSchema.safeParse("#AABBCC").success).toBe(true);
  });

  it("rejects invalid color formats like named colors, short hex, and rgb", () => {
    expect(hexColorSchema.safeParse("red").success).toBe(false);
    expect(hexColorSchema.safeParse("#12").success).toBe(false);
    expect(hexColorSchema.safeParse("rgb(0,0,0)").success).toBe(false);
    expect(hexColorSchema.safeParse("#12345").success).toBe(false);
    expect(hexColorSchema.safeParse("#1234567").success).toBe(false);
    expect(hexColorSchema.safeParse("").success).toBe(false);
  });
});

describe("Deliverable 1 & 2 — Defaults", () => {
  it("populates deviceMockup defaults correctly", () => {
    const raw = {
      id: "mockup-1",
      type: "deviceMockup",
    };
    const parsed = deviceMockupLayerSchema.parse(raw) as DeviceMockupLayer;
    expect(parsed.deviceType).toBe("browser");
    expect(parsed.theme).toBe("dark");
    expect(parsed.contentVariant).toBe("dashboard");
    expect(parsed.titleOrUrl).toBe("app.motionforge.ai");
    expect(parsed.at).toBe(0);
    expect(parsed.direction).toBe("ltr");
    expect(parsed.tiltDeg).toBeUndefined();
  });

  it("populates cursorFlow defaults correctly", () => {
    const raw = {
      id: "cursor-1",
      type: "cursorFlow",
      waypoints: [{ atMs: 100, xPct: 20, yPct: 30 }],
    };
    const parsed = cursorFlowLayerSchema.parse(raw) as CursorFlowLayer;
    expect(parsed.cursorStyle).toBe("macos");
    expect(parsed.cursorScale).toBe(1.2);
    expect(parsed.accentColor).toBe("#38bdf8");
    expect(parsed.waypoints[0]?.action).toBe("move");
  });
});

describe("Strict Rejections", () => {
  it("rejects unknown keys on deviceMockup", () => {
    const raw = {
      id: "mockup-1",
      type: "deviceMockup",
      unknownProperty: 123,
    };
    const result = deviceMockupLayerSchema.safeParse(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });

  it("rejects unknown keys on cursorFlow", () => {
    const raw = {
      id: "cursor-1",
      type: "cursorFlow",
      waypoints: [{ atMs: 0, xPct: 10, yPct: 10 }],
      unknownKey: "bad",
    };
    const result = cursorFlowLayerSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it("rejects tiltDeg outside [-35, 35] (e.g. 40 deg)", () => {
    const rawX = {
      id: "mockup-1",
      type: "deviceMockup",
      tiltDeg: { rotateX: 40, rotateY: 0 },
    };
    expect(deviceMockupLayerSchema.safeParse(rawX).success).toBe(false);

    const rawY = {
      id: "mockup-1",
      type: "deviceMockup",
      tiltDeg: { rotateX: 0, rotateY: -40 },
    };
    expect(deviceMockupLayerSchema.safeParse(rawY).success).toBe(false);
  });

  it("rejects atMs < 0 in waypoints", () => {
    const raw = {
      id: "cursor-1",
      type: "cursorFlow",
      waypoints: [{ atMs: -10, xPct: 20, yPct: 30 }],
    };
    expect(cursorFlowLayerSchema.safeParse(raw).success).toBe(false);
  });

  it("rejects xPct > 100 or yPct > 100 in waypoints", () => {
    const rawX = {
      id: "cursor-1",
      type: "cursorFlow",
      waypoints: [{ atMs: 0, xPct: 105, yPct: 50 }],
    };
    expect(cursorFlowLayerSchema.safeParse(rawX).success).toBe(false);

    const rawY = {
      id: "cursor-1",
      type: "cursorFlow",
      waypoints: [{ atMs: 0, xPct: 50, yPct: 150 }],
    };
    expect(cursorFlowLayerSchema.safeParse(rawY).success).toBe(false);
  });

  it("rejects empty waypoints (min 1)", () => {
    const raw = {
      id: "cursor-1",
      type: "cursorFlow",
      waypoints: [],
    };
    expect(cursorFlowLayerSchema.safeParse(raw).success).toBe(false);
  });

  it("rejects > 20 waypoints (e.g. 21 waypoints)", () => {
    const waypoints = Array.from({ length: 21 }, (_, i) => ({
      atMs: i * 100,
      xPct: 10,
      yPct: 10,
    }));
    const raw = {
      id: "cursor-1",
      type: "cursorFlow",
      waypoints,
    };
    expect(cursorFlowLayerSchema.safeParse(raw).success).toBe(false);
  });
});

describe("Sanitizer Waypoint Sorting", () => {
  it("sorts waypoints stably by atMs after sanitizeSceneInput()", () => {
    const sceneInput = {
      schemaVersion: 1,
      name: "Cursor Sort Test",
      canvas: { shape: "16:9", scale: 1080 },
      durationMs: 5000,
      layers: [
        {
          id: "cursor-1",
          type: "cursorFlow",
          waypoints: [
            { atMs: 800, xPct: 70, yPct: 80, label: "third" },
            { atMs: 200, xPct: 20, yPct: 30, label: "first" },
            { atMs: 500, xPct: 50, yPct: 50, label: "second" },
          ],
        },
      ],
    };

    const report = sanitizeSceneInputWithReport(sceneInput);
    const sanitized = report.scene as typeof sceneInput;
    const sanitizedWaypoints = sanitized.layers[0]?.waypoints as Array<{ atMs: number; label: string }>;

    expect(sanitizedWaypoints[0]?.atMs).toBe(200);
    expect(sanitizedWaypoints[0]?.label).toBe("first");
    expect(sanitizedWaypoints[1]?.atMs).toBe(500);
    expect(sanitizedWaypoints[1]?.label).toBe("second");
    expect(sanitizedWaypoints[2]?.atMs).toBe(800);
    expect(sanitizedWaypoints[2]?.label).toBe("third");

    expect(report.healed).toContain("layers.0.waypoints");
  });
});
