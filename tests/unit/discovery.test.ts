import { describe, expect, it } from 'vitest';

import { countActiveFilters, summarizeFilters } from '../../src/lib/utils/discovery';
import type { ActiveFilters } from '../../src/lib/types';
import { toAdvancedFilters } from '../../src/lib/utils/filterScope';

const EMPTY_FILTERS: ActiveFilters = {
  openNow: false,
  closingSoon: false,
  openingSoon: false,
  maxWalkMinutes: null,
  priceMeal: 'dinner',
  priceTiers: [],
  categoryKeys: []
};

describe('countActiveFilters', () => {
  it('returns zero when no filters are applied', () => {
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
  });

  it('counts each active filter group once', () => {
    expect(
      countActiveFilters({
        openNow: true,
        closingSoon: false,
        openingSoon: true,
        maxWalkMinutes: 10,
        priceMeal: 'lunch',
        priceTiers: [2],
        categoryKeys: ['sushi', 'ramen']
      })
    ).toBe(5);
  });
});

describe('summarizeFilters', () => {
  it('uses a neutral label when nothing is applied', () => {
    expect(summarizeFilters(EMPTY_FILTERS)).toBe('All nearby');
  });

  it('builds a short readable summary for applied filters', () => {
    expect(
      summarizeFilters({
        openNow: true,
        closingSoon: false,
        openingSoon: true,
        maxWalkMinutes: 15,
        priceMeal: 'lunch',
        priceTiers: [1, 2],
        categoryKeys: ['sushi']
      })
    ).toBe('Open now, Opening soon, ≤15 min');
  });

  it('includes meal context when price tiers are active', () => {
    expect(
      summarizeFilters({
        openNow: false,
        closingSoon: false,
        openingSoon: false,
        maxWalkMinutes: null,
        priceMeal: 'lunch',
        priceTiers: [1, 4],
        categoryKeys: []
      })
    ).toBe('Lunch: 2 price levels');
  });
});

describe('toAdvancedFilters', () => {
  it('removes tray-only open state without mutating the original filters', () => {
    const filters: ActiveFilters = {
      openNow: true,
      closingSoon: true,
      openingSoon: true,
      maxWalkMinutes: 10,
      priceMeal: 'lunch',
      priceTiers: [2],
      categoryKeys: ['sushi']
    };

    expect(toAdvancedFilters(filters)).toEqual({
      openNow: false,
      closingSoon: true,
      openingSoon: true,
      maxWalkMinutes: 10,
      priceMeal: 'lunch',
      priceTiers: [2],
      categoryKeys: ['sushi']
    });
    expect(filters.openNow).toBe(true);
  });
});
