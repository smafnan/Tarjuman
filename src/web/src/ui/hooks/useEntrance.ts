import { useLayoutEffect, type RefObject } from 'react';

import { gsap, prefersReducedMotion } from '../lib/motion';

/**
 * The page's arrival, once, when it opens. Everything fades in where it stands (the two keys
 * first and at once); the one movement is the titles coming into focus out of the dark. The
 * surface between the titles (VoiceField) and the conversation's sentences time their own
 * arrival to this. Afterwards every property is handed back to the stylesheet.
 */
export function useEntrance(root: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || prefersReducedMotion()) return;
    const context = gsap.context(() => {
      const arrive = gsap.timeline({ defaults: { ease: 'expo.out', duration: 1.6, clearProps: 'all' } });
      arrive
        .from('.topbar > *', { autoAlpha: 0, stagger: 0.08 }, 0.1)
        // The keys first and at once: starting a channel must never wait for the rest.
        .from('.module__keys > *', { autoAlpha: 0, duration: 0.9, stagger: 0.05 }, 0.05)
        .from(
          '.module__title',
          { autoAlpha: 0, y: 30, filter: 'blur(10px)', duration: 2.2, stagger: 0.2 },
          0.3,
        )
        .from('.module__meta, .telemetry', { autoAlpha: 0, duration: 1.4, stagger: 0.12 }, 1)
        .from('.module__signal', { autoAlpha: 0, stagger: 0.07 }, 1.15)
        // The conversation arrives as one sheet; its sentences follow on their own delays.
        .from('.reading', { autoAlpha: 0, duration: 1.6 }, 1)
        .from('.composer', { autoAlpha: 0 }, 1.5);
    }, element);
    return () => context.revert();
  }, [root]);
}
