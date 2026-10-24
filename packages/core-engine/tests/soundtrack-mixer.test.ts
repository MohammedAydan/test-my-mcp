import { describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runFfmpeg } from "../src/encoder.js";
import { resolveEnginePaths } from "../src/config.js";
import { SoundtrackMixerService } from "../src/soundtrack-mixer.js";
import { vaultFilePath } from "../src/vault.js";

describe("SoundtrackMixerService", () => {
  it("mixes narration and procedural ambient pad with sidechain ducking", async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "motionforge-soundtrack-test-"));
    const paths = resolveEnginePaths({
      vaultDir: path.join(tmpDir, "vault"),
      dataDir: path.join(tmpDir, "data"),
      rendersDir: path.join(tmpDir, "renders"),
    });

    await fsp.mkdir(paths.vaultDir, { recursive: true });

    // Create a mock 3-second speech audio in vault
    const narrationName = "speech-test.wav";
    const narrationPath = vaultFilePath(paths, narrationName);
    await runFfmpeg(
      [
        "-f", "lavfi",
        "-i", "sine=frequency=300:duration=3.0",
        "-c:a", "pcm_s16le",
        narrationPath,
      ],
      "create mock speech audio"
    );

    const mixer = new SoundtrackMixerService(paths);
    const result = await mixer.mixSceneSoundtrack({
      narrationSrc: `vault:${narrationName}`,
      durationSec: 3.0,
      outputName: "mixed-soundtrack",
      duckingDb: -6,
      targetLufs: -17,
      ceilingDbTP: -1.5,
    });

    expect(result.durationSec).toBeCloseTo(3.0, 1);
    expect(result.durationMs).toBeGreaterThan(2800);
    expect(result.vaultSrc).toContain("vault:mixed-soundtrack.wav");
    expect(result.measuredLufs).toBeLessThan(-10); // Loudness properly normalized

    // Verify output file exists
    const fileExists = await fsp.access(result.outputPath).then(() => true).catch(() => false);
    expect(fileExists).toBe(true);

    // Clean up
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }, 25000);
});
