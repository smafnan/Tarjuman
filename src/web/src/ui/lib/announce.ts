import type { EntryStatus } from '../../state/types';

/**
 * Whether an entry's words are complete. The transcript is a live region, and a sentence
 * that is still being transcribed or translated would otherwise be read out half-finished,
 * then again every time a part arrives; until it is complete it stays out of the
 * accessibility tree and joins it, as one addition, when it is.
 */
export function isFinished(status: EntryStatus): boolean {
  return status !== 'transcribing' && status !== 'translating';
}
