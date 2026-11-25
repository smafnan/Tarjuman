import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** Reads the light-dark() design tokens from base.css and checks the WCAG 2.1 AA ratios. */
const css = readFileSync(join(__dirname, 'base.css'), 'utf8');

function token(name: string, side: 0 | 1): string {
  const match = new RegExp(`--${name}:\\s*light-dark\\((#[0-9a-f]{6}),\\s*(#[0-9a-f]{6})\\)`, 'i').exec(css);
  if (!match) throw new Error(`token --${name} not found`);
  return match[side + 1] as string;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe.each([
  ['light', 0],
  ['dark', 1],
] as const)('contrast, %s theme', (_name, side) => {
  const t = (name: string) => token(name, side);

  it('keeps faint text readable on every surface it is used on', () => {
    for (const surface of ['bg', 'surface', 'surface-2']) {
      expect(ratio(t('text-faint'), t(surface)), surface).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws control edges, including the off switch, at 3:1 on the surfaces', () => {
    for (const surface of ['bg', 'surface', 'surface-2']) {
      expect(ratio(t('control-border'), t(surface)), surface).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps badge text readable', () => {
    for (const tone of ['ok', 'warn', 'danger', 'accent']) {
      expect(ratio(t(tone), t(`${tone}-soft`)), tone).toBeGreaterThanOrEqual(4.5);
    }
  });
});
