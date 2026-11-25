import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  env,
  FakeAudioContext,
  fakeStream,
  microtasks,
  testAudio,
  uninstallBrowser,
  UNDECODABLE_AUDIO,
  wallClock,
} from '../testing/harness';
import { OutputBus, type OutputState, type SpeechItem } from './output';
import { LEAD_IN_S, TAIL_S } from './silence';

/** What the bus adds in front of speech that starts on an idle queue. */
const LEAD = 0.03;

function chunk(utteranceId: string, index: number, speechS: number, leadS = 0, tailS = 0): SpeechItem {
  return { utteranceId, index, bytes: testAudio(speechS, leadS, tailS) };
}

function setup() {
  const states: OutputState[] = [];
  const blocked: boolean[] = [];
  const starts: { id: string; at: number }[] = [];
  const bus = new OutputBus({
    onState: (state) => states.push(state),
    onBlocked: (value) => blocked.push(value),
    onUtteranceStart: (id, at) => starts.push({ id, at }),
  });
  return { bus, states, blocked, starts };
}

/** Longer than a resume() that does not answer is waited for (2 s). */
const GIVEN_UP_MS = 2_100;

/** Let promise chains run and `ms` of timer time pass. */
async function tick(ms = 5): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** A bus that has been unlocked by a click, with its context. */
async function unlocked() {
  const made = setup();
  await made.bus.unlock();
  const context = FakeAudioContext.instances[0]!;
  return { ...made, context };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  FakeAudioContext.instances = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  uninstallBrowser();
});

describe('OutputBus: what is played of each chunk', () => {
  it('plays a chunk without the silence it was delivered with', async () => {
    const { bus, context } = await unlocked();
    // What the voice service sends: 0.2 s of silence, the sentence, 1.2 s of silence.
    bus.enqueue(chunk('a', 0, 2, 0.2, 1.2));
    await tick();
    const [source] = context.sources;
    expect(source!.startedAt).toBeCloseTo(LEAD, 6);
    expect(source!.offset).toBeCloseTo(0.2 - LEAD_IN_S, 6);
    expect(source!.duration).toBeCloseTo(2 + LEAD_IN_S + TAIL_S, 6);
    // The queue ends with the audible part, not 1.2 s later.
    expect(bus.queueMs).toBe(Math.round((LEAD + 2 + LEAD_IN_S + TAIL_S) * 1000));
  });

  it('skips a chunk that is silent throughout, at no cost to the listener', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { bus, context, starts } = await unlocked();
    bus.enqueue(chunk('a', 0, 0, 0, 1.5));
    await tick();
    expect(context.sources).toHaveLength(0);
    expect(bus.queueMs).toBe(0);
    expect(starts).toEqual([]);
    // Silence is ordinary, not a failure worth a line in the console.
    expect(warn).not.toHaveBeenCalled();

    // The utterance then starts with its first audible chunk.
    bus.enqueue(chunk('a', 1, 1));
    await tick();
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]!.startedAt).toBeCloseTo(LEAD, 6);
    expect(starts.map((start) => start.id)).toEqual(['a']);
  });

  it('skips a chunk that cannot be decoded and carries on with the next', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { bus, context } = await unlocked();
    bus.enqueue({ utteranceId: 'a', index: 0, bytes: UNDECODABLE_AUDIO });
    bus.enqueue(chunk('a', 1, 1));
    await tick();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(context.live).toHaveLength(1);
  });

  it('reports when the first audio of each utterance will be heard, once', async () => {
    const { bus, starts } = await unlocked();
    bus.enqueue(chunk('a', 0, 1));
    bus.enqueue(chunk('a', 1, 1));
    bus.enqueue(chunk('b', 0, 1));
    const scheduledAt = Date.now();
    await tick();
    expect(starts.map((start) => start.id)).toEqual(['a', 'b']);
    // Scheduling lead plus the device's output latency (0.04 s in the fake context).
    expect(starts[0]!.at - scheduledAt).toBeCloseTo((LEAD + 0.04) * 1000, 3);
  });
});

describe('OutputBus: the pauses between chunks', () => {
  it('leaves 0.22 s between sentences of one utterance and 0.3 s between utterances', async () => {
    const { bus, context } = await unlocked();
    bus.enqueue(chunk('a', 0, 1));
    bus.enqueue(chunk('a', 1, 1));
    bus.enqueue(chunk('b', 0, 1));
    await tick();
    const [first, second, third] = context.sources;
    expect(second!.startedAt! - first!.endsAt).toBeCloseTo(0.22, 6);
    expect(third!.startedAt! - second!.endsAt).toBeCloseTo(0.3, 6);
  });

  it('halves the pauses while more than 2.5 s of speech is waiting', async () => {
    const { bus, context } = await unlocked();
    bus.enqueue(chunk('a', 0, 3));
    bus.enqueue(chunk('a', 1, 1));
    bus.enqueue(chunk('b', 0, 1));
    await tick();
    const [first, second, third] = context.sources;
    expect(second!.startedAt! - first!.endsAt).toBeCloseTo(0.11, 6);
    expect(third!.startedAt! - second!.endsAt).toBeCloseTo(0.15, 6);

    // Once the backlog has been played down, the pauses are whole again.
    context.advance(3);
    bus.enqueue(chunk('b', 1, 1));
    await tick();
    expect(context.sources[3]!.startedAt! - third!.endsAt).toBeCloseTo(0.22, 6);
  });

  it('keeps the pause when the next sentence arrives just after the previous one ended', async () => {
    const { bus, context } = await unlocked();
    bus.enqueue(chunk('a', 0, 1));
    await tick();
    const first = context.sources[0]!;
    context.advance(first.endsAt + 0.05);
    bus.enqueue(chunk('a', 1, 1));
    await tick();
    expect(context.sources[1]!.startedAt! - first.endsAt).toBeCloseTo(0.22, 6);

    // After a long silence there is nothing to keep a distance from.
    context.advance(30);
    bus.enqueue(chunk('b', 0, 1));
    await tick();
    expect(context.sources[2]!.startedAt).toBeCloseTo(context.currentTime + LEAD, 6);
  });
});

describe('OutputBus: switching the output device', () => {
  it('keeps everything that is queued and never reports an interruption', async () => {
    const { bus, context, blocked, states } = await unlocked();
    bus.enqueue(chunk('a', 0, 4));
    bus.enqueue(chunk('a', 1, 4));
    bus.enqueue(chunk('a', 2, 4));
    await tick();
    context.advance(1);
    const queueBefore = bus.queueMs;
    const playingDuringSwitch: boolean[] = [];
    context.addEventListener('statechange', () => playingDuringSwitch.push(bus.playing));

    const switching = bus.setSink('phones-id');
    await tick();
    expect(await switching).toBe(true);

    expect(context.sinkId).toBe('phones-id');
    expect(context.state).toBe('running');
    expect(context.live).toHaveLength(3);
    expect(bus.queueMs).toBe(queueBefore);
    expect(blocked).toEqual([]);
    // The context reported "suspended" and "running"; the bus never looked idle (which would
    // reopen the microphone gate in the middle of the translated speech).
    expect(playingDuringSwitch).toEqual([true, true]);
    expect(states.filter((state) => state.playing).length).toBeGreaterThan(0);
    expect(states.at(-1)!.playing).toBe(true);
    // The browser was not asked to resume: the stop was ours.
    expect(context.resumeCalls).toBe(0);
  });

  it('does not mistake the first device selection of a context that is just starting for a failure', async () => {
    // A new context reports "suspended", starts, and is stopped again for a moment by the
    // selection of its device; the promise resolves before it reports "running" once more.
    env.startSuspended = true;
    vi.spyOn(FakeAudioContext.prototype, 'setSinkId').mockImplementation(async function (
      this: FakeAudioContext,
      id: string,
    ) {
      await Promise.resolve();
      if (this.state === 'suspended') this.become('running');
      await Promise.resolve();
      this.become('suspended');
      await Promise.resolve();
      this.sinkId = id;
      setTimeout(() => this.become('running'), 3);
    });
    const { bus, blocked } = setup();
    await bus.setSink('phones-id');
    const unlocking = bus.unlock();
    await tick();
    await unlocking;
    const context = FakeAudioContext.instances[0]!;
    expect(context.sinkId).toBe('phones-id');
    expect(context.state).toBe('running');
    expect(blocked).toEqual([]);
  });

  it('plays speech that arrives during the switch', async () => {
    const { bus, context } = await unlocked();
    const switching = bus.setSink('phones-id');
    bus.enqueue(chunk('a', 0, 2));
    await tick();
    await switching;
    expect(context.live).toHaveLength(1);
    expect(bus.queueMs).toBeGreaterThan(1_900);
  });

  it('answers false for a device the browser refuses, and keeps playing where it was', async () => {
    const { bus, context, blocked } = await unlocked();
    bus.enqueue(chunk('a', 0, 4));
    await tick();
    const switching = bus.setSink('no-such-device');
    await tick();
    expect(await switching).toBe(false);
    expect(context.live).toHaveLength(1);
    expect(blocked).toEqual([]);
  });

  it('reports a device that never starts playing after the switch', async () => {
    const { bus, context, blocked } = await unlocked();
    bus.enqueue(chunk('a', 0, 4));
    await tick();
    context.dead = 'ignores';
    const switching = bus.setSink('phones-id');
    await tick(600);
    await switching;
    await tick(600);
    expect(blocked).toEqual([true]);
    expect(context.live).toHaveLength(0);
    expect(bus.queueMs).toBe(0);
  });
});

describe('OutputBus: the output device fails', () => {
  it('resumes a context the browser suspended and keeps what was queued', async () => {
    const { bus, context, blocked } = await unlocked();
    bus.enqueue(chunk('a', 0, 4));
    bus.enqueue(chunk('a', 1, 4));
    await tick();
    const queueBefore = bus.queueMs;

    context.fail();
    await tick();

    expect(context.resumeCalls).toBe(1);
    expect(context.state).toBe('running');
    expect(context.live).toHaveLength(2);
    expect(bus.queueMs).toBe(queueBefore);
    expect(blocked).toEqual([]);
  });

  for (const dead of ['ignores', 'hangs', 'rejects'] as const) {
    it(`gives up the queue and says so when resume() ${dead} (device gone for good)`, async () => {
      const { bus, context, blocked, states } = await unlocked();
      bus.enqueue(chunk('a', 0, 4));
      bus.enqueue(chunk('a', 1, 4));
      await tick();
      expect(bus.playing).toBe(true);

      context.fail(dead);
      await tick(GIVEN_UP_MS);

      expect(blocked).toEqual([true]);
      expect(context.live).toHaveLength(0);
      expect(bus.playing).toBe(false);
      expect(bus.queueMs).toBe(0);
      expect(states.at(-1)).toEqual({ playing: false, queueMs: 0 });

      // Ten minutes of further speech: none of it is scheduled on the clock that stands still.
      const resumeCalls = context.resumeCalls;
      for (let i = 0; i < 120; i++) bus.enqueue(chunk(`later-${i}`, 0, 5));
      await tick(600);
      expect(context.sources).toHaveLength(2);
      expect(bus.queueMs).toBe(0);
      expect(blocked).toEqual([true]);
      // Nor does each chunk wait for another attempt to resume: once the device is back,
      // such a backlog would be spoken long after it was said.
      expect(context.resumeCalls).toBe(resumeCalls);
    });
  }

  it('does not keep the caller of unlock() waiting on a device that does not answer', async () => {
    const { bus, context, blocked } = await unlocked();
    context.fail('hangs');
    await tick(GIVEN_UP_MS);
    let returned = false;
    void bus.unlock().then(() => {
      returned = true;
    });
    await tick(GIVEN_UP_MS);
    expect(returned).toBe(true);
    expect(blocked).toEqual([true]);
  });

  it('comes back when unlock() is called after the device works again', async () => {
    const { bus, context, blocked } = await unlocked();
    bus.enqueue(chunk('a', 0, 4));
    await tick();
    context.fail('ignores');
    await tick(600);
    expect(blocked).toEqual([true]);

    context.revive();
    await bus.unlock();
    expect(blocked).toEqual([true, false]);
    expect(context.state).toBe('running');

    bus.enqueue(chunk('b', 0, 2));
    await tick();
    expect(context.live).toHaveLength(1);
    expect(bus.playing).toBe(true);
  });

  it('comes back when a device is selected that plays', async () => {
    const { bus, context, blocked } = await unlocked();
    context.fail('ignores');
    await tick(600);
    expect(blocked).toEqual([true]);

    // The owner falls back to the default device, and this one renders.
    context.revive();
    const switching = bus.setSink('');
    await tick();
    expect(await switching).toBe(true);
    expect(blocked).toEqual([true, false]);
  });

  it('notices when the browser restarts the context by itself', async () => {
    const { context, blocked } = await unlocked();
    context.fail('ignores');
    await tick(600);
    context.revive();
    await context.resume(); // stands for Chrome resuming once the driver is back
    expect(blocked).toEqual([true, false]);
  });

  it('builds a new context on the configured device when the old one was closed', async () => {
    const { bus, context, blocked } = await unlocked();
    const stream = fakeStream('original voice');
    bus.setPassthrough(stream);
    const switching = bus.setSink('phones-id');
    await tick();
    await switching;
    bus.enqueue(chunk('a', 0, 4));
    await tick();

    await context.close();
    await tick();
    expect(blocked).toEqual([true]);
    expect(bus.queueMs).toBe(0);

    const unlocking = bus.unlock();
    await tick();
    await unlocking;
    const rebuilt = FakeAudioContext.instances[1]!;
    expect(rebuilt).not.toBe(context);
    expect(rebuilt.sinkId).toBe('phones-id');
    expect(rebuilt.streamSources).toHaveLength(1);
    expect(blocked).toEqual([true, false]);

    bus.enqueue(chunk('b', 0, 2));
    await tick();
    expect(rebuilt.live).toHaveLength(1);
    // The new clock starts at zero: nothing of the old queue is carried over.
    expect(rebuilt.live[0]!.startedAt).toBeCloseTo(LEAD, 6);
  });
});

describe('OutputBus: the end of the speech, as the echo guard sees it', () => {
  /** A sentence as the voice service sends it, played to its last sample by the clock of the context. */
  async function spoken(outputLatency: number) {
    const made = await unlocked();
    made.context.outputLatency = outputLatency;
    made.bus.enqueue(chunk('a', 0, 2, 0.2, 1.2));
    await microtasks();
    const source = made.context.sources[0]!;
    made.context.advance(source.endsAt);
    expect(source.ended).toBe(true);
    return { ...made, source };
  }

  it.each([
    ['a wired device', 0.04, 40],
    ['a Bluetooth loudspeaker', 0.2, 200],
    ['a device that reports no latency', Number.NaN, 0],
    ['a device that reports nonsense', 30, 500],
  ])('counts as playing until the last sample has left %s', async (_device, latency, expectedMs) => {
    const { context, states } = await spoken(latency);
    // No timer fires here: the moment has to be found by the audio clock alone.
    let heldMs = 0;
    while (states.at(-1)!.playing && heldMs < 2_000) {
      context.advance(0.01);
      heldMs += 10;
    }
    expect(heldMs).toBeGreaterThanOrEqual(expectedMs);
    expect(heldMs).toBeLessThanOrEqual(expectedMs + 10);
    expect(states.at(-1)).toEqual({ playing: false, queueMs: 0 });
  });

  it('does not report an end while the next sentence follows within that moment', async () => {
    const { bus, context, states } = await spoken(0.2);
    context.advance(0.05);
    const from = states.length;
    bus.enqueue(chunk('a', 1, 1));
    await microtasks();
    // The moment the first sentence would have left the device passes.
    context.advance(0.3);
    expect(states.slice(from).every((state) => state.playing)).toBe(true);

    const second = context.sources[1]!;
    context.advance(second.endsAt - context.currentTime + 0.25);
    expect(states.at(-1)).toEqual({ playing: false, queueMs: 0 });
  });

  it('ends at once with "skip to live"', async () => {
    const { bus, context, states } = await spoken(0.2);
    expect(states.at(-1)!.playing).toBe(true);
    bus.flush();
    expect(states.at(-1)).toEqual({ playing: false, queueMs: 0 });
    expect(context.marks.every((mark) => mark.stopped)).toBe(true);
  });
});

describe('OutputBus: the device stops in a hidden window, where timers do not fire', () => {
  it('says at once that nothing is heard, before it is known whether the device comes back', async () => {
    const { bus, context, blocked, states } = await unlocked();
    bus.enqueue(chunk('a', 0, 4));
    await microtasks();
    expect(states.at(-1)!.playing).toBe(true);

    context.fail('hangs');
    expect(states.at(-1)!.playing).toBe(false);
    expect(blocked).toEqual([]);
  });

  it('gives the device up when the next speech arrives after the wait is over', async () => {
    const clock = wallClock();
    const { bus, context, blocked, states } = await unlocked();
    bus.enqueue(chunk('a', 0, 4));
    await microtasks();
    context.fail('hangs');

    // Within the wait: held, neither played nor given up.
    clock.advance(1_000);
    bus.enqueue(chunk('b', 0, 2));
    await microtasks();
    expect(blocked).toEqual([]);
    expect(context.sources).toHaveLength(1);

    clock.advance(1_100);
    bus.enqueue(chunk('b', 1, 2));
    await microtasks();
    expect(blocked).toEqual([true]);
    expect(context.live).toHaveLength(0);
    expect(context.sources).toHaveLength(1);
    expect(bus.queueMs).toBe(0);
    expect(states.at(-1)).toEqual({ playing: false, queueMs: 0 });

    // What arrives from now on is dropped without another wait.
    const resumeCalls = context.resumeCalls;
    bus.enqueue(chunk('c', 0, 2));
    await microtasks();
    expect(context.sources).toHaveLength(1);
    expect(context.resumeCalls).toBe(resumeCalls);
  });

  for (const dead of ['ignores', 'rejects'] as const) {
    it(`gives the device up at once when resume() ${dead}`, async () => {
      const { bus, context, blocked } = await unlocked();
      bus.enqueue(chunk('a', 0, 4));
      await microtasks();
      context.fail(dead);
      await microtasks();
      expect(blocked).toEqual([true]);
      expect(context.live).toHaveLength(0);
    });
  }

  it('speaks nothing late when the device comes back after the wait was over', async () => {
    const clock = wallClock();
    const { bus, context, blocked, starts } = await unlocked();
    bus.enqueue(chunk('a', 0, 4));
    bus.enqueue(chunk('a', 1, 4));
    await microtasks();
    context.advance(1);
    context.fail('hangs');

    clock.advance(100);
    bus.enqueue(chunk('b', 0, 2));
    await microtasks();

    // Five seconds later the driver is back. No timer has fired and no speech has arrived.
    clock.advance(5_000);
    context.revive();
    context.become('running');
    await microtasks();
    // Neither the rest of "a" nor the held "b" is spoken five seconds after it was due.
    expect(context.live).toHaveLength(0);
    expect(starts.map((start) => start.id)).toEqual(['a']);
    expect(blocked).toEqual([]);

    // The bus plays what is said from now on.
    bus.enqueue(chunk('c', 0, 2));
    await microtasks();
    expect(context.live).toHaveLength(1);
    expect(context.live[0]!.startedAt).toBeCloseTo(context.currentTime + LEAD, 6);
  });

  it('drops speech that waited more than three seconds for a device switch, and plays the rest', async () => {
    const clock = wallClock();
    const { bus, context, starts } = await unlocked();
    let finishSwitch: () => void = () => undefined;
    vi.spyOn(context, 'setSinkId').mockImplementation(
      (id: string) =>
        new Promise<void>((resolve) => {
          finishSwitch = () => {
            context.sinkId = id;
            resolve();
          };
        }),
    );

    const switching = bus.setSink('phones-id');
    bus.enqueue(chunk('old', 0, 2));
    clock.advance(2_000);
    bus.enqueue(chunk('recent', 0, 2));
    clock.advance(1_500);
    finishSwitch();
    await microtasks();
    expect(await switching).toBe(true);

    expect(starts.map((start) => start.id)).toEqual(['recent']);
    expect(context.live).toHaveLength(1);
  });
});

describe('OutputBus: a device that is slow to start', () => {
  it('waits two seconds for a resume() that has not answered, and plays what arrived meanwhile', async () => {
    const { bus, context, blocked } = await unlocked();
    bus.enqueue(chunk('a', 0, 4));
    await tick();
    // A Bluetooth headset changes its profile because the microphone opened.
    context.fail('hangs');
    await tick(700);
    expect(blocked).toEqual([]);
    bus.enqueue(chunk('a', 1, 2));
    await tick(800);
    expect(blocked).toEqual([]);
    expect(context.sources).toHaveLength(1);

    context.revive();
    context.become('running');
    await tick();
    expect(blocked).toEqual([]);
    expect(context.live).toHaveLength(2);
    expect(bus.playing).toBe(true);
  });

  it('holds speech that arrives while a click is starting a blocked bus', async () => {
    const { bus, context, blocked } = await unlocked();
    context.fail('hangs');
    await tick(GIVEN_UP_MS);
    expect(blocked).toEqual([true]);

    // "Resume audio": the headset needs a second to wake up.
    const unlocking = bus.unlock();
    bus.enqueue(chunk('a', 0, 2));
    await tick(1_000);
    expect(context.sources).toHaveLength(0);
    context.revive();
    context.become('running');
    await tick();
    await unlocking;
    expect(blocked).toEqual([true, false]);
    expect(context.live).toHaveLength(1);
  });

  it('drops that speech when the click does not start the bus either', async () => {
    const { bus, context, blocked } = await unlocked();
    context.fail('hangs');
    await tick(GIVEN_UP_MS);

    const unlocking = bus.unlock();
    bus.enqueue(chunk('a', 0, 2));
    await tick(GIVEN_UP_MS);
    await unlocking;
    expect(blocked).toEqual([true]);

    // Not kept for whenever the device returns.
    context.revive();
    await bus.unlock();
    await tick();
    expect(blocked).toEqual([true, false]);
    expect(context.sources).toHaveLength(0);
  });
});

describe('OutputBus: audio that was never allowed to start', () => {
  it('reports it instead of queueing speech nobody hears, and starts with the first click', async () => {
    env.autoplayBlocked = true;
    const { bus, blocked } = setup();
    bus.enqueue(chunk('a', 0, 3));
    bus.enqueue(chunk('a', 1, 3));
    await tick(GIVEN_UP_MS);
    const context = FakeAudioContext.instances[0]!;
    expect(context.state).toBe('suspended');
    expect(context.sources).toHaveLength(0);
    expect(bus.queueMs).toBe(0);
    expect(blocked).toEqual([true]);

    context.revive(); // a click makes resume() work
    await bus.unlock();
    expect(blocked).toEqual([true, false]);
    bus.enqueue(chunk('b', 0, 2));
    await tick();
    expect(context.live).toHaveLength(1);
  });
});

describe('OutputBus: skip to live', () => {
  it('stops and discards everything, including chunks still being decoded', async () => {
    const { bus, context, states } = await unlocked();
    bus.enqueue(chunk('a', 0, 4));
    await tick();
    bus.enqueue(chunk('a', 1, 4));
    bus.flush();
    await tick();
    expect(context.live).toHaveLength(0);
    expect(context.sources).toHaveLength(1);
    expect(states.at(-1)).toEqual({ playing: false, queueMs: 0 });
  });

  it('treats whatever is heard next as a new start, even from the same utterance', async () => {
    const { bus, context, starts } = await unlocked();
    bus.enqueue(chunk('a', 0, 4));
    await tick();
    bus.flush();
    context.advance(1);
    bus.enqueue(chunk('a', 1, 2));
    await tick();
    expect(starts.map((start) => start.id)).toEqual(['a', 'a']);
    expect(context.sources[1]!.startedAt).toBeCloseTo(context.currentTime + LEAD, 6);
  });
});
