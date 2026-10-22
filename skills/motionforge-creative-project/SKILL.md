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
it through its MCP tools and never by editing engine code.

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
   `create_or_update_scene` (pass `projectPath` — the project root). Disk JSON and
   engine state must stay 100% in sync; with `projectPath` the files are written
   automatically (`scenes/scene-XX.json`, `motionforge.project.json` updated, renders
   filed, stills saved).
   (Or use `npm run sync-scene -- --project . --file scenes/scene-01.json`, which
   validates locally with the same schema before POSTing.)
4. **Call `inspect_scene_keyframes`** across at least four timestamps — entrance,
   mid-action, transition, outro. Verify: no clipped text, correct Arabic shaping,
   no overlap, adequate contrast, nothing off-canvas. Pass `projectPath` and
   `saveStills: true` to auto-file the PNGs.
   **Read the `framesMeta` sidecar** that comes back with the images: it reports the
   camera pose, the live transition phase and each layer's lifecycle phase, opacity,
   bounding box and `textOverflow` flag. A frame that looks empty is often just a
   layer mid-entrance — the metadata says so, so you do not have to guess.
5. **Open `open_live_timeline_preview`** for the operator, then **render draft**:
   `render_video(quality: "draft")`. Pass `projectPath` to auto-file the MP4 into
   `renders/draft/`.
6. **On approval, render `production`**, file it under `renders/production/`, and
   copy the deliverable to `exports/client-delivery/`. Update the scene `status`
   in `motionforge.project.json`.
7. **Update the manifest**: add each new scene to `scenes[]` with its file path
   and status, so the job stays self-describing.

## Assets resolve themselves

Drop a file into the project and reference it — no upload step:

| File goes to | Reference as |
| --- | --- |
| `assets/images/logo.png` | `"src": "vault:logo.png"` |
| `assets/lottie/anim.json` | `"src": "vault:anim.json"` |
| `assets/video/clip.mp4` | `"src": "vault:clip.mp4"` |
| `assets/audio/music/bed.mp3` | `"src": "vault:bed.mp3"` |
| `brand/logo/wordmark.png` | `"src": "vault:wordmark.png"` |

When a scene is stored with a `projectPath`, every `vault:` reference is looked up in
those folders and copied into the engine vault on first use. A file that cannot be
found is reported with the exact directories that were searched.

## Tool map (exactly six — there is no seventh)

| Order | Tool | Purpose |
| --- | --- | --- |
| 1 | `get_motion_capabilities` | the authoring contract (structure + vocabularies) |
| 2 | `init_creative_project` | scaffold a complete client-job workspace (project disk sync enabled) |
| 3 | `create_or_update_scene` | validate + store a SceneSpec; returns the scene id |
| 4 | `inspect_scene_keyframes` | images at exact ms — the quality gate |
| 5 | `open_live_timeline_preview` | interactive scrubber; auto-refreshes on re-post |
| 6 | `render_video` | `draft` while iterating, `production` once approved; `wait: false` returns a `jobId` to poll |
| 7 | `render_scene` | an alias of `render_video` |
| 8 | `get_layer_bounds` | the layout sidecar WITHOUT rasterisation — use it for layout questions |
| 9 | `get_render_status` | poll a render started with `wait: false` |
| 10 | `get_render_result` | the finished export + its ffprobe metadata |
| 11 | `analyze_scene` | the warnings, the per-frame render-cost estimate, the keyframe precedence |
| 12 | `upload_asset` | put a file into the vault from the protocol |
| 13 | `project_asset_manifest` | what the project already has on disk |

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

A scene that was *accepted* may still carry **warnings** — non-blocking problems
the runtime corrected for you, but which you should fix in the source:

- `CAMERA_VIEWPORT_EXCEEDS_CANVAS` — the camera pans or zooms past the canvas
  edge, which would show black void. At `scale: s` the safe range for `xPct`/`yPct`
  is `[50/s, 100 − 50/s]`. Bring the value inside the range.
- `CAMERA_MOVE_OVERRUNS_SCENE` — a camera move ends after the scene does and will
  be cut off.
- `PROJECT_MANIFEST_MISSING` — the scene file was written, but the project has no
  `motionforge.project.json`. Run `init_creative_project` in that directory.

## Definition of done

- Scene validates and is committed in `scenes/` + listed in the manifest
- Keyframes inspected at entrance / mid / transition / outro
- Draft MP4 in `renders/draft/`
- Approved production MP4 in `renders/production/`
- Deliverable in `exports/client-delivery/`
