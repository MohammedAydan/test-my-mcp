import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type {
  KeyframeEasing,
  KeyframeProperty,
  KeyframeTrack,
  LayerFilterKey,
  LayerKeyframe,
} from '@motionforge/scene-spec';
import { api } from '../api.js';
import {
  createLayerPayload,
  FULL_BLEED_NEW_KINDS,
  isNewLayerKind,
  newLayerId,
  type NewLayerKind,
} from '../services/layer-factory.js';
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

/**
 * The bounds the runtime reports for one layer.
 *
 * The box is UNROTATED and the rotation travels beside it as a number, so a
 * consumer never rotates the box twice. `cx`/`cy` are the exact transformed
 * centre in composition pixels — the gizmo is drawn around THAT point.
 */
export interface LayerBounds {
  /** UNROTATED local box LEFT, composition px */
  x: number;
  /** UNROTATED local box TOP, composition px */
  y: number;
  /** VISUAL width (layout width × scaleX), composition px */
  width: number;
  /** VISUAL height (layout height × scaleY), composition px */
  height: number;
  /** unscaled layout width, composition px */
  layoutWidth: number;
  /** unscaled layout height, composition px */
  layoutHeight: number;
  /** exact transformed CENTER x, composition px */
  cx: number;
  /** exact transformed CENTER y, composition px */
  cy: number;
  /** current rotation, degrees */
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface WorkspaceLayout {
  leftPanelWidth: number;
  rightPanelWidth: number;
  timelineHeight: number;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  timelineCollapsed: boolean;
  /**
   * How the LEFT RAIL is split between the Project Bin (top) and the Layer
   * Stack (bottom), as a fraction of the rail's height (0.15 … 0.85).
   *
   * The bin grew until the layer stack was squeezed into ~140px, so the split
   * is now the user's decision rather than a hard-coded layout.
   */
  leftDockSplit: number;
}

export interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

/**
 * One row of the timeline.
 *
 * `index` is the lane number; `layers` are the clips on it. A layer with no
 * explicit `trackIndex` gets its own lane — see `resolveTrackLanes()`.
 */
export interface TrackLane {
  index: number;
  name: string;
  kind: 'video' | 'audio';
  layers: StudioLayer[];
  y: number;
  h: number;
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
  /**
   * The FIELD-LEVEL issues of the last rejected save.
   *
   * A failed save used to be a toast and nothing else — the user was told
   * "Save failed" and never learned WHICH field the engine rejected. The
   * issues are the schema's own strings (`layers.0.variant.blobs: Required`),
   * so the inspector can show the exact path the author has to fix.
   */
  saveIssues: string[];
  /**
   * The AUTO-KEY arm.
   *
   * When it is armed, editing a transform property writes a keyframe at the
   * playhead on the FIRST touch (After Effects semantics) instead of
   * requiring the stopwatch click. It is OFF by default.
   */
  autoKeyArmed: boolean;
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
  leftDockSplit: 0.5,
};

const initialWorkspace = readStorage<WorkspaceLayout>('motionforge_workspace_v2', {
  ...defaultWorkspace,
  leftDockSplit: readStorage<number>('motionforge_left_dock_split', defaultWorkspace.leftDockSplit),
});
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
  saveIssues: [],
  autoKeyArmed: false,
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
 * Turn a rejected save into the FIELD-LEVEL issues the inspector renders.
 *
 * The engine rejects a scene with the schema's own flattened strings
 * (`layers.0.variant.blobs: Required`), so the banner can name the exact
 * path the author has to fix.
 *
 * The issues travel on the error's `issues[]` — but the ELECTRON IPC
 * boundary drops custom properties, so the MESSAGE is the fallback: the
 * engine builds it as `invalid scene: <issue>; <issue>; …`, and this splits
 * it back into one line per issue.
 */
export function describeSaveFailure(err: unknown): string[] {
  const issues = (err as { issues?: unknown } | null)?.issues;
  if (Array.isArray(issues)) {
    const lines = issues
      .map((issue) => {
        if (typeof issue === 'string') return normalizeIssueLine(issue);
        if (issue && typeof issue === 'object') {
          const record = issue as { path?: unknown; message?: unknown };
          const path = Array.isArray(record.path) ? record.path.join('.') : '';
          const message = typeof record.message === 'string' ? record.message : '';
          if (path && message) return `${path}: ${message}`;
          if (message) return message;
        }
        return String(issue);
      })
      .filter((line) => line.length > 0);
    if (lines.length > 0) return lines;
  }
  const message = (err as Error | null)?.message ?? '';
  const parts = message
    .split('; ')
    .map((part) => normalizeIssueLine(part))
    .filter((part) => part.length > 0);
  if (parts.length > 1) return parts;
  return [parts[0] ?? 'The scene was rejected by the engine'];
}

/** Strip the transport prefixes an issue line may carry. */
function normalizeIssueLine(line: string): string {
  return line
    .replace(/^Error invoking remote method[^\n]*?:\s*/, '')
    .replace(/^Error:\s*/, '')
    .replace(/^invalid scene:\s*/, '')
    .trim();
}

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
    void this.executeSave().catch(() => undefined);
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
    void this.executeSave().catch(() => undefined);
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
    // The monitor's fit scale can fall well below 0.25 in a small panel, so
    // the clamp is wide — the monitor keeps its own exact value.
    setState('viewportZoom', Math.max(0.05, Math.min(8, zoom)));
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

  /**
   * Move the horizontal splitter between the Project Bin and the Layer Stack.
   *
   * The fraction is clamped so neither panel can be dragged out of existence,
   * and it is persisted so the split survives a restart.
   */
  setLeftDockSplit(fraction: number): void {
    const clamped = Math.max(0.15, Math.min(0.85, fraction));
    setState('workspace', 'leftDockSplit', clamped);
    writeStorage('motionforge_workspace_v2', state.workspace);
    writeStorage('motionforge_left_dock_split', clamped);
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
   *
   * A REJECTED save is ACTIONABLE: the engine's field-level issues are
   * published into `state.saveIssues` (the inspector renders them in a
   * banner) instead of being swallowed into a toast. The promise still
   * REJECTS, so every `void store.executeSave()` call site must handle it —
   * an unhandled rejection in the console is a defect of its own.
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
      // A layer that runs past the composition end is CLAMPED before the
      // write: its `duration` is shortened so the layer ends exactly at the
      // scene end. The engine rejects such a scene, and a save that always
      // fails is worse than a save that quietly trims the overflow.
      this.clampLayersToCompositionEnd();
      let savedId = '';
      while (this.saveRequested) {
        this.saveRequested = false;
        const snapshot = state.scene;
        if (!snapshot) break;
        const res = await api.createScene(snapshot);
        savedId = res.id;
      }
      this.setSaveStatus('saved');
      setState('saveIssues', []);
      if (savedId) this.addToast(`Saved scene ${savedId}`, 'success');
    } catch (err: unknown) {
      this.setSaveStatus('failed');
      const issues = describeSaveFailure(err);
      setState('saveIssues', issues);
      this.addToast(`Save failed: ${(err as Error).message}`, 'error');
      throw err;
    } finally {
      this.saveInFlight = false;
    }
  },

  /**
   * Shorten every layer that runs past the composition end.
   *
   * THE CHOSEN BEHAVIOUR (the task allows a clamp OR a warning — this is the
   * clamp): the layer's `duration` becomes `scene.durationMs - at`, so the
   * layer ends EXACTLY at the scene end. The toast names the layers that
   * were trimmed, so the change is never silent.
   *
   * Returns the names of the layers that were clamped.
   */
  clampLayersToCompositionEnd(): string[] {
    const scene = state.scene;
    if (!scene) return [];
    const end = Math.max(0, Math.round(scene.durationMs));
    const overflowing: Array<{ id: string; label: string; duration: number }> = [];

    for (const layer of scene.layers) {
      const at = layer.at ?? 0;
      const duration = layer.duration ?? Math.max(0, end - at);
      if (at + duration > end) {
        overflowing.push({
          id: layer.id,
          label: layer.name ?? layer.id,
          duration: Math.max(0, Math.round(end - at)),
        });
      }
    }
    if (overflowing.length === 0) return [];

    this.updateSceneWithoutHistory((draft) => {
      for (const item of overflowing) {
        const layer = draft.layers.find((l) => l.id === item.id);
        if (!layer) continue;
        layer.duration = item.duration;
      }
    });

    const labels = overflowing.map((item) => item.label);
    this.addToast(
      `Clamped ${labels.length} layer(s) to the composition end: ${labels.join(', ')}`,
      'warning'
    );
    return labels;
  },

  /** Clear the rejected-save issues (the banner's dismiss button). */
  clearSaveIssues(): void {
    setState('saveIssues', []);
  },

  /**
   * Arm or disarm the AUTO-KEY.
   *
   * When it is armed, the inspector writes a keyframe at the playhead the
   * FIRST time a transform property is touched — the stopwatch click is not
   * needed. It is OFF by default, so the classic behaviour is unchanged.
   */
  setAutoKeyArmed(armed: boolean): void {
    setState('autoKeyArmed', Boolean(armed));
  },

  /**
   * Insert or update one render job in the global queue.
   *
   * The queue lives in the store, so a render that finishes while the modal
   * is CLOSED still updates the status bar and the command palette.
   */
  upsertRenderJob(job: RenderJobStatus): void {
    const list = [...state.renderQueue];
    const index = list.findIndex((entry) => entry.id === job.id);
    if (index === -1) list.unshift(job);
    else list[index] = { ...list[index], ...job };
    this.setRenderQueue(list);
  },

  /**
   * Update one render job in place.
   *
   * A job the queue does not know about is IGNORED: without its scene and
   * quality there is nothing meaningful to show.
   */
  patchRenderJob(jobId: string, patch: Partial<RenderJobStatus>): void {
    const existing = state.renderQueue.find((entry) => entry.id === jobId);
    if (!existing) return;
    this.upsertRenderJob({ ...existing, ...patch, id: existing.id });
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
    void this.executeSave().catch(() => undefined);
  },

  /* ── layer operations ───────────────────────────────────────────────── */

  /**
   * Create a NEW layer of the given kind.
   *
   * The payload comes from the layer factory, so every kind is created with
   * its OWN schema-valid fields — a `chart` really gets `data`, a `cta`
   * really gets a `label`, and a full-bleed layer really gets an explicit
   * integer `duration` equal to the composition length.
   *
   * Returns the new layer's id, or `null` when the kind is unknown.
   */
  addLayerOfKind(kind: string): string | null {
    return this.addLayerOfKindAt(kind, 50, 50);
  },

  /**
   * Create a layer of `kind` and place it at a point on the canvas.
   *
   * The x/y are PERCENT of the canvas, which is how every layer's anchor is
   * expressed — so the value the canvas hands over (a click in composition
   * pixels) is converted by the caller.
   *
   * This is the path the TEXT TOOL and the CARD TOOL take: the user picks the
   * tool, clicks the canvas, and the layer appears WHERE THEY CLICKED. The
   * tools used to only arm themselves and never create anything, which made
   * them look like they were broken.
   */
  addLayerOfKindAt(kind: string, xPct: number, yPct: number): string | null {
    if (!state.scene) {
      this.addToast('Load a composition before adding layers', 'warning');
      return null;
    }
    if (!isNewLayerKind(kind)) {
      this.addToast(`"${kind}" is not a layer kind this Studio can create`, 'warning');
      return null;
    }
    const id = newLayerId(kind);
    const payload = createLayerPayload(kind, {
      id,
      at: state.playhead,
      durationMs: state.scene.durationMs,
    });
    // a full-bleed kind has no anchor; every other kind is placed where the
    // user clicked
    if (FULL_BLEED_NEW_KINDS.includes(kind as NewLayerKind)) {
      delete (payload as unknown as Record<string, unknown>).position;
    } else {
      (payload as unknown as Record<string, unknown>).position = {
        xPct: Math.max(-300, Math.min(300, Math.round(xPct * 100) / 100)),
        yPct: Math.max(-300, Math.min(300, Math.round(yPct * 100) / 100)),
      };
    }
    this.mutateScene((scene) => {
      scene.layers.push(payload);
    }, `Added ${kind} layer`);
    this.selectLayer(id);
    return id;
  },

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

  /* ── unified keyframes (the flat `layer.keyframes` surface) ────────────── */

  /**
   * The keyframes of one property of one layer, sorted by time.
   *
   * The flat `keyframes` array is the canonical surface; the legacy `tracks`
   * array is still readable by the runtime, but the Studio writes the flat
   * form so a property has ONE timeline in the inspector.
   */
  layerKeyframes(layerId: string, property?: KeyframeProperty): LayerKeyframe[] {
    const layer = state.scene?.layers.find((l) => l.id === layerId);
    const flat = ((layer?.keyframes ?? []) as LayerKeyframe[]).filter(
      (k) => !property || k.property === property
    );
    return [...flat].sort((a, b) => a.timeMs - b.timeMs);
  },

  /** The keyframe on `property` at (or within 20ms of) `timeMs`. */
  findLayerKeyframe(layerId: string, property: KeyframeProperty, timeMs: number): LayerKeyframe | null {
    return (
      this.layerKeyframes(layerId, property).find((k) => Math.abs(k.timeMs - timeMs) < 20) ?? null
    );
  },

  /** True when the property already has a keyframe at the playhead. */
  hasLayerKeyframe(layerId: string, property: KeyframeProperty, timeMs: number): boolean {
    return this.findLayerKeyframe(layerId, property, timeMs) !== null;
  },

  /**
   * Add (or replace) a keyframe at `timeMs`.
   *
   * This is what the inspector's stopwatch button calls.
   *
   * `recordHistory` is false for the AUTO-KEY path: the gesture already
   * pushed ONE undo snapshot, and a second one would make the auto-key a
   * separate undo step from the edit it belongs to.
   */
  setLayerKeyframe(
    layerId: string,
    property: KeyframeProperty,
    timeMs: number,
    value: number,
    easing: KeyframeEasing = 'easeInOut',
    recordHistory = true
  ): void {
    const apply = (scene: StudioScene) => {
      const layer = scene.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const list = ((layer.keyframes ?? []) as LayerKeyframe[]).slice();
      const existing = list.find(
        (k) => k.property === property && Math.abs(k.timeMs - timeMs) < 20
      );
      if (existing) {
        existing.value = value;
        existing.timeMs = Math.round(timeMs);
      } else {
        list.push({
          id: `kf_${property}_${Math.round(timeMs)}_${Math.random().toString(36).slice(2, 6)}`,
          timeMs: Math.round(timeMs),
          property,
          value,
          easing,
        });
      }
      layer.keyframes = list.sort((a, b) => a.timeMs - b.timeMs);
    };
    if (recordHistory) {
      this.mutateScene(apply, `Keyframe ${property} of ${layerId} at ${Math.round(timeMs)}ms`);
    } else {
      this.updateSceneWithoutHistory(apply);
    }
  },

  /** Remove one keyframe. */
  removeLayerKeyframe(layerId: string, keyframeId: string): void {
    this.mutateScene((scene) => {
      const layer = scene.layers.find((l) => l.id === layerId);
      if (!layer || !layer.keyframes) return;
      layer.keyframes = (layer.keyframes as LayerKeyframe[]).filter((k) => k.id !== keyframeId);
    }, `Remove keyframe of ${layerId}`);
  },

  /** Re-time one keyframe. */
  moveLayerKeyframe(layerId: string, keyframeId: string, timeMs: number): void {
    this.updateSceneWithoutHistory((scene) => {
      const layer = scene.layers.find((l) => l.id === layerId);
      if (!layer || !layer.keyframes) return;
      const keyframe = (layer.keyframes as LayerKeyframe[]).find((k) => k.id === keyframeId);
      if (!keyframe) return;
      keyframe.timeMs = Math.round(timeMs);
      layer.keyframes = [...(layer.keyframes as LayerKeyframe[])].sort((a, b) => a.timeMs - b.timeMs);
    });
  },

  /** The next keyframe of `property` strictly after `timeMs`. */
  nextLayerKeyframe(
    layerId: string,
    property: KeyframeProperty,
    timeMs: number
  ): LayerKeyframe | null {
    return (
      this.layerKeyframes(layerId, property).find((k) => k.timeMs > timeMs + 1) ?? null
    );
  },

  /** The previous keyframe of `property` strictly before `timeMs`. */
  prevLayerKeyframe(
    layerId: string,
    property: KeyframeProperty,
    timeMs: number
  ): LayerKeyframe | null {
    const list = this.layerKeyframes(layerId, property);
    for (let i = list.length - 1; i >= 0; i--) {
      const candidate = list[i];
      if (candidate && candidate.timeMs < timeMs - 1) return candidate;
    }
    return null;
  },

  /* ── visual filters ──────────────────────────────────────────────────── */

  /**
   * Set (or clear, with `undefined`) one visual filter on a layer.
   *
   * `filters` is the layer's CSS-filter bag — blur, brightness, contrast,
   * saturate, drop shadow and corner radius.
   */
  setLayerFilter(
    layerId: string,
    key: LayerFilterKey,
    value: number | string | undefined
  ): void {
    this.mutateScene((scene) => {
      const layer = scene.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const filters = { ...((layer.filters ?? {}) as Record<string, unknown>) };
      if (value === undefined) delete filters[key];
      else filters[key] = value;
      layer.filters = filters as never;
    }, `Set ${key} of ${layerId}`);
  },

  /* ── track lanes ──────────────────────────────────────────────────────── */

  /**
   * The deterministic track-lane layout of the timeline.
   *
   * A layer that declares NO `trackIndex` gets its OWN lane — layers are
   * never crammed onto one row. Two clips share a row only when they declare
   * the same `trackIndex` AND their time ranges do not overlap.
   */
  resolveTrackLanes(): TrackLane[] {
    const layers = state.scene?.layers ?? [];
    const declared = state.scene?.trackLanes ?? [];

    // explicit lanes first, in declaration order
    const lanes: TrackLane[] = declared.map((lane, index) => {
      const explicitIndex = (lane as { index?: number }).index;
      return {
        index: typeof explicitIndex === 'number' ? explicitIndex : index,
        name: lane.name ?? `V${index + 1}`,
        kind: lane.kind === 'audio' ? 'audio' : 'video',
        layers: [],
        y: 0,
        h: 0,
      };
    });

    const laneFor = (index: number): TrackLane => {
      let lane = lanes.find((l) => l.index === index);
      if (!lane) {
        lane = { index, name: `V${index + 1}`, kind: 'video', layers: [], y: 0, h: 0 };
        lanes.push(lane);
      }
      return lane;
    };

    // A free lane index — never an index that is already taken, so two
    // OVERLAPPING clips can never land on the same row.
    let nextLaneIndex = lanes.reduce((max, lane) => Math.max(max, lane.index), -1) + 1;
    const allocLane = (): TrackLane => {
      while (lanes.some((lane) => lane.index === nextLaneIndex)) nextLaneIndex++;
      return laneFor(nextLaneIndex++);
    };

    for (const layer of layers) {
      const explicit = layer.trackIndex;
      if (typeof explicit === 'number') {
        laneFor(explicit).layers.push(layer);
        continue;
      }
      // NO explicit lane → the layer gets its OWN dedicated row. Two clips
      // only share a row when they declare the same `trackIndex` AND their
      // time ranges do not overlap.
      allocLane().layers.push(layer);
    }

    for (const lane of lanes) lane.layers.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    return lanes.sort((a, b) => a.index - b.index);
  },

  /**
   * Move a clip on the timeline.
   *
   * A clip's keyframes travel WITH it (Premiere behaviour): the keyframes are
   * absolute scene times, so leaving them behind would strand them outside the
   * clip's window — unreachable from the timeline and no longer animating the
   * layer. The whole set shifts by the same delta.
   */
  moveClip(layerId: string, newAt: number, recordHistory = true): void {
    const apply = (scene: StudioScene) => {
      const layer = scene.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const from = layer.at ?? 0;
      const delta = Math.round(newAt) - from;
      layer.at = Math.round(newAt);
      if (delta === 0) return;
      if (layer.keyframes && layer.keyframes.length > 0) {
        layer.keyframes = (layer.keyframes as LayerKeyframe[]).map((k) => ({
          ...k,
          timeMs: Math.max(0, Math.round(k.timeMs + delta)),
        }));
      }
      if (layer.tracks && layer.tracks.length > 0) {
        layer.tracks = (layer.tracks as KeyframeTrack[]).map((track) => ({
          ...track,
          keyframes: track.keyframes.map((k) => ({
            ...k,
            at: Math.max(0, Math.round(k.at + delta)),
          })),
        }));
      }
    };
    if (recordHistory) {
      this.mutateScene(apply, `Move clip ${layerId}`);
    } else {
      this.updateSceneWithoutHistory(apply);
    }
  },

  /** Reassign a clip to another video track. */
  moveClipToTrack(layerId: string, trackIndex: number): void {
    this.mutateScene((scene) => {
      const layer = scene.layers.find((l) => l.id === layerId);
      if (!layer) return;
      layer.trackIndex = Math.max(0, Math.round(trackIndex));
    }, `Move ${layerId} to track V${trackIndex + 1}`);
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

  /**
   * Publish the render queue to the store.
   *
   * The Render Queue modal used to keep its queue in a LOCAL signal, so
   * `state.renderQueue` stayed `0` forever: nothing outside the modal (the
   * status bar, the command palette, an automation) could see that a render
   * was running. The modal is now the WRITER and the store the single
   * source of truth.
   */
  setRenderQueue(queue: RenderJobStatus[]): void {
    setState('renderQueue', queue);
    writeStorage('motionforge_render_queue', queue);
  },

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
