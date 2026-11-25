import type { VadSensitivity } from '../state/types';

/**
 * Turns a stream of (audio frame, speech probability) pairs into utterances.
 *
 * This is the part of the system that decides how "live" interpretation feels:
 *
 * - an utterance ends after `pauseMs` of silence, so normal sentences are translated
 *   as soon as the speaker pauses;
 * - once someone has been talking for `softMaxMs` without such a pause, a much shorter
 *   pause (`softPauseMs`, a breath) is enough;
 * - at `hardMaxMs` the speech is cut anyway, at the quietest moment of the last couple
 *   of seconds, so a monologue is interpreted in pieces rather than after it ends.
 *
 * Pure logic, no browser APIs: it is unit-tested with synthetic probability sequences.
 */

export interface SegmenterOptions {
  sampleRate: number;
  /** Speech probability that starts an utterance. */
  startThreshold: number;
  /** Probability below which a frame counts as silence once an utterance is running. */
  endThreshold: number;
  /**
   * Utterances with less speech than this are discarded as noise. The remainder of a sentence
   * that was cut at `hardMaxMs` is exempt: its last word belongs to speech already sent.
   */
  minSpeechMs: number;
  /** Audio kept from before the first speech frame, so word onsets are not clipped. */
  preRollMs: number;
  /** Silence that ends an utterance. */
  pauseMs: number;
  /** After this much continuous talking, `softPauseMs` of silence is enough to end. */
  softMaxMs: number;
  softPauseMs: number;
  /** Absolute cap: the utterance is split even without any pause. */
  hardMaxMs: number;
  /** How far back from the cap to look for the quietest frame to split at. */
  splitSearchMs: number;
  /** Trailing silence kept at the end of an utterance. */
  tailPadMs: number;
}

export interface Segment {
  /** Mono samples at `sampleRate`, in [-1, 1]. */
  samples: Float32Array;
  durationMs: number;
  /** True when the cut was forced by `hardMaxMs` rather than found at a pause. */
  forcedSplit: boolean;
  /**
   * How long ago the speech in this segment stopped when the segment was reported: the pause
   * that had to pass before the utterance counted as over (or, after a forced split, the
   * audio that already belongs to the next segment).
   */
  trailingSilenceMs: number;
}

export interface SegmenterCallbacks {
  onSpeechStart(): void;
  onSpeechEnd(): void;
  onSegment(segment: Segment): void;
}

const THRESHOLDS: Record<VadSensitivity, { startThreshold: number; endThreshold: number }> = {
  // "low" needs clear, close speech (noisy rooms); "high" also picks up quiet or distant voices.
  low: { startThreshold: 0.7, endThreshold: 0.5 },
  normal: { startThreshold: 0.5, endThreshold: 0.35 },
  high: { startThreshold: 0.35, endThreshold: 0.2 },
};

export function segmenterOptions(sensitivity: VadSensitivity, pauseMs: number): SegmenterOptions {
  return {
    sampleRate: 16_000,
    ...THRESHOLDS[sensitivity],
    // A one-word answer ("Ja", "جی") holds 160 to 250 ms of detected speech.
    minSpeechMs: 160,
    preRollMs: 320,
    pauseMs,
    softMaxMs: 9_000,
    softPauseMs: Math.min(pauseMs, 260),
    hardMaxMs: 15_000,
    splitSearchMs: 2_500,
    tailPadMs: 160,
  };
}

interface Frame {
  samples: Float32Array;
  probability: number;
}

function concat(frames: readonly Frame[]): Float32Array {
  let length = 0;
  for (const frame of frames) length += frame.samples.length;
  const out = new Float32Array(length);
  let offset = 0;
  for (const frame of frames) {
    out.set(frame.samples, offset);
    offset += frame.samples.length;
  }
  return out;
}

export class Segmenter {
  private options: SegmenterOptions;
  private readonly callbacks: SegmenterCallbacks;
  /** Recent frames while idle, newest last. */
  private preRoll: Frame[] = [];
  private preRollMs = 0;
  /** Frames of the running utterance (including its pre-roll). */
  private frames: Frame[] = [];
  private active = false;
  /** Duration of the running utterance, not counting pre-roll. */
  private utteranceMs = 0;
  private speechMs = 0;
  /** Length of the current run of silence at the end of the utterance. */
  private silenceMs = 0;
  /** The running utterance is the rest of speech that was cut at `hardMaxMs`. */
  private continuesSplit = false;

  constructor(options: SegmenterOptions, callbacks: SegmenterCallbacks) {
    this.options = options;
    this.callbacks = callbacks;
  }

  get speaking(): boolean {
    return this.active;
  }

  setOptions(options: SegmenterOptions): void {
    this.options = options;
  }

  private frameMs(samples: Float32Array): number {
    return (samples.length / this.options.sampleRate) * 1000;
  }

  /** Feed one frame. `samples` is copied, so the caller may reuse its buffer. */
  push(samples: Float32Array, rawProbability: number): void {
    // A detector fed broken input answers NaN, and NaN fails every comparison below: it would
    // neither count as silence nor as speech.
    const probability = Number.isFinite(rawProbability) ? rawProbability : 0;
    const frame: Frame = { samples: samples.slice(), probability };
    const ms = this.frameMs(samples);
    const o = this.options;

    if (!this.active) {
      if (probability < o.startThreshold) {
        this.preRoll.push(frame);
        this.preRollMs += ms;
        this.trimPreRoll();
        return;
      }
      this.active = true;
      this.frames = [...this.preRoll, frame];
      this.preRoll = [];
      this.preRollMs = 0;
      this.utteranceMs = ms;
      this.speechMs = ms;
      this.silenceMs = 0;
      this.callbacks.onSpeechStart();
      return;
    }

    this.frames.push(frame);
    this.utteranceMs += ms;
    if (probability >= o.endThreshold) {
      this.speechMs += ms;
      this.silenceMs = 0;
    } else {
      this.silenceMs += ms;
    }

    const pauseNeeded = this.utteranceMs >= o.softMaxMs ? o.softPauseMs : o.pauseMs;
    if (this.silenceMs >= pauseNeeded) {
      this.finish(false);
    } else if (this.utteranceMs >= o.hardMaxMs) {
      this.split();
    }
  }

  /** End the running utterance now (push-to-talk released, capture stopping). */
  flush(): void {
    if (this.active) this.finish(false);
  }

  /** Throw away the running utterance and the pre-roll. */
  reset(): void {
    const wasActive = this.active;
    this.clear();
    this.preRoll = [];
    this.preRollMs = 0;
    if (wasActive) this.callbacks.onSpeechEnd();
  }

  private trimPreRoll(): void {
    while (this.preRollMs > this.options.preRollMs && this.preRoll.length > 0) {
      const dropped = this.preRoll.shift();
      if (dropped) this.preRollMs -= this.frameMs(dropped.samples);
    }
  }

  private clear(): void {
    this.active = false;
    this.continuesSplit = false;
    this.frames = [];
    this.utteranceMs = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
  }

  private emit(
    frames: readonly Frame[],
    speechMs: number,
    forcedSplit: boolean,
    trailingSilenceMs: number,
    continuesSplit: boolean,
  ): void {
    const enough = continuesSplit ? speechMs > 0 : speechMs >= this.options.minSpeechMs;
    if (!enough) return;
    const samples = concat(frames);
    this.callbacks.onSegment({
      samples,
      durationMs: Math.round((samples.length / this.options.sampleRate) * 1000),
      forcedSplit,
      trailingSilenceMs: Math.round(trailingSilenceMs),
    });
  }

  private finish(forcedSplit: boolean): void {
    // Keep only a short tail of the closing silence.
    const frames = this.frames;
    let excessMs = this.silenceMs - this.options.tailPadMs;
    let end = frames.length;
    while (excessMs > 0 && end > 1) {
      const last = frames[end - 1];
      if (!last) break;
      const ms = this.frameMs(last.samples);
      if (ms > excessMs) break;
      excessMs -= ms;
      end -= 1;
    }
    const speechMs = this.speechMs;
    const silenceMs = this.silenceMs;
    const continuesSplit = this.continuesSplit;
    const kept = frames.slice(0, end);
    this.clear();
    // The pause that was cut off is the lead-in of whatever is said next: a sentence that
    // starts right after it would otherwise begin without its soft onset.
    this.preRoll = frames.slice(end);
    this.preRollMs = this.preRoll.reduce((sum, f) => sum + this.frameMs(f.samples), 0);
    this.trimPreRoll();
    this.callbacks.onSpeechEnd();
    this.emit(kept, speechMs, forcedSplit, silenceMs, continuesSplit);
  }

  /** The speaker has not paused for `hardMaxMs`: cut at the quietest recent frame and keep going. */
  private split(): void {
    const o = this.options;
    const frames = this.frames;

    // Search the last `splitSearchMs`, newest first, for the least speech-like frame.
    let searchedMs = 0;
    let splitAt = frames.length - 1;
    let lowest = Number.POSITIVE_INFINITY;
    for (let i = frames.length - 1; i >= 1 && searchedMs < o.splitSearchMs; i--) {
      const frame = frames[i];
      if (!frame) break;
      searchedMs += this.frameMs(frame.samples);
      // Strict comparison: among equally quiet frames the latest one wins, keeping the head long.
      if (frame.probability < lowest) {
        lowest = frame.probability;
        splitAt = i;
      }
    }

    const head = frames.slice(0, splitAt + 1);
    const tail = frames.slice(splitAt + 1);
    const speechOf = (list: readonly Frame[]) =>
      list.reduce((sum, f) => (f.probability >= o.endThreshold ? sum + this.frameMs(f.samples) : sum), 0);
    const silenceAtEndOf = (list: readonly Frame[]) => {
      let silence = 0;
      for (let i = list.length - 1; i >= 0; i--) {
        const frame = list[i];
        if (!frame || frame.probability >= o.endThreshold) break;
        silence += this.frameMs(frame.samples);
      }
      return silence;
    };

    // The tail becomes the beginning of the next utterance; the speaker is still talking.
    const wasContinuation = this.continuesSplit;
    this.frames = tail;
    this.utteranceMs = tail.reduce((sum, f) => sum + this.frameMs(f.samples), 0);
    this.speechMs = speechOf(tail);
    this.silenceMs = silenceAtEndOf(tail);
    this.continuesSplit = true;

    this.emit(head, speechOf(head), true, silenceAtEndOf(head) + this.utteranceMs, wasContinuation);
  }
}
