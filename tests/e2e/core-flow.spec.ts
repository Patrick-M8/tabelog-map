import { expect, test } from '@playwright/test';

test('desktop flow renders filters and price sorting controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /cuisine/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /walk time/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /price/i }).first()).toBeVisible();
  await expect(page.getByText(/places in view/i)).toBeVisible();
  await expect(page.locator('article .preview img').first()).toBeVisible();
  await page.getByRole('button', { name: /price ascending/i }).click();
  await expect(page.getByRole('button', { name: /price ascending/i })).toHaveClass(/active/);
});

test('mobile flow opens sheet filters and selected place details', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByLabel('Use my location')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open now' })).toBeVisible();
  await expect(page.getByRole('button', { name: '≤ 10 min' })).toBeVisible();
  await expect(page.getByRole('button', { name: '¥¥ and under' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Filters/i })).toBeVisible();

  await page.getByRole('button', { name: 'Open now' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('panel')).toBeNull();
  await expect(page.getByRole('button', { name: 'Open now' })).toHaveClass(/active/);
  await expect(page.locator('.sheet-summary').first()).toContainText('Open now');

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
  await expect(page.locator('.filter-count-badge')).toHaveText('2');
  await expect(page.locator('.sheet-summary').first()).toContainText('Closing soon');

  await page.locator('article').first().locator('.card-main-button').dispatchEvent('click');
  await expect.poll(() => new URL(page.url()).searchParams.get('panel')).toBe('detail');
  await page.getByRole('button', { name: /close details/i }).dispatchEvent('click');
  await expect.poll(() => new URL(page.url()).searchParams.get('panel')).toBeNull();
});
