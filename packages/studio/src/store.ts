import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { api } from './api.js';
import type { StudioScene, CapabilitiesResponse, RenderJobStatus, AssetVaultItem } from './types.js';

export interface WorkspaceLayout {
  leftPanelWidth: number;
  rightPanelWidth: number;
  timelineHeight: number;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  timelineCollapsed: boolean;
}

export interface StudioState {
  engine: { online: boolean; url: string; latencyMs: number };
  capabilities: CapabilitiesResponse | null;
  scene: StudioScene | null;
  sceneId: string | null;
  selectedLayerId: string | null;
  selectedLayerIds: string[];
  playhead: number;
  playing: boolean;
  zoom: number;
  panOffset: number;
  timelineScrollY: number;
  snapEnabled: boolean;
  viewportZoom: number;
  viewportPan: { x: number; y: number };
  activeTool: 'select' | 'hand';
  layerBounds: Record<string, { x: number; y: number; width: number; height: number; rotation: number }>;
  workspace: WorkspaceLayout;
  inPoint: number | null;
  outPoint: number | null;
  expandedLayerIds: string[];
  playbackRate: number;
  selectedKeyframe: { layerId: string; property: string; index: number } | null;
  openScenes: string[];
  recentScenes: Array<{ id: string; name: string; lastOpened: number }>;
  renderQueue: RenderJobStatus[];
  activeLeftTab: 'layers' | 'scene' | 'assets';
  activeRightTab: 'inspector' | 'caps';
  saveStatus: 'saved' | 'saving' | 'unsaved' | 'failed';
  lastSaved: Date | null;
  dirty: boolean;
  clipboardLayer: unknown | null;
  toasts: Array<{ id: string; message: string; type: 'info' | 'success' | 'warning' | 'error' }>;
  activeModal: string | null;
}

const initialOpenScenes: string[] = (() => {
  try {
    return JSON.parse(localStorage.getItem('motionforge_open_scenes') || '[]');
  } catch {
    return [];
  }
})();

const initialRecentScenes = (() => {
  try {
    return JSON.parse(localStorage.getItem('motionforge_recent_scenes') || '[]');
  } catch {
    return [];
  }
})();

const initialRenderQueue = (() => {
  try {
    return JSON.parse(localStorage.getItem('motionforge_render_queue') || '[]');
  } catch {
    return [];
  }
})();

const defaultEngineUrl =
  (window as unknown as { motionforge?: { engineUrl?: string } }).motionforge?.engineUrl ||
  localStorage.getItem('motionforge_engine') ||
  'http://127.0.0.1:4000';

const defaultWorkspace: WorkspaceLayout = {
  leftPanelWidth: 280,
  rightPanelWidth: 340,
  timelineHeight: 240,
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  timelineCollapsed: false,
};

const initialWorkspace: WorkspaceLayout = (() => {
  try {
    const saved = localStorage.getItem('motionforge_workspace_v1');
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        ...defaultWorkspace,
        ...parsed,
      };
    }
  } catch {}
  return defaultWorkspace;
})();

function persistWorkspace(layout: WorkspaceLayout) {
  try {
    localStorage.setItem('motionforge_workspace_v1', JSON.stringify(layout));
  } catch {}
}

const [state, setState] = createStore<StudioState>({
  engine: { online: false, url: defaultEngineUrl, latencyMs: 0 },
  capabilities: null,
  scene: null,
  sceneId: null,
  selectedLayerId: null,
  selectedLayerIds: [],
  playhead: 0,
  playing: false,
  zoom: 1,
  panOffset: 0,
  timelineScrollY: 0,
  snapEnabled: true,
  viewportZoom: 1,
  viewportPan: { x: 0, y: 0 },
  activeTool: 'select',
  layerBounds: {},
  workspace: initialWorkspace,
  inPoint: null,
  outPoint: null,
  expandedLayerIds: [],
  playbackRate: 1,
  selectedKeyframe: null,
  openScenes: initialOpenScenes,
  recentScenes: initialRecentScenes,
  renderQueue: initialRenderQueue,
  activeLeftTab: 'layers',
  activeRightTab: 'inspector',
  saveStatus: 'saved',
  lastSaved: null,
  dirty: false,
  clipboardLayer: null,
  toasts: [],
  activeModal: null,
});

const undoStack: Array<{
  scene: StudioScene;
  description: string;
  selectedLayerId: string | null;
  layerBounds?: Record<string, { x: number; y: number; width: number; height: number; rotation: number }>;
}> = [];
const redoStack: Array<{
  scene: StudioScene;
  description: string;
  selectedLayerId: string | null;
  layerBounds?: Record<string, { x: number; y: number; width: number; height: number; rotation: number }>;
}> = [];
const maxHistory = 50;

const [historyCount, setHistoryCount] = createSignal({ undo: 0, redo: 0 });

function updateHistoryCount() {
  setHistoryCount({ undo: undoStack.length, redo: redoStack.length });
}

function syncDesktopDirty() {
  const mf = (window as unknown as { motionforge?: { setDirty?: (d: boolean) => void } }).motionforge;
  if (mf?.setDirty) {
    mf.setDirty(Boolean(state.dirty));
  }
}

export const store = {
  state,
  setState,

  syncDesktopDirty,

  pushHistory(description?: string) {
    if (!state.scene) return;
    undoStack.push({
      scene: JSON.parse(JSON.stringify(state.scene)),
      description: description || 'Change scene',
      selectedLayerId: state.selectedLayerId,
      layerBounds: JSON.parse(JSON.stringify(state.layerBounds || {})),
    });
    if (undoStack.length > maxHistory) {
      undoStack.shift();
    }
    redoStack.length = 0;
    updateHistoryCount();
  },

  canUndo() {
    return historyCount().undo > 0;
  },

  canRedo() {
    return historyCount().redo > 0;
  },

  undo(): string | null {
    if (!this.canUndo()) return null;
    const currentSnapshot = {
      scene: JSON.parse(JSON.stringify(state.scene!)),
      description: 'Reverted state',
      selectedLayerId: state.selectedLayerId,
      layerBounds: JSON.parse(JSON.stringify(state.layerBounds || {})),
    };
    redoStack.push(currentSnapshot);

    const prev = undoStack.pop()!;
    setState({
      scene: JSON.parse(JSON.stringify(prev.scene)),
      selectedLayerId: prev.selectedLayerId,
      layerBounds: prev.layerBounds ? JSON.parse(JSON.stringify(prev.layerBounds)) : {},
      dirty: true,
      saveStatus: 'unsaved',
    });
    updateHistoryCount();
    syncDesktopDirty();
    this.executeSave();
    this.addToast(`Undo: ${prev.description}`, 'info');
    return prev.description;
  },

  redo(): string | null {
    if (!this.canRedo()) return null;
    const currentSnapshot = {
      scene: JSON.parse(JSON.stringify(state.scene!)),
      description: 'Current state before redo',
      selectedLayerId: state.selectedLayerId,
      layerBounds: JSON.parse(JSON.stringify(state.layerBounds || {})),
    };
    undoStack.push(currentSnapshot);

    const next = redoStack.pop()!;
    setState({
      scene: JSON.parse(JSON.stringify(next.scene)),
      selectedLayerId: next.selectedLayerId,
      layerBounds: next.layerBounds ? JSON.parse(JSON.stringify(next.layerBounds)) : {},
      dirty: true,
      saveStatus: 'unsaved',
    });
    updateHistoryCount();
    syncDesktopDirty();
    this.executeSave();
    this.addToast(`Redo: ${next.description}`, 'info');
    return next.description;
  },

  mutateScene(mutatorFn: (scene: StudioScene) => void, description?: string) {
    if (!state.scene) return;
    this.pushHistory(description);
    const cloned: StudioScene = JSON.parse(JSON.stringify(state.scene));
    mutatorFn(cloned);
    setState({
      scene: cloned,
      dirty: true,
      saveStatus: 'unsaved',
    });
    syncDesktopDirty();
  },

  addAsset(asset: { id: string; kind: 'image' | 'video' | 'audio' | 'lottie' | 'font'; src: string; name?: string }) {
    if (!state.scene) return;
    this.mutateScene((scene) => {
      if (!scene.assets) scene.assets = [];
      const idx = scene.assets.findIndex((a) => a.id === asset.id);
      if (idx >= 0) {
        scene.assets[idx] = asset;
      } else {
        scene.assets.push(asset);
      }
    }, `Added asset ${asset.id}`);
    this.executeSave();
  },

  setScene(scene: StudioScene | null, sceneId?: string) {
    const sId = sceneId || scene?.id || null;
    const selLayer = scene?.layers?.[0]?.id || null;
    setState({
      scene,
      sceneId: sId,
      selectedLayerId: selLayer,
      selectedLayerIds: selLayer ? [selLayer] : [],
      timelineScrollY: 0,
      dirty: false,
      saveStatus: 'saved',
      lastSaved: new Date(),
    });
    undoStack.length = 0;
    redoStack.length = 0;
    updateHistoryCount();
    syncDesktopDirty();

    if (sId) {
      localStorage.setItem('motionforge_last_scene', sId);
      if (!state.openScenes.includes(sId)) {
        const next = [...state.openScenes, sId].slice(0, 8);
        setState('openScenes', next);
        localStorage.setItem('motionforge_open_scenes', JSON.stringify(next));
      }
      const existingIdx = state.recentScenes.findIndex((r) => r.id === sId);
      const entry = { id: sId, name: scene?.id || sId, lastOpened: Date.now() };
      let updatedRecent = [...state.recentScenes];
      if (existingIdx >= 0) {
        updatedRecent.splice(existingIdx, 1);
      }
      updatedRecent.unshift(entry);
      updatedRecent = updatedRecent.slice(0, 20);
      setState('recentScenes', updatedRecent);
      localStorage.setItem('motionforge_recent_scenes', JSON.stringify(updatedRecent));
    }
  },

  selectLayer(layerId: string | null, isMulti = false) {
    if (!layerId) {
      setState({ selectedLayerId: null, selectedLayerIds: [] });
      return;
    }
    if (isMulti) {
      let ids = [...state.selectedLayerIds];
      if (ids.includes(layerId)) {
        ids = ids.filter((id) => id !== layerId);
      } else {
        ids.push(layerId);
      }
      setState({
        selectedLayerIds: ids,
        selectedLayerId: ids[0] || null,
      });
    } else {
      setState({
        selectedLayerId: layerId,
        selectedLayerIds: [layerId],
      });
    }
  },

  setPlayhead(atMs: number) {
    const dur = state.scene?.durationMs || 10000;
    const clamped = Math.max(0, Math.min(Math.round(atMs), dur));
    setState('playhead', clamped);
  },

  setPlaying(playing: boolean) {
    setState('playing', Boolean(playing));
  },

  setZoom(zoom: number) {
    setState('zoom', Math.max(0.2, Math.min(zoom, 10)));
  },

  setPanOffset(offset: number) {
    setState('panOffset', offset);
  },

  setTimelineScrollY(y: number) {
    setState('timelineScrollY', Math.max(0, Math.round(y)));
  },

  setSnapEnabled(snap: boolean) {
    setState('snapEnabled', snap);
  },

  setActiveLeftTab(tab: 'layers' | 'scene' | 'assets') {
    setState('activeLeftTab', tab);
  },

  setActiveRightTab(tab: 'inspector' | 'caps') {
    setState('activeRightTab', tab);
  },

  setSaveStatus(status: 'saved' | 'saving' | 'unsaved' | 'failed') {
    setState('saveStatus', status);
    if (status === 'saved') {
      setState({ dirty: false, lastSaved: new Date() });
    }
    syncDesktopDirty();
  },

  async executeSave() {
    if (!state.scene) return;
    this.setSaveStatus('saving');
    try {
      const res = await api.createScene(state.scene);
      this.setSaveStatus('saved');
      this.addToast(`Saved scene ${res.id}`, 'success');
      return res;
    } catch (e: unknown) {
      this.setSaveStatus('failed');
      this.addToast(`Save failed: ${(e as Error).message}`, 'error');
      throw e;
    }
  },

  setViewportZoom(zoom: number) {
    setState('viewportZoom', Math.max(0.25, Math.min(4, zoom)));
  },

  setViewportPan(pan: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) {
    if (typeof pan === 'function') {
      setState('viewportPan', pan(state.viewportPan));
    } else {
      setState('viewportPan', pan);
    }
  },

  setActiveTool(tool: 'select' | 'hand') {
    setState('activeTool', tool);
  },

  setLayerBounds(bounds: Record<string, { x: number; y: number; width: number; height: number; rotation: number }>) {
    setState('layerBounds', bounds);
  },

  setLeftPanelWidth(width: number) {
    const clamped = Math.max(180, Math.min(600, Math.round(width)));
    setState('workspace', 'leftPanelWidth', clamped);
    persistWorkspace(state.workspace);
  },

  setRightPanelWidth(width: number) {
    const clamped = Math.max(240, Math.min(650, Math.round(width)));
    setState('workspace', 'rightPanelWidth', clamped);
    persistWorkspace(state.workspace);
  },

  setTimelineHeight(height: number) {
    const clamped = Math.max(140, Math.min(600, Math.round(height)));
    setState('workspace', 'timelineHeight', clamped);
    persistWorkspace(state.workspace);
  },

  toggleLeftPanelCollapsed() {
    setState('workspace', 'leftPanelCollapsed', (prev) => !prev);
    persistWorkspace(state.workspace);
  },

  toggleRightPanelCollapsed() {
    setState('workspace', 'rightPanelCollapsed', (prev) => !prev);
    persistWorkspace(state.workspace);
  },

  toggleTimelineCollapsed() {
    setState('workspace', 'timelineCollapsed', (prev) => !prev);
    persistWorkspace(state.workspace);
  },

  resetWorkspaceLayout() {
    setState('workspace', { ...defaultWorkspace });
    persistWorkspace(state.workspace);
    this.addToast('Reset workspace layout to default', 'info');
  },

  setInPoint(ms: number | null) {
    setState('inPoint', ms);
  },

  setOutPoint(ms: number | null) {
    setState('outPoint', ms);
  },

  toggleLayerExpanded(layerId: string) {
    const list = state.expandedLayerIds;
    if (list.includes(layerId)) {
      setState('expandedLayerIds', list.filter((id) => id !== layerId));
    } else {
      setState('expandedLayerIds', [...list, layerId]);
    }
  },

  setPlaybackRate(rate: number) {
    setState('playbackRate', rate);
  },

  setSelectedKeyframe(kf: { layerId: string; property: string; index: number } | null) {
    setState('selectedKeyframe', kf);
  },

  razorSplitAtPlayhead() {
    const selId = state.selectedLayerId;
    if (!selId || !state.scene) return;
    const playhead = state.playhead;
    const layer = state.scene.layers.find((l) => l.id === selId);
    if (!layer) return;
    const at = layer.at || 0;
    const dur = layer.duration || (state.scene.durationMs - at);
    if (playhead <= at || playhead >= at + dur) return;

    this.mutateScene((scene) => {
      const idx = scene.layers.findIndex((l) => l.id === selId);
      if (idx === -1) return;
      const original = scene.layers[idx];
      const dur1 = playhead - at;
      const dur2 = dur - dur1;

      original.duration = dur1;

      const cloned = JSON.parse(JSON.stringify(original));
      cloned.id = original.id + '_split';
      cloned.name = (original.name || original.id) + ' (2)';
      cloned.at = playhead;
      cloned.duration = dur2;

      scene.layers.splice(idx + 1, 0, cloned);
    }, `Split layer ${selId} at ${playhead}ms`);
  },

  rippleDeleteSelected() {
    const selId = state.selectedLayerId;
    if (!selId || !state.scene) return;
    const layer = state.scene.layers.find((l) => l.id === selId);
    if (!layer) return;
    const at = layer.at || 0;
    const dur = layer.duration || (state.scene.durationMs - at);

    this.mutateScene((scene) => {
      scene.layers = scene.layers.filter((l) => l.id !== selId);
      for (const l of scene.layers) {
        if ((l.at || 0) >= at + dur) {
          l.at = Math.max(0, (l.at || 0) - dur);
        }
      }
    }, `Ripple delete layer ${selId}`);
    setState({ selectedLayerId: null, selectedLayerIds: [] });
  },

  addKeyframe(layerId: string, property: string, atMs: number, value: number | string) {
    this.mutateScene((scene) => {
      const layer = scene.layers.find((l) => l.id === layerId);
      if (!layer) return;
      if (!layer.tracks) layer.tracks = [];
      let track = layer.tracks.find((t: any) => t.property === property);
      if (!track) {
        track = { property, keyframes: [] };
        layer.tracks.push(track);
      }
      const existingIdx = track.keyframes.findIndex((k: any) => Math.abs(k.at - atMs) < 20);
      if (existingIdx !== -1) {
        track.keyframes[existingIdx].value = value;
      } else {
        track.keyframes.push({ at: atMs, value, ease: 'power2.inOut' });
        track.keyframes.sort((a: any, b: any) => a.at - b.at);
      }
    }, `Add keyframe to ${layerId} (${property}) at ${atMs}ms`);
  },

  deleteKeyframe(layerId: string, property: string, index: number) {
    this.mutateScene((scene) => {
      const layer = scene.layers.find((l) => l.id === layerId);
      if (!layer || !layer.tracks) return;
      const track = layer.tracks.find((t: any) => t.property === property);
      if (!track || !track.keyframes) return;
      track.keyframes.splice(index, 1);
      if (track.keyframes.length === 0) {
        layer.tracks = layer.tracks.filter((t: any) => t.property !== property);
      }
    }, `Delete keyframe from ${layerId} (${property})`);
    setState('selectedKeyframe', null);
  },

  setActiveModal(modal: string | null) {
    setState('activeModal', modal);
  },

  addToast(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
    const id = 'toast_' + Math.random().toString(36).slice(2, 9);
    setState('toasts', (prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      this.removeToast(id);
    }, 4000);
  },

  removeToast(id: string) {
    setState('toasts', (prev) => prev.filter((t) => t.id !== id));
  },
};

(window as unknown as { store: typeof store; state: typeof store.state }).store = store;
(window as unknown as { store: typeof store; state: typeof store.state }).state = store.state;
