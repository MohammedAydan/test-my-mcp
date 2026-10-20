import type { LayerType, SceneSpecInput } from '@motionforge/scene-spec';

/**
 * The Studio's *authoring* view of a layer.
 *
 * The scene contract is a discriminated union — a `kineticText` has `text` and
 * `sizePx`, a `card` has `variant`, a `background` has neither. The Studio,
 * however, edits a scene as a whole: the layer stack lists every kind in one
 * table, the inspector switches its content on `layer.type`, and the timeline
 * draws every clip in one canvas.
 *
 * Modelling that with the strict union makes the UI code unusable (every
 * property access has to be narrowed first, and a narrowed path cannot be
 * written through a generic setter). So the Studio keeps a permissive
 * *authoring* type and lets the **schema** be the gate: every save is
 * validated against the real `SceneSpec` by the engine, so a mis-typed field
 * is rejected at the boundary instead of being silently accepted.
 */
export interface StudioLayer {
  id: string;
  type: LayerType;

  /* ---- identity & timing ---- */
  name?: string;
  z?: number;
  at?: number;
  duration?: number;

  /* ---- spatial & NLE ---- */
  position?: { xPct: number; yPct: number };
  rotation?: number;
  scale?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  blendMode?: string;
  trackIndex?: number;
  trackLane?: number;

  /* ---- motion & audio ---- */
  direction?: 'ltr' | 'rtl';
  entrance?: { name: string; durationMs?: number; staggerMs?: number; delayMs?: number };
  emphasis?: { name: string; durationMs?: number; staggerMs?: number; delayMs?: number };
  exit?: { name: string; durationMs?: number; staggerMs?: number; delayMs?: number };
  sfx?: unknown[];
  tracks?: unknown[];

  /* ---- per-kind content ---- */
  variant?: Record<string, unknown>;
  text?: string;
  sizePx?: number;
  role?: string;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacingPx?: number;
  align?: string;
  googleFamily?: string;
  fill?: unknown;
  stroke?: unknown;
  shadow?: unknown;
  box?: Record<string, unknown>;
  highlight?: Record<string, unknown>;
  animateBy?: string;
  assetId?: string;
  widthPx?: number;
  heightPx?: number;
  mask?: string;
  cornerRadiusPx?: number;
  ring?: Record<string, unknown>;
  glass?: Record<string, unknown>;
  glow?: Record<string, unknown>;
  lightSweep?: Record<string, unknown>;
  effects?: unknown[];

  /* ---- legacy UI bookkeeping (migrated on save) ---- */
  _hidden?: boolean;
  _locked?: boolean;

  /** anything else the schema knows about */
  [key: string]: unknown;
}

/**
 * The Studio's authoring view of a scene.
 *
 * `SceneSpecInput` is the *input* type of the schema, so the defaults
 * (`at`, `direction`, `role`, …) are optional — which is what an editor
 * actually holds before the scene is validated.
 */
export interface StudioScene extends Omit<SceneSpecInput, 'layers'> {
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
      saveProjectFile?: (opts: any) => Promise<{ canceled: boolean; filePath?: string }>;
      openProjectFile?: () => Promise<{ canceled: boolean; filePath?: string; content?: string }>;
      showInFolder?: (filePath: string) => Promise<boolean>;
      onMenuAction?: (callback: (action: string) => void) => () => void;
      getFrameBounds?: (sceneId: string, frameIndex: number) => Promise<Record<string, unknown>>;
      setDirty?: (dirty: boolean) => void;
      window?: {
        minimize: () => Promise<void>;
        toggleMaximize: () => Promise<{ isMaximized: boolean }>;
        isMaximized: () => Promise<{ isMaximized: boolean }>;
        close: () => Promise<void>;
        isFullScreen: () => Promise<{ isFullScreen: boolean }>;
        onMaximizedChanged: (callback: (state: { isMaximized: boolean }) => void) => () => void;
      };
    };
    motionforgeEngine?: MotionForgeEngineBridge;
  }
}
