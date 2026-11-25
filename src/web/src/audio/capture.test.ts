import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  captureContexts,
  env,
  FakeAudioContext,
  fakeStream,
  installBrowser,
  say,
  uninstallBrowser,
} from '../testing/harness';
import type { Segment } from './segmenter';

afterEach(() => {
  uninstallBrowser();
});

async function setup() {
  const browser = installBrowser();
  // Imported afresh, after this test's fake detection library is in place.
  vi.resetModules();
  const { CaptureChannel } = await import('./capture');
  const { segmenterOptions } = await import('./segmenter');
  const segments: Segment[] = [];
  const speaking: boolean[] = [];
  const capture = new CaptureChannel(
    {
      onSegment: (segment) => segments.push(segment),
      onSpeaking: (value) => speaking.push(value),
      onLevel: () => undefined,
    },
    segmenterOptions('normal', 650),
  );
  return { browser, capture, segments, speaking };
}

describe('CaptureChannel: the audio context speech detection runs in', () => {
  it('runs detection in a 16 kHz context, so the browser does the sample-rate conversion', async () => {
    const { browser, capture } = await setup();
    await capture.start(fakeStream('mic'));
    const [context] = captureContexts();
    expect(context!.options.sampleRate).toBe(16_000);
    expect(browser.detectors[0]!.options.audioContext).toBe(context);
    expect(browser.detectors[0]!.started).toBe(true);
    expect(capture.running).toBe(true);
    // The probe that checked the stream can be attached does not stay connected.
    expect(context!.streamSources.every((node) => !node.connected)).toBe(true);
  });

  it('closes that context when capture stops', async () => {
    const { browser, capture } = await setup();
    await capture.start(fakeStream('mic'));
    const [context] = captureContexts();
    await capture.stop();
    expect(browser.detectors[0]!.destroyed).toBe(true);
    expect(context!.state).toBe('closed');
    expect(capture.running).toBe(false);
  });

  it('closes the context of the previous run when capture is started again', async () => {
    const { capture } = await setup();
    await capture.start(fakeStream('mic'));
    await capture.start(fakeStream('other mic'));
    const [first, second] = captureContexts();
    expect(first!.state).toBe('closed');
    expect(second!.state).toBe('running');
  });

  it("falls back to the library's own context when a 16 kHz context cannot be created", async () => {
    const { browser, capture } = await setup();
    env.refuseSampleRate = true;
    await capture.start(fakeStream('mic'));
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(browser.detectors[0]!.options.audioContext).toBeUndefined();
    expect('audioContext' in browser.detectors[0]!.options).toBe(false);
    expect(capture.running).toBe(true);
  });

  it("falls back to the library's own context when the stream cannot be attached to a 16 kHz context", async () => {
    const { browser, capture } = await setup();
    env.refuseStreamAttach = true;
    await capture.start(fakeStream('mic'));
    expect(browser.detectors[0]!.options.audioContext).toBeUndefined();
    expect(capture.running).toBe(true);
    // The context that turned out to be unusable is not left open.
    expect(captureContexts()[0]!.state).toBe('closed');
  });

  it('does not leave a context open when speech detection fails to start', async () => {
    const { browser, capture } = await setup();
    browser.failDetection(new Error('model could not be loaded'));
    await expect(capture.start(fakeStream('mic'))).rejects.toThrow('model could not be loaded');
    expect(captureContexts()[0]!.state).toBe('closed');
    expect(capture.running).toBe(false);
  });

  it('resumes a context the browser created suspended', async () => {
    const { capture } = await setup();
    env.autoplayBlocked = true;
    await capture.start(fakeStream('mic'));
    expect(captureContexts()[0]!.resumeCalls).toBe(1);
  });
});

describe('CaptureChannel: from detector frames to utterances', () => {
  it('reports the start of speech, then the utterance with how long ago the speech stopped', async () => {
    const { browser, capture, segments, speaking } = await setup();
    await capture.start(fakeStream('mic'));
    say(browser.detectors[0], 50, 0);
    expect(speaking).toEqual([true]);
    expect(segments).toHaveLength(0);
    say(browser.detectors[0], 0, 30);
    expect(speaking).toEqual([true, false]);
    expect(segments).toHaveLength(1);
    // 650 ms of pause, in whole 32 ms frames.
    expect(segments[0]!.trailingSilenceMs).toBe(672);
  });

  it('treats input as silence while the gate is closed', async () => {
    const { browser, capture, segments, speaking } = await setup();
    await capture.start(fakeStream('mic'));
    capture.setGate(true);
    say(browser.detectors[0]);
    expect(speaking).toEqual([]);
    expect(segments).toHaveLength(0);
  });

  it('sends what was being said when capture stops', async () => {
    const { browser, capture, segments } = await setup();
    await capture.start(fakeStream('mic'));
    say(browser.detectors[0], 40, 0);
    await capture.stop();
    expect(segments).toHaveLength(1);
    expect(segments[0]!.trailingSilenceMs).toBe(0);
  });
});
