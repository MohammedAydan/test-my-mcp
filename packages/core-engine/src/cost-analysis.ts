/**
 * THE COST MODEL.
 *
 * A scene is not as expensive to render as its layer count suggests. Two
 * layers of flat text cost almost nothing; ONE blurred full-frame gradient
 * costs more than everything else in the scene put together, because the
 * rasteriser has to re-blur the whole frame on every single frame.
 *
 * So the engine names the expensive features, prices them, and uses the price
 * twice:
 *
 * 1. `analyzeScene` reports the estimate to the caller ("this scene will take
 *    about 3.2 minutes on this host"), and
 * 2. the render runner uses it to pick a WORKER BUDGET — a scene with heavy
 *    effects is rendered on ONE worker, because two browsers rasterising a
 *    blurred gradient on a 4 GB host is how a render OOMs.
 *
 * The detection lives in ONE function (`detectHeavyEffects`) so the estimate
 * and the budget can never disagree about what "heavy" means.
 */
import os from "node:os";

import type { HeavyEffectReport, SceneSpec } from "@motionforge/scene-spec";

/**
 * The per-frame cost multiplier of every effect the engine knows about.
 *
 * EVERY NUMBER HERE IS MEASURED, in ISOLATION — one effect on a minimal
 * scene, 30 frames, on the reference host (2 vCPU, 3.8 GB, SwiftShader
 * software rasterisation). The bare scene costs 106.6 ms/frame; each effect
 * below is the DELTA over that baseline.
 *
 * WHY ISOLATION MATTERS: the first cost model priced the effects as they
 * appeared in the audit's A/B — a scene with SEVEN 200 px Gaussian blurs on
 * every layer. An alpha overlay forces the blurred layers beneath it to be
 * flattened into a single texture, so that A/B measured the INTERACTION
 * between the overlay and the blurs, not the overlay. The grain looked
 * like ×1.53; its own cost is ×1.11 — the same as a vignette.
 */
export const HEAVY_EFFECT_MULTIPLIERS = {
  /**
   * A mesh gradient, AFTER the Phase-7 optimisation (the blobs are
   * pre-softened gradients, not a live 70 px Gaussian blur).
   * Measured: +10.8 ms over the bare scene (×1.10). Before the
   * optimisation it was ×1.95.
   */
  meshGradient: 1.1,
  /**
   * A film-grain overlay, AFTER the Phase-7 optimisation (a pre-baked,
   * tileable noise image instead of a live SVG `feTurbulence` filter plus a
   * `mix-blend-mode: overlay` pass).
   * Measured: +12.1 ms over the bare scene (×1.11).
   */
  filmGrain: 1.11,
  /**
   * A large Gaussian blur on ONE layer.
   * Measured: +14.8 ms over the bare scene for a 200 px blur (×1.14).
   */
  blur: 1.14,
  /** anything but `normal` forces the compositor to blend the layer */
  blendMode: 1.25,
  /** hundreds of individually positioned, individually painted particles */
  particleField: 1.2,
} as const;

/** The hard ceiling on the combined per-frame multiplier. */
export const MAX_PER_FRAME_MULTIPLIER = 4;

/** The blur radius (px) at which a layer's filter counts as heavy. */
export const HEAVY_BLUR_PX = 40;

/** The particle count above which a `particleField` counts as heavy. */
export const HEAVY_PARTICLE_COUNT = 150;

/** The baseline cost of one frame on a 4-core host, in milliseconds. */
export const BASELINE_FRAME_MS = 250;

/** The host memory (GB) at or below which the engine renders on one worker. */
export const LOW_MEMORY_GB = 4.5;

/**
 * Every expensive feature in a scene, biggest cost first.
 *
 * Each entry names the layer it belongs to, so a caller can go and fix THAT
 * layer instead of guessing.
 */
export function detectHeavyEffects(scene: SceneSpec): HeavyEffectReport[] {
  const effects: HeavyEffectReport[] = [];

  for (const layer of scene.layers) {
    // a blurred full-frame gradient
    if (layer.type === "background") {
      const variant = (layer as { variant?: { variant?: string } }).variant;
      if (variant?.variant === "meshGradient") {
        effects.push({
          layerId: layer.id,
          layerType: layer.type,
          effect: "meshGradient",
          multiplier: HEAVY_EFFECT_MULTIPLIERS.meshGradient,
          reason: "a full-frame gradient is re-rasterised on every frame (measured x1.10 after the Phase-7 optimisation)",
        });
      }
    }

    // a full-frame grain overlay
    if (layer.type === "foregroundFX") {
      const list = (layer as { effects?: Array<{ kind?: string }> }).effects ?? [];
      if (list.some((effect) => effect?.kind === "filmGrain")) {
        effects.push({
          layerId: layer.id,
          layerType: layer.type,
          effect: "filmGrain",
          multiplier: HEAVY_EFFECT_MULTIPLIERS.filmGrain,
          reason: "a full-frame translucent overlay forces a compositor pass per frame (measured x1.11 on its own, more when the layers beneath it are blurred)",
        });
      }
    }

    // a large Gaussian blur
    const blur = layer.filters?.blur;
    if (typeof blur === "number" && blur >= HEAVY_BLUR_PX) {
      effects.push({
        layerId: layer.id,
        layerType: layer.type,
        effect: "blur",
        multiplier: HEAVY_EFFECT_MULTIPLIERS.blur,
        reason: `a ${blur}px Gaussian blur filters the layer's whole box on every frame`,
      });
    }

    // anything but `normal` blend mode
    const blendMode = layer.blendMode;
    if (typeof blendMode === "string" && blendMode !== "normal") {
      effects.push({
        layerId: layer.id,
        layerType: layer.type,
        effect: "blendMode",
        multiplier: HEAVY_EFFECT_MULTIPLIERS.blendMode,
        reason: `the "${blendMode}" blend mode forces the compositor to blend the layer every frame`,
      });
    }

    // hundreds of particles
    if (layer.type === "particleField") {
      const count = (layer as { count?: number }).count ?? 0;
      if (count > HEAVY_PARTICLE_COUNT) {
        effects.push({
          layerId: layer.id,
          layerType: layer.type,
          effect: "particleField",
          multiplier: HEAVY_EFFECT_MULTIPLIERS.particleField,
          reason: `${count} particles are positioned and painted individually on every frame`,
        });
      }
    }
  }

  return effects.sort((a, b) => b.multiplier - a.multiplier);
}

/**
 * The combined per-frame cost of a set of effects.
 *
 * The multipliers MULTIPLY (a gradient AND a grain overlay cost more than
 * either alone), and the product is capped so a pathological scene cannot
 * claim a 40× render.
 */
export function perFrameMultiplier(effects: readonly HeavyEffectReport[]): number {
  const product = effects.reduce((total, effect) => total * effect.multiplier, 1);
  return Math.min(MAX_PER_FRAME_MULTIPLIER, Math.round(product * 100) / 100);
}

/** True when a scene carries at least one expensive feature. */
export function sceneHasHeavyEffects(scene: SceneSpec): boolean {
  return detectHeavyEffects(scene).length > 0;
}

export interface WorkerBudgetInput {
  /** the number of usable CPU cores */
  cpus: number;
  /** the host's total memory, in gigabytes */
  totalMemGb: number;
  /** whether the scene carries expensive effects */
  heavy: boolean;
}

/**
 * The number of render workers this host can afford for this scene.
 *
 * - A host with 4.5 GB of RAM or less renders on ONE worker: two headless
 *   browsers rasterising a full-frame scene do not fit.
 * - A scene with heavy effects renders on ONE worker even on a big host: the
 *   cost is in the rasteriser, and two rasterisers on the same cores do not
 *   make the frame cheaper — they just make it thrash.
 * - Otherwise the budget is the core count, capped at 4.
 */
export function computeWorkerBudget(input: WorkerBudgetInput): number {
  const cap = input.totalMemGb <= LOW_MEMORY_GB || input.heavy ? 1 : 4;
  return Math.max(1, Math.min(Math.max(1, input.cpus), cap));
}

/** The worker budget for a scene on THIS host. */
export function workerBudgetForScene(scene: SceneSpec): number {
  return computeWorkerBudget({
    cpus: os.cpus().length,
    totalMemGb: os.totalmem() / 1024 ** 3,
    heavy: sceneHasHeavyEffects(scene),
  });
}

/** The host facts every cost estimate is based on. */
export function hostFacts(): { cpus: number; totalMemGb: number; softwareRasterised: boolean } {
  return {
    cpus: os.cpus().length,
    totalMemGb: Math.round((os.totalmem() / 1024 ** 3) * 100) / 100,
    // the engine rasterises with a software compositor — there is no GPU
    // raster path in the headless renderer
    softwareRasterised: true,
  };
}

/**
 * The estimated cost of one frame, in milliseconds, on this host.
 *
 * The baseline (250 ms) is the cost of a plain frame on a 4-core host. A
 * smaller host pays more per frame, so the estimate is scaled up.
 */
export function estimatedFrameMs(multiplier: number, cpus: number): number {
  const hostFactor = Math.max(1, 4 / Math.max(1, cpus));
  return Math.round(BASELINE_FRAME_MS * multiplier * hostFactor);
}
