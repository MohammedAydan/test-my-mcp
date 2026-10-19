# Execution Plan: DA-004 — Vault Asset Drag-and-Drop to Canvas & Timeline

## 1. Problem Statement & Audit Context
In modern NLEs, users author video scenes by dragging assets (images, logos, audio tracks, Lottie animations) directly from an Asset Library/Vault panel into the Canvas Monitor (spatial positioning) or Timeline (temporal placement).

Currently:
- The left dock "Assets" tab in `packages/studio/src/components/LayersPanel.tsx` is an empty placeholder displaying only static text ("Asset Vault / Manage project media...").
- Neither `packages/studio/src/components/CanvasOverlay.tsx` nor `packages/studio/src/components/Timeline.tsx` implement HTML5 Drag-and-Drop handlers (`ondragover`, `ondragenter`, `ondragleave`, `ondrop`).
- Dragging any asset or external file displays the browser's "not-allowed" cursor and drops are rejected.

## 2. Architecture & Design

### A. Asset Vault UI (`LayersPanel.tsx`)
- Render all declared assets in `state.scene.assets` (images, lotties, audio, fonts).
- Provide an "Add Asset" button allowing file upload or adding pre-packaged vault assets (logo, lottie, sfx).
- Each asset card:
  - Render kind icon (`🖼 Image`, `✨ Lottie`, `🔊 Audio`, `🔤 Font`), asset ID, and preview/source snippet.
  - Set HTML5 `draggable={true}`.
  - On `ondragstart`:
    - Package payload via `e.dataTransfer.setData('application/json', JSON.stringify({ assetId: asset.id, kind: asset.kind, src: asset.src, name: asset.name }))`.
    - Set `e.dataTransfer.setData('text/plain', asset.id)`.
    - Set `e.dataTransfer.effectAllowed = 'copy'`.

### B. Canvas Monitor Drop Zone (`CanvasOverlay.tsx`)
- Attach drag event handlers to `#canvas-overlay-container`:
  - `ondragover` / `ondragenter`: `e.preventDefault(); e.dataTransfer.dropEffect = 'copy';`
  - Show active visual drop-zone border highlight (`ring-2 ring-[#f59e0b] bg-[#f59e0b]/5`).
  - `ondragleave`: remove highlight.
  - `ondrop`:
    - `e.preventDefault()`.
    - Calculate canvas coordinates:
      Use `screenToCanvas(e.clientX, e.clientY)` (or bounding rect of stage).
      Derive normalized canvas percentages `{ xPct, yPct }` (clamped to `[5, 95]`).
    - Parse dropped asset:
      - If `kind === 'image'` or image file: instantiate `imageLogo` layer with `assetId`, `position: { xPct, yPct }`, `at: state.playhead`, `duration: 3000`.
      - If `kind === 'lottie'`: instantiate `lottie` layer with `assetId`, `position: { xPct, yPct }`, `at: state.playhead`, `duration: 3000`.
      - If `kind === 'audio'`: add audio cue in `scene.audio.cues` at `at: state.playhead`.
      - If native OS file dropped: read file as Data URL, register in `scene.assets`, and instantiate corresponding layer.
    - Mutate scene via `store.mutateScene()`, select newly dropped layer, push history, and call `store.executeSave()`.

### C. Timeline Drop Zone (`Timeline.tsx`)
- Attach drag event handlers to timeline canvas / workspace:
  - `ondragover`: `e.preventDefault(); e.dataTransfer.dropEffect = 'copy';`
  - Render a drop indicator cursor line at `xToTime(x)`.
  - `ondrop`:
    - `e.preventDefault()`.
    - Convert `e.clientX` to timestamp `dropTime = xToTime(x)`.
    - Determine target track row from `y` (or auto-allocate appropriate track lane).
    - Insert layer clip or audio cue starting at `at: dropTime`.
    - Call `store.executeSave()`.

## 3. Backward Compatibility
- 100% backward compatible: scenes without assets continue to function unchanged.
- Layers created via drag-and-drop conform strictly to `SceneSpec` Zod schemas (`imageLogoLayerSchema`, `lottieLayerSchema`, `audioSchema`).

## 4. Verification Plan
- **Test:** New Playwright E2E test `scripts/test-drag-drop-vault.cjs`.
  - Launch Electron shell.
  - Seed scene with image and audio assets.
  - Switch to Assets tab.
  - Drag image asset card onto canvas overlay at (60%, 40%).
  - Assert new `imageLogo` layer created with `xPct: 60`, `yPct: 40`, `assetId: "logo"`.
  - Drag audio asset card onto timeline at timecode ~3000ms.
  - Assert new audio cue created at `at: 3000ms`.
  - Verify auto-save to engine.
  - Capture screenshot `screenshots/drag-drop-vault.png`.
- Run full unit test suite `npm test` (all 338 tests pass).
