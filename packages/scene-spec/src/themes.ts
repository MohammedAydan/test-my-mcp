import { z } from "zod";

export const THEME_PRESETS = [
  "appleKeynoteDark",
  "linearMinimal",
  "stripeVibrant",
  "vercelMonochrome",
  "emeraldFintech",
  "editorialLight",
] as const;

export type ThemePreset = (typeof THEME_PRESETS)[number];

export const themePresetSchema = z.enum(THEME_PRESETS);

export interface ThemeTokens {
  bgBase: string;
  bgBlobs: [string, string, string];
  textPrimary: string;
  textSecondary: string;
  accentPrimary: string;
  accentSecondary: string;
  cardBg: string;
  cardBorder: string;
  fontHeading: string;
  fontMono: string;
}

export const THEME_TOKENS: Record<ThemePreset, ThemeTokens> = {
  appleKeynoteDark: {
    bgBase: "#05070e",
    bgBlobs: ["#1d4ed8", "#6d28d9", "#0f172a"],
    textPrimary: "#f8fafc",
    textSecondary: "#94a3b8",
    accentPrimary: "#38bdf8",
    accentSecondary: "#818cf8",
    cardBg: "rgba(15, 23, 42, 0.72)",
    cardBorder: "rgba(148, 163, 184, 0.18)",
    fontHeading: "Inter, system-ui, sans-serif",
    fontMono: "JetBrains Mono, monospace",
  },
  linearMinimal: {
    bgBase: "#08090c",
    bgBlobs: ["#312e81", "#1e1b4b", "#090d16"],
    textPrimary: "#f1f5f9",
    textSecondary: "#64748b",
    accentPrimary: "#6366f1",
    accentSecondary: "#a855f7",
    cardBg: "rgba(17, 19, 26, 0.82)",
    cardBorder: "rgba(255, 255, 255, 0.08)",
    fontHeading: "Inter, system-ui, sans-serif",
    fontMono: "JetBrains Mono, monospace",
  },
  stripeVibrant: {
    bgBase: "#0a0f24",
    bgBlobs: ["#4f46e5", "#ec4899", "#06b6d4"],
    textPrimary: "#ffffff",
    textSecondary: "#cbd5e1",
    accentPrimary: "#818cf8",
    accentSecondary: "#f472b6",
    cardBg: "rgba(15, 23, 42, 0.68)",
    cardBorder: "rgba(129, 140, 248, 0.25)",
    fontHeading: "Inter, system-ui, sans-serif",
    fontMono: "JetBrains Mono, monospace",
  },
  vercelMonochrome: {
    bgBase: "#000000",
    bgBlobs: ["#171717", "#262626", "#0a0a0a"],
    textPrimary: "#fafafa",
    textSecondary: "#a3a3a3",
    accentPrimary: "#ffffff",
    accentSecondary: "#525252",
    cardBg: "rgba(18, 18, 18, 0.88)",
    cardBorder: "rgba(255, 255, 255, 0.14)",
    fontHeading: "Inter, system-ui, sans-serif",
    fontMono: "JetBrains Mono, monospace",
  },
  emeraldFintech: {
    bgBase: "#041311",
    bgBlobs: ["#065f46", "#0f766e", "#022c22"],
    textPrimary: "#ecfdf5",
    textSecondary: "#6ee7b7",
    accentPrimary: "#10b981",
    accentSecondary: "#14b8a6",
    cardBg: "rgba(6, 36, 30, 0.78)",
    cardBorder: "rgba(16, 185, 129, 0.22)",
    fontHeading: "Inter, system-ui, sans-serif",
    fontMono: "JetBrains Mono, monospace",
  },
  editorialLight: {
    bgBase: "#f8fafc",
    bgBlobs: ["#e0e7ff", "#fae8ff", "#e0f2fe"],
    textPrimary: "#0f172a",
    textSecondary: "#475569",
    accentPrimary: "#2563eb",
    accentSecondary: "#7c3aed",
    cardBg: "rgba(255, 255, 255, 0.88)",
    cardBorder: "rgba(15, 23, 42, 0.10)",
    fontHeading: "Inter, system-ui, sans-serif",
    fontMono: "JetBrains Mono, monospace",
  },
};

/**
 * Maps every ThemeTokens key to the CSS custom property (or properties) that
 * carry it. `bgBlobs` expands to three numbered variables because a CSS
 * custom property holds a single value; every other token maps to one name.
 */
export const THEME_CSS_VARS = {
  bgBase: "--mf-bg-base",
  bgBlobs: ["--mf-bg-blob-1", "--mf-bg-blob-2", "--mf-bg-blob-3"],
  textPrimary: "--mf-text-primary",
  textSecondary: "--mf-text-secondary",
  accentPrimary: "--mf-accent-primary",
  accentSecondary: "--mf-accent-secondary",
  cardBg: "--mf-card-bg",
  cardBorder: "--mf-card-border",
  fontHeading: "--mf-font-heading",
  fontMono: "--mf-font-mono",
} as const satisfies Record<keyof ThemeTokens, string | readonly string[]>;
