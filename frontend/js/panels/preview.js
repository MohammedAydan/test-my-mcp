// ============================================================
// MotionForge Studio — Preview Panel & postMessage Sync
// Bidirectional Sync with scene-runtime Iframe + Fullscreen
// ============================================================

import { $, h } from '../util/dom.js';
import { store, state } from '../state.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';

export class PreviewPanel {
  constructor() {
    this.stage = $('#preview-stage');
    this.iframe = $('#preview-iframe');
    this.emptyState = $('#preview-empty');
    this.metaLabel = $('#preview-meta');

    this.isReady = false;
    this.pendingSeek = null;
    this.rafId = null;
    this.isFullscreen = false;
    this.floatingBar = null;

    this.initListeners();
    store.subscribe((event, s, payload) => {
      if (event === 'scene:loaded') {
        this.loadScene(s.scene, s.sceneId);
      } else if (event === 'playhead:moved') {
        this.postSeek(payload);
      } else if (event === 'playback:changed') {
        if (payload) this.postPlay();
        else this.postPause();
      }
    });
  }

  initListeners() {
    // Listen for postMessage from preview iframe (scene-runtime)
    window.addEventListener('message', (e) => {
      const data = e.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'motionforge:ready') {
        this.isReady = true;
        console.log('[Preview] Runtime ready:', data);
        if (this.metaLabel && state.scene) {
          const fps = data.fps || 60;
          this.metaLabel.textContent = `${state.scene.canvas.shape} · ${state.scene.durationMs}ms · ${fps}fps`;
        }
      } else if (data.type === 'motionforge:frame') {
        if (state.playing && typeof data.atMs === 'number') {
          store.setPlayhead(data.atMs);
        }
      }
    });

    // Handle Escape in Fullscreen
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isFullscreen) {
        this.exitFullscreen();
      }
    });
  }

  loadScene(scene, sceneId) {
    if (!scene || !sceneId) {
      this.iframe.classList.add('hidden');
      this.emptyState.classList.remove('hidden');
      if (this.metaLabel) this.metaLabel.textContent = '—';
      return;
    }

    this.emptyState.classList.add('hidden');
    this.iframe.classList.remove('hidden');

    const url = api.previewUrl(sceneId);
    this.iframe.src = url;
    this.isReady = false;

    if (this.metaLabel) {
      this.metaLabel.textContent = `${scene.canvas?.shape || '16:9'} · ${scene.durationMs}ms · ${scene.layers?.length || 0}L`;
    }
  }

  postSeek(atMs) {
    this.pendingSeek = atMs;
    if (this.rafId) return;

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      if (this.pendingSeek != null && this.iframe?.contentWindow) {
        this.iframe.contentWindow.postMessage(
          { type: 'motionforge:seek', atMs: this.pendingSeek },
          '*'
        );
      }
    });
  }

  postPlay() {
    if (this.iframe?.contentWindow) {
      this.iframe.contentWindow.postMessage({ type: 'motionforge:play' }, '*');
    }
  }

  postPause() {
    if (this.iframe?.contentWindow) {
      this.iframe.contentWindow.postMessage({ type: 'motionforge:pause' }, '*');
    }
  }

  triggerPresetPreview(presetName) {
    if (this.iframe?.contentWindow) {
      this.iframe.contentWindow.postMessage(
        { type: 'motionforge:previewPreset', preset: presetName },
        '*'
      );
    }
  }

  toggleFullscreen() {
    if (this.isFullscreen) {
      this.exitFullscreen();
    } else {
      this.enterFullscreen();
    }
  }

  enterFullscreen() {
    if (!this.stage) return;
    this.isFullscreen = true;
    this.stage.classList.add('preview-stage-fullscreen');

    // Create floating transport bar
    if (!this.floatingBar) {
      this.floatingBar = h(
        'div',
        { class: 'mf-fullscreen-bar' },
        h('button', {
          class: 'transport-btn play',
          onClick: () => store.setPlaying(!state.playing),
        }, '▶'),
        h('span', { class: 'timecode', id: 'fs-timecode', style: 'font-size: 11px;' }, '00:00:00.000'),
        h('button', {
          class: 'secondary-btn',
          onClick: () => this.exitFullscreen(),
        }, 'Exit (Esc)')
      );
      this.stage.appendChild(this.floatingBar);
    } else {
      this.floatingBar.classList.remove('hidden');
    }
  }

  exitFullscreen() {
    if (!this.isFullscreen) return;
    this.isFullscreen = false;
    this.stage.classList.remove('preview-stage-fullscreen');
    if (this.floatingBar) {
      this.floatingBar.classList.add('hidden');
    }
  }
}

export const previewPanel = new PreviewPanel();
