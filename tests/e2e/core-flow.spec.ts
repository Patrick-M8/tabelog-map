import { expect, test } from '@playwright/test';

test('desktop flow auto-updates the tray and supports combined rating sorting', async ({ page }) => {
  await page.goto('/');
  const desktopPanel = page.locator('.side-panel');
  await expect(page.getByRole('button', { name: /cuisine/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /walk time/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /price/i }).first()).toBeVisible();
  await expect(page.getByText(/places in view/i)).toBeVisible();
  await expect(page.locator('article .preview img').first()).toBeVisible();
  await expect(desktopPanel.getByRole('heading', { name: 'Tabelog Hyakumeiten' })).toBeVisible();
  await desktopPanel.getByRole('button', { name: /price ascending/i }).click();
  await expect(desktopPanel.getByRole('button', { name: /price ascending/i })).toHaveClass(/active/);
  await desktopPanel.getByRole('button', { name: 'Sort by Tabelog rating' }).press('Enter');
  await desktopPanel.getByRole('button', { name: 'Sort by Google rating' }).press('Enter');
  await expect(desktopPanel.getByRole('button', { name: 'Sort by Tabelog rating' })).toHaveAttribute('aria-pressed', 'true');
  await expect(desktopPanel.getByRole('button', { name: 'Sort by Google rating' })).toHaveAttribute('aria-pressed', 'true');
  await desktopPanel.getByRole('button', { name: /combined average descending/i }).press('Enter');
  await expect(desktopPanel.getByRole('button', { name: /combined average ascending/i })).toHaveClass(/active/);
});

test('mobile flow uses emoji override pills and the shared filter sheet content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByLabel('Use my location')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tabelog Hyakumeiten' }).first()).toBeVisible();

  await expect.poll(() => new URL(page.url()).searchParams.get('place')).not.toBeNull();

  const firstCardName = await page.locator('article h3').first().innerText();
  await page.getByRole('button', { name: /view details for/i }).first().press('Enter');
  await expect.poll(() => new URL(page.url()).searchParams.get('panel')).toBe('detail');
  await expect(page.getByRole('button', { name: /close details/i })).toBeVisible();

  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.get('panel')).toBeNull();
  await expect(page.locator('article h3').first()).toHaveText(firstCardName);
  await expect(page.getByRole('button', { name: 'Sort by Tabelog rating' }).first()).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Sort by Tabelog rating' }).first().press('Enter');
  await expect(page.getByRole('button', { name: 'Sort by Tabelog rating' }).first()).toHaveAttribute('aria-pressed', 'true');

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
