import { expect, test } from '@playwright/test';

test('desktop flow renders filter and tray controls', async ({ page }) => {
  await page.goto('/');
  const tray = page.locator('.tray-toolbar').first();
  const sortButton = tray.locator('.toolbar-pill').nth(1);
  const reviewsButton = tray.locator('.toolbar-pill').nth(2);

  await expect(page.locator('.top-filter-row .filter-pill')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Filters/i }).first()).toBeVisible();
  await expect(page.getByText(/places in view/i)).toBeVisible();
  await expect(page.locator('article .preview img').first()).toBeVisible();
  await expect(sortButton).toContainText('Best');
  await expect(reviewsButton).toContainText('Reviews');

  await sortButton.click();
  await tray.locator('.tray-menu-sort').getByRole('button', { name: 'Distance ↑' }).click();
  await expect(sortButton).toContainText('Distance ↑');
  await expect(sortButton).toHaveClass(/active/);

  await reviewsButton.click();
  await tray.locator('.tray-menu-reviews').getByRole('button', { name: 'Tabelog ★' }).click();
  await expect(reviewsButton).toContainText('Tabelog ★');
  await expect(reviewsButton).toHaveClass(/active/);
});

test('mobile flow uses a single top filters pill and updated tray controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const tray = page.locator('.tray-toolbar').first();
  const openButton = tray.locator('.toolbar-pill').nth(0);
  const sortButton = tray.locator('.toolbar-pill').nth(1);
  const reviewsButton = tray.locator('.toolbar-pill').nth(2);

  await expect(page.getByLabel('Use my location')).toBeVisible();
  await expect(page.locator('.top-filter-row .filter-pill')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Filters/i })).toBeVisible();
  await expect(openButton).toBeVisible();
  await expect(sortButton).toContainText('Best');
  await expect(reviewsButton).toContainText('Reviews');

  const yPositions = await Promise.all([openButton, sortButton, reviewsButton].map(async (button) => (await button.boundingBox())?.y));
  expect(yPositions.every((value) => value !== undefined)).toBe(true);
  expect(Math.max(...(yPositions as number[])) - Math.min(...(yPositions as number[]))).toBeLessThan(2);

  const firstCardName = await page.locator('article h3').first().innerText();
  await page.locator('article').first().locator('.card-main-button').dispatchEvent('click');
  await expect.poll(() => new URL(page.url()).searchParams.get('panel')).toBe('detail');
  await expect(page.getByRole('button', { name: /close details/i })).toBeVisible();

  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.get('panel')).toBeNull();
  await expect(page.locator('article h3').first()).toHaveText(firstCardName);

  await sortButton.click();
  await tray.locator('.tray-menu-sort').getByRole('button', { name: 'Price ↑' }).click();
  await expect(sortButton).toContainText('Price ↑');

  await reviewsButton.click();
  await tray.locator('.tray-menu-reviews').getByRole('button', { name: 'Google ★' }).click();
  await expect(reviewsButton).toContainText('Google ★');

  await page.getByRole('button', { name: /^Filters/i }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('panel')).toBe('filters');
  await expect(page.getByText(/availability/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open now' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Closing soon' }).dispatchEvent('click');
  await page.getByRole('button', { name: 'Done' }).dispatchEvent('click');

  await expect.poll(() => new URL(page.url()).searchParams.get('panel')).toBeNull();
  await expect(page.locator('.filter-count-badge')).toHaveText('1');
  await expect(page.locator('.sheet-summary').first()).toContainText('Closing soon');
});
