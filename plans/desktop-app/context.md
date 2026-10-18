# Context: Desktop NLE Application & Solid.js Migration

## Files Created / Modified
- `packages/desktop/`:
  - `package.json`, `tsconfig.json`, `electron.vite.config.ts`, `electron-builder.yml`
  - `src/main.ts`: Main process, dynamic port allocation, child engine runner, native menus, IPC handlers.
  - `src/preload.ts`: Context bridge exposing `window.motionforge`.
- `packages/studio/`:
  - `package.json`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `index.html`
  - `src/index.tsx`, `src/App.tsx`, `src/store.ts`, `src/api.ts`
  - `src/components/` (Header, LayerList, Inspector, Preview, Timeline, Overlays)
- `packages/core-engine/`:
  - `src/server.ts`: Add `GET /api/scenes/:id/frame/:frameIndex/bounds` endpoint.
- `packages/scene-spec/`:
  - `src/layers/base.ts`: Add optional `rotation?: number` to layer base schema.
  - `src/tracks.ts`: Add optional keyframe tracks schema.
- `packages/scene-runtime/`:
  - `src/layers/`: Support layer rotation and dynamic property interpolation.
- `scripts/`:
  - `test-desktop-launch.cjs`: Test for Electron launching and IPC file I/O.
  - `test-phase2.cjs`: 22-test E2E suite to run against Solid UI.

## Environment Variables & Ports
- `MOTIONFORGE_ENGINE_URL`: Injected dynamically by Electron main process into renderer via `window.motionforge.engineUrl`.
- Development defaults: Engine `:4000`, Studio `:5174` (or `:5173`).
- In desktop mode, engine binds to an OS-assigned free port (e.g., 5xxxx).

## Open Questions / Notes
- To maintain complete zero-breakage compatibility with `scripts/test-phase2.cjs`, the Solid UI will preserve the data attributes (`data-tab`, `data-layer-id`, `#export-btn`, etc.) and CSS classes used by the test runner.
