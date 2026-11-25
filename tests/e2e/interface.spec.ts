import { expect, test } from '@playwright/test';

/**
 * Behaviour of the interface that only a real browser can show: layout in the narrow
 * windows people use beside Teams, keyboard handling, and the demo states.
 */

test('they-say text is interpreted into Urdu, right to left', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();

  await page.getByRole('radio', { name: 'They say' }).check();
  await page.getByRole('textbox', { name: /Type in German/ }).fill('Guten Morgen, können Sie mich hören?');
  await page.getByRole('button', { name: 'Translate' }).click();

  const entry = page.locator('.entry').first();
  await expect(entry.locator('.entry__source')).toHaveAttribute('lang', 'de');
  await expect(entry.locator('.entry__target')).toHaveAttribute('lang', 'ur');
  await expect(entry.locator('.entry__target')).toHaveAttribute('dir', 'rtl');
  await expect(entry.locator('.badge')).toHaveText(/\d\.\d s/);
});

for (const size of [
  { width: 480, height: 640 },
  { width: 768, height: 700 },
  { width: 960, height: 800 },
]) {
  test(`in a ${size.width}×${size.height} window the conversation stays in view`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();

    const box = page.getByRole('textbox', { name: /Type in Urdu/ });
    for (let i = 0; i < 6; i++) {
      await box.fill(`یہ جملہ نمبر ${i + 1} ہے`);
      await page.getByRole('button', { name: 'Translate' }).click();
    }
    const newest = page.locator('.entry').last();
    await expect(page.locator('.entry')).toHaveCount(6);
    await expect(newest.locator('.entry__target')).not.toBeEmpty();

    // The page itself does not scroll; the newest sentence and the controls are on screen.
    // (Evaluated from text: this file is type-checked without the browser's own types.)
    const page_ = (await page.evaluate(
      '({ scrollHeight: document.documentElement.scrollHeight, scrollWidth: document.documentElement.scrollWidth, height: innerHeight, width: innerWidth })',
    )) as { scrollHeight: number; scrollWidth: number; height: number; width: number };
    expect(page_.scrollHeight).toBeLessThanOrEqual(page_.height + 1);
    expect(page_.scrollWidth).toBeLessThanOrEqual(page_.width + 1);
    await expect(newest).toBeInViewport();
    await expect(box).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Start microphone' })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Capture their audio' })).toBeInViewport();
  });
}

test('a very long word wraps instead of widening the page', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 640 });
  await page.goto('/');
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await page
    .getByRole('textbox', { name: /Type in Urdu/ })
    .fill(`https://example.com/${'sehr-langer-pfad-'.repeat(12)} Donaudampfschifffahrtsgesellschaftskapitän`);
  await page.getByRole('button', { name: 'Translate' }).click();
  await expect(page.locator('.entry .entry__source')).toBeVisible();
  expect(await page.evaluate('document.documentElement.scrollWidth')).toBeLessThanOrEqual(481);
});

test('holding Space talks in push-to-talk mode, also right after clicking a button', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();

  const mine = page.getByRole('region', { name: 'You speak' });
  await mine.getByText('Advanced').click();
  await mine.getByRole('radio', { name: 'Push-to-talk' }).check();
  await page.getByRole('button', { name: 'Start microphone' }).click();
  const stop = page.getByRole('button', { name: 'Stop microphone' });
  await expect(stop).toBeVisible({ timeout: 20_000 });

  // Focus is still on the button that was just clicked. Space must talk, not press it.
  await stop.focus();
  await page.keyboard.down('Space');
  await expect(mine.getByText('Listening…', { exact: true })).toBeVisible();
  await page.keyboard.up('Space');
  await expect(mine.getByText(/Hold Space to talk/)).toBeVisible();
  await expect(stop).toBeVisible();

  // In a text field Space is a space.
  const box = page.getByRole('textbox', { name: /Type in Urdu/ });
  await box.click();
  await page.keyboard.type('a b');
  await expect(box).toHaveValue('a b');
});

test('says so when translated speech cannot be played, and offers to resume', async ({ page }) => {
  await page.goto('/?demo=1&state=blocked');
  const banner = page.getByText('Translated speech cannot be played: the audio device stopped.');
  await expect(banner).toBeVisible();
  await page.getByRole('button', { name: 'Resume audio' }).click();
  await expect(banner).toBeHidden();
});
