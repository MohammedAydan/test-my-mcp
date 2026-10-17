# Brand colours — {{PROJECT_NAME}}

Machine-readable copy of this palette lives in `motionforge.project.json`
(`brand.colors`). Keep both in sync; scenes must use these exact hex values.

## Tokens

| Token | Hex | Use |
| --- | --- | --- |
| `bg` | `#05070d` | canvas background, deep areas |
| `surface` | `#0b1020` | cards, glass tint, wipe covers |
| `accent` | `#38bdf8` | primary accent, progress fill, SFX-synced hits |
| `accent-2` | `#a78bfa` | secondary accent, gradient partner |
| `text` | `#ffffff` | primary type |
| `text-muted` | `#93c5fd` | secondary type, captions |

## Gradients

| Name | Definition |
| --- | --- |
| `hero` | `linear-gradient(120deg, #ffffff 0%, #a5f3fc 100%)` — headline fills |
| `progress` | `linear-gradient(90deg, #22d3ee 0%, #a78bfa 100%)` — bars and meters |
| `glow` | radial mesh background, blobs `#1d3a8a` / `#0e7490` on `#05070d` |

SceneSpec form (a `fill` is either a CSS colour string or this object):

```json
{
  "fill": {
    "type": "linear",
    "angleDeg": 120,
    "stops": [{ "color": "#ffffff", "at": 0 }, { "color": "#a5f3fc", "at": 100 }]
  }
}
```

## Contrast rules

- Body text on `bg` must clear **4.5:1**; large display type **3:1**.
- `text-muted` is for supporting copy only, never for the must-include lines.
- Never place `accent` text on `accent` fills.
- Keep a 5% vignette (`foregroundFX` vignette `strength: 0.5`) so white type
  never sits on a blown-out mesh blob.
