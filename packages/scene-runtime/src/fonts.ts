import type { FontRole, SceneSpec } from "@motionforge/scene-spec";

const DEFAULT_STACKS: Record<FontRole, string> = {
  hero: '"Inter", system-ui, sans-serif',
  headline: '"Inter", system-ui, sans-serif',
  body: '"Inter", system-ui, sans-serif',
  accent: '"Inter", system-ui, sans-serif',
  metric: '"Inter", ui-monospace, monospace',
};

const FONT_PROBE_TEXT = "Ag متع 0123"; // latin + arabic + digits: loads all subsets

/** Family stack for a text role (scene fonts[] wins over defaults). */
export function fontFamilyFor(
  fontMap: Map<FontRole, string>,
  role: FontRole,
  googleFamily?: string
): string {
  if (googleFamily) return `"${googleFamily}", ${DEFAULT_STACKS[role]}`;
  return fontMap.get(role) ?? DEFAULT_STACKS[role];
}

/**
 * Inject Google Fonts for every declared role and block until the faces are
 * actually loaded (`display=block` + explicit `document.fonts.load` probes),
 * so rendered frames never catch a fallback face.
 */
export async function loadSceneFonts(scene: SceneSpec): Promise<Map<FontRole, string>> {
  const map = new Map<FontRole, string>(Object.entries(DEFAULT_STACKS) as [FontRole, string][]);

  await Promise.all(
    scene.fonts.map(async (ref) => {
      map.set(ref.role, `"${ref.family}", ${DEFAULT_STACKS[ref.role]}`);
      if (ref.provider !== "google") return;
      const familyParam = ref.family.replace(/\s+/g, "+");
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href =
        `https://fonts.googleapis.com/css2?family=${familyParam}` +
        `:wght@${[...new Set(ref.weights)].sort((a, b) => a - b).join(";")}&display=block`;
      document.head.appendChild(link);
      await Promise.all(
        ref.weights.map((weight) =>
          document.fonts.load(`${weight} 32px "${ref.family}"`, FONT_PROBE_TEXT).catch(() => {
            /* a missing weight must not wedge the render; the stack still falls back */
          })
        )
      );
    })
  );

  await document.fonts.ready;
  return map;
}
