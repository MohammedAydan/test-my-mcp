import type { MotionForgeEngineBridge } from '../types.js';

/**
 * The ONLY module that touches `window.motionforgeEngine`.
 *
 * The Studio is a renderer inside Electron; the engine lives in the main
 * process. Everything crosses the boundary through this bridge, so the
 * allow-list, the event plumbing and the browser fallback all live in one
 * place instead of being re-implemented per component.
 */

/** The methods the main process accepts over `engine:invoke`. */
export const ENGINE_METHODS = [
  'getCapabilities',
  'getScene',
  'saveScene',
  'deleteScene',
  'listScenes',
  'listAssets',
  'ingestAsset',
  'inspectKeyframes',
  'getLayerBounds',
  'startRender',
  'getRenderStatus',
] as const;

export type EngineMethod = (typeof ENGINE_METHODS)[number];

export interface EngineEvent {
  eventName: string;
  payload: unknown;
}

/** A stand-in used when the Studio runs outside Electron (plain browser dev). */
const browserFallback: MotionForgeEngineBridge = {
  invoke: async (method: string) => {
    if (method === 'getCapabilities') {
      return {
        schemaVersion: 1,
        presets: {},
        easings: [],
        fonts: {},
        sfx: [],
        layerTypes: [],
      };
    }
    if (method === 'listScenes') return [];
    if (method === 'listAssets') return [];
    return null;
  },
  onEvent: () => () => undefined,
};

function bridge(): MotionForgeEngineBridge {
  if (typeof window !== 'undefined' && window.motionforgeEngine) {
    return window.motionforgeEngine;
  }
  return browserFallback;
}

/** True when the Studio is hosted by the Electron shell. */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && Boolean(window.motionforgeEngine);
}

/**
 * Invoke an engine method.
 *
 * The method allow-list is mirrored from the main process so a typo fails
 * loudly in the renderer instead of being forwarded and rejected there.
 */
export async function invokeEngine<T = unknown>(method: EngineMethod, ...args: unknown[]): Promise<T> {
  if (!ENGINE_METHODS.includes(method)) {
    throw new Error(`Unknown engine method "${method}"`);
  }
  return (await bridge().invoke(method, ...args)) as T;
}

/** Subscribe to engine domain events. Returns an unsubscribe function. */
export function onEngineEvent(handler: (event: EngineEvent) => void): () => void {
  return bridge().onEvent((event) => handler({ eventName: event.eventName, payload: event.payload }));
}
