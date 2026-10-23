import type { AudioCue, SceneSpec, SfxName } from "@motionforge/scene-spec";

export interface AudioChoreographyOptions {
  includeAmbientBed?: boolean;
  overwriteExisting?: boolean;
  masterGain?: number;
}

export interface AudioChoreographyReport {
  sceneId: string;
  revision: number;
  cuesAdded: number;
  totalCues: number;
  bySfx: Record<string, number>;
  ambientIncluded: boolean;
  skipped: string[];
}

interface RawCandidateCue {
  sfx: SfxName;
  at: number;
  gain: number;
}

/**
 * Deterministically choreographs audio SFX cues for a scene across the 14-cue bank.
 */
export function choreographSceneAudio(
  scene: SceneSpec,
  options?: AudioChoreographyOptions
): {
  updatedScene: SceneSpec;
  cuesAdded: number;
  totalCues: number;
  bySfx: Record<string, number>;
  ambientIncluded: boolean;
  skipped: string[];
} {
  const includeAmbientBed = options?.includeAmbientBed !== false;
  const overwriteExisting = options?.overwriteExisting === true;
  const masterGain = Math.min(2, Math.max(0, options?.masterGain ?? 1));

  const rawCandidates: RawCandidateCue[] = [];

  // 1. Opening 0-150 ms: bassDrop at at: 0, gain 0.55 AND shimmer at at: 0, gain 0.30
  rawCandidates.push({ sfx: "bassDrop", at: 0, gain: 0.55 });
  rawCandidates.push({ sfx: "shimmer", at: 0, gain: 0.30 });

  // 2. Layer entrances and actions
  for (const layer of scene.layers ?? []) {
    const layerAt = layer.at ?? 0;
    switch (layer.type) {
      case "kineticText":
        rawCandidates.push({ sfx: "whoosh", at: layerAt, gain: 0.65 });
        break;
      case "card":
        rawCandidates.push({ sfx: "softSwoosh", at: layerAt, gain: 0.6 });
        break;
      case "bentoGrid":
        rawCandidates.push({ sfx: "pop", at: layerAt, gain: 0.6 });
        break;
      case "comparisonSplit":
        rawCandidates.push({ sfx: "softSwoosh", at: layerAt, gain: 0.55 });
        break;
      case "codeBlock":
        rawCandidates.push({ sfx: "typingTick", at: layerAt + 200, gain: 0.55 });
        break;
      case "deviceMockup":
        rawCandidates.push({ sfx: "glitchHit", at: layerAt + 200, gain: 0.45 });
        if (layer.deviceType === "terminal") {
          rawCandidates.push({ sfx: "typingTick", at: layerAt + 350, gain: 0.5 });
        }
        break;
      case "chart":
      case "metricTicker":
        rawCandidates.push({ sfx: "counterTick", at: layerAt + 150, gain: 0.5 });
        break;
      case "cursorFlow": {
        for (const wp of layer.waypoints) {
          if (wp.action === "click") {
            rawCandidates.push({ sfx: "mouseClick", at: layerAt + wp.atMs, gain: 0.75 });
          } else if (wp.action === "hover") {
            rawCandidates.push({ sfx: "click", at: layerAt + wp.atMs, gain: 0.4 });
          }
        }
        break;
      }
      case "cta":
        rawCandidates.push({ sfx: "notificationChime", at: layerAt + 100, gain: 0.65 });
        rawCandidates.push({ sfx: "subImpact", at: layerAt + 100, gain: 0.35 });
        break;
    }
  }

  // 3. Ending: riser at max(0, scene.durationMs - 1400), gain 0.45
  rawCandidates.push({
    sfx: "riser",
    at: Math.max(0, scene.durationMs - 1400),
    gain: 0.45,
  });

  // 4. includeAmbientBed: one ambientPad at at: 0, gain 0.18
  if (includeAmbientBed) {
    rawCandidates.push({ sfx: "ambientPad", at: 0, gain: 0.18 });
  }

  // Scale every gain by masterGain, clamp to 0..2, round at to integer ms
  const candidateCues: AudioCue[] = rawCandidates.map((cand) => {
    const scaledGain = Math.min(2, Math.max(0, Number((cand.gain * masterGain).toFixed(4))));
    return {
      at: Math.round(cand.at),
      sfx: cand.sfx,
      gain: scaledGain,
      pan: 0,
    };
  });

  // Deduplication: within 120 ms, the same sfx name is emitted once (first wins); record skipped in skipped[]
  const skipped: string[] = [];
  const existingCues: AudioCue[] = scene.audio?.cues ?? [];
  const acceptedCues: AudioCue[] = [];
  const addedCues: AudioCue[] = [];

  if (!overwriteExisting) {
    for (const cue of existingCues) {
      acceptedCues.push({ ...cue });
    }
  }

  for (const cand of candidateCues) {
    const isDuplicate = acceptedCues.some(
      (accepted) => accepted.sfx === cand.sfx && Math.abs(accepted.at - cand.at) <= 120
    );

    if (isDuplicate) {
      skipped.push(`${cand.sfx} at ${cand.at}ms: duplicate within 120ms`);
    } else {
      acceptedCues.push(cand);
      addedCues.push(cand);
    }
  }

  // Assign stable cue ids (`cue-<index>`). An existing id is preserved; a
  // generated id is the first free `cue-<n>`, so a user cue called `cue-1`
  // can never collide with a generated one.
  const usedCueIds = new Set<string>();
  const assignCueId = (preferred?: string): string => {
    if (preferred && !usedCueIds.has(preferred)) {
      usedCueIds.add(preferred);
      return preferred;
    }
    let index = 0;
    while (usedCueIds.has(`cue-${index}`)) index += 1;
    const id = `cue-${index}`;
    usedCueIds.add(id);
    return id;
  };
  const finalCues: AudioCue[] = overwriteExisting
    ? addedCues.map((c) => ({ ...c, id: assignCueId(c.id) }))
    : [
        ...existingCues.map((c) => ({ ...c, id: assignCueId(c.id) })),
        ...addedCues.map((c) => ({ ...c, id: assignCueId(c.id) })),
      ];

  const bySfx: Record<string, number> = {};
  for (const cue of finalCues) {
    bySfx[cue.sfx] = (bySfx[cue.sfx] ?? 0) + 1;
  }

  const updatedScene: SceneSpec = {
    ...scene,
    audio: {
      ...(scene.audio ?? {}),
      cues: finalCues,
    },
  };

  return {
    updatedScene,
    cuesAdded: addedCues.length,
    totalCues: finalCues.length,
    bySfx,
    ambientIncluded: finalCues.some((c) => c.sfx === "ambientPad"),
    skipped,
  };
}
