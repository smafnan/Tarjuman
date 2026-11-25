/**
 * One output device with everything that plays on it: the queue of translated speech and,
 * optionally, an "original voice" stream mixed underneath.
 *
 * There is one bus per destination:
 *   outgoing bus -> virtual microphone (what the other side hears)
 *   incoming bus -> headphones (what I hear)
 *   monitor bus  -> headphones (a quiet copy of my own outgoing translation)
 */

import { audibleRange } from './silence';

export interface OutputState {
  /**
   * Translated speech can be heard: from the moment it is scheduled until its last sample has
   * left the device (the queue's end plus the device's output latency). Never true while
   * the device does not render.
   */
  playing: boolean;
  /** Translated speech still queued or playing, in ms. */
  queueMs: number;
}

export interface OutputCallbacks {
  onState(state: OutputState): void;
  /** First audio of an utterance is about to be heard. `atEpochMs` is when playback starts. */
  onUtteranceStart?(utteranceId: string, atEpochMs: number): void;
  /**
   * `true`: this bus cannot play. Its audio device stopped rendering (unplugged headset,
   * driver restart) and did not start again, or the browser does not let audio start. Queued
   * speech was discarded and further speech is dropped until the bus is back: through
   * `unlock()` from a user action, or by itself once a usable device is selected.
   * `false`: it plays again.
   */
  onBlocked?(blocked: boolean): void;
}

export interface SpeechItem {
  utteranceId: string;
  /** Position within the utterance; 0 marks the start of a new utterance. */
  index: number;
  /** A complete encoded audio file (MP3 / WAV). */
  bytes: Uint8Array;
}

/**
 * Pause between two sentences of one utterance, and between two utterances, in seconds.
 * The chunks themselves are played without the silence they were delivered with (see
 * silence.ts), so these are the pauses the listener actually gets.
 */
const SENTENCE_GAP_S = 0.22;
const UTTERANCE_GAP_S = 0.3;
/** With more speech than this waiting, the pauses are halved: catching up costs pauses first. */
const CATCH_UP_BACKLOG_S = 2.5;
/** Small lead so scheduling never lands in the past. */
const SCHEDULE_LEAD_S = 0.03;
/** Level of the original voice while translated speech is playing over it. */
const DUCKED_LEVEL = 0.3;
/**
 * How long a context gets to be "running" again after a device switch of ours (Chrome takes
 * about 3 ms). Past that, the stop was not the passing one of a switch.
 */
const SETTLE_MS = 500;
/**
 * How long a resume() that has not answered yet gets. A Bluetooth headset that wakes up, or
 * changes profile because the microphone opened, needs a second or more to render again.
 * Past that, the device counts as not playing.
 */
const RESUME_WAIT_MS = 2_000;
/**
 * Speech that had to wait longer than this for its device is dropped instead of played: the
 * conversation has moved on, and a backlog would push everything after it back as well.
 */
const MAX_SPEECH_AGE_MS = 3_000;
/**
 * The most a device's reported latency is believed, in seconds. Bluetooth reports 0.15 to
 * 0.25 s; a driver that reports nonsense must not keep the microphone closed for long.
 */
const MAX_OUTPUT_LATENCY_S = 0.5;

type SinkAudioContext = AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };
type SinkAudioElement = HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> };

/** The state changes behind our back, so it is read afresh each time (and not narrowed by the compiler). */
function isRunning(context: AudioContext): boolean {
  return context.state === 'running';
}

/**
 * How much later than the context's clock says a sample leaves the device, in seconds.
 * Not every browser reports it, and it changes with the device.
 */
function outputLatency(context: AudioContext): number {
  const latency = context.outputLatency;
  return Number.isFinite(latency) ? Math.min(Math.max(latency, 0), MAX_OUTPUT_LATENCY_S) : 0;
}

/** A wait for a stopped context to run again. */
interface StartWait {
  /** performance.now() from which the wait is over, whether or not its timer has fired. */
  deadline: number;
  finish: () => void;
}

export class OutputBus {
  private context: SinkAudioContext | null = null;
  private speechGain: GainNode | null = null;
  private passthroughGain: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private passthroughSource: MediaStreamAudioSourceNode | null = null;
  /** Fallback route for browsers without AudioContext.setSinkId. */
  private element: SinkAudioElement | null = null;

  private readonly sources = new Set<AudioBufferSourceNode>();
  /** A silent source that ends when the last speech has left the device (see watchTail). */
  private tailMark: AudioBufferSourceNode | null = null;
  /** Context time at which the queue runs dry; 0 while nothing has been scheduled. */
  private queueEnd = 0;
  /** Bumped by flush(); audio decoded for an older generation is discarded. */
  private generation = 0;
  private decodeChain: Promise<void> = Promise.resolve();
  /** Resolves once the configured output device has been applied to a freshly built graph. */
  private sinkReady: Promise<unknown> = Promise.resolve();
  /** Device switches of ours that are under way; the context stops for a moment during each. */
  private sinkSwitches = 0;
  /** The context is not rendering and could not be restarted: nothing is scheduled. */
  private blocked = false;
  private recovering: Promise<void> | null = null;
  /** The latest attempt to start a bus that may be blocked (a click, a new device). */
  private reviving: Promise<void> | null = null;
  /** Waits for the context to run that are under way (see untilRunning). */
  private readonly startWaits = new Set<StartWait>();
  /** The utterance the last scheduled chunk belonged to (decides which pause comes next). */
  private lastUtteranceId: string | null = null;
  private closing = false;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private lastPlaying = false;

  private sinkId = '';
  private volume = 1;
  private passthroughLevel = 0;
  private ducking = false;
  private passthroughStream: MediaStream | null = null;

  constructor(private readonly callbacks: OutputCallbacks) {}

  get playing(): boolean {
    const context = this.context;
    if (context === null || this.queueEnd === 0) return false;
    // The clock runs ahead of the loudspeaker: what it has just passed is still on its way
    // out. Whoever listens for the end of the speech (the echo guard) must not hear that.
    if (this.queueEnd + outputLatency(context) <= context.currentTime + 0.01) return false;
    // A context that is not running plays nothing, whatever is scheduled on it. The few
    // milliseconds it stops for a device switch of ours are not a pause in the speech.
    return context.state === 'running' || this.sinkSwitches > 0;
  }

  /**
   * Speech is only ever scheduled on a running clock (see enqueue) and is discarded when the
   * clock stops for good, so this cannot grow while nothing is heard.
   */
  get queueMs(): number {
    if (!this.context || this.blocked) return 0;
    return Math.max(0, Math.round((this.queueEnd - this.context.currentTime) * 1000));
  }

  /**
   * Create the audio graph if needed and make sure it is running. Browsers only allow this
   * as a result of a user action, so call it from click / key handlers.
   */
  async unlock(): Promise<void> {
    await this.revive();
    if (this.element?.paused) await this.element.play().catch(() => undefined);
  }

  /**
   * Get the context running (again): resume it, or build a new one on the configured device
   * when the old one was closed. Reports through onBlocked whether that worked.
   */
  private revive(): Promise<void> {
    const attempt = this.startAgain().finally(() => {
      if (this.reviving === attempt) this.reviving = null;
    });
    // Speech that arrives meanwhile waits for the outcome instead of being dropped (see enqueue).
    this.reviving = attempt;
    return attempt;
  }

  private async startAgain(): Promise<void> {
    if (this.context?.state === 'closed') this.discardGraph();
    if (!this.context) this.build();
    const context = this.context;
    if (!context) return;
    // Asked for before anything is awaited: browsers tie the right to start audio to the
    // user action that led here.
    const resuming = context.state === 'running' ? null : context.resume();
    await this.sinkReady;
    await this.untilRunning(context, resuming, RESUME_WAIT_MS);
    if (this.closing || this.context !== context) return;
    if (context.state === 'running') {
      this.setBlocked(false);
    } else {
      this.flush();
      this.setBlocked(true);
    }
    this.report();
  }

  /** Forget a context the browser closed; the next build() starts from nothing. */
  private discardGraph(): void {
    this.flush();
    this.element?.pause();
    this.element = null;
    this.passthroughSource = null;
    this.speechGain = null;
    this.passthroughGain = null;
    this.duckGain = null;
    this.context = null;
  }

  private setBlocked(blocked: boolean): void {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    this.callbacks.onBlocked?.(blocked);
  }

  /**
   * The context stopped without our doing (unplugged headset, driver restart). Nothing else
   * would start it again, so try; if it stays down, give up the queue and say so.
   */
  private recover(context: SinkAudioContext): Promise<void> {
    if (this.recovering) return this.recovering;
    const attempt = this.attemptRecovery(context).finally(() => {
      if (this.recovering === attempt) this.recovering = null;
    });
    this.recovering = attempt;
    return attempt;
  }

  private async attemptRecovery(context: SinkAudioContext): Promise<void> {
    const since = performance.now();
    if (context.state !== 'running' && context.state !== 'closed') {
      await this.untilRunning(context, context.resume(), RESUME_WAIT_MS);
    }
    if (this.closing || this.context !== context) return;
    if (context.state === 'running') {
      // Nothing ended the wait when its time was up (a hidden window, and no speech arrived),
      // and the device is back only now: what is scheduled would be spoken that much late.
      if (performance.now() - since >= RESUME_WAIT_MS) this.flush();
      this.setBlocked(false);
      this.report();
      return;
    }
    // Speech scheduled on a clock that stands still would never be heard and never end.
    this.flush();
    this.setBlocked(true);
  }

  /**
   * Resolves as soon as `context` is running, `attempt` (a resume() call) has settled either
   * way, or `timeoutMs` have passed: resume() on a device that is gone may never settle.
   *
   * The timer is only the last resort. In a window hidden behind the call it fires up to a
   * second late, after minutes of silence up to a minute, so the wait also ends when
   * expireWaits() finds that its time is up.
   */
  private untilRunning(
    context: AudioContext,
    attempt: Promise<unknown> | null,
    timeoutMs: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      if (isRunning(context)) {
        resolve();
        return;
      }
      const wait: StartWait = {
        deadline: performance.now() + timeoutMs,
        finish: () => {
          clearTimeout(timer);
          context.removeEventListener('statechange', onChange);
          this.startWaits.delete(wait);
          resolve();
        },
      };
      const onChange = () => {
        if (isRunning(context)) wait.finish();
      };
      const timer = setTimeout(wait.finish, timeoutMs);
      context.addEventListener('statechange', onChange);
      this.startWaits.add(wait);
      attempt?.then(wait.finish, wait.finish);
    });
  }

  /** End the waits whose time is up. To be called from events that a hidden window does not delay. */
  private expireWaits(): void {
    if (this.startWaits.size === 0) return;
    const now = performance.now();
    for (const wait of [...this.startWaits]) {
      if (now >= wait.deadline) wait.finish();
    }
  }

  private build(): void {
    const context: SinkAudioContext = new AudioContext({ latencyHint: 'interactive' });
    const master = context.createGain();
    const speechGain = context.createGain();
    const passthroughGain = context.createGain();
    const duckGain = context.createGain();
    speechGain.gain.value = this.volume;
    passthroughGain.gain.value = this.passthroughLevel;
    speechGain.connect(master);
    passthroughGain.connect(duckGain).connect(master);

    if (typeof context.setSinkId === 'function') {
      master.connect(context.destination);
    } else {
      // Older browsers can only route an <audio> element to a device, so play through one.
      const destination = context.createMediaStreamDestination();
      master.connect(destination);
      const element: SinkAudioElement = new Audio();
      element.srcObject = destination.stream;
      element.autoplay = true;
      this.element = element;
    }

    this.context = context;
    this.speechGain = speechGain;
    this.passthroughGain = passthroughGain;
    this.duckGain = duckGain;
    // Nothing is scheduled before the device has been applied (see enqueue), so speech never
    // starts on the wrong device.
    this.sinkReady = this.sinkId ? this.applySink() : Promise.resolve();
    if (this.passthroughStream) this.connectPassthrough();

    // A context stops rendering when its device disappears. Scheduled audio would then never
    // finish and the bus would look busy forever.
    const onChange = () => {
      if (this.closing || this.context !== context) return;
      // setSinkId() reports "suspended" and, a few milliseconds later, "running" again while
      // what was scheduled keeps playing on the new device. applySink() judges the outcome.
      if (this.sinkSwitches > 0) return;
      if (context.state === 'running') {
        this.setBlocked(false);
        this.report();
      } else {
        // Said at once: whether the device comes back is known only later, but nothing is
        // heard from this moment on, and the echo guard must not keep the microphone closed.
        this.report();
        void this.recover(context);
      }
    };
    context.addEventListener('statechange', onChange);
    context.addEventListener('error', onChange);
  }

  private async applySink(): Promise<boolean> {
    const context = this.context;
    // Whether the context was rendering before or at any time during the switch. A context
    // that has just been created starts while its first device is being selected.
    let ran = context !== null && isRunning(context);
    const noteRunning = () => {
      if (context !== null && isRunning(context)) ran = true;
    };
    context?.addEventListener('statechange', noteRunning);
    let ok = true;
    this.sinkSwitches += 1;
    try {
      if (context && typeof context.setSinkId === 'function') {
        await context.setSinkId(this.sinkId);
      } else if (this.element && typeof this.element.setSinkId === 'function') {
        await this.element.setSinkId(this.sinkId);
      } else if (this.sinkId) {
        ok = false;
      }
    } catch {
      ok = false;
    }
    context?.removeEventListener('statechange', noteRunning);
    // The promise resolves while the context still reports "suspended"; "running" follows.
    if (context && ran) await this.untilRunning(context, null, SETTLE_MS);
    this.sinkSwitches -= 1;
    const stillOurs = context !== null && this.context === context && !this.closing;
    if (stillOurs && ran && this.sinkSwitches === 0 && !isRunning(context)) {
      // The stop was not the passing one of a switch: the device does not render.
      this.report();
      void this.recover(context);
    }
    return ok;
  }

  /**
   * Route this bus to an output device ('' = system default).
   * Resolves to false when the device could not be selected; audio then stays where it was.
   */
  async setSink(sinkId: string): Promise<boolean> {
    this.sinkId = sinkId;
    if (!this.context) return true; // applied when the graph is built
    const applied = this.applySink();
    // Speech that arrives during the switch waits for it (see enqueue).
    this.sinkReady = applied;
    const ok = await applied;
    // Another device, or the default one after the chosen one vanished, may well play:
    // find out now instead of waiting for the user to click "Resume audio".
    if (this.blocked) await this.revive();
    return ok;
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.speechGain && this.context) {
      this.speechGain.gain.setTargetAtTime(volume, this.context.currentTime, 0.02);
    }
  }

  /** Mix a live stream (the original voice) underneath the translated speech, or remove it with null. */
  setPassthrough(stream: MediaStream | null): void {
    // Called on every settings change; rebuilding the node for an unchanged stream would
    // interrupt the live audio each time.
    if (stream === this.passthroughStream && (stream === null || this.passthroughSource !== null)) return;
    this.passthroughStream = stream;
    if (this.context) this.connectPassthrough();
  }

  private connectPassthrough(): void {
    this.passthroughSource?.disconnect();
    this.passthroughSource = null;
    if (!this.context || !this.passthroughGain || !this.passthroughStream) return;
    if (this.passthroughStream.getAudioTracks().length === 0) return;
    this.passthroughSource = this.context.createMediaStreamSource(this.passthroughStream);
    this.passthroughSource.connect(this.passthroughGain);
  }

  setPassthroughLevel(level: number): void {
    this.passthroughLevel = level;
    if (this.passthroughGain && this.context) {
      this.passthroughGain.gain.setTargetAtTime(level, this.context.currentTime, 0.03);
    }
  }

  /** Lower the original voice while translated speech is playing. */
  setDucking(enabled: boolean): void {
    this.ducking = enabled;
    this.applyDucking();
  }

  private applyDucking(): void {
    if (!this.duckGain || !this.context) return;
    const target = this.ducking && this.playing ? DUCKED_LEVEL : 1;
    this.duckGain.gain.setTargetAtTime(target, this.context.currentTime, this.playing ? 0.05 : 0.2);
  }

  /** Queue one chunk of translated speech. Chunks play in the order they are enqueued. */
  enqueue(item: SpeechItem): void {
    const generation = this.generation;
    const enqueuedAt = performance.now();
    // Speech arrives over the socket, which a hidden window does not slow down. A wait for
    // the device that has run out is therefore noticed here, not when its timer gets its turn.
    this.expireWaits();
    this.decodeChain = this.decodeChain
      .then(async () => {
        // A start set off by a click or by a new device is under way: its outcome decides.
        if (this.blocked && this.reviving) await this.reviving;
        // Nothing can be heard. Speech kept for later would play minutes late, or never.
        if (this.blocked) return;
        if (!this.context) this.build();
        await this.sinkReady;
        const context = this.context;
        if (!context || generation !== this.generation) return;
        if (!(await this.canPlay(context)) || generation !== this.generation) return;
        // Whatever it waited for (a device switch, a device that took its time to start):
        // played now, it would no longer belong to what is being said.
        if (performance.now() - enqueuedAt > MAX_SPEECH_AGE_MS) return;
        // decodeAudioData detaches the buffer it is given, so hand it a private copy.
        const copy = item.bytes.buffer.slice(
          item.bytes.byteOffset,
          item.bytes.byteOffset + item.bytes.byteLength,
        );
        const buffer = await context.decodeAudioData(copy as ArrayBuffer);
        // A context that stopped for good meanwhile has flushed, which starts a new generation.
        if (generation !== this.generation || this.context !== context) return;
        this.schedule(context, buffer, item);
      })
      .catch((error: unknown) => {
        console.warn('could not play a speech chunk', error);
      });
  }

  /** Whether `context` is rendering, after giving a stopped one the chance to start again. */
  private async canPlay(context: SinkAudioContext): Promise<boolean> {
    if (!isRunning(context)) {
      await this.sinkReady;
      if (!isRunning(context)) await this.recover(context);
    }
    return !this.blocked && this.context === context && isRunning(context);
  }

  private schedule(context: AudioContext, buffer: AudioBuffer, item: SpeechItem): void {
    if (!this.speechGain) return;
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      channels.push(buffer.getChannelData(channel));
    }
    const range = audibleRange(channels, buffer.sampleRate);
    // Nothing to hear in this chunk, so it must not cost the listener a pause either.
    if (!range) return;

    const now = context.currentTime;
    const startsUtterance = item.utteranceId !== this.lastUtteranceId;
    let gap = startsUtterance ? UTTERANCE_GAP_S : SENTENCE_GAP_S;
    if (this.queueEnd - now > CATCH_UP_BACKLOG_S) gap /= 2;
    // The pause counts from the end of the previous chunk even when that has already passed:
    // a sentence that arrives just after the last one ended still gets its distance.
    const afterPrevious = this.queueEnd > 0 ? this.queueEnd + gap : 0;
    const startAt = Math.max(now + SCHEDULE_LEAD_S, afterPrevious);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.speechGain);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      this.report();
    };
    source.start(startAt, range.offsetS, range.durationS);
    this.sources.add(source);
    this.queueEnd = startAt + range.durationS;
    this.lastUtteranceId = item.utteranceId;

    if (startsUtterance) {
      this.callbacks.onUtteranceStart?.(
        item.utteranceId,
        Date.now() + (startAt - now + outputLatency(context)) * 1000,
      );
    }
    this.report();
  }

  /**
   * The last speech source has ended, but the bus counts as playing until the device has put
   * that speech out. Nothing happens at that moment by itself, and a timer would notice it up
   * to a second late in a hidden window. So a silent source is scheduled to end there: its
   * "ended" event arrives on time.
   */
  private watchTail(): void {
    const context = this.context;
    if (!context || !this.speechGain || this.tailMark || this.sources.size > 0) return;
    const mark = context.createBufferSource();
    mark.buffer = context.createBuffer(1, 1, context.sampleRate);
    // Connected like speech: a source that leads nowhere may not be rendered, and then never ends.
    mark.connect(this.speechGain);
    mark.onended = () => {
      mark.disconnect();
      if (this.tailMark === mark) this.tailMark = null;
      this.report();
    };
    mark.start(this.queueEnd + outputLatency(context));
    this.tailMark = mark;
  }

  /** Stop and discard everything queued or playing ("skip to live"). */
  flush(): void {
    this.generation += 1;
    const sources = this.tailMark ? [...this.sources, this.tailMark] : [...this.sources];
    for (const source of sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      source.disconnect();
    }
    this.sources.clear();
    this.tailMark = null;
    this.queueEnd = 0;
    this.lastUtteranceId = null;
    this.report();
  }

  private report(): void {
    const playing = this.playing;
    if (playing !== this.lastPlaying) {
      this.lastPlaying = playing;
      this.applyDucking();
    }
    this.callbacks.onState({ playing, queueMs: this.queueMs });
    if (playing) this.watchTail();

    // While audio is queued, keep the reported queue length current.
    if (playing && !this.ticker) {
      this.ticker = setInterval(() => this.report(), 250);
    } else if (!playing && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  close(): void {
    this.closing = true;
    this.flush();
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    // Their continuations see `closing` and do nothing; this only spares the timers.
    for (const wait of [...this.startWaits]) wait.finish();
    this.passthroughSource?.disconnect();
    this.element?.pause();
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
