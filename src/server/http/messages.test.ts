import { describe, expect, it } from 'vitest';

import { DEFAULT_SESSION_SETTINGS } from '../../shared/settings';
import { parseAudioHeader, parseClientMessage } from './messages';

const header = {
  type: 'utterance.audio',
  id: 'u1',
  channel: 'incoming',
  sampleRate: 16_000,
  durationMs: 3_000,
  endedAt: 1_700_000_000_000,
  forcedSplit: false,
  playbackLagMs: 0,
};

describe('messages from the browser', () => {
  it('accepts the hint that somebody started to speak', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'speech.start', channel: 'outgoing' }))).toEqual({
      ok: true,
      value: { type: 'speech.start', channel: 'outgoing' },
    });
    expect(parseClientMessage(JSON.stringify({ type: 'speech.start', channel: 'sideways' })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: 'speech.start' })).ok).toBe(false);
  });

  it('repairs settings instead of refusing the session', () => {
    const parsed = parseClientMessage(
      JSON.stringify({
        type: 'session.start',
        protocol: 2,
        settings: { formality: 'casual', glossary: 'no' },
      }),
    );
    expect(parsed).toMatchObject({ ok: true, value: { settings: { formality: 'formal', glossary: [] } } });
    expect(parsed.ok && parsed.value.type === 'session.start' && parsed.value.settings.channels).toEqual(
      DEFAULT_SESSION_SETTINGS.channels,
    );
  });

  it('refuses what is not a message', () => {
    expect(parseClientMessage('{not json')).toEqual({ ok: false, error: 'message is not valid JSON' });
    expect(
      parseClientMessage(
        JSON.stringify({ type: 'utterance.text', id: 'bad id!', channel: 'outgoing', text: 'x' }),
      ).ok,
    ).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: 'no.such.message' })).ok).toBe(false);
  });
});

describe('audio headers from the browser', () => {
  it('accepts a well-formed header', () => {
    expect(parseAudioHeader(header)).toEqual({ ok: true, value: header });
  });

  // A browser whose output device has stalled reports a queue that grows without end.
  // Refusing its audio for that would add "no interpretation at all" to "no sound".
  it('limits an absurd playback queue instead of refusing the utterance', () => {
    expect(parseAudioHeader({ ...header, playbackLagMs: 86_400_000 })).toMatchObject({
      ok: true,
      value: { id: 'u1', playbackLagMs: 600_000 },
    });
  });

  it('refuses other sample rates, negative numbers and missing fields', () => {
    expect(parseAudioHeader({ ...header, sampleRate: 48_000 }).ok).toBe(false);
    expect(parseAudioHeader({ ...header, playbackLagMs: -1 }).ok).toBe(false);
    expect(parseAudioHeader({ ...header, forcedSplit: undefined }).ok).toBe(false);
    expect(parseAudioHeader(null).ok).toBe(false);
  });
});
