import { z } from "zod";
import { colorSchema } from "./common.js";
import { KEYFRAME_VALUE_RANGES } from "./layers/base.js";
import { LAYOUT_SLOT_BOXES, type LayoutSlot } from "./layout-slots.js";
import { sceneShapeSchema } from "./scene.js";

/**
 * Scene Sanitizer / Normalizer.
 *
 * The Studio is a *direct-manipulation* editor: it writes spatial and NLE
 * properties onto whichever layer the user grabbed — including a `background`
 * at `layers.0`. Those properties are now part of the contract (see
 * `layerBaseSchema`), but an older scene file, a plugin-authored layer, or a
 * half-migrated project can still carry UI-only bookkeeping keys.
 *
 * This module is the single normalizer used by BOTH write paths:
 *
 * - `EngineCore.saveScene` (in-process IPC — the Studio),
 * - `packages/studio/src/api.ts` (renderer → main boundary),
 *
 * so a payload can never be rejected for a transient property, and the two
 * paths can never disagree about what "the same scene" means.
 *
 * It deliberately does **not** remove genuinely unknown fields by default:
 * a hallucinated key must still surface as a validation error, exactly as the
 * strict schema intends. Legacy scenes loaded from disk opt into
 * `dropUnknown`, which removes keys the schema does not know.
 */

/** Keys the Studio uses as *bookkeeping* only — never part of a scene. */
const TRANSIENT_KEY_PREFIX = "_";

/**
 * Legacy bookkeeping keys and the authored field each one is healed into.
 *
 * `_hidden` / `_locked` were UI-only markers before `visible` / `locked` became
 * real, persisted layer fields. Dropping them would silently lose the
 * author's intent, so they are *migrated* instead.
 */
const TRANSIENT_HEAL: Record<string, string> = {
  _hidden: "visible",
  _locked: "locked",
};

export interface SanitizeOptions {
  /**
   * Also remove keys the schema does not know.
   *
   * Used when hydrating scenes from disk: a file written by another build
   * (or by a future schema version) must not make the whole scene unloadable.
   */
  dropUnknown?: boolean;
}

export interface SanitizeReport {
  /** the normalized scene */
  scene: unknown;
  /** dotted paths of the transient properties that were removed or healed */
  healed: string[];
  /** dotted paths of the fields that were clamped into their legal range */
  clamped: string[];
  /** dotted paths of the layout-slot fields that were resolved */
  resolved: string[];
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const deepClone = <T>(value: T): T => {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => deepClone(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = deepClone(v);
  }
  return out as unknown as T;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** A finite number, or `undefined` for anything that is not a number. */
const finiteOr = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Legal range of every numeric entry of the `filters` bag. */
const FILTER_RANGES: Record<string, { min: number; max: number }> = {
  blur: { min: 0, max: 200 },
  brightness: { min: 0, max: 400 },
  contrast: { min: 0, max: 400 },
  saturate: { min: 0, max: 400 },
  shadowBlur: { min: 0, max: 200 },
  cornerRadius: { min: 0, max: 400 },
};

/**
 * Normalize the `filters` bag of ONE layer.
 *
 * A filter whose value is not a number (or not a colour, for `shadowColor`) is
 * DROPPED rather than carried into the schema, where it would fail the whole
 * save: a half-authored filter must not make a scene unloadable.
 */
function normalizeFilters(layer: Record<string, unknown>, path: string, report: SanitizeReport): void {
  const filters = layer.filters;
  if (!isPlainObject(filters)) {
    if (filters !== undefined) {
      delete layer.filters;
      report.clamped.push(`${path}.filters`);
    }
    return;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (key === "shadowColor") {
      if (typeof value === "string" && colorSchema.safeParse(value).success) {
        out.shadowColor = value;
      } else {
        report.clamped.push(`${path}.filters.shadowColor`);
      }
      continue;
    }
    const range = FILTER_RANGES[key];
    if (!range) {
      // an unknown filter key is a hallucinated field: drop it
      report.clamped.push(`${path}.filters.${key}`);
      continue;
    }
    const numeric = finiteOr(value);
    if (numeric === undefined) {
      report.clamped.push(`${path}.filters.${key}`);
      continue;
    }
    const clamped = clamp(numeric, range.min, range.max);
    if (clamped !== numeric) report.clamped.push(`${path}.filters.${key}`);
    out[key] = clamped;
  }
  layer.filters = out;
}

/**
 * Normalize the flat `keyframes` list of ONE layer.
 *
 * Each value is clamped into the range its PROPERTY allows (a keyframe's
 * `value` is a plain number, so the legal range depends on what it drives),
 * and a keyframe whose property is unknown is dropped — it cannot be
 * interpolated, so keeping it would only produce a confusing validation error
 * about a value that was never going to be used.
 */
function normalizeKeyframes(layer: Record<string, unknown>, path: string, report: SanitizeReport): void {
  const keyframes = layer.keyframes;
  if (!Array.isArray(keyframes)) {
    if (keyframes !== undefined) {
      delete layer.keyframes;
      report.clamped.push(`${path}.keyframes`);
    }
    return;
  }

  const kept: Record<string, unknown>[] = [];
  keyframes.forEach((raw, i) => {
    if (!isPlainObject(raw)) {
      report.clamped.push(`${path}.keyframes.${i}`);
      return;
    }
    const property = typeof raw.property === "string" ? raw.property : undefined;
    const range = property ? KEYFRAME_VALUE_RANGES[property as keyof typeof KEYFRAME_VALUE_RANGES] : undefined;
    if (!range) {
      report.clamped.push(`${path}.keyframes.${i}`);
      return;
    }
    const value = finiteOr(raw.value);
    if (value === undefined) {
      report.clamped.push(`${path}.keyframes.${i}.value`);
      return;
    }
    const clamped = clamp(value, range.min, range.max);
    if (clamped !== value) report.clamped.push(`${path}.keyframes.${i}.value`);
    kept.push({ ...raw, value: clamped });
  });
  layer.keyframes = kept;
}

/**
 * Normalize the `size` bag of ONE layer (layout size, in canvas percent).
 */
function normalizeSize(layer: Record<string, unknown>, path: string, report: SanitizeReport): void {
  const size = layer.size;
  if (typeof size === "number") {
    // `particleField` SHADOWS the layout-size bag with a numeric particle
    // RADIUS. It is not a layout box, so it is not this function's business —
    // and deleting it here would silently throw the radius away.
    if (layer.type === "particleField") return;
    if (size !== undefined) {
      delete layer.size;
      report.clamped.push(`${path}.size`);
    }
    return;
  }
  if (!isPlainObject(size)) {
    if (size !== undefined) {
      delete layer.size;
      report.clamped.push(`${path}.size`);
    }
    return;
  }
  const out: Record<string, unknown> = {};
  for (const key of ["widthPct", "heightPct"] as const) {
    if (!(key in size)) continue;
    const numeric = finiteOr(size[key]);
    if (numeric === undefined) {
      report.clamped.push(`${path}.size.${key}`);
      continue;
    }
    const clamped = clamp(numeric, 0, 400);
    if (clamped !== numeric) report.clamped.push(`${path}.size.${key}`);
    out[key] = clamped;
  }
  if (Object.keys(out).length === 0) {
    delete layer.size;
  } else {
    layer.size = out;
  }
}

/**
 * Normalize the fields of the NEWER layer kinds (`chart`, `codeBlock`,
 * `particleField`, `cta`).
 *
 * Two jobs:
 *
 * 1. **Alias healing.** The repository convention is that every size carries
 *    a `*Px` suffix, but the newer kinds ship a canonical name without it
 *    (`fontSize`, `size`). A scene written by hand — or by an LLM that read
 *    the field guide — may use either spelling. Both are accepted by the
 *    schema, and the sanitizer folds the alias into the canonical field so
 *    the runtime only ever reads ONE name.
 *
 * 2. **Degrading a malformed payload.** A `chart` whose `data` is not an
 *    array, or whose entries are not objects, must not make the whole scene
 *    unloadable: the offending entries are dropped and the rest survives.
 */
function normalizeNewLayerKinds(layer: Record<string, unknown>, path: string, report: SanitizeReport): void {
  const type = layer.type;

  // ---- codeBlock: fontSizePx -> fontSize --------------------------------
  if (type === "codeBlock") {
    const alias = finiteOr(layer.fontSizePx);
    if (alias !== undefined) {
      if (layer.fontSize === undefined) layer.fontSize = alias;
      delete layer.fontSizePx;
      report.healed.push(`${path}.fontSizePx`);
    }
    const lines = layer.highlightLines;
    if (lines !== undefined && !Array.isArray(lines)) {
      delete layer.highlightLines;
      report.clamped.push(`${path}.highlightLines`);
    } else if (Array.isArray(lines)) {
      const kept = lines.filter(
        (n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 1
      );
      if (kept.length !== lines.length) report.clamped.push(`${path}.highlightLines`);
      layer.highlightLines = kept;
    }
  }

  // ---- particleField: sizePx -> size ------------------------------------
  if (type === "particleField") {
    const alias = finiteOr(layer.sizePx);
    if (alias !== undefined) {
      if (layer.size === undefined) layer.size = alias;
      delete layer.sizePx;
      report.healed.push(`${path}.sizePx`);
    }
    const size = finiteOr(layer.size);
    if (size !== undefined) layer.size = clamp(size, 0.5, 40);
    const count = finiteOr(layer.count);
    if (count !== undefined) layer.count = clamp(Math.round(count), 1, 400);
  }

  // ---- chart: drop malformed data points --------------------------------
  if (type === "chart") {
    const data = layer.data;
    if (!Array.isArray(data)) {
      delete layer.data;
      report.clamped.push(`${path}.data`);
    } else {
      const kept = data.filter((d): d is Record<string, unknown> => isPlainObject(d));
      if (kept.length !== data.length) report.clamped.push(`${path}.data`);
      layer.data = kept.map((d) => {
        const value = finiteOr(d.value);
        const label = typeof d.label === "string" ? d.label : "";
        return { ...d, label, value: value ?? 0 };
      });
    }
  }

  // ---- cursorFlow: sort waypoints stably by atMs ------------------------
  if (type === "cursorFlow") {
    const waypoints = layer.waypoints;
    if (Array.isArray(waypoints)) {
      let outOfOrder = false;
      for (let i = 0; i < waypoints.length - 1; i++) {
        const a = (waypoints[i] as Record<string, unknown>)?.atMs;
        const b = (waypoints[i + 1] as Record<string, unknown>)?.atMs;
        if (typeof a === "number" && typeof b === "number" && a > b) {
          outOfOrder = true;
          break;
        }
      }
      if (outOfOrder) {
        layer.waypoints = [...waypoints].sort((a, b) => {
          const atA = typeof (a as Record<string, unknown>)?.atMs === "number" ? ((a as Record<string, unknown>).atMs as number) : 0;
          const atB = typeof (b as Record<string, unknown>)?.atMs === "number" ? ((b as Record<string, unknown>).atMs as number) : 0;
          return atA - atB;
        });
        report.healed.push(`${path}.waypoints`);
      }
    }
  }
}

/**
 * Normalize the `layoutSlot` of ONE layer.
 *
 * For every layer with a valid `layoutSlot`, fills missing `position.xPct`,
 * `position.yPct`, `size.widthPct`, `size.heightPct` from `LAYOUT_SLOT_BOXES`.
 * Never overrides an explicit value. Dotted paths of filled values are
 * recorded in `report.resolved`.
 * Unknown slot names are kept untouched on the layer so strict validation can reject them.
 */
function normalizeLayoutSlot(layer: Record<string, unknown>, path: string, report: SanitizeReport): void {
  const slotName = layer.layoutSlot;
  if (typeof slotName !== "string" || !(slotName in LAYOUT_SLOT_BOXES)) {
    return;
  }
  const box = LAYOUT_SLOT_BOXES[slotName as LayoutSlot];

  if (!("position" in layer) || layer.position === undefined) {
    layer.position = { xPct: box.xPct, yPct: box.yPct };
    report.resolved.push(`${path}.position.xPct`, `${path}.position.yPct`);
  } else if (isPlainObject(layer.position)) {
    const pos = layer.position as Record<string, unknown>;
    if (pos.xPct === undefined) {
      pos.xPct = box.xPct;
      report.resolved.push(`${path}.position.xPct`);
    }
    if (pos.yPct === undefined) {
      pos.yPct = box.yPct;
      report.resolved.push(`${path}.position.yPct`);
    }
  }

  // particleField shadows size with a numeric radius; do not override with a layout box
  if (layer.type !== "particleField") {
    if (!("size" in layer) || layer.size === undefined) {
      layer.size = { widthPct: box.widthPct, heightPct: box.heightPct };
      report.resolved.push(`${path}.size.widthPct`, `${path}.size.heightPct`);
    } else if (isPlainObject(layer.size)) {
      const sz = layer.size as Record<string, unknown>;
      if (sz.widthPct === undefined) {
        sz.widthPct = box.widthPct;
        report.resolved.push(`${path}.size.widthPct`);
      }
      if (sz.heightPct === undefined) {
        sz.heightPct = box.heightPct;
        report.resolved.push(`${path}.size.heightPct`);
      }
    }
  }
}

/**
 * Normalize the spatial / NLE fields of ONE layer.
 *
 * The Studio drags these continuously; a drag that ends 0.4% outside the legal
 * range must not fail the whole save. Out-of-range values are clamped, and
 * values that are not numbers at all are removed so the schema reports the
 * problem instead of the sanitizer hiding it.
 */
function normalizeLayerFields(layer: Record<string, unknown>, path: string, report: SanitizeReport): void {
  const setClamped = (key: string, value: number, min: number, max: number) => {
    const clamped = clamp(value, min, max);
    if (clamped !== value) report.clamped.push(`${path}.${key}`);
    layer[key] = clamped;
  };

  if (finiteOr(layer.rotation) !== undefined) {
    setClamped("rotation", layer.rotation as number, -3600, 3600);
  } else if ("rotation" in layer) {
    delete layer.rotation;
  }

  if (finiteOr(layer.scale) !== undefined) {
    setClamped("scale", layer.scale as number, 0.05, 10);
  } else if ("scale" in layer) {
    delete layer.scale;
  }

  if (finiteOr(layer.scaleX) !== undefined) {
    setClamped("scaleX", layer.scaleX as number, 0.05, 10);
  } else if ("scaleX" in layer) {
    delete layer.scaleX;
  }

  if (finiteOr(layer.scaleY) !== undefined) {
    setClamped("scaleY", layer.scaleY as number, 0.05, 10);
  } else if ("scaleY" in layer) {
    delete layer.scaleY;
  }

  if (finiteOr(layer.opacity) !== undefined) {
    setClamped("opacity", layer.opacity as number, 0, 1);
  } else if ("opacity" in layer) {
    delete layer.opacity;
  }

  if ("visible" in layer && typeof layer.visible !== "boolean") {
    delete layer.visible;
  }
  if ("locked" in layer && typeof layer.locked !== "boolean") {
    delete layer.locked;
  }

  normalizeLayoutSlot(layer, path, report);

  const position = layer.position;
  if (isPlainObject(position)) {
    const xPct = finiteOr(position.xPct);
    const yPct = finiteOr(position.yPct);
    if (xPct === undefined || yPct === undefined) {
      delete layer.position;
      report.clamped.push(`${path}.position`);
    } else {
      const nx = clamp(xPct, -300, 300);
      const ny = clamp(yPct, -300, 300);
      if (nx !== xPct || ny !== yPct) report.clamped.push(`${path}.position`);
      layer.position = { xPct: nx, yPct: ny };
    }
  } else if ("position" in layer) {
    delete layer.position;
    report.clamped.push(`${path}.position`);
  }

  // The NEWER layer kinds are normalised FIRST: `particleField` shadows the
  // universal `size` bag with a numeric radius, and the alias healing has to
  // fold `sizePx` into `size` BEFORE the layout-size normaliser looks at it.
  normalizeNewLayerKinds(layer, path, report);
  normalizeSize(layer, path, report);
  normalizeFilters(layer, path, report);
  normalizeKeyframes(layer, path, report);

  const rawTrackIndex = layer.trackIndex;
  if (typeof rawTrackIndex === "number") {
    const rounded = Number.isInteger(rawTrackIndex) ? rawTrackIndex : Math.round(rawTrackIndex);
    if (rounded !== rawTrackIndex) report.clamped.push(`${path}.trackIndex`);
    layer.trackIndex = clamp(rounded, 0, 99);
  }
}

/**
 * Recursively remove transient (`_`-prefixed) properties and heal the legacy
 * ones into their authored equivalents.
 */
function stripTransient(node: unknown, path: string, report: SanitizeReport): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => stripTransient(item, `${path}.${i}`, report));
    return;
  }
  if (!isPlainObject(node)) return;

  for (const key of Object.keys(node)) {
    if (!key.startsWith(TRANSIENT_KEY_PREFIX)) continue;
    const value = node[key];
    delete node[key];
    report.healed.push(`${path}.${key}`);
    const target = TRANSIENT_HEAL[key];
    if (target && value !== undefined && node[target] === undefined) {
      node[target] = key === "_hidden" ? value === false : Boolean(value);
    }
  }

  for (const [key, value] of Object.entries(node)) {
    stripTransient(value, path ? `${path}.${key}` : key, report);
  }
}

/* ------------------------------------------------------------------------- */
/* Unknown-key removal (legacy disk hydration only)                          */
/* ------------------------------------------------------------------------- */

/**
 * Resolve a `_def` member that may be stored lazily.
 *
 * Zod 3.25 stores `shape` / `type` / `options` / `defaultValue` as thunks
 * (`() => value`) so a recursive schema can be built without a circular
 * import. Older 3.x releases store the value directly, so both are handled.
 */
function resolveDef<T>(value: unknown): T {
  return (typeof value === "function" ? (value as () => T)() : value) as T;
}

/**
 * Build a "strip" twin of the scene shape.
 *
 * The scene schema is written with `z.strictObject` on purpose: a hallucinated
 * key must be an error. For disk hydration we need the opposite — a twin that
 * silently drops what it does not know — so the shape is rebuilt with plain
 * (strip-mode) objects.
 *
 * The rebuild is defensive: a node type the converter does not understand is
 * returned untouched, which means it stays strict and reports the problem
 * instead of hiding it.
 */
function toStripSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = (schema as unknown as { _def?: Record<string, unknown> })._def;
  if (!def || typeof def !== "object") return schema;

  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = resolveDef<Record<string, z.ZodTypeAny>>(def.shape);
      const rebuilt: Record<string, z.ZodTypeAny> = {};
      for (const [key, value] of Object.entries(shape ?? {})) {
        rebuilt[key] = toStripSchema(value);
      }
      return z.object(rebuilt);
    }
    case z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion: {
      const options = resolveDef<z.ZodTypeAny[]>(def.options).map((o) => toStripSchema(o));
      return z.discriminatedUnion(def.discriminator as string, options as never);
    }
    case z.ZodFirstPartyTypeKind.ZodUnion: {
      const options = resolveDef<z.ZodTypeAny[]>(def.options).map((o) => toStripSchema(o));
      return z.union(options as never);
    }
    case z.ZodFirstPartyTypeKind.ZodArray: {
      return z.array(toStripSchema(resolveDef<z.ZodTypeAny>(def.type)));
    }
    case z.ZodFirstPartyTypeKind.ZodOptional: {
      return toStripSchema(resolveDef<z.ZodTypeAny>(def.innerType)).optional();
    }
    case z.ZodFirstPartyTypeKind.ZodDefault: {
      const defaultValue = resolveDef<unknown>(def.defaultValue);
      return toStripSchema(resolveDef<z.ZodTypeAny>(def.innerType)).default(defaultValue as never);
    }
    case z.ZodFirstPartyTypeKind.ZodEffects: {
      // A refinement (e.g. the keyframe value-range check) is DROPPED in the
      // strip twin: the strict schema still applies it afterwards, and keeping
      // it here would make the "drop what we do not know" pass fail on a value
      // that is perfectly legal.
      return toStripSchema(resolveDef<z.ZodTypeAny>(def.schema));
    }
    default:
      return schema;
  }
}

let stripSchemaCache: z.ZodTypeAny | null = null;
function getStripSchema(): z.ZodTypeAny {
  if (!stripSchemaCache) {
    stripSchemaCache = toStripSchema(sceneShapeSchema);
  }
  return stripSchemaCache;
}

/**
 * Remove every key the schema does not know, at every depth.
 *
 * Values that are simply *wrong* (an opacity of 5, a negative duration) are
 * left alone: they must still fail validation, because a silently corrected
 * value is a lie about what the author asked for.
 */
function dropUnknownKeys(input: unknown): unknown {
  const result = getStripSchema().safeParse(input);
  if (result.success) return result.data;
  // Genuine value errors survive — the strict schema will report them.
  return input;
}

/* ------------------------------------------------------------------------- */
/* Public API                                                                */
/* ------------------------------------------------------------------------- */

/**
 * Normalize an untrusted scene payload before it is validated.
 *
 * Guarantees:
 * - no transient (`_`-prefixed) property survives,
 * - legacy `_hidden` / `_locked` markers become real `visible` / `locked`
 *   fields instead of being dropped,
 * - spatial / NLE numbers are clamped into their legal range rather than
 *   failing the save,
 * - the input is never mutated (a deep clone is returned).
 */
export function sanitizeSceneInput(input: unknown, options?: SanitizeOptions): unknown {
  return sanitizeSceneInputWithReport(input, options).scene;
}

/** Same as {@link sanitizeSceneInput}, but also returns what was changed. */
export function sanitizeSceneInputWithReport(
  input: unknown,
  options?: SanitizeOptions
): SanitizeReport {
  const report: SanitizeReport = { scene: input, healed: [], clamped: [], resolved: [] };
  if (!isPlainObject(input)) {
    report.scene = input;
    return report;
  }

  const clone = deepClone(input);
  stripTransient(clone, "", report);

  if (Array.isArray(clone.layers)) {
    clone.layers.forEach((layer, i) => {
      if (isPlainObject(layer)) {
        normalizeLayerFields(layer, `layers.${i}`, report);
      }
    });
  }

  if (options?.dropUnknown) {
    report.scene = dropUnknownKeys(clone);
  } else {
    report.scene = clone;
  }

  return report;
}
