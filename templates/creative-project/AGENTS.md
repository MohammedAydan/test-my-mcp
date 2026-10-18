# AGENTS.md — {{PROJECT_NAME}}

**You are working inside a MotionForge creative project, not inside the engine.**
This folder holds one client job: its brief, its brand assets, its SceneSpec
files and its renders. The engine source lives elsewhere
(`/home/ubuntu/projects/test-my-mcp` by default) — you do not edit it from here.

Engine URL for this job: `{{ENGINE_URL}}` · Primary language: `{{LANG}}` ·
Created: `{{CREATED_AT}}`.

---

## 1. What this folder is

| Path | What it is |
| --- | --- |
| `brief/BRIEF.md` | the creative brief — goal, audience, duration, must-include lines |
| `brief/references/` | moodboards and competitor stills |
| `design/` | **masters for humans**: `.psd`, `.ai`, `.aep`, storyboards. Never fed to the engine |
| `brand/` | logo, licensed fonts, colour tokens, guidelines |
| `assets/` | **engine-ready files only**: PNG/JPG/WebP/SVG, `.json` Lottie, audio |
| `scenes/` | the SceneSpec JSON files — the source of truth for every video |
| `renders/draft/` | iteration renders (720p) |
| `renders/production/` | approved finals (full canvas @ 60fps) |
| `renders/stills/` | keyframe exports and client stills |
| `exports/client-delivery/` | what gets delivered to the client |
| `logs/agent-sessions/` | optional notes from agent runs |

## 2. Hard rules

1. **Call `get_motion_capabilities` first — every session.** Start from
   `minimalValidScene` and copy shapes out of `layerFieldGuide`. Never guess a
   field name, a nested object or a preset.
2. **Never invent shapes.** `background.variant` and `card.variant` are objects
   discriminated by their own `variant` key; motion is
   `entrance/emphasis/exit: { name: "<preset>" }`; positions are `{ xPct, yPct }`;
   sizes use `*Px` keys; every time is milliseconds. There is no `preset` field.
3. **On a rejection, fix the exact paths the engine returned.** The response
   lists every issue, e.g. `layers.2.variant: Expected object, received string`.
   Fix those paths and re-post. Do not resend the same scene hoping for a
   different answer.
4. **Always inspect keyframes before a `production` render.**
   `inspect_scene_keyframes` at the entrance, one mid-action beat, the
   transition and the outro. Check layout, contrast, Arabic shaping and that
   nothing overlaps or clips.
5. **Always draft → inspect → approve → production.** Never jump straight to
   `production`; it burns minutes of render time and hides layout bugs that a
   720p draft shows immediately.
6. **Disk is the source of truth.** After every successful
   `create_or_update_scene`, write the exact validated JSON back to the matching
   `scenes/scene-XX.json`, and update its `status` in `motionforge.project.json`.
7. **Assets live in `assets/` and must be export-ready.** Upload them to the
   engine vault and reference them with `"src": "vault:<file>"` (or an `https://`
   URL), always declared in the scene's `assets[]` before a layer uses the id.
8. **Do not edit the engine monorepo** from a creative-project session unless
   you were explicitly asked to. Report engine problems instead.

## 3. Tool map — the six tools

```
get_motion_capabilities  →  init_creative_project  →  create_or_update_scene
                          →  inspect_scene_keyframes  →  open_live_timeline_preview
                          →  render_video
```

| Step | Tool | Notes |
| --- | --- | --- |
| 1 | `get_motion_capabilities` | returns `layerFieldGuide`, `nestedShapeNotes`, `minimalValidScene`, `fullShowcaseSketch` |
| 2 | `init_creative_project` | scaffold a complete client-job workspace (this folder is the result) |
| 3 | `create_or_update_scene` | validate + store; returns the engine's scene id |
| 4 | `inspect_scene_keyframes` | images at exact ms — the quality gate |
| 5 | `open_live_timeline_preview` | scrub in a browser; auto-refreshes when you re-post |
| 6 | `render_video` | `quality: "draft"` while iterating, `"production"` once approved |

**Disk synchronization.** `scenes/scene-XX.json` is the version-controlled copy.
When `projectPath` is provided to `create_or_update_scene`, `inspect_scene_keyframes`,
or `render_video`, the corresponding files are written to disk automatically:
`scenes/<id>.json`, `renders/stills/*.png`, `renders/draft|production/*.mp4`,
and `motionforge.project.json` all stay in sync without manual CLI commands.

**Assets resolve themselves.** A scene stored with `projectPath` gets its `vault:`
references resolved out of `assets/images/`, `assets/lottie/`, `assets/video/`,
`assets/audio/**/` and `brand/logo/` automatically — the files are copied into the
engine vault on first use. Just drop the file in the right folder and reference
`"src": "vault:<filename>"`.

**Read the diagnostics, do not guess.**
- `create_or_update_scene` returns `warnings[]` — non-blocking problems such as
  `CAMERA_VIEWPORT_EXCEEDS_CANVAS` (a camera that would show black void). The runtime
  clamps it automatically; fix the authored value to remove the warning.
- `inspect_scene_keyframes` returns `framesMeta[]` next to the images: the camera pose,
  the live transition phase, and each layer's lifecycle phase (`entrance` / `settled` /
  `emphasis` / `exit`), opacity, bounding box and `textOverflow` flag. A frame that
  looks empty is often just a layer mid-entrance — the metadata says so.

For manual CLI workflow:
```bash
# after the MCP tool call succeeds
npm run sync-scene -- --project . --file scenes/scene-01.json   # validate + push
# after an approved production render
npm run pull-render -- --project . --jobId <id> --quality production
```

`sync-scene` validates the file locally first, so a typo never reaches the
engine. `pull-render` files the MP4 under `renders/<quality>/` and bumps the
manifest status.

## 4. Arabic / RTL and visual quality

- Set `direction: "rtl"` on every Arabic `kineticText` layer. Keep numerals LTR
  inside the Arabic run (the runtime isolates each word).
- Fonts: **Cairo** or **Tajawal** for Arabic, **Inter** for English. Declare them
  in `scene.fonts[]` per role, or set `googleFamily` on the layer.
- **Never split Arabic per character.** Use `"animateBy": "word"` (or `"line"`).
  The renderer refuses per-character splitting for Arabic and RTL text because it
  destroys cursive shaping and ligatures.
- Give Arabic headroom: the mask-reveal presets are clipping-guarded, but keep
  `lineHeight` ≥ 1.15 and never pack lines tighter than the brief allows.
- Quality bar: high contrast, generous safe margins (≥ 8% from every edge), no
  overlapping elements, 8–30 s total duration, one clear idea every 2–4 s,
  staggered entrances, and SFX synced from the engine bank.

## 5. Definition of done

- [ ] Scene validates and is saved in `scenes/` (and listed in the manifest)
- [ ] Keyframes inspected at entrance / mid / transition / outro — zero clipping,
      correct RTL shaping, no overlap
- [ ] Draft MP4 in `renders/draft/`
- [ ] Approved production MP4 in `renders/production/`
- [ ] Final deliverable copied to `exports/client-delivery/`
- [ ] `motionforge.project.json` statuses updated

## 6. Forbidden

- Hallucinating presets, layer types, fields or nested shapes
- Writing raw frames to disk to "fake" a render
- Adding tools, MCP servers or engine features from this workspace
- Committing secrets, client credentials or unlicensed fonts
- Treating `.psd` / `.aep` / `.ai` / Figma files as runtime inputs — they are
  design masters; only exported PNG/SVG/WebP/Lottie in `assets/` reach the engine
- Rendering `production` without a keyframe inspection first
