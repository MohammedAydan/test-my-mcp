#!/usr/bin/env node
/**
 * pull-render — fetch a finished render from core-engine into the project.
 *
 *   npm run pull-render -- --project <dir> --jobId <id> [--quality draft|production]
 *
 * The engine holds renders in its own data directory; this copies the MP4 into
 * `<project>/renders/<quality>/<sceneId>-<timestamp>.mp4` so the deliverable
 * sits next to the scene that produced it. `--quality` decides the destination
 * folder and must match the job's quality (it defaults to the job's own).
 */
import path from "node:path";

import { validateProjectManifest } from "@motionforge/scene-spec";
// the shared implementation — the CLI and the MCP tool must never diverge on
// where a render is filed or what the manifest says afterwards
import { saveRenderToDisk } from "@motionforge/core-engine/project-workspace";

import { fail, heading, parseArgs, readManifest } from "./_project-kit.mjs";

const USAGE = `pull-render — download a finished render into the project

  --project <dir>        project root (contains motionforge.project.json) [required]
  --jobId <id>           render job id from render_video                          [required]
  --quality <draft|production>  destination folder [default: the job's own quality]
  --engine-url <url>     override the engine URL from the manifest
  --help
`;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const projectArg = typeof args.project === "string" ? args.project.trim() : "";
const jobId = typeof args.jobId === "string" ? args.jobId.trim() : "";
if (!projectArg) fail(`--project is required\n\n${USAGE}`);
if (!jobId) fail(`--jobId is required\n\n${USAGE}`);

const projectDir = path.resolve(process.cwd(), projectArg);
const manifestRaw = await readManifest(projectDir);
const manifestCheck = validateProjectManifest(manifestRaw);
if (!manifestCheck.ok) {
  fail(
    `motionforge.project.json is invalid:\n  ${manifestCheck.issues.join("\n  ")}\n` +
      "  Fix the manifest before pulling renders."
  );
}
const baseUrl = (typeof args["engine-url"] === "string" ? args["engine-url"] : manifestCheck.manifest.engine.url)
  .replace(/\/+$/, "");

// ---------------------------------------------------------------------------
// job status
// ---------------------------------------------------------------------------
let job;
try {
  const res = await fetch(`${baseUrl}/api/renders/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    fail(`core-engine ${res.status}: ${body.error ?? "unknown render job"}`);
  }
  job = await res.json();
} catch (error) {
  fail(`could not reach core-engine at ${baseUrl}: ${error.message}`);
}

if (job.status !== "succeeded") {
  heading(`render ${jobId} is ${job.status}`);
  if (job.error) console.log(`  error       ${job.error}`);
  if (job.progress !== undefined) console.log(`  progress    ${(job.progress * 100).toFixed(0)}%`);
  console.log(`\n  Wait for it to finish, then re-run pull-render with the same --jobId.\n`);
  process.exit(1);
}

const quality = args.quality ?? job.quality;
if (!["draft", "production"].includes(quality)) {
  fail(`--quality must be draft or production (got "${quality}")`);
}
if (quality !== job.quality) {
  console.warn(`⚠ job ${jobId} was rendered as "${job.quality}" — filing it under renders/${quality}/`);
}

// ---------------------------------------------------------------------------
// download + file
// ---------------------------------------------------------------------------
let bytes;
try {
  const res = await fetch(`${baseUrl}/api/renders/${encodeURIComponent(jobId)}/file`);
  if (!res.ok) fail(`download failed: core-engine ${res.status} (is the render file still present?)`);
  bytes = Buffer.from(await res.arrayBuffer());
} catch (error) {
  if (String(error).includes("core-engine")) throw error;
  fail(`could not download the render: ${error.message}`);
}

if (bytes.length === 0) fail("core-engine returned an empty file — refusing to write a zero-byte MP4");

// the shared helper writes the timestamped copy, the `-latest.mp4` copy and
// bumps the manifest status in one atomic-ish step
const saved = await saveRenderToDisk(projectDir, job.sceneId, quality, bytes);

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
const result = job.result ?? {};
heading(`render ${jobId} saved`);
console.log(`  file        ${saved.file}`);
console.log(`  latest      ${saved.latest}`);
console.log(`  size        ${(bytes.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`  scene       ${job.sceneId} (${quality})`);
console.log(`  manifest    status "${saved.status}"`);
if (result.profile) {
  console.log(`  profile     ${result.profile.outWidth}x${result.profile.outHeight} @ ${result.profile.fps}fps`);
}
if (result.frames) {
  console.log(`  frames      ${result.frames}   wall ${((result.wallMs ?? 0) / 1000).toFixed(1)}s   encoder ${result.encoder}`);
}
if (quality === "production") {
  console.log(`\n  Copy the approved file to exports/client-delivery/ when the client signs off.`);
}
console.log("");
