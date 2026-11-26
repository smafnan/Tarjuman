import { beforeEach, describe, expect, it } from 'vitest';

import {
  addEntry,
  clearTranscript,
  MAX_TRANSCRIPT_ENTRIES,
  patchEntry,
  transcriptForExport,
  useAppStore,
} from './store';
import type { TranscriptEntry } from './types';

function entry(index: number, fields: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id: `u${index}`,
    channel: 'outgoing',
    createdAt: 1_000 + index,
    typed: false,
    status: 'done',
    sourceLang: 'ur',
    targetLang: 'de',
    sourceText: `sentence ${index}`,
    translations: { de: `Satz ${index}` },
    audioMs: 900,
    latencyMs: 700,
    timings: null,
    providers: {},
    dropReason: null,
    error: null,
    ...fields,
  };
}

const onScreen = () => useAppStore.getState().transcript;

beforeEach(() => {
  clearTranscript();
});

describe('transcript', () => {
  it('caps what is on screen and keeps what scrolled out for the export, in order', () => {
    const total = MAX_TRANSCRIPT_ENTRIES + 25;
    for (let i = 0; i < total; i++) addEntry(entry(i));
    expect(onScreen()).toHaveLength(MAX_TRANSCRIPT_ENTRIES);
    expect(onScreen()[0]!.id).toBe('u25');
    expect(transcriptForExport().map((e) => e.id)).toEqual(Array.from({ length: total }, (_, i) => `u${i}`));
  });

  it('keeps an entry as it was when it scrolled out', () => {
    addEntry(entry(0, { status: 'transcribing', sourceText: null, translations: {} }));
    patchEntry('u0', { status: 'done', sourceText: 'understood later', translations: { de: 'später' } });
    for (let i = 1; i <= MAX_TRANSCRIPT_ENTRIES; i++) addEntry(entry(i));
    expect(onScreen().some((e) => e.id === 'u0')).toBe(false);
    expect(transcriptForExport()[0]).toMatchObject({ id: 'u0', sourceText: 'understood later' });
  });

  it('does not keep what an export would leave out anyway', () => {
    addEntry(entry(0, { sourceText: null })); // never understood
    addEntry(entry(1, { status: 'dropped', dropReason: 'no_speech' })); // rejected as noise
    addEntry(entry(2));
    for (let i = 3; i < MAX_TRANSCRIPT_ENTRIES + 3; i++) addEntry(entry(i));
    expect(transcriptForExport()).toHaveLength(MAX_TRANSCRIPT_ENTRIES + 1);
    expect(transcriptForExport()[0]!.id).toBe('u2');
  });

  it('counts every sentence once, when it first comes out interpreted, past what the screen keeps', () => {
    addEntry(entry(0, { status: 'translating', latencyMs: null }));
    expect(useAppStore.getState().interpreted).toBe(0);
    patchEntry('u0', { status: 'speaking', latencyMs: 1_400 });
    patchEntry('u0', { status: 'done' });
    expect(useAppStore.getState()).toMatchObject({ interpreted: 1, lastDelayMs: 1_400 });

    // A failed or rejected sentence is not interpreted.
    addEntry(entry(1, { status: 'translating', latencyMs: null }));
    patchEntry('u1', { status: 'error', error: 'Translation failed' });
    addEntry(entry(2, { status: 'dropped', dropReason: 'no_speech', latencyMs: null }));
    expect(useAppStore.getState().interpreted).toBe(1);

    // A long call: the total keeps growing after the screen has started to drop old rows.
    for (let i = 3; i < MAX_TRANSCRIPT_ENTRIES + 50; i++) addEntry(entry(i, { latencyMs: i }));
    expect(onScreen()).toHaveLength(MAX_TRANSCRIPT_ENTRIES);
    expect(useAppStore.getState()).toMatchObject({
      interpreted: MAX_TRANSCRIPT_ENTRIES + 48,
      lastDelayMs: MAX_TRANSCRIPT_ENTRIES + 49,
    });
  });

  it('clearTranscript() empties the screen and what was kept', () => {
    for (let i = 0; i < MAX_TRANSCRIPT_ENTRIES + 10; i++) addEntry(entry(i));
    clearTranscript();
    expect(onScreen()).toEqual([]);
    expect(transcriptForExport()).toEqual([]);
    expect(useAppStore.getState()).toMatchObject({ interpreted: 0, lastDelayMs: null });
    addEntry(entry(1_000));
    expect(transcriptForExport().map((e) => e.id)).toEqual(['u1000']);
  });
});
