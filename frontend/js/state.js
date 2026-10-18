// ============================================================
// MotionForge Studio — Centralized Reactive Store & History
// ============================================================

import { ENGINE_URL } from './api.js';

class Store {
  constructor() {
    this.state = {
      engine: { online: false, url: ENGINE_URL, latencyMs: 0 },
      capabilities: null,
      scene: null,
      sceneId: null,
      selectedLayerId: null,
      selectedLayerIds: [],
      playhead: 0,
      playing: false,
      zoom: 1, // 1 = 100%
      panOffset: 0,
      snapEnabled: true,
      openScenes: this.loadOpenScenes(),
      recentScenes: this.loadRecentScenes(),
      renderQueue: this.loadRenderQueue(),
      activeLeftTab: 'layers',
      activeRightTab: 'inspector',
      saveStatus: 'saved', // 'saved' | 'saving' | 'unsaved' | 'failed'
      lastSaved: null,
      dirty: false,
      clipboardLayer: null,
    };

    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 50;

    // Warn on close if dirty
    window.addEventListener('beforeunload', (e) => {
      if (this.state.dirty) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes in MotionForge Studio. Are you sure you want to leave?';
      }
    });
  }

  loadOpenScenes() {
    try {
      return JSON.parse(localStorage.getItem('motionforge_open_scenes')) || [];
    } catch {
      return [];
    }
  }

  saveOpenScenes() {
    try {
      localStorage.setItem('motionforge_open_scenes', JSON.stringify(this.state.openScenes.slice(0, 8)));
    } catch {}
  }

  loadRecentScenes() {
    try {
      return JSON.parse(localStorage.getItem('motionforge_recent_scenes')) || [];
    } catch {
      return [];
    }
  }

  saveRecentScenes() {
    try {
      localStorage.setItem('motionforge_recent_scenes', JSON.stringify(this.state.recentScenes.slice(0, 20)));
    } catch {}
  }

  loadRenderQueue() {
    try {
      return JSON.parse(localStorage.getItem('motionforge_render_queue')) || [];
    } catch {
      return [];
    }
  }

  saveRenderQueue() {
    try {
      localStorage.setItem('motionforge_render_queue', JSON.stringify(this.state.renderQueue.slice(0, 20)));
    } catch {}
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event, payload) {
    for (const listener of this.listeners) {
      try {
        listener(event, this.state, payload);
      } catch (err) {
        console.error('[Store error in listener]', err);
      }
    }
  }

  // Push an undoable state snapshot
  pushHistory(description) {
    if (!this.state.scene) return;
    this.undoStack.push({
      scene: structuredClone(this.state.scene),
      description: description || 'Change scene',
      selectedLayerId: this.state.selectedLayerId,
    });
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = []; // Cleared on new mutation
    this.notify('history:changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    if (!this.canUndo()) return null;
    const currentSnapshot = {
      scene: structuredClone(this.state.scene),
      description: 'Reverted state',
      selectedLayerId: this.state.selectedLayerId,
    };
    this.redoStack.push(currentSnapshot);

    const prev = this.undoStack.pop();
    this.state.scene = structuredClone(prev.scene);
    this.state.selectedLayerId = prev.selectedLayerId;
    this.state.dirty = true;
    this.state.saveStatus = 'unsaved';
    this.syncDesktopDirty();

    this.notify('scene:mutated', { source: 'undo', description: prev.description });
    this.notify('history:changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    return prev.description;
  }

  syncDesktopDirty() {
    if (window.motionforge?.setDirty) {
      window.motionforge.setDirty(Boolean(this.state.dirty));
    }
  }

  redo() {
    if (!this.canRedo()) return null;
    const currentSnapshot = {
      scene: structuredClone(this.state.scene),
      description: 'Current state before redo',
      selectedLayerId: this.state.selectedLayerId,
    };
    this.undoStack.push(currentSnapshot);

    const next = this.redoStack.pop();
    this.state.scene = structuredClone(next.scene);
    this.state.selectedLayerId = next.selectedLayerId;
    this.state.dirty = true;
    this.state.saveStatus = 'unsaved';
    this.syncDesktopDirty();

    this.notify('scene:mutated', { source: 'redo', description: next.description });
    this.notify('history:changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    return next.description;
  }

  // Direct state mutation with history logging
  mutateScene(mutatorFn, description) {
    if (!this.state.scene) return;
    this.pushHistory(description || 'Edit scene');
    mutatorFn(this.state.scene);
    this.state.dirty = true;
    this.state.saveStatus = 'unsaved';
    this.syncDesktopDirty();
    this.notify('scene:mutated', { description });
  }

  // Set scene without history (e.g. Initial load)
  setScene(scene, sceneId) {
    this.state.scene = scene;
    this.state.sceneId = sceneId || scene?.id || null;
    this.state.selectedLayerId = scene?.layers?.[0]?.id || null;
    this.state.selectedLayerIds = this.state.selectedLayerId ? [this.state.selectedLayerId] : [];
    this.state.dirty = false;
    this.state.saveStatus = 'saved';
    this.state.lastSaved = new Date();
    this.syncDesktopDirty();
    this.undoStack = [];
    this.redoStack = [];

    if (this.state.sceneId) {
      localStorage.setItem('motionforge_last_scene', this.state.sceneId);
      // Track open tabs
      if (!this.state.openScenes.includes(this.state.sceneId)) {
        this.state.openScenes.push(this.state.sceneId);
        this.saveOpenScenes();
      }
      // Track recent scenes
      const existingIdx = this.state.recentScenes.findIndex(r => r.id === this.state.sceneId);
      const entry = { id: this.state.sceneId, name: scene?.name || this.state.sceneId, lastOpened: Date.now() };
      if (existingIdx >= 0) {
        this.state.recentScenes.splice(existingIdx, 1);
      }
      this.state.recentScenes.unshift(entry);
      this.saveRecentScenes();
    }

    this.notify('scene:loaded', scene);
    this.notify('history:changed', { canUndo: false, canRedo: false });
  }

  selectLayer(layerId, isMulti = false) {
    if (isMulti) {
      if (this.state.selectedLayerIds.includes(layerId)) {
        this.state.selectedLayerIds = this.state.selectedLayerIds.filter(id => id !== layerId);
      } else {
        this.state.selectedLayerIds.push(layerId);
      }
      this.state.selectedLayerId = this.state.selectedLayerIds[0] || null;
    } else {
      this.state.selectedLayerId = layerId;
      this.state.selectedLayerIds = layerId ? [layerId] : [];
    }
    this.notify('layer:selected', { id: this.state.selectedLayerId, ids: this.state.selectedLayerIds });
  }

  setPlayhead(atMs) {
    const dur = this.state.scene?.durationMs || 10000;
    const clamped = Math.max(0, Math.min(Math.round(atMs), dur));
    this.state.playhead = clamped;
    this.notify('playhead:moved', clamped);
  }

  setPlaying(playing) {
    this.state.playing = Boolean(playing);
    this.notify('playback:changed', this.state.playing);
  }

  setSaveStatus(status) {
    this.state.saveStatus = status;
    if (status === 'saved') {
      this.state.dirty = false;
      this.state.lastSaved = new Date();
    }
    this.syncDesktopDirty();
    this.notify('status:save', status);
  }
}

export const store = new Store();
export const state = store.state;
