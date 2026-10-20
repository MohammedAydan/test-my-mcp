import { sanitizeSceneInput } from '@motionforge/scene-spec';
import type { StudioScene } from '../types.js';
import { invokeEngine } from './engine-bridge.js';

/**
 * Scene service — load, save, create, duplicate and delete scenes.
 *
 * Every write goes through `sanitizeSceneInput`, the SAME normalizer the
 * engine applies. Two call sites, one implementation: the renderer and the
 * engine can never disagree about what a scene is.
 */

export interface SceneSummary {
  id: string;
  name: string;
  revision: number;
  hash: string;
  updatedAt: number;
  layerCount: number;
  durationMs: number;
}

export interface SaveResult {
  id: string;
  revision: number;
  status: string;
  warnings?: string[];
}

export class SceneServiceError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues: string[] = []
  ) {
    super(message);
    this.name = 'SceneServiceError';
  }
}

/** Strip Solid.js reactive proxies before crossing the IPC boundary. */
export function unwrapPayload<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (value instanceof ArrayBuffer || value instanceof Uint8Array) return value;
  return JSON.parse(JSON.stringify(value));
}

/** Normalize a scene for the engine. */
export function sanitizeSceneForEngine(scene: unknown): unknown {
  if (!scene || typeof scene !== 'object') return scene;
  return sanitizeSceneInput(unwrapPayload(scene));
}

export async function getScene(id: string): Promise<StudioScene> {
  const scene = await invokeEngine<StudioScene | null>('getScene', id);
  if (!scene) throw new SceneServiceError(404, `Unknown scene "${id}"`);
  return scene;
}

export async function listScenes(): Promise<SceneSummary[]> {
  return invokeEngine<SceneSummary[]>('listScenes');
}

export async function saveScene(scene: StudioScene): Promise<SaveResult> {
  try {
    return await invokeEngine<SaveResult>('saveScene', sanitizeSceneForEngine(scene));
  } catch (err) {
    const error = err as Error & { status?: number; issues?: string[] };
    throw new SceneServiceError(
      error.status ?? 400,
      error.message || 'Failed to save scene',
      error.issues ?? []
    );
  }
}

export async function deleteScene(id: string): Promise<{ id: string; success: boolean }> {
  return invokeEngine<{ id: string; success: boolean }>('deleteScene', id);
}

export async function inspectKeyframes(
  id: string,
  at: number[],
  includeFullResolution = false
): Promise<{ frames: unknown[]; framesMeta: unknown[] }> {
  return invokeEngine<{ frames: unknown[]; framesMeta: unknown[] }>('inspectKeyframes', id, {
    at,
    includeFullResolution,
  });
}
