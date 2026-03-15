import { expect, test } from '@playwright/test';

test('desktop flow renders filter and tray controls', async ({ page }) => {
  await page.goto('/');
  const distanceButton = page.locator('.segment-row').first().locator('button').nth(1);
  const tabelogButton = page.locator('.split-sort-pill .split-pill-tabelog').first();

  await expect(page.locator('.top-filter-row .filter-pill')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Filters/i }).first()).toBeVisible();
  await expect(page.getByText(/places in view/i)).toBeVisible();
  await expect(page.locator('article .preview img').first()).toBeVisible();

  await distanceButton.click();
  await expect(distanceButton).toHaveClass(/active/);
  await expect(distanceButton).toHaveAttribute('aria-label', /distance nearest first/i);

  await tabelogButton.click();
  await expect(tabelogButton).toHaveClass(/active/);
});

test('mobile flow uses a single top filters pill and updated tray controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const openNowButton = page.locator('.segment-row-mobile > button').first();
  const distanceButton = page.locator('.segment-row-mobile > button').nth(1);
  const googleButton = page.locator('.split-sort-pill-mobile .split-pill-google');

  await expect(page.getByLabel('Use my location')).toBeVisible();
  await expect(page.locator('.top-filter-row .filter-pill')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Filters/i })).toBeVisible();
  await expect(openNowButton).toBeVisible();
  await expect(distanceButton).toBeVisible();
  await expect(googleButton).toBeVisible();

  await expect.poll(() => new URL(page.url()).searchParams.get('place')).not.toBeNull();

  const firstCardName = await page.locator('article h3').first().innerText();
  await page.locator('article').first().locator('.card-main-button').dispatchEvent('click');
  await expect.poll(() => new URL(page.url()).searchParams.get('panel')).toBe('detail');
  await expect(page.getByRole('button', { name: /close details/i })).toBeVisible();

  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.get('panel')).toBeNull();
  await expect(page.locator('article h3').first()).toHaveText(firstCardName);

  await page.getByRole('button', { name: /^Filters/i }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('panel')).toBe('filters');
  await expect(page.getByText(/availability/i)).toBeVisible();
  await page.getByRole('button', { name: 'Closing soon' }).dispatchEvent('click');
  await page.getByRole('button', { name: 'Done' }).dispatchEvent('click');

  await expect.poll(() => new URL(page.url()).searchParams.get('panel')).toBeNull();
  await expect(page.locator('.filter-count-badge')).toHaveText('1');
  await expect(page.locator('.sheet-summary').first()).toContainText('Closing soon');
});
