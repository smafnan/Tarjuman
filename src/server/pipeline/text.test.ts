import { describe, expect, it } from 'vitest';

import { must } from '../../../tests/unit/helpers';
import { judgeTranscript, isRepetitionLoop, normalizeForMatch } from './hallucination';
import { ConversationMemory } from './memory';
import { effectiveSpeechRate, normalizeTranscript, pcmRms, splitForSpeech, splitSentences } from './text';

describe('normalizeTranscript', () => {
  it('removes non-speech annotations, stray quotes and extra whitespace', () => {
    expect(normalizeTranscript('  [Musik]  Guten   Morgen (Applaus) ♪ ')).toBe('Guten Morgen');
    expect(normalizeTranscript('„Guten Morgen.“')).toBe('Guten Morgen.');
    expect(normalizeTranscript('*lacht*')).toBe('');
    expect(normalizeTranscript(' ... ?! ')).toBe('');
  });

  it('recognises annotations in the languages and spellings recognizers use', () => {
    for (const annotation of [
      '[BLANK_AUDIO]',
      '[ Musik ]',
      '(leise Musik)',
      '[music playing]',
      '(Gelächter)',
      '(räuspert sich)',
      '(laughs)',
      '[inaudible]',
      '[silence]',
      '(موسیقی)',
      '[تالیاں]',
      '*Applaus*',
      '♪♪ 🎵',
      '()',
    ]) {
      expect(normalizeTranscript(annotation), annotation).toBe('');
      expect(normalizeTranscript(`Guten Morgen ${annotation} zusammen.`), annotation).toBe(
        'Guten Morgen zusammen.',
      );
    }
  });

  it('keeps brackets and asterisks that are part of what was said', () => {
    for (const text of [
      'Die Lieferung (ca. 200 Stück) kommt am Montag.',
      'Das kostet 500 Euro (netto) pro Monat.',
      'Das kostet 500 Euro (netto).',
      'Bitte drücken Sie *9* zum Stummschalten.',
      'Siehe Fußnote [2] im Vertrag.',
      'ہمارا بجٹ (تقریباً پانچ لاکھ) منظور ہو گیا ہے',
      'Die Funktion f(x) ist linear.',
      'Die Band (Musik und Tanz) kommt am Freitag.',
      'Preis (netto) (pro Monat) folgt.',
      '[2]',
      '*9*',
    ]) {
      expect(normalizeTranscript(text), text).toBe(text);
    }
  });

  it('removes what stands in square brackets or asterisks whatever the words, unless it is a figure', () => {
    for (const annotation of [
      '[SPEAKING FOREIGN LANGUAGE]',
      '[foreign language]',
      '[no audio]',
      '[typing]',
      '[clears throat]',
      '[Beta]',
      '*Sternchen*',
      '*seufzt tief*',
    ]) {
      expect(normalizeTranscript(annotation), annotation).toBe('');
      expect(normalizeTranscript(`Guten Morgen ${annotation} zusammen.`), annotation).toBe(
        'Guten Morgen zusammen.',
      );
    }
    // Accepted loss: square brackets are not spoken, so their words are not kept either.
    expect(normalizeTranscript('Version 2 [Beta] ist fertig.')).toBe('Version 2 ist fertig.');
  });

  it('removes round brackets that stand alone as a transcript or a sentence, whatever the words', () => {
    for (const annotation of [
      '(speaking in foreign language)',
      '(upbeat music)',
      '(dramatische Musik)',
      '(Telefon klingelt)',
      '(phone ringing)',
      '(Publikum lacht)',
      '(Er lacht.)',
      '(Sprecher räuspert sich)',
      '(unverständlich)',
      '(Tür fällt ins Schloss)',
      '(netto)',
      '(تقریباً پانچ لاکھ)',
    ]) {
      expect(normalizeTranscript(annotation), annotation).toBe('');
      expect(normalizeTranscript(`Guten Morgen zusammen. ${annotation}`), annotation).toBe(
        'Guten Morgen zusammen.',
      );
    }
    expect(normalizeTranscript('(Er lacht.) Weiter geht es.')).toBe('Weiter geht es.');
    expect(normalizeTranscript('(Publikum lacht) (Telefon klingelt)')).toBe('');
    expect(normalizeTranscript('[Musik] (Tür fällt ins Schloss) ♪')).toBe('');
  });

  it('removes round brackets inside a sentence only when all they hold is annotation vocabulary', () => {
    for (const annotation of [
      '(speaking in foreign language)',
      '(upbeat music)',
      '(dramatische Musik)',
      '(Telefon klingelt)',
      '(phone ringing)',
      '(Publikum lacht)',
      '(Sprecher räuspert sich)',
      '(unverständlich)',
    ]) {
      expect(normalizeTranscript(`Guten Morgen ${annotation} zusammen.`), annotation).toBe(
        'Guten Morgen zusammen.',
      );
    }
    const spoken = 'Der Kunde (Herr Weber lacht darüber) ist zufrieden.';
    expect(normalizeTranscript(spoken)).toBe(spoken);
  });

  it('strips quotes only when they wrap the whole transcript', () => {
    expect(normalizeTranscript('"Guten Morgen."')).toBe('Guten Morgen.');
    expect(normalizeTranscript('«Guten Morgen.»')).toBe('Guten Morgen.');
    expect(normalizeTranscript('„„Guten Morgen.““')).toBe('Guten Morgen.');
    expect(normalizeTranscript('Das ist "wichtig"')).toBe('Das ist "wichtig"');
    expect(normalizeTranscript('"Wichtig" ist das nicht')).toBe('"Wichtig" ist das nicht');
    expect(normalizeTranscript("Das war's")).toBe("Das war's");
    expect(normalizeTranscript('’s ist gut’')).toBe('’s ist gut’');
    expect(normalizeTranscript('"')).toBe('');
    expect(normalizeTranscript('""')).toBe('');
  });

  it('handles a long run of quotes, brackets or asterisks in linear time', () => {
    // The pattern this replaced took 2.5 s for 3,000 quotes and blocked the event loop.
    const inputs = [
      `${"'".repeat(20_000)}a`,
      `a${"'".repeat(20_000)}`,
      `${'"'.repeat(10_000)}a${'"'.repeat(10_000)}`,
      `${"'".repeat(10_000)} a ${"'".repeat(10_000)} b ${"'".repeat(10_000)}`,
      '('.repeat(20_000),
      '(), '.repeat(5_000),
      '[*'.repeat(10_000),
    ];
    // Once before the clock starts, so compiling the patterns is not what gets measured.
    normalizeTranscript('"a" (b) [c] *d*');
    for (const input of inputs) {
      const startedAt = performance.now();
      normalizeTranscript(input);
      expect(performance.now() - startedAt, input.slice(0, 12)).toBeLessThan(100);
    }
    expect(normalizeTranscript(`${"'".repeat(20_000)}a`)).toBe(`${"'".repeat(20_000)}a`);
    expect(normalizeTranscript(`${'"'.repeat(10_000)}a${'"'.repeat(10_000)}`)).toBe('a');
  });
});

describe('splitForSpeech', () => {
  const join = (chunks: string[]) => chunks.join(' ');

  it('leaves short text alone', () => {
    expect(splitForSpeech('Guten Morgen. Wie geht es Ihnen?', 'de')).toEqual([
      'Guten Morgen. Wie geht es Ihnen?',
    ]);
    expect(splitForSpeech('Wir liefern am Montag um zehn Uhr. Danke.', 'de')).toEqual([
      'Wir liefern am Montag um zehn Uhr. Danke.',
    ]);
    expect(splitForSpeech('   ', 'de')).toEqual([]);
  });

  it('makes the first sentence a chunk of its own, so it plays while the rest is synthesized', () => {
    const first = 'Guten Morgen zusammen, vielen Dank, dass Sie sich die Zeit genommen haben.';
    const second =
      'Ich würde gern mit dem Stand des Projekts beginnen und danach die offenen Punkte durchgehen.';
    const third = 'Wenn jemand eine Frage hat, können Sie gern zwischendurch fragen.';
    // Used to be one request of 168 characters.
    expect(splitForSpeech(`${first} ${second}`, 'de')).toEqual([first, second]);
    expect(splitForSpeech(`${first} ${second} ${third}`, 'de')).toEqual([first, second, third]);
    // The rest is chunked as before: short sentences are merged until a chunk has 60 characters.
    const points = 'Erstens das Budget. Zweitens der Zeitplan. Drittens das Team und die Aufgaben.';
    expect(splitForSpeech(`${first} ${points}`, 'de')).toEqual([first, points]);

    const urduFirst = 'السلام علیکم، آپ سب کا بہت شکریہ کہ آپ نے وقت نکالا۔';
    const urduSecond =
      'میں پروجیکٹ کی موجودہ صورتحال سے شروع کرنا چاہوں گا اور پھر باقی نکات پر بات کریں گے۔';
    expect(splitForSpeech(`${urduFirst} ${urduSecond}`, 'ur')).toEqual([urduFirst, urduSecond]);
  });

  it('joins a very short opening with the sentence after it', () => {
    const second = 'Das machen wir so, wie Sie es vorgeschlagen haben.';
    const third = 'Danach sehen wir gemeinsam weiter, was der Kunde dazu sagt.';
    expect(splitForSpeech(`Ja. ${second} ${third}`, 'de')).toEqual([`Ja. ${second}`, third]);
    expect(splitForSpeech(`Ja. Gut. Okay. ${second} ${third}`, 'de')).toEqual([
      `Ja. Gut. Okay. ${second}`,
      third,
    ]);
  });

  it('cuts a long first sentence at the last clause break before 120 characters', () => {
    const sentence =
      'Wir haben mit dem Kunden gesprochen und er hat gesagt, dass er dieses Feature bis Ende des Monats braucht, ' +
      'und deshalb müssen wir jetzt entscheiden, wer im Team daran arbeitet.';
    const chunks = splitForSpeech(sentence, 'de');
    expect(chunks).toEqual([
      'Wir haben mit dem Kunden gesprochen und er hat gesagt, dass er dieses Feature bis Ende des Monats braucht,',
      'und deshalb müssen wir jetzt entscheiden, wer im Team daran arbeitet.',
    ]);
    expect(must(chunks[0]).length).toBeLessThanOrEqual(120);

    // Without a clause break there is nowhere good to cut: the sentence stays whole.
    const unbroken =
      'Wir haben mit dem Kunden gesprochen und er braucht dieses Feature bis Ende des Monats und deshalb müssen wir jetzt entscheiden wer daran arbeitet.';
    expect(splitForSpeech(unbroken, 'de')).toEqual([unbroken]);
  });

  it('gives back the normalized input when the chunks are joined, whatever the shape of the text', () => {
    const texts: [string, 'de' | 'ur'][] = [
      ['Ja.', 'de'],
      ['Ja. Nein. Doch. Oh! Aha? So. Gut. Na dann. Bis morgen. Tschüss.', 'de'],
      ['Wir haben Plan A. Wir haben auch Plan B. Das ist die Situation. Was meinen Sie dazu?', 'de'],
      [`${'Wort '.repeat(90)}Ende.`, 'de'],
      [`Kurz. ${'Ein sehr langer Satz ohne jedes Komma '.repeat(8)}endet hier. Danke.`, 'de'],
      ['جی۔ ٹھیک ہے۔ ہم اگلے ہفتے نیا ورژن جاری کریں گے، اور اس کے بعد ٹیم کے ساتھ ایک میٹنگ ہوگی۔', 'ur'],
      [
        'ہم نے کلائنٹ سے بات کی ہے اور انہوں نے کہا ہے کہ انہیں یہ فیچر اگلے مہینے تک چاہیے اور وہ اس کے لیے اضافی ادائیگی کرنے کو تیار ہیں تو ہمیں اپنی ٹیم کے ساتھ بیٹھ کر یہ دیکھنا ہوگا کہ ہم یہ کام کتنے وقت میں مکمل کر سکتے ہیں اور اس کے لیے ہمیں کتنے لوگوں کی ضرورت ہوگی',
        'ur',
      ],
    ];
    for (const [text, lang] of texts) {
      const chunks = splitForSpeech(`  ${text.replace(/ /g, '  ')} `, lang);
      expect(join(chunks), text).toBe(text.replace(/\s+/g, ' ').trim());
      for (const chunk of chunks) expect(chunk.length, chunk).toBeLessThanOrEqual(220);
    }
  });

  it('splits long text at sentence ends without losing or reordering anything', () => {
    const text = Array.from(
      { length: 9 },
      (_, i) => `Dies ist der Satz Nummer ${i + 1} einer längeren Erklärung.`,
    ).join(' ');
    const chunks = splitForSpeech(text, 'de');
    expect(chunks.length).toBeGreaterThan(1);
    expect(join(chunks)).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(220);
      expect(chunk).toMatch(/\.$/);
    }
  });

  it('knows the Urdu full stop', () => {
    const sentence = 'ہم اگلے ہفتے نیا ورژن جاری کریں گے اور اس کے بعد ٹیم کے ساتھ ایک میٹنگ ہوگی۔';
    const text = Array.from({ length: 5 }, () => sentence).join(' ');
    const chunks = splitForSpeech(text, 'ur');
    expect(chunks.length).toBeGreaterThan(1);
    expect(join(chunks)).toBe(text);
    for (const chunk of chunks) expect(chunk.endsWith('۔')).toBe(true);
  });

  it('does not cut after abbreviations, ordinals or inside numbers', () => {
    const filler = 'Das ist ein längerer Satz, der genug Text liefert, damit überhaupt geteilt werden muss.';
    const text = `${filler} Wir treffen uns am 3. Mai, z. B. um 10.30 Uhr mit Dr. Weber. ${filler} ${filler}`;
    const chunks = splitForSpeech(text, 'de');
    expect(join(chunks)).toBe(text);
    for (const chunk of chunks) {
      expect(chunk).not.toMatch(/am 3\.$/);
      expect(chunk).not.toMatch(/z\.$/);
      expect(chunk).not.toMatch(/Dr\.$/);
      expect(chunk).not.toMatch(/10\.$/);
    }
  });

  it('does not cut short texts at abbreviations and ordinals', () => {
    for (const text of [
      'Wir haben den Vertrag mit der Müller GmbH & Co. KG gestern Nachmittag endlich unterschrieben.',
      'Wir liefern innerhalb von max. zehn Werktagen nach Eingang der Bestellung.',
      'Das ist in der Regel kein Problem, v. a. bei größeren Bestellungen aus dem Ausland.',
      'Wir feiern nächste Woche unser 100. Jubiläum mit allen Kolleginnen und Kollegen.',
      'Die Lieferung kommt am Do. Vormittag, die Rechnung ist vom 15. Dez. Vorjahr.',
      'Der Termin ist am Mo. 12. Januar, Abs. 3 des Vertrags gilt exkl. Mehrwertsteuer.',
      'The contract with Smith Jr. and Acme Corp. Holdings was signed on Sept. 3 last year.',
    ]) {
      expect(splitForSpeech(text, 'de'), text).toEqual([text]);
      expect(splitSentences(text, 'de'), text).toEqual([text]);
    }
  });

  it('takes a full stop before a lower-case word as part of an abbreviation or ordinal', () => {
    expect(
      splitSentences('Das gilt lt. unserem Vertrag bis zum 2024. tag der Laufzeit. Danke.', 'de'),
    ).toEqual(['Das gilt lt. unserem Vertrag bis zum 2024. tag der Laufzeit.', 'Danke.']);
    expect(splitSentences('Die 1250. Bestellung kam im 2023. März. Wir feiern das.', 'de')).toEqual([
      'Die 1250. Bestellung kam im 2023. März.',
      'Wir feiern das.',
    ]);
    // Capital letters after "!" and "?" are not needed: those never belong to an abbreviation.
    expect(splitSentences('Wirklich? ja! genau.', 'de')).toEqual(['Wirklich?', 'ja!', 'genau.']);
    // Urdu has no letter case, so nothing changes there.
    expect(splitSentences('بجٹ 5000. اگلے ہفتے ملتے ہیں.', 'ur')).toEqual([
      'بجٹ 5000.',
      'اگلے ہفتے ملتے ہیں.',
    ]);
  });

  it('still ends a sentence at "so." and "do.", which are weekdays only when capitalised', () => {
    expect(splitSentences('Das ist nun einmal so. Wir machen weiter.', 'de')).toEqual([
      'Das ist nun einmal so.',
      'Wir machen weiter.',
    ]);
    expect(splitSentences('Yes, we do. Then we ship it.', 'en')).toEqual(['Yes, we do.', 'Then we ship it.']);
  });

  it('ends a sentence after an amount or a year, and not after "Mio." or "bzgl."', () => {
    expect(splitSentences('Das Budget beträgt 5000. Wir treffen uns am 3. Mai wieder.', 'de')).toEqual([
      'Das Budget beträgt 5000.',
      'Wir treffen uns am 3. Mai wieder.',
    ]);
    expect(
      splitSentences('Der Umsatz lag bei 5 Mio. Euro. Bzgl. der Details melde ich mich 2027. Danke.', 'de'),
    ).toEqual(['Der Umsatz lag bei 5 Mio. Euro.', 'Bzgl. der Details melde ich mich 2027.', 'Danke.']);
    expect(splitSentences('کیا آپ کو رپورٹ مل گئی ہے؟ جی ہاں۔ شکریہ', 'ur')).toEqual([
      'کیا آپ کو رپورٹ مل گئی ہے؟',
      'جی ہاں۔',
      'شکریہ',
    ]);
  });

  it('wraps a sentence that is too long on its own, at a clause break', () => {
    const sentence = `${Array.from({ length: 30 }, (_, i) => `Teil ${i + 1} der Aufzählung`).join(', ')}.`;
    const chunks = splitForSpeech(sentence, 'de', { maxChars: 120 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(join(chunks)).toBe(sentence);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(120);
    expect(chunks[0]?.endsWith(',')).toBe(true);
  });
});

describe('effectiveSpeechRate', () => {
  it('speeds up in steps as translated speech queues up, within limits', () => {
    expect(effectiveSpeechRate(1, 0)).toBe(1);
    expect(effectiveSpeechRate(1, 3_000)).toBe(1.1);
    expect(effectiveSpeechRate(1, 6_000)).toBe(1.2);
    expect(effectiveSpeechRate(1, 20_000)).toBe(1.3);
    expect(effectiveSpeechRate(1.5, 20_000)).toBe(1.6);
    expect(effectiveSpeechRate(0.5, 0)).toBe(0.7);
  });
});

describe('pcmRms', () => {
  it('measures level on a 0..1 scale', () => {
    expect(pcmRms(new Int16Array(0))).toBe(0);
    expect(pcmRms(new Int16Array(100))).toBe(0);
    expect(pcmRms(new Int16Array(100).fill(16384))).toBeCloseTo(0.5, 3);
  });
});

describe('judgeTranscript', () => {
  const evidence = (lang: 'ur' | 'de' | 'en', signals = {}, audioMs = 4_000) => ({ lang, audioMs, signals });
  const kept = (text: string, lang: 'ur' | 'de' | 'en', signals = {}, audioMs = 4_000) =>
    judgeTranscript(text, evidence(lang, signals, audioMs)).keep;

  it('keeps ordinary business sentences, including ones about subtitles, translation and subscriptions', () => {
    expect(kept('Können wir mit dem Stand des Sprints anfangen?', 'de')).toBe(true);
    expect(kept('Die Untertitel der Präsentation sind falsch.', 'de')).toBe(true);
    expect(kept('The document was translated by our team.', 'en')).toBe(true);
    expect(kept('Customers can subscribe to the premium plan.', 'en')).toBe(true);
    expect(kept('ہمارے سبسکرائبرز بڑھ رہے ہیں', 'ur')).toBe(true);
    expect(kept('ہم نے payment module مکمل کر لیا ہے', 'ur')).toBe(true);
    expect(kept('Yes, the deployment is done.', 'ur')).toBe(true);
  });

  it('drops well-known recognition artefacts', () => {
    for (const [text, lang] of [
      ['Untertitel der Amara.org-Community', 'de'],
      ['Untertitelung des ZDF für funk, 2017', 'de'],
      ['Untertitel im Auftrag des ZDF, 2021', 'de'],
      ['Thanks for watching!', 'en'],
      ['Thank you so much for watching.', 'en'],
      ['Please subscribe to my channel.', 'en'],
      ['چینل کو سبسکرائب کریں', 'ur'],
      ['ویڈیو کو لائک کریں', 'ur'],
    ] as const) {
      const verdict = judgeTranscript(text, evidence(lang));
      expect(verdict, text).toMatchObject({ keep: false, reason: 'hallucination' });
    }
  });

  it('matches Urdu regardless of which code points the recognizer used for the same letters', () => {
    // Arabic yeh (U+064A) and kaf (U+0643) instead of the Urdu forms.
    expect(kept('چينل كو سبسكرائب كريں', 'ur')).toBe(false);
    expect(normalizeForMatch('كريں')).toBe(normalizeForMatch('کریں'));
  });

  it("applies Whisper's own no-speech rule and a confidence floor", () => {
    expect(
      judgeTranscript('Guten Morgen zusammen.', evidence('de', { noSpeechProb: 0.8, avgLogProb: -1.2 })),
    ).toMatchObject({
      keep: false,
      reason: 'no_speech',
    });
    expect(kept('Guten Morgen zusammen.', 'de', { noSpeechProb: 0.8, avgLogProb: -0.3 })).toBe(true);
    expect(kept('Guten Morgen zusammen.', 'de', { avgLogProb: -1.7 })).toBe(false);
    expect(kept('Guten Morgen zusammen.', 'de', { compressionRatio: 2.9 })).toBe(false);
  });

  it('drops decoding loops', () => {
    expect(isRepetitionLoop('ja ja ja ja ja ja ja ja ja')).toBe(true);
    expect(isRepetitionLoop('vielen dank vielen dank vielen dank vielen dank vielen dank')).toBe(true);
    expect(isRepetitionLoop('wir haben das modul getestet und es funktioniert jetzt sehr gut')).toBe(false);
    expect(kept('Ja ja ja ja ja ja ja ja ja ja.', 'de')).toBe(false);
  });

  it('drops text in the wrong script for the channel, and an echoed prompt', () => {
    expect(kept('हम अगले हफ्ते मिलेंगे', 'ur')).toBe(false);
    expect(kept('ہم اگلے ہفتے ملیں گے', 'de')).toBe(false);
    // Only Whisper is given the prompt, and Whisper reports confidence: without any signal
    // the rule does not apply (see the prompt-echo tests next to the filter).
    const signals = { noSpeechProb: 0.1, avgLogProb: -0.3 };
    expect(kept('Dies ist ein Gespräch in einem geschäftlichen Meeting.', 'de', signals)).toBe(false);
    // The echo may include the glossary that was appended to the prompt, or stop part-way.
    const withHints = (text: string) =>
      judgeTranscript(text, { lang: 'de', audioMs: 6_000, signals, hints: ['Khan', 'SAP'] }).keep;
    expect(withHints('Dies ist ein Gespräch in einem geschäftlichen Meeting. Khan, SAP.')).toBe(false);
    expect(withHints('Dies ist ein Gespräch in einem geschäftlichen Meeting. Khan')).toBe(false);
    expect(withHints('Dies ist ein Gespräch in einem geschäftlichen Meeting über SAP mit Herrn Khan.')).toBe(
      true,
    );
    expect(kept('2026', 'de')).toBe(true);
  });

  it('keeps a "Vielen Dank." unless the recognizer itself gives strong evidence of no speech', () => {
    expect(kept('Vielen Dank.', 'de', { noSpeechProb: 0.05, avgLogProb: -0.2 })).toBe(true);
    // Ordinary confidence values for a short clip are not evidence (they used to drop the reply).
    expect(kept('Vielen Dank.', 'de', { noSpeechProb: 0.45, avgLogProb: -0.3 })).toBe(true);
    expect(kept('Vielen Dank.', 'de', { noSpeechProb: 0.05, avgLogProb: -0.9 })).toBe(true);
    expect(kept('Vielen Dank.', 'de', { noSpeechProb: 0.7, avgLogProb: -0.3 })).toBe(false);
    expect(kept('Vielen Dank.', 'de', { noSpeechProb: 0.05, avgLogProb: -1.1 })).toBe(false);
    // A recognizer without confidence signals makes its own no-speech decision, so its
    // one-word answers are believed: "yes", "okay" and "thank you" are normal replies.
    for (const reply of ['شکریہ', 'جی', 'ٹھیک ہے۔', 'ہاں'])
      expect(kept(reply, 'ur', {}, 900), reply).toBe(true);
    expect(kept('Ja.', 'de', {}, 800)).toBe(true);
  });

  it('drops more text than the audio could hold', () => {
    const long = 'Dies ist ein ziemlich langer Satz, der niemals in eine einzige Sekunde passen würde.';
    expect(kept(long, 'de', {}, 1_000)).toBe(false);
    expect(kept(long, 'de', {}, 5_000)).toBe(true);
  });
});

describe('ConversationMemory', () => {
  it('keeps the most recent turns within its bounds, oldest first', () => {
    const memory = new ConversationMemory(4, 20);
    for (let i = 1; i <= 6; i++)
      memory.add({ speaker: i % 2 ? 'me' : 'them', lang: 'de', text: `Satz ${i}` });
    memory.add({ speaker: 'me', lang: 'de', text: '   ' });
    expect(memory.size).toBe(4);
    expect(memory.recent().map((turn) => turn.text)).toEqual(['Satz 3', 'Satz 4', 'Satz 5', 'Satz 6']);
    expect(memory.recent(2).map((turn) => turn.text)).toEqual(['Satz 5', 'Satz 6']);
    expect(memory.recent(6, 13).map((turn) => turn.text)).toEqual(['Satz 5', 'Satz 6']);

    memory.add({ speaker: 'me', lang: 'de', text: 'x'.repeat(50) });
    expect(memory.recent(1)[0]?.text).toBe(`${'x'.repeat(20)}…`);

    memory.clear();
    expect(memory.recent()).toEqual([]);
  });
});
