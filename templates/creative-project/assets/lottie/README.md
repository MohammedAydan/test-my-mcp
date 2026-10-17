# Lottie animations

`.json` files exported from After Effects (Bodymovin) or from a Lottie source.

- Must be plain Bodymovin JSON (`animationData`), not a `.lottie` archive.
- No expressions, no external images (rasterise them first).
- Frames are scrubbed by timeline progress, so preview and render match exactly.
- Reference: declare `{ "id": "confetti", "kind": "lottie", "src": "vault:confetti.json" }`
  in `assets[]`, then use a `lottie` layer with that `assetId`.
