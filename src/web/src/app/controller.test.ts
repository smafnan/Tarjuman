import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChannelId } from '../../../shared/settings';
import { TAIL_S } from '../audio/silence';
import {
  contexts,
  env,
  FakeWebSocket,
  FRAME_MS,
  installBrowser,
  loadApp,
  microtasks,
  say,
  uninstallBrowser,
  wallClock,
  type BrowserOptions,
} from '../testing/harness';

/**
 * The real controller, store, connection, capture channels and output buses against a fake
 * browser. Timers are faked throughout: `tick()` lets promise chains run and time pass.
 */

afterEach(() => {
  uninstallBrowser();
});

async function tick(ms = 20): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** Wait for something that needs timers to pass before it resolves. */
async function during<T>(pending: Promise<T>, ms = 20): Promise<T> {
  await tick(ms);
  return pending;
}

/** The page has loaded and the server has accepted the session. */
async function openPage(saved: unknown = {}, options: BrowserOptions = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const browser = installBrowser(saved, options);
  const app = await loadApp();
  const controller = app.createController();
  await controller.init();
  const socket = FakeWebSocket.instances[0]!;
  socket.accept();
  const channel = (id: ChannelId) => app.useAppStore.getState().channels[id];
  return { browser, app, controller, socket, channel };
}

const SAVED_DEVICES = {
  outgoing: { sinkId: 'cable-id' },
  incoming: { sinkId: 'phones-id', sourceKind: 'device' },
};

/** Their translation comes out of loudspeakers, so the microphone hears it. */
const LOUDSPEAKERS = { ...SAVED_DEVICES, headphones: false };

/** Longer than a resume() that does not answer is waited for (2 s). */
const GIVEN_UP_MS = 2_100;

/** A call in progress: both captures run. Detector 0 hears me, detector 1 the other side. */
async function runningCall(saved: unknown = SAVED_DEVICES) {
  const page = await openPage(saved);
  await during(page.controller.startChannel('outgoing'));
  await during(page.controller.startChannel('incoming'));
  await tick();
  const [outgoing, incoming, monitor] = contexts();
  return { ...page, outgoing: outgoing!, incoming: incoming!, monitor };
}

describe('a saved output device and a microphone permission that arrives with the first click', () => {
  it('routes my translated voice to the saved virtual cable once the microphone is allowed', async () => {
    // A session without a standing permission ("Allow this time" on the last visit).
    env.permission = false;
    const { browser, app, controller, channel } = await openPage(
      { outgoing: { sinkId: 'cable-id' }, incoming: { sinkId: 'phones-id' } },
      { promptForMicrophone: true },
    );
    env.permission = false; // installBrowser starts every test with the permission granted
    await controller.refreshDevices();
    expect(app.useAppStore.getState().devices.labelsAvailable).toBe(false);

    // The user presses "Start microphone": Chrome shows its permission prompt.
    const starting = controller.startChannel('outgoing');
    await tick();
    const [outgoing, incoming] = contexts();
    // The buses were built while the prompt was still open, so Chrome refused the saved devices.
    expect(outgoing!.sinkCalls).toContain('cable-id');
    expect(outgoing!.sinkId).toBe('');
    expect(channel('outgoing').sinkOk).toBe(false);

    // The user allows the microphone; capture starts, device names become visible.
    browser.mediaDevices.answerPrompt();
    await during(starting);
    await tick();
    const state = app.useAppStore.getState();
    expect(state.channels.outgoing.capture).toBe('capturing');
    expect(state.devices.labelsAvailable).toBe(true);

    // The translation of what I say goes into the cable, not to my own ears.
    expect(outgoing!.sinkId).toBe('cable-id');
    expect(incoming!.sinkId).toBe('phones-id');
    expect(state.channels.outgoing.sinkOk).toBe(true);
    expect(state.channels.outgoing.sinkLabel).toBe('CABLE Input (VB-Audio Virtual Cable)');
    expect(state.channels.incoming.sinkOk).toBe(true);
  });

  it('applies the saved devices when device names become visible without a capture', async () => {
    const { controller, channel } = await openPage({ outgoing: { sinkId: 'cable-id' } });
    env.permission = false;
    await controller.refreshDevices();
    // Typing builds the buses; without a permission the saved device is refused.
    expect(controller.sendText('outgoing', 'Guten Tag')).toBe(true);
    await tick();
    const outgoing = contexts()[0]!;
    expect(outgoing.sinkId).toBe('');
    expect(channel('outgoing').sinkOk).toBe(false);

    // "Show device names" asks for the microphone once.
    await during(controller.unlockDeviceLabels());
    await tick();
    expect(outgoing.sinkId).toBe('cable-id');
    expect(channel('outgoing').sinkOk).toBe(true);
  });

  it('returns to a saved device that is back when the device list is refreshed', async () => {
    const { browser, controller, incoming, channel } = await runningCall();
    const phones = env.outputs.filter((device) => device.deviceId === 'phones-id');
    env.outputs = env.outputs.filter((device) => device.deviceId !== 'phones-id');
    browser.mediaDevices.dispatchEvent(new Event('devicechange'));
    await tick();
    expect(incoming.sinkId).toBe('');
    expect(channel('incoming').sinkOk).toBe(false);

    env.outputs = [...env.outputs, ...phones];
    await during(controller.refreshDevices());
    expect(incoming.sinkId).toBe('phones-id');
    expect(channel('incoming').sinkOk).toBe(true);
  });

  it('routes again once a capture has started, whatever the device list said before', async () => {
    const { controller, outgoing, incoming } = await runningCall();
    controller.stopChannel('incoming');
    outgoing.sinkCalls.length = 0;
    incoming.sinkCalls.length = 0;
    await during(controller.startChannel('incoming'));
    await tick();
    // Once for the click that unlocks audio, once when the capture is up.
    expect(outgoing.sinkCalls).toEqual(['cable-id', 'cable-id']);
    expect(incoming.sinkCalls).toEqual(['phones-id', 'phones-id']);
  });

  it('does not reroute on a refresh when nothing about the devices changed', async () => {
    const { controller, outgoing, incoming } = await runningCall();
    outgoing.sinkCalls.length = 0;
    incoming.sinkCalls.length = 0;
    await during(controller.refreshDevices());
    expect(outgoing.sinkCalls).toEqual([]);
    expect(incoming.sinkCalls).toEqual([]);
  });

  it('finishes one device change before it starts the next for the same channel', async () => {
    const { controller, outgoing, channel } = await runningCall();
    expect(outgoing.sinkId).toBe('cable-id');
    outgoing.sinkCalls.length = 0;

    // The next selection of the cable is refused, after a moment.
    const select = outgoing.setSinkId.bind(outgoing);
    let refuse = true;
    outgoing.setSinkId = async (id: string) => {
      if (id !== 'cable-id' || !refuse) return select(id);
      refuse = false;
      outgoing.sinkCalls.push(id);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      throw new DOMException('device not found', 'NotFoundError');
    };

    const internals = controller as unknown as { applySink(channel: ChannelId): Promise<void> };
    const first = internals.applySink('outgoing'); // refused: falls back to the default device
    const second = internals.applySink('outgoing'); // accepted
    await tick();
    await Promise.all([first, second]);

    // Interleaved, the fallback of the first would have landed after the second had succeeded.
    expect(outgoing.sinkCalls).toEqual(['cable-id', '', 'cable-id']);
    expect(outgoing.sinkId).toBe('cable-id');
    expect(channel('outgoing').sinkOk).toBe(true);
  });
});

describe('the headset fails in the middle of a call', () => {
  it('keeps speaking their translation when the browser lets playback resume', async () => {
    const { browser, socket, incoming, channel } = await runningCall();
    say(browser.detectors[1]);
    socket.interpret(socket.utterances.at(-1)!.id, 'incoming', 4);
    await tick();
    expect(incoming.live).toHaveLength(1);

    // The headset drops out for a moment (Bluetooth reconnect, USB glitch, driver restart).
    incoming.fail();
    browser.mediaDevices.dispatchEvent(new Event('devicechange'));
    await tick();
    expect(incoming.state).toBe('running');
    expect(incoming.live).toHaveLength(1);
    expect(channel('incoming').outputBlocked).toBe(false);

    incoming.advance(5);
    for (let i = 0; i < 3; i++) {
      say(browser.detectors[1]);
      const header = socket.utterances.at(-1)!;
      expect(header.playbackLagMs).toBe(0);
      socket.interpret(header.id, 'incoming', 4);
      await tick();
      expect(channel('incoming').playing).toBe(true);
      incoming.advance(5);
    }
    expect(channel('incoming').playing).toBe(false);
  });

  it('shows that audio is blocked, drops what cannot be heard, and resumes on request', async () => {
    const { browser, socket, controller, incoming, channel } = await runningCall();
    say(browser.detectors[1]);
    socket.interpret(socket.utterances.at(-1)!.id, 'incoming', 4);
    await tick();
    expect(channel('incoming').playing).toBe(true);

    incoming.fail('hangs');
    await tick(GIVEN_UP_MS);
    expect(channel('incoming').outputBlocked).toBe(true);
    expect(channel('outgoing').outputBlocked).toBe(false);
    expect(channel('incoming').playing).toBe(false);
    expect(channel('incoming').queueMs).toBe(0);
    expect(incoming.live).toHaveLength(0);
    // The page selects the device once more by itself, in case it was only replaced; this
    // one does not answer then either.
    await tick(GIVEN_UP_MS);

    // About ten minutes of translated speech arrive over the next part of the call.
    say(browser.detectors[1]);
    const during10Minutes = socket.utterances.at(-1)!;
    for (let i = 0; i < 125; i++) {
      socket.speech({ id: during10Minutes.id, index: i }, 5);
      if (i % 25 === 24) await tick();
    }
    await tick(600);
    say(browser.detectors[1]);
    // The next sentence does not report a backlog that nobody is listening to.
    expect(socket.utterances.at(-1)!.playbackLagMs).toBe(0);
    expect(channel('incoming').queueMs).toBe(0);
    expect(incoming.live).toHaveLength(0);
    expect(channel('incoming').outputBlocked).toBe(true);

    // The headset is back and the user presses "Resume audio".
    incoming.revive();
    await during(controller.resumeAudio());
    expect(channel('incoming').outputBlocked).toBe(false);
    socket.speech({ id: 'after', index: 0 }, 3);
    await tick();
    expect(incoming.live).toHaveLength(1);
    expect(channel('incoming').playing).toBe(true);
  });

  it('clears the flag with any later action that unlocks audio', async () => {
    const { controller, incoming, channel } = await runningCall();
    incoming.fail('ignores');
    await tick(600);
    expect(channel('incoming').outputBlocked).toBe(true);
    incoming.revive();
    controller.sendText('outgoing', 'Einen Moment bitte');
    await tick();
    expect(channel('incoming').outputBlocked).toBe(false);
  });

  it('moves to the default device and says so when the chosen device is gone', async () => {
    const { browser, app, socket, incoming, channel } = await runningCall();
    const blockedSeen: boolean[] = [];
    app.useAppStore.subscribe((state) => blockedSeen.push(state.channels.incoming.outputBlocked));

    // The headset is unplugged. No "devicechange" has been announced yet when the context stops.
    env.outputs = env.outputs.filter((device) => device.deviceId !== 'phones-id');
    incoming.fail('ignores');
    await tick(600);
    await tick(600);
    // It was reported as blocked, and came back by itself on the default device.
    expect(blockedSeen).toContain(true);
    expect(incoming.sinkId).toBe('');
    expect(incoming.state).toBe('running');
    // sinkOk false is what the interface words as "playing on the default device".
    expect(channel('incoming').sinkOk).toBe(false);
    expect(channel('incoming').outputBlocked).toBe(false);

    say(browser.detectors[1]);
    socket.interpret(socket.utterances.at(-1)!.id, 'incoming', 4);
    await tick();
    expect(channel('incoming').playing).toBe(true);
  });

  it('counts the monitor copy of my own translation as part of what I listen to', async () => {
    const { controller, monitor, channel } = await runningCall({
      ...SAVED_DEVICES,
      outgoing: { sinkId: 'cable-id', monitorGain: 0.3 },
    });
    monitor!.fail('rejects');
    await tick(600);
    expect(channel('incoming').outputBlocked).toBe(true);
    monitor!.revive();
    await during(controller.resumeAudio());
    expect(channel('incoming').outputBlocked).toBe(false);
  });
});

describe('a headset that is slow to start', () => {
  it('never shows the banner and speaks what arrived while it was starting', async () => {
    const { app, socket, incoming, channel } = await runningCall();
    const blockedSeen: boolean[] = [];
    app.useAppStore.subscribe((state) => blockedSeen.push(state.channels.incoming.outputBlocked));

    // A Bluetooth headset changes its profile because the microphone opened.
    incoming.fail('hangs');
    await tick(700);
    socket.speech({ id: 'theirs', index: 0 }, 3);
    await tick(800);
    expect(incoming.sources).toHaveLength(0);

    incoming.revive();
    incoming.become('running');
    await tick();
    expect(blockedSeen).not.toContain(true);
    expect(incoming.live).toHaveLength(1);
    expect(channel('incoming').playing).toBe(true);
  });
});

describe('the echo guard with loudspeakers', () => {
  it.each([
    ['wired loudspeakers', 0.04],
    ['a Bluetooth loudspeaker', 0.2],
  ])('listens again 0.6 s after the last sample has left %s', async (_device, outputLatency) => {
    const { browser, socket, incoming, channel } = await runningCall(LOUDSPEAKERS);
    incoming.outputLatency = outputLatency;
    const clock = wallClock();
    const detector = browser.detectors[0]!;
    const echo = new Float32Array(512).fill(0.2);

    // Their translation as the voice service sends it: silence, the sentence, more silence.
    socket.speech({ id: 'theirs', index: 0, last: true }, 2, 0.2, 1.2);
    await microtasks();
    expect(channel('outgoing').gated).toBe(true);
    const lastAudibleAt = incoming.sources[0]!.endsAt - TAIL_S;
    incoming.advance(lastAudibleAt);

    // From the last audible sample on, time passes in steps of 10 ms and the microphone
    // hears something that passes for speech all the while. No timer fires.
    let heardAfterMs = 0;
    while (!channel('outgoing').speaking && heardAfterMs < 3_000) {
      incoming.advance(0.01);
      clock.advance(10);
      heardAfterMs += 10;
      detector.options.onFrameProcessed({ isSpeech: 0.95 }, echo);
    }

    // What is kept after the last audible sample, the way to the loudspeaker, and the margin
    // for the room and the way back in. (It was 0.37 s when the margin was the silence at the
    // end of each chunk, which is no longer played.)
    const expectedMs = (TAIL_S + outputLatency) * 1000 + 600;
    expect(heardAfterMs).toBeGreaterThanOrEqual(expectedMs);
    expect(heardAfterMs).toBeLessThanOrEqual(expectedMs + 10);
  });
});

describe('an output device stops while the window is hidden and no timer fires', () => {
  it('opens the microphone at once and shows the banner when the next speech arrives', async () => {
    const { socket, incoming, channel } = await runningCall(LOUDSPEAKERS);
    const clock = wallClock();
    socket.speech({ id: 'theirs', index: 0 }, 4);
    await microtasks();
    expect(channel('incoming').playing).toBe(true);
    expect(channel('outgoing').gated).toBe(true);

    incoming.fail('hangs');
    // Nothing is heard any more, so nothing has to be kept from the microphone.
    expect(channel('incoming').playing).toBe(false);
    expect(channel('outgoing').gated).toBe(false);
    expect(channel('incoming').outputBlocked).toBe(false);

    clock.advance(1_000);
    socket.speech({ id: 'theirs', index: 1 }, 4);
    await microtasks();
    expect(channel('incoming').outputBlocked).toBe(false);

    clock.advance(1_100);
    socket.speech({ id: 'theirs', index: 2 }, 4);
    await microtasks();
    expect(channel('incoming').outputBlocked).toBe(true);
    expect(incoming.live).toHaveLength(0);
    expect(channel('incoming').queueMs).toBe(0);
  });
});

describe('starting the microphone while an output device is dead', () => {
  it('captures from the first moment instead of waiting for the device', async () => {
    const { browser, controller, socket, incoming, channel } = await runningCall();
    controller.stopChannel('outgoing');
    incoming.fail('hangs');
    await tick(GIVEN_UP_MS);
    await tick(GIVEN_UP_MS);
    expect(channel('incoming').outputBlocked).toBe(true);
    const sentBefore = socket.utterances.length;

    const starting = controller.startChannel('outgoing');
    await tick();
    expect(channel('outgoing').capture).toBe('capturing');
    say(browser.detectors.at(-1));
    expect(socket.utterances).toHaveLength(sentBefore + 1);

    // The click was still used to try the dead headset again, and the outcome is shown.
    await starting;
    await tick(GIVEN_UP_MS);
    expect(incoming.resumeCalls).toBeGreaterThan(1);
    expect(channel('incoming').outputBlocked).toBe(true);
    expect(channel('outgoing').outputBlocked).toBe(false);
  });

  it('starts the capture even when preparing the outputs fails altogether', async () => {
    const { app, controller, channel } = await openPage(SAVED_DEVICES);
    const internals = controller as unknown as { buses: Record<string, { unlock(): Promise<void> }> };
    vi.spyOn(internals.buses.incoming!, 'unlock').mockRejectedValue(new Error('no audio service'));
    await during(controller.startChannel('outgoing'));
    expect(channel('outgoing').capture).toBe('capturing');
    expect(app.useAppStore.getState().notices.map((notice) => notice.message)).toEqual([
      'The audio output could not be prepared: no audio service',
    ]);
  });
});

describe('changing the output device while a translation is being spoken', () => {
  it('keeps the queued speech and moves it to the new device', async () => {
    const { browser, socket, controller, incoming, channel } = await runningCall();
    say(browser.detectors[1]);
    const { id } = socket.utterances.at(-1)!;
    socket.speech({ id, index: 0 }, 4);
    socket.speech({ id, index: 1 }, 4);
    socket.speech({ id, index: 2, last: true }, 4);
    await tick();
    incoming.advance(1);
    expect(incoming.live).toHaveLength(3);

    controller.updateSettings({ incoming: { sinkId: 'cable-id' } });
    await tick();
    expect(incoming.sinkId).toBe('cable-id');
    expect(incoming.live).toHaveLength(3);
    expect(channel('incoming').playing).toBe(true);
    expect(channel('incoming').queueMs).toBeGreaterThan(10_000);
    expect(channel('incoming').outputBlocked).toBe(false);
    expect(channel('incoming').sinkOk).toBe(true);
  });
});

describe('what is sent to the server', () => {
  it('never reports more queued speech than the server accepts', async () => {
    const { browser, socket, channel } = await runningCall();
    for (let i = 0; i < 130; i++) {
      socket.speech({ id: 'long', index: i }, 5);
      if (i % 25 === 24) await tick();
    }
    await tick();
    expect(channel('incoming').queueMs).toBeGreaterThan(600_000);
    say(browser.detectors[1]);
    expect(socket.utterances.at(-1)!.playbackLagMs).toBe(600_000);
  });

  it('tells the server when speech starts on a channel', async () => {
    const { browser, socket } = await runningCall();
    const hints = () => socket.json.filter((message) => message.type === 'speech.start');
    say(browser.detectors[0], 10, 0);
    // Sent with the first speech frame, long before the utterance itself.
    expect(hints()).toEqual([{ type: 'speech.start', channel: 'outgoing' }]);
    expect(socket.utterances).toHaveLength(0);
    say(browser.detectors[0], 40, 30);
    expect(socket.utterances).toHaveLength(1);
    expect(hints()).toHaveLength(1);

    say(browser.detectors[1]);
    expect(hints()).toEqual([
      { type: 'speech.start', channel: 'outgoing' },
      { type: 'speech.start', channel: 'incoming' },
    ]);
  });

  it('sends no hint while there is no connection', async () => {
    const { browser, socket } = await runningCall();
    socket.close();
    await tick(5);
    say(browser.detectors[0], 10, 0);
    const sent = FakeWebSocket.instances.flatMap((instance) => instance.json);
    expect(sent.filter((message) => message.type === 'speech.start')).toEqual([]);
  });
});

describe('latency badge', () => {
  it('counts from the moment the speaker stopped, not from the end of the pause that followed', async () => {
    const { browser, app, socket } = await runningCall({ ...SAVED_DEVICES, pauseMs: 650 });
    const detector = browser.detectors[0]!;
    const speech = new Float32Array(512).fill(0.2);
    for (let i = 0; i < 60; i++) {
      detector.options.onFrameProcessed({ isSpeech: 0.95 }, speech);
      vi.setSystemTime(Date.now() + FRAME_MS);
    }
    const stoppedSpeakingAt = Date.now();
    for (let i = 0; i < 40 && socket.utterances.length === 0; i++) {
      // The frame is processed once its 32 ms have passed.
      vi.setSystemTime(Date.now() + FRAME_MS);
      detector.options.onFrameProcessed({ isSpeech: 0.01 }, new Float32Array(512));
    }
    const entry = app.useAppStore.getState().transcript[0]!;
    expect(Date.now() - stoppedSpeakingAt).toBe(21 * FRAME_MS);
    expect(entry.createdAt).toBe(stoppedSpeakingAt);
    expect(socket.utterances[0]!.endedAt).toBe(stoppedSpeakingAt);

    // The voice starts 500 ms later: that, and not 1.2 s, is what the badge shows.
    vi.setSystemTime(stoppedSpeakingAt + 21 * FRAME_MS + 430);
    socket.speech({ id: entry.id, index: 0, channel: 'outgoing' }, 2);
    await vi.advanceTimersByTimeAsync(0);
    // 430 ms after the report + 30 ms scheduling lead + 40 ms output latency of the fake device.
    expect(app.useAppStore.getState().transcript[0]!.latencyMs).toBe(21 * FRAME_MS + 500);
  });
});

describe('a translation that the server did not speak', () => {
  it('is marked, so that nobody assumes the other side heard it', async () => {
    const { browser, app, socket } = await runningCall();
    for (const notSpoken of [undefined, 'late', 'incomplete'] as const) {
      say(browser.detectors[0], 20, 30);
      const { id } = socket.utterances.at(-1)!;
      socket.say({
        type: 'utterance.transcript',
        id,
        channel: 'outgoing',
        lang: 'ur',
        text: 'جملہ',
        provider: 'stt',
        ms: 1,
      });
      socket.say({
        type: 'utterance.translation',
        id,
        channel: 'outgoing',
        translations: { de: 'Satz.' },
        provider: 'mt',
        ms: 1,
      });
      socket.say({ type: 'utterance.done', id, channel: 'outgoing', timings: { totalMs: 1 }, notSpoken });
    }
    const [spoken, skipped, partly] = app.useAppStore.getState().transcript;
    expect(spoken).toMatchObject({ status: 'done', error: null });
    expect(skipped).toMatchObject({ status: 'done', error: expect.stringMatching(/not spoken/) });
    expect(partly).toMatchObject({ status: 'done', error: expect.stringMatching(/partly spoken/) });
  });
});

describe('the transcript of a long meeting', () => {
  it('exports the beginning of the meeting although the screen no longer shows it', async () => {
    const { browser, app, controller, socket } = await runningCall();
    for (let i = 0; i < 520; i++) {
      say(browser.detectors[0], 20, 30);
      const { id } = socket.utterances.at(-1)!;
      if (i === 5) {
        // Noise that never produced a word leaves no trace in the export.
        socket.say({ type: 'utterance.dropped', id, channel: 'outgoing', reason: 'no_speech' });
        continue;
      }
      socket.say({
        type: 'utterance.transcript',
        id,
        channel: 'outgoing',
        lang: 'ur',
        text: `sentence ${i}.`,
        provider: 'stt',
        ms: 1,
      });
      socket.say({
        type: 'utterance.translation',
        id,
        channel: 'outgoing',
        translations: { de: `Satz ${i}.` },
        provider: 'mt',
        ms: 1,
      });
      socket.say({ type: 'utterance.done', id, channel: 'outgoing', timings: { totalMs: 1 } });
    }
    const onScreen = app.useAppStore.getState().transcript;
    expect(onScreen).toHaveLength(app.MAX_TRANSCRIPT_ENTRIES);
    expect(onScreen[0]!.sourceText).toBe('sentence 20.');

    const all = app.transcriptForExport();
    expect(all).toHaveLength(519);
    expect(all.map((entry) => entry.sourceText).slice(0, 3)).toEqual([
      'sentence 0.',
      'sentence 1.',
      'sentence 2.',
    ]);

    // The download the user gets holds the same.
    let file: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      file = blob as Blob;
      return 'blob:transcript';
    });
    vi.stubGlobal('document', {
      createElement: () => ({ click: () => undefined, remove: () => undefined }),
      body: { append: () => undefined },
    });
    controller.exportTranscript('text');
    const text = await file!.text();
    expect(text).toContain('sentence 0.\n');
    expect(text).toContain('Satz 519.');

    // "Clear" empties the screen and what was kept for the export.
    controller.clearTranscript();
    expect(app.useAppStore.getState().transcript).toEqual([]);
    expect(app.transcriptForExport()).toEqual([]);
    file = undefined;
    controller.exportTranscript('text');
    expect(file).toBeUndefined();
    expect(app.useAppStore.getState().notices.at(-1)!.message).toBe('There is nothing to export yet.');
  });
});

describe('a long call leaves nothing behind', () => {
  it('settles every utterance whatever the outcome', async () => {
    const { browser, app, controller, socket, channel } = await runningCall({
      outgoing: { monitorGain: 0.3 },
    });
    const internals = controller as unknown as {
      open: Map<string, string>;
      chunkCounts: Map<string, number>;
      voiceComplete: Set<string>;
      skipped: Set<string>;
    };
    for (let i = 0; i < 300; i++) {
      say(browser.detectors[0], 20, 30);
      const { id } = socket.utterances.at(-1)!;
      const outcome = i % 6;
      if (outcome === 0) {
        socket.say({ type: 'utterance.dropped', id, channel: 'outgoing', reason: 'no_speech' });
      } else if (outcome === 1) {
        socket.say({
          type: 'utterance.error',
          id,
          channel: 'outgoing',
          stage: 'stt',
          code: 'timeout',
          message: 'x',
        });
      } else {
        socket.say({
          type: 'utterance.transcript',
          id,
          channel: 'outgoing',
          lang: 'ur',
          text: `s ${i}`,
          provider: 'stt',
          ms: 1,
        });
        socket.say({
          type: 'utterance.translation',
          id,
          channel: 'outgoing',
          translations: { de: `S ${i}` },
          provider: 'mt',
          ms: 1,
        });
        if (outcome === 2) {
          controller.flushPlayback('outgoing');
          socket.speech({ id, index: 0, channel: 'outgoing' }, 2);
          socket.say({ type: 'utterance.dropped', id, channel: 'outgoing', reason: 'cancelled' });
        } else if (outcome === 3) {
          socket.speech({ id, index: 0, channel: 'outgoing' }, 2);
          socket.say({
            type: 'utterance.error',
            id,
            channel: 'outgoing',
            stage: 'tts',
            code: 'provider_failed',
            message: 'x',
          });
        } else {
          socket.speech({ id, index: 0, channel: 'outgoing' }, 2);
          socket.speech({ id, index: 1, channel: 'outgoing', last: true }, 2);
          socket.say({ type: 'utterance.done', id, channel: 'outgoing', timings: { totalMs: 1 } });
        }
      }
      await tick(2);
      for (const context of contexts()) context.advance(30);
    }
    await tick();
    for (const context of contexts()) context.advance(30);

    expect(internals.open.size).toBe(0);
    expect(internals.chunkCounts.size).toBe(0);
    expect(internals.voiceComplete.size).toBe(0);
    expect(internals.skipped.size).toBe(0);
    expect(channel('outgoing').pending).toBe(0);
    expect(channel('outgoing').playing).toBe(false);
    expect(channel('outgoing').queueMs).toBe(0);
    expect(contexts().every((context) => context.live.length === 0)).toBe(true);
    const statuses = new Set(app.useAppStore.getState().transcript.map((entry) => entry.status));
    expect([...statuses].sort()).toEqual(['done', 'error']);
  });
});

describe('reconnect in the middle of a call', () => {
  it('tells the truth afterwards', async () => {
    const { browser, app, controller, socket, outgoing, channel } = await runningCall();
    const entry = (id: string) => app.useAppStore.getState().transcript.find((e) => e.id === id)!;
    const translated = (id: string, text: string) => {
      socket.say({
        type: 'utterance.transcript',
        id,
        channel: 'outgoing',
        lang: 'ur',
        text,
        provider: 'stt',
        ms: 1,
      });
      socket.say({
        type: 'utterance.translation',
        id,
        channel: 'outgoing',
        translations: { de: text },
        provider: 'mt',
        ms: 1,
      });
    };

    // Three sentences are under way when the server goes away:
    say(browser.detectors[0]);
    const spoken = socket.utterances.at(-1)!.id; // translated and spoken in full, "done" not yet received
    translated(spoken, 'eins');
    socket.speech({ id: spoken, index: 0, channel: 'outgoing', last: true }, 3);
    say(browser.detectors[0]);
    const halfSpoken = socket.utterances.at(-1)!.id; // translated, the voice had only begun
    translated(halfSpoken, 'zwei');
    socket.speech({ id: halfSpoken, index: 0, channel: 'outgoing' }, 3);
    say(browser.detectors[0]);
    const unheard = socket.utterances.at(-1)!.id; // nothing came back yet
    await tick();
    expect(channel('outgoing').pending).toBe(3);

    socket.close();
    await tick(5);
    expect(app.useAppStore.getState().connection).toBe('reconnecting');
    expect(channel('outgoing').pending).toBe(0);
    // A translation that is on screen was delivered; only the unheard sentence failed.
    expect(entry(spoken)).toMatchObject({ status: 'done', error: null });
    expect(entry(halfSpoken)).toMatchObject({
      status: 'done',
      error: 'The connection to the server was lost before all of this was spoken.',
    });
    expect(entry(unheard)).toMatchObject({
      status: 'error',
      error: 'The connection to the server was lost before this was interpreted.',
    });
    // Speech that had arrived is still played.
    expect(outgoing.live).toHaveLength(2);

    // A sentence spoken while reconnecting is lost, and the page says so.
    say(browser.detectors[0]);
    say(browser.detectors[0]);
    // Typed text is not lost either: the typing box keeps it, because the server does not have it.
    expect(controller.sendText('outgoing', 'Hallo')).toBe(false);
    let state = app.useAppStore.getState();
    expect(state.transcript).toHaveLength(3);
    expect(state.notices.map((notice) => notice.message)).toEqual([
      'Not connected to the server, so speech is not being interpreted right now.',
      'The text was not sent because the server was not connected. It is still in the typing box: send it again once the connection is back.',
    ]);

    // Back again.
    await tick(600);
    const second = FakeWebSocket.instances[1]!;
    second.accept();
    await tick(5);
    state = app.useAppStore.getState();
    expect(state.connection).toBe('connected');
    // "Not being interpreted right now" is no longer true; that the text was not sent still is.
    expect(state.notices.map((notice) => notice.message)).toEqual([
      'The text was not sent because the server was not connected. It is still in the typing box: send it again once the connection is back.',
    ]);
    expect(second.json[0]).toMatchObject({ type: 'session.start', settings: state.settings.session });

    // The call goes on as before.
    say(browser.detectors[0]);
    expect(second.utterances).toHaveLength(1);
    expect(channel('outgoing').pending).toBe(1);
    expect(state.notices.some((notice) => /Not connected/.test(notice.message))).toBe(false);
  });

  it('shows the warning again when the connection drops a second time', async () => {
    const { browser, app, socket } = await runningCall();
    const warnings = () =>
      app.useAppStore.getState().notices.filter((notice) => /Not connected/.test(notice.message));
    socket.close();
    await tick(5);
    say(browser.detectors[0]);
    expect(warnings()).toHaveLength(1);
    await tick(600);
    FakeWebSocket.instances[1]!.accept();
    await tick(5);
    expect(warnings()).toHaveLength(0);

    FakeWebSocket.instances[1]!.close();
    await tick(5);
    say(browser.detectors[0]);
    expect(warnings()).toHaveLength(1);
  });
});
