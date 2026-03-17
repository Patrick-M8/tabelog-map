import { expect, test } from '@playwright/test';

test('desktop flow keeps a single filter launcher and defaults to tabelog-desc review sort', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByLabel('Use my location')).toBeVisible();
  await expect(page.locator('.top-filter-row .filter-pill')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Filters/i })).toHaveCount(1);

  const tabelogButton = page.getByRole('button', { name: 'Sort by Tabelog rating' }).first();
  const directionButton = page.getByRole('button', { name: /Review order descending/i }).first();

  await expect(tabelogButton).toHaveAttribute('aria-pressed', 'true');
  await expect(directionButton).toContainText('↓');

  await page.getByRole('button', { name: /^Filters/i }).click();
  await expect(page.getByText(/availability/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Opening soon' })).toBeVisible();
});

test('mobile flow uses emoji override pills and the shared filter sheet content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const tray = page.locator('.tray-toolbar').first();
  const openButton = tray.locator('.toolbar-pill').nth(0);
  const distanceButton = tray.locator('.toolbar-pill').nth(1);
  const priceButton = tray.locator('.toolbar-pill').nth(2);

  await expect(page.locator('.top-filter-row .filter-pill')).toHaveCount(1);
  await expect(distanceButton).toContainText('📍');
  await expect(priceButton).toContainText('¥');

  const yPositions = await Promise.all([openButton, distanceButton, priceButton].map(async (button) => (await button.boundingBox())?.y));
  expect(yPositions.every((value) => value !== undefined)).toBe(true);
  expect(Math.max(...(yPositions as number[])) - Math.min(...(yPositions as number[]))).toBeLessThan(2);

  await distanceButton.click();
  await expect(distanceButton).toContainText('↑');
  await distanceButton.click();
  await expect(distanceButton).toContainText('↓');

  const googleButton = page.getByRole('button', { name: 'Sort by Google rating' }).first();
  await googleButton.click();
  await expect(googleButton).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /^Filters/i }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('panel')).toBe('filters');
  await expect(page.getByRole('button', { name: 'Opening soon' })).toBeVisible();
  await expect(page.locator('.filter-footer-sticky')).toBeVisible();
  await page.getByRole('button', { name: 'Opening soon' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  await expect.poll(() => new URL(page.url()).searchParams.get('panel')).toBeNull();
  await expect(page.locator('.filter-count-badge')).toHaveText('1');
  await expect(page.locator('.sheet-summary').first()).toContainText('Opening soon');
});
