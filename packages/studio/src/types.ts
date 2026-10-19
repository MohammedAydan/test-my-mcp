import type { SceneSpec, LayerSpec } from '@motionforge/scene-spec';

export interface StudioLayer extends LayerSpec {
  _hidden?: boolean;
  _locked?: boolean;
}

export interface StudioScene extends Omit<SceneSpec, 'layers'> {
  layers: StudioLayer[];
}

export interface CapabilitiesResponse {
  schemaVersion: number;
  presets: Record<string, string[]>;
  easings: string[];
  fonts: Record<string, string[]>;
  sfx: string[];
  layerTypes: string[];
  fieldGuide?: unknown;
}

export interface RenderJobStatus {
  id: string;
  sceneId: string;
  quality: 'draft' | 'production';
  status: 'pending' | 'rendering' | 'completed' | 'failed';
  progressPct?: number;
  outputPath?: string;
  error?: string;
  createdAt: number;
}

export interface AssetVaultItem {
  id: string;
  name: string;
  type: 'image' | 'video' | 'audio' | 'lottie' | 'font';
  mimeType: string;
  sizeBytes: number;
  url: string;
  uploadedAt: number;
}

export interface MotionForgeEngineBridge {
  invoke: (method: string, ...args: unknown[]) => Promise<unknown>;
  onEvent: (callback: (event: { eventName: string; payload: any }) => void) => () => void;
}

declare global {
  interface Window {
    motionforge?: {
      engineUrl?: string;
      getEngineUrl?: () => Promise<string>;
      getOsInfo?: () => Promise<{ platform: string; arch: string; version: string }>;
      saveProjectFile?: (opts?: any) => Promise<{ canceled: boolean; filePath?: string }>;
      openProjectFile?: () => Promise<{ canceled: boolean; filePath?: string; content?: string }>;
      showInFolder?: (filePath: string) => Promise<boolean>;
      onMenuAction?: (callback: (action: string) => void) => () => void;
      getFrameBounds?: (sceneId: string, frameIndex: number) => Promise<Record<string, unknown>>;
      setDirty?: (dirty: boolean) => void;
    };
    motionforgeEngine?: MotionForgeEngineBridge;
  }
}
