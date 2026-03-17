import { expect, test } from '@playwright/test';

function extractPlaceCount(label: string) {
  const match = label.match(/Show (\d+) places/);
  if (!match) {
    throw new Error(`Could not parse place count from "${label}"`);
  }

  return Number.parseInt(match[1], 10);
}

test('desktop flow auto-updates the tray and supports combined rating sorting', async ({ page }) => {
  await page.goto('/');
  const desktopPanel = page.locator('.side-panel');
  await page.getByRole('button', { name: /^Filters/i }).click();
  await expect(page.getByRole('heading', { name: 'Cuisine', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Walk time', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Price', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close filters' }).nth(1).click();
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
  await expect(page.getByRole('button', { name: /^Filters/i })).toContainText('1');
  await expect(page.locator('.sheet-summary').first()).toContainText('Opening soon');
});

test('mobile price filters default to dinner and switch to lunch tiers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.getByRole('button', { name: /^Filters/i }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('panel')).toBe('filters');

  const dinnerButton = page.getByRole('button', { name: 'Dinner' });
  const lunchButton = page.getByRole('button', { name: 'Lunch' });
  const premiumTier = page.getByRole('button', { name: '¥10,000+' });
  const showPlacesButton = page.getByRole('button', { name: /^Show \d+ places$/ });

  await expect(dinnerButton).toHaveAttribute('aria-pressed', 'true');
  await expect(lunchButton).toHaveAttribute('aria-pressed', 'false');

  await premiumTier.click();
  await expect(page.locator('.sheet-summary').first()).toContainText('Dinner: 1 price level');
  const dinnerCount = extractPlaceCount(await showPlacesButton.innerText());

  await lunchButton.click();
  await expect(dinnerButton).toHaveAttribute('aria-pressed', 'false');
  await expect(lunchButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sheet-summary').first()).toContainText('Lunch: 1 price level');
  const lunchCount = extractPlaceCount(await showPlacesButton.innerText());

  expect(lunchCount).not.toBe(dinnerCount);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('panel')).toBeNull();
  await expect(page.getByRole('button', { name: /^Filters/i })).toContainText('1');
  await expect(page.locator('.sheet-summary').first()).toContainText('Lunch: 1 price level');
});
