import type { DisplayPlace, SortKey } from '$lib/types';

type ReviewSummary = {
  averageScore: number;
  totalReviews: number;
} | null;

function summarizeReviewSort(place: DisplayPlace, sources: Array<'tabelog' | 'google'>): ReviewSummary {
  let totalScore = 0;
  let scoreCount = 0;
  let totalReviews = 0;

  for (const source of sources) {
    const score = place[source].score;
    if (score === null) {
      continue;
    }

    totalScore += score;
    totalReviews += place[source].reviews;
    scoreCount += 1;
  }

  if (scoreCount === 0) {
    return null;
  }

  return {
    averageScore: totalScore / scoreCount,
    totalReviews
  };
}

function compareReviewSummary(
  left: { place: DisplayPlace; reviewSummary: ReviewSummary },
  right: { place: DisplayPlace; reviewSummary: ReviewSummary },
  direction: 'asc' | 'desc'
) {
  if (!left.reviewSummary && right.reviewSummary) {
    return 1;
  }

  if (left.reviewSummary && !right.reviewSummary) {
    return -1;
  }

  if (!left.reviewSummary && !right.reviewSummary) {
    return left.place.distanceMeters - right.place.distanceMeters;
  }

  const safeLeftSummary = left.reviewSummary!;
  const safeRightSummary = right.reviewSummary!;

  if (safeLeftSummary.averageScore !== safeRightSummary.averageScore) {
    return direction === 'asc'
      ? safeLeftSummary.averageScore - safeRightSummary.averageScore
      : safeRightSummary.averageScore - safeLeftSummary.averageScore;
  }

  if (safeLeftSummary.totalReviews !== safeRightSummary.totalReviews) {
    return safeRightSummary.totalReviews - safeLeftSummary.totalReviews;
  }

  return left.place.distanceMeters - right.place.distanceMeters;
}

function statusWeight(place: DisplayPlace) {
  return place.status.state === 'open'
    ? 650
    : place.status.state === 'closingSoon'
      ? 220
      : place.status.state === 'temporarilyClosed'
        ? -1400
        : place.status.state === 'permanentlyClosed'
          ? -2200
          : -900;
}

export function sortPlaces(places: DisplayPlace[], sortKey: SortKey) {
  const decorated = places.map((place) => ({
    place,
    bestScore: (place.consensusScore * 1000) - place.distanceMeters + statusWeight(place),
    reviewSummary:
      sortKey === 'tabelogAsc' || sortKey === 'tabelogDesc'
        ? summarizeReviewSort(place, ['tabelog'])
        : sortKey === 'googleAsc' || sortKey === 'googleDesc'
          ? summarizeReviewSort(place, ['google'])
          : sortKey === 'reviewsCombinedAsc' || sortKey === 'reviewsCombinedDesc'
            ? summarizeReviewSort(place, ['tabelog', 'google'])
            : null
  }));

  decorated.sort((left, right) => {
    if (sortKey === 'distance' || sortKey === 'distanceAsc') {
      return left.place.distanceMeters - right.place.distanceMeters;
    }

    if (sortKey === 'distanceDesc') {
      return right.place.distanceMeters - left.place.distanceMeters;
    }

    if (sortKey === 'priceAsc') {
      return left.place.priceBucket - right.place.priceBucket;
    }

    if (sortKey === 'priceDesc') {
      return right.place.priceBucket - left.place.priceBucket;
    }

    if (sortKey === 'tabelogAsc') {
      return compareReviewSummary(left, right, 'asc');
    }

    if (sortKey === 'tabelogDesc') {
      return compareReviewSummary(left, right, 'desc');
    }

    if (sortKey === 'googleAsc') {
      return compareReviewSummary(left, right, 'asc');
    }

    if (sortKey === 'googleDesc') {
      return compareReviewSummary(left, right, 'desc');
    }

    if (sortKey === 'reviewsCombinedAsc') {
      return compareReviewSummary(left, right, 'asc');
    }

    if (sortKey === 'reviewsCombinedDesc') {
      return compareReviewSummary(left, right, 'desc');
    }

    if (sortKey === 'closingSoon') {
      const leftClose = left.place.status.closesAt ?? '99:99';
      const rightClose = right.place.status.closesAt ?? '99:99';
      return leftClose.localeCompare(rightClose);
    }

    return right.bestScore - left.bestScore;
  });

  return decorated.map((entry) => entry.place);
}
