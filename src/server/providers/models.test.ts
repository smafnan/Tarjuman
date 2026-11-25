import { describe, expect, it } from 'vitest';

import {
  bodyOf,
  fakeFetch,
  jsonResponse,
  mtRequest,
  must,
  tonePcm,
  translationJob,
} from '../../../tests/unit/helpers';
import {
  buildGeminiBody,
  GeminiAudioSttProvider,
  GeminiMtProvider,
  GeminiNegotiator,
  GemmaMtProvider,
} from './gemini';
import { buildChatBody, OpenAiCompatMtProvider } from './mt/openaiCompat';
import { MyMemoryProvider, queryPieces } from './mt/myMemory';
import {
  buildWhisperPrompt,
  GroqWhisperProvider,
  summarizeSegments,
  transcriptFromSegments,
} from './stt/groqWhisper';
import { AzureTtsProvider, parseAzureCredentials } from './tts/azure';
import { resolveVoice, ssmlRate } from './tts/voices';
import { ProviderError } from './types';

const GERMAN = 'Wir veröffentlichen nächste Woche die neue Version.';
const ENGLISH = 'We will release the new version next week.';
const URDU = 'ہم اگلے ہفتے نیا ورژن جاری کریں گے۔';

const geminiAnswer = (payload: unknown, extra: Record<string, unknown> = {}) =>
  jsonResponse({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] }, finishReason: 'STOP' }],
    ...extra,
  });

async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe('Gemini', () => {
  it('sends the key in a header, never in the URL, with schema and minimal thinking', async () => {
    const { fetch, calls } = fakeFetch(() => geminiAnswer({ skip: false, en: ENGLISH, de: GERMAN }));
    const provider = new GeminiMtProvider({
      getKey: () => 'secret-key',
      models: ['model-a'],
      fetchImpl: fetch,
    });

    const result = await provider.translate(mtRequest());

    expect(result).toEqual({ translations: { de: GERMAN, en: ENGLISH }, skipped: false });
    const call = must(calls[0]);
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/model-a:generateContent');
    expect(call.url).not.toContain('secret-key');
    expect(call.headers.get('x-goog-api-key')).toBe('secret-key');
    const body = bodyOf(call) as { systemInstruction: unknown; generationConfig: Record<string, unknown> };
    expect(body.systemInstruction).toBeDefined();
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseJsonSchema).toBeDefined();
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' });
    expect(body.generationConfig).not.toHaveProperty('temperature');
  });

  it('builds the three request shapes', () => {
    const parts = { system: 'SYS', userParts: [{ text: 'USER' }], schema: { type: 'object' } };
    const full = buildGeminiBody({ shape: 'full', ...parts });
    const schema = buildGeminiBody({ shape: 'schema', ...parts });
    const bare = buildGeminiBody({ shape: 'bare', ...parts });
    expect(full.generationConfig).toHaveProperty('thinkingConfig');
    expect(schema.generationConfig).not.toHaveProperty('thinkingConfig');
    expect(schema.generationConfig).toHaveProperty('responseJsonSchema');
    expect(bare).not.toHaveProperty('systemInstruction');
    expect(bare.contents[0]?.parts).toEqual([{ text: 'SYS' }, { text: 'USER' }]);
    expect(bare.generationConfig).not.toHaveProperty('responseMimeType');
  });

  it('moves to the next model on 404 and to a plainer request on 400, and remembers both', async () => {
    const seen: string[] = [];
    const { fetch, calls } = fakeFetch((call) => {
      const model = /models\/([^:]+):/.exec(call.url)?.[1] ?? '';
      const config = (bodyOf(call).generationConfig ?? {}) as Record<string, unknown>;
      const shape = config.thinkingConfig ? 'full' : config.responseMimeType ? 'schema' : 'bare';
      seen.push(`${model}/${shape}`);
      if (model === 'retired')
        return jsonResponse({ error: { message: 'model not found' } }, { status: 404 });
      if (shape === 'full')
        return jsonResponse({ error: { message: 'thinking_level is not supported' } }, { status: 400 });
      return geminiAnswer({ skip: false, en: ENGLISH, de: GERMAN });
    });
    const provider = new GeminiMtProvider({
      getKey: () => 'k',
      models: ['retired', 'current'],
      fetchImpl: fetch,
    });

    await provider.translate(mtRequest());
    await provider.translate(mtRequest());

    expect(seen).toEqual(['retired/full', 'current/full', 'current/schema', 'current/schema']);
    expect(provider.label).toContain('current');
    expect(calls).toHaveLength(4);
  });

  it('advances once, not once per request, when several requests fail at the same time', async () => {
    const negotiator = new GeminiNegotiator(['retired', 'good', 'older'], 'full');
    const attempt = () =>
      negotiator.run(async (model) => {
        await Promise.resolve();
        if (model === 'retired')
          throw new ProviderError('p', 'bad_request', 'model not found', { status: 404 });
        return model;
      });
    expect(await Promise.all([attempt(), attempt(), attempt()])).toEqual(['good', 'good', 'good']);
    expect(negotiator.model).toBe('good');
  });

  it('keeps a request shape that has worked, even if a later request is rejected', async () => {
    const negotiator = new GeminiNegotiator(['m'], 'full');
    expect(await negotiator.run(async () => 'ok')).toBe('ok');
    await failure(
      negotiator.run(async () => {
        throw new ProviderError('p', 'bad_request', 'this one request was malformed', { status: 400 });
      }),
    );
    expect(negotiator.shape).toBe('full');
  });

  it('does not walk the ladder for errors that another shape cannot fix', async () => {
    const negotiator = new GeminiNegotiator(['a', 'b'], 'full');
    let calls = 0;
    const error = await failure(
      negotiator.run(async () => {
        calls += 1;
        throw new ProviderError('p', 'rate_limit', 'HTTP 429', { status: 429 });
      }),
    );
    expect(error.kind).toBe('rate_limit');
    expect(calls).toBe(1);
    expect(negotiator.model).toBe('a');
    expect(negotiator.shape).toBe('full');
  });

  it('ignores thought parts and rejects blocked, truncated and empty answers', async () => {
    const withThought = fakeFetch(() =>
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                { text: 'thinking...', thought: true },
                { text: JSON.stringify({ skip: false, en: ENGLISH, de: GERMAN }) },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      }),
    );
    const ok = new GeminiMtProvider({ getKey: () => 'k', models: ['m'], fetchImpl: withThought.fetch });
    expect((await ok.translate(mtRequest())).translations.de).toBe(GERMAN);

    const cases: [unknown, string][] = [
      [{ promptFeedback: { blockReason: 'SAFETY' } }, 'blocked'],
      [
        {
          candidates: [
            { content: { parts: [{ text: '{"skip": false, "en": "We w' }] }, finishReason: 'MAX_TOKENS' },
          ],
        },
        'MAX_TOKENS',
      ],
      [{ candidates: [] }, 'no text'],
    ];
    for (const [body, expected] of cases) {
      const { fetch } = fakeFetch(() => jsonResponse(body));
      const provider = new GeminiMtProvider({ getKey: () => 'k', models: ['m'], fetchImpl: fetch });
      const error = await failure(provider.translate(mtRequest()));
      expect(error.kind).toBe('bad_response');
      expect(error.message).toContain(expected);
    }
  });

  it('reads the retry delay Google puts in a 429 body', async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse(
        { error: { message: 'quota', status: 'RESOURCE_EXHAUSTED', details: [{ retryDelay: '23s' }] } },
        { status: 429 },
      ),
    );
    const provider = new GeminiMtProvider({ getKey: () => 'k', models: ['m'], fetchImpl: fetch });
    const error = await failure(provider.translate(mtRequest()));
    expect(error.kind).toBe('rate_limit');
    expect(error.retryAfterMs).toBe(23_000);
  });

  it("treats Google's HTTP 400 for an invalid key as an authentication failure, not a bad request", async () => {
    // Body as returned by the live API for a wrong key.
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse(
        {
          error: {
            code: 400,
            message: 'API key not valid. Please pass a valid API key.',
            status: 'INVALID_ARGUMENT',
            details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }],
          },
        },
        { status: 400 },
      ),
    );
    const provider = new GeminiMtProvider({ getKey: () => 'wrong', models: ['a', 'b'], fetchImpl: fetch });
    const error = await failure(provider.translate(mtRequest()));
    expect(error.kind).toBe('auth');
    // One request only: no walking down the request shapes because of a wrong key.
    expect(calls).toHaveLength(1);
  });

  it('is unconfigured without a key', async () => {
    const provider = new GemmaMtProvider({ getKey: () => undefined, models: ['m'] });
    expect(provider.isConfigured()).toBe(false);
    expect((await failure(provider.translate(mtRequest()))).kind).toBe('auth');
  });

  it('audio provider sends the utterance as inline WAV and returns transcript plus translations', async () => {
    const { fetch, calls } = fakeFetch(() =>
      geminiAnswer({ skip: false, transcript: URDU, en: ENGLISH, de: GERMAN }),
    );
    const provider = new GeminiAudioSttProvider({ getKey: () => 'k', models: ['m'], fetchImpl: fetch });

    const result = await provider.transcribe({
      pcm: tonePcm(1),
      sampleRate: 16_000,
      language: 'ur',
      hints: [],
      translate: translationJob(),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ text: URDU, translations: { de: GERMAN, en: ENGLISH } });
    const body = bodyOf(must(calls[0])) as {
      contents: { parts: { inlineData?: { mimeType: string; data: string } }[] }[];
    };
    const inline = must(body.contents[0]?.parts[0]?.inlineData);
    expect(inline.mimeType).toBe('audio/wav');
    expect(Buffer.from(inline.data, 'base64').subarray(0, 4).toString()).toBe('RIFF');
  });

  it('audio provider returns only the transcript without a translation job, and nothing for silence', async () => {
    const speech = fakeFetch(() => geminiAnswer({ skip: false, transcript: URDU, en: ENGLISH }));
    const provider = new GeminiAudioSttProvider({
      getKey: () => 'k',
      models: ['m'],
      fetchImpl: speech.fetch,
    });
    const request = {
      pcm: tonePcm(1),
      sampleRate: 16_000,
      language: 'ur' as const,
      hints: ['Tarjuman'],
      signal: new AbortController().signal,
    };
    expect(await provider.transcribe(request)).toEqual({ text: URDU, translations: undefined });

    const silence = fakeFetch(() => geminiAnswer({ skip: true, transcript: '', en: '' }));
    const quiet = new GeminiAudioSttProvider({ getKey: () => 'k', models: ['m'], fetchImpl: silence.fetch });
    expect(await quiet.transcribe(request)).toEqual({ text: '' });
  });

  describe('audio provider with an incomplete answer', () => {
    const transcribe = (answer: unknown, job = translationJob()) => {
      const { fetch } = fakeFetch(() => geminiAnswer(answer));
      return new GeminiAudioSttProvider({ getKey: () => 'k', models: ['m'], fetchImpl: fetch }).transcribe({
        pcm: tonePcm(1),
        sampleRate: 16_000,
        language: job.sourceLang,
        hints: [],
        translate: job,
        signal: new AbortController().signal,
      });
    };

    it('keeps a good transcript when the spoken translation is missing or invalid', async () => {
      // Used to throw, which sent the whole utterance to a weaker recognizer.
      for (const de of ['', URDU, ENGLISH]) {
        const result = await transcribe({ skip: false, transcript: URDU, en: ENGLISH, de });
        expect(result).toEqual({ text: URDU });
        expect(result).not.toHaveProperty('translations');
      }
    });

    it('returns the spoken translation without a caption that is missing', async () => {
      expect(await transcribe({ skip: false, transcript: URDU, en: '', de: GERMAN })).toEqual({
        text: URDU,
        translations: { de: GERMAN },
      });
    });

    it('accepts an Urdu translation that keeps the product names of the transcript', async () => {
      const job = translationJob({ sourceLang: 'de', targetLangs: ['ur', 'en'] });
      const answer = {
        skip: false,
        transcript: 'Microsoft Teams und SharePoint.',
        en: 'Microsoft Teams and SharePoint.',
        ur: 'Microsoft Teams اور SharePoint۔',
      };
      expect(await transcribe(answer, job)).toEqual({
        text: answer.transcript,
        translations: { ur: answer.ur, en: answer.en },
      });
    });

    it('still fails when the transcript itself is unusable', async () => {
      const noTranscript = await failure(
        transcribe({ skip: false, transcript: '', en: ENGLISH, de: GERMAN }),
      );
      expect(noTranscript.kind).toBe('bad_response');
      const hindi = await failure(
        transcribe({ skip: false, transcript: 'हम अगले हफ्ते मिलेंगे', en: ENGLISH, de: GERMAN }),
      );
      expect(hindi.kind).toBe('bad_response');
    });
  });

  it('text translation survives a missing caption and fails without the spoken language', async () => {
    const provider = (answer: unknown) => {
      const { fetch } = fakeFetch(() => geminiAnswer(answer));
      return new GeminiMtProvider({ getKey: () => 'k', models: ['m'], fetchImpl: fetch });
    };
    expect(await provider({ skip: false, en: '', de: GERMAN }).translate(mtRequest())).toEqual({
      translations: { de: GERMAN },
      skipped: false,
    });
    const error = await failure(provider({ skip: false, en: ENGLISH, de: '' }).translate(mtRequest()));
    expect(error.kind).toBe('bad_response');
  });
});

describe('Groq Whisper', () => {
  it('uploads a WAV with the language pinned and asks for confidence signals', async () => {
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse({
        text: ' Guten Morgen. ',
        segments: [
          { start: 0, end: 1, avg_logprob: -0.2, no_speech_prob: 0.02, compression_ratio: 1.1 },
          { start: 1, end: 4, avg_logprob: -0.6, no_speech_prob: 0.1, compression_ratio: 1.4 },
        ],
      }),
    );
    const provider = new GroqWhisperProvider({
      id: 'groq-x',
      model: 'whisper-large-v3',
      getKey: () => 'gsk_test',
      fetchImpl: fetch,
    });

    const result = await provider.transcribe({
      pcm: tonePcm(1),
      sampleRate: 16_000,
      language: 'de',
      hints: ['Tarjuman', 'Sprint'],
      signal: new AbortController().signal,
    });

    const call = must(calls[0]);
    expect(call.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(call.headers.get('authorization')).toBe('Bearer gsk_test');
    const form = call.init.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3');
    expect(form.get('language')).toBe('de');
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.get('temperature')).toBe('0');
    expect(String(form.get('prompt'))).toContain('Tarjuman, Sprint');
    const file = form.get('file') as File;
    expect(file.name).toBe('utterance.wav');
    expect(
      Buffer.from(await file.arrayBuffer())
        .subarray(0, 4)
        .toString(),
    ).toBe('RIFF');

    expect(result.text).toBe(' Guten Morgen. ');
    // Weighted by segment duration: (1 * -0.2 + 3 * -0.6) / 4
    expect(result.avgLogProb).toBeCloseTo(-0.5);
    expect(result.noSpeechProb).toBeCloseTo(0.08);
    expect(result.compressionRatio).toBe(1.4);
  });

  it('copes with a response that has no segments', () => {
    expect(summarizeSegments([])).toEqual({ compressionRatio: undefined });
    expect(transcriptFromSegments({ text: ' Guten Morgen. ' })).toEqual({
      text: ' Guten Morgen. ',
      compressionRatio: undefined,
    });
    expect(transcriptFromSegments({ segments: [] })).toBeUndefined();
  });

  describe('segments', () => {
    const clear = { avg_logprob: -0.25, no_speech_prob: 0.02, compression_ratio: 1.5 };

    it('leaves out a hallucinated tail instead of letting it hide in the average', () => {
      const result = must(
        transcriptFromSegments({
          text: ' Wir liefern am Montag. Vielen Dank fürs Zuschauen.',
          segments: [
            { text: ' Wir liefern am Montag.', start: 0, end: 6, ...clear },
            {
              text: ' Vielen Dank fürs Zuschauen.',
              start: 6,
              end: 7,
              avg_logprob: -1.3,
              no_speech_prob: 0.92,
              compression_ratio: 0.8,
            },
          ],
        }),
      );
      expect(result.text).toBe('Wir liefern am Montag.');
      expect(result.avgLogProb).toBeCloseTo(-0.25);
      expect(result.noSpeechProb).toBeCloseTo(0.02);
      expect(result.compressionRatio).toBe(1.5);
    });

    it('leaves out one repetitive segment instead of discarding the clear speech around it', () => {
      const result = must(
        transcriptFromSegments({
          text: ' Erster Teil. ja ja ja ja ja ja ja ja ja ja ja ja Dritter Teil.',
          segments: [
            { text: ' Erster Teil.', start: 0, end: 5, ...clear, compression_ratio: 1.6 },
            {
              text: ' ja ja ja ja ja ja ja ja ja ja ja ja',
              start: 5,
              end: 7,
              ...clear,
              compression_ratio: 2.5,
            },
            { text: ' Dritter Teil.', start: 7, end: 12, ...clear, compression_ratio: 1.7 },
          ],
        }),
      );
      expect(result.text).toBe('Erster Teil. Dritter Teil.');
      // Used to be 2.5, the maximum over all segments, which dropped the whole utterance.
      expect(result.compressionRatio).toBe(1.7);
    });

    it('measures an Urdu segment against the threshold for Arabic script', () => {
      const urdu = {
        text: ' پہلی قسط دس ہزار یورو کی ہوگی، دوسری قسط بیس ہزار یورو کی ہوگی۔',
        start: 0,
        end: 6,
        ...clear,
        compression_ratio: 2.46,
      };
      const next = { text: ' اس کے بعد ہم بات کریں گے۔', start: 6, end: 9, ...clear };
      const text = `${urdu.text}${next.text}`;
      expect(must(transcriptFromSegments({ text, segments: [urdu, next] })).text).toBe(text);
      const loop = { ...urdu, compression_ratio: 3.4 };
      expect(must(transcriptFromSegments({ text, segments: [loop, next] })).text).toBe(next.text.trim());
    });

    describe('in Urdu with English mixed in', () => {
      const urdu = ' پہلی قسط دس ہزار یورو کی ہوگی، دوسری قسط بیس ہزار یورو کی ہوگی۔';
      const english = ' The deployment is on Monday, the testing is on Tuesday.';
      const closing = ' اس کے بعد ہم کلائنٹ کو ڈیمو دیں گے۔';
      const text = `${urdu}${english}${closing}`;
      const timed = (figures: { avg_logprob: number; no_speech_prob: number; compression_ratio: number }[]) =>
        [urdu, english, closing].map((segment, i) => ({
          text: segment,
          start: i * 5,
          end: i * 5 + 5,
          ...must(figures[i] ?? figures[0]),
        }));

      it('does not filter when every segment carries the figures of the whole window', () => {
        // Reference Whisper copies the window's figures into each of its segments. Judged per
        // segment, 2.6 passed for the Urdu ones and cut out exactly the English one.
        const window = { avg_logprob: -0.3, no_speech_prob: 0.03, compression_ratio: 2.6 };
        expect(must(transcriptFromSegments({ text, segments: timed([window]) }))).toEqual({
          text,
          avgLogProb: expect.closeTo(-0.3) as number,
          noSpeechProb: expect.closeTo(0.03) as number,
          compressionRatio: 2.6,
        });
        // The same for figures that would fail every segment: the filter judges the summary.
        const silent = { avg_logprob: -1.3, no_speech_prob: 0.9, compression_ratio: 1.2 };
        const result = must(transcriptFromSegments({ text, segments: timed([silent]) }));
        expect(result.text).toBe(text);
        expect(result.noSpeechProb).toBeCloseTo(0.9);
      });

      it('measures every segment against the limit for the script of the whole utterance', () => {
        const segments = timed([
          { ...clear, compression_ratio: 2.5 },
          { ...clear, compression_ratio: 2.6 },
          { ...clear, compression_ratio: 1.6 },
        ]);
        expect(must(transcriptFromSegments({ text, segments })).text).toBe(text);
        // A real loop is past the limit of either script.
        const looping = timed([clear, { ...clear, compression_ratio: 3.2 }, clear]);
        expect(must(transcriptFromSegments({ text, segments: looping })).text).toBe(
          `${urdu.trim()} ${closing.trim()}`,
        );
      });
    });

    it('returns everything when a few words would be left of audio that was mostly rejected', () => {
      const loop = {
        text: ' und dann und dann und dann und dann und dann und dann und dann und dann',
        start: 0,
        end: 9,
        ...clear,
        compression_ratio: 4.1,
      };
      for (const phrase of [' Danke.', ' Vielen Dank für Ihre Aufmerksamkeit.']) {
        const stock = { text: phrase, start: 9, end: 10, ...clear };
        const text = `${loop.text}${phrase}`;
        // "Danke." with clean figures of its own would pass the filter as speech.
        expect(must(transcriptFromSegments({ text, segments: [loop, stock] }))).toEqual({
          text,
          avgLogProb: expect.closeTo(-0.25) as number,
          noSpeechProb: expect.closeTo(0.02) as number,
          compressionRatio: 4.1,
        });
      }
      // A short tail that is removed leaves the longer speech before it, however few its words.
      const speech = { text: ' Ja, genau.', start: 0, end: 3, ...clear };
      const tail = { text: ' Vielen Dank.', start: 3, end: 4, avg_logprob: -1.3, no_speech_prob: 0.9 };
      expect(
        must(transcriptFromSegments({ text: `${speech.text}${tail.text}`, segments: [speech, tail] })).text,
      ).toBe('Ja, genau.');
    });

    it("needs both of Whisper's no-speech signals to leave a segment out", () => {
      const doubtful = { text: ' Genau.', start: 6, end: 7, avg_logprob: -0.4, no_speech_prob: 0.9 };
      const segments = [{ text: ' Das machen wir so.', start: 0, end: 6, ...clear }, doubtful];
      const text = ' Das machen wir so. Genau.';
      expect(must(transcriptFromSegments({ text, segments })).text).toBe(text);
    });

    it('returns everything as it came when no segment is usable, for the filter to judge', () => {
      const silent = { avg_logprob: -1.4, no_speech_prob: 0.9, compression_ratio: 0.9 };
      const result = must(
        transcriptFromSegments({
          text: ' Vielen Dank. Tschüss.',
          segments: [
            { text: ' Vielen Dank.', start: 0, end: 1, ...silent },
            { text: ' Tschüss.', start: 1, end: 2, ...silent },
          ],
        }),
      );
      expect(result.text).toBe(' Vielen Dank. Tschüss.');
      expect(result.avgLogProb).toBeCloseTo(-1.4);
      expect(result.noSpeechProb).toBeCloseTo(0.9);
    });

    it('falls back to the plain text when the segments carry no text of their own', () => {
      const result = must(
        transcriptFromSegments({
          text: ' Guten Morgen. Danke.',
          segments: [
            { start: 0, end: 3, ...clear },
            { start: 3, end: 4, avg_logprob: -1.3, no_speech_prob: 0.92, compression_ratio: 0.8 },
          ],
        }),
      );
      expect(result.text).toBe(' Guten Morgen. Danke.');
    });
  });

  it('keeps the prompt short however long the glossary is', () => {
    const prompt = buildWhisperPrompt(
      'ur',
      Array.from({ length: 200 }, (_, i) => `Fachbegriff${i}`),
    );
    expect(prompt.length).toBeLessThanOrEqual(420);
    expect(prompt.startsWith('یہ ایک کاروباری')).toBe(true);
  });

  it('classifies failures', async () => {
    const cases: [Response, string, number | undefined][] = [
      [jsonResponse({ error: { message: 'Invalid API Key' } }, { status: 401 }), 'auth', undefined],
      [
        jsonResponse({ error: { message: 'slow down' } }, { status: 429, headers: { 'retry-after': '7' } }),
        'rate_limit',
        7_000,
      ],
      [
        jsonResponse(
          { error: { message: 'slow down' } },
          { status: 429, headers: { 'retry-after-ms': '450' } },
        ),
        'rate_limit',
        450,
      ],
      [jsonResponse({ nothing: true }), 'bad_response', undefined],
    ];
    for (const [response, kind, retryAfterMs] of cases) {
      const { fetch } = fakeFetch(() => response);
      const provider = new GroqWhisperProvider({ id: 'g', model: 'm', getKey: () => 'k', fetchImpl: fetch });
      const error = await failure(
        provider.transcribe({
          pcm: tonePcm(1),
          sampleRate: 16_000,
          language: 'de',
          hints: [],
          signal: new AbortController().signal,
        }),
      );
      expect(error.kind).toBe(kind);
      expect(error.retryAfterMs).toBe(retryAfterMs);
    }
  });
});

describe('OpenAI-compatible translation', () => {
  const chatAnswer = (payload: unknown) =>
    jsonResponse({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: 'stop' }] });
  const options = (
    fetchImpl: typeof fetch,
    extra: Partial<ConstructorParameters<typeof OpenAiCompatMtProvider>[0]> = {},
  ) => ({
    id: 'groq-x',
    vendor: 'Groq',
    getBaseUrl: () => 'https://api.groq.com/openai/v1/',
    getModel: () => 'openai/gpt-oss-120b',
    getKey: () => 'gsk_test',
    keyName: 'GROQ_API_KEY',
    requiresKey: true,
    reasoning: { reasoning_effort: 'low', include_reasoning: false },
    fetchImpl,
    ...extra,
  });

  it('builds each request shape', () => {
    const args = ['m', 'SYS', 'USER', { type: 'object' }, { reasoning_effort: 'low' }] as const;
    const strict = buildChatBody('strict', ...args);
    expect(strict.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
    expect(strict.reasoning_effort).toBe('low');
    const json = buildChatBody('json', ...args);
    expect(json.response_format).toEqual({ type: 'json_object' });
    expect(json).not.toHaveProperty('reasoning_effort');
    const plain = buildChatBody('plain', ...args);
    expect(plain).not.toHaveProperty('response_format');
    expect((plain.messages as { role: string }[]).map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('steps down to a plainer request on 400 and stays there', async () => {
    const shapes: string[] = [];
    const { fetch, calls } = fakeFetch((call) => {
      const format = (bodyOf(call).response_format as { type?: string } | undefined)?.type ?? 'plain';
      shapes.push(format);
      if (format === 'json_schema')
        return jsonResponse({ error: { message: 'json_schema is not supported' } }, { status: 400 });
      return chatAnswer({ skip: false, en: ENGLISH, de: GERMAN });
    });
    const provider = new OpenAiCompatMtProvider(options(fetch));

    expect((await provider.translate(mtRequest())).translations.de).toBe(GERMAN);
    await provider.translate(mtRequest());

    expect(shapes).toEqual(['json_schema', 'json_object', 'json_object']);
    expect(must(calls[0]).url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(must(calls[0]).headers.get('authorization')).toBe('Bearer gsk_test');
  });

  it('does not step down for authentication, quota or server errors', async () => {
    for (const status of [401, 429, 500]) {
      const { fetch, calls } = fakeFetch(() => jsonResponse({ error: { message: 'nope' } }, { status }));
      const provider = new OpenAiCompatMtProvider(options(fetch));
      await failure(provider.translate(mtRequest()));
      expect(calls).toHaveLength(1);
    }
  });

  it("treats Groq's HTTP 400 for output that failed the schema as a bad answer, and keeps the request shape", async () => {
    const seen: string[] = [];
    const { fetch } = fakeFetch((call, index) => {
      const body = bodyOf(call);
      const format = (body.response_format as { type?: string } | undefined)?.type ?? 'plain';
      seen.push(`${format}/${String(body.reasoning_effort)}`);
      if (index === 0) {
        // Body as returned by the live API when the MODEL's output did not validate.
        return jsonResponse(
          {
            error: {
              message:
                "Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
              type: 'invalid_request_error',
              code: 'json_validate_failed',
              failed_generation: '{"skip": false, "en": "We will rel',
            },
          },
          { status: 400 },
        );
      }
      return chatAnswer({ skip: false, en: ENGLISH, de: GERMAN });
    });
    const provider = new OpenAiCompatMtProvider(options(fetch));

    const error = await failure(provider.translate(mtRequest()));
    expect(error.kind).toBe('bad_response');
    expect(error.status).toBe(400);
    expect(error.message).toContain('Failed to generate JSON');
    await provider.translate(mtRequest());

    // Used to be: json_schema, json_object, json_object — the reasoning controls gone for good.
    expect(seen).toEqual(['json_schema/low', 'json_schema/low']);
  });

  it('does not try other request shapes for a retired or unknown model', async () => {
    const cases: [status: number, code: string, message: string][] = [
      [400, 'model_decommissioned', 'The model `x` has been decommissioned and is no longer supported.'],
      [400, 'model_not_found', 'The model `x` does not exist or you do not have access to it.'],
      [404, 'model_not_found', 'The model `x` does not exist or you do not have access to it.'],
      [404, '', 'Not Found'],
    ];
    for (const [status, code, message] of cases) {
      const { fetch, calls } = fakeFetch(() =>
        jsonResponse(
          { error: { message, type: 'invalid_request_error', ...(code ? { code } : {}) } },
          { status },
        ),
      );
      const provider = new OpenAiCompatMtProvider(options(fetch));
      const error = await failure(provider.translate(mtRequest()));
      expect(error.kind, `${status} ${code}`).toBe('bad_request');
      // Used to be three sequential requests for the 400s.
      expect(calls, `${status} ${code}`).toHaveLength(1);
    }
  });

  it('works without a key for local endpoints, and needs endpoint and model to be configured', async () => {
    const { fetch, calls } = fakeFetch(() => chatAnswer({ skip: false, en: ENGLISH, de: GERMAN }));
    const local = new OpenAiCompatMtProvider(
      options(fetch, {
        requiresKey: false,
        getKey: () => undefined,
        getBaseUrl: () => 'http://localhost:11434/v1',
        getModel: () => 'gemma',
      }),
    );
    expect(local.isConfigured()).toBe(true);
    await local.translate(mtRequest());
    expect(must(calls[0]).headers.has('authorization')).toBe(false);
    expect(must(calls[0]).url).toBe('http://localhost:11434/v1/chat/completions');

    expect(new OpenAiCompatMtProvider(options(fetch, { getModel: () => undefined })).isConfigured()).toBe(
      false,
    );
    expect(new OpenAiCompatMtProvider(options(fetch, { getKey: () => undefined })).isConfigured()).toBe(
      false,
    );
  });

  it('rejects an answer without content', async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }),
    );
    const error = await failure(new OpenAiCompatMtProvider(options(fetch)).translate(mtRequest()));
    expect(error.kind).toBe('bad_response');
    expect(error.message).toContain('length');
  });
});

describe('MyMemory', () => {
  const request = () => mtRequest({ sourceLang: 'de', targetLangs: ['ur', 'en'], text: 'Guten Morgen.' });

  it('asks once per target language and passes the contact e-mail', async () => {
    const { fetch, calls } = fakeFetch((call) => {
      const pair = new URL(call.url).searchParams.get('langpair');
      return jsonResponse({
        responseStatus: 200,
        responseData: { translatedText: pair === 'de|ur' ? 'صبح بخیر۔' : 'Good morning.' },
      });
    });
    const provider = new MyMemoryProvider({ getEmail: () => 'team@example.org', fetchImpl: fetch });

    expect(await provider.translate(request())).toEqual({
      translations: { ur: 'صبح بخیر۔', en: 'Good morning.' },
    });
    expect(calls.map((c) => new URL(c.url).searchParams.get('langpair')).sort()).toEqual(['de|en', 'de|ur']);
    expect(new URL(must(calls[0]).url).searchParams.get('de')).toBe('team@example.org');
    expect(must(calls[0]).init.method).toBe('GET');
  });

  it('does not mistake a translation that mentions a limit for a used-up quota, and tidies the text', async () => {
    const { fetch } = fakeFetch((call) => {
      const pair = new URL(call.url).searchParams.get('langpair');
      return jsonResponse({
        responseStatus: 200,
        quotaFinished: false,
        responseData: {
          translatedText:
            pair === 'ur|de' ? '"Das Tempolimit liegt bei 50.' : 'The speed limit isn&#39;t 50. ',
        },
      });
    });
    const provider = new MyMemoryProvider({ getEmail: () => undefined, fetchImpl: fetch });
    const result = await provider.translate(
      mtRequest({ sourceLang: 'ur', targetLangs: ['de', 'en'], text: 'رفتار کی حد 50 ہے۔' }),
    );
    expect(result.translations).toEqual({
      de: 'Das Tempolimit liegt bei 50.',
      en: "The speed limit isn't 50.",
    });
  });

  it('recognises a used-up quota and a wrong-script answer', async () => {
    const quota = fakeFetch(() =>
      jsonResponse({
        responseStatus: 429,
        responseData: {
          translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY',
        },
      }),
    );
    expect(
      (
        await failure(
          new MyMemoryProvider({ getEmail: () => undefined, fetchImpl: quota.fetch }).translate(request()),
        )
      ).kind,
    ).toBe('rate_limit');

    const latin = fakeFetch(() =>
      jsonResponse({ responseStatus: 200, responseData: { translatedText: 'Good morning.' } }),
    );
    expect(
      (
        await failure(
          new MyMemoryProvider({ getEmail: () => undefined, fetchImpl: latin.fetch }).translate(request()),
        )
      ).kind,
    ).toBe('bad_response');
  });

  it('accepts an Urdu answer that keeps the names of the source in Latin script', async () => {
    const { fetch } = fakeFetch((call) => {
      const pair = new URL(call.url).searchParams.get('langpair');
      return jsonResponse({
        responseStatus: 200,
        responseData: {
          translatedText:
            pair === 'de|ur' ? 'Microsoft Teams اور SharePoint۔' : 'Microsoft Teams and SharePoint.',
        },
      });
    });
    const provider = new MyMemoryProvider({ getEmail: () => undefined, fetchImpl: fetch });
    const result = await provider.translate(
      mtRequest({ sourceLang: 'de', targetLangs: ['ur', 'en'], text: 'Microsoft Teams und SharePoint.' }),
    );
    expect(result.translations).toEqual({
      ur: 'Microsoft Teams اور SharePoint۔',
      en: 'Microsoft Teams and SharePoint.',
    });
  });

  it('rejects the source handed back untranslated', async () => {
    const text = 'Wir veröffentlichen nächste Woche die neue Version.';
    const { fetch } = fakeFetch(() =>
      jsonResponse({ responseStatus: 200, responseData: { translatedText: text } }),
    );
    const provider = new MyMemoryProvider({ getEmail: () => undefined, fetchImpl: fetch });
    const error = await failure(
      provider.translate(mtRequest({ sourceLang: 'de', targetLangs: ['en'], text })),
    );
    expect(error.kind).toBe('bad_response');
    expect(error.message).toContain('repeats the source');
  });

  it('leaves out a caption that failed, and fails when the spoken language failed', async () => {
    const failing = (pairThatFails: string) =>
      fakeFetch((call) => {
        const pair = new URL(call.url).searchParams.get('langpair');
        if (pair === pairThatFails) return jsonResponse({ error: 'upstream' }, { status: 503 });
        return jsonResponse({
          responseStatus: 200,
          responseData: { translatedText: pair === 'de|ur' ? URDU : ENGLISH },
        });
      });
    const job = () => mtRequest({ sourceLang: 'de', targetLangs: ['ur', 'en'], text: GERMAN });

    const caption = new MyMemoryProvider({ getEmail: () => undefined, fetchImpl: failing('de|en').fetch });
    // Used to throw, discarding the Urdu translation that was to be spoken.
    expect(await caption.translate(job())).toEqual({ translations: { ur: URDU } });

    const spoken = new MyMemoryProvider({ getEmail: () => undefined, fetchImpl: failing('de|ur').fetch });
    expect((await failure(spoken.translate(job()))).kind).toBe('unavailable');
  });

  it('sends Urdu of 305 characters in one request: the limit counts characters, not bytes', async () => {
    const urdu =
      'ہم نے کلائنٹ سے بات کی ہے اور انہوں نے کہا ہے کہ انہیں یہ فیچر اگلے مہینے تک چاہیے اور وہ اس کے لیے اضافی ادائیگی کرنے کو تیار ہیں تو ہمیں اپنی ٹیم کے ساتھ بیٹھ کر یہ دیکھنا ہوگا کہ ہم یہ کام کتنے وقت میں مکمل کر سکتے ہیں اور اس کے لیے ہمیں کتنے لوگوں کی ضرورت ہوگی اور کیا ہمیں باہر سے کسی کو لینا پڑے گا';
    expect(new TextEncoder().encode(urdu).byteLength).toBeGreaterThan(500);
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse({ responseStatus: 200, responseData: { translatedText: GERMAN } }),
    );
    const provider = new MyMemoryProvider({ getEmail: () => undefined, fetchImpl: fetch });
    // Used to be refused locally with "text is too long".
    expect(await provider.translate(mtRequest({ targetLangs: ['de'], text: urdu }))).toEqual({
      translations: { de: GERMAN },
    });
    expect(calls).toHaveLength(1);
    expect(new URL(must(calls[0]).url).searchParams.get('q')).toBe(urdu);
  });

  it('translates longer text sentence by sentence, in order, and joins the pieces', async () => {
    const sentences = Array.from(
      { length: 9 },
      (_, i) => `Dies ist der Satz Nummer ${i + 1} einer längeren Erklärung, die kein Ende nimmt.`,
    );
    const text = sentences.join(' ');
    expect(text.length).toBeGreaterThan(500);

    const pieces = queryPieces(text, 'de');
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join(' ')).toBe(text);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(500);
      expect(piece.endsWith('.')).toBe(true);
    }

    let inFlight = 0;
    let overlap = false;
    const { fetch, calls } = fakeFetch(async (call) => {
      inFlight += 1;
      overlap ||= inFlight > 1;
      await Promise.resolve();
      inFlight -= 1;
      const q = new URL(call.url).searchParams.get('q') ?? '';
      return jsonResponse({ responseStatus: 200, responseData: { translatedText: `[${q.length}]` } });
    });
    const provider = new MyMemoryProvider({ getEmail: () => undefined, fetchImpl: fetch });
    const result = await provider.translate(mtRequest({ sourceLang: 'de', targetLangs: ['en'], text }));

    expect(calls.map((call) => new URL(call.url).searchParams.get('q'))).toEqual(pieces);
    expect(result.translations.en).toBe(pieces.map((piece) => `[${piece.length}]`).join(' '));
    expect(overlap).toBe(false);
  });

  it('cuts a single sentence that is too long at a clause break or a space', () => {
    const noStops = 'Wort '.repeat(120).trim();
    const pieces = queryPieces(noStops, 'de');
    expect(pieces.length).toBe(2);
    expect(pieces.join(' ')).toBe(noStops);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(500);
    expect(queryPieces('  Guten   Morgen. ', 'de')).toEqual(['Guten Morgen.']);
  });
});

describe('Azure voices', () => {
  it('accepts region:key or a key plus a region', () => {
    expect(parseAzureCredentials('westeurope:abc123', undefined)).toEqual({
      region: 'westeurope',
      key: 'abc123',
    });
    expect(parseAzureCredentials('abc123', 'GermanyWestCentral')).toEqual({
      region: 'germanywestcentral',
      key: 'abc123',
    });
    expect(parseAzureCredentials('abc123', undefined)).toBeUndefined();
    // The portal writes regions with a space and capitals; anything else is not a region.
    expect(parseAzureCredentials('West Europe:abc', undefined)).toEqual({ region: 'westeurope', key: 'abc' });
    expect(parseAzureCredentials('abc123', 'West Europe')).toEqual({ region: 'westeurope', key: 'abc123' });
    expect(parseAzureCredentials('bad/region:abc', undefined)).toBeUndefined();
    expect(parseAzureCredentials('abc123', 'west-europe!')).toBeUndefined();
    expect(parseAzureCredentials(undefined, 'westeurope')).toBeUndefined();
  });

  it('requests MP3 from the regional endpoint with escaped SSML', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const provider = new AzureTtsProvider({
      getKey: () => 'westeurope:secret',
      getRegion: () => undefined,
      fetchImpl: fetch,
    });
    expect(provider.isConfigured()).toBe(true);

    const result = await provider.synthesize({
      text: 'A & B',
      lang: 'ur',
      voice: 'nonsense',
      rate: 0.9,
      signal: new AbortController().signal,
    });

    expect([...result.audio]).toEqual([1, 2, 3]);
    expect(result.voice).toBe('ur-PK-UzmaNeural');
    const call = must(calls[0]);
    expect(call.url).toBe('https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1');
    expect(call.headers.get('ocp-apim-subscription-key')).toBe('secret');
    expect(call.headers.get('x-microsoft-outputformat')).toBe('audio-24khz-48kbitrate-mono-mp3');
    expect(call.text).toContain("<voice name='ur-PK-UzmaNeural'>");
    expect(call.text).toContain("rate='-10%'");
    expect(call.text).toContain('A &amp; B');
  });

  it('picks voices and rates safely', () => {
    expect(resolveVoice('de', 'de-DE-ConradNeural').id).toBe('de-DE-ConradNeural');
    expect(resolveVoice('de', 'ur-PK-AsadNeural').id).toBe('de-DE-KatjaNeural');
    expect(resolveVoice('en', undefined).lang).toBe('en');
    expect(ssmlRate(1)).toBe('+0%');
    expect(ssmlRate(1.25)).toBe('+25%');
    expect(ssmlRate(0.7)).toBe('-30%');
    expect(ssmlRate(9)).toBe('+100%');
  });
});
