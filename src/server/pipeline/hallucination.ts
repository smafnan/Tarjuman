import type { LangCode } from '../../shared/languages';
import type { DropReason } from '../../shared/protocol';
import { arabicScriptRatio } from '../providers/mt/prompt';
import {
  buildWhisperPrompt,
  compressionRatioLimit,
  WHISPER_LOGPROB_THRESHOLD,
  WHISPER_PROMPT_LEAD,
  WHISPER_NO_SPEECH_THRESHOLD,
} from '../providers/stt/groqWhisper';
import type { SttResult } from '../providers/types';

/**
 * Decides whether a transcript is real speech or a speech-recognition artefact.
 *
 * Whisper-family models, when fed noise or near-silence, do not return nothing: they
 * return text they saw a lot in training — subtitle credits, "thanks for watching",
 * or one word repeated forever. Speaking that into a business call would be worse than
 * staying silent, so the pipeline drops it. The browser VAD already keeps most non-speech
 * away from the recognizer; this is the second line of defence.
 */

export type TranscriptVerdict =
  | {
      keep: true;
      /**
       * Set when artefact sentences were removed from the transcript: the text to use
       * instead of the one that was judged. Absent when the transcript is fine as it is.
       */
      text?: string;
    }
  | { keep: false; reason: DropReason; detail: string };

/**
 * Urdu text reaches us with interchangeable code points for the same letter (Arabic vs
 * Persian yeh and kaf, several forms of heh, hamza written precomposed or combining).
 * Map them to one form so phrase matching does not depend on which the recognizer chose.
 */
export function unifyArabicScript(text: string): string {
  return text
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '') // short vowels, hamza marks, tatweel
    .replace(/[\u064a\u0649\u0626]/g, '\u06cc') // yeh variants and yeh-hamza -> Farsi yeh
    .replace(/\u0643/g, '\u06a9') // Arabic kaf -> keheh
    .replace(/[\u0647\u06d5\u06c0\u06c2]/g, '\u06c1'); // heh variants -> heh goal
}

/** Lower-case, strip punctuation and Latin diacritics, unify Urdu letter forms, collapse whitespace. */
export function normalizeForMatch(text: string): string {
  const latinFolded = text
    .toLowerCase()
    // Fold accents on Latin letters only; decomposing Arabic letters would change them.
    .replace(/[\u00c0-\u024f]/g, (char) => char.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  return unifyArabicScript(latinFolded)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BROADCASTER = '(?:ZDF|ARD|SWR|WDR|NDR|ORF|BR|MDR|RBB)';
const YEAR = '(?:19|20)\\d\\d';
/** Not part of a longer word or compound: the "ARD-Mediathek" is not the ARD. */
const WORD_START = '(?<![\\p{L}\\p{N}-])';
const WORD_END = '(?![\\p{L}\\p{N}-])';
const SENTENCE_START = '(?<=^\\s*|[.!?]\\s+)';
const SENTENCE_END = '(?=\\s*(?:[.!?]|$))';
/** "Wir prüfen die Untertitel der ARD" is somebody talking about subtitles; a credit has no article. */
const NO_DETERMINER =
  '(?<!\\b(?:die|den|der|dem|diese|diesen|dieser|unsere|unseren|ihre|ihren|eure|meine|keine|eine|einen|alle|mit|ohne)\\s+)';
const SUBTITLES = `${WORD_START}${NO_DETERMINER}Untertitel(?:ung)?`;
const OF_BROADCASTER =
  `\\s+(?:des|der|vom)\\s+${BROADCASTER}${WORD_END}` + `(?:\\s+f(?:ü|ue)r\\s+funk${WORD_END})?`;
const DATED = `(?:\\s*,\\s*|\\s+)${YEAR}${WORD_END}`;

/**
 * Broadcast and subtitling credits. Whisper learned them from the last frames of television
 * recordings and appends them to quiet audio; nobody says them, so they are taken out wherever
 * they stand, also at the end of a sentence without a full stop before them.
 *
 * Deliberately tight: this tool is used to talk about subtitles, so only the fixed wording of
 * a credit counts ("Die Untertitel für die ARD-Mediathek liefern wir nächste Woche." is
 * speech), and the less of that wording there is, the more the place has to say for it.
 */
const CREDITS = new RegExp(
  [
    // "Untertitelung des ZDF, 2020", "Untertitel im Auftrag des ZDF für funk, 2017": anywhere.
    `${SUBTITLES}(?:\\s+im\\s+Auftrag)?${OF_BROADCASTER}${DATED}`,
    // Without the year, only where a sentence ends: "… Untertitelung des ZDF".
    `${WORD_START}${NO_DETERMINER}Untertitel(?:ung(?:\\s+im\\s+Auftrag)?|\\s+im\\s+Auftrag)` +
      `${OF_BROADCASTER}${SENTENCE_END}`,
    // "Untertitel der ARD" is also what people ask for, so only as a sentence of its own.
    `${SENTENCE_START}Untertitel${OF_BROADCASTER}${SENTENCE_END}`,
    // "Untertitelung. BR 2018"
    `${SUBTITLES}[.,:]?\\s+${BROADCASTER}${DATED}`,
    // "Untertitel der Amara.org-Community", "Subtitles by the Amara.org community"
    `${WORD_START}Untertitel(?:ung)?(?:\\s+(?:im\\s+Auftrag|aufgrund))?\\s+(?:der|von|durch)\\s+` +
      `(?:der\\s+)?Amara(?:\\.?\\s?org)?(?:[-\\s]Community)?${WORD_END}`,
    `${WORD_START}Subtitles?\\s+by\\s+(?:the\\s+)?Amara(?:\\.?\\s?org)?(?:\\s+community)?${WORD_END}`,
    `${WORD_START}Untertitel\\p{L}*\\s+(?:von|durch)\\s+Stephanie\\s+Geiges${WORD_END}`,
    `${WORD_START}Transcribed\\s+by\\s+(?:https?://)?(?:www\\.)?otter(?:\\.ai)?${WORD_END}`,
    `${WORD_START}Copyright\\s+${BROADCASTER}\\s+${YEAR}${WORD_END}`,
    // A bare "SWR 2021" is a credit only as a sentence of its own.
    `${SENTENCE_START}(?:SWR|WDR|NDR|ZDF)\\s+20\\d\\d${SENTENCE_END}`,
  ].join('|'),
  'giu',
);
/**
 * "Untertitel von Stephanie Geiges", with any name. Case decides what a name is, so this one
 * is matched as written, and only as a sentence of its own ("Die Untertitel von Herrn Weber
 * fehlen noch." is speech).
 */
const NAMED_CREDIT = new RegExp(
  `${SENTENCE_START}Untertitel(?:ung)?\\s+(?:von|durch)\\s+\\p{Lu}[\\p{L}'’-]+` +
    `(?:\\s+\\p{Lu}[\\p{L}'’-]+){0,2}${SENTENCE_END}`,
  'gu',
);

/** `text` without the matches of `credit`; what is spoken around a credit stays, tidied up. */
function withoutMatches(text: string, credit: RegExp): string {
  let kept = '';
  let position = 0;
  let found = false;
  for (const match of text.matchAll(credit)) {
    found = true;
    kept = `${kept}${text.slice(position, match.index)}`.replace(/[\s,;:–—-]+$/u, '');
    position = match.index + match[0].length;
    const closing = /^[\s.!?,;:]*/u.exec(text.slice(position))?.[0] ?? '';
    position += closing.length;
    // The credit's full stop goes with it, unless the speech before it has none of its own.
    const terminator = /[.!?]/u.exec(closing)?.[0];
    if (terminator && kept && !/[.!?۔؟]$/u.test(kept)) kept += terminator;
    kept += ' ';
  }
  return found ? `${kept}${text.slice(position)}`.trim() : text;
}

/** A pattern for whole words of normalized text; Urdu is written naturally and unified here. */
const wholeWords = (source: string): RegExp =>
  new RegExp(`(?<![^ ])(?:${unifyArabicScript(source)})(?![^ ])`, 'g');

const URDU_REQUEST = '(کریں|کر لیں|کرلیں|کر دیں|کردیں|کیجیے|کیجئے|کرنا نہ بھولیں|کرنا مت بھولیں)';

/**
 * The stock lines of online videos, which Whisper returns for noise. Matched against
 * normalized text (lower case, no punctuation, no diacritics). Each covers the line and the
 * objects it is said with ("this video", "ویڈیو"); what else may stand next to it decides
 * `sentenceKind`.
 *
 * Deliberately narrow: a loose pattern ("subscribe", "ویڈیو شیئر") would silence real speech.
 */
const BOILERPLATE_PHRASES: RegExp[] = [
  wholeWords(
    '(thanks|thank you)( so much| very much| a lot)?( all| everyone| guys)? for watching( this video| the video| everyone| guys)?',
  ),
  wholeWords('(like and )?subscribe to (my|our|the|this) channel( for more( videos)?)?'),
  wholeWords('(like|comment)( comment| share)? and subscribe'),
  wholeWords('(i ll |we ll |i will |we will )?see you( guys| all)? in the next (video|one)'),
  wholeWords('subtitles? by (the )?community'),
  wholeWords('(vielen dank|danke)( euch| ihnen)? (furs|fur das) zuschauen'),
  wholeWords(
    `((ہمارے|میرے|اس|اپنے) )?(یوٹیوب )?چینل (کو )?(ضرور )?(لائک|سبسکرائب)( اور (لائک|سبسکرائب|شیئر))?( ضرور)? ${URDU_REQUEST}`,
  ),
  wholeWords(`(اس )?ویڈیو (کو )?(ضرور )?(لائک( اور شیئر)?|شیئر اور لائک)( ضرور)? ${URDU_REQUEST}`),
  wholeWords('((یہ|اس) )?(ویڈیو )?دیکھنے (کا|کے لیے)( آپ کا)?( بہت)?( بہت)? شکریہ'),
];

/**
 * What video boilerplate is strung together with: connectives, requests and goodbyes. Real
 * speech on their own ("Bis zum nächsten Mal."), so they never make a sentence boilerplate.
 */
const FILLERS = wholeWords(
  [
    'do not forget to|don t forget to|make sure to|see you (next time|soon|later)|until next time',
    'have a (great|nice|good) day|take care|goodbye|bye|and|please|so|ll|will',
    'bis zum nachsten mal|bis bald|auf wiedersehen|tschuss|tschus|ciao|und|bitte',
    'اللہ حافظ|خدا حافظ|براہ کرم|براہ مہربانی|پلیز|اور|ہے|ہیں',
  ].join('|'),
);

/** Stands in for a boilerplate phrase; normalized text has no punctuation, so it cannot occur in one. */
const PHRASE = '§';
/** "Okay, thanks for watching, guys!": this many words besides phrases and fillers are still boilerplate. */
const MAX_STRAY_WORDS = 2;

/**
 * Is a sentence video boilerplate, a goodbye that may belong to one, or speech?
 *
 * Boilerplate is a sentence made of boilerplate phrases and fillers, give or take two words:
 * "Thanks for watching and don't forget to like and subscribe.", "Thank you so much for
 * watching, bye bye." The same phrase with content around it is speech and is kept whole, and
 * so is any sentence that names what was watched or which channel is meant, where the object
 * stands (after the phrase in English and German, before it in Urdu): "Thank you for watching
 * the demo, any questions?", "ڈیمو دیکھنے کا شکریہ", "ٹیمز کے چینل کو سبسکرائب کر لیں".
 */
function sentenceKind(sentence: string): 'speech' | 'boilerplate' | 'goodbye' {
  let rest = normalizeForMatch(sentence);
  for (const phrase of BOILERPLATE_PHRASES) rest = rest.replace(phrase, PHRASE);
  const tokens = rest.replace(FILLERS, ' ').split(' ').filter(Boolean);
  const stray = tokens.filter((token) => token !== PHRASE).length;
  if (stray === tokens.length) return stray === 0 ? 'goodbye' : 'speech';
  if (stray > MAX_STRAY_WORDS) return 'speech';
  const namesItsObject = tokens.some(
    (token, i) => token !== PHRASE && tokens[/\p{Script=Arabic}/u.test(token) ? i + 1 : i - 1] === PHRASE,
  );
  return namesItsObject ? 'speech' : 'boilerplate';
}

/**
 * The transcript without credits and boilerplate sentences ('' when nothing else is in it).
 * Speech that precedes a hallucinated closing line is kept.
 */
function withoutArtefacts(text: string): string {
  const spoken = withoutMatches(withoutMatches(text, CREDITS), NAMED_CREDIT);
  if (!normalizeForMatch(spoken)) return '';
  // Every terminator counts here, also after a number or an abbreviation: a piece is only
  // removed when all of it is boilerplate, so cutting too often cannot cost speech, while
  // cutting too rarely would let boilerplate hide behind the sentence before it.
  const sentences = spoken.split(/(?<=[.!?۔؟])\s+/u);
  const kinds = sentences.map(sentenceKind);
  if (!kinds.includes('boilerplate')) return spoken;
  // "Danke fürs Zuschauen. Bis zum nächsten Mal.": the goodbye is part of the boilerplate
  // when nothing else was said. Next to speech it may well be the speaker's own.
  if (!kinds.includes('speech')) return '';
  return sentences.filter((_, i) => kinds[i] !== 'boilerplate').join(' ');
}

/**
 * Short phrases that people do say ("Vielen Dank.") but that Whisper also emits for noise.
 * A transcript that consists ONLY of one of these is dropped when the recognizer itself
 * gives strong evidence that nobody spoke, and kept otherwise.
 */
const WEAK_PHRASES: Record<LangCode, Set<string>> = {
  de: new Set(
    [
      'Vielen Dank',
      'Danke',
      'Danke schön',
      'Vielen Dank für Ihre Aufmerksamkeit',
      'Vielen Dank für die Aufmerksamkeit',
      'Bis zum nächsten Mal',
      'Tschüss',
      'Ja',
      'So',
      'Musik',
      "Das war's",
    ].map(normalizeForMatch),
  ),
  en: new Set(
    [
      'Thank you',
      'Thanks',
      'Thank you very much',
      'Bye',
      'Bye bye',
      'You',
      'Okay',
      'So',
      'Music',
      'The end',
    ].map(normalizeForMatch),
  ),
  ur: new Set(['شکریہ', 'بہت شکریہ', 'جی', 'ہاں', 'اچھا', 'ٹھیک ہے', 'موسیقی'].map(normalizeForMatch)),
};

/** Below this the recognizer was guessing, whatever it says about speech probability. */
const LOGPROB_FLOOR = -1.5;
/** Nobody recites this many words of the recognizer's prompt in a row by chance. */
const PROMPT_ECHO_SURE_WORDS = 5;
/** A shorter run of prompt words is an echo only on weak audio, and never below this length. */
const PROMPT_ECHO_MIN_WORDS = 3;
/** Below / above these the recognizer was unsure; clear speech measures around -0.3 and 0.05. */
const PROMPT_ECHO_WEAK_LOGPROB = -0.7;
const PROMPT_ECHO_WEAK_NO_SPEECH = 0.3;

/**
 * Nobody speaks faster than this many characters per second (brisk speech is 15-20).
 * More text than the audio could possibly hold was invented by the recognizer.
 */
const MAX_CHARS_PER_SECOND = 40;
/** Short clips make the rate meaningless; below this length the check is skipped. */
const RATE_CHECK_MIN_CHARS = 40;

/** True when the text is mostly one short unit repeated (a decoding loop). */
export function isRepetitionLoop(normalized: string): boolean {
  const words = normalized.split(' ').filter(Boolean);
  if (words.length < 8) return false;

  // The same word many times in a row.
  let run = 1;
  for (let i = 1; i < words.length; i++) {
    run = words[i] === words[i - 1] ? run + 1 : 1;
    if (run >= 6) return true;
  }

  // The same 2-4 word phrase covering most of the text.
  for (let size = 2; size <= 4; size++) {
    if (words.length < size * 4) continue;
    const counts = new Map<string, number>();
    for (let i = 0; i + size <= words.length; i += size) {
      const gram = words.slice(i, i + size).join(' ');
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    const top = Math.max(...counts.values());
    if (top >= 4 && top * size >= words.length * 0.7) return true;
  }
  return false;
}

export interface TranscriptEvidence {
  lang: LangCode;
  /** Duration of the audio the transcript came from. */
  audioMs: number;
  /** The vocabulary hints that were sent along with the audio. */
  hints?: readonly string[];
  signals: Pick<SttResult, 'noSpeechProb' | 'avgLogProb' | 'compressionRatio'>;
}

/**
 * Whisper sometimes hands back the prompt it was given instead of transcribing: all of it,
 * the opening sentence cut off, or only the glossary at its end.
 *
 * The glossary is made of the words the meeting is about, so people say parts of the prompt
 * all the time ("Angebot, Rechnung, Lieferschein."). A short match is therefore an echo only
 * when the recognizer itself was unsure of what it heard.
 */
function echoesPrompt(normalized: string, evidence: TranscriptEvidence): boolean {
  const { noSpeechProb, avgLogProb, compressionRatio } = evidence.signals;
  // No signals at all: not Whisper. A multimodal recognizer never sees this prompt.
  if (noSpeechProb === undefined && avgLogProb === undefined && compressionRatio === undefined) return false;
  const hints = evidence.hints ?? [];
  const spoken = ` ${normalized} `;
  // Somebody who says a glossary term, or part of one ("S/4HANA Cloud."), said it.
  if (hints.some((hint) => ` ${normalizeForMatch(hint)} `.includes(spoken))) return false;
  if (!` ${normalizeForMatch(buildWhisperPrompt(evidence.lang, hints))} `.includes(spoken)) return false;

  if (normalized === normalizeForMatch(WHISPER_PROMPT_LEAD[evidence.lang])) return true;
  const length = normalized.split(' ').length;
  if (length >= PROMPT_ECHO_SURE_WORDS) return true;
  const unsure =
    (avgLogProb !== undefined && avgLogProb < PROMPT_ECHO_WEAK_LOGPROB) ||
    (noSpeechProb !== undefined && noSpeechProb > PROMPT_ECHO_WEAK_NO_SPEECH);
  return unsure && length >= PROMPT_ECHO_MIN_WORDS;
}

/**
 * Judge a transcript (already cleaned with `normalizeTranscript`). A kept verdict may carry
 * a `text` that replaces the transcript: the same without its artefact sentences.
 */
export function judgeTranscript(transcript: string, evidence: TranscriptEvidence): TranscriptVerdict {
  if (!normalizeForMatch(transcript)) return { keep: false, reason: 'no_speech', detail: 'empty transcript' };

  const { noSpeechProb, avgLogProb, compressionRatio } = evidence.signals;

  if (noSpeechProb !== undefined && avgLogProb !== undefined) {
    if (noSpeechProb > WHISPER_NO_SPEECH_THRESHOLD && avgLogProb < WHISPER_LOGPROB_THRESHOLD) {
      return { keep: false, reason: 'no_speech', detail: 'recognizer reports no speech' };
    }
  }
  if (avgLogProb !== undefined && avgLogProb < LOGPROB_FLOOR) {
    return { keep: false, reason: 'hallucination', detail: 'recognizer confidence too low' };
  }
  if (compressionRatio !== undefined && compressionRatio > compressionRatioLimit(transcript)) {
    return { keep: false, reason: 'hallucination', detail: 'repetitive output' };
  }
  if (isRepetitionLoop(normalizeForMatch(transcript))) {
    return { keep: false, reason: 'hallucination', detail: 'repetition loop' };
  }

  const text = withoutArtefacts(transcript);
  const normalized = normalizeForMatch(text);
  if (!normalized) return { keep: false, reason: 'hallucination', detail: 'known recognition artefact' };

  if (
    evidence.audioMs > 0 &&
    normalized.length >= RATE_CHECK_MIN_CHARS &&
    normalized.length / (evidence.audioMs / 1000) > MAX_CHARS_PER_SECOND
  ) {
    return { keep: false, reason: 'hallucination', detail: 'more text than the audio can hold' };
  }

  if (echoesPrompt(normalized, evidence)) {
    return { keep: false, reason: 'hallucination', detail: 'recognizer echoed its prompt' };
  }

  // Urdu audio transcribed in Devanagari, or German audio in Arabic script, means the recognizer
  // slipped into another language. (Latin text on the Urdu channel is fine: English is mixed in.)
  if (evidence.lang === 'ur' && /[\u0900-\u097f]/u.test(text)) {
    return { keep: false, reason: 'hallucination', detail: 'wrong script (Devanagari)' };
  }
  if (evidence.lang !== 'ur' && /\p{L}/u.test(text) && arabicScriptRatio(text) > 0.5) {
    return { keep: false, reason: 'hallucination', detail: 'wrong script (Arabic)' };
  }

  if (WEAK_PHRASES[evidence.lang].has(normalized)) {
    // "Ja.", "Danke." and "جی" are the most frequent replies in a meeting, the browser only
    // sends audio in which its speech detector heard a voice, and a lost answer is worse than
    // a stray "Danke". So one of Whisper's two no-speech signals has to be past its own
    // threshold; ordinary confidence values for a one-word clip are not evidence.
    // Recognizers that report no confidence (multimodal models) make their own "no speech"
    // decision, so their short answers are trusted.
    const noSpeech =
      (noSpeechProb !== undefined && noSpeechProb > WHISPER_NO_SPEECH_THRESHOLD) ||
      (avgLogProb !== undefined && avgLogProb < WHISPER_LOGPROB_THRESHOLD);
    if (noSpeech) {
      return { keep: false, reason: 'hallucination', detail: 'stock phrase on weak audio' };
    }
  }

  return text === transcript ? { keep: true } : { keep: true, text };
}
