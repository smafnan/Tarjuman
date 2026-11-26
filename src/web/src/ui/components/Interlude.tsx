import { useLayoutEffect, useRef, type CSSProperties } from 'react';

import { LANGUAGES, type LangCode } from '../../../../shared/languages';
import { cx } from '../lib/cx';
import { gsap, prefersReducedMotion, SplitText } from '../lib/motion';
import { LangText } from './LangText';

const MARK = 'ترجمان';
/** The mark is always set in Nastaliq: it is the name, not a caption, so it ignores the Urdu font setting. */
const MARK_FONT = 'Noto Nastaliq Urdu Variable';
/** The size the mark is drawn at inside its own coordinates; on the page it is scaled to its column. */
const MARK_SIZE = 100;
/** Room around the ink, in the same coordinates, for the outline's stroke. */
const MARK_MARGIN = 3;

/** Longer than any contour of the mark. */
const UNDASHED = 4096;

/** The mark as drawn: the box of its ink and the longest stroke of its outline, in its own coordinates. */
interface MarkMetrics {
  box: { x: number; y: number; width: number; height: number };
  stroke: number;
}

/**
 * Measured on a canvas once the Nastaliq face is in. The box SVG reports for text is the line
 * of the font, which in Nastaliq is far taller than what is drawn; a canvas reports the ink.
 *
 * The longest stroke is found by drawing: an outline dashed with one dash and a long gap is
 * complete as soon as the dash covers its longest contour. Drawn with a dash exactly that
 * long, the pen takes the whole of the time it is given instead of finishing early.
 */
function measureMark(): MarkMetrics | null {
  const canvas = document.createElement('canvas');
  const pen = canvas.getContext('2d', { willReadFrequently: true });
  if (!pen) return null;
  const font = `${MARK_SIZE}px "${MARK_FONT}"`;
  pen.font = font;
  const ink = pen.measureText(MARK);
  const left = Math.ceil(ink.actualBoundingBoxLeft) + MARK_MARGIN;
  const top = Math.ceil(ink.actualBoundingBoxAscent) + MARK_MARGIN;
  canvas.width = left + Math.ceil(ink.actualBoundingBoxRight) + MARK_MARGIN;
  canvas.height = top + Math.ceil(ink.actualBoundingBoxDescent) + MARK_MARGIN;
  // Sizing a canvas resets what was set on it.
  pen.font = font;
  const drawn = (dash: number): number => {
    pen.clearRect(0, 0, canvas.width, canvas.height);
    pen.setLineDash([dash, UNDASHED]);
    pen.strokeText(MARK, left, top);
    const pixels = pen.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 3; index < pixels.length; index += 4) if ((pixels[index] ?? 0) > 0) count += 1;
    return count;
  };
  const whole = drawn(UNDASHED);
  let short = 0;
  let long = 1024;
  while (long - short > 4) {
    const middle = (short + long) / 2;
    if (drawn(middle) >= whole) long = middle;
    else short = middle;
  }
  return {
    box: { x: -left, y: -top, width: canvas.width, height: canvas.height },
    // A canvas that does not dash text reports a dash of nothing: then draw with one long
    // enough for any contour, as an undashed outline would be.
    stroke: long > 16 ? long : UNDASHED,
  };
}

interface InterludeProps {
  /** The conversation's columns, left to right, as the transcript will set them. */
  langs: readonly LangCode[];
  /** Whether the languages will sit side by side; otherwise everything stacks. */
  parallel: boolean;
  /** The first sentence has arrived: step out of the way, then call `onLeft`. */
  leaving: boolean;
  onLeft: () => void;
  onOpenGuide: () => void;
}

/** Grid column of each part when the languages sit side by side (column 1 is the gutter). */
function placement(langs: readonly LangCode[]) {
  const column = (lang: LangCode | undefined) => (lang ? langs.indexOf(lang) + 2 : undefined);
  const urdu = langs.includes('ur') ? 'ur' : langs[langs.length - 1];
  const latin = langs.find((lang) => LANGUAGES[lang].script === 'Latn' && lang !== urdu) ?? langs[0];
  const middle = langs.find((lang) => lang !== urdu && lang !== latin);
  return {
    urdu: column(urdu) ?? 2,
    latin: column(latin) ?? 2,
    copy: column(middle),
  };
}

/**
 * The conversation before anything has been said, set as the title page of the same ledger.
 * Its columns are drafted in as hairlines, the name is written in Nastaliq in the Urdu column
 * and set in Latin in the first Latin column, and the three steps to begin stand side by
 * side on those columns (where and how: layout.css). When the first sentence appears, the
 * drawing steps back and leaves the rules it drew to the conversation.
 */
export function Interlude({ langs, parallel, leaving, onLeft, onOpenGuide }: InterludeProps) {
  const root = useRef<HTMLDivElement>(null);
  const place = placement(langs);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let cancelled = false;

    // The drawing is fitted to the ink of the glyphs once the Nastaliq face is in, so the
    // mark sits on its column like set type. Returns the length of the outline's longest
    // stroke as it is on the page (the stroke does not scale with the drawing, so neither do
    // its dashes).
    const fit = (): number => {
      const mark = measureMark();
      if (!mark) return UNDASHED;
      const { x, y, width, height } = mark.box;
      const drawings = element.querySelectorAll<SVGSVGElement>('.interlude__ur svg');
      for (const svg of drawings) svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
      const shown = drawings[0]?.getBoundingClientRect().height ?? height;
      return Math.ceil((mark.stroke * shown) / height) + 2;
    };
    const loaded = document.fonts.load(`${MARK_SIZE}px "${MARK_FONT}"`, MARK);

    // Without motion the page is drawn at once and only fitted when the face arrives.
    if (prefersReducedMotion()) {
      element.removeAttribute('data-drafting');
      const settle = () => {
        if (!cancelled) fit();
      };
      loaded.then(settle, settle);
      return () => {
        cancelled = true;
      };
    }

    const context = gsap.context(() => undefined, element);
    const draft = () => {
      if (cancelled) return;
      const stroke = fit();
      element.removeAttribute('data-drafting');
      context.add(() => {
        const timeline = gsap.timeline({ defaults: { ease: 'expo.out' } });
        // Unhurried: the page behind it is still arriving (useEntrance) while this is drawn.
        timeline
          .from(
            '.interlude__rule',
            { scaleY: 0, transformOrigin: '50% 0%', duration: 2.2, stagger: 0.12 },
            0.6,
          )
          .from('.interlude__head', { autoAlpha: 0, y: -6, duration: 1.4, stagger: 0.1 }, 1)
          // Drafted at full strength; it rests faint behind the ink once that is down.
          .set('.interlude__ur-outline', { autoAlpha: 1 }, 0)
          // Every stroke of the outline is drawn at once, each from its own start; the dashes
          // go when it is done, so that a larger window later cannot open gaps in it.
          .fromTo(
            '.interlude__ur-outline text',
            { strokeDasharray: stroke, strokeDashoffset: stroke },
            {
              strokeDashoffset: 0,
              duration: 2.8,
              ease: 'power1.inOut',
              clearProps: 'strokeDasharray,strokeDashoffset',
            },
            1,
          )
          .fromTo(
            '.interlude__ur-ink',
            { '--wipe': 0 },
            { '--wipe': 1, duration: 1.8, ease: 'power2.inOut' },
            3.1,
          )
          .to('.interlude__ur-outline', { autoAlpha: 0.3, duration: 1.2, ease: 'power2.out' }, 4.4)
          // The Latin name is there first as a narrow heavy block, then opens out, evenly,
          // into wide light capitals.
          .fromTo(
            '.interlude__latin',
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: 0.6, ease: 'power1.out' },
            0.8,
          )
          .fromTo(
            '.interlude__latin',
            { '--wdth': 25, '--wght': 900 },
            { '--wdth': 151, '--wght': 250, duration: 2.4, ease: 'power2.inOut' },
            1.1,
          );
        const lines = SplitText.create(element.querySelectorAll('.interlude__line'), {
          type: 'lines',
          mask: 'lines',
          tag: 'span',
          linesClass: 'reveal-line',
        });
        timeline
          .from(lines.lines, { yPercent: 105, duration: 1.4, stagger: 0.09 }, 2)
          // The step numbers and the button are not text lines; they arrive with their steps.
          .from(
            ['.interlude__steps li', '.interlude__more .button'],
            { autoAlpha: 0, duration: 1.2, stagger: 0.1 },
            2.2,
          )
          .call(() => lines.revert());
      });
    };

    loaded.then(draft, draft);
    return () => {
      cancelled = true;
      context.revert();
    };
  }, []);

  useLayoutEffect(() => {
    if (!leaving) return;
    const element = root.current;
    if (!element || prefersReducedMotion()) {
      onLeft();
      return;
    }
    // Quickly, and fading first: the first sentence waits for it (layout.css), and must not
    // be set over what is still here.
    const exit = gsap
      .timeline({ onComplete: onLeft })
      .to(element, { autoAlpha: 0, duration: 0.3, ease: 'power2.out' }, 0)
      .to(element, { y: -12, duration: 0.3, ease: 'power1.in' }, 0);
    return () => {
      exit.kill();
    };
  }, [leaving, onLeft]);

  return (
    <div
      ref={root}
      className={cx('interlude', parallel && 'is-parallel', leaving && 'is-leaving')}
      data-drafting=""
      style={
        {
          '--cols': langs.length,
          '--latin-at': place.latin,
          '--urdu-at': place.urdu,
          '--gloss-at': place.copy ?? place.latin,
        } as CSSProperties
      }
    >
      <div className="interlude__rules" aria-hidden="true">
        {langs.map((lang, index) => (
          <span key={lang} className="interlude__rule" style={{ '--at': index + 2 } as CSSProperties} />
        ))}
      </div>

      {parallel ? (
        <div className="interlude__heads" aria-hidden="true">
          {langs.map((lang) => (
            <span
              key={lang}
              className="interlude__head"
              style={{ '--at': langs.indexOf(lang) + 2 } as CSSProperties}
            >
              <span className="interlude__code">{LANGUAGES[lang].code}</span>
              <LangText lang={lang}>{LANGUAGES[lang].nativeName}</LangText>
            </span>
          ))}
        </div>
      ) : null}

      <div className="interlude__stage">
        <div className="interlude__ur" aria-hidden="true">
          <svg className="interlude__ur-outline" viewBox="0 -90 260 130">
            <text x="0" y="0" fontFamily={MARK_FONT} fontSize={MARK_SIZE}>
              {MARK}
            </text>
          </svg>
          <svg className="interlude__ur-ink" viewBox="0 -90 260 130">
            <text x="0" y="0" fontFamily={MARK_FONT} fontSize={MARK_SIZE}>
              {MARK}
            </text>
          </svg>
        </div>

        <p className="interlude__latin" aria-hidden="true">
          Tarjuman
        </p>

        <div className={cx('interlude__copy', place.copy === undefined && 'is-under')}>
          <p className="interlude__gloss interlude__line">
            <span lang="ur-Latn">tarjumān</span>, Urdu: one who carries speech from one language into another.
          </p>
          <h2 className="interlude__title interlude__line">Nothing has been said yet</h2>
          <ol className="interlude__steps">
            <li>
              <span className="interlude__line">
                Add a free API key under <strong>Settings</strong> so Tarjuman can understand speech.
              </span>
            </li>
            <li>
              <span className="interlude__line">
                Press <strong>Start microphone</strong> and speak. Pause briefly between sentences.
              </span>
            </li>
            <li>
              <span className="interlude__line">
                Press <strong>Capture their audio</strong> to hear the other side in your language.
              </span>
            </li>
          </ol>
          <div className="interlude__foot">
            <p className="interlude__more">
              <span className="interlude__line">To use it in a Teams call, follow the</span>
              <button type="button" className="button button--small" onClick={onOpenGuide}>
                setup guide
              </button>
            </p>
            <p className="interlude__aside interlude__line">You can also type below instead of speaking.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
