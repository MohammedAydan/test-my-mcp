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
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  blendMode?: string;
  trackIndex?: number;
  trackLane?: number;
  /**
   * The explicit layout box, in percent of the composition.
   *
   * EXCEPTION — `particleField` SHADOWS this key: the schema uses `size` for
   * the PARTICLE RADIUS (a number), because a full-bleed field has no layout
   * box to size. So `size` is a number on a `particleField` and a box on
   * every other kind. `sizePx` is the documented ALIAS of the radius; the
   * sanitizer folds it into the canonical `size` on the way to the engine.
   */
  size?: { widthPct?: number; heightPct?: number } | number;
  /** CSS visual filters (blur, brightness, contrast, saturate, shadow, radius) */
  filters?: Record<string, number | string | undefined>;
  /** the flat, unified keyframe surface */
  keyframes?: Array<{
    id: string;
    timeMs: number;
    property: string;
    value: number;
    easing?: string;
  }>;

  /* ---- motion & audio ---- */
  direction?: 'ltr' | 'rtl';
  entrance?: { name: string; durationMs?: number; staggerMs?: number; delayMs?: number };
  emphasis?: { name: string; durationMs?: number; staggerMs?: number; delayMs?: number };
  exit?: { name: string; durationMs?: number; staggerMs?: number; delayMs?: number };
  sfx?: unknown[];
  tracks?: unknown[];

  /* ---- per-kind content ---- */
  /**
   * The per-kind payload.
   *
   * EXCEPTION — `cta` SHADOWS this key: a `cta`'s `variant` is the treatment
   * NAME (`'primary' | 'glass' | 'outline' | 'pill'`), while a `card`'s
   * `variant` is an OBJECT (the discriminated union of card treatments). So
   * `variant` is a string on a `cta` and an object on a `card`.
   */
  variant?: Record<string, unknown> | string;
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
 * The layer's per-kind OBJECT payload.
 *
 * `variant` is an object on a `card` (the discriminated union of card
 * treatments) and a plain STRING on a `cta` (the treatment name). This
 * helper narrows it for the readers that need the object shape.
 */
export function layerVariant(layer: StudioLayer): Record<string, unknown> {
  const variant = layer.variant;
  if (variant && typeof variant === 'object') return variant as Record<string, unknown>;
  return {};
}

/**
 * The layer's layout box, or `null` when it has none.
 *
 * A `particleField` uses `size` for its particle RADIUS, so the box is only
 * present when `size` really is an object.
 */
export function layerLayoutSize(
  layer: StudioLayer
): { widthPct?: number; heightPct?: number } | null {
  const size = layer.size;
  if (size && typeof size === 'object') return size;
  return null;
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
  /** the frame the encoder is on (the modal shows `frame N / M`) */
  currentFrame?: number;
  /** the total frame count of the job */
  totalFrames?: number;
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
