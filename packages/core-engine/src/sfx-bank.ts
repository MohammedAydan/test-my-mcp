import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import type { EnginePaths } from "./config.js";

/**
 * The fixed SFX bank. Files are synthesized once with FFmpeg (deterministic,
 * idempotent) and cached in the vault; drop a higher-quality file with the same
 * name to replace any bank entry. Provenance is documented in docs/01_ARCHITECTURE.md.
 *
 * SOUND DESIGN (v2). The first bank was a set of test tones: `shimmer` was a
 * 2.6 kHz sine carrying a 9 Hz tremolo — a piercing `BEEEEP` audible across the
 * whole scene — and `click` was white noise high-passed at 1.8 kHz, i.e.
 * un-filtered static. Every entry is now warm, low-passed and musical:
 *
 *   shimmer   ambient pad swell — 196/294/392 Hz partials over a brown-noise bed,
 *             low-passed at 850 Hz, peak −14 dBFS, no unmodulated HF tone
 *   riser     air swell         — band-passed pink noise, centroid 120 → 550 Hz
 *   whoosh    air pass          — band-passed pink noise, 140 → 450 → 130 Hz
 *   subImpact sub-bass thud     — 95 → 40 Hz exponential pitch drop
 *   pop/click tactile UI taps   — < 400 Hz transient, peak −10 dBFS
 *
 * The sweeps are built from LAYERED, TIME-VARYING GAINS rather than a
 * time-varying filter: FFmpeg's `bandpass`/`lowpass` do not evaluate their
 * options per frame, but `volume` does (`eval=frame`), so each band is a fixed
 * filter whose gain ramps in on its own schedule. `anoisesrc` is pinned with
 * `seed=0` — an unpinned noise source made every render of the same scene sound
 * different.
 */

/** A 0 → 1 → 0 gain ramp: rises over `rise` s from `t0`, falls over `fall` s into `t1`. */
const ramp = (t0: number, rise: number, t1: number, fall: number): string =>
  `min(1,max(0,(t-${t0})/${rise}))*min(1,max(0,(${t1}-t)/${fall}))`;

/** Chain `n` labelled streams into one mix, then apply `tail`. */
const mix = (n: number, normalize: boolean, tail: string): string =>
  Array.from({ length: n }, (_, i) => `[v${i}]`).join("") +
  `amix=inputs=${n}:normalize=${normalize ? 1 : 0},${tail}`;

export interface SfxDefinition {
  name: string;
  /** FFmpeg lavfi source + filter graph that synthesizes the sample */
  args: string[];
}

const NOISE_BED = "anoisesrc=color=brown:duration=1.6:seed=0";

export const SFX_BANK: SfxDefinition[] = [
  {
    name: "shimmer",
    args: [
      "-f", "lavfi", "-i", "sine=frequency=196:duration=1.6",
      "-f", "lavfi", "-i", "sine=frequency=294:duration=1.6",
      "-f", "lavfi", "-i", "sine=frequency=392:duration=1.6",
      "-f", "lavfi", "-i", NOISE_BED,
      "-filter_complex",
      [
        "[0:a]volume=0.40[v0];",
        "[1:a]volume=0.30[v1];",
        "[2:a]volume=0.28[v2];",
        "[3:a]volume=0.16[v3];",
        mix(
          4,
          false,
          "lowpass=f=850,afade=t=in:d=0.55,afade=t=out:st=0.95:d=0.65,volume=0dB[out]"
        ),
      ].join(""),
      "-map", "[out]", "-t", "1.6",
    ],
  },
  {
    name: "riser",
    args: [
      ...[120, 210, 330, 450, 550].flatMap((f) => [
        "-f", "lavfi", "-i", `anoisesrc=color=pink:d=1.6:seed=0`,
      ]),
      "-filter_complex",
      [120, 210, 330, 450, 550]
        .map(
          (f, i) =>
            `[${i}:a]bandpass=frequency=${f}:width_type=h:width=80,volume='${ramp(
              [0, 0.26, 0.52, 0.78, 1.04][i]!,
              0.3,
              1.6,
              0.55
            )}':eval=frame[v${i}]`
        )
        .join(";") +
        ";" +
        mix(5, true, "lowpass=f=900,afade=t=out:st=1.05:d=0.55,volume=9.4dB[out]"),
      "-map", "[out]", "-t", "1.6",
    ],
  },
  {
    name: "whoosh",
    args: [
      ...[140, 260, 380, 450].flatMap((f) => [
        "-f", "lavfi", "-i", `anoisesrc=color=pink:d=0.9:seed=0`,
      ]),
      "-filter_complex",
      [140, 260, 380, 450]
        .map((f, i) => {
          const on = [0, 0.1, 0.2, 0.3][i]!;
          const off = [0.9, 0.8, 0.7, 0.6][i]!;
          return `[${i}:a]bandpass=frequency=${f}:width_type=h:width=80,volume='${ramp(
            on,
            0.25,
            off,
            off - 0.25
          )}':eval=frame[v${i}]`;
        })
        .join(";") +
        ";" +
        mix(4, true, "lowpass=f=850,afade=t=out:st=0.6:d=0.3,volume=11.8dB[out]"),
      "-map", "[out]", "-t", "0.9",
    ],
  },
  {
    name: "subImpact",
    args: [
      ...[95, 74, 56, 40].flatMap((f) => ["-f", "lavfi", "-i", `sine=frequency=${f}:duration=0.9`]),
      "-filter_complex",
      [
        ramp(0, 0.012, 0.22, 0.22),
        ramp(0.02, 0.06, 0.42, 0.3),
        ramp(0.06, 0.06, 0.62, 0.35),
        ramp(0.1, 0.06, 0.9, 0.4),
      ]
        .map((env, i) => `[${i}:a]volume='${env}':eval=frame[v${i}]`)
        .join(";") +
        ";" +
        mix(4, true, "lowpass=f=240,afade=t=out:st=0.72:d=0.18,volume=8dB[out]"),
      "-map", "[out]", "-t", "0.9",
    ],
  },
  {
    name: "pop",
    args: [
      "-f", "lavfi", "-i", "sine=frequency=320:duration=0.18",
      "-f", "lavfi", "-i", "anoisesrc=color=brown:duration=0.18:seed=0",
      "-filter_complex",
      [
        "[0:a]volume=0.85[v0];",
        "[1:a]volume=0.22[v1];",
        mix(2, false, "lowpass=f=400,afade=t=out:st=0.015:d=0.165,volume=5.7dB[out]"),
      ].join(""),
      "-map", "[out]", "-t", "0.18",
    ],
  },
  {
    name: "click",
    args: [
      "-f", "lavfi", "-i", "sine=frequency=260:duration=0.08",
      "-f", "lavfi", "-i", "anoisesrc=color=brown:duration=0.08:seed=0",
      "-filter_complex",
      [
        "[0:a]volume=0.85[v0];",
        "[1:a]volume=0.20[v1];",
        mix(2, false, "lowpass=f=400,afade=t=out:st=0.008:d=0.072,volume=8.3dB[out]"),
      ].join(""),
      "-map", "[out]", "-t", "0.08",
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
