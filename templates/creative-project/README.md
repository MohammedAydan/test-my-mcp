# {{PROJECT_NAME}} — MotionForge creative project

A client job workspace for **MotionForge**, the programmatic motion-graphics
engine. Everything the job needs lives in this folder; the engine itself runs
separately (engine URL below).

| | |
| --- | --- |
| Project | `{{PROJECT_NAME}}` |
| Created | `{{CREATED_AT}}` |
| Engine | `{{ENGINE_URL}}` |
| Language | `{{LANG}}` (primary) |
| Canvas | 16:9 @ 1080 |

## Start here

1. Read `brief/BRIEF.md` — the goal, the must-include lines, the delivery spec.
2. Read `AGENTS.md` — the operating manual for any agent (or human) in this folder.
3. Start the engine:

   ```bash
   npm run dev -w @motionforge/core-engine     # from the engine checkout
   ```

4. Point your MCP client at this folder, then call `get_motion_capabilities`.
5. Open the live preview:
   `{{ENGINE_URL}}/preview/?scene=<scene-id>` after your first
   `create_or_update_scene`.

## Daily loop

```bash
# validate + push scenes/scene-01.json to the engine (issues are printed as paths)
npm run sync-scene -- --project . --file scenes/scene-01.json

# file a finished render under renders/draft|production
npm run pull-render -- --project . --jobId <id> --quality draft
```

Both scripts must be run from the engine checkout (or via `npm --prefix`); they
resolve this folder from `--project`.

## Asset naming rules

Engine-ready files go in `assets/`. Naming is enforced by convention, not by
code — keep it consistent or scenes become unreadable:

| Kind | Pattern | Example |
| --- | --- | --- |
| logo (vector) | `logo-{variant}-{colour}.svg` | `logo-primary-white.svg` |
| logo (bitmap) | `logo-{variant}-4k.png` | `logo-primary-dark-4k.png` |
| background still | `bg-{scene}-{n}-4k.png` | `bg-hero-01-4k.png` |
| texture / overlay | `tex-{name}-{n}.webp` | `tex-grain-01.webp` |
| icon / badge | `icon-{name}.png` | `icon-play.png` |
| Lottie | `{name}.json` | `confetti.json` |
| footage | `plate-{name}.mp4` | `plate-city-night.mp4` |
| voiceover | `vo-{lang}-{take}.wav` | `vo-ar-take2.wav` |
| music | `music-{name}.mp3` | `music-upbeat-120bpm.mp3` |

Rules:

- **kebab-case**, ASCII, lowercase, no spaces.
- Exports must be **engine-ready**: logos ≤ 2048 px on the long edge, backgrounds
  sized for the canvas (1920×1080 or 3840×2160 for 4K masters), PNG with alpha
  for anything that must composite, WebP/JPG for photographic plates.
- Numbers are 2-digit and ordered (`bg-hero-01`, `bg-hero-02`) so variants sort.
- One concept per file — never a sprite sheet; each asset gets its own `imageLogo`
  layer.
- Master files (`.psd`, `.ai`, `.aep`) stay in `design/`. They are never uploaded
  and never referenced by a SceneSpec.

## Colour tokens

`brand/colors.md` holds the palette. Keep `motionforge.project.json →
brand.colors` in sync with it, and use the same hex values in every scene's
`fill` / `trackColor` / `background.variant`.

## Folder map

`brief/` · `design/` · `brand/` · `assets/` · `scenes/` · `renders/` · `exports/` · `logs/`

Empty directories carry a `.gitkeep` so the tree survives git; directories that
need explaining carry a `README.md`.
