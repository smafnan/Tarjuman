import { describe, expect, it } from 'vitest';

import { shiftIntoViewport } from './geometry';

describe('shiftIntoViewport', () => {
  it('leaves a box that already fits', () => {
    expect(shiftIntoViewport(100, 460, 480, 8)).toBe(0);
  });

  it('moves a box that runs off the left edge', () => {
    expect(shiftIntoViewport(-92, 268, 480, 8)).toBe(100);
  });

  it('moves a box that runs off the right edge', () => {
    expect(shiftIntoViewport(200, 560, 480, 8)).toBe(-88);
  });

  it('aligns a box wider than the window to the left edge', () => {
    expect(shiftIntoViewport(30, 400, 300, 8)).toBe(-22);
  });
});
