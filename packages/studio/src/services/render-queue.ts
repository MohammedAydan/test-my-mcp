import { store } from '../state/store.js';
import {
  getRenderStatus,
  onRenderEvents,
  renderOutputPath,
  startRender,
  type RenderQuality,
} from './render-service.js';

/**
 * The render queue bridge — the render jobs live in the GLOBAL store.
 *
 * WHY THIS FILE EXISTS: the render queue used to be a LOCAL signal inside the
 * Render Modal. Two things were broken by that:
 *
 *  1. the status bar, the command palette and any automation could not see
 *     that a render was running — `state.renderQueue` stayed empty, and
 *  2. a render that finished while the modal was CLOSED lost its terminal
 *     state: the modal re-mounted with an empty list and the job vanished.
 *
 * So the queue is now owned by the store, and THIS service owns the
 * subscription. It is started ONCE (from the application root) and lives for
 * the whole session — the modal is only a VIEW of the queue.
 */

/** the active pollers, one per running job */
const pollers = new Map<string, ReturnType<typeof setInterval>>();

let bridgeStarted = false;

/**
 * Start the bridge.
 *
 * Idempotent: calling it twice does not subscribe twice.
 */
export function ensureRenderQueueBridge(): void {
  if (bridgeStarted) return;
  bridgeStarted = true;

  onRenderEvents({
    onProgress: (jobId, progressPct, currentFrame, totalFrames) => {
      store.patchRenderJob(jobId, {
        status: 'rendering',
        progressPct,
        currentFrame,
        totalFrames,
      });
    },
    onCompleted: (jobId, outputPath) => {
      store.patchRenderJob(jobId, {
        status: 'completed',
        progressPct: 100,
        outputPath,
      });
      stopPolling(jobId);
    },
    onFailed: (jobId, error) => {
      store.patchRenderJob(jobId, { status: 'failed', error });
      stopPolling(jobId);
    },
  });
}

/** Stop the poller of one job. */
function stopPolling(jobId: string): void {
  const poller = pollers.get(jobId);
  if (poller !== undefined) {
    clearInterval(poller);
    pollers.delete(jobId);
  }
}

/**
 * Poll one job until it reaches a terminal state.
 *
 * The engine's domain events are the primary signal; the poll is the safety
 * net for the case where the event was missed (a render that was already
 * running when the Studio started, for instance).
 */
function pollJob(jobId: string): void {
  if (pollers.has(jobId)) return;
  const poller = setInterval(() => {
    void (async () => {
      const job = await getRenderStatus(jobId);
      if (!job) {
        stopPolling(jobId);
        return;
      }
      if (job.status === 'succeeded') {
        store.patchRenderJob(jobId, {
          status: 'completed',
          progressPct: 100,
          outputPath: renderOutputPath(job),
        });
        stopPolling(jobId);
        return;
      }
      if (job.status === 'failed') {
        store.patchRenderJob(jobId, {
          status: 'failed',
          error: job.error ?? 'Render failed',
        });
        stopPolling(jobId);
        return;
      }
      store.patchRenderJob(jobId, {
        status: job.status === 'running' ? 'rendering' : 'pending',
        progressPct: Math.round((job.progress ?? 0) * 100),
      });
    })().catch(() => undefined);
  }, 600);
  pollers.set(jobId, poller);
}

/**
 * Start a render and PUBLISH it into the global queue.
 *
 * The job is in `state.renderQueue` before the first frame is encoded, so
 * the status bar shows it immediately — and it is still there after the
 * modal is closed and reopened.
 */
export async function startRenderJob(
  sceneId: string,
  quality: RenderQuality
): Promise<string> {
  const res = await startRender(sceneId, quality);
  store.upsertRenderJob({
    id: res.jobId,
    sceneId,
    quality,
    status: 'pending',
    progressPct: 0,
    createdAt: Date.now(),
  });
  pollJob(res.jobId);
  return res.jobId;
}

/**
 * The summary the status bar and the command palette read.
 *
 * It is a pure projection of `state.renderQueue` — the store stays the one
 * source of truth.
 */
export interface RenderQueueSummary {
  /** the jobs that are queued or running */
  active: number;
  /** the jobs that finished */
  completed: number;
  /** the jobs that failed */
  failed: number;
  /** the progress of the FIRST active job, 0..100 */
  progressPct: number;
  /** the total number of jobs */
  total: number;
}

export function summarizeRenderQueue(
  queue: ReadonlyArray<{ status: string; progressPct?: number }>
): RenderQueueSummary {
  let active = 0;
  let completed = 0;
  let failed = 0;
  for (const job of queue) {
    if (job.status === 'pending' || job.status === 'rendering') active += 1;
    else if (job.status === 'completed') completed += 1;
    else if (job.status === 'failed') failed += 1;
  }
  const first = queue.find(
    (job) => job.status === 'pending' || job.status === 'rendering'
  );
  return {
    active,
    completed,
    failed,
    progressPct: first?.progressPct ?? 0,
    total: queue.length,
  };
}
