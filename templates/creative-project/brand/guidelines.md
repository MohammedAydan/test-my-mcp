# Brand guidelines — {{PROJECT_NAME}}

## Do

- Use the approved logo variant for the background it was drawn for
  (`logo-primary-*.svg` on dark, `logo-primary-dark-*.svg` on light).
- Keep clear space around the logo equal to its cap height.
- Typeset Arabic in **Cairo** or **Tajawal**, Latin in **Inter**.
- Keep must-include lines verbatim — never retype, transliterate or re-case them.
- Keep 8% safe margins: no type closer than ~8% of the canvas edge.
- Reuse the presets (`springPop`, `smoothSlideUp`, `maskRevealWipe`, …) instead
  of inventing timing curves; they are already on-brand.
- Pair every visual beat with a bank SFX cue (`whoosh`, `pop`, `click`,
  `subImpact`, `shimmer`, `riser`).

## Don't

- Don't stretch, rotate or re-colour the logo (the engine fits it with
  `object-fit: contain`; anything else is a defect).
- Don't use more than two type sizes above 40 px.
- Don't animate Arabic per character — it breaks cursive shaping.
- Don't use more than 4 mesh blobs in one background.
- Don't let two elements overlap for more than ~200 ms — that reads as a bug,
  not as depth.
- Don't ship a background that competes with the must-include lines.

## Motion

| Token | Value |
| --- | --- |
| Entrance | 800–1000 ms, `blurFadeIn` or `smoothSlideUp` |
| Emphasis | 1600–2400 ms loop, `floatIdle` or `pulseGlow` |
| Exit | 500–600 ms, `scaleDownFade` |
| Camera | slow push-in only; scale ≤ 1.25 over the whole scene |
| Transitions | one per beat, 600–700 ms, never overlapping a text entrance |

## Audio

- Engine SFX bank only, unless a licensed track is supplied in
  `assets/audio/music/`.
- Music ducking target: −18 LUFS under voiceover; voiceover peak −3 dBTP.
