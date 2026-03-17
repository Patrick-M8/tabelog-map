import { describe, expect, it } from 'vitest';

import { formatPriceTierLabel, getPriceTierForMeal, matchesPriceFilter, PRICE_TIER_OPTIONS } from '../../src/lib/utils/priceTier';

describe('price tiers', () => {
  it('exposes the five configured filter tiers in order', () => {
    expect(PRICE_TIER_OPTIONS).toEqual([1, 2, 3, 4, 5]);
  });

  it('formats explicit labels for each tier', () => {
    expect(formatPriceTierLabel(1)).toBe('Up to ¥999');
    expect(formatPriceTierLabel(2)).toBe('¥1,000-¥1,999');
    expect(formatPriceTierLabel(3)).toBe('¥2,000-¥3,999');
    expect(formatPriceTierLabel(4)).toBe('¥4,000-¥9,999');
    expect(formatPriceTierLabel(5)).toBe('¥10,000+');
    expect(formatPriceTierLabel(0)).toBe('Price TBD');
  });

  it('selects the correct meal-specific tier', () => {
    const place = { priceTierDinner: 5, priceTierLunch: 2 };

    expect(getPriceTierForMeal(place, 'dinner')).toBe(5);
    expect(getPriceTierForMeal(place, 'lunch')).toBe(2);
  });

  it('matches on the selected meal tier and excludes missing meal prices', () => {
    const place = { priceTierDinner: 4, priceTierLunch: 0 };

    expect(matchesPriceFilter(place, 'dinner', [4])).toBe(true);
    expect(matchesPriceFilter(place, 'dinner', [5])).toBe(false);
    expect(matchesPriceFilter(place, 'lunch', [4])).toBe(false);
    expect(matchesPriceFilter(place, 'lunch', [])).toBe(true);
  });
});
