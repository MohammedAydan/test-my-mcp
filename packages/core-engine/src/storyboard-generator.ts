import { z } from "zod";
import type {
  AnyLayerInput,
  Canvas,
  LayoutSlot,
  SceneSpec,
  SceneSpecInput,
  ThemePreset,
} from "@motionforge/scene-spec";
import {
  FOREGROUND_LAYER_TYPES,
  LAYOUT_SLOT_BOXES,
  sceneSpecSchema,
  THEME_TOKENS,
  themePresetSchema,
} from "@motionforge/scene-spec";
import type { EngineCore } from "./engine-core.js";

export interface BriefMetric {
  label: string;
  value: string;
  numericValue?: number;
  delta?: string;
}

export interface BriefFeature {
  title: string;
  description: string;
}

export interface StoryboardBrief {
  projectTitle: string;            // 1..100
  productName: string;             // 1..60
  tagline: string;                 // 1..140
  keyMetrics?: BriefMetric[];      // 1..4
  features?: BriefFeature[];       // 1..6
  codeSnippet?: { language: string; code: string };
  ctaText?: string;                // default "Start Building Free"
  ctaUrl?: string;                 // default "motionforge.ai"
  themePreset?: ThemePreset;       // default "linearMinimal"
  sceneCount?: number;             // 2..5, default 3
  sceneDurationMs?: number;        // 3000..8000, default 4000
  autoCritiqueAndFix?: boolean;    // default true
  autoChoreographAudio?: boolean;  // default true
}

export interface StoryboardSceneSummary {
  sceneId: string;
  name: string;
  durationMs: number;
  layerKinds: string[];
  score: number;
  cueCount: number;
}

export interface StoryboardReport {
  projectTitle: string;
  themePreset: ThemePreset;
  totalDurationMs: number;
  scenes: StoryboardSceneSummary[];
  manifest: { sceneId: string; index: number; role: string; transitionToNext: string }[];
}

export const briefMetricSchema = z.strictObject({
  label: z.string().min(1).max(80),
  value: z.string().min(1).max(40),
  numericValue: z.number().finite().optional(),
  delta: z.string().max(40).optional(),
});

export const briefFeatureSchema = z.strictObject({
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(200),
});

export const storyboardBriefSchema = z.strictObject({
  projectTitle: z.string().min(1).max(100),
  productName: z.string().min(1).max(60),
  tagline: z.string().min(1).max(140),
  keyMetrics: z.array(briefMetricSchema).min(1).max(4).optional(),
  features: z.array(briefFeatureSchema).min(1).max(6).optional(),
  codeSnippet: z
    .strictObject({
      language: z.string().min(1).max(40),
      code: z.string().min(1).max(8000),
    })
    .optional(),
  ctaText: z.string().min(1).max(80).default("Start Building Free"),
  ctaUrl: z.string().min(1).max(120).default("motionforge.ai"),
  themePreset: themePresetSchema.default("linearMinimal"),
  sceneCount: z.number().int().min(2).max(5).default(3),
  sceneDurationMs: z.number().int().min(3000).max(8000).default(4000),
  autoCritiqueAndFix: z.boolean().default(true),
  autoChoreographAudio: z.boolean().default(true),
});

/**
 * Deterministic slug generator for storyboard project titles.
 * Lowercase, non-alphanumerics -> '-', trim leading/trailing dashes, max 40 chars.
 * Falls back to 'storyboard' if empty.
 */
export function slug(title: string): string {
  const cleaned = (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "storyboard";
}

/** Keep a generated headline inside the top-header slot. */
function fitHeadline(text: string): string {
  const cleaned = (text || "").trim();
  return cleaned.length > 64 ? `${cleaned.slice(0, 61).trimEnd()}...` : cleaned;
}

/**
 * Parses numeric value from a brief metric, extracting prefix/suffix.
 */
export function parseMetricNumber(metric: BriefMetric): {
  toValue: number;
  prefix: string;
  suffix: string;
  decimals: number;
} {
  if (typeof metric.numericValue === "number" && Number.isFinite(metric.numericValue)) {
    const valStr = metric.value.trim();
    const match = valStr.match(/^([^\d.-]*)([\d,.-]+)?([^\d.-]*)$/);
    const prefix = (match?.[1]?.trim() ?? "").slice(0, 12);
    const suffix = (match?.[3]?.trim() ?? "").slice(0, 16);
    const decStr = metric.numericValue.toString().split(".")[1];
    const decimals = decStr ? Math.min(4, decStr.length) : 0;
    return { toValue: metric.numericValue, prefix, suffix, decimals };
  }
  const str = metric.value.trim();
  const match = str.match(/^([^\d.-]*)([\d,.-]+)([^\d.-]*)$/);
  if (match && match[2]) {
    const cleanedNum = match[2].replace(/,/g, "");
    const parsed = parseFloat(cleanedNum);
    if (Number.isFinite(parsed)) {
      const decStr = cleanedNum.split(".")[1];
      const decimals = decStr ? Math.min(4, decStr.length) : 0;
      return {
        toValue: parsed,
        prefix: (match[1]?.trim() ?? "").slice(0, 12),
        suffix: (match[3]?.trim() ?? "").slice(0, 16),
        decimals,
      };
    }
  }
  const digitMatch = str.match(/-?\d+(\.\d+)?/);
  if (digitMatch) {
    const parsed = parseFloat(digitMatch[0]);
    if (Number.isFinite(parsed)) {
      const decStr = digitMatch[0].split(".")[1];
      const decimals = decStr ? Math.min(4, decStr.length) : 0;
      return {
        toValue: parsed,
        prefix: "",
        suffix: str.replace(digitMatch[0], "").trim().slice(0, 16),
        decimals,
      };
    }
  }
  return { toValue: 99.9, prefix: "", suffix: str.slice(0, 16), decimals: 1 };
}

/**
 * Normalizes key metrics so layers like chart and bento have at least 2 entries.
 */
export function normalizeMetrics(productName: string, raw?: BriefMetric[]): BriefMetric[] {
  const defaults: BriefMetric[] = [
    { label: `${productName} Adoption`, value: "10x", numericValue: 10, delta: "+45% MoM" },
    { label: "System Uptime", value: "99.99%", numericValue: 99.99, delta: "SLA Guaranteed" },
    { label: "Render Speed", value: "60 FPS", numericValue: 60, delta: "Real-time" },
  ];
  if (!raw || raw.length === 0) {
    return defaults;
  }
  const metrics = [...raw];
  if (metrics.length < 2) {
    for (const d of defaults) {
      if (metrics.length >= 2) break;
      if (!metrics.some((m) => m.label.toLowerCase() === d.label.toLowerCase())) {
        metrics.push(d);
      }
    }
  }
  return metrics.slice(0, 4);
}

/**
 * Normalizes features so layers like bentoGrid (4 cells) and connectorDiagram have sufficient entries.
 */
export function normalizeFeatures(tagline: string, productName: string, raw?: BriefFeature[]): BriefFeature[] {
  const defaults: BriefFeature[] = [
    { title: "Deterministic Core", description: `Engineered performance for ${productName}` },
    { title: "Real-time Telemetry", description: "Frame-accurate precision across every layer" },
    { title: "Autonomous Layout", description: "Constraint-based responsive slot positioning" },
    { title: "Cloud Scale", description: `Production ready infrastructure for ${productName}` },
  ];
  if (!raw || raw.length === 0) {
    return defaults;
  }
  const features = [...raw];
  if (features.length < 4) {
    for (const d of defaults) {
      if (features.length >= 4) break;
      if (!features.some((f) => f.title.toLowerCase() === d.title.toLowerCase())) {
        features.push(d);
      }
    }
  }
  return features.slice(0, 6);
}

export type SceneArchetypeRole = "hook" | "product" | "proof" | "features" | "close";

export const SCENE_ARCHETYPES: readonly SceneArchetypeRole[] = [
  "hook",
  "product",
  "proof",
  "features",
  "close",
] as const;

/**
 * Constructs the raw SceneSpec for a given archetype index.
 */
function buildSceneSpecForArchetype(
  role: SceneArchetypeRole,
  sceneId: string,
  brief: Required<StoryboardBrief>,
  metrics: BriefMetric[],
  features: BriefFeature[]
): SceneSpecInput {
  const durationMs = brief.sceneDurationMs;
  const tokens = THEME_TOKENS[brief.themePreset];
  const canvas: Canvas = { shape: "16:9", scale: 1080 };
  const baseScene: SceneSpecInput = {
    schemaVersion: 1,
    id: sceneId,
    name: `${brief.projectTitle} - ${role}`,
    canvas,
    durationMs,
    themePreset: brief.themePreset,
    assets: [],
    fonts: [],
    transitions: [],
    audio: { cues: [] },
    layers: [],
  };

  const m0 = metrics[0]!;
  const p0 = parseMetricNumber(m0);

  switch (role) {
    case "hook": {
      // 1. hook: background meshGradient + kineticText (topHeader) + metricTicker from keyMetrics[0] + bentoGrid (centerStage)
      const layers: AnyLayerInput[] = [
        {
          id: `${sceneId}-bg`,
          type: "background",
          trackIndex: 0,
          at: 0,
          duration: durationMs,
          variant: {
            variant: "meshGradient",
            base: tokens.bgBase,
            blobs: [
              { color: tokens.bgBlobs[0], xPct: 25, yPct: 30, radiusPct: 45, drift: 0.3 },
              { color: tokens.bgBlobs[1], xPct: 75, yPct: 70, radiusPct: 50, drift: 0.3 },
              { color: tokens.bgBlobs[2], xPct: 50, yPct: 50, radiusPct: 40, drift: 0.3 },
            ],
          },
        },
        {
          id: `${sceneId}-title`,
          type: "kineticText",
          trackIndex: 1,
          layoutSlot: "topHeader",
          position: { xPct: 50, yPct: 16 },
          size: { widthPct: 82, heightPct: 14 },
          text: fitHeadline(brief.projectTitle || brief.tagline),
          sizePx: 48,
          fill: tokens.textPrimary,
          at: 0,
          duration: durationMs,
        },
        {
          id: `${sceneId}-ticker`,
          type: "metricTicker",
          trackIndex: 2,
          layoutSlot: "topSubhead",
          position: { xPct: 50, yPct: 30 },
          size: { widthPct: 60, heightPct: 12 },
          label: m0.label.slice(0, 80),
          toValue: p0.toValue,
          prefix: p0.prefix,
          suffix: p0.suffix,
          decimals: p0.decimals,
          deltaBadge: m0.delta ? m0.delta.slice(0, 24) : undefined,
          accentColor: tokens.accentPrimary,
          at: 0,
          duration: durationMs,
        },
        {
          id: `${sceneId}-bento`,
          type: "bentoGrid",
          trackIndex: 3,
          layoutSlot: "centerStage",
          position: { xPct: 50, yPct: 56 },
          size: { widthPct: 44, heightPct: 24 },
          columns: 2,
          cells: [
            {
              title: features[0]!.title.slice(0, 80),
              subtitle: features[0]!.description.slice(0, 140),
              spanCols: 1,
              accentColor: tokens.accentPrimary,
            },
            {
              title: features[1]!.title.slice(0, 80),
              subtitle: features[1]!.description.slice(0, 140),
              spanCols: 1,
              accentColor: tokens.accentSecondary,
            },
            {
              title: features[2]!.title.slice(0, 80),
              subtitle: features[2]!.description.slice(0, 140),
              spanCols: 1,
            },
            {
              title: features[3]!.title.slice(0, 80),
              subtitle: features[3]!.description.slice(0, 140),
              spanCols: 1,
            },
          ],
          at: 0,
          duration: durationMs,
        },
      ];
      return { ...baseScene, layers };
    }

    case "product": {
      // 2. product: deviceMockup (browser, splitLeft) + connectorDiagram (splitRight) + codeBlock (topHeader) + card + cursorFlow
      const layers: AnyLayerInput[] = [
        {
          id: `${sceneId}-device`,
          type: "deviceMockup",
          trackIndex: 0,
          layoutSlot: "splitLeft",
          position: { xPct: 28, yPct: 54 },
          size: { widthPct: 36, heightPct: 40 },
          deviceType: "browser",
          titleOrUrl: brief.ctaUrl || "app.motionforge.ai",
          headline: brief.productName.slice(0, 120),
          theme: "dark",
          contentVariant: "dashboard",
          accentColor: tokens.accentPrimary,
          at: 0,
          duration: durationMs,
        },
        {
          id: `${sceneId}-diagram`,
          type: "connectorDiagram",
          trackIndex: 1,
          layoutSlot: "splitRight",
          position: { xPct: 72, yPct: 54 },
          size: { widthPct: 36, heightPct: 40 },
          nodes: [
            {
              id: "node-1",
              label: features[0]!.title.slice(0, 60),
              sublabel: features[0]!.description.slice(0, 80),
              xPct: 25,
              yPct: 50,
              accentColor: tokens.accentPrimary,
            },
            {
              id: "node-2",
              label: features[1]!.title.slice(0, 60),
              sublabel: features[1]!.description.slice(0, 80),
              xPct: 75,
              yPct: 50,
              accentColor: tokens.accentSecondary,
            },
          ],
          edges: [
            {
              from: "node-1",
              to: "node-2",
              label: "Sync",
              animatedPulse: true,
            },
          ],
          at: 0,
          duration: durationMs,
        },
        {
          id: `${sceneId}-code`,
          type: "codeBlock",
          trackIndex: 2,
          layoutSlot: "topHeader",
          position: { xPct: 50, yPct: 16 },
          size: { widthPct: 82, heightPct: 14 },
          code:
            brief.codeSnippet?.code ||
            "import { engine } from '@motionforge/core';\nconst storyboard = await engine.generateStoryboard();",
          language: brief.codeSnippet?.language || "typescript",
          title: `${slug(brief.productName)}.config.ts`,
          theme: "dark",
          fontSize: 14,
          at: 0,
          duration: durationMs,
        },
        {
          id: `${sceneId}-card`,
          type: "card",
          trackIndex: 3,
          position: { xPct: 29, yPct: 84 },
          size: { widthPct: 36, heightPct: 12 },
          variant: {
            variant: "glassCard",
            title: brief.productName.slice(0, 200),
            body: brief.tagline.slice(0, 800),
          },
          at: 0,
          duration: durationMs,
        },
        {
          id: `${sceneId}-cursor`,
          type: "cursorFlow",
          trackIndex: 4,
          cursorStyle: "macos",
          accentColor: tokens.accentPrimary,
          cursorScale: 1.2,
          waypoints: [
            { atMs: 500, xPct: 24, yPct: 50, action: "click", label: "Inspect" },
            { atMs: 1500, xPct: 32, yPct: 58, action: "click", label: "Render" },
          ],
          at: 0,
          duration: durationMs,
        },
      ];
      return { ...baseScene, layers };
    }

    case "proof": {
      // 3. proof: comparisonSplit (centerStage) + chart (topSubhead) + cta (bottomCenterCta)
      const layers: AnyLayerInput[] = [
        {
          id: `${sceneId}-comparison`,
          type: "comparisonSplit",
          trackIndex: 0,
          layoutSlot: "centerStage",
          position: { xPct: 50, yPct: 56 },
          size: { widthPct: 54, heightPct: 26 },
          leftTitle: "Legacy Workflow",
          leftItems: ["Manual frame editing", "Fragile templates"],
          rightTitle: brief.productName.slice(0, 60),
          rightItems: [features[0]!.title.slice(0, 100), features[1]!.title.slice(0, 100)],
          leftAccent: "#ef4444",
          rightAccent: tokens.accentPrimary,
          vsBadge: "VS",
          at: 0,
          duration: durationMs,
        },
        {
          id: `${sceneId}-chart`,
          type: "chart",
          trackIndex: 1,
          layoutSlot: "topSubhead",
          position: { xPct: 50, yPct: 29 },
          size: { widthPct: 60, heightPct: 10 },
          chartType: "bar",
          title: `${brief.productName} Benchmark`,
          data: metrics.slice(0, 4).map((m) => ({
            label: m.label.slice(0, 40),
            value: parseMetricNumber(m).toValue,
          })),
          accentColor: tokens.accentPrimary,
          labelColor: tokens.textSecondary,
          showValues: true,
          at: 0,
          duration: durationMs,
        },
        {
          id: `${sceneId}-cta`,
          type: "cta",
          trackIndex: 2,
          layoutSlot: "bottomCenterCta",
          position: { xPct: 50, yPct: 84 },
          size: { widthPct: 36, heightPct: 12 },
          label: (brief.ctaText || "Start Building Free").slice(0, 80),
          sublabel: (brief.ctaUrl || "motionforge.ai").slice(0, 120),
          variant: "primary",
          accentColor: tokens.accentPrimary,
          icon: "arrow",
          at: 0,
          duration: durationMs,
        },
      ];
      return { ...baseScene, layers };
    }

    case "features": {
      // 4. features: bentoGrid (centerStage) + kineticText (topHeader) + card (bottomCenterCta)
      const layers: AnyLayerInput[] = [
        {
          id: `${sceneId}-bento`,
          type: "bentoGrid",
          trackIndex: 0,
          layoutSlot: "centerStage",
          position: { xPct: 50, yPct: 56 },
          size: { widthPct: 56, heightPct: 34 },
          columns: 2,
          cells: [
            {
              title: features[0]!.title.slice(0, 80),
              subtitle: features[0]!.description.slice(0, 140),
              spanCols: 1,
              accentColor: tokens.accentPrimary,
            },
            {
              title: features[1]!.title.slice(0, 80),
              subtitle: features[1]!.description.slice(0, 140),
              spanCols: 1,
              accentColor: tokens.accentSecondary,
            },
            {
              title: features[2]!.title.slice(0, 80),
              subtitle: features[2]!.description.slice(0, 140),
              spanCols: 1,
            },
            {
              title: features[3]!.title.slice(0, 80),
              subtitle: features[3]!.description.slice(0, 140),
              spanCols: 1,
            },
          ],
          at: 0,
          duration: durationMs,
        },
        {
          id: `${sceneId}-title`,
          type: "kineticText",
          trackIndex: 1,
          layoutSlot: "topHeader",
          position: { xPct: 50, yPct: 16 },
          size: { widthPct: 82, heightPct: 14 },
          text: fitHeadline(`${brief.productName} Features`),
          sizePx: 48,
          fill: tokens.textPrimary,
          at: 0,
          duration: durationMs,
        },
        {
          id: `${sceneId}-card`,
          type: "card",
          trackIndex: 2,
          layoutSlot: "bottomCenterCta",
          position: { xPct: 50, yPct: 84 },
          size: { widthPct: 36, heightPct: 12 },
          variant: {
            variant: "glassCard",
            title: brief.productName.slice(0, 200),
            body: brief.tagline.slice(0, 800),
          },
          at: 0,
          duration: durationMs,
        },
      ];
      return { ...baseScene, layers };
    }

    case "close": {
      // 5. close: metricTicker + comparisonSplit + cta + kineticText
      const layers: AnyLayerInput[] = [
        {
          id: `${sceneId}-ticker`,
          type: "metricTicker",
          trackIndex: 0,
          layoutSlot: "topSubhead",
          position: { xPct: 50, yPct: 30 },
          size: { widthPct: 60, heightPct: 12 },
          label: m0.label.slice(0, 80),
          toValue: p0.toValue,
          prefix: p0.prefix,
          suffix: p0.suffix,
          decimals: p0.decimals,
          deltaBadge: m0.delta ? m0.delta.slice(0, 24) : undefined,
          accentColor: tokens.accentPrimary,
          at: 0,
          duration: durationMs,
        },
        {
          id: `${sceneId}-comparison`,
          type: "comparisonSplit",
          trackIndex: 1,
          layoutSlot: "centerStage",
          position: { xPct: 50, yPct: 56 },
          size: { widthPct: 54, heightPct: 26 },
          leftTitle: "Legacy Workflow",
          leftItems: ["Slow iteration", "High render costs"],
          rightTitle: brief.productName.slice(0, 60),
          rightItems: [features[0]!.title.slice(0, 100), features[1]!.title.slice(0, 100)],
          leftAccent: "#ef4444",
          rightAccent: tokens.accentPrimary,
          vsBadge: "VS",
          at: 0,
          duration: durationMs,
        },
        {
          id: `${sceneId}-cta`,
          type: "cta",
          trackIndex: 2,
          layoutSlot: "bottomCenterCta",
          position: { xPct: 50, yPct: 84 },
          size: { widthPct: 36, heightPct: 12 },
          label: (brief.ctaText || "Start Building Free").slice(0, 80),
          sublabel: (brief.ctaUrl || "motionforge.ai").slice(0, 120),
          variant: "primary",
          accentColor: tokens.accentPrimary,
          icon: "arrow",
          at: 0,
          duration: durationMs,
        },
        {
          id: `${sceneId}-title`,
          type: "kineticText",
          trackIndex: 3,
          layoutSlot: "topHeader",
          position: { xPct: 50, yPct: 16 },
          size: { widthPct: 82, heightPct: 14 },
          text: fitHeadline(brief.projectTitle || brief.tagline),
          sizePx: 48,
          fill: tokens.textPrimary,
          at: 0,
          duration: durationMs,
        },
      ];
      return { ...baseScene, layers };
    }
  }
}

/**
 * Builds distinct scenes from a storyboard brief, saves them in the store,
 * optionally applies critique auto-fixes and audio choreography, and returns the report.
 */
export async function generateStoryboardFromBrief(
  core: EngineCore,
  brief: StoryboardBrief
): Promise<StoryboardReport>;
export async function generateStoryboardFromBrief(
  brief: StoryboardBrief,
  core?: EngineCore
): Promise<StoryboardReport>;
export async function generateStoryboardFromBrief(
  first: EngineCore | StoryboardBrief,
  second?: EngineCore | StoryboardBrief
): Promise<StoryboardReport> {
  let core: EngineCore;
  let rawBrief: StoryboardBrief;

  if (first && typeof (first as any).saveScene === "function") {
    core = first as EngineCore;
    rawBrief = second as StoryboardBrief;
  } else {
    rawBrief = first as StoryboardBrief;
    core = second as EngineCore;
  }

  if (!core) {
    const { createEngineCore } = await import("./engine-core.js");
    core = await createEngineCore({ enableWatcher: false });
  }

  const validatedBrief = storyboardBriefSchema.parse(rawBrief) as Required<StoryboardBrief>;
  const sceneCount = validatedBrief.sceneCount;
  const projectSlug = slug(validatedBrief.projectTitle);

  const metrics = normalizeMetrics(validatedBrief.productName, validatedBrief.keyMetrics);
  const features = normalizeFeatures(validatedBrief.tagline, validatedBrief.productName, validatedBrief.features);

  const scenesSummary: StoryboardSceneSummary[] = [];
  const manifest: StoryboardReport["manifest"] = [];

  for (let i = 0; i < sceneCount; i++) {
    const role = SCENE_ARCHETYPES[i]!;
    const sceneId = `${projectSlug}-s${i + 1}`;
    const sceneSpec = buildSceneSpecForArchetype(role, sceneId, validatedBrief, metrics, features);

    // Validate against sceneSpecSchema before saving
    sceneSpecSchema.parse(sceneSpec);

    // Save through engine saveScene (sanitize path)
    const saved = await core.saveScene(sceneSpec);

    let score: number;
    if (validatedBrief.autoCritiqueAndFix !== false) {
      const critique = await core.critiqueAndAutofixScene(saved.id, { autoApplyFixes: true });
      score = critique.scoreAfter;
    } else {
      const critique = await core.critiqueAndAutofixScene(saved.id, { autoApplyFixes: false });
      score = critique.scoreBefore;
    }

    if (validatedBrief.autoChoreographAudio !== false) {
      await core.autoChoreographAudio(saved.id, { includeAmbientBed: true });
    }

    const reloaded = core.store.require(saved.id);
    const cueCount = reloaded.scene.audio?.cues?.length ?? 0;
    const layerKinds = reloaded.scene.layers.map((l) => l.type);

    scenesSummary.push({
      sceneId: saved.id,
      name: reloaded.scene.name,
      durationMs: reloaded.scene.durationMs,
      layerKinds,
      score,
      cueCount,
    });

    manifest.push({
      sceneId: saved.id,
      index: i,
      role,
      transitionToNext: i === sceneCount - 1 ? "cut" : "fade",
    });
  }

  const totalDurationMs = scenesSummary.reduce((sum, s) => sum + s.durationMs, 0);

  return {
    projectTitle: validatedBrief.projectTitle,
    themePreset: validatedBrief.themePreset,
    totalDurationMs,
    scenes: scenesSummary,
    manifest,
  };
}
