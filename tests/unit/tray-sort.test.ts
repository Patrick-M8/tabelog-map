import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRAY_SORT_STATE,
  sortKeyToTraySortState,
  toggleOverrideSort,
  toggleReviewDirection,
  toggleReviewSource,
  traySortStateToSortKey
} from '../../src/lib/utils/traySort';

describe('traySortStateToSortKey', () => {
  it('defaults to tabelog descending', () => {
    expect(traySortStateToSortKey(DEFAULT_TRAY_SORT_STATE)).toBe('tabelogDesc');
  });

  it('maps distance and price overrides with direction', () => {
    expect(traySortStateToSortKey(toggleOverrideSort(DEFAULT_TRAY_SORT_STATE, 'distance'))).toBe('distanceAsc');
    expect(
      traySortStateToSortKey(toggleOverrideSort(toggleOverrideSort(DEFAULT_TRAY_SORT_STATE, 'price'), 'price'))
    ).toBe('priceDesc');
  });

  it('maps single-source and combined review sorts with direction', () => {
    expect(
      traySortStateToSortKey(toggleReviewDirection({ ...DEFAULT_TRAY_SORT_STATE, reviewSort: { sources: ['google'], direction: 'desc' } }))
    ).toBe('googleAsc');
    expect(
      traySortStateToSortKey({
        ...DEFAULT_TRAY_SORT_STATE,
        reviewSort: { sources: ['tabelog', 'google'], direction: 'asc' }
      })
    ).toBe('reviewsCombinedAsc');
  });

  it('falls back to best when all review sources are deselected and no override is active', () => {
    const noSources = toggleReviewSource(DEFAULT_TRAY_SORT_STATE, 'tabelog');
    expect(traySortStateToSortKey(noSources)).toBe('best');
  });
});

describe('sortKeyToTraySortState', () => {
  it('rebuilds override state from flattened sort keys', () => {
    expect(sortKeyToTraySortState('distanceDesc')).toEqual({
      ...DEFAULT_TRAY_SORT_STATE,
      overrideMode: 'distance',
      overrideDirection: 'desc'
    });
  });

  it('rebuilds combined review state from flattened sort keys', () => {
    expect(sortKeyToTraySortState('reviewsCombinedDesc')).toEqual({
      ...DEFAULT_TRAY_SORT_STATE,
      reviewSort: {
        sources: ['tabelog', 'google'],
        direction: 'desc'
      }
    });
  });
});

describe('override toggles', () => {
  it('cycles asc, desc, then off while preserving review preferences', () => {
    const asc = toggleOverrideSort(DEFAULT_TRAY_SORT_STATE, 'distance');
    expect(asc.overrideMode).toBe('distance');
    expect(asc.overrideDirection).toBe('asc');
    expect(asc.reviewSort).toEqual(DEFAULT_TRAY_SORT_STATE.reviewSort);

    const desc = toggleOverrideSort(asc, 'distance');
    expect(desc.overrideDirection).toBe('desc');

    const off = toggleOverrideSort(desc, 'distance');
    expect(off.overrideMode).toBeNull();
    expect(off.overrideDirection).toBeNull();
    expect(off.reviewSort).toEqual(DEFAULT_TRAY_SORT_STATE.reviewSort);
  });
});

describe('review toggles', () => {
  it('toggles sources independently in a stable order', () => {
    const googleOnly = toggleReviewSource(DEFAULT_TRAY_SORT_STATE, 'tabelog');
    expect(googleOnly.reviewSort.sources).toEqual([]);

    const both = toggleReviewSource(DEFAULT_TRAY_SORT_STATE, 'google');
    expect(both.reviewSort.sources).toEqual(['tabelog', 'google']);

    const tabelogOnly = toggleReviewSource(both, 'google');
    expect(tabelogOnly.reviewSort.sources).toEqual(['tabelog']);
  });

  it('toggles review direction without mutating source selection', () => {
    const next = toggleReviewDirection({
      ...DEFAULT_TRAY_SORT_STATE,
      reviewSort: {
        sources: ['tabelog', 'google'],
        direction: 'desc'
      }
    });

    expect(next.reviewSort).toEqual({
      sources: ['tabelog', 'google'],
      direction: 'asc'
    });
  });
});
