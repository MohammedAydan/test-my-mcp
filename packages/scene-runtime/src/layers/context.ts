import type { gsap } from "gsap";
import type { AssetKind, FontRole, SceneSpec } from "@motionforge/scene-spec";
import type { Seekable } from "../types.js";

/** Everything a layer renderer may touch. Passed to every `render*` fn. */
export interface LayerContext {
  tl: gsap.core.Timeline;
  scene: SceneSpec;
  /** this layer's own root element (full-bleed, inside #stage-content) */
  content: HTMLElement;
  /** global content wrapper — target for scene-wide filters (color grade) */
  stageContent: HTMLElement;
  rig: HTMLElement;
  width: number;
  height: number;
  /** layer start time in seconds (timeline-absolute) */
  layerAtSec: number;
  fonts: Map<FontRole, string>;
  resolveAsset(assetId: string): string;
  assetKind(assetId: string): AssetKind | undefined;
  /** preloaded Lottie animation data (thrown error if absent — never silent) */
  lottieData(assetId: string): unknown;
  /** register a per-frame media sync (e.g. video currentTime) used by seekToFrame */
  registerSeekable(seekable: Seekable): void;
  /**
   * Natural pixel size of an image asset, when it is known.
   *
   * Used to size a logo that declares no `heightPx`: without the aspect ratio
   * the host box collapses to zero height and the mark is invisible.
   */
  assetIntrinsicSize(assetId: string): { width: number; height: number } | undefined;
}
