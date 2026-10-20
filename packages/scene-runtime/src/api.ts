import type { AssetKind, SceneSpec } from "@motionforge/scene-spec";

/**
 * The engine IPC bridge exposed by an Electron host.
 *
 * `invoke` is optional: a host may expose the bridge without an engine
 * attached to it.
 */
interface EngineBridge {
  invoke?: (method: string, ...args: unknown[]) => Promise<unknown>;
}

/** A host → runtime scene push (`motionforge:initScene` / `motionforge:updateScene`). */
interface ScenePushMessage {
  type?: unknown;
  scene?: unknown;
  sceneId?: unknown;
}

/**
 * Read the engine bridge off a frame.
 *
 * Reading a property of a *foreign* frame throws a `SecurityError`
 * ("Blocked a frame with origin … from accessing a cross-origin frame"), so
 * every read of another frame is guarded — the runtime is routinely framed
 * by a Studio page served from another origin than `mf-runtime://app`.
 */
function readBridge(frame: Window | null | undefined): EngineBridge | undefined {
  if (!frame) return undefined;
  try {
    const bridge = (frame as unknown as { motionforgeEngine?: EngineBridge }).motionforgeEngine;
    return bridge ?? undefined;
  } catch {
    // Cross-origin frame: the host hands the scene over postMessage instead.
    return undefined;
  }
}

/** The bridge of THIS frame (never cross-origin, guarded for symmetry). */
function readOwnBridge(): EngineBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return readBridge(window);
}

/** The bridge of the embedding frame — it may be cross-origin, hence guarded. */
function readParentBridge(): EngineBridge | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return readBridge(window.parent);
  } catch {
    return undefined;
  }
}

/**
 * True when the runtime runs inside a zero-port host: the Electron
 * `mf-runtime:` protocol, a `file://` build, or any page that exposes the
 * `motionforgeEngine` IPC bridge (directly or on its parent frame).
 *
 * In that mode there is no engine HTTP origin to fetch from — the host owns
 * the engine in-process and serves vault files over the privileged
 * `mf-vault://` scheme instead.
 */
export function isZeroPortHost(): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.protocol === "mf-runtime:" || window.location.protocol === "file:") return true;
  return Boolean(readOwnBridge() ?? readParentBridge());
}

/** `vault:name` → engine-served file; anything else passes through untouched. */
export function resolveAssetUrl(src: string): string {
  if (src.startsWith("vault:")) {
    const name = src.slice("vault:".length);
    if (isZeroPortHost()) {
      return `mf-vault://${name}`;
    }
    return `/api/assets/vault/${encodeURIComponent(name)}`;
  }
  return src;
}

/**
 * Does a pushed scene answer the request for `id`?
 *
 * The host may echo the requested id on the message, or carry it on the
 * scene itself. A scene without any id is accepted: a zero-port host only
 * ever has the requested scene in flight.
 */
function matchesRequestedScene(scene: SceneSpec, message: ScenePushMessage, id: string): boolean {
  const requested = typeof message.sceneId === "string" ? message.sceneId : undefined;
  if (requested) return requested === id;
  const sceneId = typeof scene.id === "string" ? scene.id : undefined;
  if (sceneId) return sceneId === id;
  return true;
}

/**
 * Ask the host for the scene over postMessage and wait for it to be pushed.
 *
 * The `mf-runtime:` host owns the engine in-process and exposes no HTTP
 * origin the runtime could fetch from, so the scene travels over
 * postMessage: the runtime asks (`motionforge:requestScene`) and the host
 * answers with `motionforge:initScene` / `motionforge:updateScene`.
 *
 * Resolves with `null` when the host stays silent — the caller then falls
 * back to its own source instead of waiting forever.
 */
export function requestSceneFromHost(id: string, timeoutMs = 3000): Promise<SceneSpec | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  // Top-level runtime: there is no host frame to ask, and a message posted
  // to itself is never answered — waiting would be a pure delay.
  if (window.parent === window) return Promise.resolve(null);
  return new Promise<SceneSpec | null>((resolve) => {
    let settled = false;
    const finish = (pushed: SceneSpec | null): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(pushed);
    };
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as ScenePushMessage | null;
      if (!data || typeof data !== "object") return;
      if (data.type !== "motionforge:initScene" && data.type !== "motionforge:updateScene") return;
      const scene = data.scene as SceneSpec | undefined;
      if (!scene || typeof scene !== "object") return;
      if (!matchesRequestedScene(scene, data, id)) return;
      finish(scene);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("message", onMessage);
    try {
      window.parent?.postMessage({ type: "motionforge:requestScene", sceneId: id }, "*");
    } catch {
      // No reachable parent frame — give up instead of hanging.
      finish(null);
    }
  });
}

export async function fetchScene(id: string): Promise<SceneSpec> {
  const failures: string[] = [];

  if (typeof window !== "undefined") {
    const parentBridge = readParentBridge();
    if (parentBridge?.invoke) {
      try {
        const sc = await parentBridge.invoke("getScene", id);
        if (sc) return sc as SceneSpec;
      } catch (error) {
        failures.push(`parent bridge: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const ownBridge = readOwnBridge();
    if (ownBridge?.invoke) {
      try {
        const sc = await ownBridge.invoke("getScene", id);
        if (sc) return sc as SceneSpec;
      } catch (error) {
        failures.push(`engine bridge: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const pushed = await requestSceneFromHost(id);
    if (pushed) return pushed;
  }

  // Headless zero-port Playwright capture route interception
  try {
    const res = await fetch(`/api/scenes/${encodeURIComponent(id)}`);
    if (res.ok) {
      return (await res.json()) as SceneSpec;
    }
  } catch (err) {
    failures.push(`zero-port route: ${err instanceof Error ? err.message : String(err)}`);
  }

  throw new Error(
    `could not load scene "${id}": in-process engine bridge, host postMessage, and zero-port route all failed (${failures.join("; ")})`
  );
}

export interface AssetPreload {
  lottieJson: Map<string, unknown>;
  /**
   * Natural pixel size of every image asset, read while it was preloaded.
   *
   * The runtime needs it to size a logo that declares no `heightPx`: without
   * the aspect ratio the host box collapses to zero height and the mark is
   * invisible — a silent, total loss of the layer.
   */
  imageSizes: Map<string, { width: number; height: number }>;
}

/**
 * Preload every declared asset before the timeline is built: images decode,
 * videos buffer metadata, Lottie JSON is fetched into memory (so its
 * `totalFrames` is available synchronously when building tweens).
 */
export async function preloadAssets(scene: SceneSpec): Promise<AssetPreload> {
  const lottieJson = new Map<string, unknown>();
  const imageSizes = new Map<string, { width: number; height: number }>();

  await Promise.all(
    (scene.assets ?? []).map(async (asset) => {
      const url = resolveAssetUrl(asset.src);
      if (asset.kind === "image") {
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              imageSizes.set(asset.id, { width: img.naturalWidth, height: img.naturalHeight });
            }
            resolve();
          };
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

  return { lottieJson, imageSizes };
}

export function assetKindOf(scene: SceneSpec): (assetId: string) => AssetKind | undefined {
  const byId = new Map((scene.assets ?? []).map((a) => [a.id, a.kind]));
  return (assetId) => byId.get(assetId);
}
