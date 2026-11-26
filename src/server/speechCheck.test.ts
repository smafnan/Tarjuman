import { describe, expect, it } from 'vitest';

import { SPEECH_CHECK_SENTENCES } from '../shared/api';
import type { SttProvider } from './providers/types';
import { checkRecognition, wordAccuracy } from './speechCheck';

describe('wordAccuracy', () => {
  it('counts a sentence written down exactly, case and punctuation aside, as all right', () => {
    expect(
      wordAccuracy('Guten Morgen, können Sie mich gut hören?', 'guten morgen können sie mich gut hören'),
    ).toBe(1);
  });

  it('takes one word in seven for each word left out, added or changed', () => {
    const said = 'Guten Morgen, können Sie mich gut hören?';
    expect(wordAccuracy(said, 'Guten Morgen, können Sie mich hören?')).toBeCloseTo(6 / 7);
    expect(wordAccuracy(said, 'Guten Morgen, können Sie mich sehr gut hören?')).toBeCloseTo(6 / 7);
    expect(wordAccuracy(said, 'Guten Abend, können Sie mich gut hören?')).toBeCloseTo(6 / 7);
  });

  it('accepts the Arabic letter forms and vowel marks a recognizer may write in Urdu', () => {
    const said = 'صبح بخیر، کیا آپ مجھے اچھی طرح سن سکتے ہیں؟';
    expect(wordAccuracy(said, 'صبح بخير كيا آپ مجھے اچھی طرح سن سکتے ہیں۔')).toBe(1);
    expect(wordAccuracy(said, 'صُبح بخیر کیا آپ مجھے اچھی طرح سن سکتے ہیں')).toBe(1);
  });

  it('gives nothing for nothing, and never less than nothing', () => {
    expect(wordAccuracy('Guten Morgen', '')).toBe(0);
    expect(wordAccuracy('Guten Morgen', 'one two three four five six')).toBe(0);
  });
});

describe('checkRecognition', () => {
  const recognizer = (id: string, fields: Partial<SttProvider>): SttProvider => ({
    id,
    kind: 'stt',
    label: id,
    requiresKey: true,
    timeoutMs: 5_000,
    isConfigured: () => true,
    supportsLanguage: () => true,
    transcribe: async () => ({ text: SPEECH_CHECK_SENTENCES.de }),
    ...fields,
  });

  it('asks every recognizer that is set up, and scores what each wrote down', async () => {
    const pcm = new Int16Array(16_000);
    const report = await checkRecognition(
      [
        recognizer('exact', {}),
        recognizer('wrong', { transcribe: async () => ({ text: 'Vielen Dank fürs Zuschauen.' }) }),
        recognizer('broken', {
          transcribe: async () => {
            throw new Error('HTTP 401');
          },
        }),
        recognizer('absent', { isConfigured: () => false }),
        recognizer('foreign', { supportsLanguage: () => false }),
      ],
      'de',
      pcm,
    );
    expect(report.expected).toBe(SPEECH_CHECK_SENTENCES.de);
    expect(report.results.map((r) => [r.id, r.outcome, r.accuracy])).toEqual([
      ['exact', 'ok', 1],
      ['wrong', 'ok', 0],
      ['broken', 'failed', null],
      ['absent', 'skipped', null],
      ['foreign', 'skipped', null],
    ]);
    expect(report.results[1]?.heard).toBe('Vielen Dank fürs Zuschauen.');
    expect(report.results[2]?.detail).toBe('HTTP 401');
    expect(report.results[4]?.detail).toBe('does not recognize German');
  });
});
