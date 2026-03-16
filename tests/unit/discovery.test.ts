import { describe, expect, it } from 'vitest';

import { countActiveFilters, summarizeFilters } from '../../src/lib/utils/discovery';
import type { ActiveFilters } from '../../src/lib/types';
import { toAdvancedFilters } from '../../src/lib/utils/filterScope';

const EMPTY_FILTERS: ActiveFilters = {
  openNow: false,
  closingSoon: false,
  hidePermanentlyClosed: false,
  maxWalkMinutes: null,
  priceBands: [],
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
        hidePermanentlyClosed: true,
        maxWalkMinutes: 10,
        priceBands: ['¥¥'],
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
        hidePermanentlyClosed: true,
        maxWalkMinutes: 15,
        priceBands: ['¥', '¥¥'],
        categoryKeys: ['sushi']
      })
    ).toBe('Open now, Hide closed, ≤15 min');
  });
});

describe('toAdvancedFilters', () => {
  it('removes tray-only open state without mutating the original filters', () => {
    const filters: ActiveFilters = {
      openNow: true,
      closingSoon: true,
      hidePermanentlyClosed: true,
      maxWalkMinutes: 10,
      priceBands: ['¥¥'],
      categoryKeys: ['sushi']
    };

    expect(toAdvancedFilters(filters)).toEqual({
      openNow: false,
      closingSoon: true,
      hidePermanentlyClosed: true,
      maxWalkMinutes: 10,
      priceBands: ['¥¥'],
      categoryKeys: ['sushi']
    });
    expect(filters.openNow).toBe(true);
  });
});
