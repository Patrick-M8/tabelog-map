import { describe, expect, it } from 'vitest';

import { countActiveFilters, summarizeFilters } from '../../src/lib/utils/discovery';
import type { ActiveFilters } from '../../src/lib/types';

const EMPTY_FILTERS: ActiveFilters = {
  openNow: false,
  closingSoon: false,
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
        maxWalkMinutes: 10,
        priceBands: ['\u00A5\u00A5'],
        categoryKeys: ['sushi', 'ramen']
      })
    ).toBe(4);
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
        maxWalkMinutes: 15,
        priceBands: ['\u00A5', '\u00A5\u00A5'],
        categoryKeys: ['sushi']
      })
    ).toBe('Open now, \u226415 min, 2 price levels');
  });
});
