import { LANGUAGES, type LangCode } from '../../../shared/languages';
import { splitSentences, wrapLongSentence } from '../../pipeline/text';
import { httpRequest, readJson } from '../http';
import { ProviderError, type MtProvider, type MtRequest, type MtResult } from '../types';
import { translationDefect } from './prompt';

/**
 * MyMemory (translated.net): a public translation-memory API that needs no key.
 *
 * It is the keyless safety net, not a quality option: it translates each sentence in
 * isolation (no conversation context, no glossary, no register control) and allows
 * 5,000 characters/day anonymously, or 50,000/day when a contact e-mail is supplied.
 */

const ENDPOINT = 'https://api.mymemory.translated.net/get';

/**
 * The API rejects longer queries ("MAX ALLOWED QUERY : 500 CHARS"). The limit counts
 * characters, not bytes: Urdu is two bytes per letter, and the service accepts an Urdu
 * sentence of 305 characters (538 bytes).
 */
const MAX_QUERY_CHARS = 500;

/**
 * `text` in pieces the API accepts: whole when it fits, otherwise sentences packed up to the
 * limit (a single sentence beyond it is cut at a clause break).
 */
export function queryPieces(text: string, lang: LangCode, maxChars: number = MAX_QUERY_CHARS): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return [normalized];
  const pieces: string[] = [];
  for (const sentence of splitSentences(normalized, lang).flatMap((s) => wrapLongSentence(s, maxChars))) {
    const last = pieces[pieces.length - 1];
    if (last !== undefined && last.length + 1 + sentence.length <= maxChars) {
      pieces[pieces.length - 1] = `${last} ${sentence}`;
    } else {
      pieces.push(sentence);
    }
  }
  return pieces;
}

interface MyMemoryResponse {
  responseData?: { translatedText?: string };
  responseStatus?: number | string;
  responseDetails?: string;
  quotaFinished?: boolean;
}

/** MyMemory puts this text where the translation should be when the daily allowance is used up. */
const QUOTA_BANNER = /^MYMEMORY WARNING|YOU USED ALL AVAILABLE FREE TRANSLATIONS/;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** The service sometimes returns HTML entities and stray wrapping quotes. */
function tidy(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/^["'“”„«»\s]+|["'“”„«»\s]+$/gu, '');
}

export interface MyMemoryOptions {
  /** Optional contact e-mail, which raises the daily quota. */
  getEmail: () => string | undefined;
  fetchImpl?: typeof fetch;
  /** Opens a connection to the host of a URL ahead of a request (see `prepare`). */
  warm?: (url: string) => void;
}

export class MyMemoryProvider implements MtProvider {
  readonly id = 'mymemory';
  readonly kind = 'mt' as const;
  readonly label = 'MyMemory (no key, basic quality)';
  readonly requiresKey = false;
  readonly contextAware = false;
  readonly requestsPerMinute = 30;
  readonly timeoutMs = 6_000;

  constructor(private readonly options: MyMemoryOptions) {}

  isConfigured(): boolean {
    return true;
  }

  /** Without a query the service answers with a usage note: a connection, and nothing off the quota. */
  prepare(): void {
    this.options.warm?.(ENDPOINT);
  }

  /** One request: a text within the query limit, translated as the service returns it. */
  private async translatePiece(
    text: string,
    source: LangCode,
    target: LangCode,
    signal: AbortSignal,
  ): Promise<string> {
    const params = new URLSearchParams({ q: text, langpair: `${source}|${target}` });
    const email = this.options.getEmail();
    if (email) params.set('de', email);

    const response = await httpRequest({
      providerId: this.id,
      method: 'GET',
      url: `${ENDPOINT}?${params.toString()}`,
      signal,
      fetchImpl: this.options.fetchImpl,
    });
    const json = await readJson<MyMemoryResponse>(this.id, response);
    const status = Number(json.responseStatus);
    const translated = tidy(json.responseData?.translatedText ?? '');

    // MyMemory reports quota problems with HTTP 200 and a status / message in the body.
    // Only the service's own banner counts; a translation may well contain the word "limit".
    if (json.quotaFinished === true || status === 429 || QUOTA_BANNER.test(translated)) {
      throw new ProviderError(this.id, 'rate_limit', 'MyMemory daily quota is used up', {
        retryAfterMs: 600_000,
      });
    }
    if (status !== 200 || !translated) {
      throw new ProviderError(this.id, 'bad_response', json.responseDetails || `MyMemory status ${status}`);
    }
    return translated;
  }

  private async translateInto(request: MtRequest, target: LangCode): Promise<string> {
    const parts: string[] = [];
    // One after another: the pieces of one text need no head start over each other, and a
    // burst of parallel requests is what the anonymous allowance throttles.
    for (const piece of queryPieces(request.text, request.sourceLang)) {
      parts.push(await this.translatePiece(piece, request.sourceLang, target, request.signal));
    }
    const translated = parts.join(' ');
    const defect = translationDefect(translated, target, { text: request.text, lang: request.sourceLang });
    if (defect) {
      throw new ProviderError(
        this.id,
        'bad_response',
        `MyMemory's ${LANGUAGES[target].name} translation ${defect}`,
      );
    }
    return translated;
  }

  async translate(request: MtRequest): Promise<MtResult> {
    const outcomes = await Promise.allSettled(
      request.targetLangs.map((lang) => this.translateInto(request, lang)),
    );
    const translations: Partial<Record<LangCode, string>> = {};
    for (const [index, lang] of request.targetLangs.entries()) {
      const outcome = outcomes[index];
      if (outcome?.status === 'fulfilled') translations[lang] = outcome.value;
      // Only the first language is spoken; the others are captions, and a caption that
      // failed is left out instead of costing the translation that did work.
      else if (index === 0) throw outcome?.reason;
    }
    return { translations };
  }
}
