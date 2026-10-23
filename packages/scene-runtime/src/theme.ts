import {
  THEME_PRESETS,
  type ThemePreset,
  themePresetSchema,
  type ThemeTokens,
  THEME_TOKENS,
  THEME_CSS_VARS,
} from "@motionforge/scene-spec";

export {
  THEME_PRESETS,
  type ThemePreset,
  themePresetSchema,
  type ThemeTokens,
  THEME_TOKENS,
  THEME_CSS_VARS,
};

/**
 * Every CSS custom property a theme can set, in a stable order.
 *
 * Derived from `THEME_CSS_VARS` so a new token cannot be added to the theme
 * contract without also being cleared on unmount.
 */
export const ALL_THEME_CSS_VARS: readonly string[] = Object.values(
  THEME_CSS_VARS
).flatMap((value) => (typeof value === "string" ? [value] : [...value]));

export function getThemeCssVars(preset: ThemePreset): Record<string, string> {
  const tokens = THEME_TOKENS[preset];
  if (!tokens) return {};
  return {
    [THEME_CSS_VARS.bgBase]: tokens.bgBase,
    [THEME_CSS_VARS.bgBlobs[0]]: tokens.bgBlobs[0],
    [THEME_CSS_VARS.bgBlobs[1]]: tokens.bgBlobs[1],
    [THEME_CSS_VARS.bgBlobs[2]]: tokens.bgBlobs[2],
    [THEME_CSS_VARS.textPrimary]: tokens.textPrimary,
    [THEME_CSS_VARS.textSecondary]: tokens.textSecondary,
    [THEME_CSS_VARS.accentPrimary]: tokens.accentPrimary,
    [THEME_CSS_VARS.accentSecondary]: tokens.accentSecondary,
    [THEME_CSS_VARS.cardBg]: tokens.cardBg,
    [THEME_CSS_VARS.cardBorder]: tokens.cardBorder,
    [THEME_CSS_VARS.fontHeading]: tokens.fontHeading,
    [THEME_CSS_VARS.fontMono]: tokens.fontMono,
  };
}

/**
 * Apply (or clear) a theme on a DOM root.
 *
 * CSS custom properties are STATIC for the duration of a scene, so this is
 * deterministic: the same scene always paints the same values. An explicit
 * layer colour is written as an inline style by the renderer and therefore
 * wins over the inherited variable.
 */
export function applyThemeVars(
  root: HTMLElement | null | undefined,
  theme?: ThemePreset | null
): void {
  if (!root) return;
  for (const varName of ALL_THEME_CSS_VARS) {
    root.style.removeProperty(varName);
  }
  if (!theme || !THEME_TOKENS[theme]) {
    return;
  }
  const vars = getThemeCssVars(theme);
  for (const [name, val] of Object.entries(vars)) {
    root.style.setProperty(name, val);
  }
}
