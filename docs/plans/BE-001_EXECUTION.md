# Execution Plan: BE-001 — TrackLane & trackIndex Schema Support

**Document Version:** 1.0.0  
**Date:** 2026-10-19  
**Status:** Ready for Review & User Approval  
**Target Item:** Backlog Rank 1 / `BE-001` (P0)  
**Target Package:** `packages/scene-spec` (`@motionforge/scene-spec`)

---

## 1. Backward Compatibility & Defaults

### The Question:
Every existing scene in the repository (test fixtures, demo scenes, user `.mfproj` saves, creative-project manifests) contains **no `trackIndex` or `trackLane` field**. What is the default behavior?

### The Decision:
- `trackIndex` is **strictly optional** (`undefined` by default).
- When `trackIndex` is `undefined`, the timeline treats each layer as occupying its own independent track row (effectively defaulting visually to `row = layerIndex`).
- **Justification:** If `trackIndex` defaulted to `0`, every layer in every existing scene would instantly collapse into Track Row 0. Because existing layers frequently overlap in time (e.g., background at 0–8000ms, title at 400–4400ms, subtitle at 1200–4400ms), collapsing them to Track Row 0 would cause massive visual collisions on the timeline canvas. By leaving `trackIndex: undefined`, all existing scenes preserve 100% visual and functional parity.

---

## 2. Additive Schema Specification

All changes are strictly additive. No existing fields are renamed, and no validation rules are loosened.

### 2.1 Layer-Level Track Assignment (`packages/scene-spec/src/layers/base.ts`)
Add `trackIndex` (and `trackLane` alias for authoring convenience) to `layerBaseSchema`:

```typescript
export const layerBaseSchema = z.strictObject({
  id: idSchema,
  name: z.string().max(120).optional(),
  z: z.number().int().min(0).max(999).optional(),
  at: msSchema.default(0),
  duration: msSchema.optional(),
  /**
   * 0-indexed timeline track lane assignment.
   * Non-overlapping clips assigned the same trackIndex render on the same timeline track row.
   * If omitted, the layer renders on its own sequential visual track row.
   */
  trackIndex: z.number().int().min(0).max(99).optional(),
  /** Authoring alias for trackIndex */
  trackLane: z.number().int().min(0).max(99).optional(),
  rotation: z.number().min(-360).max(360).optional(),
  tracks: z.array(keyframeTrackSchema).optional(),
  direction: z.enum(["ltr", "rtl"]).default("ltr"),
  entrance: presetRefSchema.optional(),
  emphasis: presetRefSchema.optional(),
  exit: presetRefSchema.optional(),
  sfx: z.array(sfxTriggerSchema).max(12).optional(),
});
```

### 2.2 Scene-Level Track Lane Definitions (`packages/scene-spec/src/scene.ts`)
Add optional top-level `trackLanes` array to `sceneShapeSchema`:

```typescript
export const trackLaneSchema = z.strictObject({
  id: idSchema,
  name: z.string().max(80).optional(),
  kind: z.enum(["video", "audio"]).default("video"),
  locked: z.boolean().default(false),
  muted: z.boolean().default(false),
  collapsed: z.boolean().default(false),
});
export type TrackLane = z.infer<typeof trackLaneSchema>;
```

In `sceneShapeSchema`:
```typescript
trackLanes: z.array(trackLaneSchema).max(32).optional(),
```

### 2.3 Cross-Field Validation (`sceneSpecSchema.superRefine`)
Enforce NLE non-overlapping integrity:
If two layers explicitly share the same `trackIndex` (or `trackLane`), assert that their time intervals do not overlap:
- Layer A: `[at, at + (duration ?? (scene.durationMs - at))]`
- Layer B: `[at, at + (duration ?? (scene.durationMs - at))]`
- If interval A overlaps interval B on the same `trackIndex`, emit a structured Zod error:
  `layers.<index>.trackIndex: clips sharing trackIndex <X> cannot overlap in time (<startA>-<endA>ms overlaps <startB>-<endB>ms)`

---

## 3. Render Pipeline Impact

- **Playwright Headless Renderer (`packages/core-engine/src/renderer.ts`):** **ZERO IMPACT**. The frame capturer queries DOM elements rendered by GSAP inside the preview stage. DOM stacking context is governed by DOM insertion order and optional `z` index, not `trackIndex`.
- **FFmpeg Encoder (`packages/core-engine/src/encoder.ts`):** **ZERO IMPACT**. Video compilation takes in-memory captured PNG/JPEG image pipes.
- **GSAP Scene Runtime (`packages/scene-runtime`):** **ZERO IMPACT**. The runtime builds animation timelines from `at` and `duration`.
- **Field Guide / LLM Capabilities (`field-guide.ts`):** Updated to document `trackIndex` as an optional parameter.

---

## 4. Test Additions

Create dedicated test suite `packages/scene-spec/tests/track-lanes.spec.ts` with assertions for:

1. **Old scene backward compatibility:** Existing scenes without `trackIndex` or `trackLanes` pass validation with 0 issues.
2. **Valid same-track packing:** Two sequential layers (0–3000ms and 3500–6000ms) with `trackIndex: 1` pass validation.
3. **Collision rejection:** Two overlapping layers (0–4000ms and 2000–5000ms) with `trackIndex: 1` are rejected with a descriptive Zod error.
4. **Invalid value rejection:**
   - Negative integer (`trackIndex: -1`): rejected by `.min(0)`.
   - Float (`trackIndex: 2.5`): rejected by `.int()`.
   - Out of bounds (`trackIndex: 150`): rejected by `.max(99)`.
   - Non-number (`trackIndex: "track-1"`): rejected by `.number()`.
5. **Top-level `trackLanes` definitions:** Validates track properties (`id`, `name`, `kind`, `locked`, `muted`).

---

## 5. Rollback Plan

All modifications are strictly localized to `packages/scene-spec/src/` and its unit tests.
If any regression occurs:
```bash
git revert --no-edit <commit-hash>
npm run build -w @motionforge/scene-spec
npm test
```
The repository returns cleanly to the pre-change state in under 30 seconds.
