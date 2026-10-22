---
name: add-layer-primitive
description: Standardized 7-step playbook for implementing a new layer primitive across scene-spec, scene-runtime, studio, and tests
---

# Playbook: Adding a Layer Primitive

This playbook provides the complete 7-step procedure for adding a new layer primitive to MotionForge (e.g., `deviceMockup`, `cursorFlow`, `bentoGrid`, `connectorDiagram`, `metricTicker`, `comparisonSplit`).

## Overview of Steps
1. **Schema Definition & Registration:** `packages/scene-spec/src/layers/<kind>.ts` & `scene.ts`.
2. **Sanitizer Normalization & Healing:** `packages/scene-spec/src/sanitize.ts`.
3. **Field Guide & LLM Authoring Example:** `packages/scene-spec/src/field-guide.ts`.
4. **Deterministic Runtime Renderer:** `packages/scene-runtime/src/layers/<kind>.ts` & `scene.ts`.
5. **Intrinsic Bounds & Telemetry:** `makeFrameDescriber()` in `packages/scene-runtime/src/scene-builder.ts` & `index.ts`.
6. **Studio Type Compatibility:** `packages/studio/src/`.
7. **Automated Unit & Contract Tests:** `packages/scene-spec/tests/` & `packages/scene-runtime/tests/`.

---

## Step 1: Schema Definition & Union Registration

1. Create `packages/scene-spec/src/layers/<kind>.ts`.
2. Extend `layerBaseSchema` and enforce strict schema validation:
   ```typescript
   import { z } from "zod";
   import { layerBaseSchema } from "./base.js";
   import { colorSchema, msSchema } from "../common.js";

   export const myLayerSchema = layerBaseSchema.extend({
     type: z.literal("myLayer"),
     accentColor: colorSchema.default("#00F2FE"),
     content: z.string().min(1),
   }).strict();

   export type MyLayer = z.infer<typeof myLayerSchema>;
   ```
3. Export from `packages/scene-spec/src/index.ts`.
4. Register in `packages/scene-spec/src/scene.ts`:
   - Append layer name to `LAYER_TYPES` constant array.
   - Add `myLayerSchema` into the `layerSchema` discriminated union (`z.discriminatedUnion("type", [...])`).
   - If the layer references vault assets, update asset reference validation in `sceneSpecSchema.superRefine`.

---

## Step 2: Sanitizer Healing

Edit `packages/scene-spec/src/sanitize.ts`:
1. In `normalizeNewLayerKinds()` / `normalizeLayerFields()`, add a handler for the new layer type (there is no `sanitizeLayerInput()`).
2. Ensure universal base properties are normalized (`trackIndex`, `visible`, `locked`, `blendMode`, `position`, `scale`, `rotation`, `opacity`).
3. Strip any transient properties prefixed with `_`.
4. Validate that numeric ranges (percentages, dimensions, timestamps) are clamped to legal bounds.

---

## Step 3: Field Guide & Authoring Guidance

Edit `packages/scene-spec/src/field-guide.ts`:
1. Add an entry to `layerFieldGuide` describing:
   - Summary and visual intent.
   - Required fields and defaults.
   - Recommended motion presets.
2. Add a fully schema-valid, asset-free example object to `layerFieldGuide[kind].example`.
3. Verify that `tests/field-guide.spec.ts` executes and passes against the updated schema.

---

## Step 4: Deterministic Runtime Renderer

1. Create `packages/scene-runtime/src/layers/<kind>.ts`.
2. Adhere to runtime rendering invariants:
   - Pure function of time `f(timeMs)`.
   - Never invoke `Date.now()`, `performance.now()`, or `Math.random()`.
   - Apply the Single Transform Owner rule: write `transform`, `opacity`, and `filter` only via `transform.ts`. Set anchor position (`left`, `top`) once during layer initialization.
   - Animate masks via `clip-path`, never animating layout width or height on text or card elements.
   - Ensure temporary effects use an In/Out envelope (`envelope.ts`) starting and ending at identity.
3. Register the renderer in `packages/scene-runtime/src/layers/index.ts` (`renderLayer` switch).

---

## Step 5: Accurate Intrinsic Bounds in Telemetry

Edit `makeFrameDescriber()` in `packages/scene-runtime/src/scene-builder.ts`:
1. Implement bounds calculation for the new layer type in `makeFrameDescriber()` (published as `window.describeFrame` and `layerBoundsReport` in `packages/scene-runtime/src/index.ts`).
2. Compute accurate intrinsic dimensions:
   ```typescript
   case "myLayer": {
     const widthPx = layer.widthPx ?? 400;
     const heightPx = layer.heightPx ?? 240;
     return {
       xPct: layer.position?.xPct ?? 50,
       yPct: layer.position?.yPct ?? 50,
       widthPx,
       heightPx,
     };
   }
   ```
3. Verify that `window.seekToFrameForLayout()` returns valid bounds without triggering full rasterisation or media decode.

---

## Step 6: Minimal Studio Type Compatibility

Update Studio layer references to maintain typecheck cleanliness across all workspaces:
1. In `packages/studio/src/state/store.ts`, ensure any layer type discrimination handles the new type.
2. In `packages/studio/src/components/inspector/` or timeline renderers, provide a clean fallback rendering branch so TypeScript compiler (`tsc --noEmit`) passes cleanly.

---

## Step 7: Unit & Contract Tests

1. Create schema unit test in `packages/scene-spec/tests/<kind>.spec.ts`:
   - Test minimal valid configuration.
   - Test schema rejection on unknown keys (`.strict()`).
   - Test default value population.
2. Create runtime rendering test in `packages/scene-runtime/tests/<kind>.spec.ts`:
   - Assert deterministic DOM structure creation.
   - Assert frame seek accuracy at t=0ms, t=entrance, and t=exit.
3. Run verification suite:
   ```bash
   npm run typecheck -ws
   npm test
   node scripts/verify-no-emoji.cjs
   ```
