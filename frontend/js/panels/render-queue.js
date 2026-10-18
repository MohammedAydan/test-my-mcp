// ============================================================
// MotionForge Studio — Persistent Render Queue & History
// ============================================================

import { $, h } from '../util/dom.js';
import { api } from '../api.js';
import { store, state } from '../state.js';
import { toast } from '../ui/toast.js';

export class RenderQueuePanel {
  constructor() {
    this.pollInterval = null;
    this.init();
  }

  init() {
    // Check if there are queued/running jobs to resume polling
    const pending = state.renderQueue.some(j => j.status === 'queued' || j.status === 'running');
    if (pending) {
      this.startPolling();
    }
  }

  addJob(jobId, sceneId, quality) {
    const job = {
      jobId,
      sceneId,
      quality,
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
      result: null,
    };
    state.renderQueue.unshift(job);
    if (state.renderQueue.length > 20) state.renderQueue.pop();
    store.saveRenderQueue();

    this.startPolling();
    return job;
  }

  startPolling() {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => this.pollJobs(), 2000);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async pollJobs() {
    let hasActive = false;
    for (const job of state.renderQueue) {
      if (job.status === 'queued' || job.status === 'running') {
        hasActive = true;
        try {
          const res = await api.getRender(job.jobId);
          job.status = res.status;
          job.progress = res.progress;
          if (res.status === 'succeeded') {
            job.result = res.result;
            toast.success('Render Completed', `Job ${job.jobId} finished (${job.quality}).`);
          } else if (res.status === 'failed') {
            job.error = res.error || 'Render failed';
            toast.error('Render Failed', `Job ${job.jobId} failed.`);
          }
        } catch (e) {
          console.warn('[Render poll error]', e);
        }
      }
    }
    store.saveRenderQueue();
    if (!hasActive) {
      this.stopPolling();
    }
  }

  openQueueModal() {
    import('../ui/modal.js').then(({ modal }) => {
      const container = h('div', { class: 'mf-render-queue-wrap' });

      if (!state.renderQueue.length) {
        container.innerHTML = `
          <div class="empty-state">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
            </svg>
            <div class="empty-state-title">No renders in queue</div>
            <div class="empty-state-hint">Click the Render button in the titlebar to generate an MP4 video.</div>
          </div>
        `;
      } else {
        state.renderQueue.forEach((job) => {
          const isDone = job.status === 'succeeded';
          const isFailed = job.status === 'failed';
          const fileUrl = isDone ? api.renderFileUrl(job.jobId) : null;

          const row = h(
            'div',
            {
              class: 'mf-queue-row',
              style: 'padding: 12px; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 8px;',
            },
            h(
              'div',
              { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;' },
              h('span', { style: 'font-weight: 600; font-size: 13px;' }, `${job.sceneId} (${job.quality})`),
              h(
                'span',
                {
                  class: `status-chip ${isDone ? 'online' : isFailed ? 'offline' : 'connecting'}`,
                  style: 'padding: 2px 8px;',
                },
                job.status
              )
            ),
            h(
              'div',
              { class: 'render-progress', style: 'margin: 6px 0;' },
              h('div', {
                class: 'render-progress-bar',
                style: `width: ${Math.round((job.progress || 0) * 100)}%; background: ${isFailed ? 'var(--danger)' : 'var(--primary)'};`,
              })
            ),
            h(
              'div',
              { style: 'display: flex; justify-content: space-between; font-size: 11px; color: var(--text-3); align-items: center;' },
              h('span', {}, new Date(job.createdAt).toLocaleTimeString()),
              fileUrl
                ? h(
                    'a',
                    {
                      href: fileUrl,
                      download: `${job.sceneId}-${job.quality}.mp4`,
                      class: 'primary-btn',
                      style: 'padding: 3px 10px; font-size: 11px; text-decoration: none;',
                    },
                    'Download MP4'
                  )
                : null
            )
          );
          container.appendChild(row);
        });
      }

      modal.open({
        title: 'Render Queue & History',
        subtitle: 'Track background rendering jobs and download finished MP4 videos',
        content: container,
        actions: [{ label: 'Close', type: 'secondary', close: true }],
      });
    });
  }
}

export const renderQueuePanel = new RenderQueuePanel();
