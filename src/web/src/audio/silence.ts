/**
 * Finding the audible part of a decoded speech chunk.
 *
 * Synthesized speech arrives padded: about 0.2 s of silence in front and 0.8 to 1.4 s behind
 * every file. Played as they are, the sentences of one answer are separated by pauses of more
 * than a second that nobody chose, and the listener falls behind the speaker by that much per
 * sentence. The output bus plays only the audible part and sets the pauses itself.
 *
 * Pure logic, no browser APIs.
 */

/** Samples at or below this level count as silence (about -48 dBFS: below any speech, above codec noise). */
export const SILENCE_THRESHOLD = 0.004;
/** Kept before the first audible sample, so a soft onset is not clipped. */
export const LEAD_IN_S = 0.02;
/** Kept after the last audible sample, so the decay of the last sound is not cut off. */
export const TAIL_S = 0.06;

export interface AudibleRange {
  /** Where to start playing, in seconds from the start of the buffer. */
  offsetS: number;
  /** How long to play from there, in seconds. */
  durationS: number;
}

export interface AudibleRangeOptions {
  threshold?: number;
  leadInS?: number;
  tailS?: number;
}

/**
 * The part of a buffer worth playing: from shortly before the first sample above the
 * threshold (in any channel) until shortly after the last one.
 * @returns null when the buffer is silent throughout.
 */
export function audibleRange(
  channels: readonly Float32Array[],
  sampleRate: number,
  options: AudibleRangeOptions = {},
): AudibleRange | null {
  const threshold = options.threshold ?? SILENCE_THRESHOLD;
  const leadInS = options.leadInS ?? LEAD_IN_S;
  const tailS = options.tailS ?? TAIL_S;
  if (!(sampleRate > 0)) return null;

  let length = 0;
  let first = -1;
  let last = -1;
  for (const samples of channels) {
    length = Math.max(length, samples.length);
    // Only the stretch outside what an earlier channel already found can widen the range.
    const firstLimit = first === -1 ? samples.length : Math.min(first, samples.length);
    for (let i = 0; i < firstLimit; i++) {
      if (Math.abs(samples[i] ?? 0) > threshold) {
        first = i;
        break;
      }
    }
    for (let i = samples.length - 1; i > last; i--) {
      if (Math.abs(samples[i] ?? 0) > threshold) {
        last = i;
        break;
      }
    }
  }
  if (first === -1 || last === -1) return null;

  const start = Math.max(0, first - Math.round(leadInS * sampleRate));
  const end = Math.min(length, last + 1 + Math.round(tailS * sampleRate));
  return { offsetS: start / sampleRate, durationS: (end - start) / sampleRate };
}
