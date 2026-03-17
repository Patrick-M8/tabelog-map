import type { ReviewSource, SortDirection, SortKey } from '$lib/types';

export type OverrideSortMode = 'distance' | 'price' | null;

export type ReviewSortState = {
  sources: ReviewSource[];
  direction: SortDirection;
};

export type TraySortState = {
  overrideMode: OverrideSortMode;
  overrideDirection: SortDirection | null;
  reviewSort: ReviewSortState;
};

const REVIEW_SOURCE_ORDER: ReviewSource[] = ['tabelog', 'google'];

export const DEFAULT_TRAY_SORT_STATE: TraySortState = {
  overrideMode: null,
  overrideDirection: null,
  reviewSort: {
    sources: ['tabelog'],
    direction: 'desc'
  }
};

export function sanitizeReviewSources(sources: ReviewSource[]) {
  return REVIEW_SOURCE_ORDER.filter((source) => sources.includes(source));
}

export function sanitizeReviewDirection(direction: SortDirection | null | undefined): SortDirection {
  return direction === 'asc' ? 'asc' : 'desc';
}

export function sortKeyToTraySortState(sortKey: SortKey): TraySortState {
  if (sortKey === 'distanceAsc' || sortKey === 'distanceDesc') {
    return {
      ...DEFAULT_TRAY_SORT_STATE,
      overrideMode: 'distance',
      overrideDirection: sortKey === 'distanceDesc' ? 'desc' : 'asc'
    };
  }

  if (sortKey === 'priceAsc' || sortKey === 'priceDesc') {
    return {
      ...DEFAULT_TRAY_SORT_STATE,
      overrideMode: 'price',
      overrideDirection: sortKey === 'priceDesc' ? 'desc' : 'asc'
    };
  }

  if (sortKey === 'tabelogAsc' || sortKey === 'tabelogDesc') {
    return {
      ...DEFAULT_TRAY_SORT_STATE,
      reviewSort: {
        sources: ['tabelog'],
        direction: sortKey === 'tabelogAsc' ? 'asc' : 'desc'
      }
    };
  }

  if (sortKey === 'googleAsc' || sortKey === 'googleDesc') {
    return {
      ...DEFAULT_TRAY_SORT_STATE,
      reviewSort: {
        sources: ['google'],
        direction: sortKey === 'googleAsc' ? 'asc' : 'desc'
      }
    };
  }

  if (sortKey === 'reviewsCombinedAsc' || sortKey === 'reviewsCombinedDesc') {
    return {
      ...DEFAULT_TRAY_SORT_STATE,
      reviewSort: {
        sources: [...REVIEW_SOURCE_ORDER],
        direction: sortKey === 'reviewsCombinedAsc' ? 'asc' : 'desc'
      }
    };
  }

  return {
    ...DEFAULT_TRAY_SORT_STATE,
    reviewSort: {
      ...DEFAULT_TRAY_SORT_STATE.reviewSort,
      sources: []
    }
  };
}

export function traySortStateToSortKey(state: TraySortState): SortKey {
  if (state.overrideMode === 'distance') {
    return state.overrideDirection === 'desc' ? 'distanceDesc' : 'distanceAsc';
  }

  if (state.overrideMode === 'price') {
    return state.overrideDirection === 'desc' ? 'priceDesc' : 'priceAsc';
  }

  const sources = sanitizeReviewSources(state.reviewSort.sources);
  const direction = sanitizeReviewDirection(state.reviewSort.direction);

  if (sources.length === 2) {
    return direction === 'asc' ? 'reviewsCombinedAsc' : 'reviewsCombinedDesc';
  }

  if (sources[0] === 'tabelog') {
    return direction === 'asc' ? 'tabelogAsc' : 'tabelogDesc';
  }

  if (sources[0] === 'google') {
    return direction === 'asc' ? 'googleAsc' : 'googleDesc';
  }

  return 'best';
}

export function toggleOverrideSort(state: TraySortState, overrideMode: Exclude<OverrideSortMode, null>) {
  if (state.overrideMode !== overrideMode) {
    return {
      ...state,
      overrideMode,
      overrideDirection: 'asc'
    } satisfies TraySortState;
  }

  if (state.overrideDirection === 'asc') {
    return {
      ...state,
      overrideMode,
      overrideDirection: 'desc'
    } satisfies TraySortState;
  }

  return {
    ...state,
    overrideMode: null,
    overrideDirection: null
  } satisfies TraySortState;
}

export function toggleReviewSource(state: TraySortState, reviewSource: ReviewSource) {
  const currentSources = sanitizeReviewSources(state.reviewSort.sources);
  const nextSources = currentSources.includes(reviewSource)
    ? currentSources.filter((source) => source !== reviewSource)
    : sanitizeReviewSources([...currentSources, reviewSource]);

  return {
    ...state,
    reviewSort: {
      ...state.reviewSort,
      sources: nextSources
    }
  } satisfies TraySortState;
}

export function toggleReviewDirection(state: TraySortState) {
  return {
    ...state,
    reviewSort: {
      ...state.reviewSort,
      direction: sanitizeReviewDirection(state.reviewSort.direction) === 'asc' ? 'desc' : 'asc'
    }
  } satisfies TraySortState;
}
