import { expect, test } from '@playwright/test';

test('core flow renders list and opens detail', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  await expect(page.getByText(/places in view/i)).toBeVisible();
  await page.getByRole('button', { name: /view details/i }).click();
  await expect(page.getByText(/score explainer/i)).toBeVisible();
});
