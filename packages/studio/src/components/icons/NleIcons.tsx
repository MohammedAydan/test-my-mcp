import { Component, JSX } from 'solid-js';

/**
 * MotionForge Pro NLE — Vector Icon System.
 *
 * EVERY icon in the Studio is one of these. Unicode emoji are strictly
 * forbidden: they render differently on every platform, they cannot inherit
 * `currentColor`, and they break the density of a professional tool.
 *
 * House rules:
 *  - `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`,
 *    `stroke-width="1.75"`, round caps and joins.
 *  - Two sizes: 14px (inline rows) and 16px (title bar / transport).
 *  - Filled variants flip `fill` to `currentColor` — still the same path.
 *  - A decorative variant renders `aria-hidden`; a meaningful one takes an
 *    `aria-label`.
 */

export interface NleIconProps {
  /** rendered size in px — 14 (inline) or 16 (chrome) */
  size?: number;
  /** accessible label; omit for decorative icons */
  title?: string;
  class?: string;
  style?: JSX.CSSProperties;
  /** filled rendering (the "on" state of a toggle) */
  filled?: boolean;
  onClick?: (e: MouseEvent) => void;
}

/**
 * Clone the icon's path so EVERY instance owns its DOM nodes.
 *
 * A DOM node can only live in ONE place: inserting a shared node MOVES it, so
 * a glyph built once at module scope would paint in its LAST instance and be
 * blank in every other one. Each icon therefore clones its path on render.
 */
function cloneIconPath(path: JSX.Element): JSX.Element {
  if (typeof path === 'function') return (path as () => JSX.Element)();
  if (Array.isArray(path)) {
    return path.map((node) => cloneIconPath(node as JSX.Element)) as unknown as JSX.Element;
  }
  if (typeof Node !== 'undefined' && (path as unknown as Node) instanceof Node) {
    return (path as unknown as Node).cloneNode(true) as unknown as JSX.Element;
  }
  return path;
}

function makeIcon(displayName: string, path: JSX.Element, extra?: Partial<NleIconProps>) {
  const Icon: Component<NleIconProps> = (props) => {
    const size = () => props.size ?? 14;
    const filled = () => props.filled === true;
    const attributes: JSX.SvgSVGAttributes<SVGSVGElement> = {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: '0 0 24 24',
      width: size(),
      height: size(),
      fill: filled() ? 'currentColor' : 'none',
      stroke: 'currentColor',
      'stroke-width': '1.75',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      class: props.class,
      style: props.style,
      role: props.title ? 'img' : undefined,
      'aria-label': props.title,
      'aria-hidden': props.title ? undefined : 'true',
      onClick: props.onClick as never,
    };
    return (
      <svg {...attributes}>
        {props.title ? <title>{props.title}</title> : null}
        {cloneIconPath(path)}
      </svg>
    );
  };
  (Icon as unknown as { displayName?: string }).displayName = displayName;
  return Icon;
}

/* ── Tools ─────────────────────────────────────────────────────────────── */
export const IconCursor = makeIcon(
  'IconCursor',
  <path d="M5 3l14 8-6.5 1.5L9 19z" />
);
export const IconHand = makeIcon(
  'IconHand',
  <path d="M9 11V5.5a1.5 1.5 0 013 0V11m0-1.5v-4a1.5 1.5 0 013 0V11m0-2a1.5 1.5 0 013 0v6a6 6 0 01-6 6h-1.2a5 5 0 01-3.6-1.5L6 16.2a1.6 1.6 0 012.4-2.1L9 15V8.5a1.5 1.5 0 013 0" />
);
export const IconRazor = makeIcon(
  'IconRazor',
  <>
    <path d="M4 8l9-4 7 3-9 4z" />
    <path d="M11 11l-2.5 8" />
    <path d="M3 21h18" stroke-dasharray="2 3" />
  </>
);
export const IconType = makeIcon(
  'IconType',
  <>
    <path d="M5 6V4h14v2" />
    <path d="M12 4v16" />
    <path d="M9 20h6" />
  </>
);
export const IconShape = makeIcon(
  'IconShape',
  <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
);
export const IconChart = makeIcon(
  'IconChart',
  <>
    <path d="M4 20h16" />
    <path d="M7 20v-6" />
    <path d="M12 20V8" />
    <path d="M17 20v-9" />
  </>
);
export const IconCode = makeIcon(
  'IconCode',
  <>
    <path d="M9 8l-4 4 4 4" />
    <path d="M15 8l4 4-4 4" />
  </>
);
export const IconDevice = makeIcon(
  'IconDevice',
  <>
    <rect x="2.5" y="4.5" width="19" height="13" rx="1.5" />
    <path d="M8 20h8" />
    <path d="M12 17.5V20" />
  </>
);
/**
 * The particle field — a constellation of drifting dots.
 *
 * VECTOR ONLY (rule 11): a field of small circles, never a glyph and never
 * an emoji.
 */
export const IconParticles = makeIcon(
  'IconParticles',
  <>
    <circle cx="7" cy="7" r="1.6" />
    <circle cx="16.5" cy="5.5" r="1.1" />
    <circle cx="12" cy="11.5" r="1.9" />
    <circle cx="18" cy="13" r="1.3" />
    <circle cx="6" cy="15.5" r="1.2" />
    <circle cx="10.5" cy="18.5" r="1.5" />
    <path d="M7 7l5 4.5M12 11.5l6 1.5M12 11.5l-6 4" stroke-dasharray="2 2" />
  </>
);
/**
 * The call-to-action button — a rounded pill with a glyph.
 *
 * VECTOR ONLY (rule 11).
 */
export const IconCta = makeIcon(
  'IconCta',
  <>
    <rect x="2.5" y="7.5" width="19" height="9" rx="4.5" />
    <path d="M9 12h6" />
    <path d="M12.5 9.5L15 12l-2.5 2.5" />
  </>
);
/** The right-pointing arrow — the `cta` icon glyph. */
export const IconArrowRight = makeIcon(
  'IconArrowRight',
  <>
    <path d="M4 12h15" />
    <path d="M13 6l6 6-6 6" />
  </>
);
export const IconMagnet = makeIcon(
  'IconMagnet',
  <>
    <path d="M6 4v8a6 6 0 0012 0V4" />
    <path d="M6 10h4" />
    <path d="M14 10h4" />
  </>
);
export const IconUndo = makeIcon(
  'IconUndo',
  <>
    <path d="M4 8h10a5 5 0 010 10h-3" />
    <path d="M8 4L4 8l4 4" />
  </>
);
export const IconRedo = makeIcon(
  'IconRedo',
  <>
    <path d="M20 8H10a5 5 0 000 10h3" />
    <path d="M16 4l4 4-4 4" />
  </>
);

/* ── Files & assets ─────────────────────────────────────────────────────── */
export const IconSave = makeIcon(
  'IconSave',
  <>
    <path d="M5 3h11l3 3v15H5z" />
    <path d="M8 3v6h7V3" />
    <path d="M8 21v-7h8v7" />
  </>
);
export const IconFolder = makeIcon(
  'IconFolder',
  <path d="M3 6.5A1.5 1.5 0 014.5 5h4l2 2.5h9A1.5 1.5 0 0121 9v9.5a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18.5z" />
);
export const IconFilePlus = makeIcon(
  'IconFilePlus',
  <>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4" />
    <path d="M12 11v6" />
    <path d="M9 14h6" />
  </>
);
export const IconImport = makeIcon(
  'IconImport',
  <>
    <path d="M12 3v11" />
    <path d="M8 10l4 4 4-4" />
    <path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" />
  </>
);
export const IconTrash = makeIcon(
  'IconTrash',
  <>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7l1 13h10l1-13" />
    <path d="M10 11v6M14 11v6" />
  </>
);
export const IconCopy = makeIcon(
  'IconCopy',
  <>
    <rect x="8.5" y="8.5" width="12" height="12" rx="1.5" />
    <path d="M15.5 5.5v-1a1 1 0 00-1-1h-10a1 1 0 00-1 1v10a1 1 0 001 1h1" />
  </>
);
export const IconImage = makeIcon(
  'IconImage',
  <>
    <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
    <circle cx="8.5" cy="10" r="1.5" />
    <path d="M4 17l5-5 4 4 2.5-2.5L20 18" />
  </>
);
export const IconSearch = makeIcon(
  'IconSearch',
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </>
);
export const IconGrid = makeIcon(
  'IconGrid',
  <>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
  </>
);
export const IconList = makeIcon(
  'IconList',
  <>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </>
);

/* ── Layer state ────────────────────────────────────────────────────────── */
export const IconEye = makeIcon(
  'IconEye',
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.75" />
  </>
);
export const IconEyeOff = makeIcon(
  'IconEyeOff',
  <>
    <path d="M4 4l16 16" />
    <path d="M9.5 6.1A9.6 9.6 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-3.3 4" />
    <path d="M6.4 8A17 17 0 002.5 12S6 18.5 12 18.5a9.7 9.7 0 003.4-.6" />
    <path d="M10.2 10.3a2.75 2.75 0 003.5 3.5" />
  </>
);
export const IconSolo = makeIcon(
  'IconSolo',
  <circle cx="12" cy="12" r="5" />
);
export const IconLock = makeIcon(
  'IconLock',
  <>
    <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
    <path d="M8 10.5V7.5a4 4 0 018 0v3" />
  </>
);
export const IconUnlock = makeIcon(
  'IconUnlock',
  <>
    <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
    <path d="M8 10.5V7.5a4 4 0 017.5-2" />
  </>
);
export const IconMute = makeIcon(
  'IconMute',
  <>
    <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
    <path d="M16 9.5l5 5" />
    <path d="M21 9.5l-5 5" />
  </>
);
export const IconWaveform = makeIcon(
  'IconWaveform',
  <>
    <path d="M4 11v2" />
    <path d="M7.5 8v8" />
    <path d="M11 5v14" />
    <path d="M14.5 8v8" />
    <path d="M18 10.5v3" />
    <path d="M21 11v2" />
  </>
);
export const IconDiamond = makeIcon(
  'IconDiamond',
  <path d="M12 3l9 9-9 9-9-9z" />
);
export const IconStopwatch = makeIcon(
  'IconStopwatch',
  <>
    <circle cx="12" cy="13.5" r="7" />
    <path d="M12 13.5V9.5" />
    <path d="M9.5 2.5h5" />
    <path d="M12 2.5v4" />
  </>
);
export const IconWhip = makeIcon(
  'IconWhip',
  <>
    <path d="M9.5 14.5l5-5" />
    <path d="M11 7l2.5-2.5a3.5 3.5 0 015 5L16 12" />
    <path d="M13 17l-2.5 2.5a3.5 3.5 0 01-5-5L8 12" />
  </>
);

/* ── Transport ──────────────────────────────────────────────────────────── */
export const IconPlay = makeIcon(
  'IconPlay',
  <path d="M7 4.5l12 7.5-12 7.5z" />
);
export const IconPause = makeIcon(
  'IconPause',
  <>
    <rect x="6.5" y="5" width="4" height="14" rx="1" />
    <rect x="13.5" y="5" width="4" height="14" rx="1" />
  </>
);
export const IconStepBack = makeIcon(
  'IconStepBack',
  <>
    <path d="M18 5.5v13L8 12z" />
    <path d="M6 5.5v13" />
  </>
);
export const IconStepForward = makeIcon(
  'IconStepForward',
  <>
    <path d="M6 5.5v13L16 12z" />
    <path d="M18 5.5v13" />
  </>
);
export const IconGoToStart = makeIcon(
  'IconGoToStart',
  <>
    <path d="M18 5.5v13L8 12z" />
    <path d="M6 5.5v13" />
  </>
);
export const IconGoToEnd = makeIcon(
  'IconGoToEnd',
  <>
    <path d="M6 5.5v13L16 12z" />
    <path d="M18 5.5v13" />
  </>
);
export const IconLoop = makeIcon(
  'IconLoop',
  <>
    <path d="M4 10V8a3 3 0 013-3h10" />
    <path d="M14 2l3 3-3 3" />
    <path d="M20 14v2a3 3 0 01-3 3H7" />
    <path d="M10 22l-3-3 3-3" />
  </>
);
export const IconShuttle = makeIcon(
  'IconShuttle',
  <>
    <path d="M6 6l6 6-6 6" />
    <path d="M13 6l6 6-6 6" />
  </>
);
export const IconZoomIn = makeIcon(
  'IconZoomIn',
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
    <path d="M11 8.5v5M8.5 11h5" />
  </>
);
export const IconZoomOut = makeIcon(
  'IconZoomOut',
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
    <path d="M8.5 11h5" />
  </>
);
export const IconFit = makeIcon(
  'IconFit',
  <>
    <path d="M4 9V5.5A1.5 1.5 0 015.5 4H9" />
    <path d="M15 4h3.5A1.5 1.5 0 0120 5.5V9" />
    <path d="M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15" />
    <path d="M9 20H5.5A1.5 1.5 0 014 18.5V15" />
  </>
);

/* ── Window chrome ──────────────────────────────────────────────────────── */
export const IconMinimize = makeIcon(
  'IconMinimize',
  <path d="M5 12h14" />
);
export const IconMaximize = makeIcon(
  'IconMaximize',
  <rect x="5" y="5" width="14" height="14" rx="1" />
);
export const IconRestore = makeIcon(
  'IconRestore',
  <>
    <rect x="4.5" y="8" width="11.5" height="11.5" rx="1" />
    <path d="M8 8V5.5A1.5 1.5 0 019.5 4H18a1.5 1.5 0 011.5 1.5V15a1.5 1.5 0 01-1.5 1.5H16" />
  </>
);
export const IconClose = makeIcon(
  'IconClose',
  <>
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </>
);
export const IconMenu = makeIcon(
  'IconMenu',
  <>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </>
);

/* ── Workspace / panels ─────────────────────────────────────────────────── */
export const IconComposition = makeIcon(
  'IconComposition',
  <>
    <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
    <path d="M3 9h18" />
    <path d="M9 4.5v15" />
  </>
);
export const IconLayers = makeIcon(
  'IconLayers',
  <>
    <path d="M12 3l9 5-9 5-9-5z" />
    <path d="M3 13l9 5 9-5" />
  </>
);
export const IconEffects = makeIcon(
  'IconEffects',
  <>
    <path d="M4 7h10M18 7h2" />
    <path d="M4 12h4M12 12h8" />
    <path d="M4 17h12M20 17h0" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="17" r="2" />
  </>
);
export const IconMotion = makeIcon(
  'IconMotion',
  <>
    <path d="M3 17c4 0 5-10 9-10s5 10 9 10" />
    <circle cx="3" cy="17" r="1.6" />
    <circle cx="21" cy="17" r="1.6" />
  </>
);
export const IconAudioWorkspace = makeIcon(
  'IconAudioWorkspace',
  <>
    <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
    <path d="M15.5 9a4 4 0 010 6" />
    <path d="M18.5 6.5a8 8 0 010 11" />
  </>
);
export const IconExportWorkspace = makeIcon(
  'IconExportWorkspace',
  <>
    <path d="M4 6h16v12H4z" />
    <path d="M12 15V3" />
    <path d="M9 6l3-3 3 3" />
  </>
);
export const IconCamera = makeIcon(
  'IconCamera',
  <>
    <rect x="3" y="6.5" width="12" height="11" rx="1.5" />
    <path d="M15 10.5l6-3v9l-6-3z" />
  </>
);
export const IconTransition = makeIcon(
  'IconTransition',
  <>
    <rect x="3" y="5" width="10" height="14" rx="1" />
    <rect x="11" y="5" width="10" height="14" rx="1" />
  </>
);

/* ── Actions ────────────────────────────────────────────────────────────── */
export const IconExport = makeIcon(
  'IconExport',
  <>
    <path d="M12 15V3" />
    <path d="M9 6l3-3 3 3" />
    <path d="M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" />
  </>
);
export const IconQueue = makeIcon(
  'IconQueue',
  <>
    <path d="M4 6h16M4 12h16M4 18h10" />
    <path d="M18 15v6M15 18h6" />
  </>
);
export const IconSettings = makeIcon(
  'IconSettings',
  <>
    <path d="M4 7h16M4 12h16M4 17h16" />
    <circle cx="9" cy="7" r="2" />
    <circle cx="15" cy="12" r="2" />
    <circle cx="8" cy="17" r="2" />
  </>
);
export const IconCheck = makeIcon(
  'IconCheck',
  <path d="M4.5 12.5l5 5 10-11" />
);
export const IconWarning = makeIcon(
  'IconWarning',
  <>
    <path d="M12 3.5l9.5 16.5H2.5z" />
    <path d="M12 10v4.5" />
    <path d="M12 17.5h.01" />
  </>
);
export const IconInfo = makeIcon(
  'IconInfo',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6" />
    <path d="M12 7.5h.01" />
  </>
);
export const IconHelp = makeIcon(
  'IconHelp',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.6 2.6 0 015 .9c0 1.8-2.5 2.4-2.5 4" />
    <path d="M12 17.5h.01" />
  </>
);
export const IconChevronDown = makeIcon(
  'IconChevronDown',
  <path d="M6 9.5l6 6 6-6" />
);
export const IconChevronRight = makeIcon(
  'IconChevronRight',
  <path d="M9.5 6l6 6-6 6" />
);
export const IconPlus = makeIcon(
  'IconPlus',
  <path d="M12 5v14M5 12h14" />
);
export const IconMinus = makeIcon(
  'IconMinus',
  <path d="M5 12h14" />
);
export const IconGuides = makeIcon(
  'IconGuides',
  <>
    <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
    <rect x="6.5" y="8" width="11" height="8" rx="0.5" stroke-dasharray="2 2" />
  </>
);
export const IconCrosshair = makeIcon(
  'IconCrosshair',
  <>
    <path d="M12 3v5M12 16v5M3 12h5M16 12h5" />
    <circle cx="12" cy="12" r="3" />
  </>
);
export const IconGridOverlay = makeIcon(
  'IconGridOverlay',
  <>
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </>
);
export const IconStop = makeIcon(
  'IconStop',
  <rect x="6" y="6" width="12" height="12" rx="1" />
);
export const IconLink = makeIcon(
  'IconLink',
  <>
    <path d="M10 13.5a3.5 3.5 0 005 0l3-3a3.5 3.5 0 00-5-5l-1 1" />
    <path d="M14 10.5a3.5 3.5 0 00-5 0l-3 3a3.5 3.5 0 005 5l1-1" />
  </>
);
export const IconReset = makeIcon(
  'IconReset',
  <>
    <path d="M4 12a8 8 0 1013.7-5.7L20 8" />
    <path d="M20 3v5h-5" />
  </>
);
export const IconPencil = makeIcon(
  'IconPencil',
  <>
    <path d="M4 20h4L19.5 8.5a2.12 2.12 0 00-3-3L5 17v3z" />
    <path d="M14.5 6.5l3 3" />
  </>
);
export const IconCrop = makeIcon(
  'IconCrop',
  <>
    <path d="M6 2v16h16" />
    <path d="M2 6h16v16" />
  </>
);
export const IconSliders = makeIcon(
  'IconSliders',
  <>
    <path d="M4 7h5M13 7h7" />
    <path d="M4 12h9M17 12h3" />
    <path d="M4 17h3M11 17h9" />
    <circle cx="11" cy="7" r="2" />
    <circle cx="15" cy="12" r="2" />
    <circle cx="9" cy="17" r="2" />
  </>
);
export const IconMaximizePanel = makeIcon(
  'IconMaximizePanel',
  <>
    <path d="M4 9V5.5A1.5 1.5 0 015.5 4H9" />
    <path d="M15 4h3.5A1.5 1.5 0 0120 5.5V9" />
    <path d="M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15" />
    <path d="M9 20H5.5A1.5 1.5 0 014 18.5V15" />
  </>
);

/**
 * The MotionForge emblem — a geometric "MF" mark built from vector paths.
 */
export const MotionForgeMark: Component<{ size?: number; class?: string }> = (props) => {
  const size = () => props.size ?? 16;
  const attributes: JSX.SvgSVGAttributes<SVGSVGElement> = {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    width: size(),
    height: size(),
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.75',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    class: props.class,
    'aria-hidden': 'true',
  };
  return (
    <svg {...attributes}>
      <path d="M3 20V4h4.5l4.5 7 4.5-7H21v16" />
      <path d="M3 20h18" />
      <path d="M12 11v9" />
    </svg>
  );
};
(MotionForgeMark as unknown as { displayName?: string }).displayName = 'MotionForgeMark';
