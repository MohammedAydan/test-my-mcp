/**
 * Regenerates the template's SceneSpec JSON from the scene-spec constants, so
 * the shipped files are byte-identical to what the engine considers valid.
 *
 *   npm run sync-template-scenes
 *
 * Plain JS on purpose: every script in `scripts/` is a `.mjs` file run through
 * `node --import tsx` (see the root package.json), which lets them import the
 * TypeScript sources of `@motionforge/scene-spec` without a build step.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MINIMAL_VALID_SCENE, SHOWCASE_SCENE_SKETCH, validateScene } from "@motionforge/scene-spec";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SCENES_DIR = path.join(ROOT, "templates/creative-project/scenes");

/**
 * The working scene a new job starts from: bilingual hero, camera push-in and
 * an SFX cue. It carries a `{{PROJECT_NAME}}` token in the human labels so
 * `init-project` substitutes them — layer `name` is free text, so the file
 * stays a valid SceneSpec before AND after substitution.
 */
const STARTER_SCENE = {
  schemaVersion: 1,
  // The project convention is `scenes/<id>.json`: the manifest, `sync-scene`
  // and the engine all read the scene's id FROM THE FILE NAME, so the
  // template has to carry the same id or the starter scene lands in the
  // engine under a slug of its title.
  id: "scene-01",
  name: "{{PROJECT_NAME}} — scene 01",
  canvas: { shape: "16:9", scale: 1080 },
  durationMs: 8000,
  fonts: [
    { role: "hero", family: "Cairo", provider: "google", weights: [700, 900] },
    { role: "body", family: "Inter", provider: "google", weights: [400, 600] },
  ],
  layers: [
    {
      id: "bg",
      type: "background",
      variant: {
        variant: "meshGradient",
        base: "#05070d",
        blobs: [
          { color: "#1d3a8a", xPct: 22, yPct: 28, radiusPct: 58, drift: 0.4 },
          { color: "#0e7490", xPct: 78, yPct: 62, radiusPct: 52, drift: 0.28 },
        ],
      },
    },
    {
      id: "hero-ar",
      name: "{{PROJECT_NAME}} — hero title (AR)",
      type: "kineticText",
      at: 500,
      text: "اكتب عنوانك هنا",
      direction: "rtl",
      role: "hero",
      googleFamily: "Cairo",
      sizePx: 92,
      position: { xPct: 50, yPct: 42 },
      fill: "#ffffff",
      animateBy: "word",
      entrance: { name: "blurFadeIn", staggerMs: 140 },
      sfx: [{ sfx: "whoosh", offsetMs: 0 }],
    },
    {
      id: "hero-en",
      name: "{{PROJECT_NAME}} — hero title (EN)",
      type: "kineticText",
      at: 1500,
      text: "Your headline here",
      sizePx: 44,
      position: { xPct: 50, yPct: 56 },
      fill: "#93c5fd",
      entrance: { name: "smoothSlideUp", staggerMs: 90 },
    },
    {
      id: "fgx",
      type: "foregroundFX",
      effects: [
        { kind: "vignette", strength: 0.5 },
        { kind: "filmGrain", opacity: 0.05 },
      ],
    },
  ],
  camera: {
    keyframes: [
      { at: 0, scale: 1 },
      { at: 7000, scale: 1.18, ease: "power3.inOut" },
    ],
    drift: { amplitudePct: 0.4, periodMs: 5200 },
  },
  transitions: [
    { kind: "wipe", at: 6900, direction: "left", durationMs: 700, color: "#05070d" },
  ],
  audio: { cues: [{ at: 1500, sfx: "click" }] },
};

/** Pretty-print with a trailing newline; refuse to write anything invalid. */
async function writeScene(file, scene) {
  const validation = validateScene(scene);
  if (!validation.ok) {
    throw new Error(`${file} is not a valid SceneSpec:\n  ${validation.issues.join("\n  ")}`);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(scene, null, 2)}\n`, "utf8");
  console.log(`wrote ${path.relative(ROOT, file)} — valid SceneSpec`);
}

await writeScene(path.join(SCENES_DIR, "_templates/minimal-valid-scene.json"), MINIMAL_VALID_SCENE);
await writeScene(path.join(SCENES_DIR, "_templates/showcase-sketch.json"), SHOWCASE_SCENE_SKETCH);
await writeScene(path.join(SCENES_DIR, "scene-01.json"), STARTER_SCENE);
