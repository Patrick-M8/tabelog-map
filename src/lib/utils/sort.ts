import type { DisplayPlace, SortKey } from '$lib/types';

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

    if (sortKey === 'tabelog') {
      const leftScore = left.tabelog.score ?? -1;
      const rightScore = right.tabelog.score ?? -1;
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }

      if (left.tabelog.reviews !== right.tabelog.reviews) {
        return right.tabelog.reviews - left.tabelog.reviews;
      }

      return left.distanceMeters - right.distanceMeters;
    }

    if (sortKey === 'google') {
      const leftScore = left.google.score ?? -1;
      const rightScore = right.google.score ?? -1;
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }

      if (left.google.reviews !== right.google.reviews) {
        return right.google.reviews - left.google.reviews;
      }

      return left.distanceMeters - right.distanceMeters;
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
