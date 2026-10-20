import { store } from '../state/store.js';
import type { StudioScene } from '../types.js';
import { api } from '../api.js';

/**
 * The command registry.
 *
 * ONE registry, three views: the application menu bar, the command palette
 * (`Ctrl+K`) and the keyboard-shortcuts map are all projections of this list.
 * A menu entry can therefore never be a dead button, and a documented
 * shortcut can never drift from the command it claims to run.
 */

export type CommandCategory =
  | 'File'
  | 'Edit'
  | 'Composition'
  | 'Layer'
  | 'Timeline'
  | 'View'
  | 'Window'
  | 'Help';

export interface Command {
  id: string;
  title: string;
  category: CommandCategory;
  shortcut?: string;
  run: () => void | Promise<void>;
}

/** A brand-new composition: a dark background and a title. */
export function createDefaultScene(): StudioScene {
  return {
    schemaVersion: 1,
    id: `scene-${Date.now().toString(36)}`,
    name: 'Untitled Composition',
    canvas: { shape: '16:9', scale: 1080 },
    durationMs: 8000,
    assets: [],
    fonts: [],
    layers: [
      {
        id: 'bg',
        type: 'background',
        variant: { variant: 'solid', color: '#05070d' },
        at: 0,
      },
      {
        id: 'title',
        type: 'kineticText',
        at: 400,
        duration: 4000,
        text: 'Untitled Composition',
        sizePx: 120,
        position: { xPct: 50, yPct: 45 },
        fill: '#ffffff',
        animateBy: 'word',
        entrance: { name: 'springPop', durationMs: 900 },
        exit: { name: 'scaleDownFade', durationMs: 600 },
      },
    ],
    camera: { keyframes: [{ at: 0, scale: 1, xPct: 50, yPct: 50 }] },
  };
}

async function newScene(): Promise<void> {
  const scene = createDefaultScene();
  try {
    const res = await api.createScene(scene);
    store.setScene({ ...scene, id: res.id }, res.id);
    store.addToast('New composition created', 'success');
  } catch (err) {
    store.addToast(`Could not create composition: ${(err as Error).message}`, 'error');
  }
}

async function saveScene(): Promise<void> {
  try {
    await store.executeSave();
  } catch {
    /* the store already reported the failure */
  }
}

async function renderScene(quality: 'draft' | 'production'): Promise<void> {
  if (!store.state.sceneId) {
    store.addToast('Load a composition before rendering', 'warning');
    return;
  }
  try {
    const res = await api.startRender(store.state.sceneId, quality);
    store.addToast(`Render queued (job ${res.jobId})`, 'success');
    store.setActiveModal('render');
  } catch (err) {
    store.addToast(`Render failed to start: ${(err as Error).message}`, 'error');
  }
}

function toggleMaximizedPanel(): void {
  const active = store.state.activePanelId;
  if (!active) {
    store.addToast('Focus a panel first (click its header)', 'info');
    return;
  }
  store.toggleMaximizedPanel(active);
}

export const commands: Command[] = [
  /* ── File ─────────────────────────────────────────────────────────────── */
  { id: 'file.new', title: 'New Composition', category: 'File', shortcut: 'Ctrl+N', run: newScene },
  {
    id: 'file.open',
    title: 'Open Composition…',
    category: 'File',
    shortcut: 'Ctrl+O',
    run: () => store.setActiveModal('load'),
  },
  { id: 'file.save', title: 'Save Composition', category: 'File', shortcut: 'Ctrl+S', run: saveScene },
  {
    id: 'file.save-as',
    title: 'Save Project As…',
    category: 'File',
    shortcut: 'Ctrl+Shift+S',
    run: async () => {
      const mf = window.motionforge;
      if (!mf?.saveProjectFile) {
        store.addToast('Saving a project file requires the desktop shell', 'warning');
        return;
      }
      const content = store.state.scene ? JSON.stringify(store.state.scene, null, 2) : '';
      const res = await mf.saveProjectFile({ content, defaultPath: 'project.mfproj' });
      if (!res.canceled) store.addToast(`Project written to ${res.filePath}`, 'success');
    },
  },
  {
    id: 'file.render-draft',
    title: 'Render Draft (720p / 30fps)',
    category: 'File',
    run: () => renderScene('draft'),
  },
  {
    id: 'file.render-production',
    title: 'Render Production (1080p / 60fps)',
    category: 'File',
    run: () => renderScene('production'),
  },
  {
    id: 'file.export',
    title: 'Render Queue…',
    category: 'File',
    shortcut: 'Ctrl+Q',
    run: () => store.setActiveModal('render'),
  },

  /* ── Edit ─────────────────────────────────────────────────────────────── */
  { id: 'edit.undo', title: 'Undo', category: 'Edit', shortcut: 'Ctrl+Z', run: () => store.undo() },
  {
    id: 'edit.redo',
    title: 'Redo',
    category: 'Edit',
    shortcut: 'Ctrl+Shift+Z',
    run: () => store.redo(),
  },
  {
    id: 'edit.duplicate',
    title: 'Duplicate Layer',
    category: 'Edit',
    shortcut: 'Ctrl+D',
    run: () => {
      const id = store.state.selectedLayerId;
      if (!id) return;
      store.duplicateLayer(id);
    },
  },
  {
    id: 'edit.delete',
    title: 'Delete Layer',
    category: 'Edit',
    shortcut: 'Del',
    run: () => {
      const id = store.state.selectedLayerId;
      if (id) store.deleteLayer(id);
    },
  },
  {
    id: 'edit.ripple-delete',
    title: 'Ripple Delete Layer',
    category: 'Edit',
    shortcut: 'Shift+Del',
    run: () => store.rippleDeleteSelected(),
  },

  /* ── Composition ──────────────────────────────────────────────────────── */
  {
    id: 'comp.settings',
    title: 'Composition Settings…',
    category: 'Composition',
    run: () => store.selectLayer(null),
  },
  {
    id: 'comp.reset-camera',
    title: 'Reset Camera',
    category: 'Composition',
    run: () => {
      store.mutateScene((scene) => {
        scene.camera = { keyframes: [{ at: 0, scale: 1, xPct: 50, yPct: 50 }] };
      }, 'Reset camera');
    },
  },

  /* ── Layer ────────────────────────────────────────────────────────────── */
  {
    id: 'layer.visibility',
    title: 'Toggle Layer Visibility',
    category: 'Layer',
    run: () => {
      const id = store.state.selectedLayerId;
      if (id) store.toggleLayerVisibility(id);
    },
  },
  {
    id: 'layer.lock',
    title: 'Toggle Layer Lock',
    category: 'Layer',
    run: () => {
      const id = store.state.selectedLayerId;
      if (id) store.toggleLayerLock(id);
    },
  },
  {
    id: 'layer.raise',
    title: 'Bring Layer Forward',
    category: 'Layer',
    shortcut: 'Ctrl+]',
    run: () => {
      const id = store.state.selectedLayerId;
      if (id) store.moveLayer(id, 'up');
    },
  },
  {
    id: 'layer.lower',
    title: 'Send Layer Backward',
    category: 'Layer',
    shortcut: 'Ctrl+[',
    run: () => {
      const id = store.state.selectedLayerId;
      if (id) store.moveLayer(id, 'down');
    },
  },

  /* ── Timeline ─────────────────────────────────────────────────────────── */
  {
    id: 'timeline.split',
    title: 'Razor Split at Playhead',
    category: 'Timeline',
    shortcut: 'Ctrl+K',
    run: () => store.razorSplitAtPlayhead(),
  },
  {
    id: 'timeline.in',
    title: 'Set In Point',
    category: 'Timeline',
    shortcut: 'I',
    run: () => store.setInPoint(store.state.playhead),
  },
  {
    id: 'timeline.out',
    title: 'Set Out Point',
    category: 'Timeline',
    shortcut: 'O',
    run: () => store.setOutPoint(store.state.playhead),
  },
  {
    id: 'timeline.clear-inout',
    title: 'Clear In / Out',
    category: 'Timeline',
    run: () => {
      store.setInPoint(null);
      store.setOutPoint(null);
    },
  },
  {
    id: 'timeline.snap',
    title: 'Toggle Magnetic Snapping',
    category: 'Timeline',
    shortcut: 'S',
    run: () => store.setSnapEnabled(!store.state.snapEnabled),
  },

  /* ── View ─────────────────────────────────────────────────────────────── */
  {
    id: 'view.fit',
    title: 'Fit Canvas to Window',
    category: 'View',
    shortcut: 'Ctrl+0',
    run: () => {
      store.setViewportZoom(1);
      store.setViewportPan({ x: 0, y: 0 });
    },
  },
  {
    id: 'view.actual-size',
    title: 'Actual Size (100%)',
    category: 'View',
    shortcut: 'Ctrl+1',
    run: () => store.setViewportZoom(1),
  },
  {
    id: 'view.reset-layout',
    title: 'Reset Workspace Layout',
    category: 'View',
    run: () => store.resetWorkspaceLayout(),
  },
  {
    id: 'view.toggle-left',
    title: 'Toggle Left Panel',
    category: 'View',
    run: () => store.toggleLeftPanelCollapsed(),
  },
  {
    id: 'view.toggle-right',
    title: 'Toggle Right Panel',
    category: 'View',
    run: () => store.toggleRightPanelCollapsed(),
  },
  {
    id: 'view.toggle-timeline',
    title: 'Toggle Timeline',
    category: 'View',
    run: () => store.toggleTimelineCollapsed(),
  },
  {
    id: 'view.maximize-panel',
    title: 'Maximize Focused Panel',
    category: 'View',
    shortcut: '`',
    run: toggleMaximizedPanel,
  },

  /* ── Window ───────────────────────────────────────────────────────────── */
  {
    id: 'window.workspace-editing',
    title: 'Workspace: Editing',
    category: 'Window',
    run: () => store.setWorkspacePreset('editing'),
  },
  {
    id: 'window.workspace-motion',
    title: 'Workspace: Motion',
    category: 'Window',
    run: () => store.setWorkspacePreset('motion'),
  },
  {
    id: 'window.workspace-audio',
    title: 'Workspace: Audio',
    category: 'Window',
    run: () => store.setWorkspacePreset('audio'),
  },
  {
    id: 'window.workspace-effects',
    title: 'Workspace: Effects',
    category: 'Window',
    run: () => store.setWorkspacePreset('effects'),
  },
  {
    id: 'window.workspace-export',
    title: 'Workspace: Export',
    category: 'Window',
    run: () => store.setWorkspacePreset('export'),
  },
  {
    id: 'window.minimize',
    title: 'Minimize Window',
    category: 'Window',
    run: () => window.motionforge?.window?.minimize(),
  },
  {
    id: 'window.maximize',
    title: 'Maximize / Restore Window',
    category: 'Window',
    run: () => window.motionforge?.window?.toggleMaximize(),
  },
  {
    id: 'window.close',
    title: 'Close Window',
    category: 'Window',
    run: () => window.motionforge?.window?.close(),
  },

  /* ── Help ─────────────────────────────────────────────────────────────── */
  {
    id: 'help.shortcuts',
    title: 'Keyboard Shortcuts',
    category: 'Help',
    shortcut: '?',
    run: () => store.setActiveModal('shortcuts'),
  },
  {
    id: 'help.quickstart',
    title: 'Quickstart Guide',
    category: 'Help',
    shortcut: 'F1',
    run: () => store.setActiveModal('help'),
  },
  {
    id: 'help.palette',
    title: 'Command Palette',
    category: 'Help',
    shortcut: 'Ctrl+K',
    run: () => store.setActiveModal('palette'),
  },
  {
    id: 'help.about',
    title: 'About MotionForge',
    category: 'Help',
    run: () => store.setActiveModal('about'),
  },
];

const byId = new Map(commands.map((c) => [c.id, c]));

/** Run a command by id. Unknown ids are ignored (a stale menu entry). */
export function runCommand(id: string): void {
  const command = byId.get(id);
  if (!command) return;
  void command.run();
}

/** The commands of one menu category, in registry order. */
export function commandsByCategory(category: CommandCategory): Command[] {
  return commands.filter((c) => c.category === category);
}

/** Every category, in menu order. */
export const CATEGORY_ORDER: CommandCategory[] = [
  'File',
  'Edit',
  'Composition',
  'Layer',
  'Timeline',
  'View',
  'Window',
  'Help',
];
