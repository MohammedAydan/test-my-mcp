# Licensed fonts

Drop `.woff2` / `.otf` files here **only** when the licence requires local
hosting (e.g. a desktop-only corporate licence). Google Fonts are not copied —
declare them in the scene instead:

```json
"fonts": [
  { "role": "hero", "family": "Cairo", "provider": "google", "weights": [700, 900] }
]
```

- Roles: `hero`, `headline`, `body`, `accent`, `metric`.
- Arabic: Cairo or Tajawal. Latin: Inter.
- Never commit a font whose licence forbids it; check before adding.
