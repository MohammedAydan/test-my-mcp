# SceneSpec v1 — Reference

The declarative scene contract. All packages (and the LLM) speak this language.
Schema source of truth: `packages/scene-spec/src/**` (Zod, strict — unknown keys are
validation errors). All times are **milliseconds**, all positions are **percent of
canvas**, all font sizes/lengths are **design px** (authored against the canvas scale).

## Top level

```jsonc
{
  "schemaVersion": 1,
  "name": "Brand Intro",
  "canvas": { "shape": "16:9", "scale": 1080 },   // → 1920×1080
  "durationMs": 12000,
  "assets": [ /* see Assets */ ],
  "fonts":  [ /* see Fonts */ ],
  "layers": [ /* see Layers */ ],
  "camera": { /* see Camera */ },
  "transitions": [ /* see Transitions */ ],
  "audio": { "music": {…}, "cues": [ {…} ] }
}
```

### Canvas
`shape` × `scale` → pixel size (validated pairs):

| shape | 720 | 1080 | 1440 | 2160 |
|---|---|---|---|---|
| `16:9` | 1280×720 | **1920×1080** | 2560×1440 | 3840×2160 |
| `9:16` | 720×1280 | 1080×1920 | 1440×2560 | 2160×3840 |
| `1:1` | — | 1080×1080 | — | 2160×2160 |
| `4:5` | — | 1080×1350 | — | 2160×2700 |

## Layers (common)

Every layer has:

| field | type | default | notes |
|---|---|---|---|
| `id` | string | required | unique within scene |
| `type` | enum | required | `background` \| `imageLogo` \| `kineticText` \| `card` \| `lottie` \| `foregroundFX` |
| `at` | number | `0` | layer start (ms) |
| `duration` | number | scene end | layer active window (ms) |
| `z` | int | auto | draw order |
| `entrance` / `emphasis` / `exit` | PresetRef | — | see Motion presets |
| `sfx` | SfxTrigger[] | — | cues relative to `at` |

### Motion presets (PresetRef)
`{ name, durationMs?, delayMs?, ease?, staggerMs?, strength? }` — `strength` is a
0.2–2 multiplier on the preset's base intensity. `staggerMs` applies to text layers
(word/char) and multi-element layers.

| category | names |
|---|---|
| **entrance** | `springPop` · `smoothSlideUp` · `maskRevealWipe` · `elasticScale` · `blurFadeIn` · `3dFlipIn` |
| **emphasis** | `pulseGlow` · `floatIdle` · `lightSweep` · `cameraShakeImpact` |
| **exit** | `scaleDownFade` · `whipOutLeft` · `collapseMask` |

Default easing is set per preset (`expo.out`, `back.out(1.7)`, `power4.inOut`, …).
Override `ease` only with a registry name (e.g. `"power3.inOut"`, `"elastic.out(1, 0.75)"`).

### Easing registry
`linear` · `power1–4.in/.out/.inOut` · `expo.in/.out/.inOut` · `circ.in/.out/.inOut` ·
`sine.in/.out/.inOut` · `back.out(1.7|2.5|4)` · `back.in(1.7)` · `back.inOut(1.7)` ·
`elastic.out(1,0.75)` · `elastic.out(1,0.5)` · `elastic.in(1,0.75)` · `bounce.in/.out` ·
`steps(12)` — or `{ "bezier": [x1, y1, x2, y2] }`.

## Layer: `background`
`variant` picks one of:

- **`solid`** — `{ color }`
- **`meshGradient`** — `{ base, blobs[2..6]: { color, xPct, yPct, radiusPct, drift? } }`
  (animated mesh gradient; `drift` 0–2 controls blob wander speed)
- **`particles`** — `{ count 40–600, color?, sizePx?, speed?, direction: up|down|radial|sideways }`
- **`media`** — `{ assetId, blurPx?, dimOpacity?, kenBurns?: { fromScale, toScale, panFrom?: {xPct,yPct}, panTo?: {xPct,yPct} } }`
  (image/video backdrop, optional Ken Burns push)

## Layer: `imageLogo`
`{ assetId, widthPx, heightPx?, position: { xPct, yPct }, mask: rect|circle|squircle|hexagon|blob, cornerRadiusPx?, shadow?, ring?: {widthPx, color, opacity}, glass?: {blurPx, tintColor, tintOpacity}, glow?: {color, strength}, lightSweep?: {at, durationMs, angleDeg?, color?, widthFactor?} }`

`lightSweep` animates a diagonal specular band across the logo at time `at` (ms,
absolute). `mask` applies an SVG clip-path; `glass` wraps the logo in a frosted chip.

## Layer: `kineticText`
`{ text, direction: ltr|rtl (default ltr), role: hero|headline|body|accent|metric, googleFamily?, fontWeight, sizePx, lineHeight?, letterSpacingPx?, align?, position?: {xPct,yPct} (default center), box?: { maxWidthPct, paddingPx, chip?: {color, opacity, radiusPx} }, fill (paint, default #fff), stroke?: {color, widthPx}, shadow?, animateBy: word|char|line (default word), highlight?: {color, radiusPx, paddingPx} }`

- `role` maps to `fonts[]` declarations (font loading is automatic, Google Fonts
  included). Arabic text: set `direction: "rtl"`; numerals inside stay LTR.
- `fill` is a **paint**: a CSS color string or `{ type: "linear", angleDeg, stops: [{color, at 0–100, opacity?}] }`.
- `highlight` renders a marker-style box behind the text that wipes in with the stagger.

## Layer: `card`
All card variants take `position: {xPct, yPct}` (center anchor). `variant` picks one of:

- **`glassCard`** — `{ title?, body?, iconAssetId?, widthPx?, paddingPx?, glass: {blurPx, tintColor, tintOpacity}, radiusPx?, borderOpacity? }`
- **`callout`** — glass card + `{ accentSide: left|right, accentColor }` edge bar
- **`progressBar`** — `{ label?, value 0–100, trackColor?, fill (paint), heightPx?, radiusPx?, showPercentage? }` (animated to `value`)
- **`counter`** — `{ from, to, decimals?, prefix?, suffix?, locale?, role?, sizePx? }` (number tween)

## Layer: `lottie`
`{ assetId, widthPx?, position: { xPct, yPct } }` — Lottie JSON animation, scrubbed by
timeline progress (deterministic; no internal clock).

## Layer: `foregroundFX`
`{ effects: [ … ] }` — full-frame overlays applied above all content:

- **`vignette`** — `{ strength 0–1, color? }`
- **`filmGrain`** — `{ opacity 0–1, sizePx? }`
- **`colorGrade`** — `{ warmth -1…1, contrast -1…1, saturation -1…1, tint?: {color, opacity} }`

## Camera (2.5D rig)
```jsonc
"camera": {
  "perspective": 1200,                    // px
  "drift": { "amplitudePct": 0.4, "periodMs": 6000, "seed": 7 },  // handheld
  "keyframes": [                          // canonical, tweened in order
    { "at": 0,     "scale": 1,   "xPct": 50, "yPct": 50, "roll": 0, "pitch": 0, "yaw": 0 },
    { "at": 4000,  "scale": 1.6, "xPct": 38, "yPct": 45, "ease": "power3.inOut" }
  ],
  "moves": [                              // sugar, expanded to keyframes by the runtime
    { "move": "slowPushIn", "at": 0, "durationMs": 8000, "strength": 1.2 },
    { "move": "focusTarget", "at": 5000, "durationMs": 1500, "targetLayerId": "logo" },
    { "move": "whipPanLeft", "at": 9000, "durationMs": 600 },
    { "move": "shakeImpact", "at": 9600, "strength": 0.8 }
  ]
}
```
Keyframe fields are optional and inherit from the previous keyframe (`scale` default 1,
`xPct/yPct` default 50 = center, rotations default 0). `pitch`/`yaw` engage the 3D
perspective rig. `moves` compose on top of keyframes.

## Transitions (scene-level)
| kind | fields |
|---|---|
| `wipe` | `{ at, durationMs?, direction: left|right|up|down, featherPx?, color? }` |
| `glitch` | `{ at, durationMs?, intensity 0–1 }` |
| `whipPan` | `{ at, durationMs?, direction: left|right }` (motion-blur slam) |
| `morph` | `{ at, durationMs? }` (blur-dissolve between scene beats) |

## Assets & Fonts
```jsonc
"assets": [ { "id": "logo", "kind": "image", "src": "vault:logo.png" } ],  // https: | data: | vault:
"fonts":  [ { "role": "hero", "family": "Cairo", "provider": "google", "weights": [400, 900] } ]
```
`kind`: `image | video | audio | lottie`. Font `role`s mirror text roles.

## Audio
```jsonc
"audio": {
  "music": { "assetId": "track", "gain": 0.6, "fadeInMs": 500, "fadeOutMs": 1200, "normalize": true },
  "cues":  [ { "at": 250, "sfx": "whoosh", "gain": 1, "pan": 0 } ]
}
```
SFX bank (fixed): `whoosh · pop · click · subImpact · shimmer · riser`.
Layers may also declare shorthand cues: `"sfx": [{ "sfx": "pop", "offsetMs": 120 }]`
(relative to the layer's `at`); both are merged into the absolute cue list at render.

## Validation rules (enforced by Zod, strict)
- unique layer ids, unique asset ids, unique font roles
- canvas shape/scale pairs from the table above
- cues within scene duration; keyframes sorted by `at`
- `sfx`/preset/easing names from the registries only
