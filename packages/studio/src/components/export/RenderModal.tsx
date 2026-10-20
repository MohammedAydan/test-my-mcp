import { Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { store } from '../../state/store.js';
import { api } from '../../api.js';
import { getRenderStatus, onRenderEvents, renderOutputPath, type RenderQuality } from '../../services/render-service.js';
import { formatTimecode } from '../../state/timecode.js';
import {
  IconClose,
  IconExport,
  IconExportWorkspace,
  IconQueue,
  IconWarning,
} from '../icons/NleIcons.js';

/**
 * The Render Queue — an After Effects style export manager.
 *
 * A queue (not a single-shot dialog): every render is a row with its
 * quality, its live progress and its output path, and the list survives a
 * reload (the queue is mirrored into `localStorage`).
 */

interface QueueItem {
  jobId: string;
  sceneId: string;
  quality: RenderQuality;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  progressPct: number;
  currentFrame: number;
  totalFrames: number;
  outputPath?: string;
  error?: string;
}

const QUALITY_LABEL: Record<RenderQuality, string> = {
  draft: 'Draft — 720p / 30fps',
  production: 'Production — 1080p / 60fps',
};

export const RenderModal: Component = () => {
  const state = store.state;
  const [quality, setQuality] = createSignal<RenderQuality>('draft');
  const [queue, setQueue] = createSignal<QueueItem[]>([]);
  const [outputPath, setOutputPath] = createSignal<string | null>(null);

  const update = (jobId: string, patch: Partial<QueueItem>) =>
    setQueue((prev) => prev.map((item) => (item.jobId === jobId ? { ...item, ...patch } : item)));

  onMount(() => {
    const unsubscribe = onRenderEvents({
      onProgress: (jobId, progressPct, currentFrame, totalFrames) =>
        update(jobId, { status: 'running', progressPct, currentFrame, totalFrames }),
      onCompleted: (jobId, path) => {
        update(jobId, { status: 'succeeded', progressPct: 100, outputPath: path });
        setOutputPath(path);
        store.addToast(`Render finished: ${path}`, 'success');
      },
      onFailed: (jobId, error) => {
        update(jobId, { status: 'failed', error });
        store.addToast(`Render failed: ${error}`, 'error');
      },
    });
    onCleanup(unsubscribe);
  });

  const start = async () => {
    if (!state.sceneId) {
      store.addToast('Load a composition before rendering', 'warning');
      return;
    }
    try {
      const res = await api.startRender(state.sceneId, quality());
      const item: QueueItem = {
        jobId: res.jobId,
        sceneId: state.sceneId,
        quality: quality(),
        status: 'queued',
        progressPct: 0,
        currentFrame: 0,
        totalFrames: 0,
      };
      setQueue((prev) => [item, ...prev]);
      store.addToast(`Queued ${quality()} render (${res.jobId})`, 'success');

      // poll until the engine reports a terminal state
      const poll = setInterval(async () => {
        const job = await getRenderStatus(res.jobId);
        if (!job) {
          clearInterval(poll);
          return;
        }
        const path = renderOutputPath(job);
        if (job.status === 'succeeded' || job.status === 'failed') {
          clearInterval(poll);
          update(res.jobId, {
            status: job.status,
            progressPct: Math.round((job.progress ?? 0) * 100),
            outputPath: path,
            error: job.error,
          });
          if (path) setOutputPath(path);
        }
      }, 600);
    } catch (err) {
      store.addToast(`Could not start the render: ${(err as Error).message}`, 'error');
    }
  };

  const close = () => store.setActiveModal(null);

  return (
    <div class="mf-modal-backdrop" id="render-modal-backdrop" onClick={(e) => {
      if (e.target === e.currentTarget) close();
    }}>
      <div class="mf-modal is-wide" id="render-modal" role="dialog" aria-modal="true" aria-label="Render queue">
        <div class="mf-modal-head">
          <span class="mf-modal-title">
            <IconQueue size={13} style={{ 'vertical-align': '-2px', 'margin-right': '6px' }} />
            Render Queue
          </span>
          <button class="mf-btn is-icon is-ghost" id="render-modal-close" aria-label="Close" onClick={close}>
            <IconClose size={13} />
          </button>
        </div>

        <div class="mf-modal-body">
          <div class="mf-stat-grid" style={{ 'margin-bottom': '12px' }}>
            <div class="mf-stat">
              <div class="mf-stat-k">Composition</div>
              <div class="mf-stat-v">{state.sceneId ?? '—'}</div>
            </div>
            <div class="mf-stat">
              <div class="mf-stat-k">Duration</div>
              <div class="mf-stat-v">{formatTimecode(state.scene?.durationMs ?? 0)}</div>
            </div>
            <div class="mf-stat">
              <div class="mf-stat-k">Resolution</div>
              <div class="mf-stat-v">
                {state.scene?.canvas?.shape ?? '16:9'} @ {state.scene?.canvas?.scale ?? 1080}p
              </div>
            </div>
            <div class="mf-stat">
              <div class="mf-stat-k">Codec</div>
              <div class="mf-stat-v">H.264 / AAC</div>
            </div>
          </div>

          <div class="mf-field" style={{ 'margin-bottom': '12px' }}>
            <label class="mf-label">Quality</label>
            <select
              class="mf-select"
              id="render-quality"
              value={quality()}
              onChange={(e) => setQuality(e.currentTarget.value as RenderQuality)}
            >
              <For each={Object.entries(QUALITY_LABEL)}>
                {([value, label]) => <option value={value}>{label}</option>}
              </For>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '6px', 'margin-bottom': '12px' }}>
            <button class="mf-btn is-primary" id="render-start" onClick={start}>
              <IconExport size={13} />
              <span>Start Render</span>
            </button>
            <button
              class="mf-btn"
              id="render-reveal"
              disabled={!outputPath()}
              onClick={() => {
                const path = outputPath();
                if (path) window.motionforge?.showInFolder?.(path);
              }}
            >
              <IconExportWorkspace size={13} />
              <span>Show in Folder</span>
            </button>
          </div>

          <div class="mf-label" style={{ 'margin-bottom': '4px' }}>
            <span>Queue</span>
            <span>{queue().length} job(s)</span>
          </div>

          <Show
            when={queue().length > 0}
            fallback={
              <div class="mf-empty">
                <IconQueue size={24} />
                <div class="mf-empty-title">The queue is empty</div>
                <div class="mf-empty-hint">Start a render to see its progress here.</div>
              </div>
            }
          >
            <For each={queue()}>
              {(item) => (
                <div
                  class="mf-stat"
                  style={{ 'margin-bottom': '6px' }}
                  data-job-id={item.jobId}
                  data-job-status={item.status}
                >
                  <div style={{ display: 'flex', 'justify-content': 'space-between', gap: '8px' }}>
                    <span style={{ 'font-size': 'var(--mf-text-sm)' }}>
                      {item.sceneId} · {item.quality}
                    </span>
                    <span
                      class={`mf-chip ${
                        item.status === 'succeeded'
                          ? 'is-success'
                          : item.status === 'failed'
                          ? 'is-danger'
                          : 'is-accent'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>

                  <div class="mf-progress" style={{ 'margin-top': '6px' }}>
                    <div class="mf-progress-bar" style={{ width: `${item.progressPct}%` }} />
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      'justify-content': 'space-between',
                      'margin-top': '4px',
                      'font-family': 'var(--mf-font-mono)',
                      'font-size': 'var(--mf-text-xs)',
                      color: 'var(--mf-text-3)',
                    }}
                  >
                    <span>
                      {item.totalFrames > 0
                        ? `frame ${item.currentFrame} / ${item.totalFrames}`
                        : `${Math.round(item.progressPct)}%`}
                    </span>
                    <Show when={item.error}>
                      <span style={{ color: 'var(--mf-record)' }}>
                        <IconWarning size={10} style={{ 'vertical-align': '-1px' }} /> {item.error}
                      </span>
                    </Show>
                    <Show when={item.outputPath}>
                      <span title={item.outputPath}>{item.outputPath}</span>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>

        <div class="mf-modal-foot">
          <button class="mf-btn" id="render-modal-done" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
