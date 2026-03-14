import type { DisplayPlace, SortKey } from '$lib/types';

function gradeScore(grade: DisplayPlace['consensusGrade']) {
  return {
    A: 5,
    B: 4,
    C: 3,
    D: 2,
    E: 1
  }[grade];
}

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
    const rightBest = (gradeScore(right.consensusGrade) * 900) - right.distanceMeters + rightStatusWeight;
    const leftBest = (gradeScore(left.consensusGrade) * 900) - left.distanceMeters + leftStatusWeight;
    return rightBest - leftBest;
  });

  return next;
}
