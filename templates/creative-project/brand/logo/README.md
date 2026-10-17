# Logo masters

| File | Purpose |
| --- | --- |
| `logo-primary-{white\|black\|dark}.svg` | vector master, per background |
| `logo-primary-{variant}-4k.png` | rasterised fallback (PNG with alpha) |

- ≤ 2048 px on the long edge; SVG preferred for anything that scales.
- Upload the file to the engine vault, then reference it in a scene as
  `"src": "vault:logo-primary-white.svg"` inside `assets[]`.
- Never recolour, stretch or add effects in the scene — apply `ring`, `glow`,
  `shadow` or `lightSweep` instead.
- Set `mask` to `squircle`/`circle` only if the mark was drawn for it.
