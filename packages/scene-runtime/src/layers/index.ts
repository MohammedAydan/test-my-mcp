import type { Layer } from "@motionforge/scene-spec";
import type { LayerContext } from "./context.js";
import { renderBackground } from "./background.js";
import { renderImageLogo } from "./image-logo.js";
import { renderKineticText } from "./kinetic-text.js";
import { renderCard } from "./card.js";
import { renderLottie } from "./lottie.js";
import { renderForegroundFx } from "./foreground-fx.js";
import { renderChart } from "./chart.js";
import { renderCodeBlock } from "./code-block.js";
import { renderParticleField } from "./particle-field.js";
import { renderCta } from "./cta.js";
import { renderDeviceMockup } from "./device-mockup.js";
import { renderCursorFlow } from "./cursor-flow.js";
import { renderBentoGrid } from "./bento-grid.js";
import { renderConnectorDiagram } from "./connector-diagram.js";
import { renderMetricTicker } from "./metric-ticker.js";
import { renderComparisonSplit } from "./comparison-split.js";

export interface BuiltLayer {
  /** element that entrance/emphasis/exit presets animate */
  content: HTMLElement;
  /** split units (word/char/line spans) for staggered text presets */
  units?: HTMLElement[];
  /**
   * line containers for text layers — the level mask-reveal presets clip at.
   * Clipping a *unit* cuts a word in half; clipping a *line* reveals the phrase.
   */
  lines?: HTMLElement[];
}

export type AnyLayerRenderer = (layer: never, ctx: LayerContext) => BuiltLayer;

/** Type-safe dispatch from layer type → renderer. */
export function renderLayer(layer: Layer, ctx: LayerContext): BuiltLayer {
  switch (layer.type) {
    case "background":
      return renderBackground(layer, ctx);
    case "imageLogo":
      return renderImageLogo(layer, ctx);
    case "kineticText":
      return renderKineticText(layer, ctx);
    case "card":
      return renderCard(layer, ctx);
    case "lottie":
      return renderLottie(layer, ctx);
    case "foregroundFX":
      return renderForegroundFx(layer, ctx);
    case "chart":
      return renderChart(layer, ctx);
    case "codeBlock":
      return renderCodeBlock(layer, ctx);
    case "particleField":
      return renderParticleField(layer, ctx);
    case "cta":
      return renderCta(layer, ctx);
    case "deviceMockup":
      return renderDeviceMockup(layer, ctx);
    case "cursorFlow":
      return renderCursorFlow(layer, ctx);
    case "bentoGrid":
      return renderBentoGrid(layer, ctx);
    case "connectorDiagram":
      return renderConnectorDiagram(layer, ctx);
    case "metricTicker":
      return renderMetricTicker(layer, ctx);
    case "comparisonSplit":
      return renderComparisonSplit(layer, ctx);
  }
}
