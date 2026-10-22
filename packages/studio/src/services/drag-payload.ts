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
  /**
   * The built-in SFX cue.
   *
   * A cue drops on the AUDIO lane (A1), never on a video track — and the
   * timeline highlights that lane while the cue is dragged over it. The flag
   * is explicit so the drop target never has to guess from the asset id.
   */
  sfx?: boolean;
}

/** Build the payload for an asset (or a built-in SFX cue). */
export function buildAssetPayload(asset: {
  id: string;
  kind: string;
  src?: string;
  name?: string;
  sfx?: boolean;
}): AssetDragPayload {
  // a built-in cue has NO source file — that is what tells it apart from a
  // vault audio asset
  const isSfx = asset.sfx === true || (asset.kind === 'audio' && !asset.src);
  const payload: AssetDragPayload = {
    assetId: asset.id,
    kind: asset.kind,
    src: asset.src,
    name: asset.name ?? asset.id,
  };
  // the flag is only present when it is TRUE, so an ordinary asset payload
  // keeps exactly the shape it always had
  if (isSfx) payload.sfx = true;
  return payload;
}

/**
 * True when the payload is a built-in SFX cue.
 *
 * The drop target uses it to highlight the AUDIO lane and to snap the cue to
 * the playhead.
 */
export function isSfxPayload(payload: AssetDragPayload | null | undefined): boolean {
  if (!payload) return false;
  if (payload.sfx === true) return true;
  return payload.kind === 'audio' && !payload.src;
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
  asset: { id: string; kind: string; src?: string; name?: string; sfx?: boolean }
): void {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(buildAssetPayload(asset)));
  event.dataTransfer.setData('text/plain', asset.id);
  event.dataTransfer.effectAllowed = 'copy';
}
