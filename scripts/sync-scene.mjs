#!/usr/bin/env node
/**
 * sync-scene — validate a scene file from disk and push it to core-engine.
 *
 *   npm run sync-scene -- --project <dir> --file scenes/scene-01.json
 *
 * The file is validated locally with the *same* schema the engine uses, so a
 * typo is reported as `layers.2.variant: Expected object, received string`
 * without a round trip. On success it prints the scene id and the live preview
 * URL, and the engine pushes an SSE update so any open preview refreshes.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { validateScene, validateProjectManifest } from "@motionforge/scene-spec";
// the shared implementation — the CLI and the MCP tool must never diverge on
// what "the scene is on disk" means
import { syncSceneToDisk } from "@motionforge/core-engine/project-workspace";

import { fail, heading, parseArgs, readManifest } from "./_project-kit.mjs";

const USAGE = `sync-scene — validate scenes/*.json and POST it to core-engine

  --project <dir>   project root (contains motionforge.project.json)  [required]
  --file <path>     scene file, relative to --project                  [required]
  --engine-url <url>  override the engine URL from the manifest
  --help
`;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const projectArg = typeof args.project === "string" ? args.project.trim() : "";
const fileArg = typeof args.file === "string" ? args.file.trim() : "";
if (!projectArg) fail(`--project is required\n\n${USAGE}`);
if (!fileArg) fail(`--file is required\n\n${USAGE}`);

const projectDir = path.resolve(process.cwd(), projectArg);

// ---------------------------------------------------------------------------
// project + engine resolution
// ---------------------------------------------------------------------------
const manifestRaw = await readManifest(projectDir);
const manifestCheck = validateProjectManifest(manifestRaw);
if (!manifestCheck.ok) {
  fail(
    `motionforge.project.json is invalid:\n  ${manifestCheck.issues.join("\n  ")}\n` +
      "  Fix the manifest before syncing scenes."
  );
}
const manifest = manifestCheck.manifest;
const baseUrl = (typeof args["engine-url"] === "string" ? args["engine-url"] : manifest.engine.url).replace(
  /\/+$/,
  ""
);

// ---------------------------------------------------------------------------
// read + validate locally (identical schema, identical issue format)
// ---------------------------------------------------------------------------
const scenePath = path.resolve(projectDir, fileArg);
if (!scenePath.startsWith(projectDir + path.sep)) {
  fail(`--file must stay inside the project directory (got "${fileArg}")`);
}

let raw;
try {
  raw = await readFile(scenePath, "utf8");
} catch {
  fail(`scene file not found: ${scenePath}`);
}
let json;
try {
  json = JSON.parse(raw);
} catch (error) {
  fail(`${fileArg} is not valid JSON: ${error.message}`);
}

const validation = validateScene(json);
if (!validation.ok) {
  heading(`${fileArg} — ${validation.issues.length} issue(s)`);
  for (const issue of validation.issues) console.log(`  - ${issue}`);
  console.log(`\n  Fix exactly these paths, then re-run. Nothing was sent to the engine.\n`);
  process.exit(1);
}

const scene = validation.scene;

// ---------------------------------------------------------------------------
// push
// ---------------------------------------------------------------------------
let response;
try {
  response = await fetch(`${baseUrl}/api/scenes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(scene),
  });
} catch (error) {
  fail(`could not reach core-engine at ${baseUrl}: ${error.message}\n  Start it with: npm run dev -w @motionforge/core-engine`);
}

const body = await response.json().catch(() => ({}));
if (!response.ok) {
  heading(`core-engine ${response.status}: ${body.error ?? "rejected"}`);
  for (const issue of body.issues ?? []) console.log(`  - ${issue}`);
  if (!body.issues) console.log(`  ${JSON.stringify(body)}`);
  console.log("");
  process.exit(1);
}

heading(`synced ${fileArg}`);
console.log(`  scene id    ${body.id}`);
console.log(`  layers      ${scene.layers.length}   duration ${(scene.durationMs / 1000).toFixed(2)}s`);
console.log(`  preview     ${baseUrl}/preview/?scene=${encodeURIComponent(body.id)}`);

// keep the project in sync: the scene file and the manifest entry are written
// by the SAME helper the MCP tool uses
const sync = await syncSceneToDisk(projectDir, { ...scene, id: body.id });
console.log(`  on disk     ${sync.file}${sync.created ? "  (new)" : "  (updated)"}`);
if (sync.manifestError) {
  console.log(`  ⚠ manifest  ${sync.manifestError}`);
}
for (const warning of body.warnings ?? []) {
  console.log(`  ⚠ ${warning.code}  ${warning.path}: ${warning.message}`);
}
console.log(`\n  Next: inspect_scene_keyframes (quality gate), then render_video draft.\n`);
