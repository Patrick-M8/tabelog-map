import type { DisplayPlace, SortKey } from '$lib/types';

export function sortPlaces(places: DisplayPlace[], sortKey: SortKey) {
  const next = [...places];

  next.sort((left, right) => {
    if (sortKey === 'distance') {
      return left.distanceMeters - right.distanceMeters;
    }

    if (sortKey === 'price') {
      return left.priceBucket - right.priceBucket;
    }

    if (sortKey === 'closingSoon') {
      const leftClose = left.status.closesAt ?? '99:99';
      const rightClose = right.status.closesAt ?? '99:99';
      return leftClose.localeCompare(rightClose);
    }

    const rightStatusWeight =
      right.status.state === 'open' ? 650 : right.status.state === 'closingSoon' ? 220 : -900;
    const leftStatusWeight =
      left.status.state === 'open' ? 650 : left.status.state === 'closingSoon' ? 220 : -900;
    const rightBest = (right.consensusScore * 1000) - right.distanceMeters + rightStatusWeight;
    const leftBest = (left.consensusScore * 1000) - left.distanceMeters + leftStatusWeight;
    return rightBest - leftBest;
  });

  return next;
}
