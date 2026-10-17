import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { promisify } from "node:util";

import type { EngineConfig } from "./config.js";
import { availableEncoders } from "./encoder.js";
import { missingSfxFiles } from "./sfx-bank.js";

const exec = promisify(execFile);

export interface DoctorReport {
  ok: boolean;
  ffmpegVersion?: string;
  encoders: string[];
  chromium: { found: boolean; version?: string };
  sfxBankComplete: boolean;
  missingSfx: string[];
  runtimeDist: { found: boolean; note?: string };
  problems: string[];
}

/**
 * Verifies the toolchain once: FFmpeg (+encoders), Playwright Chromium, the SFX
 * bank, and the built scene-runtime bundle.
 */
export async function doctor(config: EngineConfig): Promise<DoctorReport> {
  const problems: string[] = [];

  let ffmpegVersion: string | undefined;
  try {
    const { stdout } = await exec("ffmpeg", ["-version"]);
    ffmpegVersion = stdout.split("\n")[0]?.trim();
  } catch {
    problems.push("ffmpeg not found on PATH (FFmpeg 6.x required)");
  }

  let encoders: string[] = [];
  try {
    encoders = await availableEncoders();
    if (encoders.length === 0) problems.push("no H.264 encoders available in ffmpeg");
  } catch {
    problems.push("could not query ffmpeg encoders");
  }

  let chromium = { found: false, version: undefined as string | undefined };
  try {
    const pw = await import("playwright");
    chromium.version = pw.chromium.name();
    // actually launch — a missing browser binary must fail here, not mid-render
    const b = await pw.chromium.launch({ headless: true });
    await b.close();
    chromium.found = true;
  } catch (e) {
    problems.push("Playwright Chromium failed to launch (run `npx playwright install chromium`): " + (e instanceof Error ? e.message : String(e)));
  }

  const missingSfx = missingSfxFiles(config.paths);
  const sfxBankComplete = missingSfx.length === 0;
  if (existsSync(config.paths.sfxDir) === false && missingSfx.length > 0) {
    // bank is synthesized at engine boot; here it is only an inventory check
  }

  const distBundle = `${config.paths.runtimeDistDir}/index.html`;
  const distIndexExists = existsSync(distBundle);
  if (!distIndexExists) {
    problems.push(
      "scene-runtime not built — run `npm run build -w @motionforge/scene-runtime` (preview + render depend on it)"
    );
  }
  if (distIndexExists) {
    const size = statSync(distBundle).size;
    if (size === 0) problems.push("scene-runtime dist/index.html is empty; rebuild the runtime");
  }

  return {
    ok: problems.length === 0,
    ffmpegVersion,
    encoders,
    chromium,
    sfxBankComplete,
    missingSfx,
    runtimeDist: {
      found: distIndexExists,
      note: distIndexExists ? undefined : "npm run build -w @motionforge/scene-runtime",
    },
    problems,
  };
}
