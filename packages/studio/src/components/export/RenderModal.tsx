import { Component, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { resolveCanvasSize, type Canvas } from '@motionforge/scene-spec';
import { store } from '../../state/store.js';
import { startRenderJob } from '../../services/render-queue.js';
import type { RenderQuality } from '../../services/render-service.js';
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
 *
 * THE QUEUE IS NOT LOCAL: `state.renderQueue` in the global store is the ONE
 * source of truth. This modal is a VIEW of it — it never owns a copy. That
 * is why a render that finishes while the modal is closed still shows up
 * (the render-queue bridge keeps the store updated), and why the status bar
 * and the command palette can see the same jobs.
 */

/** The measured per-frame costs of this host, in milliseconds. */
const MS_PER_FRAME: Record<RenderQuality, number> = {
  draft: 254,
  production: 495,
};

/** The frame rate of each quality tier. */
const FPS: Record<RenderQuality, number> = {
  draft: 30,
  production: 60,
};

const QUALITY_LABEL: Record<RenderQuality, string> = {
  draft: 'Draft',
  production: 'Production',
};

const QUALITY_DETAIL: Record<RenderQuality, string> = {
  draft: '720p · 30 fps · fast preview',
  production: '1080p · 60 fps · final master',
};

/** `2 min 30 s` — the human duration of a millisecond estimate. */
export function formatEstimate(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

export const RenderModal: Component = () => {
  const state = store.state;
  const [quality, setQuality] = createSignal<RenderQuality>('draft');
  const [outputPath, setOutputPath] = createSignal<string | null>(null);

  /**
   * The queue — READ FROM THE STORE, never a local copy.
   *
   * The store owns the jobs, so this view cannot drift from the status bar,
   * the command palette or an automation.
   */
  const queue = createMemo(() => state.renderQueue);

  /* ── the cost estimate ───────────────────────────────────────────────── */

  /** The pixel size a quality tier renders at. */
  const resolutionFor = (tier: RenderQuality): { width: number; height: number } => {
    const shape = state.scene?.canvas?.shape ?? '16:9';
    const scale = state.scene?.canvas?.scale ?? 1080;
    const target = tier === 'draft' ? Math.min(720, scale) : scale;
    try {
      return resolveCanvasSize({ shape, scale: target } as Canvas);
    } catch {
      // 1:1 and 4:5 have no 720p master — fall back to the composition size
      try {
        return resolveCanvasSize({ shape, scale } as Canvas);
      } catch {
        return { width: 1920, height: 1080 };
      }
    }
  };

  /** The estimated wall-clock duration of one tier, in milliseconds. */
  const estimateFor = (tier: RenderQuality): number => {
    const durationSec = (state.scene?.durationMs ?? 0) / 1000;
    return durationSec * FPS[tier] * MS_PER_FRAME[tier];
  };

  /** `1920×1080 · 60 fps · ≈ 2 min 30 s` */
  const costLine = (tier: RenderQuality): string => {
    const size = resolutionFor(tier);
    return `${size.width}×${size.height} · ${FPS[tier]} fps · ≈ ${formatEstimate(estimateFor(tier))}`;
  };

  /* ── the render lifecycle ────────────────────────────────────────────── */

  onMount(() => {
    // a job that finished while the modal was closed still has its output
    const latest = state.renderQueue.find((job) => job.outputPath);
    if (latest?.outputPath) setOutputPath(latest.outputPath);
  });

  const start = async () => {
    if (!state.sceneId) {
      store.addToast('Load a composition before rendering', 'warning');
      return;
    }
    try {
      const jobId = await startRenderJob(state.sceneId, quality());
      store.addToast(`Queued ${quality()} render (${jobId})`, 'success');
    } catch (err) {
      store.addToast(`Could not start the render: ${(err as Error).message}`, 'error');
    }
  };

  const close = () => store.setActiveModal(null);

  const statusLabel = (status: string): string => {
    if (status === 'completed') return 'succeeded';
    if (status === 'pending') return 'queued';
    return status;
  };

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

          {/* ── the two quality tiers, each with its cost ── */}
          <div class="mf-field" style={{ 'margin-bottom': '12px' }}>
            <label class="mf-label" for="render-quality">Quality</label>
            <select
              class="mf-select"
              id="render-quality"
              value={quality()}
              onChange={(e) => setQuality(e.currentTarget.value as RenderQuality)}
            >
              <For each={['draft', 'production'] as RenderQuality[]}>
                {(tier) => <option value={tier}>{QUALITY_LABEL[tier]}</option>}
              </For>
            </select>

            {/* the cost of every tier, next to the option itself */}
            <div class="mf-render-costs" id="render-cost-list">
              <For each={['draft', 'production'] as RenderQuality[]}>
                {(tier) => (
                  <button
                    type="button"
                    class={`mf-render-cost ${quality() === tier ? 'is-active' : ''}`}
                    data-render-quality={tier}
                    data-active={quality() === tier ? 'true' : 'false'}
                    id={`render-cost-${tier}`}
                    title={QUALITY_DETAIL[tier]}
                    onClick={() => setQuality(tier)}
                    style={{
                      display: 'flex',
                      'justify-content': 'space-between',
                      'align-items': 'baseline',
                      gap: '8px',
                      width: '100%',
                      padding: '4px 6px',
                      'margin-top': '3px',
                      'border-radius': 'var(--radius-sm)',
                      'border': `1px solid ${
                        quality() === tier ? 'var(--mf-accent)' : 'var(--mf-border)'
                      }`,
                      background: quality() === tier ? 'var(--mf-accent-dim)' : 'transparent',
                      color: quality() === tier ? 'var(--mf-accent-text)' : 'var(--mf-text-2)',
                      'font-size': 'var(--mf-text-xs)',
                      'font-family': 'var(--mf-font-mono)',
                      'text-align': 'left',
                    }}
                  >
                    <span style={{ 'font-weight': '600' }}>{QUALITY_LABEL[tier]}</span>
                    <span>{costLine(tier)}</span>
                  </button>
                )}
              </For>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '6px', 'margin-bottom': '12px' }}>
            <button class="mf-btn is-primary" id="render-start" onClick={() => void start()}>
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
                  data-job-id={item.id}
                  data-job-status={item.status}
                >
                  <div style={{ display: 'flex', 'justify-content': 'space-between', gap: '8px' }}>
                    <span style={{ 'font-size': 'var(--mf-text-sm)' }}>
                      {item.sceneId} · {item.quality}
                    </span>
                    <span
                      class={`mf-chip ${
                        item.status === 'completed'
                          ? 'is-success'
                          : item.status === 'failed'
                            ? 'is-danger'
                            : 'is-accent'
                      }`}
                    >
                      {statusLabel(item.status)}
                    </span>
                  </div>

                  <div class="mf-progress" style={{ 'margin-top': '6px' }}>
                    <div class="mf-progress-bar" style={{ width: `${item.progressPct ?? 0}%` }} />
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
                      {item.totalFrames && item.totalFrames > 0
                        ? `frame ${item.currentFrame ?? 0} / ${item.totalFrames}`
                        : `${Math.round(item.progressPct ?? 0)}%`}
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
