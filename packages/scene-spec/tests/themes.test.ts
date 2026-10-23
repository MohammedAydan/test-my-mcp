import { describe, expect, it } from "vitest";
import {
  MINIMAL_VALID_SCENE,
  THEME_CSS_VARS,
  THEME_PRESETS,
  THEME_TOKENS,
  sanitizeSceneInput,
  sceneSpecSchema,
  type ThemePreset,
  type ThemeTokens,
} from "@motionforge/scene-spec";

describe("Art Direction Theme Presets (themePreset)", () => {
  const tokenKeys: (keyof ThemeTokens)[] = [
    "bgBase",
    "bgBlobs",
    "textPrimary",
    "textSecondary",
    "accentPrimary",
    "accentSecondary",
    "cardBg",
    "cardBorder",
    "fontHeading",
    "fontMono",
  ];

  it("1. every one of the 6 presets validates on a real scene", () => {
    expect(THEME_PRESETS).toHaveLength(6);
    for (const preset of THEME_PRESETS) {
      const scene = { ...MINIMAL_VALID_SCENE, themePreset: preset };
      const parsed = sceneSpecSchema.safeParse(scene);
      expect(parsed.success, `preset ${preset} failed validation`).toBe(true);
      if (parsed.success) {
        expect(parsed.data.themePreset).toBe(preset);
      }
    }
  });

  it("2. THEME_TOKENS has all 10 tokens for every preset and bgBlobs has exactly 3 entries", () => {
    for (const preset of THEME_PRESETS) {
      const tokens = THEME_TOKENS[preset];
      expect(tokens, `missing tokens for preset ${preset}`).toBeDefined();
      expect(Object.keys(tokens).sort()).toEqual([...tokenKeys].sort());
      for (const key of tokenKeys) {
        expect(tokens[key], `token ${key} is undefined in ${preset}`).toBeDefined();
      }
      expect(tokens.bgBlobs).toHaveLength(3);
      for (const blobColor of tokens.bgBlobs) {
        expect(typeof blobColor).toBe("string");
        expect(blobColor.length).toBeGreaterThan(0);
      }
    }
  });

  it("3. an unknown theme name is REJECTED by sceneSpecSchema", () => {
    const scene = { ...MINIMAL_VALID_SCENE, themePreset: "nonExistentTheme" };
    const result = sceneSpecSchema.safeParse(scene);
    expect(result.success).toBe(false);
  });

  it("4. sanitizeSceneInput() preserves themePreset and does not add one when absent", () => {
    // Preserves valid theme
    for (const preset of THEME_PRESETS) {
      const sceneWithTheme = { ...MINIMAL_VALID_SCENE, themePreset: preset };
      const sanitized = sanitizeSceneInput(sceneWithTheme) as { themePreset?: ThemePreset };
      expect(sanitized.themePreset).toBe(preset);
      expect(sceneSpecSchema.safeParse(sanitized).success).toBe(true);
    }

    // Does not add one when absent
    const sceneWithoutTheme = { ...MINIMAL_VALID_SCENE };
    delete (sceneWithoutTheme as { themePreset?: ThemePreset }).themePreset;
    const sanitizedWithout = sanitizeSceneInput(sceneWithoutTheme) as { themePreset?: ThemePreset };
    expect(sanitizedWithout.themePreset).toBeUndefined();
    expect(sceneSpecSchema.safeParse(sanitizedWithout).success).toBe(true);

    // Invalid theme is not masked or coerced by sanitizer; validation still rejects it
    const sceneWithInvalid = { ...MINIMAL_VALID_SCENE, themePreset: "unknownTheme" };
    const sanitizedInvalid = sanitizeSceneInput(sceneWithInvalid);
    expect(sceneSpecSchema.safeParse(sanitizedInvalid).success).toBe(false);
  });

  it("5. THEME_CSS_VARS covers every token key exactly once", () => {
    expect(Object.keys(THEME_CSS_VARS).sort()).toEqual([...tokenKeys].sort());
    for (const key of tokenKeys) {
      const val = THEME_CSS_VARS[key];
      expect(val).toBeDefined();
      const names = typeof val === "string" ? [val] : [...val];
      expect(names.length).toBe(key === "bgBlobs" ? 3 : 1);
      for (const name of names) {
        expect(name.startsWith("--mf-")).toBe(true);
      }
    }
    expect(THEME_CSS_VARS.bgBlobs).toEqual([
      "--mf-bg-blob-1",
      "--mf-bg-blob-2",
      "--mf-bg-blob-3",
    ]);
  });
});
