import Lenis from 'lenis';
import { useEffect, useRef, type RefObject } from 'react';

import { gsap, prefersReducedMotion } from '../lib/motion';

/**
 * Inertia for one scrolling element, clocked by GSAP's ticker so it moves in step with every
 * other animation on the page. Only the wheel is smoothed: touch, keys and scrollbars keep
 * the browser's own scrolling, and with reduced motion nothing is smoothed at all.
 *
 * Returns the instance (null when the native scroller is used) for scrolling in code.
 */
export function useSmoothScroll(
  wrapper: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
): RefObject<Lenis | null> {
  const lenis = useRef<Lenis | null>(null);

  useEffect(() => {
    const scroller = wrapper.current;
    const inner = content.current;
    if (!scroller || !inner || prefersReducedMotion()) return;
    const instance = new Lenis({
      wrapper: scroller,
      content: inner,
      lerp: 0.13,
      smoothWheel: true,
      syncTouch: false,
      autoRaf: false,
    });
    const tick = (time: number) => instance.raf(time * 1000);
    gsap.ticker.add(tick);
    lenis.current = instance;
    return () => {
      gsap.ticker.remove(tick);
      instance.destroy();
      lenis.current = null;
    };
  }, [wrapper, content]);

  return lenis;
}
