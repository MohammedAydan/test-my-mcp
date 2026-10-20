# Pro NLE Design System — Adobe Spectrum Dark

> The visual contract for MotionForge Studio v3.0.
> Every value in this document is a **token**, not a one-off. Components consume
> tokens; they never hard-code a hex value.

---

## 1. Design principles

1. **Density over comfort.** A professional NLE shows more information per
   pixel than a consumer app. Labels are 11px, headers are 26px, rows are 22–28px.
   Padding is measured in 2–8px steps, never 16–32px.
2. **Structure before decoration.** Panels are separated by 1px borders and
   2–3px gutters — not by shadows, gradients or rounded cards.
3. **One accent, used sparingly.** Adobe Pro Blue `#2d8ceb` marks *focus* and
   *primary action*. Red `#ff4b4b` marks the playhead and the record/danger
   state. Nothing else is chromatic except the layer-kind swatches.
4. **No neon, no glass, no float.** Gradients are used only inside the
   rendered composition, never in the application chrome.
5. **Vector-only iconography.** 100% of icons are real SVG paths. Emoji are
   forbidden anywhere in the UI or the source.

---

## 2. Colour tokens (`src/styles/tokens.css`)

### 2.1 Surfaces

| Token | Value | Used for |
| --- | --- | --- |
| `--mf-bg-gutter` | `#090a0d` | The 2–3px gaps *between* docked panels; the app backdrop. |
| `--mf-bg-panel` | `#14161a` | Panel surfaces (left rail, monitor, inspector, timeline). |
| `--mf-bg-header` | `#1a1d23` | Panel header / tab bar (26px). |
| `--mf-bg-elevated` | `#20242c` | Inputs, dropdowns, raised controls, menu popovers. |
| `--mf-bg-sunken` | `#0f1114` | Track-header gutter, ruler well, code wells. |
| `--mf-bg-hover` | `#242830` | Hover state on interactive rows. |
| `--mf-bg-active` | `#2b3038` | Pressed / active row. |

### 2.2 Borders

| Token | Value | Used for |
| --- | --- | --- |
| `--mf-border` | `#262a34` | The structural 1px border of every panel and control. |
| `--mf-border-strong` | `#333a47` | Dividers inside a panel, table grid lines. |
| `--mf-border-focus` | `#2d8ceb` | **Active focused panel border** — `1px solid #2d8ceb` on the focused panel. |
| `--mf-border-danger` | `#7a1f28` | Destructive control outline. |

### 2.3 Accents

| Token | Value | Used for |
| --- | --- | --- |
| `--mf-accent` | `#2d8ceb` | Adobe Pro Blue — primary action, focused panel border, active tab underline. |
| `--mf-accent-hover` | `#4b9bf0` | Hover of the primary action. |
| `--mf-accent-dim` | `rgba(45,140,235,0.14)` | Selected-row fill, pressed toggle fill. |
| `--mf-accent-text` | `#8cc2ff` | Accent-coloured *text* on dark surfaces (readability). |
| `--mf-record` | `#ff4b4b` | Playhead, record state, destructive hover. |
| `--mf-record-dim` | `rgba(255,75,75,0.16)` | In/out shading, danger chips. |
| `--mf-keyframe` | `#38bdf8` | Keyframe diamonds, selection highlight. |
| `--mf-warning` | `#f59e0b` | Warnings, amber clip accents, dirty indicator. |
| `--mf-success` | `#22c55e` | Saved state, online badge. |
| `--mf-audio` | `#10b981` | Audio clips and the VU meter's healthy range. |

### 2.4 Text

| Token | Value | Used for |
| --- | --- | --- |
| `--mf-text-1` | `#e6e9ef` | Primary text (labels, values, tab titles). |
| `--mf-text-2` | `#9aa3b2` | Secondary text (hints, units, inactive labels). |
| `--mf-text-3` | `#6b7280` | Tertiary (disabled, ruler ticks). |
| `--mf-text-inverse` | `#0b0d10` | Text on an accent-filled button. |

### 2.5 Layer-kind swatches

The layer-stack and timeline use a per-kind swatch, matching the After Effects
column-label convention:

| Kind | Colour |
| --- | --- |
| `background` | `#6b7280` |
| `kineticText` | `#f43f5e` |
| `card` | `#14b8a6` |
| `imageLogo` | `#f59e0b` |
| `lottie` | `#22c55e` |
| `foregroundFX` | `#3b82f6` |

---

## 3. Typography

| Token | Value | Applied to |
| --- | --- | --- |
| `--mf-font-ui` | `'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif` | all labels |
| `--mf-font-mono` | `'JetBrains Mono', 'Cascadia Mono', Consolas, monospace` | **all** numbers, timecodes and code |
| `--mf-num` | `font-variant-numeric: tabular-nums` | applied to every mono surface |

| Token | Size / weight | Used for |
| --- | --- | --- |
| `--mf-text-xs` | 10px / 500 | ruler ticks, chip text, track header sub-labels |
| `--mf-text-sm` | 11px / 500 | **default label size** — field labels, table cells, tab titles |
| `--mf-text-md` | 12px / 500 | primary panel text, toolbar labels |
| `--mf-text-lg` | 13px / 600 | section headings inside a panel |
| `--mf-timecode` | 13px / 600 mono | the SMPTE timecode readout |
| `--mf-timecode-lg` | 16px / 600 mono | the large transport readout |

**Rule:** any value that can change (a timecode, a frame counter, a numeric
field, a percentage) is rendered in `--mf-font-mono` **with** `--mf-num`. Digits
must never jitter horizontally while scrubbing.

---

## 4. Metrics

| Token | Value |
| --- | --- |
| `--mf-titlebar-h` | 32px (custom frameless chrome) |
| `--mf-menubar-h` | 26px (application menu bar, inside the title bar row) |
| `--mf-tool-dock-w` | 40px (vertical tool rail) |
| `--mf-panel-header-h` | 26px (tab bar) |
| `--mf-statusbar-h` | 22px |
| `--mf-row-h` | 22px (layer stack rows, inspector rows) |
| `--mf-track-h` | 28px (timeline video track) |
| `--mf-audio-track-h` | 26px (timeline audio track) |
| `--mf-ruler-h` | 28px (SMPTE time ruler) |
| `--mf-gutter` | 2px (between docked panels) |
| `--mf-splitter` | 4px (resizable splitter hit area) |
| `--mf-radius` | 2px (inputs, chips) — **not** 12px rounded cards |
| `--mf-radius-sm` | 1px |

---

## 5. The SVG icon system (`src/components/icons/NleIcons.tsx`)

### 5.1 Rules

- Every icon is a **real SVG element** with `viewBox="0 0 24 24"`,
  `fill="none"`, `stroke="currentColor"`, `stroke-width="1.75"`,
  `stroke-linecap="round"`, `stroke-linejoin="round"`.
- Two rendered sizes: **14px** (inline, in toolbars and rows) and **16px**
  (title bar, transport, large panel headers). The component accepts a `size`
  prop and defaults to 14.
- Icons inherit `currentColor` so a single CSS rule re-tints an entire toolbar.
- Filled variants (e.g. the *eye* when a layer is visible, the *keyframe*
  diamond) flip `fill` to `currentColor` — they are still the same path.

### 5.2 Catalogue

| Icon | Export name | Glyph |
| --- | --- | --- |
| Selection arrow | `IconCursor` | pointer arrow |
| Hand / pan | `IconHand` | open hand |
| Razor / split | `IconRazor` | blade + cut line |
| Text | `IconType` | capital T with a baseline |
| Shape / rectangle | `IconShape` | rounded rect |
| Chart | `IconChart` | bar chart |
| Code | `IconCode` | `< >` chevrons |
| Device | `IconDevice` | monitor rectangle |
| Magnet / snap | `IconMagnet` | horseshoe magnet |
| Undo | `IconUndo` | counter-clockwise arrow |
| Redo | `IconRedo` | clockwise arrow |
| Save | `IconSave` | floppy |
| Folder / open | `IconFolder` | folder |
| New file | `IconFilePlus` | page with a plus |
| Import | `IconImport` | arrow into a tray |
| Trash / delete | `IconTrash` | bin with lid |
| Duplicate | `IconCopy` | two overlapping pages |
| Eye (visible) | `IconEye` | eye outline / filled |
| Eye (hidden) | `IconEyeOff` | eye with a slash |
| Solo | `IconSolo` | a filled circle |
| Lock | `IconLock` | closed padlock |
| Unlock | `IconUnlock` | open padlock |
| Mute | `IconMute` | speaker with a slash |
| Audio / waveform | `IconWaveform` | vertical bars |
| Keyframe diamond | `IconDiamond` | rotated square |
| Stopwatch | `IconStopwatch` | circle + stem |
| Link / whip | `IconWhip` | chain link |
| Play | `IconPlay` | triangle |
| Pause | `IconPause` | two bars |
| Step back | `IconStepBack` | triangle + bar |
| Step forward | `IconStepForward` | bar + triangle |
| Go to in | `IconGoToStart` | bar + left triangle |
| Go to out | `IconGoToEnd` | right triangle + bar |
| Loop | `IconLoop` | circular arrow |
| Shuttle | `IconShuttle` | chevrons |
| Zoom in / out | `IconZoomIn` / `IconZoomOut` | magnifier ± |
| Fit | `IconFit` | bracket frame |
| Window minimise | `IconMinimize` | horizontal bar |
| Window maximise | `IconMaximize` | square |
| Window restore | `IconRestore` | two offset squares |
| Window close | `IconClose` | X |
| Render / export | `IconExport` | arrow out of a tray |
| Render queue | `IconQueue` | stacked lines |
| Search | `IconSearch` | magnifier |
| Settings | `IconSettings` | sliders |
| Chevron down / right | `IconChevronDown` / `IconChevronRight` | angle |
| Plus | `IconPlus` | plus |
| Minus | `IconMinus` | minus |
| Close | `IconClose` | X |
| Grid | `IconGrid` | 4 squares |
| List | `IconList` | 3 lines + dots |
| Safe guides | `IconGuides` | frame with inset frame |
| Crosshair | `IconCrosshair` | cross with a circle |
| Grid overlay | `IconGridOverlay` | crosshatch |
| Check | `IconCheck` | tick |
| Warning | `IconWarning` | triangle with a bang |
| Info | `IconInfo` | circle with an i |
| Menu | `IconMenu` | three lines |
| Help | `IconHelp` | circle with a question mark |
| Layers | `IconLayers` | stacked diamonds |
| Composition | `IconComposition` | frame with a corner bracket |
| Effects | `IconEffects` | sliders + star |
| Motion | `IconMotion` | motion path arc |
| Audio workspace | `IconAudioWorkspace` | speaker with wave |
| Export workspace | `IconExportWorkspace` | arrow leaving a frame |
| Camera | `IconCamera` | camera body + lens |
| Transition | `IconTransition` | two overlapping frames |
| Zoom fit | `IconFit` | (see above) |

### 5.3 Zero-emoji enforcement

1. **Static gate.** `npm run verify:no-emoji` greps `packages/studio/src/**` for
   the Unicode ranges `U+1F300–U+1FAFF`, `U+2600–U+27BF`, `U+FE0F`, `U+2190–U+21FF`
   (arrows/box-drawing used decoratively) and `U+2B00–U+2BFF`. Zero hits
   required.
2. **Runtime gate.** `scripts/test-pro-nle-redesign.cjs` reads
   `document.body.innerText` from the live app and asserts that no codepoint
   in those ranges appears. This catches emoji that arrive from data
   (e.g. an asset name), not just from source.
3. **Typographic replacements.** The characters that were emoji are replaced by
   real icons: `👁` → `IconEye`, `🔒` → `IconLock`, `✨` → `IconEffects`,
   `🔊` → `IconWaveform`, `🖼` → `IconImage`, `⏮`/`⏭`/`▶`/`⏸` → the transport
   icons, `✂` → `IconRazor`, `⏱` → `IconStopwatch`, `◆` → `IconDiamond`,
   `▼`/`▶` → `IconChevronDown` / `IconChevronRight`.

> Glyphs that are **not** emoji and are legitimate in a pro UI are allowed and
> are still drawn as SVG where they carry meaning: the chevrons, the plus sign
> and the cross are rendered as icons, not as text.

---

## 6. The frameless window shell (`frame: false`)

### 6.1 Electron configuration

```ts
new BrowserWindow({
  width: 1440, height: 900, minWidth: 1024, minHeight: 700,
  frame: false,
  titleBarStyle: 'hidden',
  autoHideMenuBar: true,
  backgroundColor: '#090a0d',
});
```

The native title bar and the native menu bar are both gone. `Menu.setApplicationMenu`
is **not** called (no native menu is installed) — the application menu is drawn
in the renderer.

### 6.2 Title bar layout (32px)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [emblem] File Edit Composition Layer Timeline View Window Help │ ● Project ▸ comp │ [status] [Render] [_] [□] [✕] │
└──────────────────────────────────────────────────────────────────────────────────┘
   ← left (no-drag)                ← centre (drag)                              → right (no-drag) →
```

| Region | `-webkit-app-region` | Contents |
| --- | --- | --- |
| Left | `no-drag` | MotionForge SVG emblem + the application menu bar (`File`, `Edit`, `Composition`, `Layer`, `Timeline`, `View`, `Window`, `Help`). |
| Centre | `drag` | Project name, scene/composition breadcrumb, the unsaved dirty dot, and the workspace layout switcher pills (`Editing`, `Motion`, `Audio`, `Effects`, `Export`). |
| Right | `no-drag` | Engine status badge, Quick Render CTA, and the three window-control buttons. |

### 6.3 Window control buttons

| Button | Icon | Hover | Action |
| --- | --- | --- | --- |
| Minimise | `IconMinimize` (bar) | `--mf-bg-hover` | `window.motionforge.window.minimize()` |
| Maximise / Restore | `IconMaximize` ⇄ `IconRestore` | `--mf-bg-hover` | `window.motionforge.window.toggleMaximize()` |
| Close | `IconClose` (X) | `#e81123` bg, white glyph | `window.motionforge.window.close()` |

The maximise/restore glyph is driven by the `window:MaximizedChanged` event
pushed from the main process, so it is correct even when the user double-clicks
the title bar to zoom.

### 6.4 Application menu bar behaviour

- Click a menu title → it opens.
- Hovering another menu title while one is open → the open menu **switches**.
- `Escape`, a click outside, or a second click on the same title → it closes.
- Every item shows its keyboard shortcut right-aligned in mono.
- Every item dispatches a **real** command into the store (no dead entries).

---

## 7. Panel containers

Every docked panel uses the same wrapper:

```
┌ tab-bar (26px, --mf-bg-header, 1px bottom border) ─────────────────┐
│ ▸ Panel Title ▸ Panel Title ▸            [header actions]           │
├─────────────────────────────────────────────────────────────────────┤
│ content                                                             │
└─────────────────────────────────────────────────────────────────────┘
```

- The **focused** panel gets `border: 1px solid var(--mf-border-focus)`.
  Clicking anywhere inside a panel focuses it.
- Double-clicking the tab bar, or pressing `` ` `` (Backquote), maximises the
  focused panel to the full window; the same key restores it.
- A maximised panel is tracked in `state.maximizedPanelId`.

---

## 8. Scrub input

The Pro NLE numeric field (`ScrubInput`):

- `cursor: ew-resize` on the label,
- horizontal drag changes the value continuously,
- `Shift` = 10×, `Alt` = 0.1×,
- a single click turns the field into a text input for an exact value,
- the drag produces **one** undo snapshot and **one** atomic save on release,
- the value is mono + tabular, right-aligned, with the unit in `--mf-text-3`.

---

## 9. Smart alignment guides

While dragging a layer in the Program Monitor:

- guides are 1px lines, dashed `4 3`,
- canvas-centre / canvas-edge guides are `--mf-keyframe` (cyan),
- guides snapped to another layer's edge/centre are `--mf-warning` (amber),
- each guide carries a small mono label naming its target,
- holding `Alt` suspends snapping entirely.

---

## 10. Accessibility

- Every interactive control has an `aria-label` and a visible focus ring
  (`outline: 1px solid var(--mf-accent)`).
- The panel tab bars use `role="tablist"` / `role="tab"` / `role="tabpanel"`.
- The timecode readout is `aria-live="polite"` so it does not spam a screen
  reader during playback — the transport readout is `aria-label="Timecode"`.
- `prefers-reduced-motion` collapses all transitions to 0.01ms.
- A skip link (`Skip to preview content`) is the first focusable element.
