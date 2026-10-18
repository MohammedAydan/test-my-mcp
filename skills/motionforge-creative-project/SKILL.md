---
name: motionforge-creative-project
description: >-
  Produce a MotionForge client video end to end. Use when the working folder is a
  MotionForge creative project (contains `motionforge.project.json`, `brief/`,
  `scenes/`, `renders/`) or when asked to create, update, inspect or render a
  MotionForge scene/video. Authoring is done through the six MotionForge MCP
  tools; the workspace layout and CLI helpers are described below.
---

# MotionForge — creative project delivery

A MotionForge creative project is a **client job workspace**: brief, brand
assets, SceneSpec JSON and renders. The engine is a separate program; you drive
it through its six MCP tools and never by editing engine code.

## Startup (mandatory, before any tool call)

1. Read `./AGENTS.md` — the project's operating manual and hard rules.
2. Read `./motionforge.project.json` — engine URL, canvas, language, scene list.
3. Read `./brief/BRIEF.md` — goal, audience, duration, must-include lines (AR/EN),
   delivery formats.
4. Skim `./brand/colors.md` + `./brand/guidelines.md`, and list `./assets/`.

If any of these is missing, say so and stop — do not improvise a structure.

## Workflow checklist

1. **Call `get_motion_capabilities` first, every session.** Never guess schema
   fields. Copy shapes from `layerFieldGuide`, start from `minimalValidScene`, and
   read `nestedShapeNotes` for the structural rules (`variant` is an object,
   motion is `{ name: preset }`, positions are `{ xPct, yPct }`, times are ms).
2. **If starting a brand new project**, call `init_creative_project` with the
   target folder. It scaffolds the workspace, validates everything, and optionally
   seeds the starter scene into the engine.
3. **Author `./scenes/scene-01.json` on disk**, then push it with
   `create_or_update_scene`. Disk JSON and engine state must stay 100% in sync —
   after every successful tool call with `projectPath`, the files are written
   automatically (`scenes/scene-XX.json`, `motionforge.project.json` updated,
   renders filed).
   (Or use `npm run sync-scene -- --project . --file scenes/scene-01.json`, which
   validates locally with the same schema before POSTing.)
4. **Call `inspect_scene_keyframes`** across at least four timestamps — entrance,
   mid-action, transition, outro. Verify: no clipped text, correct Arabic shaping,
   no overlap, adequate contrast, nothing off-canvas. Pass `projectPath` and
   `saveStills: true` to auto-file the PNGs.
5. **Open `open_live_timeline_preview`** for the operator, then **render draft**:
   `render_video(quality: "draft")`. Pass `projectPath` to auto-file the MP4 into
   `renders/draft/`.
6. **On approval, render `production`**, file it under `renders/production/`, and
   copy the deliverable to `exports/client-delivery/`. Update the scene `status`
   in `motionforge.project.json`.
7. **Update the manifest**: add each new scene to `scenes[]` with its file path
   and status, so the job stays self-describing.

## Tool map (exactly six — there is no seventh)

| Order | Tool | Purpose |
| --- | --- | --- |
| 1 | `get_motion_capabilities` | the authoring contract (structure + vocabularies) |
| 2 | `init_creative_project` | scaffold a complete client-job workspace (project disk sync enabled) |
| 3 | `create_or_update_scene` | validate + store a SceneSpec; returns the scene id |
| 4 | `inspect_scene_keyframes` | images at exact ms — the quality gate |
| 5 | `open_live_timeline_preview` | interactive scrubber; auto-refreshes on re-post |
| 6 | `render_video` | `draft` while iterating, `production` once approved |

`get_motion_capabilities` also serves as the offline guide
(`motionforge://scenespec/v1`) when the engine is unreachable.

## Authoring rules that prevent rework

- Every layer needs **`id` + `type`**. `background.variant` and `card.variant`
  are **objects** discriminated by their own `variant` key, never strings.
- Motion is `entrance/emphasis/exit: { "name": "<preset>" }`. There is no
  `preset` field, and unknown keys are rejected.
- **Arabic:** set `direction: "rtl"`, use Cairo/Tajawal, and split by **word** or
  **line** — never by character (the renderer will refuse, because per-character
  spans destroy cursive shaping). Keep numerals LTR inside the Arabic run.
- Keep must-include lines byte-exact from the brief; no retyping, re-casing or
  transliteration.
- One idea per 2–4 s, 8–30 s total, ≥ 8% safe margins, no two elements
  overlapping for more than ~200 ms.
- Assets: put export-ready files in `assets/`, upload to the engine vault, and
  reference `"src": "vault:<file>"` declared in the scene's `assets[]` **before**
  any layer uses that `assetId`.

## Error handling

A rejected scene comes back with **every field-level issue**
(`layers.2.variant: Expected object, received string`). Fix exactly those paths
and re-post. Never resend an unchanged scene, and never guess a fix by trial and
error across more than one iteration.

## Definition of done

- Scene validates and is committed in `scenes/` + listed in the manifest
- Keyframes inspected at entrance / mid / transition / outro
- Draft MP4 in `renders/draft/`
- Approved production MP4 in `renders/production/`
- Deliverable in `exports/client-delivery/`
