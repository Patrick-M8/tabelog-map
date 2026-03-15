import type { ActiveFilters } from '$lib/types';

export type QuickFilterKey = 'openNow' | 'walk10' | 'priceLite';

export const QUICK_PRICE_BANDS = ['\u00A5', '\u00A5\u00A5'] as const;

function hasExactBands(currentBands: string[], targetBands: readonly string[]) {
  if (currentBands.length !== targetBands.length) {
    return false;
  }

  const current = new Set(currentBands);
  return targetBands.every((band) => current.has(band));
}

export function isQuickFilterActive(filters: ActiveFilters, key: QuickFilterKey) {
  if (key === 'openNow') {
    return filters.openNow;
  }

  if (key === 'walk10') {
    return filters.maxWalkMinutes === 10;
  }

  return hasExactBands(filters.priceBands, QUICK_PRICE_BANDS);
}

export function toggleQuickFilter(filters: ActiveFilters, key: QuickFilterKey): ActiveFilters {
  if (key === 'openNow') {
    return {
      ...filters,
      openNow: !filters.openNow
    };
  }

  if (key === 'walk10') {
    return {
      ...filters,
      maxWalkMinutes: filters.maxWalkMinutes === 10 ? null : 10
    };
  }

  return {
    ...filters,
    priceBands: hasExactBands(filters.priceBands, QUICK_PRICE_BANDS) ? [] : [...QUICK_PRICE_BANDS]
  };
}

export function usesQuickPriceBands(filters: ActiveFilters) {
  return hasExactBands(filters.priceBands, QUICK_PRICE_BANDS);
}
