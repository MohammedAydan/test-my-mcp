import { Component, Show } from 'solid-js';
import { store, type WorkspacePreset } from '../../state/store.js';
import {
  IconAudioWorkspace,
  IconCamera,
  IconEffects,
  IconExportWorkspace,
  IconMotion,
} from '../icons/NleIcons.js';

/**
 * The workspace layout switcher.
 *
 * Premiere-style presets: each one hides the panels that do not belong to
 * that workspace and re-weights the ones that do. The preset itself lives in
 * the store (`workspacePreset`), so the title bar pills and this panel always
 * agree.
 */

export interface WorkspacePresetDef {
  id: WorkspacePreset;
  label: string;
  icon: typeof IconMotion;
  /** which panels are visible in this workspace */
  showProjectBin: boolean;
  showHierarchy: boolean;
  showMonitor: boolean;
  showInspector: boolean;
  showTimeline: boolean;
  /** relative width of the left rail (0 hides it) */
  leftWidth: number;
  /** relative width of the right rail (0 hides it) */
  rightWidth: number;
}

export const WORKSPACE_PRESETS: WorkspacePresetDef[] = [
  {
    id: 'editing',
    label: 'Editing',
    icon: IconMotion,
    showProjectBin: true,
    showHierarchy: true,
    showMonitor: true,
    showInspector: true,
    showTimeline: true,
    leftWidth: 280,
    rightWidth: 340,
  },
  {
    id: 'motion',
    label: 'Motion',
    icon: IconCamera,
    showProjectBin: false,
    showHierarchy: true,
    showMonitor: true,
    showInspector: true,
    showTimeline: true,
    leftWidth: 260,
    rightWidth: 360,
  },
  {
    id: 'audio',
    label: 'Audio',
    icon: IconAudioWorkspace,
    showProjectBin: false,
    showHierarchy: false,
    showMonitor: true,
    showInspector: true,
    showTimeline: true,
    leftWidth: 240,
    rightWidth: 320,
  },
  {
    id: 'effects',
    label: 'Effects',
    icon: IconEffects,
    showProjectBin: true,
    showHierarchy: false,
    showMonitor: true,
    showInspector: true,
    showTimeline: false,
    leftWidth: 240,
    rightWidth: 400,
  },
  {
    id: 'export',
    label: 'Export',
    icon: IconExportWorkspace,
    showProjectBin: true,
    showHierarchy: false,
    showMonitor: true,
    showInspector: false,
    showTimeline: false,
    leftWidth: 260,
    rightWidth: 300,
  },
];

/** The active preset definition. */
export function activePreset(): WorkspacePresetDef {
  return (
    WORKSPACE_PRESETS.find((p) => p.id === store.state.workspacePreset) ?? WORKSPACE_PRESETS[0]!
  );
}

/**
 * A compact, always-visible summary of the current workspace.
 *
 * The full switcher lives in the title bar; this is the in-workspace
 * reminder of what is hidden and what is shown.
 */
export const WorkspaceLayout: Component = () => {
  const preset = () => activePreset();

  return (
    <div class="mf-statusbar" style={{ height: 'auto', padding: '6px 8px', gap: '6px' }}>
      <Show when={preset().icon}>
        {(() => {
          const Icon = preset().icon;
          return <Icon size={13} />;
        })()}
      </Show>
      <span style={{ color: 'var(--mf-text-1)', 'font-weight': '600' }}>{preset().label} workspace</span>
      <span class="mf-status-spacer" />
      <Show when={preset().showProjectBin}>
        <span class="mf-chip">Bin</span>
      </Show>
      <Show when={preset().showHierarchy}>
        <span class="mf-chip">Layers</span>
      </Show>
      <Show when={preset().showInspector}>
        <span class="mf-chip">Inspector</span>
      </Show>
      <Show when={preset().showTimeline}>
        <span class="mf-chip">Timeline</span>
      </Show>
    </div>
  );
};
