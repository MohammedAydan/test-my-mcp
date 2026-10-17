# Plate footage

Background video plates (H.264 MP4 or WebM, muted in the render).

- ≤ 1080p for draft work, 4K only when the final demands it.
- ProRes or DNxHD masters stay in `design/`; this folder holds web-ready files.
- The runtime scrubs video deterministically: a layer with a video backdrop gets
  `at`/`duration` like any other layer, and `kenBurns` adds the slow push.
