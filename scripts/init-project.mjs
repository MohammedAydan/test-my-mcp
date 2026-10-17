#!/usr/bin/env node
/**
 * init-project — create a MotionForge creative project workspace.
 *
 *   npm run init-project -- --name "client-reel" --path "../jobs/client-reel"
 *                         [--lang ar|en|both] [--engine-url http://127.0.0.1:4000]
 *                         [--shape 16:9] [--scale 1080] [--force]
 *
 * Copies `templates/creative-project/`, substitutes the template tokens, writes a
 * validated `motionforge.project.json` and prints the exact next steps.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  validateProjectManifest,
  minimalProjectManifest,
} from "@motionforge/scene-spec";

import {
  TEMPLATE_DIR,
  containsToken,
  fail,
  heading,
  isEmptyDir,
  isTokenFile,
  listFiles,
  parseArgs,
  substituteTokens,
} from "./_project-kit.mjs";

const USAGE = `init-project — scaffold a MotionForge creative project

  --name <slug>          project name (used in tokens + manifest)   [required]
  --path <dir>           target directory (created if missing)       [required]
  --lang <ar|en|both>    primary language                            [default: ar]
  --engine-url <url>     core-engine base URL           [default: http://127.0.0.1:4000]
  --shape <16:9|9:16|1:1|4:5>                                 [default: 16:9]
  --scale <720|1080|1440|2160>                                 [default: 1080]
  --force                overwrite a non-empty target directory
  --help                 show this message
`;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const name = typeof args.name === "string" ? args.name.trim() : "";
const targetArg = typeof args.path === "string" ? args.path.trim() : "";
if (!name) fail(`--name is required\n\n${USAGE}`);
if (!targetArg) fail(`--path is required\n\n${USAGE}`);

const lang = args.lang ?? "ar";
if (!["ar", "en", "both"].includes(lang)) fail(`--lang must be ar, en or both (got "${lang}")`);

const engineUrl = args["engine-url"] ?? "http://127.0.0.1:4000";
const shape = args.shape ?? "16:9";
const scale = Number(args.scale ?? 1080);
if (!["16:9", "9:16", "1:1", "4:5"].includes(shape)) fail(`--shape must be 16:9, 9:16, 1:1 or 4:5 (got "${shape}")`);
if (![720, 1080, 1440, 2160].includes(scale)) fail(`--scale must be 720, 1080, 1440 or 2160 (got "${scale}")`);

const target = path.resolve(process.cwd(), targetArg);

// ---------------------------------------------------------------------------
// guard: never clobber someone's work
// ---------------------------------------------------------------------------
if (!(await isEmptyDir(target))) {
  if (!args.force) {
    fail(
      `${target} is not empty.\n` +
        "  init-project will not overwrite an existing workspace.\n" +
        "  Pick another --path, or re-run with --force to overwrite the template files."
    );
  }
  console.warn(`⚠ --force: overwriting template files in ${target}`);
}

await mkdir(target, { recursive: true });

// ---------------------------------------------------------------------------
// copy + substitute
// ---------------------------------------------------------------------------
const tokens = {
  PROJECT_NAME: name,
  CREATED_AT: new Date().toISOString(),
  LANG: lang,
  ENGINE_URL: engineUrl.replace(/\/+$/, ""),
};

const files = await listFiles(TEMPLATE_DIR);
let copied = 0;
let substituted = 0;
const leftovers = [];

for (const rel of files) {
  const from = path.join(TEMPLATE_DIR, rel);
  const to = path.join(target, rel);
  await mkdir(path.dirname(to), { recursive: true });

  if (isTokenFile(rel)) {
    const raw = await readFile(from, "utf8");
    const text = substituteTokens(raw, tokens);
    if (text !== raw) substituted += 1;
    if (containsToken(text)) leftovers.push(rel);
    await writeFile(to, text, "utf8");
  } else {
    await writeFile(to, await readFile(from));
  }
  copied += 1;
}

if (leftovers.length > 0) {
  fail(`template tokens were left unsubstituted in:\n  ${leftovers.join("\n  ")}`);
}

// ---------------------------------------------------------------------------
// manifest: written from the schema, then validated as written
// ---------------------------------------------------------------------------
const manifest = minimalProjectManifest({
  name,
  createdAt: tokens.CREATED_AT,
  engineUrl: tokens.ENGINE_URL,
  canvas: { shape, scale },
  language: lang,
});
const validation = validateProjectManifest(manifest);
if (!validation.ok) {
  fail(`generated manifest is invalid:\n  ${validation.issues.join("\n  ")}`);
}
const manifestPath = path.join(target, "motionforge.project.json");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
heading(`MotionForge project created: ${name}`);
console.log(`  path        ${target}`);
console.log(`  files       ${copied} (${substituted} token-substituted)`);
console.log(`  manifest    ${path.relative(target, manifestPath)} (validated)`);
console.log(`  engine      ${tokens.ENGINE_URL}`);
console.log(`  language    ${lang}   canvas ${shape} @ ${scale}`);

heading("Next steps");
console.log(`  1. Start the engine (from the engine checkout):`);
console.log(`       npm run dev -w @motionforge/core-engine`);
console.log(`  2. Point your MCP client at this folder: ${target}`);
console.log(`  3. Read the brief and fill it in:`);
console.log(`       ${path.join(target, "brief/BRIEF.md")}`);
console.log(`  4. Write the brief, then author the first scene:`);
console.log(`       ${path.join(target, "scenes/scene-01.json")}`);
console.log(`  5. Push it to the engine (validates locally first):`);
console.log(`       npm run sync-scene -- --project ${targetArg} --file scenes/scene-01.json`);
console.log(`  6. Preview it:`);
console.log(`       ${tokens.ENGINE_URL}/preview/?scene=scene-01`);
console.log(`\n  Agent manual for this workspace: ${path.join(target, "AGENTS.md")}\n`);
