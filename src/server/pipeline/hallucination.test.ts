import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import type { LangCode } from '../../shared/languages';
import { judgeTranscript, type TranscriptEvidence } from './hallucination';

type Signals = TranscriptEvidence['signals'];

function judge(text: string, lang: LangCode, signals: Signals = {}, audioMs = 6_000, hints: string[] = []) {
  return judgeTranscript(text, { lang, audioMs, signals, hints });
}

/** Whisper's own formula: UTF-8 length over zlib-compressed length. */
function compressionRatio(text: string): number {
  const bytes = Buffer.from(text, 'utf8');
  return bytes.length / deflateSync(bytes).length;
}

describe('recognition artefacts', () => {
  it('keeps real sentences that contain the words of an artefact', () => {
    for (const [text, lang] of [
      ['کیا آپ ویڈیو شیئر کر سکتے ہیں؟', 'ur'],
      ['میں ابھی اسکرین پر ویڈیو شیئر کرتا ہوں', 'ur'],
      ['یہ ویڈیو کو شیئر کر دیں تاکہ سب دیکھ سکیں', 'ur'],
      ['ویڈیو شیئر کریں', 'ur'],
      ['ٹیمز کے چینل کو سبسکرائب کر لیں تاکہ نوٹیفکیشن ملتے رہیں', 'ur'],
      ['ڈیمو دیکھنے کا شکریہ', 'ur'],
      ['پریزنٹیشن دیکھنے کا بہت شکریہ، اب سوالات لیتے ہیں', 'ur'],
      ['Die Untertitel für die ARD-Mediathek liefern wir nächste Woche.', 'de'],
      ['Wir brauchen die Untertitel bis Freitag, und per Funk sind die Kollegen nicht erreichbar.', 'de'],
      ['Untertitel für die ARD-Mediathek liefern wir nächste Woche.', 'de'],
      ['Vielen Dank fürs Zuschauen bei unserer Demo, gibt es Fragen?', 'de'],
      ['Thank you for watching the demo, any questions?', 'en'],
      ['Please subscribe to the channel so that you get the release notes.', 'en'],
      ['See you next time.', 'en'],
      // The sentence names what was watched or which channel is meant: speech, however short.
      ['Thanks for watching the demo.', 'en'],
      ['Vielen Dank fürs Zuschauen heute.', 'de'],
      ['ٹیمز کے چینل کو سبسکرائب کر لیں', 'ur'],
      // Subtitles and broadcasters as a topic of the meeting.
      ['Wir prüfen heute die Untertitel der ARD.', 'de'],
      ['Die Untertitel der ARD sind besser als unsere.', 'de'],
      ['Wir brauchen Untertitel der ARD.', 'de'],
      ['Wir brauchen Untertitel der ARD für den Beitrag.', 'de'],
      ['Die Untertitel von Herrn Weber fehlen noch.', 'de'],
      ['Das Budget des SWR 2021 war deutlich höher.', 'de'],
      ['Untertitel im Auftrag des ZDF für funk produzieren wir seit zwei Jahren.', 'de'],
      // Goodbyes are fillers of video boilerplate, and speech on their own.
      ['Bis zum nächsten Mal.', 'de'],
      ['Bitte. Tschüss.', 'de'],
      ['اللہ حافظ', 'ur'],
    ] as const) {
      expect(judge(text, lang), text).toEqual({ keep: true });
    }
  });

  it('drops boilerplate that is strung together from several stock phrases', () => {
    for (const [text, lang] of [
      ["Thanks for watching and don't forget to like and subscribe.", 'en'],
      ["Thank you for watching and I'll see you in the next video.", 'en'],
      ['Thank you so much for watching, bye bye.', 'en'],
      ['Thanks for watching, see you next time.', 'en'],
      ['Please subscribe to my channel', 'en'],
      ['Okay, thanks for watching, guys!', 'en'],
      ['Thanks for watching and have a great day.', 'en'],
      ['Thanks for watching! Please like and subscribe. Bye!', 'en'],
      ['Vielen Dank fürs Zuschauen, tschüss und bis bald!', 'de'],
      ['ویڈیو دیکھنے کا بہت شکریہ اور چینل کو سبسکرائب ضرور کریں، اللہ حافظ', 'ur'],
      ['ہمارے یوٹیوب چینل کو سبسکرائب کرنا نہ بھولیں', 'ur'],
    ] as const) {
      expect(judge(text, lang), text).toEqual({
        keep: false,
        reason: 'hallucination',
        detail: 'known recognition artefact',
      });
    }
  });

  it('removes a credit wherever it stands, also without a full stop before it', () => {
    const cases: [text: string, cleaned: string][] = [
      ['Wir liefern am Montag Untertitelung des ZDF, 2020', 'Wir liefern am Montag'],
      ['Wir liefern am Montag Untertitel im Auftrag des ZDF für funk, 2017', 'Wir liefern am Montag'],
      ['Guten Morgen zusammen Untertitel der Amara.org-Community', 'Guten Morgen zusammen'],
      ['Das Budget ist freigegeben, Untertitel von Stephanie Geiges', 'Das Budget ist freigegeben'],
      ['Wir liefern am Montag Untertitelung. BR 2018', 'Wir liefern am Montag'],
      ['Wir liefern am Montag Copyright WDR 2021', 'Wir liefern am Montag'],
      ['Wir liefern am Montag Untertitelung des ZDF, 2020. Passt das?', 'Wir liefern am Montag. Passt das?'],
      ['Untertitelung des ZDF, 2020 Guten Morgen zusammen.', 'Guten Morgen zusammen.'],
      ['Das war alles. SWR 2021', 'Das war alles.'],
      ['Das war alles. Untertitel von Max Mustermann', 'Das war alles.'],
      ['Das war alles. Untertitelung der ARD.', 'Das war alles.'],
      ['Wir liefern am Montag Untertitelung des ZDF', 'Wir liefern am Montag'],
      ['Wir liefern am Montag Untertitel im Auftrag des ZDF für funk.', 'Wir liefern am Montag.'],
      ['Das war alles. Untertitel der ARD.', 'Das war alles.'],
    ];
    for (const [text, cleaned] of cases) {
      expect(judge(text, 'de'), text).toEqual({ keep: true, text: cleaned });
    }
    for (const credit of [
      'UNTERTITELUNG DES ZDF, 2020',
      'Untertitel der ARD',
      'Untertitel von Max Mustermann.',
      'SWR 2021',
      'Untertitelung aufgrund der Amara.org-Community',
    ]) {
      expect(judge(credit, 'de'), credit).toMatchObject({
        keep: false,
        detail: 'known recognition artefact',
      });
    }
  });

  it('drops a transcript that is nothing but an artefact', () => {
    for (const [text, lang] of [
      ['Untertitel der Amara.org-Community', 'de'],
      ['Untertitelung des ZDF, 2020', 'de'],
      ['Untertitelung des ZDF für funk, 2017', 'de'],
      ['Untertitel im Auftrag des ZDF für funk, 2017', 'de'],
      ['Untertitel im Auftrag des ZDF, 2021', 'de'],
      ['Untertitelung. BR 2018', 'de'],
      ['Untertitel von Stephanie Geiges', 'de'],
      ['Copyright WDR 2021', 'de'],
      ['Vielen Dank fürs Zuschauen!', 'de'],
      ['Vielen Dank fürs Zuschauen und bis zum nächsten Mal.', 'de'],
      ['Danke fürs Zuschauen. Bis zum nächsten Mal.', 'de'],
      ['Thanks for watching!', 'en'],
      ['Thank you so much for watching.', 'en'],
      ['Please subscribe to my channel.', 'en'],
      ["Don't forget to like and subscribe.", 'en'],
      ['Subtitles by the Amara.org community', 'en'],
      ['Transcribed by https://otter.ai', 'en'],
      ['چینل کو سبسکرائب کریں', 'ur'],
      ['چینل کو لائک اور سبسکرائب ضرور کریں۔', 'ur'],
      ['ویڈیو کو لائک کریں', 'ur'],
      ['ویڈیو دیکھنے کا بہت شکریہ۔', 'ur'],
      // The artefact of another language on this channel.
      ['Thanks for watching!', 'ur'],
    ] as const) {
      expect(judge(text, lang), text).toEqual({
        keep: false,
        reason: 'hallucination',
        detail: 'known recognition artefact',
      });
    }
  });

  it('removes an artefact sentence and keeps the speech around it', () => {
    const cases: [text: string, lang: LangCode, cleaned: string][] = [
      ['Wir sehen uns am Montag. Vielen Dank fürs Zuschauen.', 'de', 'Wir sehen uns am Montag.'],
      ['Wir liefern am Montag. Untertitelung. BR 2018', 'de', 'Wir liefern am Montag.'],
      ['Das Budget ist freigegeben. Untertitel der Amara.org-Community', 'de', 'Das Budget ist freigegeben.'],
      [
        'Untertitelung des ZDF, 2020. Guten Morgen zusammen. Fangen wir an?',
        'de',
        'Guten Morgen zusammen. Fangen wir an?',
      ],
      ['The build is green. Thanks for watching!', 'en', 'The build is green.'],
      ['ہم کل ملتے ہیں۔ چینل کو سبسکرائب کریں۔', 'ur', 'ہم کل ملتے ہیں۔'],
    ];
    for (const [text, lang, cleaned] of cases) {
      expect(judge(text, lang), text).toEqual({ keep: true, text: cleaned });
    }
  });

  it('judges what is left after the artefact like any other transcript', () => {
    const text = 'Danke. Untertitel der Amara.org-Community';
    expect(judge(text, 'de', { noSpeechProb: 0.1, avgLogProb: -0.3 })).toEqual({
      keep: true,
      text: 'Danke.',
    });
    expect(judge(text, 'de', { noSpeechProb: 0.8, avgLogProb: -0.3 })).toMatchObject({
      keep: false,
      detail: 'stock phrase on weak audio',
    });
  });
});

describe('one-word answers', () => {
  it('keeps the most frequent replies of a meeting at ordinary confidence values', () => {
    for (const [text, lang, signals] of [
      ['Ja.', 'de', { noSpeechProb: 0.35, avgLogProb: -0.45 }],
      ['Ja.', 'de', { noSpeechProb: 0.1, avgLogProb: -0.75 }],
      ['Danke.', 'de', { noSpeechProb: 0.31, avgLogProb: -0.3 }],
      ['جی', 'ur', { noSpeechProb: 0.31, avgLogProb: -0.3 }],
      ['ٹھیک ہے۔', 'ur', { noSpeechProb: 0.55, avgLogProb: -0.95 }],
      ['Okay.', 'en', { noSpeechProb: 0.6, avgLogProb: -1.0 }],
      ['Thank you.', 'en', {}],
    ] as const) {
      expect(judge(text, lang, signals, 700), text).toEqual({ keep: true });
    }
  });

  it('drops a stock phrase only on strong evidence that nobody spoke', () => {
    for (const [text, lang, signals] of [
      ['Ja.', 'de', { noSpeechProb: 0.61, avgLogProb: -0.3 }],
      ['Danke.', 'de', { noSpeechProb: 0.05, avgLogProb: -1.05 }],
      ['جی', 'ur', { noSpeechProb: 0.9, avgLogProb: -0.2 }],
      ['Thank you.', 'en', { avgLogProb: -1.2 }],
    ] as const) {
      expect(judge(text, lang, signals, 700), text).toMatchObject({
        keep: false,
        reason: 'hallucination',
        detail: 'stock phrase on weak audio',
      });
    }
  });

  it('does not apply the stock-phrase rule to anything longer', () => {
    expect(judge('Ja, das machen wir.', 'de', { noSpeechProb: 0.7, avgLogProb: -0.4 }, 1_500)).toEqual({
      keep: true,
    });
  });
});

describe('compression ratio', () => {
  const clear = (text: string): Signals => ({
    noSpeechProb: 0.01,
    avgLogProb: -0.35,
    compressionRatio: compressionRatio(text),
  });

  it('keeps ordinary Urdu enumerations, which compress better than Latin text', () => {
    const utterances = [
      'پیر کو ہم ڈیزائن پر کام کریں گے، منگل کو ہم ڈیولپمنٹ پر کام کریں گے، بدھ کو ہم ٹیسٹنگ پر کام کریں گے، جمعرات کو ہم ڈپلائمنٹ پر کام کریں گے، جمعہ کو ہم کلائنٹ کو ڈیمو دیں گے اور ہفتے کو ہم فیڈبیک پر کام کریں گے۔',
      'پہلی قسط دس ہزار یورو کی ہوگی، دوسری قسط بیس ہزار یورو کی ہوگی، تیسری قسط تیس ہزار یورو کی ہوگی، چوتھی قسط چالیس ہزار یورو کی ہوگی اور پانچویں قسط پچاس ہزار یورو کی ہوگی، یعنی کل ملا کر ڈیڑھ لاکھ یورو بنتے ہیں۔',
      'میرا نمبر ہے صفر تین صفر صفر، ایک دو تین، چار پانچ چھ سات، دوبارہ بتاتا ہوں، صفر تین صفر صفر، ایک دو تین، چار پانچ چھ سات، اور دفتر کا نمبر ہے صفر چار دو، تین پانچ سات، چار پانچ چھ سات۔',
    ];
    for (const text of utterances) {
      const signals = clear(text);
      // The point of the case: these are above Whisper's Latin-script default.
      expect(signals.compressionRatio, text).toBeGreaterThan(2.4);
      expect(signals.compressionRatio, text).toBeLessThan(3.0);
      expect(judge(text, 'ur', signals, 15_000), text).toEqual({ keep: true });
    }
  });

  it('uses 3.0 for Arabic script and keeps 2.4 for Latin script', () => {
    const urdu = 'ہم اگلے ہفتے نیا ورژن جاری کریں گے۔';
    const german = 'Wir veröffentlichen nächste Woche die neue Version.';
    expect(judge(urdu, 'ur', { compressionRatio: 2.9 }).keep).toBe(true);
    expect(judge(urdu, 'ur', { compressionRatio: 3.1 })).toMatchObject({
      keep: false,
      detail: 'repetitive output',
    });
    expect(judge(german, 'de', { compressionRatio: 2.3 }).keep).toBe(true);
    expect(judge(german, 'de', { compressionRatio: 2.5 })).toMatchObject({
      keep: false,
      detail: 'repetitive output',
    });
    // The script of the text decides, not the channel: English spoken on the Urdu channel.
    expect(judge('Yes, the deployment is done.', 'ur', { compressionRatio: 2.5 }).keep).toBe(false);
  });

  it('still drops a real decoding loop in Urdu', () => {
    const loop = 'ہم یہ کام کر لیں گے۔ '.repeat(8).trim();
    const signals = clear(loop);
    expect(signals.compressionRatio).toBeGreaterThan(3.0);
    expect(judge(loop, 'ur', signals, 15_000)).toMatchObject({ keep: false, detail: 'repetitive output' });
  });
});

describe('prompt echo', () => {
  const hints = ['Khan', 'SAP', 'Tarjuman', 'Sprint'];
  const echo = { keep: false, reason: 'hallucination', detail: 'recognizer echoed its prompt' };
  /** What Whisper reports for clear speech, and for audio it could make little of. */
  const clear: Signals = { noSpeechProb: 0.02, avgLogProb: -0.25 };
  const weak: Signals[] = [
    { noSpeechProb: 0.02, avgLogProb: -0.75 },
    { noSpeechProb: 0.35, avgLogProb: -0.25 },
  ];
  const de = (text: string, signals: Signals = clear) => judge(text, 'de', signals, 3_000, hints);

  it('recognises the whole lead and any run of five prompt words or more, however clear the audio', () => {
    for (const text of [
      'Dies ist ein Gespräch in einem geschäftlichen Meeting. Khan, SAP, Tarjuman, Sprint.',
      'Dies ist ein Gespräch in einem geschäftlichen Meeting.',
      'geschäftlichen Meeting. Khan, SAP, Tarjuman, Sprint.',
      'Dies ist ein Gespräch in einem geschäftlichen',
      'Ein Gespräch in einem geschäftlichen Meeting.',
    ]) {
      expect(de(text), text).toEqual(echo);
    }
    const urduHints = ['خان', 'ایس اے پی'];
    for (const text of ['یہ ایک کاروباری میٹنگ کی گفتگو ہے۔', 'کاروباری میٹنگ کی گفتگو ہے۔']) {
      expect(judge(text, 'ur', clear, 3_000, urduHints), text).toEqual(echo);
    }
  });

  it('takes a shorter run of prompt words for an echo only when the recognizer was unsure', () => {
    for (const text of [
      'Khan, SAP, Tarjuman, Sprint.',
      'SAP, Tarjuman, Sprint.',
      'In einem geschäftlichen Meeting.',
    ]) {
      expect(de(text), text).toEqual({ keep: true });
      for (const signals of weak) expect(de(text, signals), text).toEqual(echo);
    }
    const urduHints = ['خان', 'ایس اے پی'];
    expect(judge('خان، ایس اے پی۔', 'ur', clear, 3_000, urduHints)).toEqual({ keep: true });
    expect(judge('خان، ایس اے پی۔', 'ur', weak[0], 3_000, urduHints)).toEqual(echo);
    // Two words are never enough.
    for (const signals of weak) expect(de('Tarjuman, Sprint.', signals)).toEqual({ keep: true });
  });

  it('keeps short answers taken from the glossary or the lead when the audio is clear', () => {
    const glossary = [
      'SAP S/4HANA Cloud Public Edition',
      'Müller und Söhne GmbH',
      'Angebot',
      'Rechnung',
      'Lieferschein',
    ];
    for (const text of [
      'S/4HANA Cloud.',
      'Müller und Söhne.',
      'Angebot, Rechnung, Lieferschein.',
      'In einem geschäftlichen Meeting.',
      'Dies ist ein Gespräch.',
    ]) {
      expect(judge(text, 'de', clear, 2_500, glossary), text).toEqual({ keep: true });
    }
    // Part of ONE term is speech even on weak audio; only a run across terms is an echo then.
    for (const signals of weak) {
      expect(judge('S/4HANA Cloud Public.', 'de', signals, 2_500, glossary)).toEqual({ keep: true });
      expect(judge('Angebot, Rechnung, Lieferschein.', 'de', signals, 2_500, glossary)).toEqual(echo);
    }
  });

  it('does not apply to a recognizer that reports no confidence: it was never given the prompt', () => {
    for (const text of [
      'Dies ist ein Gespräch in einem geschäftlichen Meeting. Khan, SAP, Tarjuman, Sprint.',
      'Dies ist ein Gespräch in einem geschäftlichen Meeting.',
      'Khan, SAP, Tarjuman, Sprint.',
    ]) {
      expect(de(text, {}), text).toEqual({ keep: true });
    }
  });

  it('keeps speech that merely shares words with the prompt', () => {
    for (const text of [
      'Tarjuman, Sprint.',
      'Herr Khan.',
      'SAP und Tarjuman im nächsten Sprint.',
      'Dies ist ein Gespräch über SAP mit Herrn Khan.',
      'Das Gespräch in einem geschäftlichen Rahmen war gut.',
    ]) {
      for (const signals of [clear, ...weak]) expect(de(text, signals), text).toEqual({ keep: true });
    }
  });

  it('keeps an answer that is one glossary term, however many words it has', () => {
    const terms = ['Proof of Concept', 'SAP S/4HANA', 'ایس اے پی'];
    for (const signals of [clear, ...weak]) {
      expect(judge('Proof of Concept.', 'de', signals, 1_500, terms)).toEqual({ keep: true });
      expect(judge('SAP S/4HANA.', 'de', signals, 1_500, terms)).toEqual({ keep: true });
      expect(judge('ایس اے پی', 'ur', signals, 1_500, terms)).toEqual({ keep: true });
    }
    // Running across terms, at this length, is the echo.
    expect(judge('Proof of Concept, SAP S/4HANA.', 'de', clear, 2_500, terms)).toEqual(echo);
  });
});
