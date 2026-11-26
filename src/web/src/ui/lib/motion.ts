/**
 * GSAP, registered once for the whole interface. Motion here only ever shows what the store
 * already says: nothing in this module may delay or gate audio, the network or the
 * transcript itself.
 */
import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(SplitText);

export { gsap, SplitText };

export function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
