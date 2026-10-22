import type { ParticleFieldLayer, ParticlePattern } from "@motionforge/scene-spec";
import { clamp, mixColors, num, safeColor } from "./guards.js";
import type { LayerContext } from "./context.js";

/**
 * The `particleField` layer — a full-bleed field of motion particles.
 *
 * DETERMINISM IS THE WHOLE POINT.
 *
 * Every particle's position and opacity is a PURE FUNCTION of
 * `(timeMs, seed, index)` — see {@link particleStateAt}. There is no
 * `Math.random()`, no `Date.now()`, no `requestAnimationFrame` and no wall
 * clock anywhere in this file. The field is driven by ONE tween that spans
 * the whole scene and recomputes every particle from `tl.time() * 1000`, so a
 * headless seek to t=4200 ms produces the EXACT same pixels on every machine,
 * on every run, in every process.
 *
 * PERFORMANCE: the per-frame cost is O(count). The geometry (the lattice, the
 * constellation's connecting lines) is computed ONCE at build time; the frame
 * loop only writes a transform and an opacity per particle. The drawn count is
 * capped, so a scene that asks for 400 particles paints 400 — never more.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** The drawn particles are capped: a field must never melt the frame. */
export const MAX_PARTICLES = 400;

/** How many colour steps the `color` → `color2` interpolation is quantised to. */
const COLOR_BUCKETS = 24;

export interface ParticleState {
  /** normalised x, 0..1 */
  x: number;
  /** normalised y, 0..1 */
  y: number;
  /** opacity multiplier, 0..1 */
  opacity: number;
  /** size multiplier relative to the layer's `size` */
  sizeScale: number;
  /** the blend between `color` and `color2`, 0..1 */
  tint: number;
  /** the particle's own phase, 0..1 */
  phase: number;
}

/**
 * A deterministic hash of `(seed, index, salt)` into 0..1.
 *
 * A plain LCG would work too, but this avalanche mix keeps NEIGHBOURING
 * indices far apart in the output space — which matters for the lattice
 * patterns, where a weak hash makes the grid look striped instead of random.
 */
function hash01(seed: number, index: number, salt: number): number {
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2d) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const TAU = Math.PI * 2;

/** Wrap a value into 0..1. */
function wrap01(value: number): number {
  const v = value % 1;
  return v < 0 ? v + 1 : v;
}

/**
 * The state of one particle at one instant.
 *
 * PURE: the same arguments always produce the same result — there is no
 * hidden state, no clock and no randomness. `count` and `speed` are optional
 * so the four-argument form `(pattern, tMs, seed, index)` works too.
 */
export function particleStateAt(
  pattern: ParticlePattern,
  tMs: number,
  seed: number,
  index: number,
  count = 1,
  speed = 1
): ParticleState {
  const n = Math.max(1, Math.floor(count));
  const tSec = (Number.isFinite(tMs) ? tMs : 0) / 1000;
  const spd = Number.isFinite(speed) && speed > 0 ? speed : 1;

  if (pattern === "grid") {
    // A STATIC lattice that gently pulses. The pulse is a scale about the
    // centre, so the field breathes instead of crawling.
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const rows = Math.max(1, Math.ceil(n / cols));
    const col = index % cols;
    const row = Math.floor(index / cols);
    const jx = (hash01(seed, index, 1) - 0.5) * 0.008;
    const jy = (hash01(seed, index, 2) - 0.5) * 0.008;
    const cx = (col + 0.5) / cols;
    const cy = (row + 0.5) / rows;
    const pulse = 1 + 0.03 * Math.sin(tSec * 0.8 * spd);
    const wave = 0.5 + 0.5 * Math.sin((tSec * 0.6 * spd - (col + row) * 0.12) * TAU);
    return {
      x: 0.5 + (cx + jx - 0.5) * pulse,
      y: 0.5 + (cy + jy - 0.5) * pulse,
      opacity: 0.3 + 0.7 * wave * wave,
      sizeScale: 0.55 + hash01(seed, index, 3) * 0.45,
      tint: hash01(seed, index, 4),
      phase: hash01(seed, index, 6),
    };
  }

  if (pattern === "constellation") {
    // A star map: the points are STATIC, the shimmer is the motion. The
    // connecting lines are built once (see the renderer), so the frame loop
    // stays O(count).
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const rows = Math.max(1, Math.ceil(n / cols));
    const col = index % cols;
    const row = Math.floor(index / cols);
    const jx = (hash01(seed, index, 1) - 0.5) * 0.55;
    const jy = (hash01(seed, index, 2) - 0.5) * 0.55;
    const phase = hash01(seed, index, 3);
    const shimmer = 0.5 + 0.5 * Math.sin((tSec * 0.9 * spd + phase) * TAU);
    return {
      x: clamp((col + 0.5 + jx) / cols, 0, 1),
      y: clamp((row + 0.5 + jy) / rows, 0, 1),
      opacity: 0.18 + 0.82 * shimmer * shimmer,
      sizeScale: 0.6 + hash01(seed, index, 4) * 0.7,
      tint: hash01(seed, index, 5),
      phase,
    };
  }

  if (pattern === "sparkle") {
    // Points that fade in and out, each with its own phase.
    const px = hash01(seed, index, 1);
    const py = hash01(seed, index, 2);
    const phase = hash01(seed, index, 3);
    const rate = 0.6 + hash01(seed, index, 4) * 1.4;
    const wave = 0.5 + 0.5 * Math.sin((tSec * rate * spd + phase) * TAU);
    return {
      x: wrap01(px + Math.sin(tSec * 0.3 * spd + phase * TAU) * 0.004),
      y: wrap01(py + Math.cos(tSec * 0.25 * spd + phase * TAU) * 0.004),
      opacity: Math.pow(wave, 2.4),
      sizeScale: 0.5 + hash01(seed, index, 5) * 0.9,
      tint: hash01(seed, index, 6),
      phase,
    };
  }

  // float: a slow upward / diagonal drift with a wrap.
  const px = hash01(seed, index, 1);
  const py = hash01(seed, index, 2);
  const rise = 0.25 + hash01(seed, index, 3) * 0.55;
  const swayAmp = 0.008 + hash01(seed, index, 4) * 0.028;
  const swayFreq = 0.25 + hash01(seed, index, 5) * 0.5;
  const phase = hash01(seed, index, 6);
  const driftX = (hash01(seed, index, 7) - 0.5) * 0.02;
  const breathing = 0.5 + 0.5 * Math.sin((tSec * 0.8 * spd + phase) * TAU);
  return {
    x: wrap01(px + tSec * driftX * spd + Math.sin(tSec * swayFreq * spd * TAU + phase * TAU) * swayAmp),
    y: wrap01(py - tSec * rise * spd * 0.06),
    opacity: 0.45 + 0.55 * breathing,
    sizeScale: 0.5 + hash01(seed, index, 8) * 0.9,
    tint: hash01(seed, index, 9),
    phase,
  };
}

/** How the frame loop paints the field. */
interface Painter {
  /** apply the state of particle `index` at `tMs` */
  apply(index: number, state: ParticleState, tMs: number): void;
  /** anything that is not per-particle (the constellation's connecting lines) */
  applyExtra?(tMs: number): void;
}

export function renderParticleField(
  layer: ParticleFieldLayer,
  ctx: LayerContext
): { content: HTMLElement } {
  const count = clamp(Math.round(num(layer.count, 80)), 1, MAX_PARTICLES);
  const pattern: ParticlePattern =
    layer.pattern === "grid" || layer.pattern === "constellation" || layer.pattern === "sparkle"
      ? layer.pattern
      : "float";
  const color = safeColor(layer.color, "#7dd3fc");
  const color2 =
    typeof layer.color2 === "string" && layer.color2.trim().length > 0 ? layer.color2 : undefined;
  const speed = clamp(num(layer.speed, 1), 0.1, 4);
  const size = clamp(num(layer.size, num(layer.sizePx, 3)), 0.5, 40);
  const seed = Math.round(num(layer.seed, 20260101)) >>> 0;
  const opacity = clamp(num(layer.opacity, 0.75), 0, 1);

  const W = Number.isFinite(ctx.width) && ctx.width > 0 ? ctx.width : 1920;
  const H = Number.isFinite(ctx.height) && ctx.height > 0 ? ctx.height : 1080;

  // The host is FULL-BLEED: it paints into the whole canvas, exactly like a
  // background does, so it carries no anchor of its own.
  //
  // The field lives in its own inner box so that the layer's measured
  // bounding box is the WHOLE CANVAS and not the first particle (the Studio's
  // gizmo and the `framesMeta` bbox both read the content element's first
  // child).
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none;";
  ctx.content.appendChild(host);
  const field = document.createElement("div");
  field.style.cssText = "position:absolute;inset:0;";
  host.appendChild(field);

  // The quantised colour ramp: `color` → `color2`. Quantising means the frame
  // loop assigns a PRE-BUILT string instead of building one per particle per
  // frame.
  const palette: string[] = [];
  for (let i = 0; i < COLOR_BUCKETS; i++) {
    const t = i / (COLOR_BUCKETS - 1);
    palette.push(color2 ? mixColors(color, color2, t) : color);
  }

  const bucketOf = (tint: number): number =>
    clamp(Math.round(tint * (COLOR_BUCKETS - 1)), 0, COLOR_BUCKETS - 1);

  let painter: Painter;

  if (pattern === "constellation") {
    // ---- the constellation -------------------------------------------------
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.cssText = "position:absolute;inset:0;overflow:hidden;";
    field.appendChild(svg);

    const points: Array<{ x: number; y: number; state: ParticleState }> = [];
    for (let i = 0; i < count; i++) {
      const state = particleStateAt(pattern, 0, seed, i, count, speed);
      points.push({ x: state.x * W, y: state.y * H, state });
    }

    // The connecting lines are STATIC: each point is wired to its two
    // nearest neighbours. The nearest-neighbour search happens ONCE, at build
    // time, so the per-frame cost stays O(count).
    const lineGroup = document.createElementNS(SVG_NS, "g");
    svg.appendChild(lineGroup);
    const lines: Array<{ node: SVGElement; phase: number }> = [];
    const MAX_LINES = Math.min(count, 400);
    const linkRadius = Math.max(W, H) * 0.16;

    for (let i = 0; i < count && lines.length < MAX_LINES; i++) {
      const origin = points[i]!;
      const neighbours: Array<{ index: number; distance: number }> = [];
      for (let j = 0; j < count; j++) {
        if (j === i) continue;
        const other = points[j]!;
        const distance = Math.hypot(other.x - origin.x, other.y - origin.y);
        if (distance > linkRadius) continue;
        neighbours.push({ index: j, distance });
      }
      neighbours.sort((a, b) => a.distance - b.distance);
      for (const neighbour of neighbours.slice(0, 2)) {
        if (lines.length >= MAX_LINES) break;
        const other = points[neighbour.index]!;
        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("x1", String(origin.x));
        line.setAttribute("y1", String(origin.y));
        line.setAttribute("x2", String(other.x));
        line.setAttribute("y2", String(other.y));
        line.setAttribute("stroke", color);
        line.setAttribute("stroke-width", "1");
        lineGroup.appendChild(line);
        lines.push({ node: line, phase: (origin.state.phase + other.state.phase) * 0.5 });
      }
    }

    const dots: SVGElement[] = [];
    for (let i = 0; i < count; i++) {
      const point = points[i]!;
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", String(point.x));
      dot.setAttribute("cy", String(point.y));
      dot.setAttribute("r", String(size * point.state.sizeScale));
      dot.setAttribute("fill", palette[bucketOf(point.state.tint)]!);
      svg.appendChild(dot);
      dots.push(dot);
    }

    painter = {
      apply(index, state) {
        const dot = dots[index];
        if (!dot) return;
        dot.setAttribute("opacity", String(clamp(state.opacity, 0, 1)));
      },
      applyExtra(tMs) {
        const tSec = tMs / 1000;
        for (const line of lines) {
          const shimmer = 0.5 + 0.5 * Math.sin((tSec * 0.9 + line.phase) * TAU);
          line.node.setAttribute("opacity", String(0.04 + 0.3 * shimmer * shimmer));
        }
      },
    };
  } else {
    // ---- the dot-based patterns --------------------------------------------
    const dots: HTMLElement[] = [];
    const buckets: number[] = new Array<number>(count).fill(-1);
    for (let i = 0; i < count; i++) {
      const state = particleStateAt(pattern, 0, seed, i, count, speed);
      const dot = document.createElement("div");
      const diameter = size * 2 * state.sizeScale;
      dot.style.cssText = [
        "position:absolute",
        "left:0",
        "top:0",
        `width:${diameter}px`,
        `height:${diameter}px`,
        "border-radius:50%",
        `background:${palette[bucketOf(state.tint)]!}`,
        "will-change:transform",
      ].join(";");
      field.appendChild(dot);
      dots.push(dot);
    }
    painter = {
      apply(index, state) {
        const dot = dots[index];
        if (!dot) return;
        const x = state.x * W;
        const y = state.y * H;
        dot.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
        // The float pattern WRAPS: a particle that leaves the top re-enters at
        // the bottom. Fading it out at the edges hides the seam, so the field
        // never pops.
        const edge =
          pattern === "float"
            ? clamp(Math.min(y, H - y) / (H * 0.12), 0, 1)
            : clamp(Math.min(x, W - x, y, H - y) / (Math.min(W, H) * 0.05), 0, 1);
        dot.style.opacity = String(opacity * state.opacity * edge);
        const bucket = bucketOf(state.tint);
        if (buckets[index] !== bucket) {
          buckets[index] = bucket;
          dot.style.background = palette[bucket]!;
        }
      },
    };
  }

  // ---- the driver ----------------------------------------------------------
  // ONE tween spans the WHOLE scene and recomputes every particle from the
  // timeline's own time. There is no second clock.
  const driver = { p: 0 };
  const update = (tMs: number): void => {
    for (let i = 0; i < count; i++) {
      painter.apply(i, particleStateAt(pattern, tMs, seed, i, count, speed), tMs);
    }
    painter.applyExtra?.(tMs);
  };

  const durationSec = Math.max(0.001, num(ctx.scene.durationMs, 1000) / 1000);
  ctx.tl.to(
    driver,
    {
      p: 1,
      duration: durationSec,
      ease: "none",
      onUpdate: () => update(ctx.tl.time() * 1000),
    },
    0
  );
  update(0);

  return { content: host };
}
