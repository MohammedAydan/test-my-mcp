# Music

Licensed music beds. The engine normalises loudness and clamps to the exact
scene length, so a slightly longer track is fine.

- MP3 or WAV, 44.1/48 kHz.
- Reference with `"audio": { "music": { "assetId": "track", "gainDb": -3 } }`
  and declare the asset first.
- Record the licence in `../../logs/` — client deliverability depends on it.
