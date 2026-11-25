import { describe, expect, it } from 'vitest';

import { autoDismissMs } from './notices';

describe('autoDismissMs', () => {
  it('dismisses information and success quickly', () => {
    expect(autoDismissMs('info')).toBe(6_000);
    expect(autoDismissMs('success')).toBe(6_000);
  });

  it('gives a warning about ten seconds', () => {
    expect(autoDismissMs('warning')).toBe(10_000);
  });

  it('keeps an error until it is dismissed', () => {
    expect(autoDismissMs('error')).toBeNull();
  });
});
