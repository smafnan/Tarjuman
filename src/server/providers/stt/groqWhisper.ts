import type { LangCode } from '../../../shared/languages';
import { pcm16ToWav } from '../../../shared/protocol';
import { httpRequest, readJson } from '../http';
import { arabicScriptRatio } from '../mt/prompt';
import { ProviderError, type SttProvider, type SttRequest, type SttResult } from '../types';

/**
 * Whisper on Groq's OpenAI-compatible transcription endpoint.
 *
 * Free tier (per model, per organisation): 20 requests/min, 2,000 requests/day,
 * 7,200 audio-seconds/hour. Each Whisper model has its own bucket, which is why
 * large-v3 and large-v3-turbo are registered as two providers.
 */

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
/** A cheap address on the same host, fetched (without the key) to open the connection early. */
const WARM_URL = 'https://api.groq.com/openai/v1/models';

/** Whisper accepts a prompt of at most 224 tokens; stay well below with a character cap. */
const MAX_PROMPT_CHARS = 400;

export interface WhisperSegment {
  text?: string;
  start?: number;
  end?: number;
  avg_logprob?: number;
  compression_ratio?: number;
  no_speech_prob?: number;
}

export interface WhisperVerboseResponse {
  text?: string;
  segments?: WhisperSegment[];
}

/**
 * Whisper's own criteria for "this is not speech" (openai/whisper transcribe.py defaults):
 * a segment is silence when the no-speech probability is above the first AND the average
 * log-probability below the second.
 */
export const WHISPER_NO_SPEECH_THRESHOLD = 0.6;
export const WHISPER_LOGPROB_THRESHOLD = -1.0;

/**
 * Above this compression ratio the text is a decoding loop. Whisper's default of 2.4 was
 * tuned on Latin script; Urdu takes two bytes per letter in UTF-8 and compresses better, so
 * ordinary enumerations ("first instalment …, second instalment …") reach 2.4-2.5 while real
 * loops measure 3 and (far) above.
 */
export function compressionRatioLimit(text: string): number {
  return /\p{L}/u.test(text) && arabicScriptRatio(text) > 0.5 ? 3.0 : 2.4;
}

/**
 * Opening sentence of the Whisper prompt, per language. Exported because Whisper sometimes
 * echoes its prompt back when the audio is unintelligible; the hallucination filter needs
 * to recognise that.
 */
export const WHISPER_PROMPT_LEAD: Record<LangCode, string> = {
  ur: 'یہ ایک کاروباری میٹنگ کی گفتگو ہے۔',
  de: 'Dies ist ein Gespräch in einem geschäftlichen Meeting.',
  en: 'This is a conversation in a business meeting.',
};

/**
 * A short text in the spoken language that biases Whisper towards the right script and the
 * right spelling of names and terms. Whisper treats the prompt as "what was said just before".
 */
export function buildWhisperPrompt(language: LangCode, hints: readonly string[]): string {
  let prompt = WHISPER_PROMPT_LEAD[language];
  const terms: string[] = [];
  for (const hint of hints) {
    const term = hint.trim();
    if (!term) continue;
    if (prompt.length + terms.join(', ').length + term.length + 2 > MAX_PROMPT_CHARS) break;
    terms.push(term);
  }
  if (terms.length > 0) prompt += ` ${terms.join(', ')}.`;
  return prompt;
}

/** Combine per-segment confidence signals into one figure per utterance. */
export function summarizeSegments(segments: readonly WhisperSegment[]): Omit<SttResult, 'text'> {
  let weight = 0;
  let logProbSum = 0;
  let noSpeechSum = 0;
  let compression: number | undefined;
  for (const segment of segments) {
    const duration = Math.max(0.05, (segment.end ?? 0) - (segment.start ?? 0));
    if (typeof segment.avg_logprob === 'number' && typeof segment.no_speech_prob === 'number') {
      weight += duration;
      logProbSum += segment.avg_logprob * duration;
      noSpeechSum += segment.no_speech_prob * duration;
    }
    if (typeof segment.compression_ratio === 'number') {
      compression = Math.max(compression ?? 0, segment.compression_ratio);
    }
  }
  if (weight === 0) return { compressionRatio: compression };
  return {
    avgLogProb: logProbSum / weight,
    noSpeechProb: noSpeechSum / weight,
    compressionRatio: compression,
  };
}

function failsWhisperCriteria(segment: WhisperSegment, compressionLimit: number): boolean {
  const silent =
    typeof segment.no_speech_prob === 'number' &&
    typeof segment.avg_logprob === 'number' &&
    segment.no_speech_prob > WHISPER_NO_SPEECH_THRESHOLD &&
    segment.avg_logprob < WHISPER_LOGPROB_THRESHOLD;
  const looping =
    typeof segment.compression_ratio === 'number' && segment.compression_ratio > compressionLimit;
  return silent || looping;
}

/**
 * Reference Whisper measures confidence per 30-second window and copies the figures into
 * every segment of it. An utterance fits into one window, so identical figures in all
 * segments say nothing about any one of them.
 */
function measuredPerSegment(segments: readonly WhisperSegment[]): boolean {
  const first = segments[0];
  return segments.some(
    (segment) =>
      segment.avg_logprob !== first?.avg_logprob ||
      segment.no_speech_prob !== first?.no_speech_prob ||
      segment.compression_ratio !== first?.compression_ratio,
  );
}

function secondsOf(segments: readonly WhisperSegment[]): number {
  return segments.reduce((sum, segment) => sum + Math.max(0, (segment.end ?? 0) - (segment.start ?? 0)), 0);
}

/** A stock phrase ("Vielen Dank für Ihre Aufmerksamkeit.") has no more words than this. */
const FEW_WORDS = 5;

/**
 * Text and confidence of a transcription, judged segment by segment where that is possible.
 *
 * When each segment has its own confidence, one invented segment (a "thanks for watching"
 * after the speaker stopped, a short loop) must neither discard the clear speech around it
 * nor hide in an average over it: such segments are left out, and the confidence describes
 * the ones that are kept.
 *
 * Everything is returned as it came, for the caller's filter to judge on the summary, when
 * leaving segments out cannot be trusted: no segment is usable, the figures are the same for
 * all segments, or what would be left is a few words from audio that was mostly rejected
 * (a "Danke." with clean figures after a long loop would pass as speech).
 */
export function transcriptFromSegments(response: WhisperVerboseResponse): SttResult | undefined {
  if (typeof response.text !== 'string') return undefined;
  const segments = response.segments ?? [];
  const unfiltered = { text: response.text, ...summarizeSegments(segments) };
  if (!measuredPerSegment(segments) || !segments.every((segment) => typeof segment.text === 'string')) {
    return unfiltered;
  }
  // One limit for the utterance: in Urdu with English mixed in, a limit per segment would
  // cut out exactly the English segments, which the Latin-script limit misjudges as loops.
  const compressionLimit = compressionRatioLimit(response.text);
  const kept = segments.filter((segment) => !failsWhisperCriteria(segment, compressionLimit));
  if (kept.length === 0 || kept.length === segments.length) return unfiltered;
  const text = kept
    .map((segment) => (segment.text ?? '').trim())
    .filter(Boolean)
    .join(' ');
  const removed = segments.filter((segment) => !kept.includes(segment));
  const fewWords = (text.match(/[\p{L}\p{N}]+/gu) ?? []).length <= FEW_WORDS;
  if (fewWords && secondsOf(removed) > secondsOf(kept)) return unfiltered;
  return { text, ...summarizeSegments(kept) };
}

export interface GroqWhisperOptions {
  id: string;
  model: string;
  getKey: () => string | undefined;
  fetchImpl?: typeof fetch;
  /** Opens a connection to the host of a URL ahead of a request (see `prepare`). */
  warm?: (url: string) => void;
}

export class GroqWhisperProvider implements SttProvider {
  readonly kind = 'stt' as const;
  readonly requiresKey = true;
  /** Stay just under the documented 20 requests/min so we fall over before provoking a 429. */
  readonly requestsPerMinute = 18;
  readonly timeoutMs = 8_000;
  readonly id: string;
  readonly label: string;

  constructor(private readonly options: GroqWhisperOptions) {
    this.id = options.id;
    this.label = `Groq · ${options.model}`;
  }

  isConfigured(): boolean {
    return Boolean(this.options.getKey());
  }

  supportsLanguage(): boolean {
    return true;
  }

  prepare(): void {
    if (this.isConfigured()) this.options.warm?.(WARM_URL);
  }

  async transcribe(request: SttRequest): Promise<SttResult> {
    const apiKey = this.options.getKey();
    if (!apiKey) throw new ProviderError(this.id, 'auth', 'GROQ_API_KEY is not set');

    const wav = pcm16ToWav(request.pcm, request.sampleRate);
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'utterance.wav');
    form.append('model', this.options.model);
    // Always pin the language: auto-detection turns Urdu into Hindi (Devanagari) far too often.
    form.append('language', request.language);
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    form.append('prompt', buildWhisperPrompt(request.language, request.hints));

    const response = await httpRequest({
      providerId: this.id,
      url: ENDPOINT,
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: request.signal,
      fetchImpl: this.options.fetchImpl,
    });
    const json = await readJson<WhisperVerboseResponse>(this.id, response);
    const result = transcriptFromSegments(json);
    if (!result) {
      throw new ProviderError(this.id, 'bad_response', 'transcription response has no "text" field');
    }
    return result;
  }
}
