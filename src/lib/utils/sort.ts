import type { DisplayPlace, SortKey } from '$lib/types';

function compareReviewSort(
  left: DisplayPlace,
  right: DisplayPlace,
  sources: Array<'tabelog' | 'google'>,
  direction: 'asc' | 'desc'
) {
  const summarize = (place: DisplayPlace) => {
    const scores = sources
      .map((source) => ({
        score: place[source].score,
        reviews: place[source].reviews
      }))
      .filter((entry) => entry.score !== null);

    if (!scores.length) {
      return null;
    }

    const totalScore = scores.reduce((sum, entry) => sum + (entry.score ?? 0), 0);
    const totalReviews = scores.reduce((sum, entry) => sum + entry.reviews, 0);

    return {
      averageScore: totalScore / scores.length,
      totalReviews
    };
  };

  const leftSummary = summarize(left);
  const rightSummary = summarize(right);

  if (!leftSummary && rightSummary) {
    return 1;
  }

  if (leftSummary && !rightSummary) {
    return -1;
  }

  if (!leftSummary && !rightSummary) {
    return left.distanceMeters - right.distanceMeters;
  }

  const safeLeftSummary = leftSummary!;
  const safeRightSummary = rightSummary!;

  if (safeLeftSummary.averageScore !== safeRightSummary.averageScore) {
    return direction === 'asc'
      ? safeLeftSummary.averageScore - safeRightSummary.averageScore
      : safeRightSummary.averageScore - safeLeftSummary.averageScore;
  }

  if (safeLeftSummary.totalReviews !== safeRightSummary.totalReviews) {
    return safeRightSummary.totalReviews - safeLeftSummary.totalReviews;
  }

  return left.distanceMeters - right.distanceMeters;
}

export function sortPlaces(places: DisplayPlace[], sortKey: SortKey) {
  const next = [...places];

  next.sort((left, right) => {
    if (sortKey === 'distanceAsc') {
      return left.distanceMeters - right.distanceMeters;
    }

    if (sortKey === 'distanceDesc') {
      return right.distanceMeters - left.distanceMeters;
    }

    if (sortKey === 'priceAsc') {
      return left.priceBucket - right.priceBucket;
    }

    if (sortKey === 'priceDesc') {
      return right.priceBucket - left.priceBucket;
    }

    if (sortKey === 'tabelogAsc' || sortKey === 'tabelogDesc') {
      const leftScore = left.tabelog.score ?? (sortKey === 'tabelogAsc' ? Number.POSITIVE_INFINITY : -1);
      const rightScore = right.tabelog.score ?? (sortKey === 'tabelogAsc' ? Number.POSITIVE_INFINITY : -1);
      if (leftScore !== rightScore) {
        return sortKey === 'tabelogAsc' ? leftScore - rightScore : rightScore - leftScore;
      }

      if (left.tabelog.reviews !== right.tabelog.reviews) {
        return right.tabelog.reviews - left.tabelog.reviews;
      }

      return left.distanceMeters - right.distanceMeters;
    }

    if (sortKey === 'googleAsc' || sortKey === 'googleDesc') {
      const leftScore = left.google.score ?? (sortKey === 'googleAsc' ? Number.POSITIVE_INFINITY : -1);
      const rightScore = right.google.score ?? (sortKey === 'googleAsc' ? Number.POSITIVE_INFINITY : -1);
      if (leftScore !== rightScore) {
        return sortKey === 'googleAsc' ? leftScore - rightScore : rightScore - leftScore;
      }

      if (left.google.reviews !== right.google.reviews) {
        return right.google.reviews - left.google.reviews;
      }

      return left.distanceMeters - right.distanceMeters;
    }

    if (sortKey === 'closingSoon') {
      const leftClose = left.status.closesAt ?? '99:99';
      const rightClose = right.status.closesAt ?? '99:99';
      return leftClose.localeCompare(rightClose);
    }

    const rightStatusWeight =
      right.status.state === 'open'
        ? 650
        : right.status.state === 'closingSoon'
          ? 220
          : right.status.state === 'temporarilyClosed'
            ? -1400
            : right.status.state === 'permanentlyClosed'
              ? -2200
              : -900;
    const leftStatusWeight =
      left.status.state === 'open'
        ? 650
        : left.status.state === 'closingSoon'
          ? 220
          : left.status.state === 'temporarilyClosed'
            ? -1400
            : left.status.state === 'permanentlyClosed'
              ? -2200
              : -900;
    const rightBest = (right.consensusScore * 1000) - right.distanceMeters + rightStatusWeight;
    const leftBest = (left.consensusScore * 1000) - left.distanceMeters + leftStatusWeight;
    return rightBest - leftBest;
  });

  return next;
}
