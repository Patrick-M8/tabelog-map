import { expect, test } from '@playwright/test';

test('desktop flow renders filters and price sorting controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  await expect(page.getByText(/places in view/i)).toBeVisible();
  await expect(page.locator('article .preview img').first()).toBeVisible();
  await page.getByRole('button', { name: /price ascending/i }).click();
  await expect(page.getByRole('button', { name: /price ascending/i })).toHaveClass(/active/);
});

test('mobile flow opens walk-time menu and keeps controls visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('article .preview img').first()).toBeVisible();
  await page.getByRole('button', { name: /walk time filter/i }).click();
  await expect(page.getByRole('button', { name: /walk within 5 minutes/i })).toBeVisible();
  await page.getByRole('button', { name: /walk within 15 minutes/i }).click();
  await expect(page.locator('.chip-row button').nth(1)).toContainText('15 min walk');
  await expect(page.getByLabel('Use my location')).toBeVisible();
});
