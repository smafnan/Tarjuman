import { describe, expect, it } from 'vitest';

import { audibleRange, LEAD_IN_S, SILENCE_THRESHOLD, TAIL_S } from './silence';

const RATE = 1_000;

/** A mono buffer of `seconds` that is silent except for [fromS, toS). */
function buffer(seconds: number, fromS: number, toS: number, level = 0.3): Float32Array {
  const samples = new Float32Array(Math.round(seconds * RATE));
  samples.fill(level, Math.round(fromS * RATE), Math.round(toS * RATE));
  return samples;
}

describe('audibleRange', () => {
  it('cuts the silence in front of and behind the speech, keeping a short lead-in and tail', () => {
    // What the voice service delivers: 0.2 s of silence, speech, 1.2 s of silence.
    const range = audibleRange([buffer(3.4, 0.2, 2.2)], RATE)!;
    expect(range.offsetS).toBeCloseTo(0.2 - LEAD_IN_S, 6);
    expect(range.durationS).toBeCloseTo(2 + LEAD_IN_S + TAIL_S, 6);
  });

  it('never reaches outside the buffer', () => {
    const range = audibleRange([buffer(1, 0, 1)], RATE)!;
    expect(range.offsetS).toBe(0);
    expect(range.durationS).toBe(1);

    const nearTheEdges = audibleRange([buffer(1, 0.01, 0.99)], RATE)!;
    expect(nearTheEdges.offsetS).toBe(0);
    expect(nearTheEdges.durationS).toBe(1);
  });

  it('returns null for a buffer that is silent throughout', () => {
    expect(audibleRange([new Float32Array(500)], RATE)).toBeNull();
    expect(audibleRange([buffer(1, 0.2, 0.8, SILENCE_THRESHOLD * 0.9)], RATE)).toBeNull();
    expect(audibleRange([new Float32Array(0)], RATE)).toBeNull();
    expect(audibleRange([], RATE)).toBeNull();
  });

  it('treats negative samples like positive ones', () => {
    const range = audibleRange([buffer(1, 0.4, 0.6, -0.2)], RATE, { leadInS: 0, tailS: 0 })!;
    expect(range.offsetS).toBeCloseTo(0.4, 6);
    expect(range.durationS).toBeCloseTo(0.2, 6);
  });

  it('keeps a single audible sample', () => {
    const samples = new Float32Array(1_000);
    samples[500] = 0.5;
    const range = audibleRange([samples], RATE, { leadInS: 0, tailS: 0 })!;
    expect(range.offsetS).toBeCloseTo(0.5, 6);
    expect(range.durationS).toBeCloseTo(0.001, 6);
  });

  it('spans what is audible in any channel', () => {
    const left = buffer(2, 0.5, 0.9);
    const right = buffer(2, 0.7, 1.5);
    const options = { leadInS: 0, tailS: 0 };
    for (const channels of [
      [left, right],
      [right, left],
    ]) {
      const range = audibleRange(channels, RATE, options)!;
      expect(range.offsetS).toBeCloseTo(0.5, 6);
      expect(range.durationS).toBeCloseTo(1, 6);
    }
    // One silent channel does not hide the other.
    const withSilent = audibleRange([new Float32Array(2_000), left], RATE, options)!;
    expect(withSilent.offsetS).toBeCloseTo(0.5, 6);
    expect(withSilent.durationS).toBeCloseTo(0.4, 6);
  });

  it('ignores noise below the threshold around the speech', () => {
    const samples = buffer(2, 0.5, 1);
    for (let i = 0; i < samples.length; i++) if (samples[i] === 0) samples[i] = 0.002;
    const range = audibleRange([samples], RATE, { leadInS: 0, tailS: 0 })!;
    expect(range.offsetS).toBeCloseTo(0.5, 6);
    expect(range.durationS).toBeCloseTo(0.5, 6);
  });

  it('answers null instead of dividing by a sample rate of zero', () => {
    expect(audibleRange([buffer(1, 0.2, 0.8)], 0)).toBeNull();
  });
});
