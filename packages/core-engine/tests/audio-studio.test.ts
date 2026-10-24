import { describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AudioStudioService,
  balanceSubtitleLines,
  formatSrtTime,
  generateSrtContent,
  type SubtitleCue,
} from "../src/audio-studio.js";
import { resolveEnginePaths } from "../src/config.js";

describe("AudioStudioService & Subtitle Utilities", () => {
  describe("formatSrtTime", () => {
    it("formats 0 ms correctly", () => {
      expect(formatSrtTime(0)).toBe("00:00:00,000");
    });

    it("formats milliseconds into HH:MM:SS,mmm with millisecond zero padding", () => {
      // 1 hour, 2 minutes, 3 seconds, 45 milliseconds
      const ms = 1 * 3600000 + 2 * 60000 + 3 * 1000 + 45;
      expect(formatSrtTime(ms)).toBe("01:02:03,045");
    });

    it("handles large timestamps", () => {
      // 12 hours, 34 minutes, 56 seconds, 789 ms
      const ms = 12 * 3600000 + 34 * 60000 + 56 * 1000 + 789;
      expect(formatSrtTime(ms)).toBe("12:34:56,789");
    });
  });

  describe("balanceSubtitleLines", () => {
    it("returns single line when words fit in maxLineChars", () => {
      const words = ["Welcome", "to", "MotionForge."];
      const lines = balanceSubtitleLines(words, 42);
      expect(lines).toEqual(["Welcome to MotionForge."]);
    });

    it("splits into at most two balanced lines", () => {
      const words = [
        "In", "the", "heart", "of", "the", "ancient", "city,",
        "whispers", "of", "a", "forgotten", "empire", "emerged."
      ];
      const lines = balanceSubtitleLines(words, 42);
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(42);
      }
    });

    it("balances length between line 1 and line 2 cleanly", () => {
      const words = ["This", "is", "line", "one", "and", "this", "is", "line", "two."];
      const lines = balanceSubtitleLines(words, 25);
      expect(lines).toHaveLength(2);
      expect(lines[0]!.length).toBeLessThanOrEqual(25);
      expect(lines[1]!.length).toBeLessThanOrEqual(25);
    });
  });

  describe("generateSrtContent", () => {
    it("generates valid SRT formatted string", () => {
      const cues: SubtitleCue[] = [
        {
          index: 1,
          startMs: 0,
          endMs: 2500,
          startTime: "00:00:00,000",
          endTime: "00:00:02,500",
          lines: ["Welcome to MotionForge.", "Programmatic motion graphics."],
        },
        {
          index: 2,
          startMs: 2500,
          endMs: 5000,
          startTime: "00:00:02,500",
          endTime: "00:00:05,000",
          lines: ["Built for autonomous AI agents."],
        },
      ];

      const srt = generateSrtContent(cues);
      expect(srt).toContain("1\n00:00:00,000 --> 00:00:02,500\nWelcome to MotionForge.\nProgrammatic motion graphics.");
      expect(srt).toContain("2\n00:00:02,500 --> 00:00:05,000\nBuilt for autonomous AI agents.");
    });
  });

  describe("synthesizeNarrationAndSubtitles", () => {
    it("synthesizes audio, masters to 48kHz, and generates balanced subtitles", async () => {
      const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "motionforge-audio-test-"));
      const paths = resolveEnginePaths({
        vaultDir: path.join(tmpDir, "vault"),
        dataDir: path.join(tmpDir, "data"),
        rendersDir: path.join(tmpDir, "renders"),
      });

      const service = new AudioStudioService(paths);
      const result = await service.synthesizeNarrationAndSubtitles({
        text: "The dawn of a new era in motion graphics has arrived. Everything is automated.",
        outputName: "test-narration",
      });

      expect(result.durationSec).toBeGreaterThan(0.5);
      expect(result.durationMs).toBeGreaterThan(500);
      expect(result.cues.length).toBeGreaterThan(0);
      expect(result.vaultSrc).toContain("vault:test-narration.wav");
      expect(result.srtContent).toContain("-->");

      // Verify each subtitle line is <= 42 chars
      for (const cue of result.cues) {
        expect(cue.lines.length).toBeLessThanOrEqual(2);
        for (const line of cue.lines) {
          expect(line.length).toBeLessThanOrEqual(42);
        }
      }

      // Verify files exist on disk
      const audioExists = await fsp.access(result.audioPath).then(() => true).catch(() => false);
      const srtExists = await fsp.access(result.srtPath).then(() => true).catch(() => false);
      expect(audioExists).toBe(true);
      expect(srtExists).toBe(true);

      // Clean up tmp dir
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }, 20000);
  });
});
