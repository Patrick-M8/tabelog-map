import type { ReviewSource, SortDirection, SortKey, SortMode } from '$lib/types';

export type TraySortState = {
  sortMode: SortMode;
  sortDirection: SortDirection | null;
  reviewSource: ReviewSource | null;
};

export const DEFAULT_TRAY_SORT_STATE: TraySortState = {
  sortMode: 'best',
  sortDirection: null,
  reviewSource: null
};

export function sortKeyToTraySortState(sortKey: SortKey): TraySortState {
  if (sortKey === 'distanceAsc' || sortKey === 'distanceDesc') {
    return {
      sortMode: 'distance',
      sortDirection: sortKey === 'distanceDesc' ? 'desc' : 'asc',
      reviewSource: null
    };
  }

  if (sortKey === 'priceAsc' || sortKey === 'priceDesc') {
    return {
      sortMode: 'price',
      sortDirection: sortKey === 'priceDesc' ? 'desc' : 'asc',
      reviewSource: null
    };
  }

  if (sortKey === 'tabelog' || sortKey === 'google') {
    return {
      sortMode: 'reviews',
      sortDirection: null,
      reviewSource: sortKey
    };
  }

  return { ...DEFAULT_TRAY_SORT_STATE };
}

export function traySortStateToSortKey(state: TraySortState): SortKey {
  if (state.sortMode === 'distance') {
    return state.sortDirection === 'desc' ? 'distanceDesc' : 'distanceAsc';
  }

  if (state.sortMode === 'price') {
    return state.sortDirection === 'desc' ? 'priceDesc' : 'priceAsc';
  }

  if (state.sortMode === 'reviews' && state.reviewSource) {
    return state.reviewSource;
  }

  return 'best';
}

export function setStandardSort(
  state: TraySortState,
  sortMode: Extract<SortMode, 'best' | 'distance' | 'price'>,
  sortDirection: SortDirection | null = null
) {
  return {
    ...state,
    sortMode,
    sortDirection: sortMode === 'best' ? null : (sortDirection ?? 'asc'),
    reviewSource: null
  } satisfies TraySortState;
}

export function setReviewSort(state: TraySortState, reviewSource: ReviewSource) {
  return {
    ...state,
    sortMode: 'reviews',
    sortDirection: null,
    reviewSource
  } satisfies TraySortState;
}
