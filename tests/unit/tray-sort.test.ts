import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRAY_SORT_STATE,
  setReviewSort,
  setStandardSort,
  sortKeyToTraySortState,
  traySortStateToSortKey
} from '../../src/lib/utils/traySort';

describe('traySortStateToSortKey', () => {
  it('maps best sort to the neutral data-layer sort key', () => {
    expect(traySortStateToSortKey(DEFAULT_TRAY_SORT_STATE)).toBe('best');
  });

  it('maps distance and price sorts with direction', () => {
    expect(traySortStateToSortKey(setStandardSort(DEFAULT_TRAY_SORT_STATE, 'distance', 'desc'))).toBe('distanceDesc');
    expect(traySortStateToSortKey(setStandardSort(DEFAULT_TRAY_SORT_STATE, 'price', 'asc'))).toBe('priceAsc');
  });

  it('maps review source sorts to provider sort keys', () => {
    expect(traySortStateToSortKey(setReviewSort(DEFAULT_TRAY_SORT_STATE, 'tabelog'))).toBe('tabelog');
    expect(traySortStateToSortKey(setReviewSort(DEFAULT_TRAY_SORT_STATE, 'google'))).toBe('google');
  });
});

describe('sortKeyToTraySortState', () => {
  it('rebuilds explicit tray state from flattened sort keys', () => {
    expect(sortKeyToTraySortState('distanceAsc')).toEqual({
      sortMode: 'distance',
      sortDirection: 'asc',
      reviewSource: null
    });
    expect(sortKeyToTraySortState('google')).toEqual({
      sortMode: 'reviews',
      sortDirection: null,
      reviewSource: 'google'
    });
  });

  it('clears review state when a standard sort is selected', () => {
    expect(setStandardSort(setReviewSort(DEFAULT_TRAY_SORT_STATE, 'tabelog'), 'best')).toEqual({
      sortMode: 'best',
      sortDirection: null,
      reviewSource: null
    });
  });
});
