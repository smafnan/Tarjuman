import { LANGUAGES, type LangCode } from '../../shared/languages';
import { SPEECH_RATE_MAX, SPEECH_RATE_MIN } from '../../shared/settings';

/**
 * Text helpers for the pipeline: cleaning up STT output and preparing text for speech.
 */

/**
 * Square brackets and asterisks are how recognizers mark what is not speech: [Musik],
 * [SPEAKING FOREIGN LANGUAGE], *lacht*. Nobody speaks them, so the words inside do not matter;
 * only a figure is kept ("drücken Sie *9*", "siehe [2]").
 */
const MARKED_SPAN = /\[([^\]]{0,40})\]|\*([^*]{0,40})\*/gu;
/** Round brackets hold annotations too, (Applaus), but also what people say: "(ca. 200 Stück)". */
const PARENTHESISED_SPAN = /\(([^)]{0,40})\)/gu;
const MUSIC_SYMBOLS = /[♩♪♫♬🎵🎶]+/gu;
const SENTENCE_TERMINATORS = '.!?۔؟…';

/** What recognizers write for sounds that are not speech. */
const ANNOTATION_WORDS = new Set(
  (
    'musik music applaus applause beifall klatschen clapping lachen lacht lachend gelächter ' +
    'laughter laughs laughing laugh räuspern räuspert husten hustet cough coughs coughing ' +
    'seufzt seufzen sigh sighs silence stille schweigen pause blank inaudible ' +
    'unverständlich unintelligible noise noises rauschen geräusch geräusche sound sounds ' +
    'jubel cheering klingeln klingelt ringing rings beep piepton static crosstalk speaking ' +
    'typing tippen throat ' +
    'موسیقی تالیاں ہنسی قہقہہ خاموشی شور کھانسی'
  ).split(' '),
);
/** Words that only accompany an annotation word: (leise Musik), [music playing], (räuspert sich). */
const ANNOTATION_MODIFIERS = new Set(
  (
    'audio spielt playing plays leise laute lautes soft loud im in the no kein keine sich und ' +
    'and hintergrund background endet ends beginnt starts continues upbeat dramatic ' +
    'dramatische telefon phone publikum audience sprecher sprecherin speaker er sie clears ' +
    'foreign language'
  ).split(' '),
);

/** Is everything in the brackets annotation vocabulary: (leise Musik), (Publikum lacht), ()? */
function isAnnotationVocabulary(content: string): boolean {
  const words = content.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length === 0) return content.trim() === '';
  return (
    words.length <= 5 &&
    words.some((word) => ANNOTATION_WORDS.has(word)) &&
    words.every((word) => ANNOTATION_WORDS.has(word) || ANNOTATION_MODIFIERS.has(word))
  );
}

type Neighbour = 'words' | 'boundary';

/** What a bracket meets first in `gap`: words of its own sentence, or the sentence's end. */
function neighbour(gap: string, backwards: boolean, beyond: Neighbour): Neighbour {
  for (let i = 0; i < gap.length; i++) {
    const char = gap[backwards ? gap.length - 1 - i : i] ?? '';
    if (SENTENCE_TERMINATORS.includes(char)) return 'boundary';
    if (/[\p{L}\p{N}]/u.test(char)) return 'words';
  }
  return beyond;
}

/**
 * Round brackets that are an annotation, removed. Brackets that stand alone as a sentence are
 * one whatever their words, since nobody speaks a sentence in brackets: "(Telefon klingelt)",
 * "(Er lacht.)". Brackets inside a sentence are part of it ("500 Euro (netto) pro Monat")
 * unless all they hold is annotation vocabulary.
 */
function withoutParenthesisedAnnotations(text: string): string {
  const spans = [...text.matchAll(PARENTHESISED_SPAN)];
  if (spans.length === 0) return text;
  // The text between the spans; gaps[i] precedes span i and the last one follows them all.
  const gaps: string[] = [];
  let position = 0;
  for (const span of spans) {
    gaps.push(text.slice(position, span.index));
    position = span.index + span[0].length;
  }
  gaps.push(text.slice(position));

  // One sweep in each direction, so the cost stays linear however many brackets there are.
  const before: Neighbour[] = [];
  const after: Neighbour[] = [];
  for (let i = 0; i < spans.length; i++) {
    before[i] = neighbour(gaps[i] ?? '', true, before[i - 1] ?? 'boundary');
  }
  for (let i = spans.length - 1; i >= 0; i--) {
    after[i] = neighbour(gaps[i + 1] ?? '', false, after[i + 1] ?? 'boundary');
  }

  let result = gaps[0] ?? '';
  spans.forEach((span, i) => {
    const content = span[1] ?? '';
    const closesItself = SENTENCE_TERMINATORS.includes(content.trimEnd().slice(-1) || ' ');
    const alone = before[i] === 'boundary' && (after[i] === 'boundary' || closesItself);
    result += alone || isAnnotationVocabulary(content) ? ' ' : span[0];
    result += gaps[i + 1] ?? '';
  });
  return result;
}

const QUOTES = `"'“”„‚‘’«»`;
/** An apostrophe that starts an elision ("'s ist gut") is not an opening quote. */
const LEADING_ELISION = /^['’]\p{L}{1,2}\s/u;

/**
 * Quotes around the whole transcript, removed. Only a pair is decoration; a quote at one end
 * belongs to a quotation inside the sentence. Scans from each end: this runs on recognizer
 * output of any length, where a pattern with a lazy middle took seconds on a run of quotes.
 */
function withoutWrappingQuotes(text: string): string {
  if (LEADING_ELISION.test(text)) return text;
  let start = 0;
  while (start < text.length && QUOTES.includes(text[start] ?? '')) start++;
  let end = text.length;
  while (end > start && QUOTES.includes(text[end - 1] ?? '')) end--;
  return start > 0 && end < text.length ? text.slice(start, end) : text;
}

/** Collapse whitespace, drop non-speech annotations and quotes that wrap the whole transcript. */
export function normalizeTranscript(raw: string): string {
  const unmarked = raw
    .replace(MARKED_SPAN, (span, square?: string, starred?: string) =>
      /\p{N}/u.test(square ?? starred ?? '') ? span : ' ',
    )
    .replace(MUSIC_SYMBOLS, ' ');
  let text = withoutParenthesisedAnnotations(unmarked).replace(/\s+/g, ' ').trim();
  text = withoutWrappingQuotes(text).trim();
  // A transcript that is only punctuation carries no words.
  if (!/[\p{L}\p{N}]/u.test(text)) return '';
  return text;
}

/**
 * Abbreviations after which a full stop does not end the sentence. Matched against the
 * word immediately before the full stop, lower-cased, without the stop.
 */
const ABBREVIATIONS = new Set([
  // German
  'z',
  'b',
  'd',
  'h',
  'u',
  'a',
  'o',
  'ä',
  'bzw',
  'ca',
  'dr',
  'prof',
  'nr',
  'evtl',
  'ggf',
  'inkl',
  'usw',
  'vgl',
  'bspw',
  'tel',
  'str',
  'hr',
  'fr',
  'mio',
  'mrd',
  'tsd',
  'bzgl',
  'zzgl',
  'sog',
  'max',
  'min',
  'abs',
  'art',
  'abt',
  'std',
  'stk',
  'exkl',
  'v',
  's',
  't',
  'm',
  'p',
  'r',
  // English
  'mr',
  'mrs',
  'ms',
  'e',
  'g',
  'i',
  'vs',
  'etc',
  'inc',
  'ltd',
  'st',
  'no',
  'approx',
  'co',
  'corp',
  'jr',
  'sr',
]);

/**
 * Abbreviations of weekdays and months, matched as written: "Do." is Donnerstag, while "so."
 * and "do." end sentences all the time ("Das ist so.", "Yes, we do.").
 */
const CALENDAR_ABBREVIATIONS = new Set(
  (
    'Mo Di Mi Do Fr Sa So Mon Tue Tues Wed Thu Thur Thurs Fri Sat Sun ' +
    'Jan Feb Mär Mar Apr Jun Jul Aug Sep Sept Okt Oct Nov Dez Dec'
  ).split(' '),
);

const MONTHS = new Set(
  (
    'januar februar märz april mai juni juli august september oktober november dezember ' +
    'january february march may june july october december'
  ).split(' '),
);

/**
 * Words a new sentence opens with. After a figure and a full stop only one of these is taken
 * as the start of a sentence: "beträgt 5000. Wir treffen uns …" is two sentences, "unser 100.
 * Jubiläum" is an ordinal in front of its noun, and nouns cannot be told apart from names.
 */
const SENTENCE_OPENERS = new Set(
  (
    'ich du er sie es wir ihr man das der die den dem ein eine dies diese dieser dieses und ' +
    'aber oder denn dann danach also da dort hier jetzt heute nun so wenn weil dass ob als ' +
    'wie was wer wo wann warum wieso können kann könnten könnte haben hat hatten ist sind war ' +
    'waren wird werden würde würden soll sollen sollte möchte möchten muss müssen darf gibt ' +
    'bitte danke vielen ja nein doch genau okay gut außerdem deshalb daher trotzdem ' +
    'vielleicht natürlich leider unser unsere mein meine ihre alle noch nur auch bei mit für ' +
    'in im am auf an zu von nach vor bis ' +
    'i you he she it we they the a an and but or then there this that these those if when ' +
    'what who where why how please thanks thank yes no well also our my your his her their ' +
    'is are was were do does did can could will would should shall let now here'
  ).split(' '),
);

/** The word that follows position `index`, without the quotes or brackets that open it. */
function wordAfter(text: string, index: number): string {
  return /^[\s"'“„‚‘«([]*([\p{L}\p{N}]*)/u.exec(text.slice(index, index + 48))?.[1] ?? '';
}

function endsSentence(text: string, index: number, enders: string): boolean {
  const char = text[index];
  if (char === undefined || !enders.includes(char)) return false;
  const next = text[index + 1];
  // Enders inside a token ("3.5", "example.com") or before a closing quote/bracket are not boundaries yet.
  if (next !== undefined && !/\s/u.test(next)) return false;
  if (char !== '.') return true;

  // A wrong cut is audible, a missed one only makes the chunk longer: when in doubt, no cut.
  const following = wordAfter(text, index + 1);
  // Sentences open with a capital, so the full stop belongs to an abbreviation or an ordinal:
  // "max. zehn Werktage", "v. a. bei", "am 3. und 4. Mai". (Urdu letters have no case.)
  if (/^\p{Ll}/u.test(following)) return false;

  // Look at the word before the full stop.
  let start = index;
  while (start > 0 && /[\p{L}\p{N}]/u.test(text[start - 1] ?? '')) start--;
  const word = text.slice(start, index);
  if (word.length === 0) return true;
  if (/^\p{N}+$/u.test(word)) {
    // "am 3. Mai", "Punkt 2. Budget": ordinals and enumerations read badly when cut.
    if (word.length <= 2 || MONTHS.has(following.toLowerCase())) return false;
    // Longer figures are mostly amounts and years, after which the sentence is over ("beträgt
    // 5000.", "für 2027."), but "unser 100. Jubiläum" is an ordinal as well.
    return !/^\p{Lu}/u.test(following) || SENTENCE_OPENERS.has(following.toLowerCase());
  }
  return !ABBREVIATIONS.has(word.toLowerCase()) && !CALENDAR_ABBREVIATIONS.has(word);
}

/** The sentences of `text`, each with its terminator, in order. */
export function splitSentences(text: string, lang: LangCode): string[] {
  const enders = LANGUAGES[lang].sentenceEnders;
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!endsSentence(text, i, enders)) continue;
    // Swallow runs of terminators ("?!", "...").
    let end = i + 1;
    while (end < text.length && enders.includes(text[end] ?? '')) end++;
    const sentence = text.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
    i = end - 1;
  }
  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

const CLAUSE_BREAKS = ',;:،؛—–';

/** Where to cut `text` just after its last clause break at or before `limit` (not before `floor`), or -1. */
function clauseCut(text: string, limit: number, floor: number): number {
  for (let i = Math.min(limit, text.length) - 1; i > floor; i--) {
    if (CLAUSE_BREAKS.includes(text[i] ?? '') && /\s/u.test(text[i + 1] ?? ' ')) return i + 1;
  }
  return -1;
}

/** Break an over-long sentence at the last clause break (or space) before `maxChars`. */
export function wrapLongSentence(sentence: string, maxChars: number): string[] {
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > maxChars) {
    let cut = clauseCut(rest, maxChars, maxChars * 0.4);
    if (cut === -1) {
      const space = rest.lastIndexOf(' ', maxChars);
      cut = space > maxChars * 0.4 ? space : maxChars;
    }
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export interface SplitOptions {
  /** Upper bound for a chunk. */
  maxChars?: number;
  /** Chunks are merged with their neighbour until they reach this size. */
  minChars?: number;
}

/**
 * The first chunk decides when the listener hears anything at all: it is synthesized on its
 * own, and the later chunks are synthesized while it plays. A sentence of this size is back
 * from the voice service in well under a second; below the minimum the request overhead
 * dominates and the next sentence may as well ride along.
 */
const FIRST_CHUNK_MIN_CHARS = 30;
const FIRST_CHUNK_MAX_CHARS = 120;

/**
 * Split text into chunks that are synthesized as separate audio files, so the first
 * sentence can start playing while the rest is still being generated.
 *
 * The first chunk is the first sentence alone (a longer one is cut at a clause break); the
 * rest is merged into chunks of `minChars`..`maxChars`. Chunks end on sentence boundaries
 * where possible, never inside a word, and their concatenation (joined by spaces) equals the
 * normalized input.
 */
export function splitForSpeech(text: string, lang: LangCode, options: SplitOptions = {}): string[] {
  const maxChars = options.maxChars ?? 220;
  const minChars = Math.min(options.minChars ?? 60, maxChars);
  const firstMax = Math.min(FIRST_CHUNK_MAX_CHARS, maxChars);
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const sentences = splitSentences(normalized, lang);
  let first = sentences.shift() ?? '';
  while (first.length < FIRST_CHUNK_MIN_CHARS && sentences.length > 0) {
    const next = sentences[0] ?? '';
    if (first.length + 1 + next.length > maxChars) break;
    first = `${first} ${next}`;
    sentences.shift();
  }
  if (first.length > firstMax) {
    const cut = clauseCut(first, firstMax, FIRST_CHUNK_MIN_CHARS);
    if (cut !== -1) {
      sentences.unshift(first.slice(cut).trim());
      first = first.slice(0, cut).trim();
    }
  }

  const pieces = [first, ...sentences].flatMap((sentence) =>
    sentence.length > maxChars ? wrapLongSentence(sentence, maxChars) : [sentence],
  );
  const chunks: string[] = [pieces.shift() ?? first];
  let current = '';
  for (const piece of pieces) {
    if (!current) {
      current = piece;
    } else if (current.length < minChars && current.length + 1 + piece.length <= maxChars) {
      current = `${current} ${piece}`;
    } else {
      chunks.push(current);
      current = piece;
    }
  }
  if (current) {
    const last = chunks[chunks.length - 1];
    // Avoid a tiny trailing chunk ("Danke.") that would be a separate request and an audible gap.
    const room = chunks.length === 1 ? firstMax : maxChars;
    if (last !== undefined && current.length < minChars / 2 && last.length + 1 + current.length <= room) {
      chunks[chunks.length - 1] = `${last} ${current}`;
    } else {
      chunks.push(current);
    }
  }
  return chunks;
}

/**
 * Speaking rate for the next utterance. When translated speech is piling up in the
 * browser (the speaker is faster than the interpreter), talk faster to catch up.
 */
export function effectiveSpeechRate(baseRate: number, playbackLagMs: number): number {
  let boost = 1;
  if (playbackLagMs > 9_000) boost = 1.3;
  else if (playbackLagMs > 5_000) boost = 1.2;
  else if (playbackLagMs > 2_500) boost = 1.1;
  const rate = baseRate * boost;
  return Math.round(Math.min(SPEECH_RATE_MAX + 0.1, Math.max(SPEECH_RATE_MIN, rate)) * 100) / 100;
}

/** Root-mean-square level of 16-bit PCM, 0..1. */
export function pcmRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const s = (pcm[i] ?? 0) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / pcm.length);
}
