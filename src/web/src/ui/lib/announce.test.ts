import { describe, expect, it } from 'vitest';

import type { EntryStatus } from '../../state/types';
import { isFinished } from './announce';

describe('isFinished', () => {
  it('holds back entries that are still being transcribed or translated', () => {
    expect(isFinished('transcribing')).toBe(false);
    expect(isFinished('translating')).toBe(false);
  });

  it('announces every other state', () => {
    const settled: EntryStatus[] = ['speaking', 'done', 'dropped', 'error'];
    for (const status of settled) expect(isFinished(status)).toBe(true);
  });
});
