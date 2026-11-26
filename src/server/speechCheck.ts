import { SPEECH_CHECK_SENTENCES, type SpeechCheckReport, type SpeechCheckResult } from '../shared/api';
import { LANGUAGES, type LangCode } from '../shared/languages';
import { UTTERANCE_SAMPLE_RATE } from '../shared/protocol';
import type { ProviderBase, SttProvider } from './providers/types';

/**
 * The speech check: a known sentence, spoken by the app's own voice and decoded by the browser,
 * is given to every recognizer, and what each one writes down is compared with the sentence.
 * Unlike the tone in the provider test, this measures recognition itself.
 */

const CHECK_TIMEOUT_MS = 15_000;

/** Why a provider was not asked: it is not set up. */
export function notSetUpReason(provider: ProviderBase): string {
  return provider.unconfiguredReason?.() ?? (provider.requiresKey ? 'API key not set' : 'not configured');
}

/** The words of a sentence as a recognizer may fairly write them: case, punctuation and vowel marks aside. */
function words(text: string): string[] {
  return (
    text
      .normalize('NFKC')
      .toLowerCase()
      // Arabic letter forms that recognizers sometimes write for their Urdu twins.
      .replace(/[يى]/g, 'ی')
      .replace(/ك/g, 'ک')
      // Vowel marks, and the joiners that only change how letters connect.
      .replace(/[\p{M}‌‍]/gu, '')
      // Punctuation and symbols, the Urdu full stop, comma and question mark included.
      .replace(/[\p{P}\p{S}]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );
}

/**
 * The share of `expected`'s words that `heard` got right, from 0 to 1: one minus the word
 * error rate (words left out, added or changed, over the words of the sentence).
 */
export function wordAccuracy(expected: string, heard: string): number {
  const said = words(expected);
  const written = words(heard);
  if (said.length === 0) return written.length === 0 ? 1 : 0;
  let previous = Array.from({ length: written.length + 1 }, (_, j) => j);
  for (let i = 1; i <= said.length; i++) {
    const current = [i];
    for (let j = 1; j <= written.length; j++) {
      const change = said[i - 1] === written[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + change,
      );
    }
    previous = current;
  }
  return Math.max(0, 1 - (previous[written.length] ?? said.length) / said.length);
}

async function hearSentence(
  provider: SttProvider,
  lang: LangCode,
  pcm: Int16Array,
  expected: string,
): Promise<SpeechCheckResult> {
  const base = { id: provider.id, label: provider.label, heard: '', accuracy: null };
  if (!provider.isConfigured())
    return { ...base, outcome: 'skipped', ms: 0, detail: notSetUpReason(provider) };
  if (!provider.supportsLanguage(lang)) {
    return { ...base, outcome: 'skipped', ms: 0, detail: `does not recognize ${LANGUAGES[lang].name}` };
  }
  const signal = AbortSignal.timeout(CHECK_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const result = await provider.transcribe({
      pcm,
      sampleRate: UTTERANCE_SAMPLE_RATE,
      language: lang,
      hints: [],
      signal,
    });
    const heard = result.text.trim();
    return {
      ...base,
      outcome: 'ok',
      ms: Date.now() - startedAt,
      heard,
      accuracy: wordAccuracy(expected, heard),
      detail: '',
    };
  } catch (error) {
    const detail = signal.aborted
      ? `no answer within ${CHECK_TIMEOUT_MS / 1000} s`
      : error instanceof Error
        ? error.message
        : String(error);
    return { ...base, outcome: 'failed', ms: Date.now() - startedAt, detail };
  }
}

/**
 * Ask every recognizer to write down `pcm`, the check sentence of `lang` as spoken. One after
 * another: several of them share a key and its rate limit.
 */
export async function checkRecognition(
  recognizers: readonly SttProvider[],
  lang: LangCode,
  pcm: Int16Array,
): Promise<SpeechCheckReport> {
  const expected = SPEECH_CHECK_SENTENCES[lang];
  const results: SpeechCheckResult[] = [];
  for (const provider of recognizers) results.push(await hearSentence(provider, lang, pcm, expected));
  return { lang, expected, results };
}
