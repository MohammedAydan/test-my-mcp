# Engine-ready images

PNG / JPG / WebP / SVG that SceneSpec layers may reference.

- `bg-*-4k.png` backgrounds (1920×1080 min, 3840×2160 for 4K masters)
- `logo-*.svg` vector marks
- `icon-*.png` badges (≤ 1024 px)
- PNG with alpha for anything that must composite; WebP/JPG for photographic plates
- Naming rules: see `../../README.md`

Upload to the engine vault and reference with `"src": "vault:<file>"`; the id
must be declared in the scene's `assets[]` before a layer uses it.
