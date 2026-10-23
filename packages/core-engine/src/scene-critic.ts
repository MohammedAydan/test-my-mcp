import type {
  BoundsFrameReport,
  SceneBoundsReport,
  SceneSpec,
  ThemePreset,
} from "@motionforge/scene-spec";
import {
  isFullBleedLayerType,
  THEME_TOKENS,
} from "@motionforge/scene-spec";
import type { SceneWarning } from "./scene-analysis.js";

export type CritiqueRule =
  | "FOREGROUND_OVERLAP"
  | "SAFE_MARGIN_VIOLATION"
  | "LOW_CONTRAST"
  | "DEAD_AIR_FRAME"
  | "VISUAL_CLUTTER"
  | "TIMING_OVERFLOW"
  | "RENDER_COST_HAZARD";

export interface CritiqueIssue {
  rule: CritiqueRule;
  severity: "error" | "warning";
  atMs: number | null;
  layerIds: string[];
  message: string;
  autoFixable: boolean;
}

export interface CritiqueOptions {
  autoApplyFixes?: boolean; // default true
  sampleTimesMs?: number[]; // optional explicit sample set
}

export interface CritiqueReport {
  sceneId: string;
  revision: number;
  scoreBefore: number; // 0..100
  scoreAfter: number; // 0..100
  issuesBefore: CritiqueIssue[];
  appliedFixes: string[];
  issuesAfter: CritiqueIssue[];
  sampledTimesMs: number[];
}

export const VISIBLE_OPACITY = 0.01;

const RULE_ORDER: Record<CritiqueRule, number> = {
  FOREGROUND_OVERLAP: 0,
  SAFE_MARGIN_VIOLATION: 1,
  LOW_CONTRAST: 2,
  DEAD_AIR_FRAME: 3,
  VISUAL_CLUTTER: 4,
  TIMING_OVERFLOW: 5,
  RENDER_COST_HAZARD: 6,
};

/**
 * Compute the 5 evenly spaced timestamps + layer window midpoints,
 * deduplicated, sorted, and capped at 40 samples.
 */
export function computeSampleTimes(scene: SceneSpec, explicitTimes?: number[]): number[] {
  if (Array.isArray(explicitTimes) && explicitTimes.length > 0) {
    const valid = explicitTimes
      .filter((t) => Number.isFinite(t) && t >= 0)
      .map((t) => Math.round(t));
    const deduped = Array.from(new Set(valid)).sort((a, b) => a - b);
    return deduped.slice(0, 40);
  }

  const durationMs = scene.durationMs;
  const samples: number[] = [];

  if (durationMs > 500) {
    const start = 250;
    const end = durationMs - 250;
    const step = (end - start) / 4;
    for (let i = 0; i < 5; i++) {
      samples.push(Math.round(start + i * step));
    }
  } else {
    for (let i = 0; i < 5; i++) {
      samples.push(Math.round((durationMs * i) / 4));
    }
  }

  for (const layer of scene.layers) {
    if (isFullBleedLayerType(layer.type)) continue;
    const at = typeof layer.at === "number" ? layer.at : 0;
    const duration = typeof layer.duration === "number" ? layer.duration : durationMs - at;
    const mid = Math.round(at + duration / 2);
    if (mid >= 0 && mid <= durationMs) {
      samples.push(mid);
    }
  }

  const deduped = Array.from(new Set(samples)).sort((a, b) => a - b);
  return deduped.slice(0, 40);
}

/**
 * Parse standard CSS color strings: hex (#rgb, #rgba, #rrggbb, #rrggbbaa),
 * rgb/rgba, or standard named colors.
 */
export function parseCssColor(
  colorStr: string
): { r: number; g: number; b: number; a: number } | null {
  if (typeof colorStr !== "string") return null;
  const str = colorStr.trim().toLowerCase();

  if (str === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (str === "black") return { r: 0, g: 0, b: 0, a: 1 };
  if (str === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  if (str.startsWith("#")) {
    const hex = str.slice(1);
    const h0 = hex[0] ?? "0";
    const h1 = hex[1] ?? "0";
    const h2 = hex[2] ?? "0";
    const h3 = hex[3] ?? "0";

    if (hex.length === 3) {
      return {
        r: parseInt(h0 + h0, 16),
        g: parseInt(h1 + h1, 16),
        b: parseInt(h2 + h2, 16),
        a: 1,
      };
    }
    if (hex.length === 4) {
      return {
        r: parseInt(h0 + h0, 16),
        g: parseInt(h1 + h1, 16),
        b: parseInt(h2 + h2, 16),
        a: parseInt(h3 + h3, 16) / 255,
      };
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1,
      };
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255,
      };
    }
    return null;
  }

  const rgbMatch = str.match(
    /^rgba?\(\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*[, ]\s*([0-9.]+)(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/
  );
  if (rgbMatch) {
    const rRaw = rgbMatch[1] ?? "0";
    const gRaw = rgbMatch[2] ?? "0";
    const bRaw = rgbMatch[3] ?? "0";
    const r = Math.round(parseFloat(rRaw));
    const g = Math.round(parseFloat(gRaw));
    const b = Math.round(parseFloat(bRaw));
    let a = 1;
    const aMatch = rgbMatch[4];
    if (aMatch !== undefined) {
      if (aMatch.endsWith("%")) {
        a = parseFloat(aMatch) / 100;
      } else {
        a = parseFloat(aMatch);
      }
    }
    return {
      r: Math.max(0, Math.min(255, r)),
      g: Math.max(0, Math.min(255, g)),
      b: Math.max(0, Math.min(255, b)),
      a: Math.max(0, Math.min(1, a)),
    };
  }

  return null;
}

/**
 * Standard WCAG 2.1 relative luminance calculation.
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const rs = r / 255;
  const gs = g / 255;
  const bs = b / 255;

  const rLin = rs <= 0.04045 ? rs / 12.92 : Math.pow((rs + 0.055) / 1.055, 2.4);
  const gLin = gs <= 0.04045 ? gs / 12.92 : Math.pow((gs + 0.055) / 1.055, 2.4);
  const bLin = bs <= 0.04045 ? bs / 12.92 : Math.pow((bs + 0.055) / 1.055, 2.4);

  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/**
 * Contrast ratio between text and background, with alpha compositing over bg.
 */
export function contrastRatio(textColorStr: string, bgColorStr: string): number | null {
  const fg = parseCssColor(textColorStr);
  const bg = parseCssColor(bgColorStr);
  if (!fg || !bg) return null;

  const r = Math.round(fg.a * fg.r + (1 - fg.a) * bg.r);
  const g = Math.round(fg.a * fg.g + (1 - fg.a) * bg.g);
  const b = Math.round(fg.a * fg.b + (1 - fg.a) * bg.b);

  const l1 = relativeLuminance(r, g, b);
  const l2 = relativeLuminance(bg.r, bg.g, bg.b);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Active background base color: theme bgBase > first background solid/mesh > #05070d.
 */
export function resolveBackgroundBase(scene: SceneSpec): string {
  if (scene.themePreset && THEME_TOKENS[scene.themePreset]?.bgBase) {
    return THEME_TOKENS[scene.themePreset].bgBase;
  }
  const bg = scene.layers.find((l) => l.type === "background");
  if (bg && bg.type === "background") {
    const v = bg.variant;
    if (v.variant === "solid" && typeof v.color === "string") {
      return v.color;
    }
    if (v.variant === "meshGradient") {
      return v.base ?? "#05070d";
    }
  }
  return "#05070d";
}

/**
 * Resolved text color for contrast evaluation: kineticText.fill, cta.textColor, chart.labelColor.
 * Gradient fill is skipped (returns null).
 */
export function resolveTextColor(
  layer: SceneSpec["layers"][number],
  themePreset?: ThemePreset
): { color: string; field: "fill" | "textColor" | "labelColor" } | null {
  if (layer.type === "kineticText") {
    const rawFill = layer.fill;
    if (typeof rawFill === "string") {
      if (rawFill.toLowerCase() === "#ffffff" || rawFill.toLowerCase() === "#fff") {
        const themeColor = themePreset ? THEME_TOKENS[themePreset]?.textPrimary : undefined;
        return { color: themeColor ?? "#ffffff", field: "fill" };
      }
      return { color: rawFill, field: "fill" };
    }
    if (rawFill === undefined) {
      const themeColor = themePreset ? THEME_TOKENS[themePreset]?.textPrimary : undefined;
      return { color: themeColor ?? "#ffffff", field: "fill" };
    }
    // Gradient fill object is skipped
    return null;
  }
  if (layer.type === "cta") {
    if (typeof layer.textColor === "string") {
      return { color: layer.textColor, field: "textColor" };
    }
    return null;
  }
  if (layer.type === "chart") {
    const col = layer.labelColor ?? "#cbd5e1";
    if (typeof col === "string") {
      return { color: col, field: "labelColor" };
    }
    return null;
  }
  return null;
}

/**
 * Lighten on dark background or darken on light background until contrast >= targetContrast.
 */
export function adjustColorForContrast(
  currentColorStr: string,
  bgColorStr: string,
  targetContrast = 7.0
): string {
  const fg = parseCssColor(currentColorStr);
  const bg = parseCssColor(bgColorStr);
  if (!fg || !bg) return currentColorStr;

  const bgLum = relativeLuminance(bg.r, bg.g, bg.b);
  const targetR = bgLum < 0.5 ? 255 : 0;
  const targetG = bgLum < 0.5 ? 255 : 0;
  const targetB = bgLum < 0.5 ? 255 : 0;

  let bestHex = currentColorStr;
  for (let step = 1; step <= 50; step++) {
    const t = step / 50;
    const r = Math.round(fg.r + (targetR - fg.r) * t);
    const g = Math.round(fg.g + (targetG - fg.g) * t);
    const b = Math.round(fg.b + (targetB - fg.b) * t);

    const cr = Math.round(fg.a * r + (1 - fg.a) * bg.r);
    const cg = Math.round(fg.a * g + (1 - fg.a) * bg.g);
    const cb = Math.round(fg.a * b + (1 - fg.a) * bg.b);

    const lFg = relativeLuminance(cr, cg, cb);
    const lBg = relativeLuminance(bg.r, bg.g, bg.b);
    const ratio = (Math.max(lFg, lBg) + 0.05) / (Math.min(lFg, lBg) + 0.05);

    const toHex = (n: number) => n.toString(16).padStart(2, "0");
    bestHex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    if (ratio >= targetContrast) {
      break;
    }
  }

  return bestHex;
}

function extractKeyframeTime(kf: unknown): number | undefined {
  if (!kf || typeof kf !== "object") return undefined;
  const rec = kf as Record<string, unknown>;
  if (typeof rec.timeMs === "number") return rec.timeMs;
  if (typeof rec.at === "number") return rec.at;
  return undefined;
}

/**
 * Evaluate the 7 critique rules deterministically over the scene, bounds, and warnings.
 */
export function evaluateCritiqueIssues(
  scene: SceneSpec,
  bounds: SceneBoundsReport,
  warnings: SceneWarning[]
): CritiqueIssue[] {
  const issueMap = new Map<string, CritiqueIssue>();

  // 1. FOREGROUND_OVERLAP
  for (const frame of bounds.frames) {
    for (const overlap of frame.overlaps) {
      if (overlap.areaPx2 > 400) {
        const pair = [overlap.a, overlap.b].sort();
        const key = `FOREGROUND_OVERLAP:${pair.join(":")}`;
        const existing = issueMap.get(key);
        if (!existing) {
          issueMap.set(key, {
            rule: "FOREGROUND_OVERLAP",
            severity: "error",
            atMs: frame.atMs,
            layerIds: pair,
            message: `Foreground layers "${pair[0]}" and "${pair[1]}" overlap by ${overlap.areaPx2} px^2 at ${frame.atMs}ms`,
            autoFixable: true,
          });
        } else if (typeof existing.atMs === "number" && frame.atMs < existing.atMs) {
          existing.atMs = frame.atMs;
        }
      }
    }
  }

  // 2. SAFE_MARGIN_VIOLATION
  const W = bounds.canvas.width;
  const H = bounds.canvas.height;
  const minSafeX = 0.04 * W;
  const maxSafeX = 0.96 * W;
  const minSafeY = 0.04 * H;
  const maxSafeY = 0.96 * H;

  for (const frame of bounds.frames) {
    for (const layer of frame.layers) {
      if (isFullBleedLayerType(layer.type)) continue;
      if (layer.opacity <= VISIBLE_OPACITY) continue;
      if (layer.lifecyclePhase === "entrance" || layer.lifecyclePhase === "exit") continue;

      const box = layer.bbox;
      if (box.width <= 0 || box.height <= 0) continue;

      const isOutside =
        box.x < minSafeX - 0.5 ||
        box.x + box.width > maxSafeX + 0.5 ||
        box.y < minSafeY - 0.5 ||
        box.y + box.height > maxSafeY + 0.5;

      if (isOutside) {
        const key = `SAFE_MARGIN_VIOLATION:${layer.id}`;
        const existing = issueMap.get(key);
        if (!existing) {
          issueMap.set(key, {
            rule: "SAFE_MARGIN_VIOLATION",
            severity: "warning",
            atMs: frame.atMs,
            layerIds: [layer.id],
            message: `Layer "${layer.id}" extends outside 4%..96% title-safe zone at ${frame.atMs}ms (bbox: x=${Math.round(box.x)}, y=${Math.round(box.y)}, w=${Math.round(box.width)}, h=${Math.round(box.height)})`,
            autoFixable: true,
          });
        } else if (typeof existing.atMs === "number" && frame.atMs < existing.atMs) {
          existing.atMs = frame.atMs;
        }
      }
    }
  }

  // 3. LOW_CONTRAST
  const bgBase = resolveBackgroundBase(scene);
  for (const layer of scene.layers) {
    if (isFullBleedLayerType(layer.type)) continue;
    const resolved = resolveTextColor(layer, scene.themePreset);
    if (!resolved) continue;

    const ratio = contrastRatio(resolved.color, bgBase);
    if (ratio !== null && ratio < 4.2) {
      const key = `LOW_CONTRAST:${layer.id}`;
      if (!issueMap.has(key)) {
        issueMap.set(key, {
          rule: "LOW_CONTRAST",
          severity: "error",
          atMs: layer.at ?? 0,
          layerIds: [layer.id],
          message: `Text color ${resolved.color} on layer "${layer.id}" has low contrast ratio (${ratio.toFixed(2)}:1 < 4.2:1) against background ${bgBase}`,
          autoFixable: true,
        });
      }
    }
  }

  // 4. DEAD_AIR_FRAME
  for (const frame of bounds.frames) {
    const visibleCount =
      frame.foreground.length > 0
        ? frame.foreground.length
        : frame.layers.filter(
            (l) => !isFullBleedLayerType(l.type) && l.opacity > VISIBLE_OPACITY
          ).length;

    if (visibleCount === 0) {
      const key = `DEAD_AIR_FRAME:${frame.atMs}`;
      if (!issueMap.has(key)) {
        issueMap.set(key, {
          rule: "DEAD_AIR_FRAME",
          severity: "warning",
          atMs: frame.atMs,
          layerIds: [],
          message: `Dead air frame at ${frame.atMs}ms: zero visible foreground layers`,
          autoFixable: true,
        });
      }
    }
  }

  // 5. VISUAL_CLUTTER
  for (const frame of bounds.frames) {
    const visibleCount =
      frame.foreground.length > 0
        ? frame.foreground.length
        : frame.layers.filter(
            (l) => !isFullBleedLayerType(l.type) && l.opacity > VISIBLE_OPACITY
          ).length;

    if (visibleCount > 6) {
      const key = `VISUAL_CLUTTER:${frame.atMs}`;
      if (!issueMap.has(key)) {
        issueMap.set(key, {
          rule: "VISUAL_CLUTTER",
          severity: "warning",
          atMs: frame.atMs,
          layerIds: frame.foreground.slice(),
          message: `Visual clutter at ${frame.atMs}ms: ${visibleCount} visible foreground layers (maximum recommended is 6)`,
          autoFixable: false,
        });
      }
    }
  }

  // 6. TIMING_OVERFLOW
  for (const layer of scene.layers) {
    let hasOverflow = false;
    let earliestAt = scene.durationMs;

    if (typeof layer.at === "number" && layer.at > scene.durationMs) {
      hasOverflow = true;
      earliestAt = Math.min(earliestAt, layer.at);
    } else if (
      typeof layer.duration === "number" &&
      (layer.at ?? 0) + layer.duration > scene.durationMs
    ) {
      hasOverflow = true;
      earliestAt = Math.min(earliestAt, (layer.at ?? 0) + layer.duration);
    }

    if (Array.isArray(layer.keyframes)) {
      for (const kf of layer.keyframes) {
        const kfTime = extractKeyframeTime(kf);
        if (typeof kfTime === "number" && kfTime > scene.durationMs) {
          hasOverflow = true;
          earliestAt = Math.min(earliestAt, kfTime);
        }
      }
    }

    if (Array.isArray(layer.tracks)) {
      for (const tr of layer.tracks) {
        for (const kf of tr.keyframes ?? []) {
          const kfTime = extractKeyframeTime(kf);
          if (typeof kfTime === "number" && kfTime > scene.durationMs) {
            hasOverflow = true;
            earliestAt = Math.min(earliestAt, kfTime);
          }
        }
      }
    }

    if (hasOverflow) {
      const key = `TIMING_OVERFLOW:${layer.id}`;
      if (!issueMap.has(key)) {
        issueMap.set(key, {
          rule: "TIMING_OVERFLOW",
          severity: "error",
          atMs: earliestAt,
          layerIds: [layer.id],
          message: `Layer "${layer.id}" extends past scene duration (${scene.durationMs}ms)`,
          autoFixable: true,
        });
      }
    }
  }

  if (Array.isArray(scene.camera?.keyframes)) {
    let earliestCameraAt = scene.durationMs;
    let cameraOverflow = false;
    for (const kf of scene.camera.keyframes) {
      if (kf.at > scene.durationMs) {
        cameraOverflow = true;
        earliestCameraAt = Math.min(earliestCameraAt, kf.at);
      }
    }
    if (cameraOverflow) {
      const key = `TIMING_OVERFLOW:camera`;
      if (!issueMap.has(key)) {
        issueMap.set(key, {
          rule: "TIMING_OVERFLOW",
          severity: "error",
          atMs: earliestCameraAt,
          layerIds: ["camera"],
          message: `Camera keyframe at ${earliestCameraAt}ms extends past scene duration (${scene.durationMs}ms)`,
          autoFixable: true,
        });
      }
    }
  }

  // 7. RENDER_COST_HAZARD
  for (const warning of warnings) {
    if (warning.code === "FILTERED_LAYER_LARGE_SCALE") {
      const match = warning.path.match(/^layers\.(\d+)/);
      const idx = match && match[1] !== undefined ? parseInt(match[1], 10) : -1;
      const layer = idx >= 0 ? scene.layers[idx] : undefined;
      const layerId = layer?.id ?? (warning.detail?.layerId as string) ?? `layer-${idx}`;
      const key = `RENDER_COST_HAZARD:${layerId}`;
      if (!issueMap.has(key)) {
        issueMap.set(key, {
          rule: "RENDER_COST_HAZARD",
          severity: "warning",
          atMs: null,
          layerIds: [layerId],
          message: warning.message,
          autoFixable: true,
        });
      }
    }
  }

  const issues = Array.from(issueMap.values());
  issues.sort((a, b) => {
    const rA = RULE_ORDER[a.rule] ?? 99;
    const rB = RULE_ORDER[b.rule] ?? 99;
    if (rA !== rB) return rA - rB;
    const tA = a.atMs ?? -1;
    const tB = b.atMs ?? -1;
    if (tA !== tB) return tA - tB;
    return a.layerIds.join(",").localeCompare(b.layerIds.join(","));
  });

  return issues;
}

/**
 * Deterministic scoring:
 * Start at 100 and subtract, capped at 0:
 * overlap 15 per distinct layer pair; margin 10 per layer; contrast 12 per layer;
 * dead air 8 per timestamp; clutter 6 per timestamp; timing 20 per layer; cost 10 per warning.
 */
export function computeCritiqueScore(issues: CritiqueIssue[]): number {
  let score = 100;
  for (const issue of issues) {
    switch (issue.rule) {
      case "FOREGROUND_OVERLAP":
        score -= 15;
        break;
      case "SAFE_MARGIN_VIOLATION":
        score -= 10;
        break;
      case "LOW_CONTRAST":
        score -= 12;
        break;
      case "DEAD_AIR_FRAME":
        score -= 8;
        break;
      case "VISUAL_CLUTTER":
        score -= 6;
        break;
      case "TIMING_OVERFLOW":
        score -= 20;
        break;
      case "RENDER_COST_HAZARD":
        score -= 10;
        break;
    }
  }
  return Math.max(0, Math.min(100, score));
}

/**
 * Apply auto-fixes in exact order:
 * 1. Overlap (up to 4 passes)
 * 2. Safe margin
 * 3. Contrast
 * 4. Dead air
 * 5. Cost
 * 6. Timing
 */
export function applyAutoFixes(
  scene: SceneSpec,
  issues: CritiqueIssue[],
  bounds: SceneBoundsReport
): { fixedScene: SceneSpec; appliedFixes: string[] } {
  const fixedScene: SceneSpec = JSON.parse(JSON.stringify(scene));
  const appliedFixes: string[] = [];

  const W = bounds.canvas.width;
  const H = bounds.canvas.height;
  const targetGapY = 0.03 * H;
  const targetGapX = 0.03 * W;

  const boxMap = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const frame of bounds.frames) {
    for (const layer of frame.layers) {
      if (!boxMap.has(layer.id) && layer.bbox.width > 0 && layer.bbox.height > 0) {
        boxMap.set(layer.id, { ...layer.bbox });
      }
    }
  }

  // 1. Overlap: up to 4 passes
  for (let pass = 0; pass < 4; pass++) {
    let anyFixedInPass = false;
    for (const issue of issues) {
      if (issue.rule !== "FOREGROUND_OVERLAP") continue;
      const idA = issue.layerIds[0];
      const idB = issue.layerIds[1];
      if (!idA || !idB) continue;

      const layerA = fixedScene.layers.find((l) => l.id === idA);
      const layerB = fixedScene.layers.find((l) => l.id === idB);
      if (!layerA || !layerB) continue;

      const posA = layerA.position ?? { xPct: 50, yPct: 50 };
      const posB = layerB.position ?? { xPct: 50, yPct: 50 };
      layerA.position = posA;
      layerB.position = posB;

      const boxA = boxMap.get(idA);
      const boxB = boxMap.get(idB);
      if (!boxA || !boxB) continue;

      const overlapW = Math.min(boxA.x + boxA.width, boxB.x + boxB.width) - Math.max(boxA.x, boxB.x);
      const overlapH = Math.min(boxA.y + boxA.height, boxB.y + boxB.height) - Math.max(boxA.y, boxB.y);
      if (overlapW <= 0 || overlapH <= 0 || overlapW * overlapH <= 400) continue;

      const topLayer = posA.yPct <= posB.yPct ? layerA : layerB;
      const bottomLayer = topLayer === layerA ? layerB : layerA;
      const topPos = topLayer === layerA ? posA : posB;
      const bottomPos = topLayer === layerA ? posB : posA;
      const topBox = topLayer === layerA ? boxA : boxB;
      const bottomBox = topLayer === layerA ? boxB : boxA;

      const neededPx = (topBox.y + topBox.height + targetGapY) - bottomBox.y;
      const neededPct = (neededPx / H) * 100;

      const availUp = topPos.yPct - 8;
      const availDown = 92 - bottomPos.yPct;

      if (availUp + availDown >= neededPct && neededPct > 0) {
        let moveUp = Math.min(availUp, neededPct / 2);
        let moveDown = Math.min(availDown, neededPct / 2);
        if (moveUp < neededPct / 2) {
          moveDown = Math.min(availDown, neededPct - moveUp);
        } else if (moveDown < neededPct / 2) {
          moveUp = Math.min(availUp, neededPct - moveDown);
        }
        topPos.yPct = Number((topPos.yPct - moveUp).toFixed(1));
        bottomPos.yPct = Number((bottomPos.yPct + moveDown).toFixed(1));
        topBox.y -= (moveUp / 100) * H;
        bottomBox.y += (moveDown / 100) * H;
        appliedFixes.push(
          `Separated overlapping foreground layers "${topLayer.id}" and "${bottomLayer.id}" vertically (adjusted yPct to ${topPos.yPct}% and ${bottomPos.yPct}%)`
        );
        anyFixedInPass = true;
      } else {
        const minW = Math.min(boxA.width, boxB.width);
        const hRatio = minW > 0 ? overlapW / minW : 0;
        if (hRatio > 0.6) {
          const leftLayer = topPos.xPct <= bottomPos.xPct ? topLayer : bottomLayer;
          const rightLayer = leftLayer === topLayer ? bottomLayer : topLayer;
          const leftPos = leftLayer === topLayer ? topPos : bottomPos;
          const rightPos = leftLayer === topLayer ? bottomPos : topPos;
          const leftBox = leftLayer === topLayer ? topBox : bottomBox;
          const rightBox = leftLayer === topLayer ? bottomBox : topBox;
          const neededXPx = (leftBox.x + leftBox.width + targetGapX) - rightBox.x;
          if (neededXPx > 0) {
            const neededXPct = (neededXPx / W) * 100;
            const availLeft = leftPos.xPct - 8;
            const availRight = 92 - rightPos.xPct;
            let moveLeft = Math.min(availLeft, neededXPct / 2);
            let moveRight = Math.min(availRight, neededXPct / 2);
            if (moveLeft < neededXPct / 2) {
              moveRight = Math.min(availRight, neededXPct - moveLeft);
            } else if (moveRight < neededXPct / 2) {
              moveLeft = Math.min(availLeft, neededXPct - moveRight);
            }
            leftPos.xPct = Number((leftPos.xPct - moveLeft).toFixed(1));
            rightPos.xPct = Number((rightPos.xPct + moveRight).toFixed(1));
            leftBox.x -= (moveLeft / 100) * W;
            rightBox.x += (moveRight / 100) * W;
            appliedFixes.push(
              `Separated overlapping foreground layers "${leftLayer.id}" and "${rightLayer.id}" horizontally (adjusted xPct to ${leftPos.xPct}% and ${rightPos.xPct}%)`
            );
            anyFixedInPass = true;
          }
        }
      }
    }
    if (!anyFixedInPass) break;
  }

  // 2. Safe margin
  const minSafeX = 0.04 * W;
  const maxSafeX = 0.96 * W;
  const minSafeY = 0.04 * H;
  const maxSafeY = 0.96 * H;

  for (const issue of issues) {
    if (issue.rule !== "SAFE_MARGIN_VIOLATION") continue;
    const layerId = issue.layerIds[0];
    if (!layerId) continue;

    const layer = fixedScene.layers.find((l) => l.id === layerId);
    if (!layer) continue;

    const box = boxMap.get(layerId);
    if (!box) continue;

    if (box.width > 0.92 * W || box.height > 0.92 * H) {
      layer.scale = Number(((layer.scale ?? 1) * 0.85).toFixed(3));
      box.width *= 0.85;
      box.height *= 0.85;
      appliedFixes.push(`Reduced scale of layer "${layer.id}" by 15% to fit safe margin bounds`);
      if (box.width > 0.92 * W || box.height > 0.92 * H) {
        layer.scale = Number((layer.scale * 0.85).toFixed(3));
        box.width *= 0.85;
        box.height *= 0.85;
        appliedFixes.push(
          `Reduced scale of layer "${layer.id}" by an additional 15% to fit safe margin bounds`
        );
      }
    }

    const pos = layer.position ?? { xPct: 50, yPct: 50 };
    layer.position = pos;
    let posChanged = false;

    if (box.x < minSafeX) {
      const shiftPx = minSafeX - box.x + 2;
      const shiftPct = (shiftPx / W) * 100;
      pos.xPct = Math.min(
        96,
        Math.max(4, Number((pos.xPct + shiftPct).toFixed(1)))
      );
      box.x += shiftPx;
      posChanged = true;
    } else if (box.x + box.width > maxSafeX) {
      const shiftPx = box.x + box.width - maxSafeX + 2;
      const shiftPct = (shiftPx / W) * 100;
      pos.xPct = Math.min(
        96,
        Math.max(4, Number((pos.xPct - shiftPct).toFixed(1)))
      );
      box.x -= shiftPx;
      posChanged = true;
    }

    if (box.y < minSafeY) {
      const shiftPx = minSafeY - box.y + 2;
      const shiftPct = (shiftPx / H) * 100;
      pos.yPct = Math.min(
        96,
        Math.max(4, Number((pos.yPct + shiftPct).toFixed(1)))
      );
      box.y += shiftPx;
      posChanged = true;
    } else if (box.y + box.height > maxSafeY) {
      const shiftPx = box.y + box.height - maxSafeY + 2;
      const shiftPct = (shiftPx / H) * 100;
      pos.yPct = Math.min(
        96,
        Math.max(4, Number((pos.yPct - shiftPct).toFixed(1)))
      );
      box.y -= shiftPx;
      posChanged = true;
    }

    if (posChanged) {
      appliedFixes.push(
        `Clamped position of layer "${layer.id}" to stay inside safe margins (xPct: ${pos.xPct}%, yPct: ${pos.yPct}%)`
      );
    }
  }

  // 3. Contrast
  const bgBase = resolveBackgroundBase(fixedScene);
  for (const issue of issues) {
    if (issue.rule !== "LOW_CONTRAST") continue;
    const layerId = issue.layerIds[0];
    if (!layerId) continue;

    const layer = fixedScene.layers.find((l) => l.id === layerId);
    if (!layer) continue;

    const resolved = resolveTextColor(layer, fixedScene.themePreset);
    if (!resolved) continue;

    const newColor = adjustColorForContrast(resolved.color, bgBase, 7.0);
    if (layer.type === "kineticText") {
      layer.fill = newColor;
    } else if (layer.type === "cta") {
      layer.textColor = newColor;
    } else if (layer.type === "chart") {
      layer.labelColor = newColor;
    }
    appliedFixes.push(
      `Adjusted text color of layer "${layer.id}" to ${newColor} for WCAG contrast >= 7:1 against ${bgBase}`
    );
  }

  // 4. Dead air
  const deadAirIssues = issues
    .filter((i) => i.rule === "DEAD_AIR_FRAME" && typeof i.atMs === "number")
    .sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0));

  for (const issue of deadAirIssues) {
    const t = issue.atMs!;
    const fgLayers = fixedScene.layers.filter((l) => !isFullBleedLayerType(l.type));
    if (fgLayers.length === 0) continue;

    const firstFg = fgLayers[0];
    if (!firstFg) continue;

    let bestLayer = firstFg;
    let bestDist = Infinity;
    let isBefore = false;

    for (const l of fgLayers) {
      const at = l.at ?? 0;
      const dur = l.duration ?? (fixedScene.durationMs - at);
      const end = at + dur;
      if (t < at) {
        const d = at - t;
        if (d < bestDist) {
          bestDist = d;
          bestLayer = l;
          isBefore = true;
        }
      } else if (t > end) {
        const d = t - end;
        if (d < bestDist) {
          bestDist = d;
          bestLayer = l;
          isBefore = false;
        }
      } else {
        bestDist = 0;
        break;
      }
    }

    if (bestDist > 0 && bestDist < Infinity) {
      if (isBefore) {
        const oldAt = bestLayer.at ?? 0;
        const oldDur = bestLayer.duration ?? (fixedScene.durationMs - oldAt);
        const newAt = Math.max(0, t);
        bestLayer.at = newAt;
        bestLayer.duration = Math.min(fixedScene.durationMs - newAt, oldAt - newAt + oldDur);
        appliedFixes.push(
          `Extended window of layer "${bestLayer.id}" to cover dead air at ${t}ms (at: ${bestLayer.at}ms, duration: ${bestLayer.duration}ms)`
        );
      } else {
        const at = bestLayer.at ?? 0;
        const newDur = Math.min(fixedScene.durationMs - at, t - at + 250);
        bestLayer.duration = newDur;
        appliedFixes.push(
          `Extended duration of layer "${bestLayer.id}" to cover dead air at ${t}ms (duration: ${newDur}ms)`
        );
      }
    }
  }

  // 5. Cost
  for (const issue of issues) {
    if (issue.rule !== "RENDER_COST_HAZARD") continue;
    const layerId = issue.layerIds[0];
    if (!layerId) continue;

    const layer = fixedScene.layers.find((l) => l.id === layerId);
    if (!layer) continue;

    let clamped = false;
    if (typeof layer.scale === "number" && layer.scale > 3.5) {
      layer.scale = 3.5;
      clamped = true;
    }
    if (Array.isArray(layer.keyframes)) {
      for (const kf of layer.keyframes) {
        if (kf.property === "scale" && typeof kf.value === "number" && kf.value > 3.5) {
          kf.value = 3.5;
          clamped = true;
        }
      }
    }
    if (Array.isArray(layer.tracks)) {
      for (const tr of layer.tracks) {
        if (tr.property === "scale" && Array.isArray(tr.keyframes)) {
          for (const kf of tr.keyframes) {
            if (typeof kf.value === "number" && kf.value > 3.5) {
              kf.value = 3.5;
              clamped = true;
            }
          }
        }
      }
    }
    if (clamped) {
      appliedFixes.push(
        `Clamped scale of layer "${layer.id}" to 3.5 to resolve FILTERED_LAYER_LARGE_SCALE`
      );
    }
  }

  // 6. Timing
  for (const issue of issues) {
    if (issue.rule !== "TIMING_OVERFLOW") continue;
    const targetId = issue.layerIds[0];
    if (!targetId) continue;

    if (targetId === "camera") {
      if (Array.isArray(fixedScene.camera?.keyframes)) {
        const origLen = fixedScene.camera.keyframes.length;
        fixedScene.camera.keyframes = fixedScene.camera.keyframes.filter(
          (kf) => kf.at <= fixedScene.durationMs
        );
        if (fixedScene.camera.keyframes.length < origLen) {
          appliedFixes.push(
            `Dropped camera keyframes past scene duration (${fixedScene.durationMs}ms)`
          );
        }
      }
    } else {
      const layer = fixedScene.layers.find((l) => l.id === targetId);
      if (!layer) continue;

      let changed = false;
      if (typeof layer.at === "number" && layer.at > fixedScene.durationMs) {
        layer.at = Math.max(0, fixedScene.durationMs - 500);
        layer.duration = fixedScene.durationMs - layer.at;
        changed = true;
      } else if (
        typeof layer.duration === "number" &&
        (layer.at ?? 0) + layer.duration > fixedScene.durationMs
      ) {
        layer.duration = Math.max(0, fixedScene.durationMs - (layer.at ?? 0));
        changed = true;
      }
      if (Array.isArray(layer.keyframes)) {
        const origLen = layer.keyframes.length;
        layer.keyframes = layer.keyframes.filter((kf) => {
          const kfTime = extractKeyframeTime(kf);
          return typeof kfTime === "number" ? kfTime <= fixedScene.durationMs : true;
        });
        if (layer.keyframes.length < origLen) changed = true;
      }
      if (Array.isArray(layer.tracks)) {
        for (const tr of layer.tracks) {
          if (Array.isArray(tr.keyframes)) {
            const origLen = tr.keyframes.length;
            tr.keyframes = tr.keyframes.filter((kf) => {
              const kfTime = extractKeyframeTime(kf);
              return typeof kfTime === "number" ? kfTime <= fixedScene.durationMs : true;
            });
            if (tr.keyframes.length < origLen) changed = true;
          }
        }
      }
      if (changed) {
        appliedFixes.push(
          `Clamped timing and dropped overflow keyframes for layer "${layer.id}"`
        );
      }
    }
  }

  return { fixedScene, appliedFixes };
}
