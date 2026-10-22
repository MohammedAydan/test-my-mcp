/**
 * The card variant — a DISCRIMINATED union, so it is REBUILT.
 *
 * The four card treatments are STRICT objects: each one has its own required
 * keys and REJECTS every other treatment's keys. The inspector used to
 * SPREAD the previous variant into the next one and to write a key that no
 * treatment declares (`accent-color`), which made the engine reject the
 * whole scene:
 *
 *   `layers.0.variant: Unrecognized key(s) in object: 'accent-color'`
 *
 * Every function here builds a FRESH payload for ONE treatment and carries
 * over only the values that treatment actually has.
 */

/** The four card treatments of the schema. */
export const CARD_VARIANT_KINDS = ['glassCard', 'callout', 'progressBar', 'counter'] as const;
export type CardVariantKind = (typeof CARD_VARIANT_KINDS)[number];

/** The treatments that carry a title and a body. */
const TEXT_VARIANTS: CardVariantKind[] = ['glassCard', 'callout'];

/** True when the treatment carries a `title` / `body` pair. */
export function cardVariantHasText(kind: string): boolean {
  return (TEXT_VARIANTS as string[]).includes(kind);
}

/** True when the treatment carries an `accentColor`. */
export function cardVariantHasAccent(kind: string): boolean {
  return kind === 'callout';
}

/** A finite number inside a range. */
const num = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

/** A string, when it is one. */
const str = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

/** Build the `glass` bag of a glass-like treatment. */
function buildGlass(previous: Record<string, unknown> | undefined) {
  const glass = previous?.glass;
  const bag = glass && typeof glass === 'object' ? (glass as Record<string, unknown>) : {};
  return {
    blurPx: num(bag.blurPx, 22, 0, 80),
    tintColor: str(bag.tintColor, '#0b0f1a'),
    tintOpacity: num(bag.tintOpacity, 0.35, 0, 1),
  };
}

/**
 * Build a VALID card variant payload for `kind`.
 *
 * @param kind     the treatment the author picked
 * @param previous the CURRENT payload (only its own values are carried over)
 */
export function buildCardVariant(
  kind: string,
  previous: Record<string, unknown> | undefined
): Record<string, unknown> {
  const prev = previous ?? {};
  switch (kind) {
    case 'callout':
      return {
        variant: 'callout',
        accentSide: prev.accentSide === 'right' ? 'right' : 'left',
        accentColor: str(prev.accentColor, '#2d8ceb'),
        ...(typeof prev.title === 'string' ? { title: prev.title } : {}),
        ...(typeof prev.body === 'string' ? { body: prev.body } : {}),
        ...(typeof prev.widthPx === 'number'
          ? { widthPx: num(prev.widthPx, 800, 80, 2000) }
          : {}),
        paddingPx: num(prev.paddingPx, 32, 8, 200),
        radiusPx: num(prev.radiusPx, 24, 0, 200),
        glass: buildGlass(prev),
      };
    case 'progressBar':
      return {
        variant: 'progressBar',
        ...(typeof prev.label === 'string' ? { label: prev.label } : {}),
        value: num(prev.value, 50, 0, 100),
        trackColor: str(prev.trackColor, 'rgba(255,255,255,0.12)'),
        fill: typeof prev.fill === 'string' ? prev.fill : '#38bdf8',
        heightPx: num(prev.heightPx, 18, 4, 120),
        radiusPx: num(prev.radiusPx, 120, 0, 200),
        showPercentage: prev.showPercentage === true,
        ...(typeof prev.widthPx === 'number'
          ? { widthPx: num(prev.widthPx, 800, 80, 2000) }
          : {}),
      };
    case 'counter':
      return {
        variant: 'counter',
        from: num(prev.from, 0, -1e12, 1e12),
        to: num(prev.to, 100, -1e12, 1e12),
        decimals: Math.round(num(prev.decimals, 0, 0, 4)),
        prefix: str(prev.prefix, ''),
        suffix: str(prev.suffix, ''),
        ...(typeof prev.locale === 'string' ? { locale: prev.locale } : {}),
        role:
          prev.role === 'heading' ||
          prev.role === 'body' ||
          prev.role === 'caption' ||
          prev.role === 'label'
            ? prev.role
            : 'metric',
        sizePx: num(prev.sizePx, 120, 12, 600),
      };
    case 'glassCard':
    default:
      return {
        variant: 'glassCard',
        ...(typeof prev.title === 'string' ? { title: prev.title } : {}),
        ...(typeof prev.body === 'string' ? { body: prev.body } : {}),
        ...(typeof prev.iconAssetId === 'string' ? { iconAssetId: prev.iconAssetId } : {}),
        ...(typeof prev.widthPx === 'number'
          ? { widthPx: num(prev.widthPx, 800, 80, 2000) }
          : {}),
        paddingPx: num(prev.paddingPx, 36, 8, 200),
        radiusPx: num(prev.radiusPx, 28, 0, 200),
        glass: buildGlass(prev),
        borderOpacity: num(prev.borderOpacity, 0.25, 0, 1),
      };
  }
}

/**
 * Patch ONE key of the CURRENT card treatment.
 *
 * The treatment is rebuilt from its own values, so a key from another
 * treatment can never leak in.
 */
export function updateCardVariant(
  previous: Record<string, unknown> | undefined,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const kind = typeof previous?.variant === 'string' ? previous.variant : 'glassCard';
  const merged: Record<string, unknown> = { ...(previous ?? {}), ...patch, variant: kind };
  return buildCardVariant(kind, merged);
}
