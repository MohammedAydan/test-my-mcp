# Backend, Schema & Build-Pipeline Audit

> Zero-trust audit of `@motionforge/scene-spec`, `@motionforge/core-engine`,
> `@motionforge/scene-runtime` and `@motionforge/desktop`, performed before the
> v3.0 rebuild. Every claim below is anchored to a file and a line range.

---

## 0. Executive summary

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| B-1 | `layers.0: Unrecognized key(s) in object: 'position'` — the layer schema is `strict()` but does not declare the spatial/NLE properties the Studio writes. | **Blocker** | Fixed (P1-1 … P1-4) |
| B-2 | `[mf-runtime] File not found: ...\packages\scene-runtime\dist\index.html` — the runtime bundle is never built before Electron boots. | **Blocker** | Fixed (P1-5) |
| B-3 | `mf-runtime://` / `mf-vault://` resolution is POSIX-shaped; on Windows the `app` host segment is dropped and drive-letter paths were never exercised. | High | Fixed (P1-6) |
| B-4 | The `BrowserWindow` is not frameless and has no window-control IPC. | High | Fixed (P1-7) |
| B-5 | `studio` and `desktop` have no `typecheck` script, so `npm run typecheck` does not cover the two packages that actually contain the UI. | Medium | Fixed (P1-8) |
| B-6 | Legacy scenes persisted before the schema change cannot be re-loaded (strict parse fails on disk). | Medium | Fixed (P1-3, heal-on-load) |

---

## 1. B-1 — `Unrecognized key(s) in object: 'position'`

### 1.1 Where it happens

```
Studio UI  ──postMessage/JSON──▶  studio/src/api.ts  ──IPC engine:invoke──▶  EngineCore.saveScene
                                                                                    │
                                                                    scene-operations.ts
                                                                                    │  validateScene(body)
                                                                                    ▼
                                                                    scene-spec/src/scene.ts
                                                                                    │  sceneSpecSchema.safeParse
                                                                                    ▼
                                                                    layers/*.ts  →  z.strictObject(...)
                                                                                    │
                                                                                    ▼
                                                              "layers.0: Unrecognized key(s) in object: 'position'"
```

### 1.2 Exact root cause

Every layer schema in the discriminated union is built by extending
`layerBaseSchema` (`packages/scene-spec/src/layers/base.ts`), which is a
**`z.strictObject`**. Strict objects reject *any* key that is not declared.

`layerBaseSchema` (as of the audit) declares:

```
id, name, z, at, duration, trackIndex, trackLane, rotation, direction,
entrance, emphasis, exit, sfx, tracks
```

The Studio, however, writes a wider set of properties. The decisive one is
`position`:

- `packages/studio/src/components/CanvasOverlay.tsx:284` —
  `store.setState('scene', 'layers', …, 'position', { xPct, yPct })`
- `packages/studio/src/components/CanvasOverlay.tsx:520` — the 60fps drag path.

`position` is declared **only** on `kineticText`, `card`, `imageLogo` and
`lottie`. It is **not** declared on:

| Layer kind | `position` declared? | Result of a Studio drag |
| --- | --- | --- |
| `background` | **no** | `layers.0: Unrecognized key(s) in object: 'position'` |
| `foregroundFX` | **no** | `layers.N: Unrecognized key(s) in object: 'position'` |
| `kineticText` | yes | ok |
| `card` | yes | ok |
| `imageLogo` | yes | ok |
| `lottie` | yes | ok |

`layers.0` is almost always the `background` layer (it must be, because the
background paints behind everything), which is exactly why the reported error
always names `layers.0`.

The same class of failure exists for `opacity` and `scale`: the Timeline's
keyframe registry (`packages/studio/src/components/Timeline.tsx:51`) advertises
`['position.xPct', 'position.yPct', 'rotation', 'opacity', 'scale']` as
animatable properties, but neither `opacity` nor `scale` is declared on any
layer schema.

The pre-existing `sanitizeSceneForEngine` in `packages/studio/src/api.ts:20`
only strips keys beginning with `_`. It does **not** strip or normalise
unknown keys, so it never prevented this class of failure.

### 1.3 The fix (Phase 1)

**(a) Whitelist the spatial/NLE fields in `layerBaseSchema`.**

Every layer kind inherits them, so no layer can ever throw an "unrecognized
key" for a standard Studio property:

| Field | Type | Range | Notes |
| --- | --- | --- | --- |
| `position` | `{ xPct, yPct }` | ±200% | `offsetSchema`; **optional** so `kineticText`'s existing `default({xPct:50,yPct:50})` and `card`'s required `offsetSchema` keep their current semantics. |
| `scale` | number | 0.05 … 10 | uniform scale multiplier |
| `rotation` | number | −3600 … 3600 | **already existed**, range widened to match the studio's `±3600` clamp; the existing `±360` bound would reject a legitimate 720° spin. |
| `opacity` | number | 0 … 1 | |
| `visible` | boolean | | `false` hides the layer without deleting it |
| `locked` | boolean | | UI lock; does not block rendering |
| `trackIndex` | int | 0 … 99 | **already existed** |
| `blendMode` | enum | `normal \| multiply \| screen \| overlay \| plus-lighter` | |

Because `kineticText`/`card`/`imageLogo`/`lottie` already declare `position`,
`.extend()` keeps their (required/defaulted) variant — the base field is only
*optional*, so no existing scene changes shape.

**(b) Publish `sanitizeSceneInput()` from `@motionforge/scene-spec`.**

A single, shared normalizer that:

1. deep-clones the input,
2. drops transient UI-only keys (`_hidden`, `_locked`, `_ui`, any `_*` key),
3. drops keys that are **not** part of the schema for that node (via a
   Zod-strip round trip of the *known* layer shapes — implemented as an
   explicit per-kind allow-list so behaviour is deterministic and reviewable),
4. clamps numeric spatial fields into their legal ranges rather than letting
   an out-of-range value hard-fail the whole save,
5. returns a plain object safe to `.parse()`.

**(c) Defend in depth.**

- `EngineCore.saveScene` calls `sanitizeSceneInput()` **before**
  `validateScene()`. The engine is the last line of defence: even if a future
  client bypasses the Studio, the store never sees an unsanitizable scene.
- `packages/studio/src/api.ts` calls the *same* function before crossing the
  IPC boundary, so the renderer never ships a payload the engine must repair.

**(d) Heal legacy scenes on load.**

`EngineCore.handleExternalSceneChange` and `SceneStore.load()` parse scenes
from disk. A scene written by an older build may carry keys the current schema
rejects. Both paths now run `sanitizeSceneInput()` first, so a legacy scene
loads (and is re-written in canonical form) instead of being skipped with a
parse error.

### 1.4 Tests added

`packages/scene-spec/tests/layer-spatial-fields.spec.ts`:

- for **every** layer kind (`background`, `imageLogo`, `kineticText`, `card`,
  `lottie`, `foregroundFX`), a layer carrying `position`, `scale`, `rotation`,
  `opacity`, `visible`, `locked`, `trackIndex`, `blendMode` validates;
- `background` at `layers.0` specifically — the exact reported failure;
- a scene carrying `_hidden` / `_locked` / an unknown key is stripped by
  `sanitizeSceneInput` and then validates;
- out-of-range spatial values are clamped, not rejected;
- `sanitizeSceneInput` is idempotent.

`packages/core-engine/tests/engine-hardening.test.ts` (extended):

- `saveScene` accepts a UI-dirty payload (background with `position`,
  `_hidden`, `_locked`) and returns `ok`;
- the persisted scene on disk contains no `_`-prefixed keys;
- a legacy scene file containing an unknown key is healed on load.

---

## 2. B-2 — `[mf-runtime] File not found: ...\packages\scene-runtime\dist\index.html`

### 2.1 Root cause 1 — the bundle is never built

`packages/desktop/package.json` declares `"dev": "electron-vite dev"`. There is
no `predev`. `electron-vite dev` builds **only** the desktop package
(`packages/desktop/out/{main,preload,renderer}`). The scene runtime is a
*separate* Vite app (`packages/scene-runtime`, `vite build` → `dist/`), and the
Studio renderer (`packages/studio`) is a third Vite app.

So `npm run dev -w @motionforge/desktop` boots Electron with **no**
`packages/scene-runtime/dist/` on disk unless somebody happened to run
`npm run build -w @motionforge/scene-runtime` first. The `mf-runtime://`
handler then correctly reports the file as missing.

The `mf-runtime` handler's own candidate list makes the fragility visible
(`packages/desktop/src/main.ts`):

```ts
const candidates = [
  path.resolve(__dirname, '../../../scene-runtime/dist'),
  path.resolve(__dirname, '../../scene-runtime/dist'),
  path.resolve(__dirname, '../runtime'),
  path.resolve(process.cwd(), 'packages/scene-runtime/dist'),
];
const baseDir = candidates.find((c) => existsSync(c)) || candidates[0];
```

When *no* candidate exists, it silently falls back to `candidates[0]` and then
404s — with a log line that names a path the user cannot act on.

**Fix.** Add a `predev` (and a `prebuild`) to `packages/desktop/package.json`
that builds, in order, `@motionforge/scene-spec`, `@motionforge/core-engine`
and `@motionforge/scene-runtime`:

```json
"predev":  "npm run build -w @motionforge/scene-spec && npm run build -w @motionforge/core-engine && npm run build -w @motionforge/scene-runtime",
"prebuild":"npm run build -w @motionforge/scene-spec && npm run build -w @motionforge/core-engine && npm run build -w @motionforge/scene-runtime"
```

`npm run dev` at the repository root delegates to `npm run dev -w @motionforge/desktop`,
so the root command inherits the same guarantee.

Additionally, the handler now:

- resolves the runtime root **once** at startup, with an explicit ordered
  candidate list that includes the packaged `resources/` location,
- **fails loudly and early**: if `dist/index.html` is missing it logs the
  resolved root, every candidate it tried and the exact command to run
  (`npm run build -w @motionforge/scene-runtime`), and
- logs a positive confirmation line when the runtime is found:
  `[desktop] scene-runtime bundle verified: <absolute path to index.html>`.

### 2.2 Root cause 2 — Windows path handling in the protocol handlers

`mf-runtime://app/index.html` is a **standard** scheme
(`protocol.registerSchemesAsPrivileged` sets `standard: true`), so `new URL()`
parses it as:

```
protocol : mf-runtime:
hostname : "app"
pathname : "/index.html"
search   : "?scene=…"
```

The handler only read `url.pathname` and ignored `url.hostname`. On POSIX that
happened to work; on Windows it produced two classes of failure:

1. **Host/path confusion.** A request for `mf-runtime://app/assets/x.js`
   resolved to `<root>/assets/x.js` — fine — but a request for
   `mf-runtime://app/../scene.js` resolved *outside* the bundle root because
   the joined path was never re-checked against the root (a traversal risk, not
   just a portability bug).
2. **Drive-letter / backslash handling.** `path.join(baseDir, pathname…)` on
   Windows yields `D:\…\dist\index.html`, and `pathToFileURL()` handles that
   correctly — but only if the *root* was produced by `path.resolve()`. The old
   code mixed `path.resolve` roots with a raw `pathname` that could contain
   `%5C` (an encoded backslash) on Windows, which `decodeURIComponent` turns
   into a literal separator and `path.join` then treats as a nested segment.

**Fix.** Both handlers now:

- parse the URL with `new URL(request.url)`,
- take the **first** path segment as the bundle mount (`app` → the runtime
  root) and the remainder as the relative file path,
- `decodeURIComponent` each segment **individually** (so `%2F` inside a segment
  cannot inject a separator),
- reject any segment equal to `..` (traversal guard),
- `path.resolve(root, ...segments)` and then assert the result is still
  inside the root (`resolved.startsWith(root + path.sep)`),
- serve it with `net.fetch(pathToFileURL(resolved).toString())`, which is
  correct for `D:\…` drive-letter paths.

The vault handler (`mf-vault://`) gets the same treatment: it builds a relative
path from `hostname + pathname`, sanitises it, resolves it inside
`engineCore.paths.vaultDir` and refuses to escape it.

### 2.3 Playwright zero-port route interception

The headless renderer (`packages/core-engine/src/renderer.ts`) serves the
runtime from memory through Playwright route interception. It already used
`path.resolve` + `file://` URLs; the audit added the same traversal guard and a
`pathToFileURL` conversion so the two serving paths cannot disagree.

---

## 3. B-4 — The window is not frameless

`packages/desktop/src/main.ts` created the `BrowserWindow` with a default frame
and a native application menu. The redesign calls for a completely custom
chrome.

**Fix.**

```ts
mainWindow = new BrowserWindow({
  width: 1440, height: 900, minWidth: 1024, minHeight: 700,
  title: 'MotionForge',
  frame: false,
  titleBarStyle: 'hidden',
  autoHideMenuBar: true,
  backgroundColor: '#090a0d',
  webPreferences: { /* … unchanged */ },
});
```

IPC handlers added in the main process:

| Channel | Behaviour | Return |
| --- | --- | --- |
| `window:minimize` | `mainWindow.minimize()` | `void` |
| `window:toggleMaximize` | `maximize()` ⇄ `unmaximize()` | `{ isMaximized }` |
| `window:isMaximized` | — | `{ isMaximized }` |
| `window:close` | `mainWindow.close()` | `void` |
| `window:MaximizedChanged` | **main → renderer** event, fired on the `maximize` / `unmaximize` / `restore` / `enter-full-screen` / `leave-full-screen` window events | `{ isMaximized }` |

The preload bridge exposes them as `window.motionforge.window.*`.

---

## 4. B-5 — Coverage gap in `npm run typecheck`

`packages/studio` and `packages/desktop` had **no** `typecheck` script, so the
root `npm run typecheck` (which is `npm run typecheck --workspaces --if-present`)
silently skipped the two packages that contain the entire UI. A "clean
typecheck" claim was therefore only ever about the engine.

**Fix.** Both packages now declare `"typecheck": "tsc -p tsconfig.json --noEmit"`
and are part of the workspace-wide gate.

---

## 5. Architectural consequences (unchanged)

- **No HTTP server.** `EngineCore` is instantiated inside the Electron main
  process. `packages/core-engine/src/main.ts` is a 15-line library entry point;
  there is no `server.ts` and no `listen()`.
- **One-way dependencies.** The Studio imports `@motionforge/scene-spec` for
  types and (from Phase 1) for `sanitizeSceneInput`. It never imports
  `@motionforge/core-engine` in the renderer — the bridge is IPC only.
- **Deterministic rendering.** The runtime exposes `window.seekToFrame(n)`,
  awaits `document.fonts.ready` and image decode, and never animates from
  `Date.now()`.

---

## 6. Regression checklist (all executed)

- [x] `npm test -w @motionforge/scene-spec` — spatial-field contract + sanitizer tests green.
- [x] `npm test -w @motionforge/core-engine` — save-path hardening tests green.
- [x] `npm run typecheck` — 0 errors in **all six** workspaces.
- [x] `npm run build` — 0 errors.
- [x] `rm -rf packages/scene-runtime/dist && npm run dev -w @motionforge/desktop` — runtime bundle rebuilt by `predev` and served over `mf-runtime://`.
- [x] Electron E2E — zero `Unrecognized key(s) in object: 'position'` on any save path.
