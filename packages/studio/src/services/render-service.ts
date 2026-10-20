import { invokeEngine, onEngineEvent } from './engine-bridge.js';

/**
 * Render service — start a render, follow its progress, resolve its output.
 *
 * The engine emits `render:progress` / `render:completed` / `render:failed`
 * as domain events; this service turns them into a subscription the UI can
 * render without knowing anything about the IPC layer.
 */

export type RenderQuality = 'draft' | 'production';

/**
 * The engine's render job.
 *
 * The shape mirrors `RenderJob` in `@motionforge/core-engine` exactly: the
 * status vocabulary is `queued | running | succeeded | failed` and the output
 * file lives at `result.mp4Path` (the `render:completed` EVENT carries it as
 * `outputPath` — the two are deliberately different surfaces).
 */
export interface RenderJob {
  id: string;
  sceneId: string;
  quality: RenderQuality;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  /** 0..1 */
  progress: number;
  error?: string;
  result?: {
    mp4Path: string;
    mp4Url: string;
    frames: number;
    wallMs: number;
    effectiveFps: number;
    encoder: string;
    workerCount: number;
  };
}

/** The rendered file of a finished job, when there is one. */
export function renderOutputPath(job: RenderJob | undefined): string | undefined {
  if (!job) return undefined;
  return job.result?.mp4Path;
}

/** True when the job reached a terminal state. */
export function isTerminal(job: RenderJob | undefined): boolean {
  return job?.status === 'succeeded' || job?.status === 'failed';
}

export async function startRender(sceneId: string, quality: RenderQuality): Promise<{ jobId: string; status: string }> {
  const res = await invokeEngine<{ jobId: string; status: string }>('startRender', sceneId, quality);
  return res;
}

export async function getRenderStatus(jobId: string): Promise<RenderJob | undefined> {
  return invokeEngine<RenderJob | undefined>('getRenderStatus', jobId);
}

export interface RenderEventHandlers {
  onProgress?: (jobId: string, progressPct: number, currentFrame: number, totalFrames: number) => void;
  onCompleted?: (jobId: string, outputPath: string) => void;
  onFailed?: (jobId: string, error: string) => void;
}

/**
 * Subscribe to the render lifecycle.
 *
 * Returns an unsubscribe function.
 */
export function onRenderEvents(handlers: RenderEventHandlers): () => void {
  return onEngineEvent((event) => {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (event.eventName === 'render:progress') {
      handlers.onProgress?.(
        String(payload.jobId ?? ''),
        Number(payload.progressPct ?? 0),
        Number(payload.currentFrame ?? 0),
        Number(payload.totalFrames ?? 0)
      );
    } else if (event.eventName === 'render:completed') {
      handlers.onCompleted?.(String(payload.jobId ?? ''), String(payload.outputPath ?? ''));
    } else if (event.eventName === 'render:failed') {
      handlers.onFailed?.(String(payload.jobId ?? ''), String(payload.error ?? 'Render failed'));
    }
  });
}
