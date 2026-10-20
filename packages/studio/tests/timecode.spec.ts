import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FPS,
  formatDuration,
  formatFrameCount,
  formatTimecode,
  frameToMs,
  msToFrame,
} from '../src/state/timecode.js';

/**
 * SMPTE timecode.
 *
 * The Studio speaks milliseconds to the engine and timecode to the user, so
 * the conversion is pinned here: a wrong timecode is a professional credibility
 * problem, not a cosmetic one.
 */
describe('formatTimecode', () => {
  it('formats zero as 00:00:00:00', () => {
    expect(formatTimecode(0)).toBe('00:00:00:00');
  });

  it('formats one second at 30fps as 00:00:01:00', () => {
    expect(formatTimecode(1000)).toBe('00:00:01:00');
  });

  it('formats the frame remainder', () => {
    expect(formatTimecode(1000 / 30, 30)).toBe('00:00:00:01');
    expect(formatTimecode(1500, 30)).toBe('00:00:01:15');
  });

  it('formats minutes and hours', () => {
    expect(formatTimecode(61_000, 30)).toBe('00:01:01:00');
    expect(formatTimecode(3_661_000, 30)).toBe('01:01:01:00');
  });

  it('does NOT wrap the hours at 24', () => {
    expect(formatTimecode(25 * 3_600_000, 30)).toBe('25:00:00:00');
  });

  it('clamps a negative position to zero', () => {
    expect(formatTimecode(-5000)).toBe('00:00:00:00');
  });

  it('survives a non-finite position', () => {
    expect(formatTimecode(Number.NaN)).toBe('00:00:00:00');
    expect(formatTimecode(Number.POSITIVE_INFINITY)).toBe('00:00:00:00');
  });

  it('falls back to the default frame rate for a bogus one', () => {
    expect(formatTimecode(1000, 0)).toBe(formatTimecode(1000, DEFAULT_FPS));
    expect(formatTimecode(1000, Number.NaN)).toBe(formatTimecode(1000, DEFAULT_FPS));
  });

  it('respects a 60fps timeline', () => {
    expect(formatTimecode(1000, 60)).toBe('00:00:01:00');
    expect(formatTimecode(1000 / 60, 60)).toBe('00:00:00:01');
  });
});

describe('formatFrameCount', () => {
  it('formats the frame counter with the `f` suffix', () => {
    expect(formatFrameCount(0)).toBe('00000f');
    expect(formatFrameCount(1000, 30)).toBe('00030f');
    expect(formatFrameCount(21500, 30)).toBe('00645f');
  });

  it('is zero for a negative position', () => {
    expect(formatFrameCount(-100)).toBe('00000f');
  });
});

describe('formatDuration', () => {
  it('formats milliseconds as mm:ss.mmm', () => {
    expect(formatDuration(0)).toBe('00:00.000');
    expect(formatDuration(8500)).toBe('00:08.500');
    expect(formatDuration(61_250)).toBe('01:01.250');
  });
});

describe('frame <-> millisecond', () => {
  it('round-trips', () => {
    expect(msToFrame(1000, 30)).toBe(30);
    expect(frameToMs(30, 30)).toBe(1000);
  });

  it('rounds down to the containing frame', () => {
    expect(msToFrame(1033, 30)).toBe(30);
    expect(msToFrame(1066, 30)).toBe(31);
  });
});
