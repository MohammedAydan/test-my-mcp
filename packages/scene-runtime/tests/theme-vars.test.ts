// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  MINIMAL_VALID_SCENE,
  parseScene,
  type SceneSpecInput,
} from "@motionforge/scene-spec";

import { createStage } from "../src/stage.js";
import {
  ALL_THEME_CSS_VARS,
  applyThemeVars,
} from "../src/theme.js";

describe("Theme CSS Vars Application", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="viewport"></div>`;
  });

  it("1. applyThemeVars(root, 'linearMinimal') sets --mf-bg-base to #08090c", () => {
    const root = document.createElement("div");
    applyThemeVars(root, "linearMinimal");
    expect(root.style.getPropertyValue("--mf-bg-base")).toBe("#08090c");
    expect(root.style.getPropertyValue("--mf-text-primary")).toBe("#f1f5f9");
    expect(root.style.getPropertyValue("--mf-accent-primary")).toBe("#6366f1");
    expect(root.style.getPropertyValue("--mf-card-bg")).toBe("rgba(17, 19, 26, 0.82)");
    expect(root.style.getPropertyValue("--mf-card-border")).toBe("rgba(255, 255, 255, 0.08)");
    expect(root.style.getPropertyValue("--mf-font-heading")).toBe("Inter, system-ui, sans-serif");
    expect(root.style.getPropertyValue("--mf-font-mono")).toBe("JetBrains Mono, monospace");
  });

  it("2. applyThemeVars(root, undefined) removes the vars", () => {
    const root = document.createElement("div");
    applyThemeVars(root, "linearMinimal");
    expect(root.style.getPropertyValue("--mf-bg-base")).toBe("#08090c");

    applyThemeVars(root, undefined);
    for (const varName of ALL_THEME_CSS_VARS) {
      expect(root.style.getPropertyValue(varName)).toBe("");
    }
  });

  it("3. mounting a scene with themePreset sets the vars on #stage", () => {
    const stage = createStage(1920, 1080);
    const sceneInput: SceneSpecInput = {
      ...MINIMAL_VALID_SCENE,
      themePreset: "stripeVibrant",
    };
    const scene = parseScene(sceneInput);

    // Apply theme vars to stage root as done during scene mounting
    applyThemeVars(stage.stage, scene.themePreset);

    const stageEl = document.getElementById("stage");
    expect(stageEl).toBe(stage.stage);
    expect(stageEl?.style.getPropertyValue("--mf-bg-base")).toBe("#0a0f24");
    expect(stageEl?.style.getPropertyValue("--mf-accent-primary")).toBe("#818cf8");
    expect(stageEl?.style.getPropertyValue("--mf-bg-blob-1")).toBe("#4f46e5");
    expect(stageEl?.style.getPropertyValue("--mf-bg-blob-2")).toBe("#ec4899");
    expect(stageEl?.style.getPropertyValue("--mf-bg-blob-3")).toBe("#06b6d4");

    // Switching theme updates all properties
    applyThemeVars(stage.stage, "editorialLight");
    expect(stageEl?.style.getPropertyValue("--mf-bg-base")).toBe("#f8fafc");
    expect(stageEl?.style.getPropertyValue("--mf-text-primary")).toBe("#0f172a");

    // Clearing theme removes all properties
    applyThemeVars(stage.stage, undefined);
    expect(stageEl?.style.getPropertyValue("--mf-bg-base")).toBe("");
    expect(stageEl?.style.getPropertyValue("--mf-text-primary")).toBe("");
  });
});
