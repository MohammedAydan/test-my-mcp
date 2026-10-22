/**
 * The background variant — a DISCRIMINATED union, so it is REBUILT.
 *
 * The schema's four variants are STRICT objects: each one has its own
 * required keys and REJECTS every other variant's keys. The Studio used to
 * spread the previous variant into the new one, which produced scenes the
 * engine refused to store:
 *
 *   `layers.0.variant.blobs: Required`
 *   `layers.0.variant: Unrecognized key(s) in object: 'color'`
 *
 * Every function in this module therefore builds a FRESH payload and carries
 * over only the values that are MEANINGFUL in the target variant. Nothing
 * here ever spreads a variant into another variant.
 */

/** The four background variants of the schema. */
export const BACKGROUND_VARIANT_KINDS = ['solid', 'meshGradient', 'particles', 'media'] as const;
export type BackgroundVariantKind = (typeof BACKGROUND_VARIANT_KINDS)[number];

/** One blob of a mesh gradient. */
export interface MeshBlob {
  color: string;
  xPct: number;
  yPct: number;
  radiusPct: number;
  drift: number;
}

/** The minimum number of blobs a mesh gradient must carry. */
export const MIN_MESH_BLOBS = 2;
/** The maximum number of blobs a mesh gradient may carry. */
export const MAX_MESH_BLOBS = 6;

/** The default blobs of a fresh mesh gradient. */
const DEFAULT_BLOBS: MeshBlob[] = [
  { color: '#12224a', xPct: 22, yPct: 30, radiusPct: 58, drift: 0.5 },
  { color: '#0d6b63', xPct: 78, yPct: 68, radiusPct: 52, drift: 0.35 },
  { color: '#3b1f7a', xPct: 50, yPct: 18, radiusPct: 44, drift: 0.8 },
];

/** A colour a colour input can hold. */
const color = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback;

/** A finite number inside a range. */
const num = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

/** The blobs of a variant payload, normalised to the schema's shape. */
export function readBlobs(previous: Record<string, unknown> | undefined): MeshBlob[] {
  const raw = Array.isArray(previous?.blobs) ? (previous?.blobs as unknown[]) : [];
  const blobs: MeshBlob[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const blob = entry as Record<string, unknown>;
    blobs.push({
      color: color(blob.color, '#12224a'),
      xPct: num(blob.xPct, 50, -300, 300),
      yPct: num(blob.yPct, 50, -300, 300),
      radiusPct: num(blob.radiusPct, 50, 5, 200),
      drift: num(blob.drift, 0.3, 0, 2),
    });
    if (blobs.length >= MAX_MESH_BLOBS) break;
  }
  return blobs;
}

/**
 * Build a VALID background variant payload.
 *
 * @param variant   the variant the author picked
 * @param previous  the CURRENT payload (only its own values are carried over)
 * @param declaredAssetIds the ids of the assets DECLARED in the scene — the
 *        `media` variant may only reference one of them, because an
 *        undeclared id is a broken reference the engine rejects.
 */
export function buildBackgroundVariant(
  variant: string,
  previous: Record<string, unknown> | undefined,
  declaredAssetIds: string[] = []
): Record<string, unknown> {
  switch (variant) {
    case 'meshGradient': {
      const blobs = readBlobs(previous);
      return {
        variant: 'meshGradient',
        base: color(previous?.base, '#05070d'),
        // the schema REQUIRES 2..6 blobs — a mesh gradient with none is invalid
        blobs: blobs.length >= MIN_MESH_BLOBS ? blobs : DEFAULT_BLOBS.slice(),
      };
    }
    case 'particles':
      return {
        variant: 'particles',
        count: Math.round(num(previous?.count, 40, 40, 600)),
        color: color(previous?.color, '#38bdf8'),
        sizePx: num(previous?.sizePx, 2.5, 1, 12),
        speed: num(previous?.speed, 1, 0.1, 3),
        direction:
          previous?.direction === 'down' ||
          previous?.direction === 'radial' ||
          previous?.direction === 'sideways'
            ? previous.direction
            : 'up',
      };
    case 'media': {
      const declared = declaredAssetIds.filter((id) => id.length > 0);
      const current = typeof previous?.assetId === 'string' ? previous.assetId : '';
      const assetId = declared.includes(current) ? current : (declared[0] ?? '');
      return {
        variant: 'media',
        assetId,
        blurPx: num(previous?.blurPx, 0, 0, 60),
        dimOpacity: num(previous?.dimOpacity, 0, 0, 1),
      };
    }
    case 'solid':
    default:
      return {
        variant: 'solid',
        color: color(previous?.color, '#05070d'),
      };
  }
}

/**
 * Update ONE key of the CURRENT variant.
 *
 * The variant is rebuilt from its own values, so a key from another variant
 * can never leak in.
 */
export function updateBackgroundVariant(
  previous: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
  declaredAssetIds: string[] = []
): Record<string, unknown> {
  const kind = typeof previous?.variant === 'string' ? previous.variant : 'solid';
  const merged: Record<string, unknown> = { ...(previous ?? {}), ...patch, variant: kind };
  return buildBackgroundVariant(kind, merged, declaredAssetIds);
}

/** Add one blob to a mesh gradient (never above the schema's maximum). */
export function addMeshBlob(previous: Record<string, unknown> | undefined): Record<string, unknown> {
  const blobs = readBlobs(previous);
  if (blobs.length < MIN_MESH_BLOBS) {
    return buildBackgroundVariant('meshGradient', { ...(previous ?? {}), blobs: DEFAULT_BLOBS.slice() }, []);
  }
  if (blobs.length >= MAX_MESH_BLOBS) return buildBackgroundVariant('meshGradient', previous, []);
  const next = blobs[blobs.length - 1];
  const fresh: MeshBlob = {
    color: next?.color ?? '#3b1f7a',
    xPct: 50,
    yPct: 50,
    radiusPct: 40,
    drift: 0.4,
  };
  return buildBackgroundVariant('meshGradient', { ...(previous ?? {}), blobs: [...blobs, fresh] }, []);
}

/**
 * Remove one blob from a mesh gradient.
 *
 * The schema demands AT LEAST TWO blobs, so the last two cannot be removed —
 * the button is disabled and the guard is enforced here too.
 */
export function removeMeshBlob(
  previous: Record<string, unknown> | undefined,
  index: number
): Record<string, unknown> {
  const blobs = readBlobs(previous);
  if (blobs.length <= MIN_MESH_BLOBS) return buildBackgroundVariant('meshGradient', previous, []);
  const next = blobs.filter((_, position) => position !== index);
  return buildBackgroundVariant('meshGradient', { ...(previous ?? {}), blobs: next }, []);
}

/** Patch one blob of a mesh gradient. */
export function updateMeshBlob(
  previous: Record<string, unknown> | undefined,
  index: number,
  patch: Partial<MeshBlob>
): Record<string, unknown> {
  const blobs = readBlobs(previous);
  const target = blobs[index];
  if (!target) return buildBackgroundVariant('meshGradient', previous, []);
  blobs[index] = { ...target, ...patch };
  return buildBackgroundVariant('meshGradient', { ...(previous ?? {}), blobs }, []);
}
