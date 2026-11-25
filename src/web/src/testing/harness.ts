/**
 * A fake browser for tests that run the real controller, store, connection, capture channel
 * and output bus: Web Audio, the device list, the microphone prompt, the WebSocket and the
 * speech-detection library are stand-ins that the test drives.
 *
 * The AudioContext stand-in copies what Chrome was measured to do:
 * - setSinkId() to another device on a running context: `statechange` (suspended), the
 *   promise resolves, then `statechange` (running); scheduled audio keeps playing;
 * - setSinkId() with an id the page may not use (no microphone permission yet) or that does
 *   not exist: rejects with NotFoundError;
 * - a device failure: `error` while still "running", then `statechange` (suspended), and the
 *   context stays suspended until resume() succeeds.
 *
 * Test audio is not encoded audio: see `testAudio`.
 */
import { vi } from 'vitest';

import {
  decodeBinaryFrame,
  encodeBinaryFrame,
  type AudioUtteranceHeader,
  type ServerMessage,
  type SpeechChunkHeader,
} from '../../../shared/protocol';
import type { ChannelId } from '../../../shared/settings';

interface FakeDevice {
  deviceId: string;
  label: string;
}

const DEFAULT_OUTPUTS: FakeDevice[] = [
  { deviceId: 'cable-id', label: 'CABLE Input (VB-Audio Virtual Cable)' },
  { deviceId: 'phones-id', label: 'Headphones (USB Headset)' },
];
const DEFAULT_INPUTS: FakeDevice[] = [{ deviceId: 'mic-id', label: 'Microphone (USB Headset)' }];

/** The machine the fake browser runs on. `uninstallBrowser` resets it. */
export const env = {
  /** Microphone permission: without it device names are hidden and setSinkId(id) is refused. */
  permission: true,
  outputs: [...DEFAULT_OUTPUTS],
  inputs: [...DEFAULT_INPUTS],
  /** The browser cannot create an audio context at a requested sample rate. */
  refuseSampleRate: false,
  /** A context with a requested sample rate cannot take a stream (rates differ). */
  refuseStreamAttach: false,
  /** New contexts start suspended and resume() has no effect: no user action has happened yet. */
  autoplayBlocked: false,
  /** New contexts report "suspended" until something starts them, as real ones do for a moment. */
  startSuspended: false,
};

/** Sample rate of decoded test audio. Low, so minutes of it cost nothing. */
export const TEST_AUDIO_RATE = 1_000;

/**
 * Bytes the fake decoder understands: `speechS` seconds of sound with `leadS` seconds of
 * silence in front and `tailS` behind. Resolution: 0.1 s for speech and tail, 0.01 s for the lead.
 */
export function testAudio(speechS: number, leadS = 0, tailS = 0): Uint8Array {
  return new Uint8Array([Math.round(speechS * 10), Math.round(leadS * 100), Math.round(tailS * 10)]);
}

/** Bytes the fake decoder rejects, like a truncated MP3. */
export const UNDECODABLE_AUDIO = new Uint8Array([0xff, 0, 0]);

class FakeAudioBuffer {
  readonly numberOfChannels = 1;

  private constructor(
    private readonly samples: Float32Array,
    readonly sampleRate: number,
    /** Decoded from received audio, as opposed to a buffer the page made itself. */
    readonly decoded: boolean,
  ) {}

  static decode(leadS: number, speechS: number, tailS: number): FakeAudioBuffer {
    const from = Math.round(leadS * TEST_AUDIO_RATE);
    const to = from + Math.round(speechS * TEST_AUDIO_RATE);
    const samples = new Float32Array(to + Math.round(tailS * TEST_AUDIO_RATE));
    samples.fill(0.25, from, to);
    return new FakeAudioBuffer(samples, TEST_AUDIO_RATE, true);
  }
  static blank(length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(new Float32Array(length), sampleRate, false);
  }
  get length(): number {
    return this.samples.length;
  }
  get duration(): number {
    return this.samples.length / this.sampleRate;
  }
  getChannelData(): Float32Array {
    return this.samples;
  }
}

class FakeParam {
  value = 1;
  setTargetAtTime(value: number): void {
    this.value = value;
  }
}

class FakeNode {
  gain = new FakeParam();
  connected = true;
  connect<T>(node: T): T {
    return node;
  }
  disconnect(): void {
    this.connected = false;
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeAudioBuffer | null = null;
  onended: (() => void) | null = null;
  /** Context time the source was started for, and the part of the buffer it plays. */
  startedAt: number | null = null;
  offset = 0;
  duration = 0;
  stopped = false;
  ended = false;
  constructor(private readonly ctx: FakeAudioContext) {
    super();
  }
  start(at: number, offset = 0, duration?: number): void {
    this.startedAt = at;
    this.offset = offset;
    this.duration = duration ?? (this.buffer?.duration ?? 0) - offset;
    (this.buffer?.decoded === false ? this.ctx.marks : this.ctx.sources).push(this);
  }
  stop(): void {
    this.stopped = true;
  }
  /** Context time at which the source falls silent. */
  get endsAt(): number {
    return (this.startedAt ?? 0) + this.duration;
  }
}

/** What resume() does on a context whose device is not coming back. */
type DeadDevice = 'ignores' | 'hangs' | 'rejects';

export class FakeAudioContext extends EventTarget {
  static instances: FakeAudioContext[] = [];
  state: 'running' | 'suspended' | 'closed';
  currentTime = 0;
  outputLatency = 0.04;
  sampleRate: number;
  destination = new FakeNode();
  sinkId = '';
  /** Sources that play decoded speech, in the order they were started. */
  sources: FakeSource[] = [];
  /** Sources that play a buffer the page made itself: silent ones, started only for their "ended" event. */
  marks: FakeSource[] = [];
  streamSources: FakeNode[] = [];
  resumeCalls = 0;
  sinkCalls: string[] = [];
  /** Set to make resume() fail the way a context without a working device does. */
  dead: DeadDevice | null = null;
  /** The device whose failure `fail()` reported; moving to another one lets the context play again. */
  private failedSinkId: string | null = null;

  constructor(readonly options: AudioContextOptions = {}) {
    super();
    if (options.sampleRate !== undefined && env.refuseSampleRate) {
      throw new DOMException('The sample rate is not supported', 'NotSupportedError');
    }
    this.sampleRate = options.sampleRate ?? 48_000;
    this.state = env.autoplayBlocked || env.startSuspended ? 'suspended' : 'running';
    if (env.autoplayBlocked) this.dead = 'hangs';
    FakeAudioContext.instances.push(this);
  }
  createGain(): FakeNode {
    return new FakeNode();
  }
  createBufferSource(): FakeSource {
    return new FakeSource(this);
  }
  createMediaStreamSource(): FakeNode {
    if (this.options.sampleRate !== undefined && env.refuseStreamAttach) {
      throw new DOMException('Sample rates of the stream and the context differ', 'NotSupportedError');
    }
    const node = new FakeNode();
    this.streamSources.push(node);
    return node;
  }
  async decodeAudioData(data: ArrayBuffer): Promise<FakeAudioBuffer> {
    const [speech = 0, lead = 0, tail = 0] = new Uint8Array(data);
    if (speech === 0xff) throw new DOMException('Unable to decode audio data', 'EncodingError');
    return FakeAudioBuffer.decode(lead / 100, speech / 10, tail / 10);
  }
  createBuffer(_channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return FakeAudioBuffer.blank(length, sampleRate);
  }
  async setSinkId(id: string): Promise<void> {
    this.sinkCalls.push(id);
    const known = env.outputs.some((device) => device.deviceId === id);
    if (id !== '' && (!env.permission || !known)) throw new DOMException('device not found', 'NotFoundError');
    if (id === this.sinkId) return;
    // Chrome starts the switch a moment after the call.
    await Promise.resolve();
    const wasRunning = this.state === 'running';
    if (wasRunning) this.become('suspended');
    await Promise.resolve();
    this.sinkId = id;
    if (this.failedSinkId !== null && id !== this.failedSinkId) this.revive();
    if (wasRunning && !this.dead) setTimeout(() => this.become('running'), 0);
  }
  resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.state === 'closed') {
      return Promise.reject(new DOMException('The context is closed', 'InvalidStateError'));
    }
    if (this.dead === 'hangs') return new Promise(() => undefined);
    if (this.dead === 'rejects') {
      return Promise.reject(new DOMException('The device is not available', 'InvalidStateError'));
    }
    if (this.dead === null && this.state === 'suspended') this.become('running');
    return Promise.resolve();
  }
  async close(): Promise<void> {
    if (this.state !== 'closed') this.become('closed');
  }

  /** Change state the way the browser does: with a `statechange` event. */
  become(state: FakeAudioContext['state']): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }

  /** Let `seconds` of audio time pass (the clock of a context that is not running stands still). */
  advance(seconds: number): void {
    if (this.state !== 'running') return;
    this.currentTime += seconds;
    // An "ended" handler may start a source that is over by now as well, hence the rounds.
    for (let fired = true; fired;) {
      fired = false;
      for (const source of [...this.sources, ...this.marks]) {
        if (source.ended || source.stopped || source.startedAt === null) continue;
        if (source.endsAt <= this.currentTime) {
          source.ended = true;
          source.onended?.();
          fired = true;
        }
      }
    }
  }
  /**
   * The output device fails (unplugged headset, driver or audio service error). By default a
   * resume() brings the context back; with `dead` it stays down until `revive()` or until
   * another device is selected.
   */
  fail(dead: DeadDevice | null = null): void {
    this.dead = dead;
    this.failedSinkId = dead ? this.sinkId : null;
    this.dispatchEvent(new Event('error'));
    this.become('suspended');
  }
  /** The device works again: the next resume() succeeds. */
  revive(): void {
    this.dead = null;
    this.failedSinkId = null;
  }
  /** Sources that are scheduled and neither stopped nor finished. */
  get live(): FakeSource[] {
    return this.sources.filter((source) => !source.stopped && !source.ended);
  }
}

export class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  binaryType = '';
  sent: (string | ArrayBuffer)[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  // ---- the server side of the socket

  accept(): void {
    this.readyState = 1;
    this.onopen?.();
    this.say({
      type: 'session.ready',
      sessionId: 's1',
      info: {
        name: 'tarjuman',
        version: 'test',
        protocol: 1,
        providers: { stt: [], mt: [], tts: [] },
        voices: [],
        keysWritable: true,
        authRequired: false,
      },
    });
  }
  say(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  /** Send one chunk of translated speech (see `testAudio` for the arguments after the header). */
  speech(
    header: Partial<SpeechChunkHeader> & { id: string; index: number },
    speechS: number,
    leadS = 0,
    tailS = 0,
  ): void {
    const full: SpeechChunkHeader = {
      type: 'utterance.speech',
      channel: 'incoming',
      lang: 'ur',
      last: false,
      mime: 'audio/mpeg',
      text: 'x',
      provider: 'edge',
      voice: 'v',
      ...header,
    };
    const frame = encodeBinaryFrame(full, testAudio(speechS, leadS, tailS));
    this.onmessage?.({ data: frame.buffer as ArrayBuffer });
  }
  /** The server interprets an utterance: caption, translation, one chunk of speech, done. */
  interpret(id: string, channel: ChannelId, speechS: number): void {
    this.say({
      type: 'utterance.transcript',
      id,
      channel,
      lang: 'de',
      text: 'Hallo',
      provider: 'stt',
      ms: 1,
    });
    this.say({
      type: 'utterance.translation',
      id,
      channel,
      translations: { ur: 'سلام' },
      provider: 'mt',
      ms: 1,
    });
    this.speech({ id, index: 0, channel, last: true }, speechS);
    this.say({ type: 'utterance.done', id, channel, timings: { totalMs: 5 } });
  }

  /** JSON messages the browser sent, parsed. */
  get json(): Record<string, unknown>[] {
    return this.sent
      .filter((data): data is string => typeof data === 'string')
      .map((data) => JSON.parse(data) as Record<string, unknown>);
  }
  /** Headers of the utterances the browser sent, oldest first. */
  get utterances(): AudioUtteranceHeader[] {
    return this.sent
      .filter((data): data is ArrayBuffer => typeof data !== 'string')
      .map((data) => decodeBinaryFrame(new Uint8Array(data)).header as AudioUtteranceHeader);
  }
}

export function fakeStream(label: string): MediaStream {
  const track = Object.assign(new EventTarget(), {
    label,
    readyState: 'live' as const,
    stop(): void {},
    getSettings: () => ({}),
  });
  return {
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

/** One speech detector the capture code created, as the fake library saw it. */
export interface FakeDetector {
  /** The options given to MicVAD.new. */
  options: {
    audioContext?: FakeAudioContext;
    onFrameProcessed: (probabilities: { isSpeech: number }, frame: Float32Array) => void;
  };
  started: boolean;
  destroyed: boolean;
}

export interface Browser {
  storage: Map<string, string>;
  mediaDevices: EventTarget & {
    /** Answer the microphone prompt with "allow" (only with `promptForMicrophone`). */
    answerPrompt: () => void;
  };
  /** Speech detectors in the order the captures started them. */
  detectors: FakeDetector[];
  /** Make the next start of the detection library fail. */
  failDetection: (error: Error) => void;
}

export interface BrowserOptions {
  /** getUserMedia waits for `answerPrompt()`, like Chrome's permission prompt. */
  promptForMicrophone?: boolean;
}

/**
 * Install the fake browser. Must run before the web modules are imported (the store reads
 * localStorage when it is created): use `loadApp()` or a dynamic import afterwards.
 * @param saved Content of the settings in localStorage, if any.
 */
export function installBrowser(saved?: unknown, options: BrowserOptions = {}): Browser {
  FakeAudioContext.instances = [];
  FakeWebSocket.instances = [];
  const storage = new Map<string, string>();
  if (saved !== undefined) storage.set('tarjuman.settings.v1', JSON.stringify(saved));
  const store = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  };

  let answer: () => void = () => undefined;
  const prompt = options.promptForMicrophone
    ? new Promise<void>((resolve) => {
        answer = resolve;
      })
    : Promise.resolve();

  const mediaDevices = Object.assign(new EventTarget(), {
    answerPrompt: () => answer(),
    async enumerateDevices() {
      if (!env.permission) {
        return [
          { kind: 'audioinput', deviceId: '', label: '' },
          { kind: 'audiooutput', deviceId: '', label: '' },
        ];
      }
      return [
        ...env.inputs.map((device) => ({ kind: 'audioinput', ...device })),
        ...env.outputs.map((device) => ({ kind: 'audiooutput', ...device })),
      ];
    },
    async getUserMedia() {
      await prompt;
      env.permission = true;
      return fakeStream('Microphone (USB Headset)');
    },
    async getDisplayMedia() {
      return fakeStream('Tab');
    },
  });

  const detectors: FakeDetector[] = [];
  let detectionError: Error | null = null;
  vi.doMock('@ricky0123/vad-web', () => ({
    MicVAD: {
      new: async (detectorOptions: FakeDetector['options']) => {
        if (detectionError) {
          const error = detectionError;
          detectionError = null;
          throw error;
        }
        const detector: FakeDetector = { options: detectorOptions, started: false, destroyed: false };
        detectors.push(detector);
        return {
          start: async () => {
            detector.started = true;
          },
          destroy: async () => {
            detector.destroyed = true;
          },
        };
      },
    },
  }));

  vi.stubGlobal('localStorage', store);
  vi.stubGlobal('sessionStorage', store);
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:8787', href: 'http://localhost:8787/' });
  vi.stubGlobal('history', { replaceState: () => undefined });
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('navigator', { userAgent: 'Chrome/153.0.0.0', mediaDevices });
  return {
    storage,
    mediaDevices,
    detectors,
    failDetection: (error) => {
      detectionError = error;
    },
  };
}

/** Undo `installBrowser`. Call it in `afterEach`. */
export function uninstallBrowser(): void {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock('@ricky0123/vad-web');
  env.permission = true;
  env.outputs = [...DEFAULT_OUTPUTS];
  env.inputs = [...DEFAULT_INPUTS];
  env.refuseSampleRate = false;
  env.refuseStreamAttach = false;
  env.autoplayBlocked = false;
  env.startSuspended = false;
}

/** Let queued promise continuations and zero-delay timers run (real timers only). */
export async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Let promise chains run while no timer fires. With `wallClock` this is what a window hidden
 * behind the call looks like to the page: time passes, its timers do not get their turn.
 */
export async function microtasks(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/**
 * Take over performance.now(): from here on only `advance` moves it, and no timer fires when
 * it does. Call it after `vi.useFakeTimers()`; the fake timers stop moving this clock.
 */
export function wallClock(): { advance(ms: number): void } {
  let now = performance.now();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  return {
    advance(ms: number): void {
      now += ms;
    },
  };
}

/** Import the real web modules against the installed fake browser. */
export async function loadApp() {
  vi.resetModules();
  const { createController } = await import('../app/controller');
  const storeModule = await import('../state/store');
  const transcript = await import('../app/transcript');
  return { createController, ...storeModule, ...transcript };
}

/** The audio contexts of the output buses, in the order the controller builds them: outgoing, incoming, monitor. */
export function contexts(): FakeAudioContext[] {
  return FakeAudioContext.instances.filter((context) => context.options.sampleRate === undefined);
}

/** The audio contexts speech detection runs in, in the order the captures started. */
export function captureContexts(): FakeAudioContext[] {
  return FakeAudioContext.instances.filter((context) => context.options.sampleRate !== undefined);
}

const FRAME_SAMPLES = 512;
/** Duration of one detector frame (512 samples at 16 kHz). */
export const FRAME_MS = 32;

/**
 * Someone says a sentence into `detector`: `speechFrames` frames of speech, then
 * `silentFrames` frames of silence (30 is longer than any pause setting, so the utterance ends).
 */
export function say(detector: FakeDetector | undefined, speechFrames = 50, silentFrames = 30): void {
  if (!detector) throw new Error('that capture has not started');
  const speech = new Float32Array(FRAME_SAMPLES).fill(0.2);
  const silence = new Float32Array(FRAME_SAMPLES);
  for (let i = 0; i < speechFrames; i++) detector.options.onFrameProcessed({ isSpeech: 0.95 }, speech);
  for (let i = 0; i < silentFrames; i++) detector.options.onFrameProcessed({ isSpeech: 0.01 }, silence);
}
