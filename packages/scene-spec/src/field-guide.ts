/**
 * Machine-readable authoring guidance, derived from the schemas in this package.
 *
 * WHY THIS FILE EXISTS: an LLM that only sees the registry lists (layer types,
 * preset names, SFX names) still guesses wrong about *structure* — e.g. it emits
 * `variant: "meshGradient"` as a bare string, or `preset: "springPop"` instead of
 * `entrance: { name: "springPop" }`. Those guesses are rejected by the strict
 * schemas, and the resulting issues used to be invisible to the caller.
 *
 * Everything here is a compile-time-typed `SceneSpecInput` / layer input, so the
 * examples cannot drift away from the schemas — `tests/field-guide.spec.ts`
 * parses every example through `parseScene()`.
 */
import { z } from "zod";

import { ASSET_KINDS, FONT_ROLES } from "./assets.js";
import { EASINGS } from "./common.js";
import { CAMERA_MOVES } from "./camera.js";
import { SFX_NAMES } from "./audio.js";
import { EMPHASIS_PRESETS, ENTRANCE_PRESETS, EXIT_PRESETS } from "./motion.js";
import { backgroundLayerSchema, BACKGROUND_VARIANTS } from "./layers/background.js";
import { CARD_VARIANTS, cardLayerSchema } from "./layers/card.js";
import { FOREGROUND_FX_KINDS, foregroundFxLayerSchema } from "./layers/foreground-fx.js";
import { imageLogoLayerSchema, LOGO_MASKS } from "./layers/image-logo.js";
import { kineticTextLayerSchema } from "./layers/kinetic-text.js";
import { lottieLayerSchema } from "./layers/lottie.js";
import { chartLayerSchema, CHART_TYPES } from "./layers/chart.js";
import { codeBlockLayerSchema, CODE_BLOCK_THEMES } from "./layers/code-block.js";
import { particleFieldLayerSchema, PARTICLE_PATTERNS } from "./layers/particle-field.js";
import { ctaLayerSchema, CTA_ICONS, CTA_VARIANTS } from "./layers/cta.js";
import {
  deviceMockupLayerSchema,
  DEVICE_TYPES,
  DEVICE_THEMES,
  DEVICE_CONTENT_VARIANTS,
} from "./layers/device-mockup.js";
import {
  cursorFlowLayerSchema,
  CURSOR_STYLES,
  CURSOR_ACTIONS,
} from "./layers/cursor-flow.js";
import {
  bentoGridLayerSchema,
  BENTO_COLUMNS,
} from "./layers/bento-grid.js";
import {
  connectorDiagramLayerSchema,
} from "./layers/connector-diagram.js";
import {
  metricTickerLayerSchema,
} from "./layers/metric-ticker.js";
import {
  comparisonSplitLayerSchema,
} from "./layers/comparison-split.js";
import {
  cartographicRouteLayerSchema,
} from "./layers/cartographic-route.js";
import {
  editorialRuleLayerSchema,
} from "./layers/editorial-rule.js";
import {
  timelineStripLayerSchema,
} from "./layers/timeline-strip.js";
import { THEME_PRESETS } from "./themes.js";
import { LAYOUT_SLOTS } from "./layout-slots.js";
import {
  KEYFRAME_EASINGS,
  KEYFRAME_PROPERTIES,
  LAYER_FILTER_KEYS,
  layerBaseSchema,
} from "./layers/base.js";
import { CANVAS_SCALES, CANVAS_SHAPES, LAYER_TYPES, TRANSITION_KINDS, type LayerType } from "./scene.js";
import type { SceneSpecInput } from "./validate.js";

export type BackgroundLayerInput = z.input<typeof backgroundLayerSchema>;
export type ImageLogoLayerInput = z.input<typeof imageLogoLayerSchema>;
export type KineticTextLayerInput = z.input<typeof kineticTextLayerSchema>;
export type CardLayerInput = z.input<typeof cardLayerSchema>;
export type LottieLayerInput = z.input<typeof lottieLayerSchema>;
export type ForegroundFxLayerInput = z.input<typeof foregroundFxLayerSchema>;
export type ChartLayerInput = z.input<typeof chartLayerSchema>;
export type CodeBlockLayerInput = z.input<typeof codeBlockLayerSchema>;
export type ParticleFieldLayerInput = z.input<typeof particleFieldLayerSchema>;
export type CtaLayerInput = z.input<typeof ctaLayerSchema>;
export type DeviceMockupLayerInput = z.input<typeof deviceMockupLayerSchema>;
export type CursorFlowLayerInput = z.input<typeof cursorFlowLayerSchema>;
export type BentoGridLayerInput = z.input<typeof bentoGridLayerSchema>;
export type ConnectorDiagramLayerInput = z.input<typeof connectorDiagramLayerSchema>;
export type MetricTickerLayerInput = z.input<typeof metricTickerLayerSchema>;
export type ComparisonSplitLayerInput = z.input<typeof comparisonSplitLayerSchema>;
export type CartographicRouteLayerInput = z.input<typeof cartographicRouteLayerSchema>;
export type EditorialRuleLayerInput = z.input<typeof editorialRuleLayerSchema>;
export type TimelineStripLayerInput = z.input<typeof timelineStripLayerSchema>;

export type AnyLayerInput =
  | BackgroundLayerInput
  | ImageLogoLayerInput
  | KineticTextLayerInput
  | CardLayerInput
  | LottieLayerInput
  | ForegroundFxLayerInput
  | ChartLayerInput
  | CodeBlockLayerInput
  | ParticleFieldLayerInput
  | CtaLayerInput
  | DeviceMockupLayerInput
  | CursorFlowLayerInput
  | BentoGridLayerInput
  | ConnectorDiagramLayerInput
  | MetricTickerLayerInput
  | ComparisonSplitLayerInput
  | CartographicRouteLayerInput
  | EditorialRuleLayerInput
  | TimelineStripLayerInput;

/** Keys every layer needs, plus the timing/motion knobs shared by all of them. */
export const COMMON_LAYER_REQUIRED = ["id", "type"] as const;

export const COMMON_LAYER_OPTIONAL = [
  "name (human label)",
  "z (stacking order, 0-999; default = array order)",
  "at (start time in ms, default 0)",
  "duration (visible window in ms, default: until scene end)",
  "trackIndex (0-indexed timeline track lane; non-overlapping clips sharing a trackIndex share a row)",
  "layoutSlot (named layout slot box from registries.layoutSlots; explicit position and size win over slot values independently)",
  "position ({ xPct, yPct } — center anchor in percent of the canvas; -300..300 so a layer can start off-screen)",
  "scale (uniform multiplier, 0.05-10) / scaleX / scaleY (non-uniform; scaleX/scaleY win over scale)",
  "size ({ widthPct?, heightPct? } — LAYOUT size in percent of the canvas)",
  "filters ({ blur?, brightness?, contrast?, saturate?, shadowBlur?, shadowColor?, cornerRadius? } — VISUAL filters on the painted content)",
  "keyframes ([{ id, timeMs, property, value, easing? }] — the unified animation surface; property is xPct | yPct | scale | rotation | opacity)",
  "entrance ({ name: <preset>, strength?, staggerMs?, durationMs?, ease?, delayMs? })",
  "emphasis ({ name: <preset>, ... })",
  "exit ({ name: <preset>, ... })",
  "sfx ([{ sfx: <bank name>, offsetMs?, gain?, pan? }] — fires relative to `at`)",
] as const;

export interface LayerFieldGuideEntry {
  /** short summary of the layer's visual intent */
  summary: string;
  /** keys that MUST be present (beyond the common id/type) */
  required: string[];
  /** keys worth knowing; all are optional or defaulted */
  optional: string[];
  /** minimal example that passes the real Zod schema */
  example: AnyLayerInput;
}

export const LAYER_FIELD_GUIDE: Record<LayerType, LayerFieldGuideEntry> = {
  background: {
    summary: "Full-bleed background canvas with solid color, animated mesh gradients, particles, or video/image media.",
    required: ["variant (OBJECT, discriminated by its own `variant` key)"],
    optional: [
      "variant=solid: { color (CSS color, default '#05070d') }",
      "variant=meshGradient: { base? (default '#05070d'), blobs: [{ color, xPct, yPct, radiusPct, drift? }] } (2-6 blobs)",
      "variant=particles: { count (default 60), color? (default '#ffffff'), sizePx? (default 2), speed? (default 1), direction? (default 'up') }",
      "variant=media: { assetId (must be declared in assets), blurPx? (default 0), dimOpacity? (default 0), kenBurns? { fromScale?, toScale?, panFrom?, panTo? } }",
    ],
    example: {
      id: "bg",
      type: "background",
      variant: { variant: "solid", color: "#05070d" },
    },
  },
  imageLogo: {
    summary: "Vector or raster mark with optional SVG mask, ring border, drop shadow, glass backdrop, glow, and specular light sweep.",
    required: ["assetId (declared in assets)", "widthPx (16-4000 design px)", "position { xPct, yPct } (canvas percent)"],
    optional: [
      "heightPx (16-4000 design px, defaults to preserve aspect ratio)",
      "mask: rect | circle | squircle | hexagon | blob (default 'rect')",
      "cornerRadiusPx (0-400 design px, for rect mask)",
      "shadow { color? (default '#000000'), opacity? (default 0.45), blurPx? (default 24), offsetYpx? (default 10) }",
      "ring { widthPx (1-40), color, opacity? }",
      "glass { blurPx? (default 18), tintColor? (default '#ffffff'), tintOpacity? (default 0.08) }",
      "glow { color, strength? (0-2, default 1) }",
      "lightSweep { at (ms), durationMs? (default 600), angleDeg? (default 45), color?, widthFactor? }",
    ],
    example: {
      id: "logo",
      type: "imageLogo",
      at: 300,
      duration: 4000,
      assetId: "logo",
      widthPx: 200,
      position: { xPct: 50, yPct: 24 },
      mask: "squircle",
      ring: { widthPx: 4, color: "#7dd3fc" },
      entrance: { name: "springPop" },
      sfx: [{ sfx: "pop", offsetMs: 0 }],
    },
  },
  kineticText: {
    summary: "Broadcast typography with staggered word/char/line entrances, gradient fills, and marker highlights.",
    required: ["text (1-600 characters)", "sizePx (8-600 design px)"],
    optional: [
      "direction: ltr | rtl (default 'ltr', auto-detected for Arabic/Hebrew copy)",
      "role: hero | headline | body | accent | metric (default 'headline', pairs with scene.fonts[])",
      "googleFamily (explicit Google Font family override, e.g. 'Cairo')",
      "fontWeight (100-900, default 800)",
      "lineHeight (0.7-2.5, default 1.15), letterSpacingPx (-10-60, default 0), align: left | center | right (default 'center')",
      "position { xPct, yPct } (default { xPct: 50, yPct: 50 })",
      "box { maxWidthPct? (10-100, default 70), paddingPx? (0-200, default 0), chip?: { color, opacity? (0.14), radiusPx? (18) } }",
      "fill: CSS color string OR { type: 'linear', angleDeg, stops: [{ color, at }] } (default '#ffffff')",
      "stroke { color, widthPx (0.5-20) }, shadow { color?, opacity?, blurPx?, offsetYpx? }, highlight { color, radiusPx? (12), paddingPx? (8) }",
      "animateBy: word | char | line (default 'word', drives staggered entrance)",
    ],
    example: {
      id: "headline",
      type: "kineticText",
      at: 800,
      text: "Motion, engineered.",
      sizePx: 88,
      direction: "ltr",
      role: "hero",
      position: { xPct: 50, yPct: 45 },
      fill: { type: "linear", angleDeg: 120, stops: [{ color: "#ffffff", at: 0 }, { color: "#a5f3fc", at: 100 }] },
      animateBy: "word",
      entrance: { name: "blurFadeIn", staggerMs: 120 },
    },
  },
  card: {
    summary: "Glassmorphic information surfaces, callout cards, animated progress bars, and numeric counter chips.",
    required: ["position { xPct, yPct }", "variant (OBJECT, discriminated by its own `variant` key)"],
    optional: [
      "variant=glassCard: { title?, body?, iconAssetId?, widthPx?, paddingPx? (default 36), radiusPx? (default 28), glass? { blurPx: 22, tintColor: '#0b0f1a', tintOpacity: 0.35 }, borderOpacity? (default 0.25) }",
      "variant=callout: { accentColor, accentSide? (default 'left'), title?, body?, widthPx?, paddingPx? (default 32), radiusPx? (default 24), glass? }",
      "variant=progressBar: { value (0-100), fill (paint), label?, trackColor? (default 'rgba(255,255,255,0.12)'), heightPx? (default 18), radiusPx? (default 120), showPercentage? (default false), widthPx? }",
      "variant=counter: { from, to, decimals? (default 0), prefix? (default ''), suffix? (default ''), locale?, role? (default 'metric'), sizePx? (default 120) }",
    ],
    example: {
      id: "card",
      type: "card",
      at: 3000,
      position: { xPct: 50, yPct: 40 },
      variant: {
        variant: "glassCard",
        title: "Deterministic Pipeline",
        body: "Every frame seeked, captured and piped.",
      },
      entrance: { name: "3dFlipIn" },
      sfx: [{ sfx: "subImpact", offsetMs: 0 }],
    },
  },
  lottie: {
    summary: "Scrubbed vector Lottie animation, deterministic and synchronized to scene timeline progress.",
    required: ["assetId (kind 'lottie', declared in assets)", "position { xPct, yPct }"],
    optional: ["widthPx (16-4000 design px)"],
    example: {
      id: "anim",
      type: "lottie",
      at: 500,
      assetId: "anim",
      widthPx: 420,
      position: { xPct: 50, yPct: 30 },
    },
  },
  foregroundFX: {
    summary: "Full-frame post-processing and cinematic grading overlays (vignette, film grain, color grade).",
    required: ["effects (1-6 overlay effects)"],
    optional: [
      "{ kind: 'vignette', strength? (0-1, default 0.5), color? (default '#000000') }",
      "{ kind: 'filmGrain', opacity? (0-1, default 0.06), sizePx? (1-6, default 2) }",
      "{ kind: 'colorGrade', warmth? (-1..1, default 0), contrast? (-1..1, default 0), saturation? (-1..1, default 0), tint?: { color, opacity? (default 0.15) } }",
    ],
    example: {
      id: "fgx",
      type: "foregroundFX",
      effects: [
        { kind: "vignette", strength: 0.5 },
        { kind: "filmGrain", opacity: 0.06 },
      ],
    },
  },
  chart: {
    summary: "Pure SVG data visualisation plots for keynote presentations (bar chart, line plot, donut chart).",
    required: [
      "position { xPct, yPct }",
      "data (2-12 points: [{ label, value, color? }])",
    ],
    optional: [
      "chartType: bar | line | donut (default 'bar')",
      "title (heading text above the plot, max 160 chars)",
      "accentColor (default '#38bdf8'; per-datum 'color' overrides)",
      "showValues (boolean, default false; displays numbers above points/bars)",
      "gridOpacity (0-1, default 0.16)",
      "labelColor (default '#cbd5e1'), widthPx (default 760), heightPx (default 420), labelSizePx (default 18)",
    ],
    example: {
      id: "chart",
      type: "chart",
      at: 1200,
      position: { xPct: 50, yPct: 50 },
      chartType: "bar",
      title: "Frames per second",
      data: [
        { label: "Draft", value: 8.9 },
        { label: "Production", value: 4.2 },
      ],
      accentColor: "#38bdf8",
      showValues: true,
      entrance: { name: "smoothSlideUp" },
    },
  },
  codeBlock: {
    summary: "Developer keynote code snippet window with realistic chrome, syntax highlighting, and line callouts.",
    required: ["position { xPct, yPct }", "code (source code string, max 8000 chars)"],
    optional: [
      "language (default 'typescript', e.g. python, bash, rust, json)",
      "title (window chrome title string, max 160 chars)",
      "theme: dark | midnight | matrix (default 'dark')",
      "highlightLines (array of 1-indexed line numbers to emphasize)",
      "fontSize (8-96 design px, default 22; 'fontSizePx' accepted as alias)",
      "widthPx (120-2400 design px, default 760), showChrome (default true), showLineNumbers (default true)",
    ],
    example: {
      id: "snippet",
      type: "codeBlock",
      at: 800,
      position: { xPct: 50, yPct: 50 },
      language: "typescript",
      title: "capture.ts",
      code: "const frame = await page.screenshot({ type: 'jpeg' });",
      theme: "midnight",
      highlightLines: [1],
      entrance: { name: "3dFlipIn" },
    },
  },
  particleField: {
    summary: "Deterministic mathematical field of animated motion particles across four generative patterns.",
    required: [
      "(none — every particleField field has a default, so `id` + `type` are the only requirements)",
    ],
    optional: [
      "count (1-400 particles, default 80)",
      "pattern: float | grid | constellation | sparkle (default 'float')",
      "color (default '#7dd3fc'), color2 (secondary interpolation color)",
      "speed (0.1-4, default 1)",
      "size (radius 0.5-40 design px, default 3; 'sizePx' accepted as alias)",
      "seed (integer seed, default 20260101; same seed guarantees identical particle layout)",
      "opacity (per-particle opacity ceiling, default 0.85)",
    ],
    example: {
      id: "dust",
      type: "particleField",
      pattern: "constellation",
      count: 120,
      color: "#7dd3fc",
      speed: 0.6,
      size: 2.5,
      seed: 42,
      entrance: { name: "blurFadeIn", durationMs: 800 },
    },
  },
  cta: {
    summary: "High-conversion action button with vector icon glyphs, secondary sublabels, and pill/glass treatments.",
    required: ["position { xPct, yPct }", "label (button title string, 1-80 chars)"],
    optional: [
      "sublabel (secondary subtitle text, max 120 chars)",
      "variant: primary | glass | outline | pill (default 'primary')",
      "accentColor (default '#38bdf8'), bgColor (custom background), textColor (custom text color)",
      "icon: arrow | sparkles | play | none (default 'arrow'; vector SVG glyph, never emoji)",
      "widthPx (80-1200, default 360), heightPx (32-240, default 72), radiusPx (default 18), labelSizePx (default 20)",
    ],
    example: {
      id: "cta",
      type: "cta",
      at: 6000,
      position: { xPct: 50, yPct: 72 },
      label: "Start free trial",
      sublabel: "No credit card required",
      variant: "primary",
      accentColor: "#38bdf8",
      icon: "arrow",
      entrance: { name: "springPop" },
      sfx: [{ sfx: "pop", offsetMs: 0 }],
    },
  },
  deviceMockup: {
    summary: "Responsive hardware frame for browser, laptop, smartphone, or terminal with realistic chrome and 3D tilt.",
    required: ["(none — all fields have defaults; titleOrUrl defaults to 'app.motionforge.ai')"],
    optional: [
      "deviceType: browser | macbook | iphone | terminal (default 'browser')",
      "theme: dark | light (default 'dark')",
      "contentVariant: dashboard | code | metrics | analytics | blank (default 'dashboard')",
      "titleOrUrl (address bar / terminal header text, max 160 chars, default 'app.motionforge.ai')",
      "headline (heading text rendered above the device frame, max 120 chars)",
      "accentColor (hex color string)",
      "tiltDeg ({ rotateX?, rotateY? } between -35 and 35 deg, default { rotateX: 0, rotateY: 0 })",
    ],
    example: {
      id: "device-preview",
      type: "deviceMockup",
      at: 600,
      deviceType: "browser",
      titleOrUrl: "analytics.motionforge.ai",
      theme: "dark",
      contentVariant: "dashboard",
      headline: "Real-time Telemetry",
      accentColor: "#38bdf8",
    },
  },
  cursorFlow: {
    summary: "Simulated software user interaction with vector mouse cursor, cubic waypoint paths, click ripples, and hover halos.",
    required: [
      "waypoints (1-20 waypoints: [{ atMs, xPct, yPct, action?, label? }])",
    ],
    optional: [
      "cursorStyle: macos | pointer | collaborator (default 'macos')",
      "accentColor (hex color, default '#38bdf8')",
      "cursorScale (0.5 to 3, default 1.2)",
      "waypoints[].action: move | click | hover (default 'move')",
      "waypoints[].label (floating tooltip text beside cursor, max 40 chars)",
    ],
    example: {
      id: "cursor-1",
      type: "cursorFlow",
      at: 800,
      cursorStyle: "macos",
      accentColor: "#38bdf8",
      cursorScale: 1.2,
      waypoints: [
        { atMs: 0, xPct: 20, yPct: 30, action: "move" },
        { atMs: 500, xPct: 50, yPct: 50, action: "click", label: "Submit" },
        { atMs: 1000, xPct: 80, yPct: 70, action: "hover" },
      ],
    },
  },
  bentoGrid: {
    summary: "Modern glassmorphic bento box grid layout with metric callouts, status badges, and staggered card entrances.",
    required: ["cells (2 to 6 cells: [{ title, subtitle?, metricValue?, badge?, spanCols?, accentColor? }])"],
    optional: [
      "columns: 2 | 3 (default 3)",
      "staggerMs: number (0-600, default 110)",
      "cells[].spanCols: 1 | 2 | 3 (default 1, clamped to columns)",
      "cells[].accentColor: hex color (tint for card border and badge)",
    ],
    example: {
      id: "bento-metrics",
      type: "bentoGrid",
      at: 500,
      columns: 3,
      staggerMs: 110,
      cells: [
        {
          title: "Throughput",
          subtitle: "Requests processed per second",
          metricValue: "125k",
          badge: "Live",
          spanCols: 2,
          accentColor: "#38bdf8",
        },
        {
          title: "Uptime",
          metricValue: "99.99%",
          badge: "SLA",
          spanCols: 1,
          accentColor: "#22c55e",
        },
      ],
    },
  },
  connectorDiagram: {
    summary: "System architecture diagram with labeled HTML nodes, cubic Bezier connecting edges, and animated flow pulses.",
    required: [
      "nodes (2 to 8 nodes: [{ id, label, sublabel?, xPct, yPct, accentColor? }])",
      "edges (1 to 12 edges: [{ from, to, label?, animatedPulse? }])",
    ],
    optional: [
      "nodes[].sublabel (secondary text under node title)",
      "nodes[].accentColor (hex color string for node ring)",
      "edges[].label (text centered on Bezier arc)",
      "edges[].animatedPulse (boolean, default true)",
    ],
    example: {
      id: "diagram-flow",
      type: "connectorDiagram",
      at: 600,
      nodes: [
        { id: "node-client", label: "Client App", sublabel: "Edge device", xPct: 20, yPct: 50, accentColor: "#38bdf8" },
        { id: "node-server", label: "API Gateway", sublabel: "Cloud cluster", xPct: 80, yPct: 50, accentColor: "#818cf8" },
      ],
      edges: [
        { from: "node-client", to: "node-server", label: "HTTPS / gRPC", animatedPulse: true },
      ],
    },
  },
  metricTicker: {
    summary: "High-impact KPI number ticker with animated cubic counting, tabular digits, currency/unit affixes, and delta badge.",
    required: [
      "label (metric title string, max 80 chars)",
      "toValue (target finite number)",
    ],
    optional: [
      "fromValue (initial finite number, default 0)",
      "prefix (string prepended to number, max 12 chars, default '')",
      "suffix (string appended to number, max 16 chars, default '')",
      "decimals (0-4 integer decimal places, default 0)",
      "countDurationMs (200-10000ms duration of the count, default 1600)",
      "deltaBadge (pill badge text, max 24 chars, e.g. '+24.8% YoY')",
      "accentColor (hex color string for number and badge tint)",
    ],
    example: {
      id: "kpi-ticker",
      type: "metricTicker",
      at: 400,
      label: "ANNUAL RECURRING REVENUE",
      fromValue: 0,
      toValue: 2450000,
      prefix: "$",
      suffix: "",
      decimals: 0,
      countDurationMs: 1800,
      deltaBadge: "+48% YoY",
      accentColor: "#10b981",
    },
  },
  comparisonSplit: {
    summary: "Side-by-side comparison matrix with contrasting positive/negative vector indicators, stagger, and central VS badge.",
    required: [
      "leftTitle (left column header, max 60 chars)",
      "leftItems (1-6 strings, each max 100 chars)",
      "rightTitle (right column header, max 60 chars)",
      "rightItems (1-6 strings, each max 100 chars)",
    ],
    optional: [
      "leftAccent (hex color for left column indicators, default '#ef4444')",
      "rightAccent (hex color for right column indicators, default '#10b981')",
      "vsBadge (central badge pill text, max 12 chars, default 'VS')",
    ],
    example: {
      id: "comparison",
      type: "comparisonSplit",
      at: 600,
      leftTitle: "Legacy Workflow",
      leftItems: [
        "Manual timeline editing",
        "Slow render farms",
        "Fragile video templates",
      ],
      rightTitle: "MotionForge Engine",
      rightItems: [
        "Declarative JSON SceneSpec",
        "Sub-second frame inspection",
        "Deterministic programmatic render",
      ],
      leftAccent: "#ef4444",
      rightAccent: "#10b981",
      vsBadge: "VS",
    },
  },
  cartographicRoute: {
    summary: "Documentary animated cartographic path with start/end pin indicators, dark halo underlay, and dashed stroke.",
    required: ["waypoints (array of { xPct, yPct, label? }, min 2, max 16)"],
    optional: [
      "strokeColor (hex color, default '#d4af37')",
      "strokeWidthPx (stroke width in pixels, default 3.5)",
      "dashed (boolean, default true)",
      "dashArray (SVG dash pattern, default '8 6')",
      "haloColor (dark underlay color, default '#0a0a0c')",
      "haloWidthPx (halo stroke width, default 8)",
      "haloOpacity (halo opacity 0..1, default 0.75)",
      "curved (smooth Catmull-Rom Bezier curve, default true)",
      "startPin ({ label?, color?, radiusPx?, pulse? })",
      "endPin ({ label?, color?, radiusPx?, pulse? })",
      "drawDurationMs (duration to animate path draw-in, default 1800)",
    ],
    example: {
      id: "route-map",
      type: "cartographicRoute",
      at: 400,
      waypoints: [
        { xPct: 20, yPct: 40, label: "Origin" },
        { xPct: 50, yPct: 35 },
        { xPct: 80, yPct: 65, label: "Destination" },
      ],
      strokeColor: "#d4af37",
      startPin: { label: "London", color: "#d4af37" },
      endPin: { label: "Singapore", color: "#14b8a6" },
      drawDurationMs: 1600,
    },
  },
  editorialRule: {
    summary: "Gold or accent divider rule with gradient fade ends and optional center diamond or dot ornament.",
    required: ["id (unique string id)", "type ('editorialRule')"],
    optional: [
      "orientation ('horizontal' | 'vertical', default 'horizontal')",
      "lengthPct (percent of canvas dimension, default 60)",
      "thicknessPx (rule thickness in px, default 2)",
      "color (hex color, default '#d4af37')",
      "fadeEnds (gradient fade on extremities, default true)",
      "centerOrnament ('none' | 'diamond' | 'dot', default 'diamond')",
      "ornamentSizePx (ornament size in px, default 8)",
      "drawDurationMs (draw-in duration ms, default 1200)",
    ],
    example: {
      id: "divider",
      type: "editorialRule",
      at: 200,
      orientation: "horizontal",
      lengthPct: 70,
      color: "#d4af37",
      centerOrnament: "diamond",
    },
  },
  timelineStrip: {
    summary: "Horizontal chronological timeline axis with event date tags, marker dots, and staggered labels.",
    required: ["events (array of { date, title, description?, active? }, min 2, max 8)"],
    optional: [
      "lineColor (hex color, default '#d4af37')",
      "markerColor (marker dot color, default '#ffffff')",
      "activeMarkerColor (active marker dot color, default '#d4af37')",
      "textColor (typography color, default '#ffffff')",
      "accentColor (accent color, default '#d4af37')",
      "widthPct (percent of canvas width, default 85)",
      "staggerMs (staggered entrance delay ms, default 250)",
      "showDescriptions (boolean, default true)",
    ],
    example: {
      id: "timeline",
      type: "timelineStrip",
      at: 500,
      widthPct: 90,
      events: [
        { date: "1998", title: "Foundation", description: "Early exploration", active: false },
        { date: "2012", title: "Scale", description: "Global adoption", active: false },
        { date: "2026", title: "Autonomous Era", description: "Engine unification", active: true },
      ],
    },
  },
};

/**
 * The structural rules that registry lists cannot express — the exact class of
 * mistakes an LLM makes when authoring a scene from scratch.
 */
export const NESTED_SHAPE_NOTES: string[] = [
  'Every layer REQUIRES `id` (unique, [A-Za-z0-9_-]) and `type` (one of the layerTypes).',
  '`background.variant` is an OBJECT discriminated by its own `variant` key, not a string: {"variant":"solid","color":"#000"}. Same for `card.variant`: {"variant":"glassCard", ...}.',
  'Motion is objects, never a bare string: `entrance`, `emphasis` and `exit` take `{ "name": "<preset>" }` plus optional strength / staggerMs / durationMs / ease / delayMs. There is no `preset` field.',
  'Positions are OBJECTS of canvas percent: `"position": { "xPct": 50, "yPct": 45 }`. Sizes carry a unit suffix in the key: `sizePx`, `widthPx`, `heightPx`, `blurPx`, `radiusPx`, `paddingPx`.',
  'The VISUAL filter bag is `filters` (an object), NOT `effects`: `filters: { "blur": 6, "saturate": 120 }`. `effects` on a `foregroundFX` layer is a different thing entirely — an ARRAY of vignette / filmGrain / colorGrade overlays.',
  'A unified keyframe is `{ "id": "k1", "timeMs": 1200, "property": "xPct", "value": 40, "easing": "easeInOut" }` — `property` is one of xPct | yPct | scale | rotation | opacity, and `value` must be inside that property\'s range (xPct/yPct -300..300, scale 0.05..10, rotation -3600..3600, opacity 0..1).',
  'ALL times are milliseconds: `at`, `durationMs`, `delayMs`, `audio.cues[].at`, `camera.moves[].at`.',
  'Gradients are objects: `{ "type": "linear", "angleDeg": 90, "stops": [{ "color": "#fff", "at": 0 }, ...] }`; a plain string is a solid color.',
  'Assets must be declared in `scene.assets` ({id, kind, src}) before a layer can reference them by id. `src` starts with https://, data: or vault:.',
  'Fonts are declared per role in `scene.fonts` ({role, family, provider, weights}); a kineticText layer picks the role (and optionally googleFamily).',
  'Camera keyframes inherit unset fields from the previous keyframe and MUST be sorted by `at`. Camera moves use `{ "move": "<name>", "at": ms, ... }`.',
  'Camera framing: at `scale: s` the visible slice of the canvas is `100/s` percent wide, so `xPct`/`yPct` must stay inside `[50/s, 100 - 50/s]`. Outside that range the frame shows black void — the engine warns with `CAMERA_VIEWPORT_EXCEEDS_CANVAS` and the runtime clamps it automatically.',
  'Camera moves are TEMPORARY: each one ramps in, holds, and ramps back out. A `focusTarget` returns the camera to its previous pose; it never leaves the rig parked at the zoom.',
  'Effects are TEMPORARY: `pulseGlow`/`floatIdle` start at the baseline and return to it. `lightSweep` is a soft white overlay that can only ADD light — it never darkens the pixels beneath it.',
  'SFX come in two equivalent forms: `layer.sfx[]` (fires at `layer.at + offsetMs`) and `scene.audio.cues[]` (absolute `at`). Both use the same fixed bank names.',
  'Scene timing must fit: a layer may not start at/after durationMs, and `at + duration` must not exceed it. The same bound applies to transitions, cues and camera keyframes/moves.',
  'Unknown keys are REJECTED everywhere (strict schemas) — a typo like `preset` or `positionX` fails with an "Unrecognized key" issue naming the exact path.',
  'AT MOST ONE TRANSITION at a time. Two transitions whose `[at, at+durationMs)` windows overlap are rejected by the schema — at one cut, two overlays and two camera offsets read as "two broken transitions happening at once".',
  'A transition hides the stage only while its cover is at full extent, and never for more than ~120ms around its midpoint (`at + durationMs / 2`). Keep `durationMs` in the 350–550ms range; the engine warns with `TRANSITION_PEAK_TOO_LONG` past that.',
  'A cut must be covered from BOTH sides: an act that ends inside 300ms before a transition is held to its midpoint, and an act that starts within 300ms after one begins AT its midpoint. Put a transition whose midpoint sits inside any hole longer than 200ms — otherwise the engine warns with `FOREGROUND_COVERAGE_GAP` and the render shows a dead dark frame.',
  'Mask reveals (`maskRevealWipe`, `collapseMask`) clip the whole TEXT LINE along the reading direction — never a single word. Per-word clips slice every word of an Arabic sentence open at once, so the line reads as fragments for most of the wipe.',
  'For an OUTRO headline, keep the entrance short: `durationMs: 450` or less. A slow multi-word wipe means the closing line is still being revealed while the scene is ending.',
  'A `highlight` on a kineticText layer paints ONE soft pill behind the whole LINE (borderless, `border-radius: 0.28em`) — not a bordered box per word. Per-word boxes read as separate compartments and chop an Arabic phrase into segments.',
  'A `focusTarget` is a gentle nudge, not a zoom solve: it adds at most +0.14x to the current scale and pans toward the layer within 80% of the safe headroom. To actually reframe, use a camera keyframe instead.',
];

/** Smallest scene that passes `validateScene()` — post it as-is to confirm the round trip. */
export const MINIMAL_VALID_SCENE: SceneSpecInput = {
  schemaVersion: 1,
  name: "Minimal Demo",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 6000,
  layers: [
    {
      id: "bg",
      type: "background",
      variant: { variant: "solid", color: "#05070d" },
    },
    {
      id: "title",
      type: "kineticText",
      at: 400,
      text: "Hello MotionForge",
      sizePx: 96,
      position: { xPct: 50, yPct: 50 },
      fill: "#ffffff",
      entrance: { name: "smoothSlideUp" },
    },
  ],
};

/**
 * A complete, asset-free scene that exercises every layer type that needs no
 * external file. Post it verbatim to see the whole feature surface working.
 */
export const SHOWCASE_SCENE_SKETCH: SceneSpecInput = {
  schemaVersion: 1,
  name: "Showcase Sketch",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 10_000,
  fonts: [{ role: "hero", family: "Cairo", provider: "google", weights: [700, 900] }],
  layers: [
    {
      id: "bg",
      type: "background",
      variant: {
        variant: "meshGradient",
        base: "#05070d",
        blobs: [
          { color: "#3b1f7a", xPct: 20, yPct: 28, radiusPct: 62, drift: 0.45 },
          { color: "#1b3a80", xPct: 80, yPct: 36, radiusPct: 55, drift: 0.3 },
        ],
      },
    },
    {
      id: "headline-ar",
      type: "kineticText",
      at: 600,
      text: "أهلاً بك في موشن فورج",
      direction: "rtl",
      role: "hero",
      googleFamily: "Cairo",
      sizePx: 96,
      position: { xPct: 50, yPct: 45 },
      fill: { type: "linear", angleDeg: 120, stops: [{ color: "#ffffff", at: 0 }, { color: "#a5f3fc", at: 100 }] },
      animateBy: "word",
      entrance: { name: "blurFadeIn", staggerMs: 140 },
      sfx: [{ sfx: "whoosh", offsetMs: 0 }],
    },
    {
      id: "headline-en",
      type: "kineticText",
      at: 1600,
      text: "Motion, engineered.",
      sizePx: 44,
      position: { xPct: 50, yPct: 60 },
      fill: "#93c5fd",
      entrance: { name: "smoothSlideUp", staggerMs: 90 },
    },
    {
      id: "card",
      type: "card",
      at: 3200,
      position: { xPct: 50, yPct: 32 },
      variant: {
        variant: "glassCard",
        title: "Deterministic Pipeline",
        body: "Every frame seeked, captured and piped.",
      },
      entrance: { name: "3dFlipIn" },
      sfx: [{ sfx: "subImpact", offsetMs: 0 }],
    },
    {
      id: "bar",
      type: "card",
      at: 5400,
      position: { xPct: 50, yPct: 62 },
      variant: {
        variant: "progressBar",
        label: "Encoding pipeline",
        value: 94,
        fill: { type: "linear", angleDeg: 90, stops: [{ color: "#22d3ee", at: 0 }, { color: "#a78bfa", at: 100 }] },
        showPercentage: true,
        widthPx: 640,
      },
      entrance: { name: "maskRevealWipe" },
      sfx: [{ sfx: "riser", offsetMs: 0 }],
    },
    {
      id: "counter",
      type: "card",
      at: 7200,
      position: { xPct: 50, yPct: 40 },
      variant: { variant: "counter", from: 0, to: 87, suffix: "%", sizePx: 140 },
      entrance: { name: "springPop" },
    },
    {
      id: "fgx",
      type: "foregroundFX",
      effects: [
        { kind: "vignette", strength: 0.5 },
        { kind: "filmGrain", opacity: 0.06 },
        { kind: "colorGrade", contrast: 0.06, saturation: 0.08, warmth: 0.12 },
      ],
    },
    {
      id: "chart",
      type: "chart",
      at: 8600,
      position: { xPct: 50, yPct: 62 },
      chartType: "bar",
      title: "Frames per second",
      data: [
        { label: "Draft", value: 8.9 },
        { label: "Production", value: 4.2 },
        { label: "Capture", value: 1.1 },
      ],
      accentColor: "#38bdf8",
      showValues: true,
      entrance: { name: "smoothSlideUp" },
    },
    {
      id: "snippet",
      type: "codeBlock",
      at: 6000,
      position: { xPct: 26, yPct: 26 },
      language: "typescript",
      title: "capture.ts",
      code: "const frame = await page.screenshot({ type: 'jpeg' });",
      theme: "midnight",
      highlightLines: [1],
      fontSize: 20,
      entrance: { name: "3dFlipIn" },
    },
    {
      id: "dust",
      type: "particleField",
      pattern: "constellation",
      count: 90,
      color: "#7dd3fc",
      speed: 0.6,
      size: 2.5,
      seed: 42,
    },
    {
      id: "cta",
      type: "cta",
      at: 9200,
      position: { xPct: 50, yPct: 80 },
      label: "Start free trial",
      sublabel: "No credit card required",
      variant: "primary",
      accentColor: "#38bdf8",
      icon: "arrow",
      entrance: { name: "springPop" },
    },
  ],
  camera: {
    keyframes: [
      { at: 0, scale: 1 },
      { at: 9000, scale: 1.28, ease: "power3.inOut" },
    ],
    drift: { amplitudePct: 0.5, periodMs: 5200 },
    moves: [{ move: "slowPushIn", at: 3000, durationMs: 2200, strength: 0.9 }],
  },
  transitions: [
    { kind: "wipe", at: 2800, direction: "left", durationMs: 700, color: "#0b1020", featherPx: 90 },
    { kind: "morph", at: 9400, durationMs: 600 },
  ],
  audio: { cues: [{ at: 2000, sfx: "click" }] },
};

/** Top-level shape of a SceneSpec, for hosts that want it without the full schema. */
export const SCENE_TOP_LEVEL_REQUIRED = ["schemaVersion", "name", "canvas", "durationMs", "layers"] as const;

export const SCENE_TOP_LEVEL_OPTIONAL = [
  "id (stable id — re-posting the same id updates the scene in place)",
  "themePreset (optional art direction theme: appleKeynoteDark | linearMinimal | stripeVibrant | vercelMonochrome | emeraldFintech | editorialLight)",
  "assets ([] — declare every file referenced by a layer)",
  "fonts ([] — one entry per typography role)",
  "camera ({ perspective?, drift?, keyframes?, moves? })",
  "transitions ([])",
  "audio ({ music?, cues? })",
] as const;

/**
 * The single authoring digest. `core-engine` publishes it inside
 * `get_motion_capabilities`, and the MCP server serves it as the
 * `motionforge://scenespec/v1` resource — one source, no drift.
 *
 * It is deliberately self-sufficient: structure guidance AND the closed
 * vocabularies, so an LLM can author a valid scene from this alone, offline.
 */
export function authoringDigest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    units: {
      time: "milliseconds everywhere (at, durationMs, delayMs, cues[].at)",
      position: "canvas percent objects { xPct, yPct }",
      size: "design-space pixels via *Px keys (sizePx, widthPx, blurPx, radiusPx)",
      color: "CSS color string, or a linear gradient object for `fill`",
    },
    sceneTopLevel: {
      required: SCENE_TOP_LEVEL_REQUIRED,
      optional: SCENE_TOP_LEVEL_OPTIONAL,
    },
    commonLayerRequired: COMMON_LAYER_REQUIRED,
    commonLayerOptional: COMMON_LAYER_OPTIONAL,
    layerFieldGuide: LAYER_FIELD_GUIDE,
    nestedShapeNotes: NESTED_SHAPE_NOTES,
    minimalValidScene: MINIMAL_VALID_SCENE,
    fullShowcaseSketch: SHOWCASE_SCENE_SKETCH,
    registries: {
      layerTypes: LAYER_TYPES,
      backgroundVariants: BACKGROUND_VARIANTS,
      cardVariants: CARD_VARIANTS,
      foregroundFxKinds: FOREGROUND_FX_KINDS,
      presets: {
        entrance: ENTRANCE_PRESETS,
        emphasis: EMPHASIS_PRESETS,
        exit: EXIT_PRESETS,
      },
      easings: EASINGS,
      cameraMoves: CAMERA_MOVES,
      canvas: { shapes: CANVAS_SHAPES, scales: CANVAS_SCALES },
      sfxBank: SFX_NAMES,
      transitions: TRANSITION_KINDS,
      textRoles: FONT_ROLES,
      logoMasks: LOGO_MASKS,
      assetKinds: ASSET_KINDS,
      layerFilterKeys: LAYER_FILTER_KEYS,
      keyframeProperties: KEYFRAME_PROPERTIES,
      keyframeEasings: KEYFRAME_EASINGS,
      chartTypes: CHART_TYPES,
      codeBlockThemes: CODE_BLOCK_THEMES,
      particlePatterns: PARTICLE_PATTERNS,
      ctaVariants: CTA_VARIANTS,
      ctaIcons: CTA_ICONS,
      themePresets: THEME_PRESETS,
      layoutSlots: LAYOUT_SLOTS,
      deviceTypes: DEVICE_TYPES,
      deviceThemes: DEVICE_THEMES,
      deviceContentVariants: DEVICE_CONTENT_VARIANTS,
      cursorStyles: CURSOR_STYLES,
      cursorActions: CURSOR_ACTIONS,
    },
    keyframePrecedence: {
      canonical: "keyframes",
      legacy: "tracks",
      rule:
        "A layer may carry BOTH a flat `keyframes` array and a legacy `tracks` array. The FLAT `keyframes` array is canonical and WINS for every property it drives; `tracks` still applies the properties the flat array does not mention (e.g. widthPx / heightPx, which are layout writes, not transform writes). Write `keyframes` — never `tracks`.",
      conflictExample:
        'layer { keyframes: [{ property: "xPct", value: 40 }], tracks: [{ property: "position.xPct", keyframes: [{ at: 0, value: 10 }] }] } → the flat value (40) is the one that plays.',
      legacyShape:
        'tracks: [{ "property": "position.yPct", "keyframes": [{ "at": 0, "value": 10 }] }]',
      canonicalShape:
        'keyframes: [{ "id": "k1", "timeMs": 0, "property": "yPct", "value": 10 }]',
    },
    notes: {
      howToStart:
        "Copy minimalValidScene, change name/text, then call create_or_update_scene. Post fullShowcaseSketch to exercise every feature. On a rejected scene the response lists every field-level issue — fix exactly those paths. An ACCEPTED scene may still carry warnings[] (e.g. a camera that would show black void) — read them too.",
      rtl: 'set direction:"rtl" on kineticText; Arabic char-stagger degrades to word (shaping)',
      sfx: "cues fire relative to layer `at` (layer.sfx[].offsetMs) or absolute (audio.cues[].at)",
      timing: "all times are milliseconds; canvas positions are percent of canvas; sizes are design px",
      strictness: "unknown keys are rejected everywhere — do not invent field names",
      camera: "keyframes inherit unset fields from the previous keyframe; at scale s the safe pan range is [50/s, 100-50/s]",
      effects: "emphasis presets and camera moves are temporary — they return to the baseline when their window ends",
      inspection: "inspect_scene_keyframes returns framesMeta[] (camera pose, transition phase, per-layer lifecycle/opacity/bbox/textOverflow) — read it before judging a frame",
      layerKinds:
        `There are ${LAYER_TYPES.length} layer types: ${LAYER_TYPES.join(", ")}. Every kind carries its own timing, motion presets, position, filters and keyframes.`,
      sizeUnits:
        "Sizes normally carry a `*Px` suffix (widthPx, heightPx, labelSizePx). `codeBlock.fontSize` and `particleField.size` are the two exceptions; their `*Px` aliases (fontSizePx, sizePx) are also accepted and are normalised on save.",
      theming:
        "A themePreset injects the --mf-* CSS variables across the stage root, and an explicit layer color always wins.",
      layout:
        "Guaranteed-disjoint triples (e.g. topHeader, topSubhead, bottomCenterCta) provide collision-free placement, while centerStage is a container slot that intentionally spans the middle canvas.",
    },
  };
}

export { layerBaseSchema };