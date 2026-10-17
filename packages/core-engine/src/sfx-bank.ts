import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import type { EnginePaths } from "./config.js";

/**
 * The fixed SFX bank. Files are synthesized once with FFmpeg (deterministic,
 * idempotent) and cached in the vault; drop a higher-quality file with the same
 * name to replace any bank entry. Provenance is documented in docs/01_ARCHITECTURE.md.
 */
export interface SfxDefinition {
  name: string;
  /** FFmpeg lavfi source + filter graph that synthesizes the sample */
  args: string[];
}

export const SFX_BANK: SfxDefinition[] = [
  {
    name: "whoosh",
    args: [
      "-f", "lavfi", "-i", "anoisesrc=color=pink:d=0.8:a=0.8",
      "-af", "lowpass=f=1000,highpass=f=120,afade=t=in:d=0.35,afade=t=out:st=0.45:d=0.35,volume=1.6",
    ],
  },
  {
    name: "pop",
    args: [
      "-f", "lavfi", "-i", "sine=frequency=520:duration=0.18",
      "-af", "afade=t=out:st=0.02:d=0.16,volume=2.2",
    ],
  },
  {
    name: "click",
    args: [
      "-f", "lavfi", "-i", "anoisesrc=color=white:d=0.06:a=0.5",
      "-af", "highpass=f=1800,volume=1.8",
    ],
  },
  {
    name: "subImpact",
    args: [
      "-f", "lavfi", "-i", "sine=frequency=52:duration=0.9",
      "-af", "afade=t=in:d=0.012,afade=t=out:st=0.1:d=0.79,volume=2.4",
    ],
  },
  {
    name: "shimmer",
    args: [
      "-f", "lavfi", "-i", "sine=frequency=2600:duration=1.2",
      "-af", "tremolo=f=9:d=0.6,afade=t=in:d=0.2,afade=t=out:st=0.6:d=0.6,volume=1.0",
    ],
  },
  {
    name: "riser",
    args: [
      "-f", "lavfi", "-i", "anoisesrc=color=brown:d=1.6:a=0.6",
      "-af", "lowpass=f=600,afade=t=in:d=1.45,volume=1.5",
    ],
  },
];

export function sfxFilePath(paths: EnginePaths, name: string): string {
  return path.join(paths.sfxDir, `${name}.ogg`);
}

export function missingSfxFiles(paths: EnginePaths): string[] {
  return SFX_BANK.map((s) => s.name).filter((n) => !existsSync(sfxFilePath(paths, n)));
}

/** Generate any missing bank files. Idempotent — safe to call at every boot. */
export async function ensureSfxBank(paths: EnginePaths, log?: (msg: string) => void): Promise<void> {
  await fsp.mkdir(paths.sfxDir, { recursive: true });
  for (const sfx of SFX_BANK) {
    const out = sfxFilePath(paths, sfx.name);
    if (existsSync(out)) continue;
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("ffmpeg", [...sfx.args, "-y", "-c:a", "libvorbis", "-q:a", "4", out]);
      let stderr = "";
      proc.stderr.on("data", (d) => (stderr += String(d)));
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) {
          log?.(`synthesized sfx "vault:_sfx/${sfx.name}.ogg"`);
          resolve();
        } else {
          reject(new Error(`ffmpeg failed synthesizing "${sfx.name}": ${stderr.slice(-400)}`));
        }
      });
    });
  }
}
