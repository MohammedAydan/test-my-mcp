/**
 * The asset drag payload.
 *
 * The Project Bin, the Program Monitor and the Timeline all speak this
 * envelope, so it lives in the service layer — not in a component — and the
 * contract is unit-testable without a JSX transform.
 */

export const ASSET_DRAG_TYPE = 'application/json';

export interface AssetDragPayload {
  assetId: string;
  kind: string;
  src?: string;
  name?: string;
}

/** Build the payload for an asset (or a built-in SFX cue). */
export function buildAssetPayload(asset: {
  id: string;
  kind: string;
  src?: string;
  name?: string;
}): AssetDragPayload {
  return { assetId: asset.id, kind: asset.kind, src: asset.src, name: asset.name ?? asset.id };
}

/**
 * Read an asset payload out of a drag event.
 *
 * Falls back to the plain-text form (which carries the asset id) and returns
 * `null` for a drop it cannot interpret — the caller then shows a warning
 * rather than silently doing nothing.
 */
export function readAssetPayload(event: DragEvent): AssetDragPayload | null {
  const raw = event.dataTransfer?.getData(ASSET_DRAG_TYPE);
  if (raw) {
    try {
      return JSON.parse(raw) as AssetDragPayload;
    } catch {
      /* fall through to the plain-text form */
    }
  }
  const text = event.dataTransfer?.getData('text/plain');
  return text ? { assetId: text, kind: 'image' } : null;
}

/** Write the payload onto a drag event. */
export function writeAssetPayload(
  event: DragEvent,
  asset: { id: string; kind: string; src?: string; name?: string }
): void {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(buildAssetPayload(asset)));
  event.dataTransfer.setData('text/plain', asset.id);
  event.dataTransfer.effectAllowed = 'copy';
}
