import { describe, expect, it } from 'vitest';

import type { ActiveFilters } from '../../src/lib/types';
import { isQuickFilterActive, toggleQuickFilter } from '../../src/lib/utils/quickFilters';

const EMPTY_FILTERS: ActiveFilters = {
  openNow: false,
  closingSoon: false,
  maxWalkMinutes: null,
  priceBands: [],
  categoryKeys: []
};

describe('toggleQuickFilter', () => {
  it('toggles only the open now flag', () => {
    expect(toggleQuickFilter(EMPTY_FILTERS, 'openNow')).toEqual({
      ...EMPTY_FILTERS,
      openNow: true
    });
  });

  it('toggles the 10 minute walk preset on and off', () => {
    const active = toggleQuickFilter(EMPTY_FILTERS, 'walk10');
    expect(active.maxWalkMinutes).toBe(10);
    expect(toggleQuickFilter(active, 'walk10').maxWalkMinutes).toBeNull();
  });

  it('applies and removes the light price preset as an exact pair', () => {
    const active = toggleQuickFilter(EMPTY_FILTERS, 'priceLite');
    expect(active.priceBands).toEqual(['\u00A5', '\u00A5\u00A5']);
    expect(isQuickFilterActive(active, 'priceLite')).toBe(true);
    expect(toggleQuickFilter(active, 'priceLite').priceBands).toEqual([]);
  });

  it('preserves unrelated filters when a quick preset changes', () => {
    expect(
      toggleQuickFilter(
        {
          ...EMPTY_FILTERS,
          categoryKeys: ['ramen'],
          closingSoon: true
        },
        'priceLite'
      )
    ).toEqual({
      ...EMPTY_FILTERS,
      categoryKeys: ['ramen'],
      closingSoon: true,
      priceBands: ['\u00A5', '\u00A5\u00A5']
    });
  });

  it('clear all can reset filters back to empty after presets are used', () => {
    const withPresets = toggleQuickFilter(toggleQuickFilter(toggleQuickFilter(EMPTY_FILTERS, 'openNow'), 'walk10'), 'priceLite');
    expect({ ...EMPTY_FILTERS }).toEqual({
      openNow: false,
      closingSoon: false,
      maxWalkMinutes: null,
      priceBands: [],
      categoryKeys: []
    });
    expect(withPresets).toEqual({
      ...EMPTY_FILTERS,
      openNow: true,
      maxWalkMinutes: 10,
      priceBands: ['\u00A5', '\u00A5\u00A5']
    });
  });
});
