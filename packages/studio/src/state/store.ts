import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { KeyframeTrack } from '@motionforge/scene-spec';
import { api } from '../api.js';
import type {
  AssetVaultItem,
  CapabilitiesResponse,
  RenderJobStatus,
  StudioLayer,
  StudioScene,
} from '../types.js';

/**
 * The Studio's reactive store.
 *
 * ONE store, ONE direction of flow:
 *
 *     component → named action → store → service → engine
 *
 * Components never call `setState` with a nested path: they call a named
 * action, so history, dirty-tracking and the auto-save all stay consistent
 * and every mutation has exactly one place to be reasoned about.
 */

export type ActiveTool = 'select' | 'hand' | 'razor' | 'text' | 'shape' | 'zoom';

export type WorkspacePreset = 'editing' | 'motion' | 'audio' | 'effects' | 'export';

export interface LayerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface WorkspaceLayout {
  leftPanelWidth: number;
  rightPanelWidth: number;
  timelineHeight: number;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  timelineCollapsed: boolean;
}

export interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
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
  playbackRate: number;
  zoom: number;
  panOffset: number;
  timelineScrollY: number;
  snapEnabled: boolean;
  viewportZoom: number;
  viewportPan: { x: number; y: number };
  activeTool: ActiveTool;
  layerBounds: Record<string, LayerBounds>;
  workspace: WorkspaceLayout;
  workspacePreset: WorkspacePreset;
  activePanelId: string | null;
  maximizedPanelId: string | null;
  inPoint: number | null;
  outPoint: number | null;
  expandedLayerIds: string[];
  selectedKeyframe: { layerId: string; property: string; index: number } | null;
  openScenes: string[];
  recentScenes: Array<{ id: string; name: string; lastOpened: number }>;
  renderQueue: RenderJobStatus[];
  saveStatus: 'saved' | 'saving' | 'unsaved' | 'failed';
  lastSaved: Date | null;
  dirty: boolean;
  toasts: Toast[];
  activeModal: string | null;
}

/* ── persistence helpers ───────────────────────────────────────────────── */

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    // an array fallback must stay an array — spreading one into an object
    // would turn `['a']` into `{0: 'a'}` and break every `.includes()` call
    if (Array.isArray(fallback)) {
      return (Array.isArray(parsed) ? parsed : fallback) as T;
    }
    if (parsed === null || typeof parsed !== 'object') return fallback;
    return { ...fallback, ...(parsed as object) } as T;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be unavailable — the layout is a convenience, not a contract */
  }
}

const defaultWorkspace: WorkspaceLayout = {
  leftPanelWidth: 280,
  rightPanelWidth: 340,
  timelineHeight: 250,
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  timelineCollapsed: false,
};

const initialWorkspace = readStorage<WorkspaceLayout>('motionforge_workspace_v2', defaultWorkspace);
const initialOpenScenes = readStorage<string[]>('motionforge_open_scenes', []);
const initialRecentScenes = readStorage<Array<{ id: string; name: string; lastOpened: number }>>(
  'motionforge_recent_scenes',
  []
);
const initialRenderQueue = readStorage<RenderJobStatus[]>('motionforge_render_queue', []);

/* ── the store ─────────────────────────────────────────────────────────── */

const [state, setState] = createStore<StudioState>({
  engine: { online: true, url: 'in-process', latencyMs: 0 },
  capabilities: null,
  scene: null,
  sceneId: null,
  selectedLayerId: null,
  selectedLayerIds: [],
  playhead: 0,
  playing: false,
  playbackRate: 1,
  zoom: 1,
  panOffset: 0,
  timelineScrollY: 0,
  snapEnabled: true,
  viewportZoom: 1,
  viewportPan: { x: 0, y: 0 },
  activeTool: 'select',
  layerBounds: {},
  workspace: initialWorkspace,
  workspacePreset: 'editing',
  activePanelId: null,
  maximizedPanelId: null,
  inPoint: null,
  outPoint: null,
  expandedLayerIds: [],
  selectedKeyframe: null,
  openScenes: initialOpenScenes,
  recentScenes: initialRecentScenes,
  renderQueue: initialRenderQueue,
  saveStatus: 'saved',
  lastSaved: null,
  dirty: false,
  toasts: [],
  activeModal: null,
});

interface HistoryEntry {
  scene: StudioScene;
  description: string;
  selectedLayerId: string | null;
  layerBounds: Record<string, LayerBounds>;
}

const undoStack: HistoryEntry[] = [];
const redoStack: HistoryEntry[] = [];
const maxHistory = 50;
const [historyCount, setHistoryCount] = createSignal({ undo: 0, redo: 0 });

function updateHistoryCount(): void {
  setHistoryCount({ undo: undoStack.length, redo: redoStack.length });
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Reconcile the layer objects of a freshly cloned scene against the previous
 * one, KEEPING THE IDENTITY of every layer that did not change.
 *
 * A full JSON clone replaces every layer object. Solid's `<For>` keys on the
 * item reference, so that would tear down and rebuild every row of the layer
 * stack on every keystroke — and during a 60fps drag it would rebuild a row
 * per frame. Keeping the identity of the unchanged layers lets `<For>` reuse
 * their DOM.
 */
function reconcileLayers(previous: StudioScene, next: StudioScene): StudioScene {
  const before = previous.layers;
  next.layers = next.layers.map((layer, index) => {
    const source = before[index];
    if (!source) return layer;
    return JSON.stringify(source) === JSON.stringify(layer) ? source : layer;
  });
  return next;
}

function syncDesktopDirty(): void {
  const mf = (window as unknown as { motionforge?: { setDirty?: (d: boolean) => void } }).motionforge;
  mf?.setDirty?.(Boolean(state.dirty));
}

function snapshot(): HistoryEntry {
  return {
    scene: clone(state.scene!),
    description: 'Change scene',
    selectedLayerId: state.selectedLayerId,
    layerBounds: clone(state.layerBounds || {}),
  };
}

export const store = {
  state,
  setState,

  /** the number of undo/redo steps available (for the toolbar badges) */
  historyCount,

  /** true while a save is on the wire */
  saveInFlight: false,
  /** true when a newer scene arrived while a save was running */
  saveRequested: false,

  syncDesktopDirty,

  /* ── history ────────────────────────────────────────────────────────── */

  pushHistory(description?: string): void {
    if (!state.scene) return;
    const entry = snapshot();
    entry.description = description || 'Change scene';
    undoStack.push(entry);
    if (undoStack.length > maxHistory) undoStack.shift();
    redoStack.length = 0;
    updateHistoryCount();
  },

  canUndo(): boolean {
    return historyCount().undo > 0;
  },

  canRedo(): boolean {
    return historyCount().redo > 0;
  },

  undo(): string | null {
    if (!this.canUndo() || !state.scene) return null;
    redoStack.push(snapshot());
    const prev = undoStack.pop()!;
    setState({
      scene: clone(prev.scene),
      selectedLayerId: prev.selectedLayerId,
      selectedLayerIds: prev.selectedLayerId ? [prev.selectedLayerId] : [],
      layerBounds: clone(prev.layerBounds),
      dirty: true,
      saveStatus: 'unsaved',
    });
    updateHistoryCount();
    syncDesktopDirty();
    void this.executeSave();
    this.addToast(`Undo: ${prev.description}`, 'info');
    return prev.description;
  },

  redo(): string | null {
    if (!this.canRedo() || !state.scene) return null;
    undoStack.push(snapshot());
    const next = redoStack.pop()!;
    setState({
      scene: clone(next.scene),
      selectedLayerId: next.selectedLayerId,
      selectedLayerIds: next.selectedLayerId ? [next.selectedLayerId] : [],
      layerBounds: clone(next.layerBounds),
      dirty: true,
      saveStatus: 'unsaved',
    });
    updateHistoryCount();
    syncDesktopDirty();
    void this.executeSave();
    this.addToast(`Redo: ${next.description}`, 'info');
    return next.description;
  },

  /* ── scene mutation ─────────────────────────────────────────────────── */

  /**
   * Mutate the scene, recording one undo entry.
   *
   * This is the ONLY way a component changes the scene.
   */
  mutateScene(mutatorFn: (scene: StudioScene) => void, description?: string): void {
    if (!state.scene) return;
    this.pushHistory(description);
    const cloned = clone(state.scene);
    mutatorFn(cloned);
    setState({
      scene: reconcileLayers(state.scene, cloned),
      dirty: true,
      saveStatus: 'unsaved',
    });
    syncDesktopDirty();
  },

  /**
   * Mutate the scene WITHOUT recording an undo entry.
   *
   * Used during a continuous gesture (a drag): the caller pushes ONE history
   * entry at gesture start and saves once at gesture end.
   */
  updateSceneWithoutHistory(mutatorFn: (scene: StudioScene) => void): void {
    if (!state.scene) return;
    const cloned = clone(state.scene);
    mutatorFn(cloned);
    setState({
      scene: reconcileLayers(state.scene, cloned),
      dirty: true,
      saveStatus: 'unsaved',
    });
    syncDesktopDirty();
  },

  /** Patch one layer by id. */
  updateLayer(
    layerId: string,
    patch: Partial<StudioLayer>,
    description?: string,
    recordHistory = true
  ): void {
    const apply = (scene: StudioScene) => {
      const layer = scene.layers.find((l) => l.id === layerId);
      if (!layer) return;
      Object.assign(layer, patch);
    };
    if (recordHistory) {
      this.mutateScene(apply, description ?? `Edit layer ${layerId}`);
    } else {
      this.updateSceneWithoutHistory(apply);
    }
  },

  /**
   * Fast, IN-PLACE patch of one layer.
   *
   * This is the 60fps path: it writes straight into the reactive store
   * instead of cloning the whole scene, so a drag stays smooth. It does NOT
   * record history and does NOT save — the caller pushes one history entry at
   * gesture start and saves once at gesture end.
   */
  patchLayer(layerId: string, patch: Partial<StudioLayer>): void {
    const scene = state.scene;
    if (!scene) return;
    const index = scene.layers.findIndex((l) => l.id === layerId);
    if (index === -1) return;
    // write the LEAVES, not the object: replacing the layer object would
    // change its identity and make Solid's `<For>` rebuild the row on every
    // frame of a drag.
    for (const [key, value] of Object.entries(patch)) {
      setState('scene', 'layers', index, key, value as never);
    }
    setState({ dirty: true, saveStatus: 'unsaved' });
    syncDesktopDirty();
  },

  /* ── selection ──────────────────────────────────────────────────────── */

  selectLayer(layerId: string | null, isMulti = false): void {
    if (!layerId) {
      setState({ selectedLayerId: null, selectedLayerIds: [] });
      return;
    }
    if (isMulti) {
      const ids = state.selectedLayerIds.includes(layerId)
        ? state.selectedLayerIds.filter((id) => id !== layerId)
        : [...state.selectedLayerIds, layerId];
      setState({ selectedLayerIds: ids, selectedLayerId: ids[0] ?? null });
    } else {
      setState({ selectedLayerId: layerId, selectedLayerIds: [layerId] });
    }
  },

  /* ── transport ──────────────────────────────────────────────────────── */

  setPlayhead(atMs: number): void {
    const dur = state.scene?.durationMs ?? 10000;
    setState('playhead', Math.max(0, Math.min(Math.round(atMs), dur)));
  },

  setPlaying(playing: boolean): void {
    setState('playing', Boolean(playing));
  },

  setPlaybackRate(rate: number): void {
    setState('playbackRate', rate);
  },

  setInPoint(ms: number | null): void {
    setState('inPoint', ms);
  },

  setOutPoint(ms: number | null): void {
    setState('outPoint', ms);
  },

  /* ── tools & view ───────────────────────────────────────────────────── */

  setActiveTool(tool: ActiveTool): void {
    setState('activeTool', tool);
  },

  setSnapEnabled(snap: boolean): void {
    setState('snapEnabled', snap);
  },

  setZoom(zoom: number): void {
    setState('zoom', Math.max(0.2, Math.min(zoom, 12)));
  },

  setPanOffset(offset: number): void {
    setState('panOffset', offset);
  },

  setTimelineScrollY(y: number): void {
    setState('timelineScrollY', Math.max(0, Math.round(y)));
  },

  setViewportZoom(zoom: number): void {
    setState('viewportZoom', Math.max(0.25, Math.min(4, zoom)));
  },

  setViewportPan(pan: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })): void {
    if (typeof pan === 'function') {
      setState('viewportPan', pan(state.viewportPan));
    } else {
      setState('viewportPan', pan);
    }
  },

  setLayerBounds(bounds: Record<string, LayerBounds>): void {
    setState('layerBounds', bounds);
  },

  /* ── panels & workspace ─────────────────────────────────────────────── */

  setActivePanel(id: string | null): void {
    setState('activePanelId', id);
  },

  /**
   * Maximise (or restore) a panel.
   *
   * The Premiere Pro shortcut is the backquote key (`` ` ``); the same action
   * is bound to a double-click on the panel's tab bar.
   */
  toggleMaximizedPanel(id: string): void {
    setState('maximizedPanelId', state.maximizedPanelId === id ? null : id);
  },

  setWorkspacePreset(preset: WorkspacePreset): void {
    setState('workspacePreset', preset);
  },

  setLeftPanelWidth(width: number): void {
    const clamped = Math.max(200, Math.min(600, Math.round(width)));
    setState('workspace', 'leftPanelWidth', clamped);
    writeStorage('motionforge_workspace_v2', state.workspace);
  },

  setRightPanelWidth(width: number): void {
    const clamped = Math.max(260, Math.min(650, Math.round(width)));
    setState('workspace', 'rightPanelWidth', clamped);
    writeStorage('motionforge_workspace_v2', state.workspace);
  },

  setTimelineHeight(height: number): void {
    const clamped = Math.max(140, Math.min(700, Math.round(height)));
    setState('workspace', 'timelineHeight', clamped);
    writeStorage('motionforge_workspace_v2', state.workspace);
  },

  toggleLeftPanelCollapsed(): void {
    setState('workspace', 'leftPanelCollapsed', (prev) => !prev);
    writeStorage('motionforge_workspace_v2', state.workspace);
  },

  toggleRightPanelCollapsed(): void {
    setState('workspace', 'rightPanelCollapsed', (prev) => !prev);
    writeStorage('motionforge_workspace_v2', state.workspace);
  },

  toggleTimelineCollapsed(): void {
    setState('workspace', 'timelineCollapsed', (prev) => !prev);
    writeStorage('motionforge_workspace_v2', state.workspace);
  },

  resetWorkspaceLayout(): void {
    setState('workspace', { ...defaultWorkspace });
    writeStorage('motionforge_workspace_v2', defaultWorkspace);
    this.addToast('Workspace layout reset', 'info');
  },

  /* ── scene lifecycle ────────────────────────────────────────────────── */

  setScene(scene: StudioScene | null, sceneId?: string): void {
    const sId = sceneId || scene?.id || null;
    const selLayer = scene?.layers?.[0]?.id ?? null;
    setState({
      scene,
      sceneId: sId,
      selectedLayerId: selLayer,
      selectedLayerIds: selLayer ? [selLayer] : [],
      timelineScrollY: 0,
      playhead: 0,
      dirty: false,
      saveStatus: 'saved',
      lastSaved: new Date(),
    });
    undoStack.length = 0;
    redoStack.length = 0;
    updateHistoryCount();
    syncDesktopDirty();

    if (sId) {
      writeStorage('motionforge_last_scene', sId);
      if (!state.openScenes.includes(sId)) {
        const next = [...state.openScenes, sId].slice(-8);
        setState('openScenes', next);
        writeStorage('motionforge_open_scenes', next);
      }
      const entry = { id: sId, name: scene?.name || sId, lastOpened: Date.now() };
      const updated = [entry, ...state.recentScenes.filter((r) => r.id !== sId)].slice(0, 20);
      setState('recentScenes', updated);
      writeStorage('motionforge_recent_scenes', updated);
    }
  },

  setSaveStatus(status: StudioState['saveStatus']): void {
    setState('saveStatus', status);
    if (status === 'saved') {
      setState({ dirty: false, lastSaved: new Date() });
    }
    syncDesktopDirty();
  },

  /**
   * Persist the scene.
   *
   * Saves are SERIALIZED. Two concurrent saves would race, and the older one
   * could land last — leaving the disk holding a stale scene while the UI
   * shows a newer one. Instead, a save request while a save is in flight is
   * coalesced into a follow-up pass that writes the NEWEST content.
   */
  async executeSave(): Promise<void> {
    if (!state.scene) return;
    this.saveRequested = true;
    if (this.saveInFlight) {
      // the running loop picks the request up when it finishes
      return;
    }
    this.saveInFlight = true;
    this.setSaveStatus('saving');
    try {
      let savedId = '';
      while (this.saveRequested) {
        this.saveRequested = false;
        const snapshot = state.scene;
        if (!snapshot) break;
        const res = await api.createScene(snapshot);
        savedId = res.id;
      }
      this.setSaveStatus('saved');
      if (savedId) this.addToast(`Saved scene ${savedId}`, 'success');
    } catch (err: unknown) {
      this.setSaveStatus('failed');
      this.addToast(`Save failed: ${(err as Error).message}`, 'error');
      throw err;
    } finally {
      this.saveInFlight = false;
    }
  },

  /* ── assets ─────────────────────────────────────────────────────────── */

  addAsset(asset: { id: string; kind: 'image' | 'video' | 'audio' | 'lottie'; src: string; name?: string; mime?: string }): void {
    if (!state.scene) return;
    this.mutateScene((scene) => {
      if (!scene.assets) scene.assets = [];
      const idx = scene.assets.findIndex((a) => a.id === asset.id);
      if (idx >= 0) scene.assets[idx] = asset;
      else scene.assets.push(asset);
    }, `Added asset ${asset.id}`);
    void this.executeSave();
  },

  /* ── layer operations ───────────────────────────────────────────────── */

  toggleLayerVisibility(layerId: string): void {
    this.mutateScene((scene) => {
      const layer = scene.layers.find((l) => l.id === layerId);
      if (!layer) return;
      layer.visible = layer.visible === false;
    }, `Toggle visibility of ${layerId}`);
  },

  toggleLayerLock(layerId: string): void {
    this.mutateScene((scene) => {
      const layer = scene.layers.find((l) => l.id === layerId);
      if (!layer) return;
      layer.locked = !layer.locked;
    }, `Toggle lock of ${layerId}`);
  },

  renameLayer(layerId: string, name: string): void {
    this.mutateScene((scene) => {
      const layer = scene.layers.find((l) => l.id === layerId);
      if (!layer) return;
      layer.name = name;
    }, `Rename layer ${layerId}`);
  },

  moveLayer(layerId: string, direction: 'up' | 'down'): void {
    this.mutateScene((scene) => {
      const idx = scene.layers.findIndex((l) => l.id === layerId);
      if (idx === -1) return;
      const target = direction === 'up' ? idx + 1 : idx - 1;
      if (target < 0 || target >= scene.layers.length) return;
      const [moved] = scene.layers.splice(idx, 1);
      if (moved) scene.layers.splice(target, 0, moved);
    }, `Move layer ${layerId} ${direction}`);
  },

  reorderLayer(from: number, to: number): void {
    this.mutateScene((scene) => {
      if (from === to) return;
      const [moved] = scene.layers.splice(from, 1);
      if (moved) scene.layers.splice(to, 0, moved);
    }, `Reorder layer`);
  },

  duplicateLayer(layerId: string): string | null {
    if (!state.scene) return null;
    let newId: string | null = null;
    this.mutateScene((scene) => {
      const layer = scene.layers.find((l) => l.id === layerId);
      if (!layer) return;
      let candidate = `${layer.id}-copy`;
      let counter = 1;
      while (scene.layers.some((l) => l.id === candidate)) {
        candidate = `${layer.id}-copy-${counter++}`;
      }
      const copy = clone(layer);
      copy.id = candidate;
      copy.at = (layer.at ?? 0) + 100;
      scene.layers.push(copy);
      newId = candidate;
    }, `Duplicate layer ${layerId}`);
    if (newId) this.selectLayer(newId);
    return newId;
  },

  deleteLayer(layerId: string): void {
    this.mutateScene((scene) => {
      scene.layers = scene.layers.filter((l) => l.id !== layerId);
    }, `Delete layer ${layerId}`);
    if (state.selectedLayerId === layerId) {
      this.selectLayer(state.scene?.layers?.[0]?.id ?? null);
    }
  },

  rippleDeleteSelected(): void {
    const selId = state.selectedLayerId;
    if (!selId || !state.scene) return;
    const layer = state.scene.layers.find((l) => l.id === selId);
    if (!layer) return;
    const at = layer.at ?? 0;
    const dur = layer.duration ?? (state.scene.durationMs - at);
    this.mutateScene((scene) => {
      scene.layers = scene.layers.filter((l) => l.id !== selId);
      for (const l of scene.layers) {
        if ((l.at ?? 0) >= at + dur) {
          l.at = Math.max(0, (l.at ?? 0) - dur);
        }
      }
    }, `Ripple delete layer ${selId}`);
    this.selectLayer(null);
  },

  /* ── razor ──────────────────────────────────────────────────────────── */

  /**
   * Split a layer at an exact millisecond.
   *
   * The two halves are independent clips: the first keeps the id, the second
   * gets a `_split` suffix, and both are clamped to the scene bounds.
   */
  razorSplitLayerAt(layerId: string, atMs: number): boolean {
    if (!state.scene) return false;
    const layer = state.scene.layers.find((l) => l.id === layerId);
    if (!layer) return false;
    const start = layer.at ?? 0;
    const dur = layer.duration ?? (state.scene.durationMs - start);
    if (atMs <= start + 20 || atMs >= start + dur - 20) return false;

    this.mutateScene((scene) => {
      const idx = scene.layers.findIndex((l) => l.id === layerId);
      if (idx === -1) return;
      const original = scene.layers[idx];
      if (!original) return;
      const first = Math.round(atMs - start);
      const second = Math.round(dur - first);
      original.duration = first;
      const copy = clone(original);
      copy.id = `${original.id}_split${Date.now().toString(36).slice(-3)}`;
      copy.name = `${original.name || original.id} (2)`;
      copy.at = Math.round(atMs);
      copy.duration = second;
      scene.layers.splice(idx + 1, 0, copy);
    }, `Split layer ${layerId} at ${Math.round(atMs)}ms`);
    return true;
  },

  /** Split the selected layer at the playhead. */
  razorSplitAtPlayhead(): boolean {
    const selId = state.selectedLayerId;
    if (!selId) return false;
    return this.razorSplitLayerAt(selId, state.playhead);
  },

  /* ── keyframes ──────────────────────────────────────────────────────── */

  addKeyframe(layerId: string, property: string, atMs: number, value: number | string): void {
    this.mutateScene((scene) => {
      const layer = scene.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const tracks = (layer.tracks ?? []) as KeyframeTrack[];
      if (!layer.tracks) layer.tracks = tracks;
      let track = tracks.find((t) => t.property === property);
      if (!track) {
        track = { property, keyframes: [] };
        tracks.push(track);
      }
      const existing = track.keyframes.findIndex((k) => Math.abs(k.at - atMs) < 20);
      if (existing !== -1) {
        const keyframe = track.keyframes[existing];
        if (keyframe) keyframe.value = value;
      } else {
        track.keyframes.push({ at: atMs, value, ease: 'power2.inOut' });
        track.keyframes.sort((a, b) => a.at - b.at);
      }
    }, `Add keyframe to ${layerId} (${property}) at ${atMs}ms`);
  },

  /**
   * Move one keyframe in time.
   *
   * A drag calls this on every pointer move, so it must NOT push an undo
   * entry per frame — the caller pushes one at gesture start.
   */
  setKeyframeAt(layerId: string, property: string, index: number, atMs: number): void {
    this.updateSceneWithoutHistory((scene) => {
      const layer = scene.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const tracks = (layer.tracks ?? []) as KeyframeTrack[];
      const track = tracks.find((t) => t.property === property);
      if (!track) return;
      const keyframe = track.keyframes[index];
      if (!keyframe) return;
      keyframe.at = atMs;
      track.keyframes.sort((a, b) => a.at - b.at);
    });
  },

  deleteKeyframe(layerId: string, property: string, index: number): void {
    this.mutateScene((scene) => {
      const layer = scene.layers.find((l) => l.id === layerId);
      if (!layer || !layer.tracks) return;
      const tracks = layer.tracks as KeyframeTrack[];
      const track = tracks.find((t) => t.property === property);
      if (!track || !track.keyframes) return;
      track.keyframes.splice(index, 1);
      if (track.keyframes.length === 0) {
        layer.tracks = tracks.filter((t) => t.property !== property);
      }
    }, `Delete keyframe from ${layerId} (${property})`);
    setState('selectedKeyframe', null);
  },

  toggleLayerExpanded(layerId: string): void {
    const list = state.expandedLayerIds;
    setState(
      'expandedLayerIds',
      list.includes(layerId) ? list.filter((id) => id !== layerId) : [...list, layerId]
    );
  },

  setSelectedKeyframe(kf: { layerId: string; property: string; index: number } | null): void {
    setState('selectedKeyframe', kf);
  },

  /* ── chrome ─────────────────────────────────────────────────────────── */

  setActiveModal(modal: string | null): void {
    setState('activeModal', modal);
  },

  addToast(message: string, type: Toast['type'] = 'info'): void {
    const id = `toast_${Math.random().toString(36).slice(2, 9)}`;
    setState('toasts', (prev) => [...prev, { id, message, type }]);
    setTimeout(() => this.removeToast(id), 4000);
  },

  removeToast(id: string): void {
    setState('toasts', (prev) => prev.filter((t) => t.id !== id));
  },
};

if (typeof window !== 'undefined') {
  (window as unknown as { store: typeof store; state: typeof store.state }).store = store;
  (window as unknown as { store: typeof store; state: typeof store.state }).state = store.state;
}

export type { AssetVaultItem, CapabilitiesResponse, RenderJobStatus, StudioLayer, StudioScene };
