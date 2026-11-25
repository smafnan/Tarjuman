import { describe, expect, it } from 'vitest';

import { nextTab } from './tabs';

const TABS = ['keys', 'languages', 'audio', 'appearance'] as const;

describe('nextTab', () => {
  it('moves right and left', () => {
    expect(nextTab(TABS, 'keys', 'ArrowRight')).toBe('languages');
    expect(nextTab(TABS, 'audio', 'ArrowLeft')).toBe('languages');
  });

  it('wraps around at both ends', () => {
    expect(nextTab(TABS, 'appearance', 'ArrowRight')).toBe('keys');
    expect(nextTab(TABS, 'keys', 'ArrowLeft')).toBe('appearance');
  });

  it('jumps to the first and last tab', () => {
    expect(nextTab(TABS, 'audio', 'Home')).toBe('keys');
    expect(nextTab(TABS, 'audio', 'End')).toBe('appearance');
  });

  it('ignores other keys and an empty list', () => {
    expect(nextTab(TABS, 'keys', 'Enter')).toBeNull();
    expect(nextTab(TABS, 'keys', 'ArrowDown')).toBeNull();
    expect(nextTab([], 'keys', 'ArrowRight')).toBeNull();
  });
});
