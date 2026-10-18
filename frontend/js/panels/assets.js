// ============================================================
// MotionForge Studio — Asset Vault Panel
// Upload, Drag-and-Drop, Preview Thumbnails, Scene Injection
// ============================================================

import { $, h } from '../util/dom.js';
import { api } from '../api.js';
import { store, state } from '../state.js';
import { toast } from '../ui/toast.js';

export class AssetsPanel {
  constructor() {
    this.container = null;
    this.assets = this.loadRegistry();

    this.init();
  }

  loadRegistry() {
    try {
      const stored = localStorage.getItem('motionforge_asset_vault');
      if (stored) return JSON.parse(stored);
    } catch {}
    // Seed standard demo assets
    return [
      { name: 'logo.png', src: 'vault:logo.png', kind: 'image', size: '24 KB', uploadedAt: Date.now() - 3600000 },
      { name: 'backdrop.jpg', src: 'vault:backdrop.jpg', kind: 'image', size: '140 KB', uploadedAt: Date.now() - 7200000 },
    ];
  }

  saveRegistry() {
    try {
      localStorage.setItem('motionforge_asset_vault', JSON.stringify(this.assets));
    } catch {}
  }

  init() {
    // Add Assets panel container to Left Sidebar if not existing
    const leftPanel = $('.panel-left');
    if (!leftPanel) return;

    // Add tab button if not present
    const tabs = leftPanel.querySelector('.panel-tabs');
    if (tabs && !tabs.querySelector('[data-tab="assets"]')) {
      const btn = h('button', { class: 'tab-btn', 'data-tab': 'assets' }, 'Assets');
      tabs.appendChild(btn);
    }

    // Add panel content container if not present
    let content = leftPanel.querySelector('[data-panel="assets"]');
    if (!content) {
      content = h(
        'div',
        { class: 'panel-content hidden', 'data-panel': 'assets' },
        h(
          'div',
          { class: 'assets-header', style: 'padding: 8px 12px; display: flex; gap: 8px; border-bottom: 1px solid var(--border);' },
          h('button', {
            class: 'primary-btn',
            style: 'width: 100%; justify-content: center;',
            onClick: () => this.triggerUpload(),
          }, '+ Upload to Vault')
        ),
        (this.container = h('div', { class: 'assets-list', style: 'flex: 1; overflow-y: auto; padding: 10px;' }))
      );
      leftPanel.appendChild(content);
    } else {
      this.container = content.querySelector('.assets-list');
    }

    this.setupDropZone();
    this.render();
  }

  setupDropZone() {
    const stage = $('#preview-stage');
    if (!stage) return;

    stage.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      stage.classList.add('dropzone-active');
    });

    stage.addEventListener('dragleave', () => {
      stage.classList.remove('dropzone-active');
    });

    stage.addEventListener('drop', async (e) => {
      e.preventDefault();
      stage.classList.remove('dropzone-active');
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        for (const file of files) {
          await this.uploadFile(file, true);
        }
      }
    });
  }

  triggerUpload() {
    const input = h('input', { type: 'file', accept: 'image/*,audio/*,.json' });
    input.addEventListener('change', async () => {
      if (input.files?.[0]) {
        await this.uploadFile(input.files[0], false);
      }
    });
    input.click();
  }

  async uploadFile(file, autoAddToScene = false) {
    const toastItem = toast.info('Uploading asset...', file.name, 0);
    try {
      const buffer = await file.arrayBuffer();
      const res = await api.uploadAsset(file.name, buffer);

      const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'other';
      const entry = {
        name: file.name,
        src: res.src || `vault:${file.name}`,
        kind,
        size: `${Math.round(file.size / 1024)} KB`,
        uploadedAt: Date.now(),
      };

      this.assets.unshift(entry);
      this.saveRegistry();
      this.render();

      toast.dismiss(toastItem);
      toast.success('Asset Uploaded', `${file.name} saved in vault.`);

      if (autoAddToScene) {
        this.addAssetToScene(entry, 'imageLogo');
      }
    } catch (err) {
      toast.dismiss(toastItem);
      toast.error('Upload Failed', err.message);
    }
  }

  addAssetToScene(asset, asType = 'imageLogo') {
    if (!state.scene) {
      toast.warn('No Scene', 'Load a scene first to add assets.');
      return;
    }

    store.mutateScene((scene) => {
      if (!scene.assets) scene.assets = [];
      const assetId = asset.name.replace(/[^a-zA-Z0-9]/g, '_');

      // Register asset in scene if not already declared
      if (!scene.assets.some(a => a.id === assetId)) {
        scene.assets.push({
          id: assetId,
          src: asset.src,
          kind: asset.kind,
        });
      }

      if (asType === 'imageLogo') {
        scene.layers.push({
          id: `logo-${Date.now().toString(36).slice(2, 6)}`,
          type: 'imageLogo',
          assetId,
          at: state.playhead,
          duration: 3000,
          widthPx: 300,
          position: { xPct: 50, yPct: 50 },
          entrance: { name: 'springPop' },
        });
      } else if (asType === 'background') {
        scene.layers.unshift({
          id: `bg-media-${Date.now().toString(36).slice(2, 6)}`,
          type: 'background',
          variant: { variant: 'media', assetId },
        });
      }
    }, `Added ${asset.name} to scene`);

    toast.success('Added to Scene', `Inserted ${asset.name}`);
  }

  render() {
    if (!this.container) return;

    if (!this.assets.length) {
      this.container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
          <div class="empty-state-title">Vault is empty</div>
          <div class="empty-state-hint">Upload logos, backdrops, or audio files to use in your scenes.</div>
        </div>
      `;
      return;
    }

    this.container.innerHTML = '';
    const grid = h('div', { class: 'assets-grid', style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 8px;' });

    this.assets.forEach((asset) => {
      const isImg = asset.kind === 'image';
      const vaultUrl = api.assetVaultUrl(asset.name);

      const card = h(
        'div',
        {
          class: 'asset-card',
          style: 'padding: 8px; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; transition: all var(--duration) var(--ease);',
          onClick: () => {
            this.addAssetToScene(asset, isImg ? 'imageLogo' : 'audio');
          },
        },
        h(
          'div',
          {
            class: 'asset-preview-box',
            style: 'height: 64px; background: var(--bg-0); border-radius: 4px; display: flex; align-items: center; justify-content: center; overflow: hidden; margin-bottom: 6px;',
          },
          isImg
            ? h('img', { src: vaultUrl, style: 'max-width: 100%; max-height: 100%; object-fit: contain;', onerror: (e) => { e.target.style.display = 'none'; } })
            : h('span', { style: 'font-size: 24px;' }, asset.kind === 'audio' ? '🎵' : '📄')
        ),
        h('div', { style: 'font-weight: 500; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }, asset.name),
        h('div', { style: 'font-size: 10px; color: var(--text-3); margin-top: 2px;' }, `${asset.size}`)
      );

      card.addEventListener('mouseenter', () => {
        card.style.borderColor = 'var(--primary)';
        card.style.transform = 'translateY(-1px)';
      });
      card.addEventListener('mouseleave', () => {
        card.style.borderColor = 'var(--border)';
        card.style.transform = 'translateY(0)';
      });

      grid.appendChild(card);
    });

    this.container.appendChild(grid);
  }
}

export const assetsPanel = new AssetsPanel();
