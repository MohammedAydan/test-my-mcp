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

import type { HeavyEffectReport, SceneCostReport, SceneSpec } from "@motionforge/scene-spec";

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

// ---------------------------------------------------------------------------
// The keyframe density term
// ---------------------------------------------------------------------------

/**
 * THE KEYFRAME DENSITY OF A SCENE.
 *
 * The first cost model priced EFFECTS and nothing else, so a scene with 280
 * keyframes and a scene with 4 got the same estimate — even though every
 * keyframe is a tween the timeline evaluates on EVERY seek, and every seek
 * is a frame.
 *
 * The control experiment in the audit proved the gap is real: the
 * full-density scene WITHOUT the two effects rendered in 40.8 s with zero
 * kills, while the same scene WITH them was OOM-killed. The density was
 * never in the model, so nothing warned about it.
 */
export interface KeyframeDensityReport {
  /** every keyframe in the scene, canonical + legacy */
  totalKeyframes: number;
  /** the number of DISTINCT properties animated anywhere in the scene */
  animatedProperties: number;
  /** the number of layers that carry at least one keyframe */
  keyframedLayers: number;
  /** the keyframes per second of screen time */
  keyframesPerSecond: number;
  /** the per-frame cost multiplier the density adds (1 = no keyframes) */
  multiplier: number;
  /** why the density costs what it costs, in one sentence */
  reason: string;
}

/**
 * THE NUMBER OF KEYFRAMES AT WHICH THE DENSITY TERM REACHES FULL STRENGTH.
 *
 * 200 keyframes is roughly a dense-but-normal scene: forty keyframes on each
 * of five layers.
 */
export const KEYFRAME_DENSITY_REFERENCE = 200;

/**
 * THE MULTIPLIER THE DENSITY TERM ADDS AT THE REFERENCE COUNT.
 *
 * MEASURED, not assumed. The "cost attribution: KEYFRAME DENSITY" section of
 * `scripts/benchmark-backend-engine.cjs` renders the same scene (one
 * background + one text layer) with 0 and with 200 keyframes, 30 frames each,
 * on the reference host. Two runs measured **99.8 vs 101.2** and **99.8 vs
 * 99.9 ms/frame** — ×1.01 and ×1.00. The model keeps the higher of the two.
 *
 * The lesson is worth keeping: evaluating 200 keyframes costs almost nothing.
 * What costs is the VALUE a dense keyframe sweep drives a filtered layer
 * through (a full-frame gradient scaled to 10× is a 368 MB surface) — which is
 * why `analyzeScene` warns with `FILTERED_LAYER_LARGE_SCALE` instead of
 * pretending the keyframe count alone predicts a render's memory.
 */
export const KEYFRAME_DENSITY_MULTIPLIER = 1.01;

/** The ceiling on what the density term alone may add. */
export const MAX_KEYFRAME_DENSITY_MULTIPLIER = 2;

/**
 * Measure the keyframe density of a scene.
 *
 * The canonical `keyframes` array wins over the legacy `tracks` array (the
 * same precedence the inspector reports), so a layer that carries both is
 * counted once — with the canonical values.
 */
export function measureKeyframeDensity(scene: SceneSpec): KeyframeDensityReport {
  let totalKeyframes = 0;
  let keyframedLayers = 0;
  const properties = new Set<string>();

  for (const layer of scene.layers) {
    const canonical = Array.isArray(layer.keyframes) ? layer.keyframes : [];
    const legacy = Array.isArray((layer as { tracks?: unknown[] }).tracks)
      ? ((layer as { tracks: Array<{ property?: string }> }).tracks ?? [])
      : [];
    // the canonical array wins: the legacy one is ignored when both exist
    const frames = canonical.length > 0 ? canonical : legacy;
    if (frames.length === 0) continue;
    keyframedLayers += 1;
    totalKeyframes += frames.length;
    for (const frame of frames) {
      const property = (frame as { property?: string }).property;
      if (typeof property === "string") properties.add(property);
    }
  }

  const seconds = Math.max(0.001, scene.durationMs / 1000);
  const ratio = totalKeyframes / KEYFRAME_DENSITY_REFERENCE;
  const multiplier =
    totalKeyframes === 0
      ? 1
      : Math.min(
          MAX_KEYFRAME_DENSITY_MULTIPLIER,
          Math.round((1 + ratio * (KEYFRAME_DENSITY_MULTIPLIER - 1)) * 100) / 100
        );

  return {
    totalKeyframes,
    animatedProperties: properties.size,
    keyframedLayers,
    keyframesPerSecond: Math.round((totalKeyframes / seconds) * 10) / 10,
    multiplier,
    reason:
      totalKeyframes === 0
        ? "the scene has no keyframes — every frame is a plain layout pass"
        : `${totalKeyframes} keyframes on ${keyframedLayers} layer(s) across ` +
          `${properties.size} propert${properties.size === 1 ? "y" : "ies"} — evaluating them is cheap ` +
          `(measured x${KEYFRAME_DENSITY_MULTIPLIER} at ${KEYFRAME_DENSITY_REFERENCE}); the memory risk is the ` +
          `VALUE a sweep drives a filtered layer through, which analyze_scene warns about separately`,
  };
}

// ---------------------------------------------------------------------------
// The one cost report
// ---------------------------------------------------------------------------

/**
 * THE COST REPORT — ONE function, ONE answer.
 *
 * The render pre-flight and the `analyze_scene` tool both call this, so the
 * estimate a caller reads is the estimate the render used. (They used to be
 * two code paths that could drift apart.)
 */
export function buildCostReport(scene: SceneSpec): SceneCostReport {
  const heavyEffects = detectHeavyEffects(scene);
  const keyframeDensity = measureKeyframeDensity(scene);
  const effectMultiplier = perFrameMultiplier(heavyEffects);
  // the density multiplies the effect price — a dense scene with a blurred
  // gradient is more expensive than either alone
  const combined = Math.min(
    MAX_PER_FRAME_MULTIPLIER,
    Math.round(effectMultiplier * keyframeDensity.multiplier * 100) / 100
  );
  const host = hostFacts();
  const frames = Math.max(1, Math.round((scene.durationMs / 1000) * 60));
  const frameMs = estimatedFrameMs(combined, host.cpus);
  return {
    perFrameMultiplier: combined,
    estimatedFrameMs: frameMs,
    estimatedTotalMs: frameMs * frames,
    frames,
    workerBudget: computeWorkerBudget({
      cpus: host.cpus,
      totalMemGb: host.totalMemGb,
      heavy: heavyEffects.length > 0,
    }),
    heavyEffects,
    keyframeDensity,
    host,
    notes: buildCostNotes(heavyEffects, keyframeDensity, combined, host, frameMs),
  };
}

/**
 * The human-readable reasons behind a cost estimate.
 *
 * Every note names the thing it is about — a caller who wants the render to
 * be cheaper needs to know WHICH layer to change.
 */
function buildCostNotes(
  effects: readonly { layerId: string; effect: string; multiplier: number }[],
  density: KeyframeDensityReport,
  multiplier: number,
  host: { cpus: number; totalMemGb: number },
  frameMs: number
): string[] {
  const notes: string[] = [];
  if (effects.length === 0) {
    notes.push("no heavy effects detected — a plain scene, one frame per worker tick");
  } else {
    const names = effects.map((effect) => effect.effect);
    if (names.length > 1) {
      notes.push(
        `${names.join(" + ")} together make a frame ${multiplier}x more expensive ` +
          `(layer(s) ${effects.map((effect) => effect.layerId).join(", ")})`
      );
    } else {
      const effect = effects[0]!;
      notes.push(
        `${effect.effect} on layer "${effect.layerId}" makes a frame ${multiplier}x more expensive`
      );
    }
  }
  if (density.multiplier > 1) {
    notes.push(
      `the keyframe density adds x${density.multiplier} on top: ${density.reason}`
    );
  }
  notes.push(
    `estimated ${frameMs}ms per frame on this host (${host.cpus} cpus, ${host.totalMemGb} GB, software rasterised)`
  );
  if (host.totalMemGb <= 4.5) {
    notes.push(
      `this host has ${host.totalMemGb} GB of RAM — the engine renders on ONE worker so a render cannot OOM`
    );
  }
  return notes;
}
