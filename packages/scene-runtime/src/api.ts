import type { AssetKind, SceneSpec } from "@motionforge/scene-spec";

/** `vault:name` → engine-served file; anything else passes through untouched. */
export function resolveAssetUrl(src: string): string {
  if (src.startsWith("vault:")) {
    return `/api/assets/vault/${encodeURIComponent(src.slice("vault:".length))}`;
  }
  return src;
}

export async function fetchScene(id: string): Promise<SceneSpec> {
  const res = await fetch(`/api/scenes/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error(`core-engine responded ${res.status} for scene "${id}"`);
  }
  return (await res.json()) as SceneSpec;
}

export interface AssetPreload {
  lottieJson: Map<string, unknown>;
}

/**
 * Preload every declared asset before the timeline is built: images decode,
 * videos buffer metadata, Lottie JSON is fetched into memory (so its
 * `totalFrames` is available synchronously when building tweens).
 */
export async function preloadAssets(scene: SceneSpec): Promise<AssetPreload> {
  const lottieJson = new Map<string, unknown>();

  await Promise.all(
    scene.assets.map(async (asset) => {
      const url = resolveAssetUrl(asset.src);
      if (asset.kind === "image") {
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => reject(new Error(`failed to load image asset "${asset.id}" (${url})`));
          img.src = url;
        });
      } else if (asset.kind === "video") {
        await new Promise<void>((resolve, reject) => {
          const video = document.createElement("video");
          video.preload = "auto";
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error(`failed to load video asset "${asset.id}" (${url})`));
          video.src = url;
        });
      } else if (asset.kind === "lottie") {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`failed to load lottie asset "${asset.id}" (${res.status})`);
        }
        lottieJson.set(asset.id, await res.json());
      }
      // audio is mixed at render time by core-engine; nothing to preload here
    })
  );

  return { lottieJson };
}

export function assetKindOf(scene: SceneSpec): (assetId: string) => AssetKind | undefined {
  const byId = new Map(scene.assets.map((a) => [a.id, a.kind]));
  return (assetId) => byId.get(assetId);
}
