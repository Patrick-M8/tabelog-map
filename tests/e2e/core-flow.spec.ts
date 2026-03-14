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
  await expect(page.locator('.selection-hero')).toBeVisible();
  await page.getByRole('button', { name: /walk time/i }).click();
  await expect(page.getByText(/availability/i)).toBeVisible();
  await page.getByRole('button', { name: /open now/i }).click();
  await page.getByRole('button', { name: /done/i }).click();
  await expect(page.getByText(/open now/i).first()).toBeVisible();
  await page.locator('.selection-hero').click();
  await expect(page.getByRole('button', { name: /directions/i })).toBeVisible();
});
