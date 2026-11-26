import { useLayoutEffect, useRef, type RefObject } from 'react';

import { gsap, prefersReducedMotion, SplitText } from '../lib/motion';
import { splitLatinRuns } from '../lib/scripts';

interface RevealLinesProps {
  text: string;
  /** Read when the text appears: false while the page is first being filled, so that only
      text arriving after that rises in. */
  armed: RefObject<boolean>;
  /** Arabic-script text: Latin words inside it are set apart, as LangText does, and its lines
      travel further, because their masks are opened for Nastaliq (layout.css). */
  mixed?: boolean;
}

/**
 * Text that rises into place line by line the first time it appears, each line behind its own
 * mask: a new translation catches the eye where it lands without pulling it across the page.
 *
 * The text is written into the element here rather than rendered by React, because the split
 * replaces the element's children and React must never reconcile them. After the rise the
 * split is undone, so the text reflows like any other paragraph.
 */
export function RevealLines({ text, armed, mixed = false }: RevealLinesProps) {
  const ref = useRef<HTMLSpanElement>(null);
  // Decided once per text: React's development checks run this effect a second time on mount,
  // after the transcript has armed itself, and that run must not change the answer.
  const decision = useRef<{ text: string; rise: boolean } | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (decision.current?.text !== text) decision.current = { text, rise: armed.current };
    if (mixed) {
      element.replaceChildren(
        ...splitLatinRuns(text).map((run) => {
          if (!run.latin) return document.createTextNode(run.text);
          const latin = document.createElement('span');
          latin.className = 'latin';
          latin.dir = 'ltr';
          latin.textContent = run.text;
          return latin;
        }),
      );
    } else {
      element.textContent = text;
    }
    if (!decision.current.rise || prefersReducedMotion()) return;
    const split = SplitText.create(element, {
      type: 'lines',
      mask: 'lines',
      tag: 'span',
      linesClass: 'reveal-line',
    });
    const rise = gsap.from(split.lines, {
      yPercent: mixed ? 160 : 105,
      duration: 1.15,
      ease: 'expo.out',
      // However many lines there are, the last one starts within a third of a second.
      stagger: Math.min(0.1, 0.32 / Math.max(1, split.lines.length - 1)),
      onComplete: () => split.revert(),
    });
    return () => {
      rise.kill();
      split.revert();
    };
  }, [text, armed, mixed]);

  return <span ref={ref} className="reveal" />;
}
