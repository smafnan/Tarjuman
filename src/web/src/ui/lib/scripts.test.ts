import { describe, expect, it } from 'vitest';

import { splitLatinRuns } from './scripts';

describe('splitLatinRuns', () => {
  it('leaves text without Latin letters as one run', () => {
    expect(splitLatinRuns('جی بالکل۔')).toEqual([{ text: 'جی بالکل۔', latin: false }]);
  });

  it('sets a borrowed term apart, words and all', () => {
    expect(splitLatinRuns('ہم نے payment module کا کام مکمل کر لیا')).toEqual([
      { text: 'ہم نے ', latin: false },
      { text: 'payment module', latin: true },
      { text: ' کا کام مکمل کر لیا', latin: false },
    ]);
  });

  it('keeps digits and punctuation that are not part of a Latin word with the surrounding text', () => {
    expect(splitLatinRuns('پیر کو 10 بجے testing ہے۔')).toEqual([
      { text: 'پیر کو 10 بجے ', latin: false },
      { text: 'testing', latin: true },
      { text: ' ہے۔', latin: false },
    ]);
  });

  it('returns nothing for an empty string', () => {
    expect(splitLatinRuns('')).toEqual([]);
  });
});
