// ============================================================
// MotionForge Studio — Scene Templates
// Pre-built SceneSpec skeletons with sensible defaults
// ============================================================

export const SCENE_TEMPLATES = [
  {
    id: 'blank',
    name: 'Blank 16:9 Canvas',
    description: 'A clean slate with a dark neutral background, ready for custom motion graphics.',
    spec: {
      schemaVersion: 1,
      name: 'Blank 16:9',
      canvas: { shape: '16:9', scale: 1080 },
      durationMs: 8000,
      assets: [],
      fonts: [],
      layers: [
        {
          id: 'bg',
          type: 'background',
          variant: { variant: 'solid', color: '#0a0a0f' },
        },
      ],
      camera: {
        keyframes: [{ at: 0, scale: 1, xPct: 50, yPct: 50 }],
      },
    },
  },
  {
    id: 'title-card',
    name: 'Cinematic Title Card',
    description: 'Hero title and subtitle with kinetic text spring reveal and camera push.',
    spec: {
      schemaVersion: 1,
      name: 'Cinematic Title Card',
      canvas: { shape: '16:9', scale: 1080 },
      durationMs: 6000,
      assets: [],
      fonts: [],
      layers: [
        {
          id: 'bg',
          type: 'background',
          variant: { variant: 'solid', color: '#0a0a0f' },
        },
        {
          id: 'title',
          type: 'kineticText',
          at: 300,
          duration: 5000,
          text: 'MOTIONFORGE',
          sizePx: 120,
          position: { xPct: 50, yPct: 45 },
          fill: '#f1f5f9',
          animateBy: 'word',
          entrance: { name: 'springPop', durationMs: 800 },
          exit: { name: 'scaleDownFade', durationMs: 500 },
        },
        {
          id: 'subtitle',
          type: 'kineticText',
          at: 800,
          duration: 4500,
          text: 'Next-Generation Programmatic Video',
          sizePx: 36,
          position: { xPct: 50, yPct: 60 },
          fill: '#f59e0b',
          animateBy: 'word',
          entrance: { name: 'smoothSlideUp', durationMs: 600 },
          exit: { name: 'scaleDownFade', durationMs: 500 },
        },
      ],
      camera: {
        keyframes: [
          { at: 0, scale: 1, xPct: 50, yPct: 50 },
          { at: 5000, scale: 1.08, xPct: 50, yPct: 50, ease: 'power2.out' },
        ],
      },
    },
  },
  {
    id: 'social-square',
    name: 'Social Square (1:1)',
    description: 'Square 1080x1080 canvas optimized for Instagram and LinkedIn feeds.',
    spec: {
      schemaVersion: 1,
      name: 'Social Square',
      canvas: { shape: '1:1', scale: 1080 },
      durationMs: 7000,
      assets: [],
      fonts: [],
      layers: [
        {
          id: 'bg',
          type: 'background',
          variant: { variant: 'solid', color: '#101017' },
        },
        {
          id: 'callout',
          type: 'card',
          at: 400,
          duration: 6000,
          position: { xPct: 50, yPct: 50 },
          variant: {
            variant: 'callout',
            title: 'Highlight Reel',
            body: 'Showcase key product metrics and statistics.',
            accentColor: '#14b8a6',
            widthPx: 700,
            paddingPx: 32,
            radiusPx: 14,
          },
          entrance: { name: 'springPop', durationMs: 700 },
        },
      ],
    },
  },
  {
    id: 'vertical-story',
    name: 'Vertical Story (9:16)',
    description: 'Vertical 1080x1920 canvas optimized for Reels, TikTok, and Shorts.',
    spec: {
      schemaVersion: 1,
      name: 'Vertical Story',
      canvas: { shape: '9:16', scale: 1080 },
      durationMs: 8000,
      assets: [],
      fonts: [],
      layers: [
        {
          id: 'bg',
          type: 'background',
          variant: { variant: 'solid', color: '#0a0a0f' },
        },
        {
          id: 'headline',
          type: 'kineticText',
          at: 400,
          duration: 7000,
          text: 'Swipe Up for Details',
          sizePx: 72,
          position: { xPct: 50, yPct: 40 },
          fill: '#f59e0b',
          animateBy: 'word',
          entrance: { name: 'smoothSlideUp', durationMs: 700 },
        },
      ],
    },
  },
];
