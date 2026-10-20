import { invokeEngine } from './engine-bridge.js';

/**
 * Asset service — the media vault and the built-in SFX bank.
 *
 * The SFX bank is a FIXED registry (the same names the engine ships), so it
 * is declared here as data rather than being fetched: the Project Bin can
 * render the bank even before the engine answers.
 */

export const SFX_BANK = ['whoosh', 'pop', 'click', 'subImpact', 'shimmer', 'riser'] as const;
export type SfxName = (typeof SFX_BANK)[number];

export interface VaultAsset {
  id: string;
  name: string;
  src: string;
  kind: 'image' | 'video' | 'audio' | 'lottie' | 'font' | 'unknown';
  size?: number;
  mimeType?: string;
}

export async function listAssets(): Promise<VaultAsset[]> {
  return invokeEngine<VaultAsset[]>('listAssets');
}

export async function ingestAsset(
  filename: string,
  data: ArrayBuffer | Uint8Array | Blob
): Promise<VaultAsset> {
  const cleanName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  let buffer: Uint8Array;
  if (data instanceof Uint8Array) {
    buffer = data;
  } else if (data instanceof ArrayBuffer) {
    buffer = new Uint8Array(data);
  } else {
    buffer = new Uint8Array(await data.arrayBuffer());
  }
  return invokeEngine<VaultAsset>('ingestAsset', buffer, cleanName);
}

/** The URL of a vault asset inside the renderer. */
export function vaultUrl(name: string): string {
  return `mf-vault://${name}`;
}

/** The URL of a built-in SFX cue inside the renderer. */
export function sfxUrl(name: string): string {
  return `mf-vault://_sfx/${name}.ogg`;
}
